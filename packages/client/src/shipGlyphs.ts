/** Shared ship identity and modifiers for the playable map, client map and SVG icons.
 * Colour means owner; hull contour means class; size means HP; halo means shield/hero.
 * Realistic menu portraits live separately and are never decoded by the map renderer.
 */
import type { GameData, UnitDef, UnitStack } from '../../shared-core/src/index';

import { SHIP_SHAPES, SWARM_UNIT_SHAPE, UNIT_SHAPE, type ShipShapeId } from './shipShapes';

export type ShipArchetype = 'scout' | 'combat' | 'transport' | 'flagship' | 'swarm';

/** cargoCapacity с этого порога читается как выделенный транспортник
 *  (постер: «высокий cargoCapacity»; десантный корабль 16 — да, cruiser 5 — нет). */
export const TRANSPORT_CARGO_MIN = 8;

/** Роль корабля из полей unit-def — порядок проверок фиксирует приоритет
 *  (флагман > рой > транспорт > скаут > боевой по умолчанию). */
export function unitArchetype(def: UnitDef, ownerFaction?: string): ShipArchetype {
  if (def.traits.includes('hero')) return 'flagship';
  if ((ownerFaction ?? def.faction) === 'swarm') return 'swarm';
  if ((def.stats.cargoCapacity ?? 0) >= TRANSPORT_CARGO_MIN) return 'transport';
  if ((def.signature ?? 1) <= 1 && (def.radarRange ?? 0) > 0) return 'scout';
  return 'combat';
}

export type GlyphSize = 'S' | 'M' | 'L';

/** Модификатор размера S/M/L по ХП корпуса за корабль (постер: «размер по hp»).
 *  Пороги по прототип-ростеру: скаут/эскадрилья 10–12 → S, крейсер/десантник
 *  50–70 → M, герой 180 → L. */
export function unitSizeClass(hp: number): GlyphSize {
  return hp >= 90 ? 'L' : hp >= 30 ? 'M' : 'S';
}

/** Во сколько раз силуэт класса меньше полного — ОДНА таблица на панель и карту
 *  (правило 1). Масштабируется силуэт, а не бокс: сетка тайлов от этого не плывёт. */
export function glyphScale(size: GlyphSize): number {
  return size === 'L' ? 1 : size === 'M' ? 0.84 : 0.68;
}

/** Нужно ли гало-кольцо: щит — модификатор постера, у флагмана орбита есть всегда
 *  (правило 2). Радиус кольца поверхности выбирают сами — см. правило 3. */
export function glyphHalo(arch: ShipArchetype, shield: boolean): boolean {
  return shield || arch === 'flagship';
}

/** Нормализованные силуэты, 24×24, нос вверх. Многосоставные пути рисуются с
 *  fill-rule='evenodd' (в канве — fill(path2d, 'evenodd')). */
const ARCHETYPE_SHAPE: Record<ShipArchetype, ShipShapeId> = {
  scout: 'fighter',
  combat: 'cruiser',
  transport: 'transport',
  flagship: 'dreadnought',
  swarm: 'swarmHunter',
};
export const ARCHETYPE_PATH = Object.fromEntries(
  Object.entries(ARCHETYPE_SHAPE).map(([arch, shape]) => [arch, SHIP_SHAPES[shape].hull]),
) as Record<ShipArchetype, string>;

/** Ownership selects the faction appearance; the definition is a catalog fallback.
 * PvE waves reuse Vanguard definitions, so def.faction alone cannot identify them.
 * Ground units keep their own visual vocabulary; known hull IDs beat generic roles.
 */
export function unitShape(
  def: UnitDef,
  unitId?: string,
  ownerFaction?: string,
): ShipShapeId | null {
  if (def.domain === 'ground') return null;
  if ((ownerFaction ?? def.faction) === 'swarm') {
    const known = unitId ? SWARM_UNIT_SHAPE[unitId] : undefined;
    if (known) return known;
    if (def.traits.includes('hero')) return 'swarmLeviathan';
    if ((def.stats.cargoCapacity ?? 0) >= TRANSPORT_CARGO_MIN) return 'swarmDevourer';
    if ((def.signature ?? 1) <= 1 && (def.radarRange ?? 0) > 0) return 'swarmScout';
    return 'swarmHunter';
  }
  return (
    (unitId ? UNIT_SHAPE[unitId] : undefined) ?? ARCHETYPE_SHAPE[unitArchetype(def, ownerFaction)]
  );
}

