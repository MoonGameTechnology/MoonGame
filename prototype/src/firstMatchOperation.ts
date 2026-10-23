/** The guided first match, part two: one operation against a garrisoned world, in the order a
 * real assault needs its tools. The market comes first (it stands alone), then the hero is
 * refitted and deployed, barracks train militia, a spaceport launches a bomber into the
 * hero's hold, the troops follow, and the hero flies out, strikes, casts Rally and lands.
 * Every step waits for a live fact; the guide never issues an order for the player. */
import {
  GUIDE_ABILITY,
  GUIDE_ASSAULT,
  GUIDE_HERO_MODULE,
  GUIDE_HERO_START_MODULE,
  GUIDE_HERO_START_MODULES,
  GUIDE_TROOP,
  GUIDE_TROOPS,
  GUIDE_WING,
  guideAbilityCast,
  guideAssaultStarted,
  guideBuildingOrdered,
  guideBuilt,
  guideHero,
  guideHeroArrived,
  guideHeroCourseSet,
  guideHeroFleet,
  guideHeroModules,
  guideLot,
  guideStrikeFlying,
  guideTroopsAboard,
  guideTroopsHome,
  guideTroopsLoading,
  guideUnitsOrdered,
  guideWingsAboard,
  guideWingsHome,
} from '../../decisions/firstMatchGuide';
import type { GameData, GameState } from '../../packages/shared-core/src/index';
import type { Rect, SpotlightStep } from './spotlight';

export interface OperationUi {
  mobile: boolean;
  visible(selector: string): boolean;
  selectedWorld(): string | null;
  selectedFleet(): string | null;
  /** Screen state the next step depends on: `details` (phone sheet open), `tab:<name>`,
   *  `spawn` (deploy aim armed), `move`, `strike`, `troops-ready`, `picked:<planet>`. */
  intent(kind: string): boolean;
  anchor(planet: string): Rect | null;
  /** The hero ship's row in the open world card, while the ship exists. */
  heroSelector(): string | null;
  /** Camera and window navigation only, never an order: `world:<id>` selects a world,
   *  `hero` brings up the hero ship, `market:<good>` opens the market on that good, a bare
   *  planet id moves the camera. */
  show(target: string): void;
}

export interface OperationDeps {
  world: () => GameState;
  me: string;
  home: string;
  data: GameData;
  ui: OperationUi;
}

type Stage = 'market' | 'hero' | 'ground' | 'aviation' | 'landing' | 'assault';

