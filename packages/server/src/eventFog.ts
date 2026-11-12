/**
 * Event fog: which domain events one player may read (FOG-14/15). Fog of war is a server
 * boundary for events as much as for state — an event leaks intent — so `MatchRoom`
 * filters every broadcast batch through `eventVisibleTo` per player and strips
 * server-only telemetry with `redactEvent`. Pure: no room, no clock, no I/O.
 * `eventFogContract.test.ts` holds every core emitter to the keys read here.
 */
import type { DomainEvent, GameState, PlayerId } from '@void/shared-core';

/** Events that are intel, not news: they reach the player they belong to and nobody else,
 *  even at a world the observer identifies. Each entry names the payload key that carries
 *  that player — modules call it `owner` or `playerId`, and `eventFogContract.test.ts` holds
 *  every emitter to the key written here.
 *
 *  · Construction and production (RECAP-FOG: the `own` class of `prototype/src/recapGate.ts`,
 *    FOG-14). What an owner built, upgraded, produced or dropped from a loading order, an
 *    observer of the world learns from its fogged state (the building, the garrison), never
 *    as news: the client already hides a foreign one, so the server does not send it either.
 *  · Orders, plans and private knowledge (FOG-15). The fog projection strips these from a
 *    rival even at an identified world, so an event must not retell them: a build order
 *    queued, started, cancelled, resumed or dropped (`buildQueue`, `pausedConstruction`,
 *    `scheduled`), a capital designation (the hero-respawn anchor), a steward hold point, a
 *    mine laid (a rival's mine is seen only up close, SM-3.6), a salvage payout (a rival's
 *    treasury), a merge waiting for a fleet still in flight (that fleet may be out of sight)
 *    and a refuge found (what a rival knows, PVR-8.4).
 *  · A fleet halted at a closed border (FOG-LEAK): it names the owner of a world its owner
 *    may not see, so it is the halted fleet's owner's news alone. */
export const OWNER_ONLY_EVENTS: ReadonlyMap<string, 'owner' | 'playerId'> = new Map<
  string,
  'owner' | 'playerId'
>([
  ['building.constructed', 'owner'],
  ['building.upgraded', 'owner'],
  ['building.repair.started', 'owner'],
  ['station.repair.started', 'owner'],
  ['unit.built', 'owner'],
  ['army.load.cancelled', 'owner'],
  ['army.unload.cancelled', 'owner'],
  ['construction.queued', 'playerId'],
  ['construction.started', 'playerId'],
  ['construction.cancelled', 'playerId'],
  ['construction.resumed', 'playerId'],
  ['construction.queue.dropped', 'playerId'],
  ['capital.designated', 'owner'],
  ['steward.holdpoint', 'playerId'],
  ['mines.laid', 'owner'],
  ['salvage.paid', 'playerId'],
  ['fleet.merge.pending', 'owner'],
  ['refuge.found', 'owner'],
  ['fleet.halted', 'owner'],
  // Espionage (SPY-8): every event names its world (`planetId`), and anyone who sees that
  // world must still not read who spied on it, nor the victim the thief's success.
  ['espionage.sent', 'owner'],
  ['espionage.aborted', 'owner'],
  ['espionage.failed', 'owner'],
  ['intel.stolen', 'owner'],
  // SPY-13: a posted recon agent digging deeper, or caught on post.
  ['intel.deepened', 'owner'],
  ['intel.lost', 'owner'],
  ['espionage.succeeded', 'owner'],
  ['espionage.posted', 'owner'],
  ['espionage.recalled', 'owner'],
  ['espionage.counter.caught', 'owner'],
  ['espionage.counter.lost', 'owner'],
  ['espionage.detected', 'owner'],
  // SPY-23: a named spy's way — where it is says whom it spies on.
  ['espionage.started', 'owner'],
  ['espionage.arrived', 'owner'],
  ['espionage.waiting', 'owner'],
  ['espionage.home', 'owner'],
  ['espionage.cancelled', 'owner'],
  ['espionage.caught', 'owner'],
  ['espionage.recruited', 'owner'],
  ['espionage.defector', 'owner'],
  ['espionage.defector.joined', 'owner'],
  ['espionage.defector.fled', 'owner'],
]);

