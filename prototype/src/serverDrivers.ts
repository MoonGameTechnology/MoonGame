/**
 * Server-side standing-order drivers: one deterministic tick each for CC-2
 * auto-storm, CC-1 order chains, and CC-4 reactive patrols. Extracted from
 * `game.ts` (REFP-24): depends on `fleetIdle`/`ChainStep`/`FleetChain`
 * (`chain.ts`, REFP-8), `Patrol`/`scrambleOrder` (`patrol.ts`, REFP-23),
 * `SortieState`/`sortieSpec`/`tickRearm`/`fleetHasShuttle` (ядро,
 * `state/shuttle.ts` — CONV-5,
 * REFP-7), and the action builders `moveFleet`/`orbitFleet`/`assaultFleet`/
 * `castHeroAbility` (`actions.ts`, REFP-22/24). Pure — a host
 * (`main.ts`'s frame loop, or NET's `standingOrders`/`chain` modules) applies
 * the returned actions/patches; a rejected action is simply skipped, never
 * retried forever (the CC-2 rejected-churn lesson). `game.ts` imports these
 * for internal use and re-exports for `main.ts` / tests.
 */
import {
  type Action,
  type GameState,
  type Hero,
} from '../../packages/shared-core/src/index';
import { data } from './gameData';
import { canOrderAll } from './protoKernel';
import { fleetIdle, type ChainStep, type FleetChain } from '../../packages/shared-core/src/index';
import { patrolScrambles } from '../../packages/shared-core/src/index';
import {
  moveFleet,
  orbitFleet,
  assaultFleet,
  castHeroAbility,
  strikeShuttle,
} from './actions';

const HOUR = 3_600_000;

/** Minimal view of the prototype's state extension these drivers read — the
 *  standing-order maps `standingOrdersModule` (`standingOrders.ts`) maintains. */
interface DriverState extends GameState {
  autoAssault?: Record<string, true>;
  orders?: Record<string, FleetChain>;
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
    }
  }
  return out;
}
/**
 * Один тик СЕРВЕРНОГО драйвера дежурного вылета (CC-4, на базе с SHU-2.2) — обёртка.
 *
 * Решение (кому лететь и по кому) целиком в ядре: `patrolScrambles`. Здесь остаётся
 * завернуть его в прототипный `shuttle.strike`. Раньше тут лежала вторая копия правил
 * плюс собственное ведение топлива через `patrol.stamp` — и то и другое ушло вместе с
 * моделью «крыло как флот»: запас вылетов принадлежит БАЗЕ и тратится самим ударом.
 */
export function serverPatrolActions(
  state: GameState,
): Array<{ owner: string; actions: Action[] }> {
  return patrolScrambles(state, data).map((sc) => ({
    owner: sc.owner,
    actions: [
      strikeShuttle(
        sc.owner,
        sc.base.kind === 'planet' ? { planetId: sc.base.id } : { fleetId: sc.base.id },
        sc.squadronId,
        { targetFleetId: sc.targetFleetId },
      ),
    ],
  }));
}
