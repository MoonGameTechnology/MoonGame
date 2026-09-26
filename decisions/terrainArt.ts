/** New environment profiles can decorate a province without changing its body kind.
 * Existing profiles deliberately retain the established kind-based artwork. */
export function terrainArtKind(kind: string, terrain?: string): string {
  if (kind === 'rift' || kind === 'black_hole' || kind === 'asteroid_cluster') return kind;
  if (terrain === 'dust_lane' || terrain === 'depleted_system' || terrain === 'asteroid_cluster') {
    return terrain;
  }
  return kind;
}
