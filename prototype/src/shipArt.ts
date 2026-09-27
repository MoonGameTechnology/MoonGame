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
import scout from '../art/ships/scout.webp';
import heavyStriker from '../art/ships/heavy-striker.webp';
import picketFrigate from '../art/ships/picket-frigate.webp';
import heavyCruiser from '../art/ships/heavy-cruiser.webp';
import swarmScout from '../art/ships/swarm-scout.webp';
import swarmFlock from '../art/ships/swarm-flock.webp';
import swarmHunter from '../art/ships/swarm-hunter.webp';
import swarmDevourer from '../art/ships/swarm-devourer.webp';
import swarmSporeCarrier from '../art/ships/swarm-spore-carrier.webp';
import swarmDestroyer from '../art/ships/swarm-destroyer.webp';
import swarmMatriarch from '../art/ships/swarm-matriarch.webp';
import swarmLeviathan from '../art/ships/swarm-leviathan.webp';
import militia from '../art/units/militia.webp';
import dropInfantry from '../art/units/drop-infantry.webp';
import heavyInfantry from '../art/units/heavy-infantry.webp';
import specialForces from '../art/units/special-forces.webp';
import tank from '../art/units/tank.webp';
import garrison from '../art/units/garrison.webp';
import swarmLander from '../art/units/swarm-lander.webp';
import pirateSkiff from '../art/units/pirate-skiff.webp';
import pirateFrigate from '../art/units/pirate-frigate.webp';
import pirateCruiser from '../art/units/pirate-cruiser.webp';
import pirateBoarder from '../art/units/pirate-boarder.webp';
import pirateMarauder from '../art/units/pirate-marauder.webp';
import pirateTank from '../art/units/pirate-tank.webp';
import roadMine from '../art/units/road-mine.webp';

const PORTRAITS: Partial<Record<ShipShapeId, string>> = {
  fighter,
  strikeCraft,
  frigate,
  cruiser,
  dreadnought,
  transport,
  dropship,
  station,
  scout,
  heavyStriker,
  picketFrigate,
  heavyCruiser,
  swarmScout,
  swarmFlock,
  swarmHunter,
  swarmDevourer,
  swarmSporeCarrier,
  swarmDestroyer,
  swarmMatriarch,
  swarmLeviathan,
  pirateSkiff,
  pirateFrigate,
  pirateCruiser,
};

const GROUND_PORTRAITS: Readonly<Record<string, string>> = {
  militia,
  drop_infantry: dropInfantry,
  heavy_infantry: heavyInfantry,
  special_forces: specialForces,
  tank,
  garrison,
  swarm_lander: swarmLander,
  pirate_boarder: pirateBoarder,
  pirate_marauder: pirateMarauder,
  pirate_tank: pirateTank,
};

/** Orbital station art belongs to orbital buildings, never a new mobile unit.
 * The owner's faction picks the family, as on the map (`unitShape`): a Swarm-owned
 * cruiser is the Hunter; a catalog entry without an owner falls back to `def.faction`.
 */
export function catalogPortraitHtml(
  kind: 'b' | 'u' | 'md',
  id: string,
  data: GameData,
  size: 'thumb' | 'portrait' = 'portrait',
  ownerFaction?: string,
): string {
  // The minelayer is equipment, not the metal-mine building or a mobile hull.
  // Until its catalogue entry is shipped, unknown module pages stay empty.
  const mine = kind === 'md' && id === 'mine_layer' && !!data.modules[id];
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
  const ground = def?.domain === 'ground';
  const src = mine ? roadMine : ground ? GROUND_PORTRAITS[id] : shape && PORTRAITS[shape];
  if (!src) return '';
  // The adjacent localized title identifies the unit; the artwork adds no duplicate
  // screen-reader label and contains no language baked into its pixels.
  return `<span class="ship-art ship-art--${size}" data-ship-art="${mine ? 'roadMine' : ground ? id : shape}" aria-hidden="true"><img src="${src}" alt="" width="768" height="512" loading="lazy" decoding="async" draggable="false"></span>`;
}
