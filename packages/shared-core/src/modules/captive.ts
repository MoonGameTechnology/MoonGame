/**
 * Пленный главы V — «Голос Единения» (`docs/covenant-of-unity.md`, кирпич PVR-9.5).
 *
 * Карта объявляет убежище проповедника полем провинции `captive: {zone}`; загрузчик заводит
 * `state.captive` (убежище — `hideout`). Ход задания: **штурм убежища → погрузка → доставка
 * на базу**.
 *
 * 1. **Взять живым.** Пленный попадает под охрану, когда убежище взяла наземным штурмом
 *    сторона людей: человек или житель, с которым он на связи по месту встречи и в союзе
 *    ({@link captiveSide}). Не прилёт, не радар и не гибель случайного корабля — захват мира
 *    (`planet.captured`). До погрузки пленный остаётся в захваченном узле.
 * 2. **Погрузка** (`captive.load {fleetId}`): флот стороны стоит у взятого убежища, не в
 *    пути и не в бою, с живым кораблём. Дальше пленный привязан к ОДНОМУ носителю:
 *    разделение оставляет его на исходном флоте, слияние переносит в принимающий.
 * 3. **Доставка.** Носитель прибыл в безопасную зону — задание выполнено, отметка
 *    `deliveredAt` одна на матч.
 * 4. **Потеря.** Убежище взял кто-то вне стороны людей (Рой проповедника не щадит) или мир
 *    уничтожен до погрузки; погиб носитель. Задание провалено, пленный больше не
 *    появляется. Исход главы от него не зависит — вердикт этот модуль не трогает.
 *
 * Повтор событий, слияния и разделения, отмена приказа и загрузка сохранения не
 * создают второго пленного: факт один и лежит в состоянии.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { CaptiveState, GameState, PlayerId } from '../state/gameState';
import { getStance } from '../state/diplomacy';

/**
 * Сторона людей: человеческие места и жители, с которыми они на связи по месту встречи
 * (`missionFacts.contacted` — тот же факт, что пишет `rendezvous` и сеет `contactAtStart`) и
 * в союзе прямо сейчас. Случайный ИИ в союзе сюда не входит. Модули друг друга не
 * импортируют, поэтому связь читается из состояния здесь же.
 */
export function captiveSide(state: GameState): Set<PlayerId> {
  const side = new Set<PlayerId>();
  for (const id of Object.keys(state.players).sort()) {
    const p = state.players[id]!;
    if (p.npc || p.ai) continue;
    side.add(id);
    for (const at of state.missionFacts?.contacted?.[id] ?? []) {
      const ally = state.planets[at]?.rendezvous;
      if (ally && getStance(state, id, ally) === 'alliance') side.add(ally);
    }
  }
  return side;
}

const open = (c: CaptiveState): boolean => c.deliveredAt === undefined && c.lostAt === undefined;

function lose(h: HandlerContext, reason: 'hideout' | 'carrier'): void {
  const c = h.state.captive!;
  c.lostAt = h.ctx.now;
  h.emit('captive.lost', { by: c.takenBy, reason, fleetId: c.carrier, at: c.hideout });
}

export const captiveModule: GameModule = {
  id: 'captive',
  version: '1.0.0',
  setup(api) {
    // Убежище сменило хозяина. Сторона людей — пленный взят (или остаётся у неё, если мир
    // перешёл от одного её участника к другому); кто-то ещё — пленный потерян.
    api.on('planet.captured', (event, h) => {
      const c = h.state.captive;
      const p = event.payload as { planetId?: unknown; owner?: unknown };
      if (!c || !open(c) || c.carrier !== undefined || p.planetId !== c.hideout) return;
      const owner = typeof p.owner === 'string' ? p.owner : null;
      if (owner === null || !captiveSide(h.state).has(owner)) return lose(h, 'hideout');
      if (c.takenBy !== undefined) return;
      c.takenBy = owner;
      c.takenAt = h.ctx.now;
      h.emit('captive.taken', { by: owner, at: c.hideout });
    });

    // Мир уничтожен вместе с пленным (аннигиляция) — только до погрузки.
    api.on('planet.destroyed', (event, h) => {
      const c = h.state.captive;
      const p = event.payload as { planetId?: unknown };
      if (!c || !open(c) || c.carrier !== undefined || p.planetId !== c.hideout) return;
      lose(h, 'hideout');
    });

    api.onAction('captive.load', (action, h) => {
      const { fleetId } = (action.payload ?? {}) as { fleetId?: unknown };
      if (typeof fleetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      const c = h.state.captive;
      if (!c) return h.reject('E_NO_CAPTIVE');
      if (!open(c) || c.carrier !== undefined) return h.reject('E_ALREADY');
      if (c.takenBy === undefined) return h.reject('E_NOT_TAKEN');
      const me = action.playerId;
      const side = captiveSide(h.state);
      if (h.state.players[me]?.status !== 'active' || !side.has(me)) return h.reject('E_FORBIDDEN');
      const fleet = h.state.fleets[fleetId];
      if (!fleet) return h.reject('E_NO_FLEET');
      if (fleet.owner !== me) return h.reject('E_FORBIDDEN');
      if (fleet.movement) return h.reject('E_IN_TRANSIT');
      if (fleet.location !== c.hideout) return h.reject('E_NOT_AT_HIDEOUT');
      if (fleet.battleId) return h.reject('E_IN_BATTLE');
      if (
        !fleet.units.some(
          (u) => u.count > 0 && (u.hp ?? 1) > 0 && h.ctx.data.units[u.unit]?.domain === 'space',
        )
      )
        return h.reject('E_NO_SHIPS');
      const holder = h.state.planets[c.hideout]?.owner ?? null;
      if (holder === null || !side.has(holder)) return h.reject('E_HIDEOUT_HELD');
      c.carrier = fleetId;
      c.loadedAt = h.ctx.now;
      h.emit('captive.loaded', { owner: me, fleetId, at: c.hideout });
    });

    api.on('fleet.merged', (event, h) => {
      const c = h.state.captive;
      const p = event.payload as { from?: unknown; into?: unknown };
      if (!c || !open(c) || typeof p.into !== 'string' || c.carrier !== p.from) return;
      c.carrier = p.into;
    });

    api.on('fleet.destroyed', (event, h) => {
      const c = h.state.captive;
      const p = event.payload as { fleetId?: unknown };
      if (!c || !open(c) || c.carrier === undefined || c.carrier !== p.fleetId) return;
      lose(h, 'carrier');
    });

    // Страховка: носитель исчез без `fleet.destroyed` (например, выбыл его владелец).
    api.on('time.advanced', (_event, h) => {
      const c = h.state.captive;
      if (!c || !open(c) || c.carrier === undefined || h.state.fleets[c.carrier]) return;
      lose(h, 'carrier');
    });

    // Прибытие в безопасную зону — по id из события: флот мог раствориться в том же
    // прибытии (эвакуация снимает опустевший флот на базе `haven`), пленный от этого не
    // пропадает.
    api.on('fleet.arrived', (event, h) => {
      const c = h.state.captive;
      const p = event.payload as { fleetId?: unknown; at?: unknown };
      if (!c || !open(c) || c.carrier === undefined) return;
      if (p.fleetId !== c.carrier || p.at !== c.zone) return;
      c.deliveredAt = h.ctx.now;
      h.emit('captive.delivered', { by: c.takenBy, fleetId: c.carrier, at: c.zone });
    });
  },
};
