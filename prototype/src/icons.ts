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

/** Ground-roster icon, per layout. Mobile keeps the original emoji (phone fonts render
 *  them); PC monospace stacks have no glyph for 🪖👥🎖 — they came out as tofu ▯ — so the
 *  desktop gets text glyphs from the same family as `UNIT_ICON`. The caller passes the
 *  layout flag: a leaf module must not reach for the host's `pcUi()`. */
const FORM_ICON_EMOJI: Record<string, string> = {
  militia: '👥',
  heavy_infantry: '🪖',
  special_forces: '🎖',
  tank: '🛡',
};
const FORM_ICON_TEXT: Record<string, string> = {
  militia: '▿',
  heavy_infantry: '◆',
  special_forces: '✱',
  tank: '▰',
};
export function formIcon(type: string, pcUi: boolean): string {
  return (pcUi ? FORM_ICON_TEXT[type] : FORM_ICON_EMOJI[type]) ?? '▪';
}
