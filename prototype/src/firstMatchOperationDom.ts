/** DOM/navigation adapter for the operation half of the guided first match; it reads the
 * screen and moves the camera or windows, and never sends a game order. */
import { GUIDE_TROOP, guideHeroFleet } from '../../decisions/firstMatchGuide';
import type { GameState } from '../../packages/shared-core/src/index';
import type { OperationUi } from './firstMatchOperation';
import {
  aiming,
  heroSpawnAim,
  mobileDraft,
  pickFleets,
  pickWorld,
  selFleet,
  selPlanet,
  strikeAim,
  troopsPlan,
} from './interaction';
import { focusWorld, panBy, world } from './mapCamera';

interface OperationDomHost {
  world(): GameState;
  me(): string;
  mobile: boolean;
  expanded(): boolean;
  collapse(): void;
  tab(): string;
  ships(): void;
  market(good: string): void;
  render(): void;
}

export function operationUi(h: OperationDomHost): OperationUi {
  const hero = () => guideHeroFleet(h.world(), h.me());
  const point = (planet: string) =>
    h.world().planets[planet] ? world(h.world().planets[planet]!.position) : null;
  const details = () => {
    if (h.mobile && !h.expanded())
      document.querySelector<HTMLButtonElement>('#mobile-sheet [data-mobile="details"]')?.click();
  };
  const visible = (selector: string) =>
    Array.from(document.querySelectorAll(selector)).some((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
    });
  return {
    mobile: h.mobile,
    visible,
    selectedWorld: () => selPlanet,
    selectedFleet: () => selFleet,
    heroSelector: () => {
      const f = hero();
      return f ? `[data-act="selfleet"][data-arg="${CSS.escape(f.id)}"]` : null;
    },
    anchor: (planet) => {
      const p = point(planet);
      return p && p.x > 22 && p.x < innerWidth - 22 && p.y > 80 && p.y < innerHeight - 44
        ? { left: p.x - 22, top: p.y - 22, width: 44, height: 44 }
        : null;
    },
    show: (target) => {
      if (target.startsWith('market:')) {
        h.market(target.slice(7));
      } else if (target.startsWith('world:')) {
        focusWorld(target.slice(6));
        pickWorld(target.slice(6));
        h.render();
        details();
      } else if (target === 'hero') {
        const f = hero();
        if (!f) return;
        if (f.location) {
          focusWorld(f.location);
          pickWorld(f.location);
          h.ships();
        } else pickFleets([f.id], (id) => h.world().fleets[id]?.owner === h.me());
        h.render();
        details();
      } else {
        if (h.mobile) h.collapse();
        focusWorld(target);
        // The desktop fleet console covers the middle and bottom of the map: the world
        // goes to the upper right, where no command button sits over it.
        const p = point(target);
        if (p)
          panBy(
            innerWidth * (h.mobile ? 0.5 : 0.78) - p.x,
            innerHeight * (h.mobile ? 0.46 : 0.3) - p.y,
          );
      }
    },
    intent: (kind) => {
      if (kind === 'details') return h.expanded();
      if (kind.startsWith('tab:')) return h.tab() === kind.slice(4);
      if (kind === 'spawn') return heroSpawnAim !== null;
      if (kind === 'move') return aiming;
      if (kind === 'strike') return strikeAim !== null;
      if (kind === 'troops-ready') return (troopsPlan?.plan[GUIDE_TROOP] ?? 0) > 0;
      if (kind.startsWith('picked:'))
        return (
          mobileDraft?.order === 'move' &&
          mobileDraft.target.kind === 'planet' &&
          mobileDraft.target.id === kind.slice(7)
        );
      return false;
    },
  };
}
