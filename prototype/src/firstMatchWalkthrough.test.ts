import { describe, expect, it } from 'vitest';
import { data, order, advance } from './game';
import {
  GUIDE_ABILITY,
  GUIDE_ASSAULT,
  GUIDE_HERO_MODULE,
  GUIDE_HERO_START_MODULE,
  GUIDE_HERO_START_MODULES,
  GUIDE_HULL,
  GUIDE_TARGET,
  GUIDE_TECH,
  GUIDE_TROOP,
  GUIDE_TROOPS,
  GUIDE_WING,
  guideAbilityCast,
  guideBuilt,
  guideFleet,
  guideHero,
  guideHeroArrived,
  guideHeroCourseSet,
  guideHeroFleet,
  guideHeroModules,
  guideLot,
  guideStrikeFlying,
  guideTroopsAboard,
  guideTroopsHome,
  guideWingsAboard,
  guideWingsHome,
} from '../../decisions/firstMatchGuide';
import type { GameState } from '../../packages/shared-core/src/index';
import { buildOperationSteps, type OperationUi } from './firstMatchOperation';
import { lessonWorld } from './firstMatchTour.fixture';
import { SpotlightTour, type TourResult } from './spotlight';

/**
 * THE WHOLE LESSON BY CORE ORDERS: every chapter of the guided first match is played on the
 * real duel-1 lesson world with the orders its buttons send, and the guide of the operation
 * follows along: before each order it must still be waiting on that order's chapter, and
 * after the last one it must be done. If a chapter stops being playable here — a price grew
 * past the treasury, a range shrank below the lane, a garrison outgrew the landing — or the
 * guide waits on a fact the order never produces, this names the chapter, long before a
 * player meets a guide that cannot be finished.
 */

const HOUR = 3_600_000;
const ME = 'p1';
const HOME = 'home_1';
let seq = 0;

function act(s: GameState, type: string, payload: unknown): GameState {
  const r = order(
    s,
    { id: `w:${ME}:${++seq}`, type, playerId: ME, payload, issuedAt: s.time },
    s.time,
  );
  expect({ type, error: r.error }).toEqual({ type, error: undefined });
  return r.state;
}
const wait = (s: GameState, hours: number): GameState => advance(s, s.time + hours * HOUR).state;
function until(s: GameState, ok: (s: GameState) => boolean, limit = 48): GameState {
  let cur = s;
  for (let h = 0; h < limit && !ok(cur); h += 0.25) cur = wait(cur, 0.25);
  expect(ok(cur)).toBe(true);
  return cur;
}

