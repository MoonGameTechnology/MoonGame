import { guideScenario } from '../../decisions/firstMatchGuide';
import type { GameState } from '../../packages/shared-core/src/index';
import type { OperationDeps, OperationUi } from './firstMatchOperation';
import type { FirstMatchDeps } from './firstMatchTour';
import { advance, data, newGame } from './game';
import { DEFAULT_HEROES } from './heroes';

/** The world `startGuidedMatch` builds: the bot-free duel-1 seat plus the lesson scenario. */
export function lessonWorld(): GameState {
  const base = newGame({
    mapId: 'duel-1',
    seats: [
      { id: 'p1', name: 'Azure Compact', faction: 'azure', start: 'home_1', ai: false, team: 'A' },
    ],
    scientists: ['overseer', 'polymath'],
    heroes: DEFAULT_HEROES.map((h) => ({ ...h, abilities: [...h.abilities] })),
  });
  return advance(guideScenario(base, 'p1'), base.time + 1).state;
}

/** A screen that shows nothing and has nothing selected: every operation step waits. */
export function operationFixture(mobile = false, world = lessonWorld()): OperationDeps {
  const ui: OperationUi = {
    mobile,
    visible: () => false,
    selectedWorld: () => null,
    selectedFleet: () => null,
    intent: () => false,
    anchor: () => null,
    heroSelector: () => null,
    show: () => {},
  };
  return { world: () => world, me: 'p1', home: 'home_1', data, ui };
}

/** Mutable signals for the tour's state-machine and copy contract tests. */
export function firstMatchFixture() {
  const facts = {
    buildingsTabOpen: true,
    homeOpened: false,
    panelOpen: false,
    mineCardOpen: false,
    mineOrdered: false,
    mineImproved: false,
    dossierClosed: false,
    techOpen: false,
    techAccessible: false,
    spaceTabOpen: false,
    researchStarted: false,
    researchDone: false,
    shipsTabOpen: false,
    shipCardOpen: false,
    catalogOpen: false,
    shipOrdered: false,
    hasShip: false,
    fleetSelected: false,
    moveArmed: false,
    courseSet: false,
    coursePicked: false,
    capturedWorld: false,
  };
  const signals = Object.fromEntries(
    Object.keys(facts).map((key) => [key, () => facts[key as keyof typeof facts]]),
  ) as Pick<FirstMatchDeps, keyof typeof facts>;
  const deps: FirstMatchDeps = {
    ...signals,
    mouse: () => true,
    cardLayout: () => false,
    homeAnchor: () => null,
    fleetSelector: () => null,
    targetAnchor: () => null,
    showHome: () => {},
    showFleet: () => {},
    showTarget: () => {},
    operation: operationFixture(),
  };
  return { facts, deps };
}
