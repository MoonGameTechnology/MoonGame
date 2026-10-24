/** The first Galactic War match: every instruction names an actual control or map target.
 * The host supplies live facts; a click or an unrelated order cannot complete a task.
 * The starter scout cannot capture provinces, so research and build a frigate first.
 * After the first sector the lesson goes on to the operation (`firstMatchOperation.ts`). */
import { mapGestures } from '../../decisions/mapGestures';
import { buildOperationSteps, type OperationDeps } from './firstMatchOperation';
import type { Rect, SpotlightStep } from './spotlight';

export interface FirstMatchDeps {
  mouse: () => boolean;
  cardLayout: () => boolean;
  homeOpened: () => boolean;
  panelOpen: () => boolean;
  buildingsTabOpen: () => boolean;
  mineCardOpen: () => boolean;
  mineOrdered: () => boolean;
  mineImproved: () => boolean;
  dossierClosed: () => boolean;
  techOpen: () => boolean;
  techAccessible: () => boolean;
  spaceTabOpen: () => boolean;
  researchStarted: () => boolean;
  researchDone: () => boolean;
  shipsTabOpen: () => boolean;
  catalogOpen: () => boolean;
  shipCardOpen: () => boolean;
  shipOrdered: () => boolean;
  hasShip: () => boolean;
  fleetSelected: () => boolean;
  moveArmed: () => boolean;
  courseSet: () => boolean;
  coursePicked: () => boolean;
  capturedWorld: () => boolean;
  homeAnchor: () => Rect | null;
  fleetSelector: () => string | null;
  targetAnchor: () => Rect | null;
  showHome: () => void;
  showFleet: () => void;
  showTarget: () => void;
  /** The second half of the lesson: market, hero, troops, aviation and the assault. */
  operation: OperationDeps;
}

/** The chapters of the first half; the operation names its own. */
type BasicsStage = 'economy' | 'research' | 'fleet' | 'finale';

export function buildFirstMatchTour(d: FirstMatchDeps): SpotlightStep[] {
  const step = (
    id: string,
    target: string | null,
    when: () => boolean,
    extra: Partial<SpotlightStep> = {},
  ): SpotlightStep => ({
    id,
    target,
    copy: `onb.guide.${id}`,
    advance: { on: 'state', when },
    collapsible: true,
    gate: target !== null,
    ...extra,
  });
  const tap = (id: string): SpotlightStep => ({
    id,
    target: null,
    copy: `onb.guide.${id}`,
    advance: { on: 'tap' },
    collapsible: true,
  });
  const chapter = (stage: BasicsStage, steps: SpotlightStep[]): SpotlightStep[] =>
    steps.map((s) => ({ ...s, stage, stageTitle: `onb.stage.${stage}` }));
  const economy: SpotlightStep[] = [
    tap('welcome'),
    { ...tap('nav'), hands: true, gestures: mapGestures(d.mouse()) },
    step('home', null, d.homeOpened, { anchor: d.homeAnchor, reveal: d.showHome, gate: true }),
    ...(d.cardLayout()
      ? [step('details', '#mobile-sheet [data-mobile="details"]', d.panelOpen)]
      : []),
    step('buildings-tab', '[data-act="tab"][data-arg="buildings"]', d.buildingsTabOpen),
    step('mine', '[data-codex^="b:mine:"]', d.mineCardOpen),
    step('mine-order', '#codex [data-cx-upg="mine"]', d.mineOrdered, { inDialog: true }),
    step('mine-close', '#codex .cx-close', d.dossierClosed, { inDialog: true }),
    step('mine-wait', null, d.mineImproved),
  ];
  const research: SpotlightStep[] = [
    ...(d.cardLayout() ? [step('tech-menu', '[data-phone-tab="more"]', d.techAccessible)] : []),
    step(
      'tech',
      '#holo-tech, #rail-tech, [data-phone-tab="science"], [data-phone-more="science"]',
      d.techOpen,
    ),
    step('research-tab', '#tech [data-ttab="space"]', d.spaceTabOpen),
    step('research', '#tech [data-go="frigate_design"]', d.researchStarted),
    step('research-wait', '#tech [data-tech="frigate_design"]', d.researchDone, { gate: false }),
    step('research-close', '#tech .tw-close', () => !d.techOpen()),
  ];
  const fleet: SpotlightStep[] = [
    step('ships-tab', '[data-act="tab"][data-arg="ships"]', d.shipsTabOpen),
    step('catalog', '[data-act="openunits"][data-arg="ships"]', d.catalogOpen),
    step('ship', '#buildwin [data-unit-info="frigate"] .bw-ih b', d.shipCardOpen),
    step('ship-order', '#codex [data-build="unit:frigate"]', d.shipOrdered, { inDialog: true }),
    step('catalog-close', '#buildwin .tw-close', () => !d.catalogOpen()),
    step('ship-wait', null, d.hasShip),
    step('fleet', null, d.fleetSelected, {
      selector: d.fleetSelector,
      reveal: d.showFleet,
      gate: true,
    }),
    step('move', '[data-cmd="move"]', d.moveArmed),
    step('course', null, () => d.courseSet() || d.coursePicked(), {
      anchor: d.targetAnchor,
      reveal: d.showTarget,
      gate: true,
    }),
    ...(d.cardLayout() ? [step('course-confirm', '[data-cmd="mobile-send"]', d.courseSet)] : []),
    step('capture', null, d.capturedWorld, { reveal: d.showTarget }),
    tap('score'),
  ];
  return [
    ...chapter('economy', economy),
    ...chapter('research', research),
    ...chapter('fleet', fleet),
    ...buildOperationSteps(d.operation),
    ...chapter('finale', [tap('done')]),
  ];
}