describe('guided first match: every chapter is playable by real orders', () => {
  it('from the first mine upgrade to the landing on a garrisoned world', () => {
    let s = lessonWorld();
    const start = s.time;
    const lot = { buy: guideLot(s, 'sell')!, sell: guideLot(s, 'buy')! };
    expect(guideHeroModules(s, ME)).toEqual(GUIDE_HERO_START_MODULES);
    // Both utility bays are taken: the cargo bay goes in only after a module comes out.
    const full = order(
      s,
      {
        id: 'w:full',
        type: 'hero.install',
        playerId: ME,
        payload: { heroId: guideHero(s, ME)!.id, moduleId: GUIDE_HERO_MODULE },
        issuedAt: s.time,
      },
      s.time,
    );
    expect(full.error).toBeDefined();
    expect(guideHeroFleet(s, ME)).toBeUndefined(); // the hero waits in reserve
    expect(s.planets[GUIDE_ASSAULT]!.garrison.some((u) => u.count > 0)).toBe(true);

    // Basics: mine, research, frigate, the free sector.
    s = act(s, 'building.upgrade', { planetId: HOME, building: 'mine' });
    s = act(s, 'technology.research', { technology: GUIDE_TECH });
    s = until(s, (x) => !!x.players[ME]!.technologies?.completed.includes(GUIDE_TECH));
    s = act(s, 'unit.build', { planetId: HOME, unit: GUIDE_HULL });
    s = until(s, (x) => !!guideFleet(x, ME));
    s = act(s, 'fleet.move', { fleetId: guideFleet(s, ME)!.id, to: GUIDE_TARGET });
    s = until(s, (x) => x.planets[GUIDE_TARGET]!.owner === ME);

    // The operation's guide over a screen where every button is on show, the home world and
    // the hero ship are selected and no window is open: only the world facts hold it back.
    const ui: OperationUi = {
      mobile: false,
      visible: (selector) => !selector.includes('.show'),
      selectedWorld: () => HOME,
      selectedFleet: () => guideHeroFleet(s, ME)?.id ?? null,
      intent: (kind) => kind === 'details' || kind.startsWith('tab:'),
      anchor: () => null,
      heroSelector: () => null,
      show: () => {},
    };
    const steps = buildOperationSteps({ world: () => s, me: ME, home: HOME, data, ui });
    let result: TourResult | undefined;
    const host = { locate: () => null, render: () => {} };
    const tour = new SpotlightTour(steps, host, (r) => (result = r));
    const at = () => {
      tour.refresh();
      return steps[tour.index]?.id;
    };
    tour.start();

    // Market: one lot sold, one lot bought, both with the guild.
    expect(at()).toBe('market.open');
    const before = { ...s.players[ME]!.resources };
    s = act(s, 'market.take', { id: lot.sell.id });
    expect(at()).toBe('market.buy');
    s = act(s, 'market.take', { id: lot.buy.id });
    expect(guideLot(s, 'sell')).toBeUndefined();
    expect(guideLot(s, 'buy')).toBeUndefined();
    expect(s.players[ME]!.resources.microelectronics).toBe(
      before.microelectronics! + lot.buy.amount,
    );
    expect(s.players[ME]!.resources.metal).toBeCloseTo(before.metal! - lot.sell.amount, 6);

    // Hero: the engine goes, the cargo bay goes in, the ship forms at the capital.
    expect(at()).toBe('hero.yard');
    s = act(s, 'hero.uninstall', {
      heroId: guideHero(s, ME)!.id,
      moduleId: GUIDE_HERO_START_MODULE,
    });
    s = act(s, 'hero.install', { heroId: guideHero(s, ME)!.id, moduleId: GUIDE_HERO_MODULE });
    expect(at()).toBe('hero.yard'); // still in reserve
    s = act(s, 'hero.spawn', { heroId: guideHero(s, ME)!.id, at: HOME });
    expect(guideHeroModules(s, ME)).toEqual(['repair_bay', GUIDE_HERO_MODULE]);
    expect(guideHeroFleet(s, ME)?.location).toBe(HOME);

    // Ground: barracks, then militia.
    expect(at()).toBe('ground.barracks-catalog');
    s = act(s, 'building.construct', { planetId: HOME, building: 'barracks' });
    expect(at()).toBe('ground.barracks-wait');
    s = until(s, (x) => guideBuilt(x, HOME, 'barracks'));
    expect(at()).toBe('ground.militia-catalog');
    const militia = guideTroopsHome(s, HOME);
    s = act(s, 'unit.build', { planetId: HOME, unit: GUIDE_TROOP, count: GUIDE_TROOPS - 1 });
    expect(at()).toBe('ground.militia-catalog'); // one short
    s = act(s, 'unit.build', { planetId: HOME, unit: GUIDE_TROOP });
    expect(at()).toBe('ground.troops-wait');
    s = until(s, (x) => guideTroopsHome(x, HOME) >= militia + GUIDE_TROOPS);

    // Aviation: spaceport, bomber, the bomber into the hero's hold.
    expect(at()).toBe('aviation.spaceport-catalog');
    s = act(s, 'building.construct', { planetId: HOME, building: 'spaceport' });
    s = until(s, (x) => guideBuilt(x, HOME, 'spaceport'));
    expect(at()).toBe('aviation.bomber-catalog');
    s = act(s, 'unit.build', { planetId: HOME, unit: GUIDE_WING });
    expect(at()).toBe('aviation.wing-wait');
    s = until(s, (x) => guideWingsHome(x, HOME) > 0);
    expect(at()).toBe('aviation.load');
    const hero = guideHeroFleet(s, ME)!.id;
    const squadron = s.planets[HOME]!.hangar![0]!.id;
    s = act(s, 'shuttle.load', { fleetId: hero, squadronId: squadron });
    expect(guideWingsAboard(s, ME)).toBe(1);

    // Landing: troops aboard, the flight.
    expect(at()).toBe('landing.troops-max');
    s = act(s, 'army.load', { fleetId: hero, unit: GUIDE_TROOP, count: GUIDE_TROOPS });
    expect(at()).toBe('landing.troops-aboard');
    s = until(s, (x) => guideTroopsAboard(x, ME) === GUIDE_TROOPS);
    expect(at()).toBe('landing.move');
    s = act(s, 'fleet.move', { fleetId: hero, to: GUIDE_ASSAULT });
    expect(guideHeroCourseSet(s, ME)).toBe(true);
    expect(at()).toBe('landing.flight');
    s = until(s, (x) => guideHeroArrived(x, ME));

    // Assault: the strike from the hold, Rally, the landing.
    expect(at()).toBe('assault.strike');
    const hp = (x: GameState) =>
      x.planets[GUIDE_ASSAULT]!.garrison.reduce(
        (n, u) => n + (u.hp ?? u.count * data.units[u.unit]!.stats.hp),
        0,
      );
    const garrison = hp(s);
    s = act(s, 'shuttle.strike', {
      fleetId: hero,
      squadronId: squadron,
      targetPlanetId: GUIDE_ASSAULT,
    });
    expect(guideStrikeFlying(s, ME)).toBe(true);
    expect(at()).toBe('assault.rally');
    s = until(s, (x) => !guideStrikeFlying(x, ME));
    expect(hp(s)).toBeLessThan(garrison);
    s = act(s, 'hero.ability', { heroId: guideHero(s, ME)!.id, abilityId: GUIDE_ABILITY });
    expect(guideAbilityCast(s, ME, data)).toBe(true);
    expect(at()).toBe('assault.land');
    s = act(s, 'fleet.assault', { fleetId: hero });
    expect(at()).toBe('assault.capture');
    expect(result).toBeUndefined();
    s = until(s, (x) => x.planets[GUIDE_ASSAULT]!.owner === ME);
    tour.refresh();
    expect(result?.completed).toBe(true);
    // The whole lesson stays inside three game days: about fourteen minutes at ×300.
    expect((s.time - start) / HOUR).toBeLessThan(72);
  });
});
