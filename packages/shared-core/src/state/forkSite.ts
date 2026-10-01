import type { FleetEdge, ForkAnchor, GameState, Planet, PlanetId, RoadPoint } from './gameState';
import { forkTAtStart, laneRoad } from './roads';

/**
 * ПЛОЩАДКА КРЕПОСТИ НА РАЗВИЛКЕ (FORT-6.1, решение владельца 2026-09-29).
 *
 * «Это и есть та же крепость. Только появляется новая точка постройки»: космическую
 * крепость можно поставить не только на свою провинцию, но и на РАЗВИЛКУ дороги в ней —
 * на ромб, где тропа расходится к соседям (ROADS-3/4). Крепость там та же — ядро,
 * постройки, орудия, — а вот место другое, и из этого следует всё остальное:
 *
 *  - развилка — точка ДОРОГИ, а не провинция. Узла у неё нет, поэтому крепость получает
 *    собственный узел-площадку в точке развилки: у построек должен быть дом, а дом у
 *    построек в этой игре один — `Planet.buildings`. Узел этот не провинция: ни лейнов,
 *    ни клетки мозаики, ни захвата, ни счёта территории — только место, где стоит
 *    сооружение (вид `fork_station` в данных);
 *  - орудия стоят НА САМОЙ развилке, то есть на дороге, а не на площадке: развилка видит
 *    все дороги своей тропы, и стоящий на ней ловит каждого, кто по ним идёт (засада
 *    ROADS-3). Крепость на развилке — засада, которая не уходит;
 *  - крепость принадлежит тому, кто её поставил, а не хозяину провинции: провинцию
 *    захватили — крепость осталась у строителя («по своей сущности это космический
 *    юнит»). Захвачена должна быть провинция только В МОМЕНТ постройки;
 *  - гибель орудий гасит крепость, и развилка снова свободна. Площадка остаётся на месте
 *    пустой (без хозяина и построек): так у неё один id на всю партию, и туман, и память
 *    клиента видят «здесь была крепость», а не исчезнувший узел.
 *
 * Здесь — только чистые правила места: где площадка, чья это развилка, где стоят орудия.
 * Постройку, орудия и гибель ведёт `station` — модуль, который и так ведёт крепость.
 */

/** Id площадки — ДЕТЕРМИНИРОВАННЫЙ, по развилке: одна развилка — одна площадка, и «есть ли
 *  здесь крепость» — поиск по ключу, а не перебор. Без `:` намеренно: клиент режет свои
 *  составные ключи по двоеточию (`dossiers.ts`), и id узла внутри такого ключа ломал бы разбор. */
export function forkSiteId(province: PlanetId, trail: number): PlanetId {
  return `fork-${province}-${trail}`;
}

/** Узел — площадка крепости на развилке, а не провинция. */
export function isForkSite(planet: Pick<Planet, 'fork'> | undefined): boolean {
  return planet?.fork !== undefined;
}

/** Точка развилки: где тропа `trail` провинции `province` расходится к соседям. Null —
 *  такой тропы нет или она не ветвится (развилки нет — нет и места под крепость). */
export function forkPoint(state: GameState, anchor: ForkAnchor): RoadPoint | null {
  return state.planets[anchor.province]?.roads?.trails[anchor.trail]?.fork ?? null;
}

/**
 * Где стоят ОРУДИЯ крепости на развилке: на дороге от провинции к первому соседу тропы, в
 * точке развилки. Развилка — общий излом всех дорог тропы, поэтому любая из них годится, а
 * первая по порядку тропы делает выбор детерминированным. Null — развилки нет или дорога к
 * соседу не идёт через неё (лейн без дороги): поставить орудия «на развилку» тогда некуда.
 */
export function forkSiteEdge(state: GameState, anchor: ForkAnchor): FleetEdge | null {
  if (!forkPoint(state, anchor)) return null;
  const trail = state.planets[anchor.province]?.roads?.trails[anchor.trail];
  for (const exit of trail?.exits ?? []) {
    const road = laneRoad(state, anchor.province, exit);
    if (!road || road.length < 3) continue;
    const t = forkTAtStart(state, anchor.province, exit);
    if (t > 0 && t < 1) return { from: anchor.province, to: exit, t };
  }
  return null;
}

/**
 * Идёт ли бой У ПЛОЩАДКИ: орудия стоят на дороге (`forkSiteEdge`), а не на узле площадки,
 * поэтому бой с ними носит место провинции-якоря, и проверка «бой на узле» площадку не
 * видела — стройка и улучшения крепости шли посреди атаки (замечание Codex на #1410). Бой
 * у площадки — бой, в котором стоит флот в точке её орудий.
 *
 * Точку сравниваем в ЛЮБУЮ сторону дороги: встреча на полосе (`fleet.intercept`)
 * перепривязывает обоих к каноническому ребру `lo → hi` с зеркальным `t`, и если выход
 * развилки меньше провинции, орудия в бою стоят на `exit → province` с `1 - t` (замечание
 * Codex на #1416).
 */
export function forkSiteInBattle(state: GameState, site: Pick<Planet, 'fork'> | undefined): boolean {
  if (!site?.fork) return false;
  const at = forkSiteEdge(state, site.fork);
  if (!at) return false;
  for (const b of Object.values(state.battles)) {
    for (const side of b.sides) {
      if (side.ref.kind !== 'fleet') continue;
      const e = state.fleets[side.ref.fleetId]?.edge;
      if (!e) continue;
      if (e.from === at.from && e.to === at.to && Math.abs(e.t - at.t) < 1e-9) return true;
      if (e.from === at.to && e.to === at.from && Math.abs(1 - e.t - at.t) < 1e-9) return true;
    }
  }
  return false;
}
