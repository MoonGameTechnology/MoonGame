/**
 * Server-side seat AIs (REFP-26) — which AI (if any) plays a seat this tick
 * (`seatAiDecision`, SES-2.2: Steward delegation ⊳ substitute-after-grace ⊳ none)
 * and the full expansion bot / delegated-posture driver (`aiOrders`). Extracted
 * from `game.ts` as a pure move. Pure builders: both hosts (solo frame loop /
 * netserver driver) apply the returned actions through the kernel. `game.ts`
 * re-exports for main.ts / netserver.ts / tests (until REFP-28).
 */
import {
  getStance,
  type GameState,
  type Action,
  type StewardPosture,
  type Planet,
  type Fleet,
} from '../../packages/shared-core/src/index';
import { provinceScore } from '../../packages/shared-core/src/state/sectorKind';
import {
  moveFleet,
  launchFleet,
  buildBuilding,
  buildUnit,
  declareWar,
  canTraverse,
  marketList,
  mergeFleet,
  loadArmy,
} from './actions';
import { netIncome } from './economy';
import { SECTOR_TYPES } from './map';
import { data } from './prototypeData';
import type { MarketSide } from '../../packages/shared-core/src/index';
import { stewardGuardOrders } from './stewardGuard';

/** The two server-side AIs that can play a seat, kept explicitly DISTINCT
 *  (SES-2.2). `steward` — «Хранитель»: the player's OWN autopilot, a defensive
 *  posture they turned on to cover their sleep; it runs on their chosen posture
 *  even while they are connected-but-idle, and its live delegation OUTRANKS the
 *  abandon grace. `substitute` — «заместитель»: the full expansion bot that takes
 *  over an ABANDONED chair, only after the player has been gone past the
 *  real-time grace window, and it is reclaimed the instant they return. `none` —
 *  no AI drives the seat this tick (a present player commands it, or an absent
 *  one is still inside their reconnect grace). */
export type SeatAiKind = 'steward' | 'substitute' | 'none';

/** What drives a seat this tick + the posture to hand `aiOrders`. */
export interface SeatAiDecision {
  kind: SeatAiKind;
  posture: StewardPosture | 'expand' | null; // null ⇔ kind === 'none'
}

/** Decide which server AI (if any) plays ONE seat this tick — SES-2.2. Pure:
 *  reads only the three facts the host tracks, no time source of its own.
 *  `hasHuman` — a live peer holds the chair; `posture` — the seat's active
 *  Steward delegation (`stewardActive`), null if none; `graceExpired` — the
 *  player has been absent PAST the real-time abandon window (wall-clock, the host
 *  compares `Date.now()`; always true for a chair that never opened a window).
 *  The precedence encodes the owner's intent: a delegation they set beats the
 *  automatic takeover, and a present human beats the idle bot. */
export function seatAiDecision(
  hasHuman: boolean,
  posture: StewardPosture | null,
  graceExpired: boolean,
): SeatAiDecision {
  // A live Steward delegation is the player's OWN autopilot: it plays regardless
  // of connection and never waits on the abandon grace (they asked for it).
  if (posture) return { kind: 'steward', posture };
  // No delegation → a present human commands their own chair.
  if (hasHuman) return { kind: 'none', posture: null };
  // Empty chair: wait out the grace (a drop / restart blip / a few days away)
  // before the substitute bot seizes it — reclaimed the moment they return.
  if (!graceExpired) return { kind: 'none', posture: null };
  return { kind: 'substitute', posture: 'expand' };
}

/** One decision tick's orders for an AI-driven seat, evaluated against `state`.
 *  Read-only: it builds and returns the actions; the caller applies them — the
 *  client to its local sim, the server through the authoritative room. Drives
 *  empty seats the same way in solo and multiplayer (a seat with no human). */
