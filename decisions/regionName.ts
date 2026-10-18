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
 * 5. **Подписи не наезжают друг на друга и не уходят за край экрана.** На узком экране
 *    телефона средние точки соседних областей сходятся ближе длины их имён, и подписи
 *    ложились одна на другую (жалоба владельца 2026-10-14 на «странную» карту 2 на 2).
 *    Подпись пробует по порядку: свою точку одной строкой, свою точку двумя строками,
 *    сдвиг на строку вверх или вниз. Свободного места нет — подпись не рисуется: лучше
 *    без одного имени, чем две нечитаемые. Подпись, вылезающая за боковой край экрана,
 *    сдвигается внутрь.
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

/** Подпись, разложенная на экране: строки сверху вниз и центр блока строк. */
export interface PlacedRegionLabel {
  id: string;
  lines: string[];
  x: number;
  y: number;
}

/** Две строки из имени: разрыв по пробелу, ближайшему к середине. Без пробела — `null`. */
function twoLines(text: string): string[] | null {
  let best = -1;
  for (let i = text.indexOf(' '); i >= 0; i = text.indexOf(' ', i + 1))
    if (best < 0 || Math.abs(i - text.length / 2) < Math.abs(best - text.length / 2)) best = i;
  return best < 0 ? null : [text.slice(0, best), text.slice(best + 1)];
}

/**
 * Разложить подписи в экранных координатах (правило 5). `labels` — уже на экране, в
 * порядке важности: раньше стоящая занимает место первой. `measure` — ширина строки в
 * пикселях тем шрифтом, которым подпись нарисуют.
 */
export function layoutRegionLabels(
  labels: readonly { id: string; text: string; x: number; y: number }[],
  measure: (text: string) => number,
  view: { width: number },
  lineHeight: number,
  margin = 6,
): PlacedRegionLabel[] {
  const taken: { left: number; right: number; top: number; bottom: number }[] = [];
  const out: PlacedRegionLabel[] = [];
  const gapX = 6;
  const gapY = 2;
  for (const label of labels) {
    const layouts = [[label.text], twoLines(label.text)].filter((l): l is string[] => l !== null);
    let placed: PlacedRegionLabel | null = null;
    for (const shift of [0, -1, 1, -2, 2]) {
      for (const lines of layouts) {
        const width = Math.max(...lines.map(measure));
        // Строка шире экрана — только если короче разложить нельзя.
        if (width + 2 * margin > view.width && lines !== layouts.at(-1)) continue;
        const height = lines.length * lineHeight;
        let x = label.x;
        // Только подпись, чья точка на экране: дальнюю область краем не притягиваем.
        if (x >= 0 && x <= view.width)
          x = width + 2 * margin >= view.width ? view.width / 2
            : Math.min(view.width - margin - width / 2, Math.max(margin + width / 2, x));
        const y = label.y + shift * (lineHeight + 2 * gapY);
        const box = { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 };
        const clash = taken.some((o) => box.left < o.right + gapX && box.right > o.left - gapX &&
          box.top < o.bottom + gapY && box.bottom > o.top - gapY);
        if (clash) continue;
        taken.push(box);
        placed = { id: label.id, lines, x, y };
        break;
      }
      if (placed) break;
    }
    if (placed) out.push(placed);
  }
  return out;
}
