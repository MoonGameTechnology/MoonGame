/**
 * «До и после» для карточки предмета (PVR-6.5): что станет с характеристиками, если надеть
 * модуль или поднять его звезду. Одна функция на подготовку и Мастерскую — чтобы сравнение
 * выглядело одинаково там, где игрок его ждёт.
 *
 * Отдаются только ИЗМЕНИВШИЕСЯ статы, в порядке `order` (порядок экрана), затем прочие по
 * алфавиту: неизменное в сравнении — шум. Нет стата с одной стороны — там 0.
 */
export interface StatDelta {
  key: string;
  before: number;
  after: number;
  diff: number;
}

/** Меньше этого — погрешность плавающей точки (6 × 1.1), а не изменение. */
const EPS = 1e-9;

export function statDeltas(
  before: Readonly<Record<string, number | undefined>>,
  after: Readonly<Record<string, number | undefined>>,
  order: readonly string[] = [],
): StatDelta[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const rank = (k: string): number => {
    const i = order.indexOf(k);
    return i < 0 ? order.length : i;
  };
  return [...keys]
    .map((key) => {
      const b = Number.isFinite(before[key]) ? (before[key] as number) : 0;
      const a = Number.isFinite(after[key]) ? (after[key] as number) : 0;
      return { key, before: b, after: a, diff: a - b };
    })
    .filter((row) => Math.abs(row.diff) > EPS)
    .sort((x, y) => rank(x.key) - rank(y.key) || x.key.localeCompare(y.key));
}