export function aiOrders(
  state: GameState,
  ai: string,
  posture: StewardPosture | 'expand' = 'expand',
): Action[] {
  const out: Action[] = [];
  if (!state.players[ai]) return out; // seat not in play / eliminated
  // The defensive family: both Steward postures HOLD (no expansion, no war
  // declarations); «Активная оборона» merely adds the counterstrike/fire-watch
  // inside the guard-duty tick below.
  const defensive = posture === 'defend' || posture === 'active_defend';
  // Steward guard duty (ST-3.2/3.3): a delegated defensive seat watches its worlds,
  // evacuates a wing the forecast says it would lose ≥ STEWARD_LOSS_LIMIT of, and —
  // under «Активная оборона» — counterstrikes what it beats cheaply on own soil.
  if (defensive) out.push(...stewardGuardOrders(state, ai, posture as StewardPosture));
  const isShipUnit = (u: string): boolean => !data.units[u]?.traits.includes('ground');
  const capturable = (p: Planet): boolean => SECTOR_TYPES[p.kind ?? '']?.capturable ?? false;
  const d = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.hypot(a.x - b.x, a.y - b.y);
  // Send each idle AI fleet toward the nearest capturable world it can reach — only
  // neutral worlds or territory of someone it's at WAR with (peace = off-limits).
  // Steward «Оборона» (a delegated human seat, posture 'defend') HOLDS: it skips this
  // offensive sweep entirely and only builds / reinforces / trades below — repelling an
  // attacker is automatic in combat. "Autopilot keeps you alive; active play wins."
  // Named `warFooting` (not `atWar`) so the module-level pair helper stays visible.
  const warFooting = Object.keys(state.players).some(
    (pid) =>
      pid !== ai && state.players[pid]?.status === 'active' && getStance(state, ai, pid) === 'war',
  );
  // The home base (build/launch anchor, and the rally point ships pool at during war).
  const base =
    Object.values(state.planets).find((p) => p.owner === ai && p.buildings.length > 0) ??
    Object.values(state.planets).find((p) => p.owner === ai);
  const shipCount = (f: Fleet): number =>
    f.units.reduce((n, s) => n + (isShipUnit(s.unit) ? s.count : 0), 0);
  const expandFleets: Fleet[] = defensive ? [] : Object.values(state.fleets);
  // Consolidate BEFORE moving (self-play M4): two idle fleets sharing a location fuse
  // into one — without this, battle remnants and rally leftovers accumulate into a
  // hundreds-strong swarm of one-ship fleets that grinds the whole sim (and feeds
  // enemy AA one hull at a time). The merged fleet sorties on the next tick.
  const skipMove = new Set<string>();
  {
    const byLoc = new Map<string, Fleet[]>();
    for (const f of expandFleets) {
      if (f.owner !== ai || f.location == null || f.movement || f.battleId) continue;
      const group = byLoc.get(f.location);
      if (group) group.push(f);
      else byLoc.set(f.location, [f]);
    }
    for (const group of byLoc.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => shipCount(b) - shipCount(a));
      for (let k = 1; k < group.length; k++) {
        out.push(mergeFleet(ai, group[k]!.id, group[0]!.id));
        skipMove.add(group[k]!.id);
      }
      skipMove.add(group[0]!.id); // it grows this tick, sorties the next
    }
  }
  for (const f of expandFleets) {
    if (f.owner !== ai || f.location == null || f.movement || f.battleId) continue;
    if (skipMove.has(f.id)) continue;
    // Strike groups, not dribbles (self-play M4): auto-rally pools each new ship into
    // the IDLE rally fleet at its build world — but only while one is parked there.
    // Sending every single-ship fleet out at once therefore orphaned the rally point,
    // spawned a fresh one-ship fleet per build (hundreds of fleets, the sim ground to
    // a halt) and fed hulls into enemy AA one at a time. At war, ships HOLD at the
    // home rally point until a strike group has formed; peacetime keeps the old
    // race-to-claim behaviour (speed is everything, there is nothing to fight).
    if (warFooting && f.location === base?.id) {
      if (shipCount(f) < 3) continue;
      // Lift a landing party before the sortie: only ground troops can take a
      // garrisoned world (two-phase capture), so a strike group without a landing
      // can raid provinces but never resolve the war. Load, then move — same tick.
      const militia = base.garrison.find((s) => s.unit === 'militia' && s.count > 0);
      const hasLanding = (f.landing ?? []).some((s) => s.count > 0);
      if (!hasLanding && militia) {
        out.push(loadArmy(ai, f.id, 'militia', Math.min(2, militia.count)));
      }
    }
    const here = state.planets[f.location];
    if (!here) continue;
    let best: Planet | null = null;
    let bestD = Infinity;
    for (const p of Object.values(state.planets)) {
      if (p.owner === ai || !capturable(p)) continue;
      if (!canTraverse(state, ai, p.owner)) continue; // a peace-locked target — leave it be
      const dd = d(here.position, p.position);
      if (dd < bestD) {
        bestD = dd;
        best = p;
      }
    }
    if (best) out.push(moveFleet(ai, f.id, best.id));
  }
  // War when the race is being LOST (self-play M4 finding): a passive bot loses the
  // score race to whoever expands faster — every bot-vs-bot match ended as a 2-day
  // race with zero battles, and the military (and combat factions) never played. So
  // a bot falling a planet's worth (≥ 50) behind the score leader — or merely behind
  // once no capturable neutral is left — declares war on that leader; the expansion
  // loop above then targets war territory (traversable/capturable) and contested
  // provinces swing back. A bot that IS ahead stays quiet — it wins by holding.
  // Declared only from a clean 'peace' stance: pacts/alliances are never betrayed,
  // and favour-driven war (botDiplomacyModule) keeps working on top unchanged.
  if (!defensive) {
    const scoreOf = (who: string): number =>
      Object.values(state.planets).reduce(
        (s, p) => (p.owner === who ? s + provinceScore(data, p) : s),
        0,
      );
    const mine = scoreOf(ai);
    let leader: string | null = null;
    let leaderScore = -1;
    for (const pid of Object.keys(state.players)) {
      if (pid === ai || state.players[pid]?.status !== 'active') continue;
      const sc = scoreOf(pid);
      if (sc > leaderScore) {
        leaderScore = sc;
        leader = pid;
      }
    }
    const neutralLeft = Object.values(state.planets).some((p) => p.owner === null && capturable(p));
    const losingRace = leaderScore - mine >= 50 || (!neutralLeft && leaderScore >= mine);
    if (leader && losingRace && getStance(state, ai, leader) === 'peace') {
      out.push(declareWar(ai, leader));
    }
  }
  // Build + launch from this AI's home base (its first developed owned world).
  const pl = state.players[ai];
  if (base && pl) {
    // Keep the lights on first: a bot whose energy/food NET flow is negative (or already
    // in arrears) raises a plant/farm before anything else — brownouts halve its economy.
    const flow = netIncome(state, ai);
    const has = (b: string): boolean =>
      Object.values(state.planets).some(
        (p) => p.owner === ai && p.buildings.some((x) => x.type === b),
      );
    for (const [need, b] of [
      ['energy', 'power_plant'],
      ['food', 'farm'],
    ] as const) {
      if ((flow[need] ?? 0) >= 0 && !(pl.arrears ?? []).includes(need)) continue;
      if (has(b)) continue;
      const cost = data.buildings[b]?.cost ?? {};
      if (Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + 60)) {
        out.push(buildBuilding(ai, base.id, b));
      }
    }
    // Economy chain (self-play M4: mine/refinery/tax office were DEAD content for the
    // bot — it bought all its metal on the market): raise the first missing credit
    // engine at the home base (refinery → tax office), and put a metal mine on each
    // captured PRIZE world — one link at a time, only when comfortably affordable,
    // and never over the same build already queued (no reject spam).
    const pendingBuild = (planetId: string, b: string): boolean =>
      state.scheduled.some((e) => {
        if (e.type !== 'construction.complete') return false;
        const q = e.payload as { kind?: string; planetId?: string; building?: string };
        return q.kind === 'building' && q.planetId === planetId && q.building === b;
      });
    const affordable = (b: string): boolean => {
      const cost = data.buildings[b]?.cost ?? {};
      return Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + 60);
    };
    // ECON-7: fabricator joins the chain — microelectronics gates warships now
    // (cruiser/siege cost micro), so a bot without a fab eventually can't build a
    // fleet. Built once the credit/tax engine is up; keeps micro produced AND spent.
    for (const b of ['refinery', 'tax_office', 'fabricator'] as const) {
      if (has(b)) continue;
      if (affordable(b) && !pendingBuild(base.id, b)) out.push(buildBuilding(ai, base.id, b));
      break; // one link at a time — wait out the current one either way
    }
    for (const p of Object.values(state.planets)) {
      if (p.owner !== ai || p.kind !== 'planet' || p.id === base.id) continue;
      if (p.buildings.some((x) => x.type === 'mine') || pendingBuild(p.id, 'mine')) continue;
      if (!affordable('mine')) break;
      out.push(buildBuilding(ai, p.id, 'mine'));
      break; // spread the economy one world per tick
    }
    // Ship production is CAPPED by the fleet count (self-play M4: endless building
    // fed an ever-growing swarm — hundreds of fleets by mid-match). Enough fleets
    // out ⇒ the metal flows to economy/garrisons instead.
    const aiFleets = Object.values(state.fleets).filter((f) => f.owner === ai).length;
    if (
      aiFleets < (warFooting ? 8 : 4) &&
      (pl.resources.metal ?? 0) > 220 &&
      (pl.resources.credits ?? 0) > 120 &&
      (pl.resources.microelectronics ?? 0) >= 3 // ECON-7: warships need the hi-tech good
    ) {
      out.push(buildUnit(ai, base.id, 'cruiser', 1));
    }
    // Wartime posture (self-play M4: wars were free walk-in raids — the leader had no
    // garrisons, so whoever attacked always came back and won): at war the bot
    // (a) garrisons its undefended PRIZE worlds with militia — a garrisoned planet
    // can't be walk-in captured, it takes a ground assault; the 10-point provinces
    // stay an open raid zone by design; (b) adds fast scouts to the build mix
    // (capture runners for that raid zone); (c) fields more fleets — and a launched
    // fleet lifts home-built militia aboard as landing troops (fleet.launch), which
    // is exactly what lets it assault a garrisoned world back.
    if (warFooting) {
      let garrisonOrders = 0;
      for (const p of Object.values(state.planets)) {
        if (garrisonOrders >= 2 || (pl.resources.metal ?? 0) < 90) break;
        if (p.owner !== ai || p.kind !== 'planet') continue;
        if (p.garrison.some((s) => s.count > 0)) continue;
        out.push(buildUnit(ai, p.id, 'militia', 2));
        garrisonOrders += 1;
      }
      // A landing stock at home: strike groups lift militia on sortie (above), so
      // the base keeps a few spare beyond its seeded defenders.
      const baseMilitia = base.garrison
        .filter((s) => s.unit === 'militia')
        .reduce((n, s) => n + s.count, 0);
      if (baseMilitia < 4 && (pl.resources.metal ?? 0) > 120) {
        out.push(buildUnit(ai, base.id, 'militia', 2));
      }
      if (aiFleets < 8 && (pl.resources.metal ?? 0) > 140) {
        out.push(buildUnit(ai, base.id, 'scout', 1));
      }
    }
    // (marine retired: the AI no longer cheap-builds a ground trooper. Its home keeps its
    //  seeded infantry garrison + orbital-AA building for defence; mobile ground via divisions.)
    const baseHasShip = base.garrison.some((st) => isShipUnit(st.unit));
    if (aiFleets < (warFooting ? 4 : 2) && baseHasShip) out.push(launchFleet(ai, base.id));
  }
  // Trade on the session market: a passive bot liquidates the surplus goods it never
  // uses (food/energy/microelectronics) into the credits it always needs, and — when
  // flush — bids for the metal it burns fastest. One open lot per resource so it doesn't
  // spam. Embargo needs no check here: the book is anonymous and market.take rejects a
  // soured player from filling the bot's lots (botEmbargoes), so the bot simply won't
  // trade with anyone it has soured on.
  if (pl) {
    const lots = state.market ?? [];
    const hasLot = (side: MarketSide, resource: string): boolean =>
      lots.some((l) => l.owner === ai && l.side === side && l.resource === resource);
    for (const good of ['food', 'energy', 'microelectronics']) {
      const have = pl.resources[good] ?? 0;
      const reserve = good === 'microelectronics' ? 40 : 120; // the working stock it keeps
      if (have >= reserve + 40 && !hasLot('sell', good))
        out.push(marketList(ai, 'sell', good, Math.floor((have - reserve) / 2), 2));
    }
    if (
      (pl.resources.metal ?? 0) < 80 &&
      (pl.resources.credits ?? 0) > 300 &&
      !hasLot('buy', 'metal')
    ) {
      out.push(marketList(ai, 'buy', 'metal', 30, 3));
    }
  }
  return out;
}