export function buildOperationSteps(d: OperationDeps): SpotlightStep[] {
  const { me, home, ui } = d;
  const w = d.world;
  // Fixed at the start of the lesson: the guild's two lots and the main hero.
  const bid = guideLot(w(), 'buy')?.id ?? '';
  const ask = guideLot(w(), 'sell')?.id ?? '';
  const hero = guideHero(w(), me)?.id ?? '';
  // Militia already in the home garrison do not count as trained in the lesson.
  const militia = guideTroopsHome(w(), home);
  const step = (
    stage: Stage,
    id: string,
    target: string | null,
    when: () => boolean,
    extra: Partial<SpotlightStep> = {},
  ): SpotlightStep => ({
    id: `${stage}.${id}`,
    stage,
    stageTitle: `onb.stage.${stage}`,
    target,
    copy: `onb.guide.${stage}.${id}`,
    advance: { on: 'state', when },
    collapsible: true,
    gate: target !== null,
    ...extra,
  });
  const phone = (s: SpotlightStep): SpotlightStep[] => (ui.mobile ? [s] : []);
  // A window that is not on the player's phone bar lives under «More».
  const more = (stage: Stage, item: string) =>
    phone(
      step(
        stage,
        `${item}-more`,
        '[data-phone-tab="more"]',
        () => ui.visible(`[data-phone-tab="${item}"], [data-phone-more="${item}"]`),
        { copy: 'onb.guide.more' },
      ),
    );
  const details = (stage: Stage, id: string) =>
    phone(
      step(stage, id, '#mobile-sheet [data-mobile="details"]', () => ui.intent('details'), {
        copy: 'onb.guide.sheet',
      }),
    );
  const commands = (stage: Stage, id: string, command: string) =>
    phone(
      step(stage, id, '[data-cmd="more"]', () => ui.visible(`[data-cmd="${command}"]`), {
        copy: 'onb.guide.commands',
      }),
    );
  const homeWorld = (stage: Stage) => [
    step(stage, 'home', null, () => ui.selectedWorld() === home, {
      anchor: () => ui.anchor(home),
      reveal: () => ui.show(`world:${home}`),
      gate: true,
      copy: 'onb.guide.home-again',
    }),
    ...details(stage, 'details'),
  ];
  const tab = (stage: Stage, name: string) =>
    step(
      stage,
      `tab-${name}`,
      `[data-act="tab"][data-arg="${name}"]`,
      () => ui.selectedWorld() === home && ui.intent(`tab:${name}`),
      { copy: `onb.guide.tab.${name}` },
    );
  const close = (stage: Stage, id: string) =>
    step(stage, id, '#buildwin .tw-close', () => !ui.visible('#buildwin.show'), {
      copy: 'onb.guide.build.close',
    });
  const building = (stage: Stage, type: string) => [
    step(
      stage,
      `${type}-catalog`,
      '[data-act="openbuild"]',
      () => ui.visible('#buildwin.show [data-bwtab]') || guideBuildingOrdered(w(), home, me, type),
      { copy: 'onb.guide.build.catalog' },
    ),
    step(
      stage,
      `${type}-all`,
      '#buildwin [data-bwtab="*"]',
      () =>
        ui.visible(`#buildwin [data-bw-go="${type}"]`) || guideBuildingOrdered(w(), home, me, type),
      { copy: 'onb.guide.build.all' },
    ),
    step(stage, type, `#buildwin [data-bw-go="${type}"]`, () =>
      guideBuildingOrdered(w(), home, me, type),
    ),
    close(stage, `${type}-close`),
    step(stage, `${type}-wait`, null, () => guideBuilt(w(), home, type)),
  ];
  const units = (stage: Stage, catalog: string, unit: string, enough: () => boolean) => [
    step(
      stage,
      `${unit}-catalog`,
      `[data-act="openunits"][data-arg="${catalog}"]`,
      () => ui.visible(`#buildwin.show [data-unit-go="${unit}"]`) || enough(),
      { copy: 'onb.guide.build.units' },
    ),
    step(stage, unit, `#buildwin [data-unit-go="${unit}"]`, enough),
    close(stage, `${unit}-close`),
  ];
  const heroShip = (stage: Stage) => [
    step(
      stage,
      'hero',
      null,
      () => !!guideHeroFleet(w(), me) && ui.selectedFleet() === guideHeroFleet(w(), me)!.id,
      {
        selector: ui.heroSelector,
        reveal: () => ui.show('hero'),
        gate: true,
        copy: 'onb.guide.hero-ship',
      },
    ),
    ...details(stage, 'hero-details'),
  ];
  const deployed = () => !!guideHeroFleet(w(), me);
  const refitted = () => guideHeroModules(w(), me).includes(GUIDE_HERO_MODULE);
  const trained = () =>
    guideTroopsHome(w(), home) + guideUnitsOrdered(w(), home, me, GUIDE_TROOP) >=
      militia + GUIDE_TROOPS || guideTroopsAboard(w(), me) >= GUIDE_TROOPS;
  const troopsReady = () =>
    guideTroopsHome(w(), home) >= militia + GUIDE_TROOPS ||
    guideTroopsAboard(w(), me) >= GUIDE_TROOPS;
  const wingOrdered = () =>
    guideWingsHome(w(), home) + guideWingsAboard(w(), me) > 0 ||
    guideUnitsOrdered(w(), home, me, GUIDE_WING) > 0;
  const owned = () => w().planets[GUIDE_ASSAULT]?.owner === me;
  const course = (stage: Stage) => [
    step(
      stage,
      'move',
      '[data-cmd="move"]',
      () => ui.intent('move') || guideHeroCourseSet(w(), me),
    ),
    step(
      stage,
      'course',
      null,
      () => guideHeroCourseSet(w(), me) || ui.intent(`picked:${GUIDE_ASSAULT}`),
      {
        anchor: () => ui.anchor(GUIDE_ASSAULT),
        reveal: () => ui.show(GUIDE_ASSAULT),
        gate: true,
      },
    ),
    ...phone(
      step(stage, 'send', '[data-cmd="mobile-send"]', () => guideHeroCourseSet(w(), me), {
        copy: 'onb.guide.course-confirm',
      }),
    ),
    step(stage, 'flight', null, () => guideHeroArrived(w(), me), {
      reveal: () => ui.show(GUIDE_ASSAULT),
    }),
  ];
  return [
    // The guild buys metal and sells microelectronics: one lot each way.
    ...more('market', 'market'),
    step(
      'market',
      'open',
      '#rail-market, [data-phone-tab="market"], [data-phone-more="market"]',
      () => ui.visible('#market.show') || !guideLot(w(), 'buy'),
    ),
    step('market', 'sell', `#market [data-mktake="${bid}"]`, () => !guideLot(w(), 'buy'), {
      reveal: () => ui.show('market:metal'),
    }),
    step(
      'market',
      'tab',
      '#market [data-mtab="microelectronics"]',
      () => ui.visible(`#market [data-mktake="${ask}"]`) || !guideLot(w(), 'sell'),
    ),
    step('market', 'buy', `#market [data-mktake="${ask}"]`, () => !guideLot(w(), 'sell'), {
      reveal: () => ui.show('market:microelectronics'),
    }),
    step('market', 'close', '#market .mk-close', () => !ui.visible('#market.show')),

    // Both utility bays are full: the cargo bay goes in only after the engine comes out.
    ...more('hero', 'production'),
    step(
      'hero',
      'yard',
      '#holo-constructor, #rail-constructor, [data-phone-tab="production"], [data-phone-more="production"]',
      () => ui.visible('#constructor.show') || deployed(),
    ),
    step(
      'hero',
      'heroes',
      '[data-ctab="heroes"]',
      () => ui.visible('[data-htab="ship"]') || deployed(),
    ),
    step(
      'hero',
      'pick',
      `[data-hsel="${hero}"]`,
      () => ui.visible(`.hx-chip.sel[data-hsel="${hero}"]`) || deployed(),
    ),
    step(
      'hero',
      'ship',
      '[data-htab="ship"]',
      () => ui.visible(`[data-huninstall="${hero}"]`) || refitted() || deployed(),
    ),
    step(
      'hero',
      'remove',
      `[data-huninstall="${hero}"][data-mod="${GUIDE_HERO_START_MODULE}"]`,
      () => guideHeroModules(w(), me).length < GUIDE_HERO_START_MODULES.length || refitted(),
    ),
    step('hero', 'install', `[data-hinstall="${hero}"][data-mod="${GUIDE_HERO_MODULE}"]`, refitted),
    step('hero', 'deploy', `[data-hspawn="${hero}"]`, () => ui.intent('spawn') || deployed()),
    step('hero', 'world', null, deployed, {
      anchor: () => ui.anchor(home),
      reveal: () => ui.show(home),
      gate: true,
    }),

    // Barracks, then militia from them.
    ...homeWorld('ground'),
    tab('ground', 'buildings'),
    ...building('ground', 'barracks'),
    tab('ground', 'ground'),
    ...units('ground', 'ground', GUIDE_TROOP, trained),
    step('ground', 'troops-wait', null, troopsReady),

    // A spaceport, a bomber, and the bomber aboard the hero ship.
    ...homeWorld('aviation'),
    tab('aviation', 'buildings'),
    ...building('aviation', 'spaceport'),
    tab('aviation', 'shuttle'),
    ...units('aviation', 'shuttle', GUIDE_WING, wingOrdered),
    step(
      'aviation',
      'wing-wait',
      null,
      () => guideWingsHome(w(), home) + guideWingsAboard(w(), me) > 0,
    ),
    step('aviation', 'load', '[data-act="wingload"]', () => guideWingsAboard(w(), me) > 0),

    // Troops into the hold, then the flight.
    ...heroShip('landing'),
    ...commands('landing', 'troops-commands', 'troops'),
    step(
      'landing',
      'troops',
      '[data-cmd="troops"]',
      () =>
        ui.visible(`[data-cmd="tmax"][data-unit="${GUIDE_TROOP}"]`) ||
        guideTroopsLoading(w(), me) + guideTroopsAboard(w(), me) > 0,
    ),
    step(
      'landing',
      'troops-max',
      `[data-cmd="tmax"][data-unit="${GUIDE_TROOP}"][data-dir="1"]`,
      () =>
        ui.intent('troops-ready') || guideTroopsLoading(w(), me) + guideTroopsAboard(w(), me) > 0,
    ),
    step(
      'landing',
      'troops-ok',
      '[data-cmd="tok"]',
      () => guideTroopsLoading(w(), me) + guideTroopsAboard(w(), me) > 0,
    ),
    step('landing', 'troops-aboard', null, () => guideTroopsAboard(w(), me) >= GUIDE_TROOPS),
    ...course('landing'),

    // At the world: the strike from the hold, Rally, the landing.
    ...heroShip('assault'),
    step(
      'assault',
      'strike',
      '[data-act="wingstrike"]',
      () => ui.intent('strike') || guideStrikeFlying(w(), me),
    ),
    step('assault', 'strike-target', null, () => guideStrikeFlying(w(), me), {
      anchor: () => ui.anchor(GUIDE_ASSAULT),
      reveal: () => ui.show(GUIDE_ASSAULT),
      gate: true,
    }),
    ...commands('assault', 'cast-commands', 'cast'),
    step(
      'assault',
      'cast',
      '[data-cmd="cast"]',
      () =>
        ui.visible(`[data-cmd="castdo"][data-ab="${GUIDE_ABILITY}"]`) ||
        guideAbilityCast(w(), me, d.data),
    ),
    step('assault', 'rally', `[data-cmd="castdo"][data-ab="${GUIDE_ABILITY}"]`, () =>
      guideAbilityCast(w(), me, d.data),
    ),
    // The phone keeps the landing button in the open sheet; the cast collapsed it.
    ...details('assault', 'land-details'),
    step('assault', 'land', '[data-act="assault"]', () => guideAssaultStarted(w(), me)),
    step('assault', 'capture', null, owned, { reveal: () => ui.show(GUIDE_ASSAULT) }),
  ];
}
