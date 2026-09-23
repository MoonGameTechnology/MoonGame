/**
 * Чем рисовать сеть дорог (ROADS-2, `docs/roads-roadmap.md` §0.3).
 *
 * Дорога между мирами — не прямая: от мира уходят тропы, тропа ветвится на развилке к
 * соседям, переход через границу — точка на общей грани. Сеть выводит ядро
 * (`Planet.roads`); здесь решается только, какими отрезками её нарисовать.
 *
 * 1. **Каждый отрезок — ОДИН раз.** Ствол тропы общий для всех её веток; нарисуй его
 *    для каждой дороги отдельно — полупрозрачный штрих ляжет слоями, и ствол засветится
 *    «магистралью», которой в данных нет (то же правило, что держит `setupMap.ts`).
 * 2. **Каждая провинция рисует СВОЮ половину** — от мира (или развилки) до перехода.
 *    Соседняя дорисует свою до той же точки, поэтому половины сходятся на границе.
 * 3. **Лейн без дороги — прямая.** Состояние, собранное до сети дорог, и временный
 *    коридор героя дорог не имеют; ядро водит по ним флот по прямой, значит и рисуем
 *    прямую — не выдумываем дорогу, которой ядро не знает.
 * 4. **Лейн рисуется, только если оба мира известны** — ссылка в никуда дороги не даёт.
 */

/** Точка в мировых координатах. */
export interface NetPoint {
  x: number;
  y: number;
}

/** Мир глазами рисунка сети: где он, с кем связан и какие у него дороги. */
export interface NetPlanet {
  position: NetPoint;
  links?: readonly string[];
  roads?: {
    crossings: Readonly<Record<string, NetPoint>>;
    trails: ReadonlyArray<{ exits: readonly string[]; fork: NetPoint | null }>;
  };
}

/** Есть ли у лейна дорога с ОБЕИХ сторон — иначе он прямая (правило 3). */
function hasRoad(planets: Readonly<Record<string, NetPlanet>>, a: string, b: string): boolean {
  return !!planets[a]?.roads?.crossings[b] && !!planets[b]?.roads?.crossings[a];
}

/** Отрезки сети в мировых координатах: ломаные, каждый кусок дороги — один раз. */
export function roadStrokes(planets: Readonly<Record<string, NetPlanet>>): NetPoint[][] {
  const out: NetPoint[][] = [];
  for (const id of Object.keys(planets).sort()) {
    const p = planets[id]!;
    const links = new Set(p.links ?? []);
    // Правило 3: прямая — из мира с меньшим id, чтобы лейн лёг один раз.
    for (const n of [...links].sort()) {
      if (n < id || !planets[n] || hasRoad(planets, id, n)) continue;
      out.push([p.position, planets[n]!.position]);
    }
    const roads = p.roads;
    if (!roads) continue;
    for (const trail of roads.trails) {
      const exits = trail.exits.filter(
        (n) => links.has(n) && planets[n] && hasRoad(planets, id, n),
      );
      if (exits.length === 0) continue;
      const hub = trail.fork ?? p.position;
      if (trail.fork) out.push([p.position, trail.fork]); // ствол — один на тропу (правило 1)
      for (const n of exits) out.push([hub, roads.crossings[n]!]); // своя половина (правило 2)
    }
  }
  return out;
}

/** Кусок дороги лейна для попадания пальцем: концы и доли длины дороги, которые он
 *  покрывает. Приказ «встать в точку дороги» живёт долей `t` ДОРОГИ лейна (ядро,
 *  ROADS-2), поэтому попадание в кусок переводится в долю всей дороги, а не отрезка. */
export interface LanePiece {
  from: string;
  to: string;
  a: NetPoint;
  b: NetPoint;
  t0: number;
  t1: number;
}

/** Куски дороги лейна `from`→`to` по её ломаной `road` (мир → … → мир). */
export function lanePieces(from: string, to: string, road: readonly NetPoint[]): LanePiece[] {
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < road.length; i++) {
    const len = Math.hypot(road[i]!.x - road[i - 1]!.x, road[i]!.y - road[i - 1]!.y);
    lens.push(len);
    total += len;
  }
  const out: LanePiece[] = [];
  let run = 0;
  for (let i = 1; i < road.length; i++) {
    const t0 = total > 0 ? run / total : 0;
    run += lens[i - 1]!;
    const t1 = total > 0 ? run / total : 1;
    out.push({ from, to, a: road[i - 1]!, b: road[i]!, t0, t1 });
  }
  return out;
}

/** Доля дороги лейна для попадания в кусок на доле `k` ∈ [0,1] этого куска. */
export function lanePieceT(piece: LanePiece, k: number): number {
  return piece.t0 + (piece.t1 - piece.t0) * k;
}
