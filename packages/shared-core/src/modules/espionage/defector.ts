import { hoursToMs } from '../../action/types';
import type { HandlerContext, ModuleSetupApi } from '../../kernel/module';
import type { SpyOffer } from '../../state/gameState';
import { enlistDefector, findSpy, finiteOr } from '../../util/spyLife';

/**
 * Defectors (owner's resolution 2026-11-11): an enemy agent the catcher's bureau turns
 * (SPY-18) does not join on its own — it asks to. The catcher hears `espionage.defector`
 * and answers within `DEFECTOR_HOURS`:
 *  - `espionage.defector.accept` — it becomes one of the catcher's spies for good, on top
 *    of the network, with the experience it brought (`Spy.defector`); its place is not
 *    refilled when it is lost;
 *  - `espionage.defector.refuse` — it flees: gone for good, it does not go back to its old
 *    master either. Unanswered, it flees when the time is up.
 * For its old master the agent is dead from the moment it is turned, whatever the answer:
 * the lost-agent events say `agentTurned`, and its slot waits for the recruit as for a death.
 */

/** How long a turned agent waits for the catcher's answer, game-hours. */
export const DEFECTOR_HOURS = 24;
/** At most this many defectors wait for one player at once; a turn past it just kills. */
export const MAX_SPY_OFFERS = 4;
/** A defector is not taken in past this many spies in the registry (fail-secure: state must
 *  not grow without limit, and order payloads name spies up to 64). */
export const MAX_ROSTER = 16;

/**
 * SPY-18: an agent the catcher's bureau would kill may be turned instead — the
 * `espionage.turn` pipeline over the catcher's strongest `spyTurnChance` (`base`; 0 without
 * a bureau that turns). For the spy the agent is lost all the same; the catcher is asked to
 * take it in. The roll is drawn only for a killed agent with a chance above zero, so a match
 * without such a bureau keeps its RNG stream; with `MAX_SPY_OFFERS` already waiting, the
 * agent is simply killed.
 */
export function turnAgent(
  h: HandlerContext,
  a: { victim: string; spy: string; spyId: number; planetId: string; kind: string },
  base: number,
): boolean {
  const raw = h.hook<number>('espionage.turn', base, {
    playerId: a.spy,
    target: a.victim,
    kind: a.kind,
  });
  const chance = Math.min(1, Math.max(0, finiteOr(raw, base)));
  if (chance <= 0 || h.rng.nextFloat() >= chance) return false;
  if ((h.state.spyOffers?.[a.victim]?.length ?? 0) >= MAX_SPY_OFFERS) return false;
  offerDefector(h, a.victim, a.spy, a.spyId, a.planetId, a.kind);
  return true;
}

/** The turned agent `spyId` of `from`, caught on `planetId` at `kind`, asks to join `catcher`. */
function offerDefector(
  h: HandlerContext,
  catcher: string,
  from: string,
  spyId: number,
  planetId: string,
  kind: string,
): void {
  const list = ((h.state.spyOffers ??= {})[catcher] ??= []);
  const xp = findSpy(h.state, from, spyId)?.xp;
  const offer: SpyOffer = {
    id: Math.max(0, ...list.map((o) => o.id)) + 1,
    from,
    planetId,
    kind,
    ...(xp ? { xp } : {}),
    at: h.ctx.now,
    until: h.ctx.now + hoursToMs(h.ctx, DEFECTOR_HOURS),
  };
  list.push(offer);
  h.emit('espionage.defector', {
    owner: catcher,
    offerId: offer.id,
    from,
    planetId,
    kind,
    until: offer.until,
  });
}

/** Take `offer` off `owner`'s list. */
function drop(h: HandlerContext, owner: string, offer: SpyOffer): void {
  const rest = h.state.spyOffers![owner]!.filter((o) => o !== offer);
  if (rest.length > 0) h.state.spyOffers![owner] = rest;
  else delete h.state.spyOffers![owner];
  if (Object.keys(h.state.spyOffers!).length === 0) delete h.state.spyOffers;
}

/** Defectors left unanswered by world-time `to` flee. */
function expireOffers(h: HandlerContext, to: number): void {
  const all = h.state.spyOffers;
  if (!all) return;
  for (const owner of Object.keys(all).sort()) {
    for (const offer of all[owner]!.filter((o) => o.until <= to)) {
      drop(h, owner, offer);
      h.emit('espionage.defector.fled', {
        owner,
        offerId: offer.id,
        from: offer.from,
        expired: true,
      });
    }
  }
}

/** The open offer an answer names, or a refusal code. */
function offerOf(
  h: HandlerContext,
  owner: string,
  payload: unknown,
): SpyOffer | 'E_BAD_PAYLOAD' | 'E_BAD_TARGET' {
  const { offerId } = (payload ?? {}) as { offerId?: unknown };
  if (typeof offerId !== 'number' || !Number.isInteger(offerId)) return 'E_BAD_PAYLOAD';
  return h.state.spyOffers?.[owner]?.find((o) => o.id === offerId) ?? 'E_BAD_TARGET';
}

/** The catcher's two answers, and the flight of the unanswered as time advances. */
export function registerDefectorActions(api: ModuleSetupApi): void {
  api.on('time.advanced', (event, h) => expireOffers(h, (event.payload as { to: number }).to));

  api.onAction('espionage.defector.accept', (action, h) => {
    const owner = action.playerId;
    const offer = offerOf(h, owner, action.payload);
    if (typeof offer === 'string') return h.reject(offer);
    if ((h.state.spies?.[owner]?.length ?? 0) >= MAX_ROSTER) return h.reject('E_BAD_TARGET');
    drop(h, owner, offer);
    const spy = enlistDefector(h, owner, offer.from, offer.xp);
    h.emit('espionage.defector.joined', {
      owner,
      offerId: offer.id,
      from: offer.from,
      spyId: spy.id,
    });
  });

  api.onAction('espionage.defector.refuse', (action, h) => {
    const owner = action.playerId;
    const offer = offerOf(h, owner, action.payload);
    if (typeof offer === 'string') return h.reject(offer);
    drop(h, owner, offer);
    h.emit('espionage.defector.fled', { owner, offerId: offer.id, from: offer.from });
  });
}
