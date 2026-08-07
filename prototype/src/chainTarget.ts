/**
 * Куда ложится тап в режиме «Приказ» и что это за точка (REFM-66).
 *
 * Режим строит план ПО ТОЧКАМ карты, поэтому правила прицеливания здесь СВОИ — не те,
 * что у обычного выделения (`tapCycle.ts`).
 *
 * 1. **Мир приоритетнее флота — наоборот к обычному выделению.** У вражеского мира
 *    почти всегда стоит его же флот. Победи флот, меню точки давало бы только «Огонь»,
 *    а штурм самого мира стал бы недостижим тапом.
 * 2. **Огонь по флоту остаётся** — для тех флотов, у которых узла под пальцем нет: в
 *    пути, на лейне, на чужой орбите поодаль.
 * 3. **Тип точки решает ВЛАДЕЛЕЦ, а не тип сектора.** Свой мир — своя точка, чужой —
 *    вражеская, ничей — нейтральная; меню собирается по этому виду.
 * 4. **«Домой» — ближайший свой мир, но не тот же самый.** Иначе «домой» из своего же
 *    мира значило бы «остаться», и жест молча не делал бы ничего.
 * 5. **Своих миров нет — «Домой» недоступен**, а не «куда-нибудь»: пункт меню обязан
 *    погаснуть, а не увести флот в случайную точку.
 */
import type { ChainPointKind } from './chainPlanner';

/** Точка плана: что под пальцем и какого она вида. */
export interface ChainTarget {
  id: string;
  kind: ChainPointKind;
}

/** Мир глазами планировщика: свой / вражеский / ничей (правило 3). */
export function chainPointKind(owner: string | null | undefined, me: string): ChainPointKind {
  if (owner == null) return 'neutral';
  return owner === me ? 'own' : 'enemy';
}

/**
 * Что забирает тап: мир под пальцем, иначе вражеский флот, иначе ничего (правила 1–2).
 * Пустой тап (`null`) — это «закрыть меню», а не «оставить как было».
 */
export function chainTapTarget(
  world: { id: string; owner: string | null } | null,
  foeFleetId: string | null,
  me: string,
): ChainTarget | null {
  if (world) return { id: world.id, kind: chainPointKind(world.owner, me) };
  if (foeFleetId) return { id: foeFleetId, kind: 'fleet' };
  return null;
}

/** Мир для поиска ближайшего дома. */
export interface WorldPoint {
  id: string;
  owner: string | null;
  x: number;
  y: number;
}

/**
 * «Домой»: ближайший СВОЙ мир, кроме точки отсчёта (правила 4–5). Точки отсчёта нет
 * среди миров или своих миров нет вовсе → `null`, и пункт меню гаснет.
 */
export function nearestOwnWorld(
  fromId: string,
  worlds: readonly WorldPoint[],
  me: string,
): string | null {
  const from = worlds.find((w) => w.id === fromId);
  if (!from) return null;
  let best: string | null = null;
  let bd = Infinity;
  for (const w of worlds) {
    if (w.owner !== me || w.id === fromId) continue;
    const d = Math.hypot(w.x - from.x, w.y - from.y);
    if (d < bd) {
      bd = d;
      best = w.id;
    }
  }
  return best;
}
