import type { FirstMatchDeps } from './firstMatchTour';

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
  };
  return { facts, deps };
}
