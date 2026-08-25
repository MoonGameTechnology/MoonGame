/**
 * Bot diplomacy — the favour meter reacts to a player's aggression. Bots are
 * passive-friendly (never start a war to expand); this module lowers favour on
 * wrongs, declares war back only at rock bottom, and mends favour in peace.
 * Extracted from `game.ts` (REFP-11): depends on `botFavour` (REFP-6) + the core
 * diplomacy helpers + `timeScaleOf`/`DAY`. `game.ts` imports `botDiplomacyModule`
 * for `MODULES`.
 */
import type {
  GameModule,
  GameState,
  MarketEmbargoCapability,
} from '../../packages/shared-core/src/index';
import {
  clearOffers,
  getStance,
  setStance,
  timeScaleOf,
  type DiplomaticStance,
} from '../../packages/shared-core/src/index';
import {
  FAVOUR_BASE,
  FAVOUR_EMBARGO,
  FAVOUR_WAR,
  FAVOUR_PEACE_ACCEPT,
  FAVOUR_PACT_ACCEPT,
  FAVOUR_WAR_DECLARED_HIT,
  FAVOUR_SPY_CAUGHT_HIT,
  FAVOUR_WAR_DECAY_PER_DAY,
  FAVOUR_HEAL_PER_DAY,
  botFavour,
  botEmbargoes,
} from './botFavour';

/** Minimal view of the prototype's state extension for the approval meter. */
interface ApprovalState extends GameState {
  approval?: Record<string, Record<string, number>>;
}

const DAY = 24 * 3_600_000;

export const botDiplomacyModule: GameModule = {
  id: 'bot-diplomacy',
  version: '0.1.0',
  setup(api) {
    // CONV-9: рынок ядра спрашивает эмбарго через капабилити, а не лезет в чужое
    // состояние. Владелец правила — этот модуль: счётчик расположения ботов живёт
    // здесь. Хост без него (канонический сервер) получает базовый ответ «эмбарго нет».
    api.provideCapability<MarketEmbargoCapability>('market.embargo', {
      embargoed: (state, a, b) => botEmbargoes(state, a, b),
    });

    // A bot ANSWERS negotiations by the favour meter: an offered peace/pact from a
    // seat it doesn't resent is accepted on the spot (the bot files the matching
    // declaration — the same consent path a human would take); a soured bot turns
    // it down and the offer is wiped so the seat can retry once favour recovers —
    // only humans may leave an offer pending. Alliances stay human-only
    // (E_BOT_ALLIANCE upstream).
    api.on('diplomacy.offered', (event, h) => {
      const { from, to, stance } = event.payload as {
        from: string;
        to: string;
        stance: DiplomaticStance;
      };
      const meter = (h.state as ApprovalState).approval?.[to];
      if (!meter || meter[from] === undefined) return; // `to` isn't a tracked bot vs `from`
      const need =
        stance === 'peace' ? FAVOUR_PEACE_ACCEPT : stance === 'pact' ? FAVOUR_PACT_ACCEPT : null;
      if (need !== null && botFavour(h.state, to, from) >= need) {
        clearOffers(h.state, to, from);
        setStance(h.state, to, from, stance);
        h.emit('diplomacy.changed', { a: to, b: from, stance });
        return;
      }
      clearOffers(h.state, from, to);
      h.emit('diplomacy.declined', { from, to, stance });
    });
    // A seat declaring WAR on a bot sours that bot's favour toward the declarer.
    api.on('diplomacy.changed', (event, h) => {
      const { a, b, stance } = event.payload as { a: string; b: string; stance: DiplomaticStance };
      if (stance !== 'war') return;
      const meter = (h.state as ApprovalState).approval?.[b];
      if (!meter || meter[a] === undefined) return; // b isn't a tracked bot vs a
      meter[a] = Math.max(0, meter[a]! - FAVOUR_WAR_DECLARED_HIT);
    });
    // Counter-int fallout (SPY-2): a bot that catches a spy red-handed (failed
    // attempt, identity burned — the event carries `spy`) sours toward the sender.
    // An anonymous leak (detected clean theft) blames nobody — no favour change.
    api.on('espionage.detected', (event, h) => {
      const { owner, spy } = event.payload as { owner: string; spy?: string };
      if (!spy) return;
      const meter = (h.state as ApprovalState).approval?.[owner];
      if (!meter || meter[spy] === undefined) return; // the victim isn't a tracked bot
      meter[spy] = Math.max(0, meter[spy]! - FAVOUR_SPY_CAUGHT_HIT);
    });
    // An eliminated seat leaves the favour ledger entirely: its own meter dies with
    // it, and no surviving bot keeps tracking (or later declaring on) a corpse —
    // the same sweep diplomacy does for standing offers (BF-33).
    api.on('player.eliminated', (event, h) => {
      const playerId = (event.payload as { playerId?: string })?.playerId;
      const approval = (h.state as ApprovalState).approval;
      if (typeof playerId !== 'string' || !approval) return;
      delete approval[playerId];
      for (const meter of Object.values(approval)) delete meter[playerId];
    });
    // Per span: sustained war erodes favour, peace mends it; a bottomed-out meter makes
    // the bot commit to war (once), then vents so it won't thrash war/peace every tick.
    api.on('time.advanced', (event, h) => {
      const { from, to } = event.payload as { from: number; to: number };
      const span = to - from;
      if (span <= 0) return;
      const days = (span * timeScaleOf(h.ctx)) / DAY;
      const approval = (h.state as ApprovalState).approval;
      if (!approval) return;
      for (const bot of Object.keys(approval)) {
        // Elimination marks the seat 'defeated' (the record STAYS) — a dead bot
        // must not keep venting favour or declare war from the grave (BF-33).
        if (h.state.players[bot]?.status !== 'active') continue;
        const meter = approval[bot]!;
        for (const player of Object.keys(meter)) {
          if (h.state.players[player]?.status !== 'active') continue; // no grudges vs the dead
          const atWar = getStance(h.state, bot, player) === 'war';
          meter[player] = atWar
            ? Math.max(0, meter[player]! - FAVOUR_WAR_DECAY_PER_DAY * days)
            : Math.min(FAVOUR_BASE, meter[player]! + FAVOUR_HEAL_PER_DAY * days);
          if (meter[player]! < FAVOUR_WAR && !atWar) {
            setStance(h.state, bot, player, 'war');
            meter[player] = FAVOUR_EMBARGO; // vent: hostile now, but above the war line
            h.emit('diplomacy.changed', { a: bot, b: player, stance: 'war' });
          }
        }
      }
    });
  },
};