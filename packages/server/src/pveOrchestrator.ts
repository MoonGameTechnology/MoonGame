import { isCapturable, type Action, type GameData, type GameState, type Planet, type PlayerId } from '@void/shared-core';

/**
 * PvE orchestrator (PVE-5.1) — the tactics that make a spawned wave actually GO
 * somewhere. Without it `pveModule` mints fleets at the hive and they sit there:
 * the PvE mode is beatable by flying over and shooting statues.
 *
 * Why it lives on the SERVER and not in a core module (ADR `docs/explanations/05`):
 * NPC tactics are search-and-heuristics, they change often, and they must never be
 * part of the replay contract. So this stays a PURE FUNCTION over `(state, data)`
 * that RETURNS intents — the same shape `prototype/src/ai.ts` `aiOrders` has. The
 * orders then go through `submitServerAction` like any other action: same gate, same
 * reducer, same receipts. The engine never learns that an AI exists.
 *
 * Being pure is not decoration. It means the whole tactic is testable without a room,
 * a socket or a clock, and that a bad heuristic can only ever produce a REJECTED
 * action — never a corrupt state.
 *
 * First-iteration tactic, deliberately crude (the roadmap's «без тактической
 * сложности в первой итерации»): every idle wave flies at the nearest human world,
 * falling back to the nearest neutral one when the humans hold nothing reachable.
 * No retreat, no target priority, no massing — those are the next brick, and the
 * shape here (a list of intents) is what makes adding them cheap.
 */

/** What the caller must supply so the orders carry valid, unique idempotency ids. */
export interface PveOrdersOptions {
  /** Match/session id — the first field of the `session:player:sequence` action id. */
  session: string;
  /** Monotonic counter OWNED BY THE CALLER: two ticks must not mint the same id, or
   *  the room's receipt cache would dedupe the second wave's orders as retries. */
  seq: number;
}

/** Squared Euclidean distance — the comparison never needs the root, and skipping it
 *  keeps the ordering exact instead of float-rounded. */
function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Nearest planet matching `want`, ties broken by id so a replay picks the same one. */
function nearest(
  planets: readonly Planet[],
  from: { x: number; y: number },
  want: (p: Planet) => boolean,
): Planet | undefined {
  let best: Planet | undefined;
  let bestD = Infinity;
  for (const p of planets) {
    if (!want(p)) continue;
    const d = dist2(from, p.position);
    if (d < bestD || (d === bestD && best !== undefined && p.id < best.id)) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/**
 * Orders for the NPC seat of a PvE match. Empty for anything that isn't one — a PvP
 * match has no `state.pve`, so the caller can run this unconditionally.
 *
 * Pure: reads `state`, returns intents, mutates nothing.
 */
export function pveOrders(state: GameState, data: GameData, opts: PveOrdersOptions): Action[] {
  const pve = state.pve;
  if (!pve) return [];
  const npc: PlayerId = pve.npcPlayerId;
  if (state.players[npc]?.status !== 'active') return [];
  if (state.match.status === 'ended') return [];

  const planets = Object.values(state.planets).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const humanHeld = (p: Planet): boolean =>
    p.owner !== null && p.owner !== npc && state.players[p.owner]?.status === 'active';
  const neutral = (p: Planet): boolean => p.owner === null && isCapturable(data, p);

  const out: Action[] = [];
  let seq = opts.seq;
  // Sorted by id: the order of `Object.values` is insertion order, and two hosts that
  // built the same world differently would otherwise mint orders in a different order.
  const fleets = Object.values(state.fleets)
    .filter((f) => f.owner === npc)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const fleet of fleets) {
    // Busy fleets are left alone: one already under way is committed to its leg, and
    // one locked in a battle cannot take a move order anyway (the reducer would reject
    // it — better not to spend an action id on a certain refusal).
    if (fleet.location == null || fleet.movement || fleet.battleId) continue;
    const here = state.planets[fleet.location];
    if (!here) continue;
    const target =
      nearest(planets, here.position, (p) => p.id !== fleet.location && humanHeld(p)) ??
      nearest(planets, here.position, (p) => p.id !== fleet.location && neutral(p));
    if (!target) continue; // nothing worth flying to — hold position
    out.push({
      id: `${opts.session}:${npc}:${seq++}`,
      type: 'fleet.move',
      playerId: npc,
      payload: { fleetId: fleet.id, to: target.id },
      issuedAt: state.time,
    });
  }
  return out;
}
