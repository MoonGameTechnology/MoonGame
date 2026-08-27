// BAL-1 → BAL-9: все десять стартов равнозначны, но НЕ одинаковы — и то и другое проверяется.
//
// BAL-1. Прежняя карта была квадратной сеткой 11×11, зеркальной по обеим осям. Зеркало
// уравнивает ПРОТИВОПОЛОЖНЫЕ клетки, но не клетки РАЗНОГО РОДА: на квадрате «середина стороны»
// и «угол» структурно различны, сколько их ни отражай. Замер это показал: у `C5R1` в радиусе
// 500 лежало 10 призовых миров, у `C2R1` — 6, и первый выигрывал 77–80% матчей (+62…83% очков).
// Колесо это вылечило: десять секторов по 36°, старт переводится в старт поворотом.
//
// BAL-9. Цена лечения была в том, что секторы стали БУКВАЛЬНО одинаковы — одна решётка, 3–4
// связи у каждого узла, ни одного тупика. Теперь бюджет и рисунок разведены: граф-шаблон
// (а с ним все инварианты старта) общий, геометрия и раскладка рядовых террейнов — свои.
// Поэтому тесты ниже идут ДВУМЯ группами: «равный бюджет» (иначе вернётся стартовый перекос)
// и «хаос на месте» (иначе вернётся плоская карта). Обе группы написаны по замеру: каждая ось
// различия, которую замер не выдержал (типы планет, террейн на несущих узлах), стоит здесь
// отдельным тестом — чтобы её не вернули по невнимательности.
//
// Меряем ПО ГРАФУ, а не по прямой: флот ходит по `links`, поэтому «рядом» — это прыжки, а
// расстояние — длина маршрута в пикселях, а не отрезок между точками.
import { describe, expect, it } from 'vitest';
import { MAP, SECTOR_TYPES, START_CANDIDATES } from './map';
import { data } from './prototypeData';

const byId = new Map(MAP.map((n) => [n.id, n]));
const SECTORS = START_CANDIDATES.length;
/** Узлы сектора `k` — без ступицы `C0R0`, которая общая для всех. */
const sectorNodes = (k: number): typeof MAP =>
  MAP.filter((n) => n.id.startsWith(`C${k}R`) && n.id !== 'C0R0');

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

/** Длины кратчайших МАРШРУТОВ в пикселях (Дейкстра по `links`) — это и есть время полёта. */
function routes(from: string): Map<string, number> {
  const dist = new Map<string, number>([[from, 0]]);
  const done = new Set<string>();
  for (;;) {
    let at: string | null = null;
    let best = Infinity;
    for (const [id, v] of dist) if (!done.has(id) && v < best) [best, at] = [v, id];
    if (at === null) break;
    done.add(at);
    const here = byId.get(at)!;
    for (const next of here.links) {
      const to = byId.get(next)!;
      const via = best + Math.hypot(here.x - to.x, here.y - to.y);
      if (via < (dist.get(next) ?? Infinity)) dist.set(next, via);
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

/** Всё, чем один старт может отличаться от другого ПО ГРАФУ. Совпадение по этому набору и
 *  есть равнозначность: столько же миров на таком же удалении, столько же очков вокруг,
 *  столько же выходов и такой же по числу прыжков ближайший сосед. */
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
    reach3: within(3).length,
    worth3: within(3).reduce((sum, id) => sum + worth(id), 0),
    degree: byId.get(start)!.links.length,
    toNearestRival: Math.min(
      ...START_CANDIDATES.filter((s) => s !== start).map((s) => dist.get(s)!),
    ),
  });
}

/** Разброс значений вокруг среднего — в долях (0.05 = ±5%). */
const spread = (values: number[]): number => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.max(...values.map((v) => Math.abs(v - mean) / mean));
};

