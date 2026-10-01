/**
 * Прогноз в окне боя (UIX-6.2) — «чем кончится этот бой для меня», по живому составу.
 *
 * Считает не этот модуль: исход, раунды и доли потерь даёт `previewSides` ядра — тот же
 * движок раундов, что у живого боя. Слова, тон и проценты — карточка прицела «Атаки»
 * (`engageForecast.ts`, UIX-6.1): один прогноз говорит одними словами на обоих экранах.
 *
 * 1. **Прогноз — только у боя ДВУХ сторон, одна из которых моя.** Только там итог один и
 *    только там прогноз ядра разыгрывает тот же раунд, что и бой. На трёх сторонах и
 *    больше бой кончается ПЕРВОЙ гибелью, а выжившие сцепляются заново (цепочка, §0.0 №5
 *    `multiside-combat-roadmap.md`); вдобавок `previewSides` делит ответ обороняющегося
 *    между атакующими, а живой бой отвечает каждому полным залпом (§0.0 №1, уточнение
 *    2026-09-28). Одно число там было бы враньём, поэтому ответ — «прогноза нет». Что
 *    нужно, чтобы досчитать многосторонний бой, записано в кирпиче UIX-6.3.
 * 2. **Меня в бою нет — вердикта нет.** «Победа» и «поражение» бывают только у своей
 *    стороны; чужую схватку окно показывает без прогноза.
 * 3. **Считается от ТЕКУЩЕГО состава.** В стеках боя лежит остаток корпуса (`hp`), и ядро
 *    его читает: прогноз на пятом раунде считается с пятого раунда. Поэтому он и
 *    обновляется каждый раунд без своего таймера: новый раунд — новый состав. Потери —
 *    доля ТЕКУЩЕГО корпуса.
 * 4. **Роль — у стороны.** Обороняющийся отвечает `defense`, перешедший в атаку бьёт
 *    `attack`: тот же бой меняет исход, когда враг нажал «В атаку».
 *
 * Туман — как в UIX-6.1: в прогноз идут только составы, которые окно и так показывает;
 * скрытые бонусы врага (технологии, пассивы, ауры) прогноз не видит (шапка `previewBattle`).
 */
import { previewSides, type GameData, type UnitStack } from '../packages/shared-core/src/index';
import { engageForecastCard, type EngageForecastCard } from './engageForecast';

/** Сторона боя — то, что прогнозу нужно из модели окна. */
export interface ForecastSide {
  mine: boolean;
  role: 'attacker' | 'defender';
  /** Текущий состав: стеки вместе с остатком корпуса (`hp`). */
  units: readonly UnitStack[];
}

export type BattleForecast =
  /** Бой двух сторон, одна из них моя: итог определён (правило 1). */
  | { kind: 'card'; card: EngageForecastCard }
  /** Я в бою, но сторон больше двух: одного итога нет (правило 1). */
  | { kind: 'many' };

const alive = (units: readonly UnitStack[]): boolean => units.some((u) => u.count > 0);

/** Прогноз для игрока, либо `null`: меня в бою нет (правило 2) или бой уже решён. */
export function battleForecast(
  sides: readonly ForecastSide[],
  data: GameData,
): BattleForecast | null {
  const own = sides.findIndex((s) => s.mine);
  if (own < 0 || sides.length < 2) return null;
  if (sides.length > 2) return { kind: 'many' };
  const foe = 1 - own;
  if (!alive(sides[own]!.units) || !alive(sides[foe]!.units)) return null;
  const sim = previewSides(
    sides.map((s) => ({ units: s.units, role: s.role })),
    data,
  );
  const decided = sim.outcome === 'decided';
  const won = decided && alive(sim.sides[own]!.survivors);
  // В карточке прицела «атакующий» — это игрок, какую бы роль ни несла его сторона.
  return {
    kind: 'card',
    card: engageForecastCard({
      outcome: won ? 'attacker' : decided ? 'defender' : 'stalemate',
      roundsEst: sim.roundsEst,
      attacker: sim.sides[own]!,
      defender: sim.sides[foe]!,
    }),
  };
}
