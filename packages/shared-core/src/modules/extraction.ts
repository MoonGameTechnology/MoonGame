/**
 * Накопитель архива (глава IV «Архив без ответа», `docs/sector-zero-map-concepts.md` §6.7,
 * кирпич PVR-7.3).
 *
 * Карта объявляет архив полем провинции `vault: {hours, zone}`; загрузчик заводит
 * `state.extraction`. Цепочка:
 *
 * 1. **Извлечение.** Игрок назначает флот, стоящий у архива (`extraction.start {fleetId}`).
 *    Работа идёт, пока назначенный флот стоит там, не в бою, а архив не у врага (владелец —
 *    сам игрок, его союзник или никто: станцию надо очистить). Вынужденный уход ставит её
 *    на паузу, а не обнуляет; до получения можно назначить другой флот — сделанное
 *    сохраняется (§6.7).
 * 2. **Носитель.** Готовый накопитель едет на ОДНОМ флоте (`carrier`). Разделение оставляет
 *    его на исходном флоте (он сохраняет id), слияние переносит в принимающий — пакет не
 *    копируется и не теряется ни одной операцией с флотом.
 * 3. **Доставка.** Носитель прибыл в зону вывода, и игрок уже установил связь с союзником
 *    (`missionFacts.contacted`, §6.7: «победа — после связи и доставки»). Прибыл раньше
 *    связи — доставка засчитывается в миг контакта, если носитель всё ещё в зоне.
 * 4. **Потеря.** Носитель уничтожен — поражение главы (резолюция владельца 2026-09-27).
 *
 * Вердикт выносит `victoryModule` по `extraction.delivered`/`extraction.lost`; там же волны и
 * удержание перестают выигрывать, пока в мире есть архив. Модули встречаются на шине по имени
 * события, импорта друг друга нет.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { GameState, PlayerId } from '../state/gameState';
import { hoursToMs } from '../action/types';
import { getStance } from '../state/diplomacy';

/** Сколько мс работы нужно на извлечение (часы карты под темп матча). */
export function extractionNeedMs(
  state: Pick<GameState, 'extraction'>,
  ctx: Parameters<typeof hoursToMs>[0],
): number {
  return state.extraction ? hoursToMs(ctx, state.extraction.hours) : 0;
}

/** Идёт ли работа прямо сейчас: назначенный флот стоит у очищенного архива и не в бою. */
export function extractionRunning(state: GameState): boolean {
  const ex = state.extraction;
  if (!ex || ex.carrier !== undefined || ex.fleetId === undefined || ex.owner === undefined)
    return false;
  const fleet = state.fleets[ex.fleetId];
  if (!fleet || fleet.owner !== ex.owner || fleet.location !== ex.vault || fleet.movement)
    return false;
  if (fleet.battleId) return false;
  return vaultClear(state, ex.owner);
}

/** Архив не у врага: свой, союзный или ничей. */
function vaultClear(state: GameState, player: PlayerId): boolean {
  const owner = state.planets[state.extraction!.vault]?.owner ?? null;
  return owner === null || getStance(state, player, owner) === 'alliance';
}

function contacted(state: GameState, player: PlayerId): boolean {
  return (state.missionFacts?.contacted?.[player]?.length ?? 0) > 0;
}

function deliver(h: HandlerContext): void {
  const ex = h.state.extraction!;
  ex.deliveredAt = h.ctx.now;
  h.emit('extraction.delivered', { owner: ex.owner, fleetId: ex.carrier, at: ex.zone });
}

