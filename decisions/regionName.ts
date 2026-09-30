/**
 * ПОДПИСЬ ОБЛАСТИ на карте (M2.15, решение владельца 2026-09-29: «Только областей
 * названия. Не провинций»).
 *
 * 1. **Имя — текст для игрока, поэтому живёт в `/localization`, а не в карте.** Ключ
 *    выводится из id карты и области: `region.<карта>.<область>`, подчёркивания — в
 *    дефисы (`asteroid_massif` → `region.proving-ground.asteroid-massif`). Так же устроено
 *    имя провинции (`provinceName.ts`). В данных карты область — только id и список
 *    провинций (`MatchMap.regions`); ядро её не читает.
 * 2. **Подпись стоит в средней точке своих провинций.** Подпись — ориентир, а не граница:
 *    взвешивать размером провинции или искать «центр масс» мозаики незачем.
 * 3. **Подпись проступает при отдалении.** Непрозрачность — `1 − provinceDetail`: то же
 *    число, по которому внутренние границы и дороги растворяются при отдалении
 *    (`mapLod.ts`). Близко читаются провинции, издалека — области. Анимации у подписи нет:
 *    она следует за масштабом, который задаёт сам игрок, поэтому режиму «меньше движения»
 *    выключать нечего.
 * 4. **Нет имени — подписи нет.** Область без ключа на карту не выходит: сырой id игроку
 *    не показывается, а полноту имён держит тест карты.
 *
 * Импорт — из `core`, а не `runtime`: клиент грузит одну локаль (LOC-6), как в
 * `provinceName.ts`.
 */
import { hasKey, t } from '../localization/core';

/** Ключ имени области `regionId` на карте `mapId` (правило 1). */
export function regionKey(mapId: string, regionId: string): string {
  return `region.${mapId}.${regionId.replace(/_/g, '-')}`;
}

export interface RegionLabel {
  id: string;
  text: string;
  x: number;
  y: number;
}

/** Подписи областей карты на языке игрока (правила 1, 2, 4). */
export function regionLabels(
  mapId: string | undefined,
  regions: readonly { id: string; sectors: readonly string[] }[],
  positionOf: (sectorId: string) => { x: number; y: number } | undefined,
): RegionLabel[] {
  if (mapId === undefined) return [];
  const out: RegionLabel[] = [];
  for (const region of regions) {
    const key = regionKey(mapId, region.id);
    if (!hasKey(key)) continue;
    const points = region.sectors.flatMap((id) => {
      const p = positionOf(id);
      return p ? [p] : [];
    });
    if (points.length === 0) continue;
    out.push({
      id: region.id,
      text: t(key),
      x: points.reduce((n, p) => n + p.x, 0) / points.length,
      y: points.reduce((n, p) => n + p.y, 0) / points.length,
    });
  }
  return out;
}

/** Непрозрачность подписей при детализации провинций `provinceDetail` 0..1 (правило 3). */
export function regionLabelAlpha(provinceDetail: number): number {
  return Math.max(0, Math.min(1, 1 - provinceDetail));
}
