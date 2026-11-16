/**
 * Раскладка дерева технологий на экране: ряды по глубине внутри ветки и вид значка узла.
 *
 * Ряд узла — его глубина ВНУТРИ ветки: предок из другой ветки узел вниз не двигает, иначе
 * ветка «Шаттлы» начиналась бы с пустого ряда под чужим предком. В ряду узлы стоят по
 * среднему месту своих предков в ряду выше (барицентр): так связи почти не пересекаются.
 * Первый ряд и равные места держат порядок входа — сортировку задаёт вызывающий.
 *
 * Значок узла выводится из данных (что открывает, что усиливает), а не из таблицы по id:
 * новая технология получает значок сама, без правки клиента.
 */

/** Ряды дерева сверху вниз; в каждом ряду — id узлов в порядке показа. */
export function techDepthRows(
  ids: readonly string[],
  prereqsOf: (id: string) => readonly string[],
): string[][] {
  const inSet = new Set(ids);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    // Кольцо в данных невозможно (их проверяет ядро), но обход не должен из-за него зависнуть.
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parents = prereqsOf(id).filter((p) => inSet.has(p));
    const d = parents.length ? 1 + Math.max(...parents.map(depthOf)) : 0;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  const rows: string[][] = [];
  ids.forEach((id) => (rows[depthOf(id)] ??= []).push(id));
  const order = new Map(ids.map((id, i) => [id, i]));
  const pos = new Map<string, number>();
  const dense = rows.filter((r) => r !== undefined);
  dense.forEach((row, ri) => {
    const key = (id: string): number => {
      const ps = prereqsOf(id).filter((p) => pos.has(p));
      return ps.length ? ps.reduce((a, p) => a + pos.get(p)!, 0) / ps.length : -1;
    };
    if (ri > 0) row.sort((a, b) => key(a) - key(b) || order.get(a)! - order.get(b)!);
    row.forEach((id, i) => pos.set(id, i));
  });
  return dense;
}

/** Вид значка узла. Картинки к видам рисует клиент. */
export type TechIconKind =
  | 'moon'
  | 'rocket'
  | 'troop'
  | 'craft'
  | 'hero'
  | 'ship'
  | 'shield'
  | 'bld'
  | 'flag'
  | 'prod'
  | 'dmg'
  | 'radar'
  | 'speed'
  | 'coin'
  | 'star';

/** Что из технологии нужно значку: то же, что лежит в `data/technologies.json`. */
export interface TechIconSource {
  readonly branch?: string;
  readonly effects?: Readonly<Record<string, number>>;
  readonly unlocks?: {
    readonly units?: readonly string[];
    readonly buildings?: readonly string[];
    readonly abilities?: readonly string[];
  };
}

/** Значок узла: сначала то, что он открывает, потом главный эффект. */
export function techIconKind(td: TechIconSource): TechIconKind {
  if (td.unlocks?.abilities?.length) return 'moon';
  const unit = td.unlocks?.units?.[0];
  if (unit) {
    if (/missile|rocket/.test(unit)) return 'rocket';
    if (/militia|infantry|tank|special|drop|trooper/.test(unit)) return 'troop';
    if (unit === 'hero') return 'hero';
    if (/interceptor|bomber|striker|landing|carrier/.test(unit) || td.branch === 'shuttle') return 'craft';
    return 'ship';
  }
  const buildings = td.unlocks?.buildings ?? [];
  if (buildings.length)
    return /aa|shield|fort|defen[cs]e|bastion|battery/.test(buildings.join(' ')) ? 'shield' : 'bld';
  const fx = td.effects ?? {};
  if (fx.heroSlots) return 'hero';
  if (fx.controlLimit) return 'flag';
  if (fx.productionBonus) return 'prod';
  if (fx.combatDamageBonus) return 'dmg';
  if (fx.radarRangeBonus) return 'radar';
  if (fx.fleetSpeedBonus) return 'speed';
  if (fx.armyUpkeep) return 'coin';
  return 'star';
}
