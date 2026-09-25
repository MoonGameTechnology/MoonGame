/** Local, text-free concept portraits. Build embeds WebP into the offline HTML/APK.
 * Never import this module into a map renderer: maps use shipShapes' native vectors.
 */
import type { GameData } from '../../packages/shared-core/src/index';
import { UNIT_SHAPE, type ShipShapeId } from '../../packages/client/src/shipShapes';
import { unitShape } from '../../packages/client/src/shipGlyphs';
import fighter from '../art/ships/fighter.webp';
import strikeCraft from '../art/ships/strike-craft.webp';
import frigate from '../art/ships/frigate.webp';
import cruiser from '../art/ships/cruiser.webp';
import dreadnought from '../art/ships/dreadnought.webp';
import transport from '../art/ships/transport.webp';
import dropship from '../art/ships/dropship.webp';
import station from '../art/ships/station.webp';
import swarmScout from '../art/ships/swarm-scout.webp';
import swarmFlock from '../art/ships/swarm-flock.webp';
import swarmHunter from '../art/ships/swarm-hunter.webp';
import swarmDevourer from '../art/ships/swarm-devourer.webp';
import swarmSporeCarrier from '../art/ships/swarm-spore-carrier.webp';
import swarmDestroyer from '../art/ships/swarm-destroyer.webp';
import swarmMatriarch from '../art/ships/swarm-matriarch.webp';
import swarmLeviathan from '../art/ships/swarm-leviathan.webp';

const PORTRAITS: Partial<Record<ShipShapeId, string>> = {
  fighter,
  strikeCraft,
  frigate,
  cruiser,
  dreadnought,
  transport,
  dropship,
  station,
  swarmScout,
  swarmFlock,
  swarmHunter,
  swarmDevourer,
  swarmSporeCarrier,
  swarmDestroyer,
  swarmMatriarch,
  swarmLeviathan,
};

/** Orbital station art belongs to orbital buildings, never a new mobile unit.
 * The owner's faction picks the family, as on the map (`unitShape`): a Swarm-owned
 * cruiser is the Hunter; a catalog entry without an owner falls back to `def.faction`.
 */
export function catalogPortraitHtml(
  kind: 'b' | 'u',
  id: string,
  data: GameData,
  size: 'thumb' | 'portrait' = 'portrait',
  ownerFaction?: string,
): string {
  const def = kind === 'u' ? data.units[id] : undefined;
  const shape = def
    ? def.domain !== 'space'
      ? undefined
      : (ownerFaction ?? def.faction) === 'swarm'
        ? unitShape(def, id, 'swarm')
        : UNIT_SHAPE[id]
    : kind === 'b' && data.buildings[id] && (id === 'metal_station' || id === 'starfort')
      ? 'station'
      : undefined;
  const src = shape && PORTRAITS[shape];
  if (!src) return '';
  // The adjacent localized title identifies the unit; the artwork adds no duplicate
  // screen-reader label and contains no language baked into its pixels.
  return `<span class="ship-art ship-art--${size}" data-ship-art="${shape}" aria-hidden="true"><img src="${src}" alt="" width="768" height="512" loading="lazy" decoding="async" draggable="false"></span>`;
}
