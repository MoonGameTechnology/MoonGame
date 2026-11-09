/**
 * СКОЛЬКО РАКЕТ ПУСТИТЬ ПО ФЛОТУ (missiles-roadmap, шаг ботов).
 *
 * Ракета самонаводящаяся и бьёт наверняка, пока цель не ушла за дальность, поэтому залп
 * считается по корпусу цели: столько боеголовок, чтобы снять весь её запас прочности, и
 * одна сверху на ПВО цели. Ракеты, которые уже летят в эту цель, вычитаются: бот ходит
 * чаще, чем ракета долетает, и без этого добивал бы один флот залпом за залпом.
 */
export interface SalvoInput {
  /** Запас прочности цели: сумма корпусов её кораблей. */
  targetHp: number;
  /** Урон одной боеголовки. */
  warhead: number;
  /** Своих ракет, уже летящих в эту цель. */
  incoming: number;
  /** Ракет в эскадре на базе. */
  available: number;
  /** Предел залпа одним приказом (`MISSILE_SALVO` ядра). */
  max: number;
}

/** Размер залпа; 0 — пускать не нужно или нечем. */
export function missileSalvoSize(o: SalvoInput): number {
  if (!(o.warhead > 0) || !(o.targetHp > 0)) return 0;
  const need = Math.ceil(o.targetHp / o.warhead) + 1 - o.incoming;
  return Math.max(0, Math.min(o.available, o.max, need));
}