export interface GlyphOpts {
  /** Explicit roster ID distinguishes hulls with similar combat stats. */
  unitId?: string;
  /** Live fleet owner's faction; independent of its colour and unit-definition origin. */
  ownerFaction?: string;
  /** Цвет стороны (принадлежность) — единственный канал цвета. */
  color: string;
  /** Сторона квадратного бокса в css px (по умолчанию 22). */
  px?: number;
  /** Гало-кольцо «есть щит» (постер: модификатор поверх силуэта). */
  shield?: boolean;
  /** Фракц-акцент — короткий штрих под силуэтом (штрих, не hue). */
  accent?: string;
}

/** DOM-глиф для тайлов панели: силуэт по архетипу + модификаторы постера
 *  (размер S/M/L по hp, гало при щите, у флагмана — всегда пунктирная орбита). */
export function unitGlyphSvg(def: UnitDef, o: GlyphOpts): string {
  const shapeId = unitShape(def, o.unitId, o.ownerFaction);
  if (!shapeId) return '';
  const shape = SHIP_SHAPES[shapeId];
  const arch = unitArchetype(def);
  const size = unitSizeClass(def.stats.hp ?? 0);
  const box = o.px ?? 22;
  const k = glyphScale(size);
  const halo = glyphHalo(arch, !!o.shield);
  const ring = halo
    ? `<circle cx="12" cy="12" r="10.6" fill="none" stroke="${o.color}" stroke-width="1.1" stroke-dasharray="2.4 2.7" opacity="0.75"/>`
    : '';
  const accent = o.accent
    ? `<path d="M7.5 22.6 h9" stroke="${o.accent}" stroke-width="1.6" fill="none"/>`
    : '';
  const tf =
    k === 1
      ? ''
      : ` transform="translate(${(12 * (1 - k)).toFixed(2)} ${(12 * (1 - k)).toFixed(2)}) scale(${k})"`;
  return (
    `<svg class="uglyph" data-hull="${shapeId}" viewBox="0 0 24 24" width="${box}" height="${box}" aria-hidden="true">` +
    ring +
    `<g${tf} stroke="${o.color}" stroke-linejoin="round"><path d="${shape.hull}" fill="${o.color}" fill-opacity=".24" fill-rule="evenodd" stroke-width="1.15"/>` +
    `<path d="${shape.detail}" fill="none" stroke-width=".65"/><path d="${shape.engines}" fill="none" stroke-width="1.5"/></g>` +
    accent +
    `</svg>`
  );
}

/** «Сильнейший корабль» флота для маркера карты (постер: флот на карте =
 *  доминант + счёт): максимум по attack+defense, тай-брейки hp ↓ и id ↑ —
 *  детерминированно при любом порядке стеков. Наземные и пустые стеки не
 *  участвуют; флот без кораблей → null. */
export function dominantUnit(
  stacks: readonly UnitStack[],
  data: GameData,
): { unit: string; def: UnitDef } | null {
  let best: { unit: string; def: UnitDef; power: number; hp: number } | null = null;
  for (const s of stacks) {
    if (s.count <= 0) continue;
    const def = data.units[s.unit];
    if (!def || def.domain === 'ground') continue;
    const power = (def.stats.attack ?? 0) + (def.stats.defense ?? 0);
    const hp = def.stats.hp ?? 0;
    if (
      !best ||
      power > best.power ||
      (power === best.power && (hp > best.hp || (hp === best.hp && s.unit < best.unit)))
    ) {
      best = { unit: s.unit, def, power, hp };
    }
  }
  return best ? { unit: best.unit, def: best.def } : null;
}
