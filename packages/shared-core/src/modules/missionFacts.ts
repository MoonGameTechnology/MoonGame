/**
 * Память фактов для задач забега (заказ владельца 2026-09-24: маяк «N часов подряд»,
 * спасательная операция «провал, если гарнизон пал», эвакуация «довести транспорты»).
 *
 * Задачи — чистые предикаты над состоянием (`decisions/missionObjectives.ts`), и почти
 * всё, что они спрашивают, в состоянии уже лежит. Три вопроса из одного кадра не
 * прочесть — ответ требует ПАМЯТИ, и её держит этот модуль:
 *
 * 1. **С какого момента провинция в этих руках** (`held`) — ставится на каждом захвате
 *    (`planet.captured`). Нет записи — провинция не переходила из рук в руки с начала
 *    матча. Отсюда «удерживать N часов подряд»: потеря и перезахват начинают счёт заново,
 *    а закончившаяся серия остаётся в `longest` — выполненное не отменяется потерей после.
 * 2. **Какие миры игрок терял** (`fallen`) — захват у прежнего владельца. Только растёт:
 *    «гарнизон пал» — это событие, отбить мир назад его не отменяет.
 * 3. **Сколько беженцев доставлено** (`evacuated`) — флот, прибывший в СВОЮ провинцию
 *    с признаком `haven` (убежище), высаживает юниты с признаком `evacuee`: они уходят
 *    из флота в счёт игрока. Опустевший флот удаляется.
 *
 * Модуль ничего не знает о задачах: он пишет общие факты, а какая задача их читает,
 * решают данные карты. Нет задач — факты копятся и никому не мешают (правило «нет
 * модуля → база, а не падение» здесь в обратную сторону: нет читателя → нет эффекта).
 */
import type { GameModule } from '../kernel/module';
import type { HandlerContext } from '../kernel/module';
import type { MissionFacts } from '../state/gameState';

/** Признак провинции-убежища: сюда доводят беженцев. */
export const HAVEN_TRAIT = 'haven';
/** Признак юнита-беженца: транспорт с людьми, которого доводят до убежища. */
export const EVACUEE_TRAIT = 'evacuee';

function facts(h: HandlerContext): MissionFacts {
  return (h.state.missionFacts ??= {});
}

export const missionFactsModule: GameModule = {
  id: 'missionFacts',
  version: '1.0.0',
  setup(api) {
    api.on('planet.captured', (event, h) => {
      const p = event.payload as { planetId?: unknown; owner?: unknown; from?: unknown };
      if (typeof p.planetId !== 'string' || typeof p.owner !== 'string') return;
      const f = facts(h);
      // Серия прежнего держателя закончилась — запомнить, если она длиннейшая.
      const was = f.held?.[p.planetId];
      if (was && was.owner !== p.owner) {
        const streaks = ((f.longest ??= {})[p.planetId] ??= {});
        streaks[was.owner] = Math.max(streaks[was.owner] ?? 0, h.ctx.now - was.since);
      }
      (f.held ??= {})[p.planetId] = { owner: p.owner, since: h.ctx.now };
      if (typeof p.from === 'string' && p.from !== p.owner) {
        const lost = ((f.fallen ??= {})[p.from] ??= []);
        if (!lost.includes(p.planetId)) lost.push(p.planetId);
      }
    });

    api.on('fleet.arrived', (event, h) => {
      const p = event.payload as { fleetId?: unknown; at?: unknown };
      if (typeof p.fleetId !== 'string' || typeof p.at !== 'string') return;
      const fleet = h.state.fleets[p.fleetId];
      const planet = h.state.planets[p.at];
      if (!fleet || !planet || planet.owner !== fleet.owner) return;
      if (!planet.traits.includes(HAVEN_TRAIT)) return;
      const evacuee = (unit: string): boolean =>
        h.ctx.data.units[unit]?.traits.includes(EVACUEE_TRAIT) ?? false;
      let delivered = 0;
      for (const stack of fleet.units) if (evacuee(stack.unit)) delivered += stack.count;
      if (delivered <= 0) return;
      fleet.units = fleet.units.filter((stack) => !evacuee(stack.unit));
      const f = facts(h);
      (f.evacuated ??= {})[fleet.owner] = (f.evacuated[fleet.owner] ?? 0) + delivered;
      h.emit('evac.delivered', { owner: fleet.owner, at: p.at, count: delivered });
      if (fleet.units.length === 0 && (fleet.landing ?? []).length === 0)
        delete h.state.fleets[fleet.id];
    });
  },
};
