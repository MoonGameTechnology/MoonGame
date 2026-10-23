/** DOM/navigation adapter for the training lesson; no game orders are sent here. */
import { trainingFleet, type TrainingFleetRole } from '../../decisions/trainingGuide';
import type { GameState } from '../../packages/shared-core/src/index';
import { fleetAnchor } from './fleetGeometry';
import {
  aiming,
  merging,
  mobileDraft,
  pickFleets,
  pickWorld,
  retreatAim,
  selFleet,
  selPlanet,
  strikeAim,
  troopsPlan,
} from './interaction';
import { cam, centerOn, focusWorld, panBy, world } from './mapCamera';
import type { TrainingTourUi } from './trainingTour';

interface TrainingDomHost {
  world(): GameState;
  me(): string;
  mobile: boolean;
  expanded(): boolean;
  collapse(): void;
  tab(): string;
  ships(): void;
  render(): void;
}

export function trainingTourUi(h: TrainingDomHost): TrainingTourUi {
  const fleet = (role: TrainingFleetRole) => trainingFleet(h.world(), h.me(), role);
  const edgePoint = () => {
    const a = h.world().planets.open_reach!.position;
    const b = h.world().planets.outpost!.position;
    return { x: a.x + (b.x - a.x) * 0.45, y: a.y + (b.y - a.y) * 0.45 };
  };
  const point = (target: string) =>
    target === 'carrier-edge'
      ? world(edgePoint())
      : target.startsWith('fleet:')
        ? (() => {
            const f = fleet(target.slice(6) as TrainingFleetRole);
            return f ? fleetAnchor(f) : null;
          })()
        : h.world().planets[target]
          ? world(h.world().planets[target]!.position)
          : null;
  const uncover = (target: string) => {
    if (h.mobile) h.collapse();
    const p = point(target);
    // The desktop fleet console covers the middle/bottom of the map. A camera
    // jump alone can put the destination underneath a command button.
    if (p)
      panBy(
        innerWidth * (h.mobile ? 0.5 : 0.78) - p.x,
        innerHeight * (h.mobile ? 0.46 : 0.3) - p.y,
      );
  };
  const visible = (selector: string) =>
    Array.from(document.querySelectorAll(selector)).some((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
    });
  const details = () => {
    if (h.mobile && !h.expanded())
      document.querySelector<HTMLButtonElement>('#mobile-sheet [data-mobile="details"]')?.click();
  };
  return {
    mobile: h.mobile,
    visible,
    selectedWorld: () => selPlanet,
    selectedFleet: () => selFleet,
    fleetSelector: (role) => {
      const f = fleet(role);
      return f ? `[data-act="selfleet"][data-arg="${CSS.escape(f.id)}"]` : null;
    },
    anchor: (target) => {
      const p = point(target);
      return p && p.x > 22 && p.x < innerWidth - 22 && p.y > 80 && p.y < innerHeight - 44
        ? { left: p.x - 22, top: p.y - 22, width: 44, height: 44 }
        : null;
    },
    show: (target) => {
      if (target.startsWith('world:')) {
        focusWorld(target.slice(6));
        pickWorld(target.slice(6));
        h.render();
      } else if (target === 'carrier-edge') {
        centerOn(edgePoint(), cam.scale);
        uncover(target);
      } else if (target.startsWith('fleet:')) {
        const f = fleet(target.slice(6) as TrainingFleetRole);
        if (!f) return;
        if (f.location) {
          focusWorld(f.location);
          pickWorld(f.location);
          h.ships();
        } else pickFleets([f.id], (id) => h.world().fleets[id]?.owner === h.me());
        h.render();
        details();
      } else {
        focusWorld(target);
        uncover(target);
      }
    },
    intent: (kind) => {
      if (kind === 'details') return h.expanded();
      if (kind.startsWith('tab:')) return h.tab() === kind.slice(4);
      if (kind === 'move') return aiming;
      if (kind === 'merge') return merging;
      if (kind === 'merge-confirm')
        return (
          mobileDraft?.order === 'merge' &&
          mobileDraft.target.kind === 'fleet' &&
          mobileDraft.target.id === fleet('support')?.id
        );
      if (kind === 'retreat') return retreatAim !== null;
      if (kind === 'strike') return strikeAim !== null;
      if (kind === 'troops-ready') return (troopsPlan?.plan.heavy_infantry ?? 0) > 0;
      if (kind === 'carrier-course')
        return (
          !!fleet('carrier')?.movement ||
          !!fleet('carrier')?.edge ||
          mobileDraft?.target.kind === 'lane'
        );
      if (kind.startsWith('picked:'))
        return (
          mobileDraft?.order === 'move' &&
          mobileDraft.target.kind === 'planet' &&
          mobileDraft.target.id === kind.slice(7)
        );
      if (kind.startsWith('assault:'))
        return (
          fleet('hero')?.assaultLanding?.planetId === kind.slice(8) ||
          Object.values(h.world().battles).some(
            (b) => b.phase === 'ground' && b.location === kind.slice(8),
          )
        );
      return false;
    },
  };
}
