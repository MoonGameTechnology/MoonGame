/**
 * Which star burns at the heart of a solar-flare zone. A flare zone exists because a star is
 * there, so the map draws one at its node; which kind is picked from the node's map position,
 * so every client, every visit and every replay of the same map shows the same star without
 * the map data having to carry it.
 */
export type StarClass = 'yellow_dwarf' | 'red_giant' | 'blue_giant' | 'white_dwarf' | 'pulsar' | 'binary';

export const STAR_CLASSES: readonly StarClass[] = [
  'yellow_dwarf',
  'red_giant',
  'blue_giant',
  'white_dwarf',
  'pulsar',
  'binary',
];

/** The star of the node at map position (`x`, `y`): a fixed integer hash of the rounded
 *  coordinates, so neighbouring zones rarely repeat and a sub-unit drift changes nothing. */
export function starClassAt(x: number, y: number): StarClass {
  let h = (Math.round(x) * 73856093) ^ (Math.round(y) * 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return STAR_CLASSES[(h >>> 0) % STAR_CLASSES.length]!;
}