describe('BAL-1 — карта не даёт форы ни одному старту', () => {
  it('графовый профиль каждого старта ОДИНАКОВ: миры, очки, выходы, соседи', () => {
    const profiles = START_CANDIDATES.map(profile);
    // Сравниваем со ВСЕМИ, а не с первым по кругу: так падение покажет, какой именно
    // старт выбился, а не «первый не равен второму».
    for (let i = 1; i < profiles.length; i++) {
      expect(profiles[i], `${START_CANDIDATES[i]} против ${START_CANDIDATES[0]}`).toBe(profiles[0]);
    }
  });

  it('владеть своим двором стоит одинаково: сумма маршрутов от старта совпадает', () => {
    // Джиттер геометрии кривит рисунок, но `map.ts` гасит его гомотетией сектора, поэтому
    // суммарная длина путей до своих провинций у всех одна. Допуск — округление координат
    // до целых пикселей.
    const budgets = START_CANDIDATES.map((start, k) => {
      const route = routes(start);
      return sectorNodes(k)
        .filter((n) => n.id !== start)
        .reduce((sum, n) => sum + route.get(n.id)!, 0);
    });
    expect(spread(budgets)).toBeLessThan(0.01);
  });

  it('до ближайшего соперника лететь примерно одинаково', () => {
    // Прыжков до соседа поровну (это ловит профиль выше), но сжатый сектор физически дальше
    // от соседей — держим разброс в узком коридоре, иначе кто-то получит фору по темпу.
    const px = START_CANDIDATES.map((start) => {
      const route = routes(start);
      return Math.min(...START_CANDIDATES.filter((s) => s !== start).map((s) => route.get(s)!));
    });
    expect(spread(px)).toBeLessThan(0.12);
  });

  it('пара нейтральных миров стоит одинаково: ЭФФЕКТИВНЫЙ металл и оборона', () => {
    // Критерий выведен из провала первого захода (BAL-9 → BAL-8). Пары тогда равняли по
    // сумме `productionBonus` и сырому металлу — и пара с формально равной суммой проиграла
    // 258:340. Считать надо `metal × (1 + productionBonus)`: бонус и добыча МНОЖАТСЯ, так что
    // порознь они ничего не гарантируют. Кредиты/энергия/еда в критерий не входят намеренно —
    // пока они ничего не ограничивают (BAL-3), богатство ими преимущества не даёт.
    const kinds = data.planetTypes as Record<
      string,
      { productionBonus: number; defenseBonus: number; baseOutput: Record<string, number> }
    >;
    const pairs = Array.from({ length: SECTORS }, (_, k) =>
      sectorNodes(k)
        .filter((n) => n.sector === 'planet' && n.id !== START_CANDIDATES[k])
        .map((n) => kinds[n.type!]!),
    );
    expect(pairs.every((p) => p.length === 2)).toBe(true);
    // И равняются СЛОТЫ, а не пары: ближний приз (один прыжок) держат весь матч, дальний
    // тупик берут поздно, поэтому «в сумме поровну» не спасает — проверено замером на 900
    // матчах (478 побед против 417 при равных суммах).
    const effectiveMetal = (t: { productionBonus: number; baseOutput: Record<string, number> }) =>
      (t.baseOutput.metal ?? 0) * (1 + t.productionBonus);
    for (const slot of [0, 1]) {
      expect(spread(pairs.map((p) => effectiveMetal(p[slot]!))), `слот ${slot}`).toBeLessThan(0.1);
      expect(
        new Set(pairs.map((p) => p[slot]!.defenseBonus.toFixed(4))).size,
        `оборона слота ${slot}`,
      ).toBe(1);
    }
  });

  it('нейтральные миры несут РАЗНЫЕ типы — карта не однотипна по содержимому', () => {
    // Обратная сторона теста выше: равенство не должно достигаться тем, что у всех один и
    // тот же тип. Если этот тест покраснел, чередование пар молча свернулось обратно.
    const kinds = new Set(
      MAP.filter((n) => n.sector === 'planet' && !START_CANDIDATES.includes(n.id)).map(
        (n) => n.type,
      ),
    );
    expect(kinds.size).toBeGreaterThanOrEqual(4);
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

describe('BAL-9 — карта неровная: тупики, коридоры, разные расстояния', () => {
  it('в каждом секторе есть ТУПИКИ и КОРИДОРЫ, а не сплошные перекрёстки', () => {
    // Плоская решётка давала только степени 3 и 4. Разрешение владельца: связность может
    // быть неоднородной, соседние миры не обязаны быть соединены.
    for (let k = 0; k < SECTORS; k++) {
      const degrees = sectorNodes(k).map((n) => n.links.length);
      expect(degrees.filter((d) => d === 1).length, `тупики в C${k}`).toBe(2);
      expect(degrees.filter((d) => d === 2).length, `коридоры в C${k}`).toBe(2);
      expect(Math.max(...degrees), `перекрёсток в C${k}`).toBe(5);
    }
  });

  it('одна из двух нейтральных планет сектора — ТУПИК с единственным входом', () => {
    for (let k = 0; k < SECTORS; k++) {
      const planets = sectorNodes(k).filter(
        (n) => n.sector === 'planet' && n.id !== START_CANDIDATES[k],
      );
      expect(
        planets.filter((p) => p.links.length === 1),
        `тупиковый мир в C${k}`,
      ).toHaveLength(1);
    }
  });

  it('до ближнего приза у разных стартов РАЗНАЯ дорога — при равном бюджете', () => {
    // Смысл BAL-9: одинаковой должна быть сумма, а не каждое слагаемое. Если этот тест
    // покраснеет, карта снова стала одинаковой — даже если «честной».
    const nearest = START_CANDIDATES.map((start, k) => {
      const route = routes(start);
      return Math.min(
        ...sectorNodes(k)
          .filter((n) => n.sector === 'planet' && n.id !== start)
          .map((n) => route.get(n.id)!),
      );
    });
    expect(Math.max(...nearest) / Math.min(...nearest)).toBeGreaterThan(1.5);
  });

  it('на несущих узлах террейн ЗАКРЕПЛЁН — разъезжаться там нечему', () => {
    // Стыки с соседями, глубинный стык и перекрёсток степени 5 несут маршруты всего сектора,
    // и бонусы скорости/обороны на них расходились по очкам на ±5% в обеих семьях сидов,
    // пока раскладка крутилась целиком. Крутятся только рядовые узлы.
    const carriers = (k: number): string[] => {
      const nodes = sectorNodes(k);
      const byDegree = [...nodes].filter((n) => n.sector !== 'planet');
      const junction = byDegree.find((n) => n.links.length === 5)!;
      const crossings = byDegree.filter((n) =>
        n.links.some((id) => id !== 'C0R0' && !id.startsWith(`C${k}R`)),
      );
      return [junction, ...crossings].map((n) => n.sector).sort();
    };
    const first = carriers(0).join(',');
    for (let k = 1; k < SECTORS; k++) expect(carriers(k).join(','), `несущие C${k}`).toBe(first);
  });

  it('террейны разложены по-разному, но набор у секторов ОДИН', () => {
    const layouts = Array.from({ length: SECTORS }, (_, k) =>
      sectorNodes(k)
        .filter((n) => n.sector !== 'planet')
        .map((n) => n.sector),
    );
    const sorted = layouts.map((l) => [...l].sort().join(','));
    expect(new Set(sorted).size, 'мультимножество террейнов').toBe(1);
    expect(new Set(layouts.map((l) => l.join(','))).size, 'раскладка').toBeGreaterThan(1);
  });

  it('стык соседних секторов — ДВА прохода, а не четыре', () => {
    for (let k = 0; k < SECTORS; k++) {
      const next = (k + 1) % SECTORS;
      const crossing = sectorNodes(k).flatMap((n) =>
        // `C0R0` — ступица, она общая для всех секторов и стыком не считается.
        n.links.filter((id) => id !== 'C0R0' && id.startsWith(`C${next}R`)),
      );
      expect(crossing, `стык C${k}↔C${next}`).toHaveLength(2);
    }
  });
});
