/**
 * Server-side standing-order drivers: one deterministic tick each for CC-2
 * auto-storm, CC-1 order chains, and CC-4 reactive patrols. Extracted from
 * `game.ts` (REFP-24): depends on `fleetIdle`/`ChainStep`/`FleetChain`
 * (`chain.ts`, REFP-8), `Patrol`/`scrambleOrder` (`patrol.ts`, REFP-23),
 * `SortieState`/`sortieSpec`/`tickRearm`/`fleetHasSquadron` (ядро,
 * `state/squadron.ts` — CONV-5,
 * REFP-7), and the action builders `moveFleet`/`orbitFleet`/`assaultFleet`/
 * `barrageFleet`/`castHeroAbility` (`actions.ts`, REFP-22/24). Pure — a host
 * (`main.ts`'s frame loop, or NET's `standingOrders`/`chain` modules) applies
 * the returned actions/patches; a rejected action is simply skipped, never
 * retried forever (the CC-2 rejected-churn lesson). `game.ts` imports these
 * for internal use and re-exports for `main.ts` / tests.
 */
import {
  identifiedNodes,
  getStance,
  type Action,
  type GameState,
  type Hero,
} from '../../packages/shared-core/src/index';
import { data } from './prototypeData';
import { canOrderAll } from './protoKernel';
import { fleetIdle, type ChainStep, type FleetChain } from './chain';
import { scrambleOrder, type Patrol } from './patrol';
import {
  sortieSpec,
  tickRearm,
  fleetHasSquadron,
  type SortieState,
} from '../../packages/shared-core/src/index';
import { moveFleet, orbitFleet, assaultFleet, barrageFleet, castHeroAbility } from './actions';

const HOUR = 3_600_000;

/** Minimal view of the prototype's state extension these drivers read — the
 *  standing-order maps `standingOrdersModule` (`standingOrders.ts`) maintains. */
interface DriverState extends GameState {
  autoAssault?: Record<string, true>;
  orders?: Record<string, FleetChain>;
  patrols?: Record<string, Patrol & { rearmAt?: number }>;
}

/** One tick of the SERVER-SIDE auto-storm driver (CC-2): every fleet flagged in
 *  `state.autoAssault` whose storm orders the KERNEL would accept gets them issued.
 *  Pure — the host applies the actions; a rejection is simply skipped (a standing
 *  stance has no chain to block).
 *
 *  RULES-3. Правила штурма (захватываемость, владелец, дипломатия, чужой флот на
 *  узле, десант, идущий наземный бой) здесь БОЛЬШЕ НЕ ПЕРЕПИСЫВАЮТСЯ — их называет
 *  ядро тем же кодом, каким отбило бы сам приказ. Опт-ин игрока (`autoAssault`)
 *  остаётся политикой: это не правило, а согласие. Раньше клиентский двойник
 *  (`autoEngage`) уже спрашивал ядро, а этот — нет; в сети работает именно ЭТОТ,
 *  то есть единый источник правил доставался той половине, которая в онлайне не
 *  решает.
 *
 *  Проверяется вся ПАРА «встать на низкую орбиту → штурм» по ЧЕРНОВОМУ состоянию:
 *  штурм нелегален с дальней орбиты, поэтому вопрос про него задаётся уже ПОСЛЕ
 *  орбиты. Иначе применилась бы половина обречённой пары — орбита проходит, штурм
 *  отбивается, и так каждое пробуждение (та самая rejected-churn). */
export function serverAutoAssaultActions(
  state: GameState,
): Array<{ fleetId: string; owner: string; actions: Action[] }> {
  const flagged = (state as DriverState).autoAssault ?? {};
  const out: Array<{ fleetId: string; owner: string; actions: Action[] }> = [];
  // Сортировка ключей — как в двух других драйверах этого файла: JSONB не хранит
  // порядок ключей объекта, поэтому несортированный обход делал ПОРЯДОК выдачи
  // приказов зависимым от хоста и гибернации (инвариант №6).
  for (const fid of Object.keys(flagged).sort()) {
    const f = state.fleets[fid];
    if (!f) continue; // нет флота — не из чего собрать приказ (нужен f.owner)
    const actions =
      f.orbit === 'near'
        ? [assaultFleet(f.owner, fid)]
        : [orbitFleet(f.owner, fid), assaultFleet(f.owner, fid)];
    if (canOrderAll(state, actions) !== null) continue;
    out.push({ fleetId: fid, owner: f.owner, actions });
  }
  return out;
}

/** The cooldown-ledger key an ability occupies — mirrors the core heroModule's
 *  `cooldownKey` so the chain driver reads the SAME slot the cast writes. */
