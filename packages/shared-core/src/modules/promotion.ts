import type { GameModule } from '../kernel/module';
import type { GameState, UnitStack } from '../state/gameState';
import { sideUnits } from '../util/combat';
import { findHealthyStack } from '../util/stacks';

/**
 * СЛУЧАЙНЫЙ ПРОМОУШЕН (PERK-3.2): изредка построенная партия выходит «отмеченной», и её
 * прибавка идёт ПОСЛЕДОВАТЕЛЬНЫМ множителем — не тонет в сумме массовых процентов, а
 * множится поверх неё. Заказ владельца: «некоторые единицы с определённой вероятностью
 * получают бонус».
 *
 * ⚠️ ЧТО ЗДЕСЬ НЕ БУКВАЛЬНО ПО КИРПИЧУ, и это согласовано (владелец 2026-09-24).
 * Кирпич говорил «бонус ПЕРЕВОДИТ прибавку юнита из параллельной корзины в
 * последовательную». Переводить нечего: после PERK-1.2 в параллельной корзине лежат
 * бонусы ИГРОКА (техи, фракция) и ПОЗИЦИИ (аура) — поюнитной процентной прибавки нет ни
 * одной (модули корабля дают очки к стату, а не проценты, и входят в базу залпа до
 * всякого хука). Поэтому промоушен ВЫДАЁТ свой множитель, а не отнимает чужой. Эффект
 * для игрока тот же, о котором предупреждал кирпич: бонус, стоящий в последовательной
 * группе один, стоит почти всю свою величину.
 *
 * БРОСОК — ОДИН НА ВЫПОЛНЕННЫЙ ЗАКАЗ, а не на корабль и не на попадание. «Прочный
 * видимый момент» из кирпича — это событие постройки: попадание игроку невидимо, а
 * каждый бросок ложится в поток RNG и в реплей. Один заказ = один `rng.chance`, и вся
 * партия выходит отмеченной или обычной целиком.
 *
 * ПОРЯДОК В МАНИФЕСТЕ ЗНАЧИМ: модуль обязан стоять ПЕРЕД `autoRally`. Оба слушают
 * `unit.built`, и авто-сбор уносит свежие корабли из гарнизона во флот; отметить надо
 * до переезда. Сам переезд отметку теперь копирует (`addUnits(..., stack)`, правило
 * VET-2 «сплит копирует») — без этого корабль терял бы её в ту же секунду.
 */

/** Средняя отметка НА ЮНИТ у набора стеков. Развеска по головам — как у выслуги
 *  (PERK-3.1) и по той же причине: отметка хранится долей на юнит, поэтому среднее по
 *  головам И ЕСТЬ доля отмеченных в этих силах. */
function promotedShare(stacks: readonly UnitStack[]): { units: number; marked: number } {
  let units = 0;
  let marked = 0;
  for (const stack of stacks) {
    units += stack.count;
    marked += stack.count * (stack.promoted ?? 0);
  }
  return { units, marked };
}

/**
 * Силы, которые сейчас стреляют, — по тому, что канал о себе сообщил.
 *
 * Два пути, и оба живые. `battleId` несёт только `combatModule`, зато он покрывает и
 * наземную фазу: стороной боя бывает гарнизон, десант и плацдарм, а не только флот.
 * `attackerFleet` несут остальные каналы (обстрел с орбиты, перехват, удар челноков,
 * ответка, ПВО корабля) — там боя нет, но флот есть. Отметка принадлежит КОРАБЛЮ, а не
 * бою, поэтому работать она обязана в обоих случаях: промоушен, пропадающий на
 * бомбардировке, игрок прочитал бы как баг.
 */
function firingUnits(
  state: GameState,
  args: { battleId?: string; attacker?: string | null; attackerFleet?: string },
): UnitStack[] {
  const { battleId, attacker, attackerFleet } = args;
  if (battleId !== undefined && attacker !== undefined && attacker !== null) {
    const battle = state.battles[battleId];
    if (battle) {
      const out: UnitStack[] = [];
      // Владельца может представлять несколько сторон (совместный штурм, MSB-4).
      // Порядок обхода — порядок массива `sides`, то есть детерминированный.
      for (const side of battle.sides) {
        if (side.owner !== attacker) continue;
        const stacks = sideUnits(state, side.ref);
        if (stacks) out.push(...stacks);
      }
      return out;
    }
  }
  return attackerFleet !== undefined ? (state.fleets[attackerFleet]?.units ?? []) : [];
}

export const promotionModule: GameModule = {
  id: 'promotion',
  version: '1.0.0',
  setup(api) {
    api.on('unit.built', (event, h) => {
      const chance = h.ctx.data.promotion.chance;
      if (chance <= 0) return; // механика выключена данными — бросок не делается вовсе
      const p = event.payload as {
        planetId?: string;
        unit?: string;
        count?: number;
        owner?: string;
        modules?: unknown;
      };
      if (typeof p?.planetId !== 'string' || typeof p?.unit !== 'string') return;
      const count = p.count ?? 0;
      if (count <= 0) return;
      const planet = h.state.planets[p.planetId];
      if (!planet) return;
      const mods = Array.isArray(p.modules)
        ? p.modules.filter((m): m is string => typeof m === 'string')
        : undefined;
      // Тот же поиск по лоадауту, что у `addUnits`: заказ с другим фиттингом лежит в
      // своём стеке, и отметить надо именно построенный.
      const stack = findHealthyStack(planet.garrison, p.unit, mods);
      if (!stack || stack.count <= 0) return;
      // Бросок ПОСЛЕ всех отказов выше: иначе поток RNG зависел бы от того, нашёлся ли
      // стек, и реплей разошёлся бы на ровном месте.
      if (!h.rng.chance(chance)) return;
      // Заказ мог влиться в уже стоявший стек — тогда отмечена только его свежая часть,
      // и доля считается по весу, как при любом слиянии (VET-2).
      const already = (stack.promoted ?? 0) * Math.max(0, stack.count - count);
      stack.promoted = (already + count) / stack.count;
    });

    api.hook<number>('combat.damage', (damage, args, h) => {
      const bonus = h.ctx.data.promotion.damageBonus;
      if (bonus <= 0) return damage;
      const { units, marked } = promotedShare(
        firingUnits(h.state, args as Parameters<typeof firingUnits>[1]),
      );
      if (units <= 0 || marked <= 0) return damage;
      return damage * (1 + bonus * (marked / units));
    });
  },
};
