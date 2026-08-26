// BAL-1: все десять стартов карты равнозначны — и это ПРОВЕРЯЕТСЯ, а не декларируется.
//
// Прежняя карта была квадратной сеткой 11×11, зеркальной по обеим осям. Зеркало уравнивает
// ПРОТИВОПОЛОЖНЫЕ клетки, но не клетки РАЗНОГО РОДА: на квадрате «середина стороны» и «угол»
// структурно различны, сколько их ни отражай. Замер это показал: у `C5R1` в радиусе 500
// лежало 10 призовых миров, у `C2R1` — 6, и первый выигрывал 77–80% матчей (+62…83% очков).
//
// Карта-«колесо» лечит это конструкцией: десять секторов по 36° вокруг общей ступицы,
// шаблон сектора один и тот же, повёрнутый на k·36°. Любой старт переводится в любой другой
// поворотом — вместе со всем двором. Тесты ниже меряют это ПО ГРАФУ, а не по прямой: флот
// ходит по `links`, поэтому «рядом» — это прыжки, а не пиксели.
import { describe, expect, it } from 'vitest';
import { MAP, SECTOR_TYPES, START_CANDIDATES } from './map';

const byId = new Map(MAP.map((n) => [n.id, n]));

/** Расстояния в ПРЫЖКАХ от узла до всех достижимых (обход в ширину по `links`). */
function hops(from: string): Map<string, number> {
  const dist = new Map([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of byId.get(cur)!.links) {
      if (dist.has(next)) continue;
      dist.set(next, dist.get(cur)! + 1);
      queue.push(next);
    }
  }
  return dist;
}

/** Территориальная ценность провинции — то же, что считает victory-модуль. */
const worth = (id: string): number => {
  const node = byId.get(id)!;
  if (node.sector === 'planet') return 50;
  return SECTOR_TYPES[node.sector]?.capturable ? 10 : 0;
};

/** Всё, чем один старт может отличаться от другого. Совпадение по этому набору и есть
 *  «равнозначность»: столько же миров на таком же удалении, столько же очков вокруг,
 *  столько же выходов и такой же по дальности ближайший сосед. */
function profile(start: string): string {
  const dist = hops(start);
  const within = (h: number): string[] =>
    [...dist].filter(([, d]) => d > 0 && d <= h).map(([id]) => id);
  const planets = (h: number): number =>
    within(h).filter((id) => byId.get(id)!.sector === 'planet').length;
  return JSON.stringify({
    planets1: planets(1),
    planets2: planets(2),
    planets3: planets(3),
    worth3: within(3).reduce((sum, id) => sum + worth(id), 0),
    degree: byId.get(start)!.links.length,
    toNearestRival: Math.min(
      ...START_CANDIDATES.filter((s) => s !== start).map((s) => dist.get(s)!),
    ),
  });
}

describe('BAL-1 — карта не даёт форы ни одному старту', () => {
  it('профиль каждого старта ОДИНАКОВ: миры, очки, выходы, дистанция до соседа', () => {
    const profiles = START_CANDIDATES.map(profile);
    // Сравниваем со ВСЕМИ, а не с первым по кругу: так падение покажет, какой именно
    // старт выбился, а не «первый не равен второму».
    for (let i = 1; i < profiles.length; i++) {
      expect(profiles[i], `${START_CANDIDATES[i]} против ${START_CANDIDATES[0]}`).toBe(
        profiles[0],
      );
    }
  });

  it('стартов десять — на них стоит формат 5v5', () => {
    expect(START_CANDIDATES).toHaveLength(10);
    expect(new Set(START_CANDIDATES).size).toBe(10);
  });

  it('порядок стартов идёт ПО КРУГУ: +5 — это диаметрально', () => {
    // На это опирается расстановка команд (`TEAM_STARTS`): союзники рядом, соперники
    // напротив. На квадратной сетке «напротив» было приближением, в колесе — буквой.
    const at = (i: number): { x: number; y: number } => byId.get(START_CANDIDATES[i]!)!;
    const hub = { x: 800, y: 800 };
    const angle = (i: number): number => Math.atan2(at(i).y - hub.y, at(i).x - hub.x);
    for (let i = 0; i < 10; i++) {
      const opposite = Math.abs(angle(i) - angle((i + 5) % 10));
      expect(Math.min(opposite, Math.PI * 2 - opposite)).toBeCloseTo(Math.PI, 1);
    }
  });

  it('граф связен — до любой провинции можно долететь', () => {
    expect(hops(START_CANDIDATES[0]!).size).toBe(MAP.length);
  });

  it('доска сохранила состав: 121 провинция, 30 миров, 10 из них стартовые', () => {
    // Числа держат `SCORE_LIMIT` (1100 при ~2410 базовых очках доски) и плотность
    // «три призовых мира на место», с которыми снят весь блок AI-BAL.
    expect(MAP).toHaveLength(121);
    expect(MAP.filter((n) => n.sector === 'planet')).toHaveLength(30);
    expect(START_CANDIDATES.every((id) => byId.get(id)!.sector === 'planet')).toBe(true);
  });
});