function abilityCooldownKey(type: string): string {
  return type === 'temp_lane' ? 'path' : type === 'annihilate' ? 'annihilate' : `fx:${type}`;
}
/** Is `hero`'s `abilityId` still cooling down at `now`? An unknown ability id is NOT
 *  held (the core rejects it and the step is consumed — never a permanent deadlock). */
function abilityOnCooldown(hero: Hero, abilityId: string, now: number): boolean {
  const def = data.heroAbilities[abilityId];
  if (!def) return false;
  return ((hero.cooldowns ?? {})[abilityCooldownKey(def.type)] ?? 0) > now;
}
/** The living hero commanding this fleet (its ship), if any. Sorted-id lookup keeps it
 *  deterministic across hosts (JSONB scrambles object key order — BF-13). */
function heroCommandingFleet(state: GameState, fleetId: string): Hero | undefined {
  const heroes = state.heroes ?? {};
  for (const id of Object.keys(heroes).sort()) {
    const h = heroes[id]!;
    if (h.fleetId === fleetId && h.alive !== false) return h;
  }
  return undefined;
}

/** One tick of the CC-1 chain driver: for every chained fleet that is FREE (not in
 *  transit, not in battle), resolve the head step into the orders to issue plus the
 *  `chain.stamp` patch ([] steps = chain done → cleared). Consume-on-issue: a step
 *  whose order the core then rejects is SKIPPED, not retried forever (the CC-2
 *  rejected-churn lesson). Sorted fleet ids ⇒ deterministic across hosts (JSONB does
 *  not preserve object key order). Pure — hosts apply the patch, then the actions. */
export function serverChainActions(
  state: GameState,
  now: number,
): Array<{
  fleetId: string;
  owner: string;
  actions: Action[];
  patch?: { steps: ChainStep[]; waitUntil?: number };
}> {
  const chains = (state as DriverState).orders ?? {};
  const out: Array<{
    fleetId: string;
    owner: string;
    actions: Action[];
    patch?: { steps: ChainStep[]; waitUntil?: number };
  }> = [];
  for (const fid of Object.keys(chains).sort()) {
    const chain = chains[fid]!;
    const f = state.fleets[fid];
    if (!f) continue; // dead fleet — the module's own housekeeping sweep clears it
    if (!fleetIdle(f)) continue; // busy: the chain resumes once the fleet is free
    const head = chain.steps[0];
    if (!head) {
      out.push({ fleetId: fid, owner: f.owner, actions: [], patch: { steps: [] } });
      continue;
    }
    const rest = chain.steps.slice(1);
    if (head.kind === 'wait') {
      // Two-phase hold: arm the deadline once, then consume when the clock passes it.
      if (chain.waitUntil === undefined) {
        out.push({
          fleetId: fid,
          owner: f.owner,
          actions: [],
          patch: { steps: chain.steps, waitUntil: now + head.hours * HOUR },
        });
      } else if (now >= chain.waitUntil) {
        out.push({ fleetId: fid, owner: f.owner, actions: [], patch: { steps: rest } });
      }
    } else if (head.kind === 'move') {
      out.push({
        fleetId: fid,
        owner: f.owner,
        // Already there → nothing to issue (the core would reject E_SAME_LOCATION).
        actions: f.location === head.to ? [] : [moveFleet(f.owner, fid, head.to)],
        patch: { steps: rest },
      });
    } else if (head.kind === 'assault') {
      out.push({
        fleetId: fid,
        owner: f.owner,
        actions:
          f.orbit === 'near'
            ? [assaultFleet(f.owner, fid)]
            : [orbitFleet(f.owner, fid), assaultFleet(f.owner, fid)],
        patch: { steps: rest },
      });
    } else if (head.kind === 'strike') {
      // Fire window, two-phase like `wait`: open — focus the guns and arm the
      // deadline; close — cease fire (clear focus) and move on. A fleet with no
      // artillery just idles through the window (the focus order rejects, the
      // window still runs — deterministic either way).
      if (chain.waitUntil === undefined) {
        out.push({
          fleetId: fid,
          owner: f.owner,
          actions: [barrageFleet(f.owner, fid, head.target)],
          patch: { steps: chain.steps, waitUntil: now + head.hours * HOUR },
        });
      } else if (now >= chain.waitUntil) {
        out.push({
          fleetId: fid,
          owner: f.owner,
          actions: [barrageFleet(f.owner, fid, null)],
          patch: { steps: rest },
        });
      }
    } else if (head.kind === 'ability') {
      // A hero ability queued as a step (CC-1 × HERO-4): the hero commanding THIS fleet
      // casts it once the fleet is free. Consume-on-issue like move/assault — the core
      // `hero.ability` re-gates ownership/liveness/equipment/range/cost, so a step it
      // rejects is skipped, not retried. The ONE hold is a live cooldown (a transient
      // that always clears): «дойти и открыть Коридор» waits the cooldown out instead of
      // wasting the cast. No hero on the fleet ⇒ drop the stale step (no action).
      const hero = heroCommandingFleet(state, fid);
      if (hero === undefined || !abilityOnCooldown(hero, head.abilityId, now)) {
        out.push({
          fleetId: fid,
          owner: f.owner,
          actions: hero
            ? [castHeroAbility(f.owner, hero.id, head.abilityId, head.target ?? undefined)]
            : [],
          patch: { steps: rest },
        });
      }
    } else {
      out.push({
        fleetId: fid,
        owner: f.owner,
        actions: [barrageFleet(f.owner, fid, head.target)],
        patch: { steps: rest },
      });
    }
  }
  return out;
}

