/**
 * Модули кораблей со СВОЕЙ механикой (фаза 3 `docs/ship-modules-roadmap.md`).
 *
 * Модуль корабля обычно даёт прибавку к стату, и её читает тот, кто стат считает
 * (`effectiveStats`). Этот модуль ядра — для тех, у кого прибавка меняет не число корпуса,
 * а правило игры: стат носителя здесь вливается в чужой хук. Своего состояния у модуля
 * нет, прямых связей с соседями тоже — только хуки (инвариант #3). Нет носителя — хук
 * возвращает базу как есть, и партия идёт бит-в-бит как прежде.
 *
 * Действует ЛУЧШИЙ носитель (`bestFleetStat`), а не сумма: два одинаковых модуля механику
 * не удваивают.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import { bestFleetStat } from '../util/loadout';
import { isAllied } from '../util/combat';

/** SM-3.1 «Тяговый луч»: прибавка к цене отступления (`combat.retreatToll`), доля единицы. */
export const RETREAT_PULL_STAT = 'retreatPull';
/** SM-3.2 «Сборщик обломков»: прибавка к доле трофеев (`salvage.share`), доля единицы. */
export const SALVAGE_BONUS_STAT = 'salvageBonus';

/** Лучший `stat` среди флотов `owner`, стоящих на узле `node`. */
function bestAt(h: HandlerContext, owner: string, node: string, stat: string): number {
  let best = 0;
  for (const f of Object.values(h.state.fleets)) {
    if (f.owner !== owner || f.location !== node) continue;
    const v = bestFleetStat(f.units, stat, h.ctx.data);
    if (v > best) best = v;
  }
  return best;
}

export const loadoutEffectsModule: GameModule = {
  id: 'loadoutEffects',
  version: '1.0.0',
  setup(api) {
    // SM-3.1. Отступающий из боя флот платит дороже, если среди ВРАЖДЕБНЫХ ему сторон
    // этого боя есть корабль с тяговым лучом. Считаются только стороны, что ещё в бою:
    // носитель, отступивший раньше, из списка сторон уже ушёл. Союзник и сам отступающий
    // не цепляют. Потолок доли держит `combat.ts` (`RETREAT_TOLL_MAX`).
    api.hook<number>('combat.retreatToll', (base, args, h) => {
      const { fleetId, battleId } = (args ?? {}) as { fleetId?: unknown; battleId?: unknown };
      if (typeof fleetId !== 'string' || typeof battleId !== 'string') return base;
      const battle = h.state.battles[battleId];
      const me = h.state.fleets[fleetId];
      if (!battle || !me) return base;
      let pull = 0;
      for (const side of battle.sides) {
        if (side.ref.kind !== 'fleet' || side.ref.fleetId === fleetId) continue;
        const f = h.state.fleets[side.ref.fleetId];
        if (!f || f.owner === me.owner || isAllied(h, f.owner, me.owner)) continue;
        const v = bestFleetStat(f.units, RETREAT_PULL_STAT, h.ctx.data);
        if (v > pull) pull = v;
      }
      return pull > 0 ? base + pull : base;
    });

    // SM-3.2. Доля трофеев победителя растёт, если на поле боя стоял его корабль со
    // сборщиком. Прибавка СКЛАДЫВАЕТСЯ с базой, как у героя (EVT-3): база — сама доля (5%).
    // Участие не считаем отдельно: узел боя и есть поле, на котором флот дрался. Погибший
    // носитель на узле уже не стоит и прибавки не даёт — сборщик собирает, пока цел.
    api.hook<number>('salvage.share', (base, args, h) => {
      const { playerId, location } = (args ?? {}) as { playerId?: unknown; location?: unknown };
      if (typeof playerId !== 'string' || typeof location !== 'string') return base;
      const bonus = bestAt(h, playerId, location, SALVAGE_BONUS_STAT);
      return bonus > 0 ? base + bonus : base;
    });
  },
};