export const extractionModule: GameModule = {
  id: 'extraction',
  version: '1.0.0',
  setup(api) {
    api.onAction('extraction.start', (action, h) => {
      const { fleetId } = (action.payload ?? {}) as { fleetId?: unknown };
      if (typeof fleetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      const ex = h.state.extraction;
      if (!ex) return h.reject('E_NO_VAULT');
      const player = h.state.players[action.playerId];
      if (!player || player.npc || player.status !== 'active') return h.reject('E_FORBIDDEN');
      if (ex.carrier !== undefined || ex.deliveredAt !== undefined || ex.lostAt !== undefined)
        return h.reject('E_ALREADY');
      const fleet = h.state.fleets[fleetId];
      if (!fleet) return h.reject('E_NO_FLEET');
      if (fleet.owner !== action.playerId) return h.reject('E_FORBIDDEN');
      if (fleet.movement) return h.reject('E_IN_TRANSIT');
      if (fleet.location !== ex.vault) return h.reject('E_NOT_AT_VAULT');
      if (fleet.battleId) return h.reject('E_IN_BATTLE');
      if (
        !fleet.units.some(
          (u) => u.count > 0 && (u.hp ?? 1) > 0 && h.ctx.data.units[u.unit]?.domain === 'space',
        )
      )
        return h.reject('E_NO_SHIPS');
      if (!vaultClear(h.state, action.playerId)) return h.reject('E_VAULT_HELD');
      if (ex.fleetId === fleetId && ex.owner === action.playerId) return h.reject('E_ALREADY');
      ex.fleetId = fleetId;
      ex.owner = action.playerId;
      h.emit('extraction.started', { owner: action.playerId, fleetId, at: ex.vault });
    });

    // Работа копится по отрезкам времени: внутри отрезка мир не меняется, поэтому условие,
    // верное сейчас, верно на всём отрезке. Готовность — точным мигом внутри отрезка.
    api.on('time.advanced', (event, h) => {
      const ex = h.state.extraction;
      if (!ex || ex.deliveredAt !== undefined || ex.lostAt !== undefined) return;
      if (ex.carrier !== undefined) {
        // Страховка: носитель исчез без `fleet.destroyed` (например, выбыл владелец).
        if (!h.state.fleets[ex.carrier]) {
          ex.lostAt = h.ctx.now;
          h.emit('extraction.lost', { owner: ex.owner, fleetId: ex.carrier });
        }
        return;
      }
      if (!extractionRunning(h.state)) return;
      const { from, to } = event.payload as { from: number; to: number };
      const need = extractionNeedMs(h.state, h.ctx);
      const left = need - ex.doneMs;
      const span = Math.max(0, to - from);
      if (span < left) {
        ex.doneMs += span;
        return;
      }
      ex.doneMs = need;
      ex.carrier = ex.fleetId;
      ex.extractedAt = from + left;
      h.emit('extraction.completed', { owner: ex.owner, fleetId: ex.carrier, at: ex.vault });
    });

    api.on('fleet.merged', (event, h) => {
      const ex = h.state.extraction;
      const p = event.payload as { from?: unknown; into?: unknown };
      if (!ex || typeof p.from !== 'string' || typeof p.into !== 'string') return;
      if (ex.carrier === p.from) ex.carrier = p.into;
      else if (ex.carrier === undefined && ex.fleetId === p.from) ex.fleetId = p.into;
    });

    api.on('fleet.destroyed', (event, h) => {
      const ex = h.state.extraction;
      const p = event.payload as { fleetId?: unknown };
      if (!ex || ex.carrier === undefined || ex.carrier !== p.fleetId) return;
      if (ex.deliveredAt !== undefined || ex.lostAt !== undefined) return;
      ex.lostAt = h.ctx.now;
      h.emit('extraction.lost', { owner: ex.owner, fleetId: ex.carrier });
    });

    // Прибытие в зону вывода — по id из события: флот мог уже раствориться в том же
    // прибытии (эвакуация снимает опустевший флот в убежище), пакет от этого не пропадает.
    api.on('fleet.arrived', (event, h) => {
      const ex = h.state.extraction;
      const p = event.payload as { fleetId?: unknown; at?: unknown };
      if (!ex || ex.carrier === undefined || p.fleetId !== ex.carrier || p.at !== ex.zone) return;
      if (ex.deliveredAt !== undefined || ex.lostAt !== undefined) return;
      if (!ex.owner || !contacted(h.state, ex.owner)) return;
      deliver(h);
    });

    // Носитель ждёт в зоне, а связь установили позже — доставка в миг контакта.
    api.on('ally.contact', (event, h) => {
      const ex = h.state.extraction;
      const p = event.payload as { owner?: unknown };
      if (!ex || ex.carrier === undefined || p.owner !== ex.owner) return;
      if (ex.deliveredAt !== undefined || ex.lostAt !== undefined) return;
      const fleet = h.state.fleets[ex.carrier];
      if (fleet && fleet.location === ex.zone && !fleet.movement) deliver(h);
    });
  },
};
