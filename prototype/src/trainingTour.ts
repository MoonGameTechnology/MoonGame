/** Sector Zero: short instructions over actual controls, followed by real world results.
 * Stage skipping and folding remain available; the guide never issues orders for the player. */
import {
  trainingCourse,
  trainingRecruits,
  trainingFleet,
  trainingGridDone,
  trainingTroopsReady,
  type TrainingFleetRole,
} from '../../decisions/trainingGuide';
import {
  fleetGone,
  owns,
  productionGrew,
  shipBuilt,
  squadronHome,
  trainingWon,
  type TrainingBaseline,
  type TrainingStage,
} from '../../decisions/trainingStages';
import type { GameData, GameState, PlayerId } from '../../packages/shared-core/src/index';
import type { Rect, SpotlightStep, StepAdvance } from './spotlight';

export interface TrainingTourUi {
  mobile: boolean;
  visible(selector: string): boolean;
  selectedWorld(): string | null;
  selectedFleet(): string | null;
  intent(kind: string): boolean;
  anchor(target: string): Rect | null;
  fleetSelector(role: TrainingFleetRole): string | null;
  /** Camera/panel navigation only: never an order or a change to the game state. */
  show(target: string): void;
}
export interface TrainingTourDeps {
  world: () => GameState;
  me: PlayerId;
  data: GameData;
  baseline: TrainingBaseline;
  ui: TrainingTourUi;
}

