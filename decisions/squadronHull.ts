import type { GameData, Squadron } from '../packages/shared-core/src/index';

/**
 * Корпус ПОДБИТОЙ машины эскадры в процентах (SHU-5.3) — или `null`, если урона нет.
 *
 * Ядро держит на эскадре не здоровье каждой машины, а ПУЛ недобитого урона
 * (`Squadron.damage`): он меньше корпуса одной машины, и следующий залп досчитывается
 * к нему — набрался корпус, борт сбит. Корпус берётся у ПЕРВОЙ машины, как в ядре
 * (`absorbIntoStrike`), поэтому процент отвечает на вопрос игрока «сколько ещё выдержит
 * подбитый борт». Целой машине процент не рисуется: «100%» у каждого звена — шум.
 */
export function squadronHullPercent(
  sq: Pick<Squadron, 'units' | 'damage'>,
  data: GameData,
): number | null {
  const damage = sq.damage ?? 0;
  if (damage <= 0) return null;
  const first = sq.units.find((st) => st.count > 0);
  if (!first) return null;
  const hull = Math.max(1, data.units[first.unit]?.stats.hp ?? 1);
  const left = 1 - Math.min(damage, hull) / hull;
  // Подбитый — не целый и не сбитый: 99 и 1 — края шкалы, чтобы округление не
  // нарисовало «100%» у подбитого или «0%» у ещё летающего.
  return Math.min(99, Math.max(1, Math.round(left * 100)));
}
