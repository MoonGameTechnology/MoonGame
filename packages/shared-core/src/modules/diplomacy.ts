import type { GameModule } from '../kernel/module';
import type { DiplomaticStance } from '../state/gameState';
import {
  clearMapShareOffers,
  clearOffers,
  getOffer,
  getStance,
  hasMapShare,
  hasMapShareOffer,
  isBotPair,
  offerInvolves,
  setMapShare,
  setMapShareOffer,
  setOffer,
  setStance,
  stanceToRelation,
  type DiplomacyCapability,
} from '../state/diplomacy';

/** Hostility rank of a stance — the axis declarations move along. Higher = more
 *  hostile. Unilateral declarations may only move a pair UP this axis (toward
 *  war); moving down (toward peace / pact / alliance) needs the other side's
 *  consent, because the map is symmetric — otherwise a player under attack could
 *  declare `peace` mid-war and unilaterally switch the enemy's combat off. */
const HOSTILITY: Record<DiplomaticStance, number> = {
  alliance: 0,
  pact: 1,
  peace: 2,
  war: 3,
};

function isStance(value: unknown): value is DiplomaticStance {
  return value === 'war' || value === 'peace' || value === 'pact' || value === 'alliance';
}

/**
 * Diplomacy — declarations (D2) + the consent protocol (D3). Builds on the D1
 * state primitives (`state/diplomacy.ts`), all through one action:
 *
 *  - `diplomacy.declare { target, stance }` toward MORE hostile — unilateral:
 *    the stance flips at once (declaring war never needs consent) and any
 *    standing offers between the pair are voided (a war declaration ends the
 *    negotiation). Emits `diplomacy.changed { a, b, stance, from }`.
 *  - `diplomacy.declare` toward FRIENDLIER — mutual: the first declaration
 *    records a standing OFFER (stance unchanged, `diplomacy.offered` emitted,
 *    visible only to the two parties); when the other side declares the SAME
 *    stance, the pair commits — stance flips, offers clear, `diplomacy.changed`
 *    fires. An invariant falls out: a standing offer is always strictly
 *    friendlier than the pair's current stance (commits and escalations clear).
 *  - provides the `diplomacy` capability (`getRelation`: stance → hostile /
 *    neutral / ally) that combat's `isHostile` consults; without this module
 *    combat falls back to reading the stance directly — same behaviour, so the
 *    module degrades gracefully (invariant #3).
 */
