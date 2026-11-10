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
  productionCount?(): number;
  selectedWorld(): string | null;
  selectedFleet(): string | null;
  /** Screen state the next step depends on: `details` (phone sheet open), `tab:<name>`,
   *  `spawn` (deploy aim armed), `move`, `strike`, `troops-ready`, `picked:<planet>`. */
  intent(kind: string): boolean;
  anchor(planet: string): Rect | null;
  /** The hangar badge of a world or a carrier (`spot` is its id), as drawn this frame. */
  hangar(spot: string): Rect | null;
  /** The squadron picked on the map, if any. */
  selectedSquadron(): string | null;
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

/** «Построить» мира: кнопка карточки на ПК или её копия в нижней полосе листа телефона. */
const BUILD_OPEN = '[data-act="openbuild"], [data-lift="openbuild"]';
/** Линия окна производства. На телефоне каталог другой линии закрывает список линий —
 *  тогда подсвечивается «←», и следующим кадром уже видна нужная линия. */
const LANE = (lane: string) => `#constructor [data-pw-lane="${lane}"], #constructor .pw-lane-back`;

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

function productionQuantity(stage: Stage, unit: string, wanted: number, enough: () => boolean, ui: OperationUi): SpotlightStep {
  return step(stage, `${unit}-quantity`, null, () => (ui.productionCount?.() ?? 1) === wanted || enough(), {
    selector: () => `#constructor [data-cncount="${(ui.productionCount?.() ?? 1) < wanted ? '+' : '-'}"]`,
    gate: true,
    copy: wanted === GUIDE_TROOPS ? 'onb.guide.ground.quantity' : 'onb.guide.aviation.quantity',
  });
}

