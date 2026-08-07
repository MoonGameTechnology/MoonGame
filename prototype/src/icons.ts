/**
 * Icon vocabulary (REFM-3) — the text glyphs for buildings / units / province kinds
 * and the two renderers that turn a unit id into menu-ready markup. Extracted from
 * `main.ts` right after `format.ts` and for the same reason: every screen brick needs
 * icons, and a shared leaf module beats threading the same three helpers through each
 * one's `deps` object.
 *
 * Data-driven, no state: `unitIconHtml` takes the side colour as an argument (in
 * `main.ts` it defaulted to the module-level `youColor`, which a leaf module must not
 * reach for — call sites pass it, and «твой цвет» stays the host's business).
 */
import { unitGlyphSvg, ARCHETYPE_PATH } from './unitGlyphs';
import type { GameData } from '../../packages/shared-core/src/index';

/** Producer buildings echo their resource's glyph (`TECH_CUR` in `format.ts`) — keep
 *  the two in sync when the resource family changes. */
export const BUILD_ICON: Record<string, string> = {
  mine: '❒',
  refinery: '◇',
  tax_office: '⛁',
  farm: '⚘',
  power_plant: 'ϟ',
  fabricator: '▣',
  barracks: '▤',
  fort: '⬡',
  starfort: '✦',
  radar: '⊚',
  orbital_aa: '⌁',
  spaceport: '⊞', // стапель: без него корабль на мире не заложить
  metal_station: '⛏', // утилизационная станция — металл из обломков
  hospital: '✚', // полевой госпиталь: единственный источник лечения гарнизона
  shipyard: '⊟', // верфь бандла (в прототипе её роль играет spaceport)
  biomass_pit: '❀', // биомасса бандла
  mine_t1: '❒', // те же шахты бандла, что и `mine` прототипа
  mine_t2: '❒',
};

/** Text glyph per unit — the fallback for ground units and for anything the poster
 *  silhouette family (space-only) does not cover. */
export const UNIT_ICON: Record<string, string> = {
  cruiser: '▲',
  scout: '◌',
  siege: '✦',
  strike_carrier: '◈', // a flat-top capital hull — hangar bays for the wing
  fighter_squadron: '△', // light strike wing (hollow, to read apart from the cruiser ▲)
  hero: '♔', // the player's projection — a crowned flagship
  militia: '▿', // massed light foot
  heavy_infantry: '◆', // the armoured line
  special_forces: '✱', // the elite few
  tank: '▮', // the heavy armour block
};

/** A small glyph per province KIND, drawn above each province so its type reads at a
 *  glance (planet / asteroid / nebula / wreck-field / storm / …). Text glyphs only. */
export const KIND_ICON: Record<string, string> = {
  planet: '◉',
  dead_world: '⊗',
  asteroid: '⬡',
  nebula: '≋',
  dense_nebula: '❋',
  graveyard: '⊘',
  ion_storm: '⌁',
  solar_flare: '✸',
};

/** Text glyph of a unit: its own, else the domain default (ground ◆ / space ▲). */
export function unitIcon(unit: string, data: GameData): string {
  return UNIT_ICON[unit] ?? (data.units[unit]?.domain === 'ground' ? '◆' : '▲');
}

/** Ship/unit icon for MENUS (build menu, garrison composition, codex, constructor,
 *  split, asset lists…): the current poster silhouette (`unitGlyphs` — «силуэт = что,
 *  цвет = чей») for ships, so every menu speaks the same shape language as the map
 *  markers and the fleet card; ground units keep the text glyph (the silhouette family
 *  is space-only). `px` fits the SVG box to the icon slot; `color` is the side tint. */
export function unitIconHtml(
  unit: string,
  data: GameData,
  color: string,
  px = 22,
): string {
  const def = data.units[unit];
  if (def && def.domain !== 'ground') return unitGlyphSvg(def, { color, px });
  return unitIcon(unit, data);
}

// Path2D cache of the poster silhouettes for the canvas — the panel takes the same
// paths through SVG, so the map and the card cannot drift apart in shape.
const ARCH_PATH2D: Partial<Record<keyof typeof ARCHETYPE_PATH, Path2D>> = {};
export function archPath2d(arch: keyof typeof ARCHETYPE_PATH): Path2D {
  return (ARCH_PATH2D[arch] ??= new Path2D(ARCHETYPE_PATH[arch]));
}


// Sovereigns (donate currency): faceted-gem line icon per the mock — worn GOLD with a
// soft halo (the mock capsule is lavender; the brief keeps the game's gold identity).
export const SOV_SVG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 1.8 11.8 6 8 14.2 4.2 6 8 1.8Z"/><path d="M4.2 6h7.6M8 1.8 6.3 6l1.7 8.2M8 1.8 9.7 6"/></svg>';

// The five session resources: inline-SVG line art traced from the mock (two coin
// rings, isometric cube, sprout, bolt, IC chip), stroke=currentColor so ONE
// stylesheet accent (`--rc-*` / `.rc-*`) tints the icon wherever it appears — the
// top bar, cost rows, the market book, tech-tree prices. One dictionary, one look:
// a player who learned the bar reads every other surface for free.
export const RES_SVG: Record<string, string> = {
  credits:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="6" cy="6.2" r="3.9"/><circle cx="10" cy="9.8" r="3.9"/></svg>',
  metal:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 1.8 13.4 4.9v6.2L8 14.2 2.6 11.1V4.9L8 1.8Z"/><path d="M2.6 4.9 8 8l5.4-3.1M8 8v6.2"/></svg>',
  food: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 14.2V8.8"/><path d="M8 9.6C8 6.4 6.2 4.8 3.6 4.6c.2 3 1.9 4.7 4.4 5Z"/><path d="M8 9.6c0-3.2 1.8-4.8 4.4-5-.2 3-1.9 4.7-4.4 5Z"/></svg>',
  energy:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M9.3 1.6 4.2 8.9h3.2L6.4 14.4l5.4-7.6H8.5l.8-5.2Z"/></svg>',
  microelectronics:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1"/><rect x="7" y="7" width="2" height="2"/><path d="M6.4 4.6v-2M9.6 4.6v-2M6.4 13.4v-2M9.6 13.4v-2M4.6 6.4h-2M4.6 9.6h-2M13.4 6.4h-2M13.4 9.6h-2"/></svg>',
};