export const diplomacyModule: GameModule = {
  id: 'diplomacy',
  version: '1.1.0',
  setup(api) {
    api.provideCapability<DiplomacyCapability>('diplomacy', {
      getRelation: (state, a, b) => stanceToRelation(getStance(state, a, b)),
    });

    api.onAction('diplomacy.declare', (action, h) => {
      const { target, stance } = action.payload as { target?: unknown; stance?: unknown };
      if (typeof target !== 'string' || target === action.playerId || !isStance(stance)) {
        return h.reject('E_BAD_PAYLOAD');
      }
      // A defeated seat is out of the game politically too (mirrors espionage):
      // it can neither declare nor be declared upon — otherwise eliminated
      // players stay full diplomatic actors and offers to the dead hang forever.
      const actor = h.state.players[action.playerId];
      if (!actor || actor.status !== 'active') {
        return h.reject('E_FORBIDDEN');
      }
      // The player roster is public (every projection keeps ids/names), so an
      // unknown-target reject leaks nothing fog-hidden (A06).
      const victim = h.state.players[target];
      if (!victim || victim.status !== 'active') {
        return h.reject('E_NO_PLAYER');
      }
      const me = action.playerId;
      const from = getStance(h.state, me, target);
      if (stance === from) {
        return h.reject('E_SAME_STANCE');
      }

      if (HOSTILITY[stance] > HOSTILITY[from]) {
        // Escalation — unilateral, and it ends any negotiation in flight.
        clearOffers(h.state, me, target);
        // MAPSHARE-1: война рвёт договор об обмене картами вместе с переговорами о нём.
        // Делиться разведкой и пускать войска к тому, кому только что объявил войну, —
        // противоречие, и держать такой договор значило бы отдавать врагу свою карту.
        if (stance === 'war') {
          setMapShare(h.state, me, target, false);
          clearMapShareOffers(h.state, me, target);
        }
        setStance(h.state, me, target, stance);
        h.emit('diplomacy.changed', { a: me, b: target, stance, from });
        return;
      }

      // A coalition is between humans only (GDD §3): an alliance-ward declaration
      // involving an AI seat is refused outright — it must neither stand as an
      // offer nor commit. Peace and a pact with a bot remain legal.
      if (stance === 'alliance' && isBotPair(h.state, me, target)) {
        return h.reject('E_BOT_ALLIANCE');
      }
      // De-escalation — the consent protocol (D3): commit on a matching
      // counter-offer, otherwise record/replace this side's standing offer.
      if (getOffer(h.state, target, me) === stance) {
        clearOffers(h.state, me, target);
        setStance(h.state, me, target, stance);
        h.emit('diplomacy.changed', { a: me, b: target, stance, from });
        return;
      }
      if (getOffer(h.state, me, target) === stance) {
        return h.reject('E_ALREADY_OFFERED'); // this exact offer already stands
      }
      setOffer(h.state, me, target, stance);
      h.emit('diplomacy.offered', { from: me, to: target, stance });
    });

    /**
     * MAPSHARE-1 — `diplomacy.mapshare { target, on }`: договор об ОБМЕНЕ КАРТАМИ.
     *
     * Отдельное соглашение поверх лестницы стоек, а не её ступень: заключается и при
     * мире, и при пакте, даёт ровно два права (общая разведка + чужой десант на свою
     * землю) и НЕ делает участников союзниками ни в бою, ни в зачёте коалиции.
     *
     * Заключение — по ВЗАИМНОМУ согласию, тем же протоколом, что смягчение стойки:
     * первое `on:true` кладёт предложение, встречное — коммитит. Иначе игрок мог бы
     * односторонне открыть себе чужую карту и высадку на чужую землю.
     * Расторжение — ОДНОСТОРОННЕЕ (`on:false`): удерживать в договоре против воли
     * нельзя, и это же делает войну чистой (война рвёт договор сама, см. эскалацию).
     */
    api.onAction('diplomacy.mapshare', (action, h) => {
      const { target, on } = action.payload as { target?: unknown; on?: unknown };
      if (typeof target !== 'string' || target === action.playerId || typeof on !== 'boolean') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const actor = h.state.players[action.playerId];
      if (!actor || actor.status !== 'active') {
        return h.reject('E_FORBIDDEN');
      }
      const victim = h.state.players[target];
      if (!victim || victim.status !== 'active') {
        return h.reject('E_NO_PLAYER');
      }
      const me = action.playerId;

      if (!on) {
        // Расторжение (или отзыв своего предложения) — всегда одностороннее.
        if (!hasMapShare(h.state, me, target) && !hasMapShareOffer(h.state, me, target)) {
          return h.reject('E_NO_MAPSHARE');
        }
        setMapShare(h.state, me, target, false);
        clearMapShareOffers(h.state, me, target);
        h.emit('diplomacy.mapshare.changed', { a: me, b: target, on: false });
        return;
      }

      if (hasMapShare(h.state, me, target)) {
        return h.reject('E_ALREADY_SHARED');
      }
      // С тем, с кем идёт война, договориться нельзя: эскалация такой договор рвёт,
      // так что заключить его при войне значило бы завести заведомо противоречивое
      // состояние. Сначала мир — потом карты.
      if (getStance(h.state, me, target) === 'war') {
        return h.reject('E_FORBIDDEN');
      }
      if (hasMapShareOffer(h.state, target, me)) {
        clearMapShareOffers(h.state, me, target);
        setMapShare(h.state, me, target, true);
        h.emit('diplomacy.mapshare.changed', { a: me, b: target, on: true });
        return;
      }
      if (hasMapShareOffer(h.state, me, target)) {
        return h.reject('E_ALREADY_OFFERED');
      }
      setMapShareOffer(h.state, me, target);
      h.emit('diplomacy.mapshare.offered', { from: me, to: target });
    });

    // An eliminated player can never counter-declare, so their standing offers
    // (sent OR received) would hang in state and in the counterparty's view
    // forever — sweep them the moment the player falls.
    api.on('player.eliminated', (event, h) => {
      const playerId = (event.payload as { playerId?: string })?.playerId;
      if (typeof playerId !== 'string') return;
      const offers = h.state.diplomacyOffers;
      if (offers) {
        for (const key of Object.keys(offers)) {
          if (offerInvolves(key, playerId)) delete offers[key];
        }
        if (Object.keys(offers).length === 0) delete h.state.diplomacyOffers;
      }
      // MAPSHARE-1: то же самое для обмена картами — и предложения, и сами договоры.
      // Договор выбывшего иначе продолжал бы светить его картой (а живой участник —
      // держать право высадки на землю, у которой больше нет хозяина-переговорщика).
      const mapOffers = h.state.mapShareOffers;
      if (mapOffers) {
        for (const key of Object.keys(mapOffers)) {
          if (offerInvolves(key, playerId)) delete mapOffers[key];
        }
        if (Object.keys(mapOffers).length === 0) delete h.state.mapShareOffers;
      }
      const shares = h.state.mapShares;
      if (shares) {
        for (const id of Object.keys(h.state.players)) {
          if (id !== playerId) setMapShare(h.state, playerId, id, false);
        }
      }
    });
  },
};
