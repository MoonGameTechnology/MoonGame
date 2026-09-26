/**
 * СТАРТОВЫЕ ФЛОТЫ ГЛАВЫ — ОДНИМ ФЛОТОМ (решение владельца 2026-09-26: «пусть флоты будут
 * сразу объединены»). Карта главы кладёт у дома игрока два-три флота, а подготовка
 * добавляет корабль героя отдельным флотом — первым делом игрок сливал их руками.
 *
 * Правила:
 *
 * 1. **Сливаются флоты в одной точке.** Флот на другом мире (эвакуационный конвой второй
 *    главы, колонии третьей) остаётся своим: у него своя задача.
 * 2. **Собираются вокруг героя.** Корабль героя — главный в своей точке: в него вливаются
 *    остальные, и герой ведёт весь флот. Героя нет — в первый по id.
 * 3. **Только план.** Сами слияния делает ядро приказом `fleet.merge` — со всеми его
 *    правилами (двух героев в один флот не сольёт, флот в бою не тронет). Здесь решено
 *    только, кого с кем.
 *
 * Учебного полигона правило не касается: слить и разделить флот — его упражнение.
 */
import type { GameState, PlayerId } from '../packages/shared-core/src/index';

/** Пары «кого в кого» для слияния стартовых флотов игрока `owner`. */
export function startFleetMerges(state: GameState, owner: PlayerId): Array<{ from: string; into: string }> {
  const heroFleets = new Set(
    Object.values(state.heroes ?? {})
      .filter((h) => h.owner === owner && h.alive && h.fleetId)
      .map((h) => h.fleetId!),
  );
  const byPlace = new Map<string, string[]>();
  for (const id of Object.keys(state.fleets).sort()) {
    const f = state.fleets[id]!;
    if (f.owner !== owner || !f.location || f.movement || f.battleId) continue;
    if (!f.units.some((u) => u.count > 0)) continue;
    byPlace.set(f.location, [...(byPlace.get(f.location) ?? []), id]);
  }
  const out: Array<{ from: string; into: string }> = [];
  for (const ids of byPlace.values()) {
    if (ids.length < 2) continue;
    const into = ids.find((id) => heroFleets.has(id)) ?? ids[0]!;
    for (const from of ids) if (from !== into) out.push({ from, into });
  }
  return out;
}
