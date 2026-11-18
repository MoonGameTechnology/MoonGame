/**
 * Which star a star province holds (owner 2026-11-17: «каждая такая моделька должна иметь
 * свою провинцию»). A star is a province of kind `star`; its class is the province's
 * terrain — one of the `star` family in `data/sectors.json` — so the class reaches every
 * client with the province itself, under the same fog, and the drawing never guesses.
 */
export type StarClass = 'yellow_dwarf' | 'red_giant' | 'blue_giant' | 'white_dwarf' | 'pulsar' | 'binary_star';

export const STAR_CLASSES: readonly StarClass[] = [
  'yellow_dwarf',
  'red_giant',
  'blue_giant',
  'white_dwarf',
  'pulsar',
  'binary_star',
];

const KNOWN = new Set<string>(STAR_CLASSES);

/** The class of a star province from its terrain; a terrain no star class names (an old or
 *  edited map) draws the plainest star, a yellow dwarf, rather than nothing. */
export function starClassOf(terrain: string | undefined): StarClass {
  return terrain !== undefined && KNOWN.has(terrain) ? (terrain as StarClass) : 'yellow_dwarf';
}