export function buildTrainingTour(d: TrainingTourDeps): SpotlightStep[] {
  const { me, data, baseline: b, ui } = d;
  const state = (when: () => boolean): StepAdvance => ({ on: 'state', when });
  const action = (type: string): StepAdvance => ({ on: 'action', type });
  const f = (role: TrainingFleetRole) => trainingFleet(d.world(), me, role);
  const has = (id: string) => owns(d.world(), me, id);
  const visible = (selector: string) => state(() => ui.visible(selector));
  const step = (
    stage: TrainingStage,
    id: string,
    target: string | null,
    advance: StepAdvance,
    extra: Partial<SpotlightStep> = {},
  ): SpotlightStep => ({
    id: `${stage}.${id}`,
    stage,
    target,
    copy: `training.guide.${stage}.${id}`,
    advance,
    collapsible: true,
    holdClock: target !== null,
    ...extra,
  });
  const world = (stage: TrainingStage, id: string, planet: string) =>
    step(
      stage,
      id,
      null,
      state(() => ui.selectedWorld() === planet),
      {
        anchor: () => ui.anchor(planet),
        reveal: () => ui.show(`world:${planet}`),
        holdClock: true,
        copy: `training.guide.world.${planet}`,
      },
    );
  const fleet = (stage: TrainingStage, id: string, role: TrainingFleetRole) =>
    step(
      stage,
      id,
      null,
      state(() => !!f(role) && ui.selectedFleet() === f(role)!.id),
      {
        selector: () => ui.fleetSelector(role),
        reveal: () => ui.show(`fleet:${role}`),
        holdClock: true,
        copy: `training.guide.fleet-role.${role}`,
      },
    );
  const details = (stage: TrainingStage, id: string) =>
    ui.mobile
      ? [
          step(
            stage,
            id,
            '#mobile-sheet [data-mobile="details"]',
            state(() => ui.intent('details')),
            { copy: 'training.guide.details' },
          ),
        ]
      : [];
  const commands = (stage: TrainingStage, id: string, command: string) =>
    ui.mobile
      ? [
          step(stage, id, '[data-cmd="more"]', visible(`[data-cmd="${command}"]`), {
            copy: 'training.guide.commands',
          }),
        ]
      : [];
  const tab = (stage: TrainingStage, id: string, name: string) =>
    step(
      stage,
      id,
      `[data-act="tab"][data-arg="${name}"]`,
      state(() => ui.intent(`tab:${name}`)),
      { copy: `training.guide.tab.${name}` },
    );
  const close = (stage: TrainingStage, id: string) =>
    step(
      stage,
      id,
      '#buildwin .tw-close',
      state(() => !ui.visible('#buildwin.show')),
      { copy: 'training.guide.catalog-close' },
    );
  const at = (role: TrainingFleetRole, planet: string) =>
    !!f(role) && f(role)!.location === planet && !f(role)!.movement && !f(role)!.battleId;
  const route = (
    stage: TrainingStage,
    id: string,
    role: TrainingFleetRole,
    planet: string,
    arrived: () => boolean,
  ) => [
    fleet(stage, `${id}-fleet`, role),
    step(
      stage,
      `${id}-move`,
      '[data-cmd="move"]',
      state(() => ui.intent('move') || trainingCourse(f(role), planet)),
      { copy: 'training.guide.move' },
    ),
    step(
      stage,
      `${id}-course`,
      null,
      state(() => trainingCourse(f(role), planet) || ui.intent(`picked:${planet}`)),
      {
        anchor: () => ui.anchor(planet),
        reveal: () => ui.show(planet),
        holdClock: true,
        copy: `training.guide.course.${planet}`,
      },
    ),
    ...(ui.mobile
      ? [
          step(
            stage,
            `${id}-send`,
            '[data-cmd="mobile-send"]',
            state(() => trainingCourse(f(role), planet)),
            { copy: 'training.guide.send' },
          ),
        ]
      : []),
    step(stage, id, null, state(arrived), { reveal: () => ui.show(planet) }),
    ...(role === 'hero' ? [fleet(stage, `${id}-arrived-fleet`, role)] : []),
  ];
  const building = (stage: TrainingStage, id: string, type: string) => [
    step(stage, `${id}-catalog`, '[data-act="openbuild"]', visible('#buildwin.show [data-bwtab]'), {
      copy: 'training.guide.build.catalog',
    }),
    step(
      stage,
      `${id}-all`,
      '#buildwin [data-bwtab="*"]',
      visible(`#buildwin [data-bw-go="${type}"]`),
      { copy: 'training.guide.build.all' },
    ),
    step(stage, `${id}-order`, `#buildwin [data-bw-go="${type}"]`, action('building.construct'), {
      copy: `training.guide.build.${type}`,
    }),
    close(stage, `${id}-close`),
  ];
  const troops = (stage: TrainingStage, id: string, n: number) => [
    fleet(stage, `${id}-fleet`, 'hero'),
    ...details(stage, `${id}-details`),
    ...commands(stage, `${id}-commands`, 'troops'),
    step(
      stage,
      `${id}-menu`,
      '[data-cmd="troops"]',
      visible('[data-cmd="tmax"][data-unit="heavy_infantry"]'),
      { copy: 'training.guide.load.menu' },
    ),
    step(
      stage,
      `${id}-amount`,
      '[data-cmd="tmax"][data-unit="heavy_infantry"][data-dir="1"]',
      state(() => ui.intent('troops-ready')),
      { copy: 'training.guide.load.amount' },
    ),
    step(stage, `${id}-confirm`, '[data-cmd="tok"]', action('army.load'), {
      copy: 'training.guide.load.confirm',
    }),
    step(
      stage,
      id,
      null,
      state(() => trainingTroopsReady(f('hero'), n)),
    ),
  ];
  const assault = (stage: TrainingStage, id: string, planet: string): SpotlightStep[] => {
    const bombard: SpotlightStep[] =
      planet === 'target'
        ? [
            step(
              stage,
              `${id}-bombard`,
              '[data-act="bombard"][data-arg="on"]',
              state(() => {
                return !!f('hero')?.bombarding || has(planet);
              }),
              { copy: 'training.guide.assault.bombard' },
            ),
            step(
              stage,
              `${id}-bombard-wait`,
              null,
              state(
                () =>
                  has(planet) ||
                  !d.world().planets[planet]?.buildings.some((b) => b.type === 'fort'),
              ),
              { copy: 'training.guide.assault.bombard-wait' },
            ),
            step(
              stage,
              `${id}-bombard-stop`,
              '[data-act="bombard"][data-arg="off"]',
              state(() => !f('hero')?.bombarding),
              { copy: 'training.guide.assault.bombard-stop' },
            ),
          ]
        : [];
    return [
      ...route(stage, `${id}-orbit`, 'hero', planet, () => at('hero', planet)),
      ...details(stage, `${id}-details`),
      ...bombard,
      step(
        stage,
        `${id}-land`,
        '[data-act="assault"]',
        state(() => has(planet) || ui.intent(`assault:${planet}`)),
        { copy: 'training.guide.assault.land' },
      ),
      step(
        stage,
        id,
        null,
        state(() => has(planet)),
        { reveal: () => ui.show(planet) },
      ),
    ];
  };
  return [
    world('prep', 'base', 'base'),
    ...details('prep', 'details'),
    tab('prep', 'ships', 'ships'),
    fleet('prep', 'fleet', 'hero'),
    world('economy', 'base', 'base'),
    ...details('economy', 'details'),
    tab('economy', 'buildings', 'buildings'),
    ...building('economy', 'mine', 'mine'),
    step(
      'economy',
      'mine',
      null,
      state(() => productionGrew(d.world(), me, b, data)),
    ),
    tab('economy', 'ships', 'ships'),
    step(
      'economy',
      'catalog',
      '[data-act="openunits"][data-arg="ships"]',
      visible('#buildwin.show [data-unit-info="cruiser"]'),
    ),
    step('economy', 'ship-order', '#buildwin [data-unit-go="cruiser"]', action('unit.build')),
    close('economy', 'ship-close'),
    step(
      'economy',
      'ship',
      null,
      state(() => shipBuilt(d.world(), me, b)),
    ),
    ...(ui.mobile
      ? [
          step(
            'research',
            'more',
            '[data-phone-tab="more"]',
            visible('[data-phone-tab="science"], [data-phone-more="science"]'),
          ),
        ]
      : []),
    step(
      'research',
      'open',
      '#holo-tech, #rail-tech, [data-phone-tab="science"], [data-phone-more="science"]',
      visible('#tech.show'),
    ),
    step(
      'research',
      'space',
      '#tech [data-ttab="space"]',
      visible('#tech [data-go="orbital_defense_grid"]'),
    ),
    step(
      'research',
      'order',
      '#tech [data-go="orbital_defense_grid"]',
      state(
        () =>
          trainingGridDone(d.world(), me) ||
          d
            .world()
            .players[me]?.technologies?.active?.some(
              (t) => t.technology === 'orbital_defense_grid',
            ) === true,
      ),
    ),
    step(
      'research',
      'grid',
      '#tech [data-tech="orbital_defense_grid"]',
      state(() => trainingGridDone(d.world(), me)),
      { holdClock: false },
    ),
    step(
      'research',
      'close',
      '#tech .tw-close',
      state(() => !ui.visible('#tech.show')),
    ),
    ...route('expand', 'neutral', 'support', 'neutral', () => has('neutral')),
    step('missions', 'open', '[data-missions]', visible('#missionpanel:not([hidden])')),
    step(
      'missions',
      'close',
      '[data-missions]',
      state(() => !ui.visible('#missionpanel:not([hidden])')),
    ),
    ...route('missions', 'beacon', 'support', 'station', () => has('station')),
    fleet('fleet', 'select', 'support'),
    ...details('fleet', 'details'),
    ...commands('fleet', 'split-commands', 'split'),
    step('fleet', 'split-open', '[data-cmd="split"]', visible('#splitdlg')),
    step(
      'fleet',
      'split-count',
      '#splitdlg [data-sx="inc"][data-n="1"]',
      visible('#splitdlg [data-sx="confirm"]:not(:disabled)'),
    ),
    step('fleet', 'split', '#splitdlg [data-sx="confirm"]', action('fleet.split')),
    ...commands('fleet', 'merge-commands', 'merge'),
    step(
      'fleet',
      'merge-open',
      '[data-cmd="merge"]',
      state(() => ui.intent('merge')),
    ),
    step(
      'fleet',
      'merge',
      null,
      ui.mobile ? state(() => ui.intent('merge-confirm')) : action('fleet.merge'),
      {
        holdClock: true,
        anchor: () => ui.anchor('fleet:support'),
        reveal: () => ui.show('station'),
      },
    ),
    ...(ui.mobile
      ? [
          step('fleet', 'merge-send', '[data-cmd="mobile-send"]', action('fleet.merge'), {
            copy: 'training.guide.send',
          }),
        ]
      : []),
    ...route('battle', 'patrol', 'hero', 'open_reach', () => fleetGone(d.world(), 'p2_patrol')),
    ...details('battle', 'details'),
    ...commands('battle', 'hero-commands', 'cast'),
    step('battle', 'hero-open', '[data-cmd="cast"]', visible('[data-cmd="castdo"]')),
    step('battle', 'hero', '[data-cmd="castdo"]:not(:disabled)', action('hero.ability')),
    ...route('retreat', 'battle', 'hero', 'target', () => !!f('hero')?.battleId),
    ...details('retreat', 'details'),
    step('retreat', 'window', '[data-act="openbattle"]', visible('#battlewin.show')),
    step(
      'retreat',
      'open',
      '[data-battle-retreat]:not(:disabled)',
      state(() => ui.intent('retreat')),
    ),
    step('retreat', 'retreat', null, action('fleet.retreat'), {
      holdClock: true,
      anchor: () => ui.anchor('open_reach'),
      reveal: () => ui.show('open_reach'),
    }),
    step(
      'retreat',
      'safe',
      null,
      state(() => at('hero', 'open_reach')),
    ),
    ...route('retreat', 'base', 'hero', 'base', () => at('hero', 'base')),
    ...details('retreat', 'repair-details'),
    step('retreat', 'repair', '[data-act="dockrepair"]', action('fleet.repair')),
    fleet('carrier', 'select', 'carrier'),
    step(
      'carrier',
      'move',
      '[data-cmd="move"]',
      state(() => ui.intent('move')),
    ),
    step(
      'carrier',
      'position',
      null,
      state(() => ui.intent('carrier-course')),
      {
        holdClock: true,
        anchor: () => ui.anchor('carrier-edge'),
        reveal: () => ui.show('carrier-edge'),
      },
    ),
    ...(ui.mobile
      ? [
          step(
            'carrier',
            'send',
            '[data-cmd="mobile-send"]',
            state(() => !!f('carrier')?.movement || !!f('carrier')?.edge),
          ),
        ]
      : []),
    step(
      'carrier',
      'arrive',
      null,
      state(() => !!f('carrier')?.edge && !f('carrier')?.movement),
    ),
    ...details('carrier', 'details'),
    step(
      'carrier',
      'strike-open',
      '[data-act="wingstrike"]',
      state(() => ui.intent('strike')),
    ),
    step('carrier', 'strike', null, action('shuttle.strike'), {
      holdClock: true,
      anchor: () => ui.anchor('outpost'),
      reveal: () => ui.show('outpost'),
    }),
    step(
      'carrier',
      'home',
      null,
      state(() => squadronHome(d.world(), me)),
    ),
    ...troops('assault', 'load', 2),
    ...assault('assault', 'outpost', 'outpost'),
    world('fortify', 'outpost', 'outpost'),
    ...details('fortify', 'details'),
    tab('fortify', 'buildings', 'buildings'),
    ...building('fortify', 'fort', 'fort'),
    ...building('fortify', 'defense', 'orbital_aa'),
    step(
      'fortify',
      'build',
      null,
      state(
        () =>
          has('outpost') &&
          ['fort', 'orbital_aa'].every((type) =>
            d.world().planets.outpost?.buildings.some((x) => x.type === type),
          ) &&
          (d.world().planets.outpost?.garrison ?? []).some((u) => u.count > 0),
      ),
    ),
    ...route(
      'finale',
      'rally-support',
      'support',
      'base',
      () => at('support', 'base') || !f('support'),
    ),
    ...route('finale', 'rally-hero', 'hero', 'base', () => at('hero', 'base')),
    world('finale', 'base', 'base'),
    ...details('finale', 'details'),
    tab('finale', 'ground', 'ground'),
    step(
      'finale',
      'catalog',
      '[data-act="openunits"][data-arg="ground"]',
      visible('#buildwin.show [data-unit-go="heavy_infantry"]'),
    ),
    step(
      'finale',
      'recruit',
      '#buildwin [data-unit-go="heavy_infantry"]',
      state(() => trainingRecruits(d.world(), me) >= 8),
      { holdClock: false },
    ),
    close('finale', 'recruit-close'),
    step(
      'finale',
      'recruit-wait',
      null,
      state(() =>
        (d.world().planets.base?.garrison ?? []).some(
          (u) => u.unit === 'heavy_infantry' && u.count >= 8,
        ),
      ),
    ),
    ...troops('finale', 'load', 8),
    ...assault('finale', 'target', 'target'),
    step(
      'finale',
      'result',
      null,
      state(() => trainingWon(d.world(), me)),
    ),
  ];
}