/** Events every player of the match receives, wherever they happen — public news. The
 *  emitting module keeps the payload to what is public: `espionage.exposed` (SPY-16) names
 *  the two players and the world, never the operation. */
export const PUBLIC_EVENTS: ReadonlySet<string> = new Set(['espionage.exposed']);

/** Whether a domain event may be revealed to `playerId` — events leak intent
 *  too, so they pass the same fog as state: your own actions, anything at a
 *  world you identify, and global clock/match events; everything else is cut.
 *  Hero events and intel (`OWNER_ONLY_EVENTS`: construction, production, orders and
 *  plans) reach their owner only, even at an identified world.
 *
 *  ⚠ CONVENTION COUPLING: this filter reads the payload KEY NAMES every core
 *  module uses today (audience: `owner`/`playerId`/`a`/`b`/`from`/`to`/
 *  `buyer`/`seller`; place: `location`/`planetId`/`at`; ownership: `fleetId`;
 *  battle: `battleId`)
 *  — documented in docs/modulesystem.md («События и фог»). A new module that
 *  names its addressee differently (`target`, `recipient`, …) will have its
 *  events silently HIDDEN from that player (fail-closed, never a leak) until
 *  the key is added here. Name payload keys by the convention — or extend the
 *  lists below together with a test in matchRoom.test.ts. */
export function eventVisibleTo(
  event: DomainEvent,
  playerId: PlayerId,
  identify: Set<string>,
  battles: ReadonlySet<string>,
  fleets: GameState['fleets'],
): boolean {
  if (event.type === 'career.casualty') return false;
  if (event.type === 'time.advanced' || event.type.startsWith('match.')) return true;
  if (PUBLIC_EVENTS.has(event.type)) return true;
  const p = (event.payload ?? {}) as Record<string, unknown>;
  // Hero events are strictly owner-only: their payloads carry the hero's node
  // (`at`) and fleet, which the fog projection deliberately hides from everyone
  // else — an identified-node match must NOT reveal them.
  if (event.type.startsWith('hero.')) return p.owner === playerId;
  // Intel events: owner-only too, for the same reason. Each names its player under its
  // own key (OWNER_ONLY_EVENTS).
  const ownerKey = OWNER_ONLY_EVENTS.get(event.type);
  if (ownerKey !== undefined) return p[ownerKey] === playerId;
  if (p.owner === playerId) return true;
  // Personal and bilateral events name their audience with these keys (research,
  // steward, elimination, diplomacy offers/changes, market trades) — a named
  // participant always sees their own event.
  for (const key of ['playerId', 'a', 'b', 'from', 'to', 'buyer', 'seller'] as const) {
    if (p[key] === playerId) return true;
  }
  for (const key of ['location', 'planetId', 'at'] as const) {
    const node = p[key];
    if (typeof node === 'string' && identify.has(node)) return true;
  }
  const fleetId = p.fleetId;
  if (typeof fleetId === 'string' && fleets[fleetId]?.owner === playerId) {
    return true;
  }
  // A battle's events reach whoever sees that battle in their fog view. Its own sides
  // always do (`engagementOf`): a fight mid-lane, far from any identified world, used
  // to stop the player's fleet without a single word about why.
  const battleId = p.battleId;
  if (typeof battleId === 'string' && battles.has(battleId)) return true;
  return false;
}

/** Career telemetry is server-only: even a visible casualty (`unit.died`) must not reveal
 *  an opponent's hidden loadout value (`lossCost`) or otherwise hidden contributors
 *  (`damageShares`). Every other event passes as it is. */
export function redactEvent(event: DomainEvent): DomainEvent {
  if (event.type !== 'unit.died' || !event.payload || typeof event.payload !== 'object')
    return event;
  const payload = { ...event.payload } as Record<string, unknown>;
  delete payload.lossCost;
  delete payload.damageShares;
  return { ...event, payload };
}
