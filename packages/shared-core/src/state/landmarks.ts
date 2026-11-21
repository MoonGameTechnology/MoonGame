/**
 * ОРИЕНТИРЫ КАРТЫ (решение владельца 2026-11-21: «эти провинции сделать разведанными
 * сразу»). Провинция вида, в который нельзя ни войти, ни пролететь над ним, — звезда,
 * чёрная дыра и кольца вокруг них (`overflight: false`, то же закрытое небо, что в
 * `closedSky.ts`), — не держит ничего, что стоило бы разведывать: ни хозяина, ни гарнизона,
 * ни построек, ни пути внутрь. Карта показывает её каждому игроку с первой минуты, как
 * пустой космос: туману в ней прятать нечего.
 *
 * Только показ: ориентир входит в то опознание, которое читают карта и проекция
 * (`viewCoverage`), а не в датчики, которые считаются разведкой (`sensorCoverage`, награды
 * и карьера), и память тумана его не пишет — помнить то, что видно всегда, незачем.
 */
import type { GameData } from '../data/schemas';
import type { Planet, PlanetId } from './gameState';
import type { Coverage } from './sensorView';

/** Вид провинции, которая видна всем всегда: ни войти, ни пролететь. Вид ищется только
 *  среди собственных ключей каталога, как и в остальных таблицах данных. */
export function isLandmark(kind: string | undefined, data: GameData): boolean {
  return (
    kind !== undefined &&
    Object.prototype.hasOwnProperty.call(data.sectorKinds, kind) &&
    data.sectorKinds[kind]!.overflight === false
  );
}

/** Опознание зрителя вместе с ориентирами карты. Порядок множеств — порядок `planets`, как
 *  у самого опознания; карта без ориентиров возвращает опознание как есть. */
export function withLandmarks(coverage: Coverage, planets: readonly Planet[], data: GameData): Coverage {
  if (!planets.some((p) => isLandmark(p.kind, data))) return coverage;
  const identify = new Set<PlanetId>();
  const radar = new Set<PlanetId>();
  for (const p of planets) {
    const landmark = isLandmark(p.kind, data);
    if (landmark || coverage.identify.has(p.id)) identify.add(p.id);
    if (landmark || coverage.radar.has(p.id)) radar.add(p.id);
  }
  return { identify, radar };
}