/** One tick of the SERVER-SIDE patrol driver (CC-4): tick each standing patrol's rearm
 *  on its game-hour cadence, then — if the wing is parked and flight-ready — scramble at
 *  the lowest-id identified, at-war contact inside the radius (the same pure scrambleOrder
 *  the solo driver uses; vision comes from the owner's identify coverage, so the server
 *  never lets a patrol see through the fog its owner has). Pure — the host applies the
 *  strike `actions` and persists `patch` via patrol.stamp; `drop` retires a patrol whose
 *  fleet lost its wing. */
export function serverPatrolActions(
  state: GameState,
  now: number,
): Array<{
  fleetId: string;
  owner: string;
  actions: Action[];
  patch?: { sortie: SortieState; rearmAt?: number };
  drop?: boolean;
}> {
  const patrols = (state as DriverState).patrols ?? {};
  const out: Array<{
    fleetId: string;
    owner: string;
    actions: Action[];
    patch?: { sortie: SortieState; rearmAt?: number };
    drop?: boolean;
  }> = [];
  const identify = new Map<string, Set<string>>(); // owner → identified nodes (hoisted per owner)
  // Sorted fleet-id iteration (like serverChainActions above): JSONB does not preserve
  // object key order, so unsorted iteration would make the strike-issue order — and thus
  // which of two co-located wings wins a race for the same target — host/hibernation
  // dependent. Sorting pins one order across hosts and wake cycles (invariant #6).
  for (const fid of Object.keys(patrols).sort()) {
    const p = patrols[fid]!;
    const f = state.fleets[fid];
    if (!f || !fleetHasSquadron(f, data)) {
      out.push({ fleetId: fid, owner: f?.owner ?? '', actions: [], drop: true });
      continue;
    }
    const spec = sortieSpec(f, data);
    // Rearm cadence: one round per game-hour past `rearmAt` (absolute stamps — no
    // wall-clock drift, works however rarely the offline room wakes).
    let sortie = p.sortie;
    let rearmAt = p.rearmAt ?? now + HOUR;
    while (now >= rearmAt) {
      sortie = tickRearm(sortie, spec.maxFuel);
      rearmAt += HOUR;
    }
    let actions: Action[] = [];
    if (fleetIdle(f)) {
      let seen = identify.get(f.owner);
      if (!seen) {
        seen = identifiedNodes(state, f.owner, data);
        identify.set(f.owner, seen);
      }
      const targets: Array<{ id: string; location: string; pos: { x: number; y: number } }> = [];
      for (const g of Object.values(state.fleets)) {
        if (g.owner === f.owner || !g.location || g.movement || !g.units.some((u) => u.count > 0))
          continue;
        if (g.battleId) continue; // already locked in a battle — engage would reject, yet the sortie fuel is spent (BF-30)
        if (getStance(state, f.owner, g.owner) !== 'war') continue; // declared enemies only — never auto-war
        if (!seen.has(g.location)) continue; // identified contacts only — fog-honest
        const pos = state.planets[g.location]?.position;
        if (pos) targets.push({ id: g.id, location: g.location, pos });
      }
      const res = scrambleOrder(f.owner, f, { ...p, sortie }, targets, spec.rearmRounds);
      sortie = res.sortie;
      if (res.action) actions = [res.action];
    }
    const changed =
      sortie.fuel !== p.sortie.fuel ||
      sortie.rearming !== p.sortie.rearming ||
      rearmAt !== p.rearmAt;
    out.push({
      fleetId: fid,
      owner: f.owner,
      actions,
      patch: changed ? { sortie, rearmAt } : undefined,
    });
  }
  return out;
}
