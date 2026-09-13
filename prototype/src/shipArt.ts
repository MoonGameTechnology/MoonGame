/** Local, text-free concept portraits. Build embeds WebP into the offline HTML/APK.
 * Never import this module into a map renderer: maps use shipShapes' native vectors.
 */
import type { GameData } from '../../packages/shared-core/src/index';
import { UNIT_SHAPE, type ShipShapeId } from '../../packages/client/src/shipShapes';
import fighter from '../art/ships/fighter.webp';
import strikeCraft from '../art/ships/strike-craft.webp';
import frigate from '../art/ships/frigate.webp';
import cruiser from '../art/ships/cruiser.webp';
import dreadnought from '../art/ships/dreadnought.webp';
import transport from '../art/ships/transport.webp';
import dropship from '../art/ships/dropship.webp';
import station from '../art/ships/station.webp';

const PORTRAITS: Partial<Record<ShipShapeId, string>> = {
  fighter,
  strikeCraft,
  frigate,
  cruiser,
  dreadnought,
  transport,
  dropship,
  station,
};

/** Orbital station art belongs to orbital buildings, never a new mobile unit. */
export function catalogPortraitHtml(
  kind: 'b' | 'u',
  id: string,
  data: GameData,
  size: 'thumb' | 'portrait' = 'portrait',
): string {
  const shape =
    kind === 'u'
      ? data.units[id]?.domain === 'space'
        ? UNIT_SHAPE[id]
        : undefined
      : data.buildings[id] && (id === 'metal_station' || id === 'starfort')
        ? 'station'
        : undefined;
  const src = shape && PORTRAITS[shape];
  if (!src) return '';
  // The adjacent localized title identifies the unit; the artwork adds no duplicate
  // screen-reader label and contains no language baked into its pixels.
  return `<span class="ship-art ship-art--${size}" data-ship-art="${shape}" aria-hidden="true"><img src="${src}" alt="" width="768" height="512" loading="lazy" decoding="async" draggable="false"></span>`;
}