export function buildOperationSteps(d: OperationDeps): SpotlightStep[] {
  const { me, home, ui } = d;
  const w = d.world;
  // Fixed at the start of the lesson: the guild's two lots and the main hero.
  const bid = guideLot(w(), 'buy')?.id ?? '';
  const ask = guideLot(w(), 'sell')?.id ?? '';
  const hero = guideHero(w(), me)?.id ?? '';
  // Militia already in the home garrison do not count as trained in the lesson.
  const militia = guideTroopsHome(w(), home);

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
  const close = (stage: Stage, id: string) =>
    step(stage, id, '#constructor .cn-close', () => !ui.visible('#constructor.show'), {
      copy: 'onb.guide.build.close',
    });
  const building = (stage: Stage, type: string) => [
    step(
      stage,
      `${type}-catalog`,
      BUILD_OPEN,
      () => ui.visible('#constructor.show') || guideBuildingOrdered(w(), home, me, type),
      { copy: 'onb.guide.build.catalog' },
    ),
    step(
      stage,
      `${type}-lane`,
      LANE('buildings'),
      () => ui.visible('#constructor.show [data-bwtab]') || guideBuildingOrdered(w(), home, me, type),
      { copy: 'onb.guide.yard.buildings' },
    ),
    step(
      stage,
      `${type}-all`,
      '#constructor [data-bwtab="*"]',
      () =>
        ui.visible(`#constructor [data-bw-go="${type}"]`) || guideBuildingOrdered(w(), home, me, type),
      { copy: 'onb.guide.build.all' },
    ),
    step(stage, type, `#constructor [data-bw-go="${type}"]`, () =>
      guideBuildingOrdered(w(), home, me, type),
    ),
    close(stage, `${type}-close`),
    step(stage, `${type}-wait`, null, () => guideBuilt(w(), home, type)),
  ];
  // Юниты заказывают в окне «Построить» (UIX-10.12): открыть окно, затем его раздел, а
  // челнок живёт ещё и в подразделе «Шаттлы».
  const listed = (unit: string) => ui.visible(`#constructor.show [data-cnhull="${unit}"]`);
  const units = (stage: Stage, yard: 'infantry' | 'squads', unit: string, enough: () => boolean) => [
    step(stage, `${unit}-yard`, BUILD_OPEN, () => ui.visible('#constructor.show') || enough(), { copy: 'onb.guide.build.yard' }),
    step(stage, `${unit}-catalog`, LANE(yard === 'squads' ? 'shuttles' : 'mobilization'), () => listed(unit) || ui.visible(`#constructor .pw-catalog[data-lane="${yard === 'squads' ? 'shuttles' : 'mobilization'}"]`) || enough(), { copy: yard === 'squads' ? 'onb.guide.yard.squads' : 'onb.guide.yard.infantry' }),
    // Мобилизация открывается на разделе, где игрок был в прошлый раз (могли быть «Герои»).
    ...(yard === 'infantry' ? [step(stage, `${unit}-section`, '#constructor [data-ctab="infantry"]', () => listed(unit) || enough(), { copy: 'onb.guide.yard.infantry' })] : []),
    step(stage, `${unit}-select`, `#constructor [data-cnhull="${unit}"]`, () => ui.visible(`#constructor.pw-fitting-open [data-cnhull="${unit}"].on`) || enough(), { copy: 'onb.guide.build.units' }),
    productionQuantity(stage, unit, stage === 'ground' ? GUIDE_TROOPS : 1, enough, ui),
    step(stage, unit, '#constructor [data-cnbuild]', enough),
    step(stage, `${unit}-fitting-close`, '#constructor [data-pw-fit-close]', () => !ui.visible('#constructor.pw-fitting-open') || !ui.visible('#constructor.show'), { copy: 'onb.guide.build.close' }),
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
  const deployed = (preparing = false) => !!guideHeroFleet(w(), me) || (preparing && !!guideHero(w(), me)?.mobilization);
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
      () => ui.visible('#constructor.show') || deployed(true),
    ),
    step(
      'hero',
      'mobilization',
      LANE('mobilization'),
      () => ui.visible('[data-ctab="heroes"]') || deployed(true),
      { copy: 'production.mobilization' },
    ),
    step(
      'hero',
      'heroes',
      '[data-ctab="heroes"]',
      () => ui.visible('[data-htab="ship"]') || deployed(true),
    ),
    step(
      'hero',
      'pick',
      `[data-hsel="${hero}"]`,
      () => ui.visible(`.hx-chip.sel[data-hsel="${hero}"]`) || deployed(true),
    ),
    step(
      'hero',
      'ship',
      '[data-htab="ship"]',
      () => ui.visible('.pw-hero-equipment > summary') || refitted() || deployed(true),
    ),
    step('hero', 'equipment', '.pw-hero-equipment > summary', () => ui.visible('.pw-hero-equipment[open]') || refitted() || deployed(true), { copy: 'onb.guide.hero.equipment' }),
    step(
      'hero',
      'remove',
      `[data-huninstall="${hero}"][data-mod="${GUIDE_HERO_START_MODULE}"]`,
      () => guideHeroModules(w(), me).length < GUIDE_HERO_START_MODULES.length || refitted(),
    ),
    step('hero', 'utility-slot', '.pw-hardware-slot.off[data-pw-hardware-slot="utility"]', () => ui.visible(`[data-hinstall="${hero}"][data-mod="${GUIDE_HERO_MODULE}"]`) || refitted(), { copy: 'onb.guide.hero.utility-slot' }),
    step('hero', 'install', `[data-hinstall="${hero}"][data-mod="${GUIDE_HERO_MODULE}"]`, refitted),
    step('hero', 'equipment-close', '.pw-hero-equipment[open] > summary', () => !ui.visible('.pw-hero-equipment[open]') || deployed(true), { copy: 'onb.guide.hero.equipment-close' }),
    step('hero', 'deploy', `[data-hspawn="${hero}"]`, () => ui.intent('spawn') || deployed(true)),
    close('hero', 'close'),
    step('hero', 'world', null, () => deployed(true), {
      anchor: () => ui.anchor(home),
      reveal: () => ui.show(home),
      gate: true,
    }),

    // Barracks, then militia from them.
    ...homeWorld('ground'),
    ...building('ground', 'barracks'),
    ...units('ground', 'infantry', GUIDE_TROOP, trained),
    step('ground', 'troops-wait', null, troopsReady),

    // A spaceport, a bomber, and the bomber aboard the hero ship.
    ...homeWorld('aviation'),
    ...building('aviation', 'spaceport'),
    ...units('aviation', 'squads', GUIDE_WING, wingOrdered),
    step(
      'aviation',
      'wing-wait',
      null,
      () => guideWingsHome(w(), home) + guideWingsAboard(w(), me) > 0 && deployed(),
    ),
    // Эскадра командуется со своей карточки: её открывает значок ангара у мира (UIX-10.14).
    step('aviation', 'wing-badge', null, () => !!ui.selectedSquadron() || guideWingsAboard(w(), me) > 0, { anchor: () => ui.hangar(home), reveal: () => ui.show(home), gate: true }),
    ...details('aviation', 'wing-details'),
    step('aviation', 'load', '[data-act="sqload"]', () => guideWingsAboard(w(), me) > 0),

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

    // At the world: the strike from the hold (its squadron picked by the hangar badge beside
    // the hero ship), then the ship again for Rally, the landing.
    step('assault', 'wing', null, () => !!ui.selectedSquadron() || ui.intent('strike') || guideStrikeFlying(w(), me), { anchor: () => ui.hangar(guideHeroFleet(w(), me)?.id ?? ''), reveal: () => ui.show(GUIDE_ASSAULT), gate: true }),
    ...details('assault', 'wing-details'),
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
    ...heroShip('assault'),
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
    step('assault', 'land', '[data-cmd="attack"]', () => guideAssaultStarted(w(), me)),
    step('assault', 'capture', null, owned, { reveal: () => ui.show(GUIDE_ASSAULT) }),
  ];
}
