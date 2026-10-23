import { describe, expect, it } from 'vitest';
import { buildFirstMatchTour } from './firstMatchTour';
import { firstMatchFixture, operationFixture } from './firstMatchTour.fixture';
import { SpotlightTour, type TourResult } from './spotlight';

const host = { locate: () => ({ left: 20, top: 20, width: 100, height: 40 }), render: () => {} };

describe('guided first match', () => {
  it('returns to the buildings tab when a previous lesson left the fleet tab selected', () => {
    const { deps, facts } = firstMatchFixture();
    facts.homeOpened = true;
    facts.buildingsTabOpen = false;
    const steps = buildFirstMatchTour(deps);
    const tour = new SpotlightTour(steps, host);
    tour.start();
    tour.tap();
    tour.tap();
    expect(steps[tour.index]?.id).toBe('buildings-tab');
    facts.buildingsTabOpen = true;
    tour.refresh();
    expect(steps[tour.index]?.id).toBe('mine');
  });
  it('requires each real task, including research and capture by the frigate', () => {
    const { facts, deps } = firstMatchFixture();
    const steps = buildFirstMatchTour(deps);
    let result: TourResult | undefined;
    const tour = new SpotlightTour(steps, host, (r) => {
      result = r;
    });
    const at = () => steps[tour.index]!.id;
    tour.start();
    tour.tap();
    tour.tap();
    expect(at()).toBe('home');
    const advance = (key: keyof typeof facts, expected: string) => {
      facts[key] = true;
      tour.refresh();
      expect(at()).toBe(expected);
    };
    advance('homeOpened', 'mine');
    advance('mineCardOpen', 'mine-order');
    tour.notifyAction('building.upgrade');
    tour.tap();
    tour.refresh();
    expect(at()).toBe('mine-order'); // another world's order is not the task
    advance('mineOrdered', 'mine-close');
    advance('dossierClosed', 'mine-wait');
    advance('mineImproved', 'tech');
    advance('techOpen', 'research-tab');
    advance('spaceTabOpen', 'research');
    advance('researchStarted', 'research-wait');
    advance('researchDone', 'research-close');
    facts.techOpen = false;
    tour.refresh();
    expect(at()).toBe('ships-tab');
    advance('shipsTabOpen', 'catalog');
    advance('catalogOpen', 'ship');
    advance('shipCardOpen', 'ship-order');
    tour.notifyAction('unit.build');
    expect(at()).toBe('ship-order'); // a scout or ground troop does not count
    advance('shipOrdered', 'catalog-close');
    facts.catalogOpen = false;
    tour.refresh();
    expect(at()).toBe('ship-wait');
    advance('hasShip', 'fleet');
    advance('fleetSelected', 'move');
    advance('moveArmed', 'course');
    tour.notifyAction('fleet.move');
    expect(at()).toBe('course'); // wrong fleet/destination does not count
    advance('courseSet', 'capture');
    tour.tap();
    tour.refresh();
    expect(result).toBeUndefined();
    advance('capturedWorld', 'score');
    tour.tap();
    // The first sector leads straight into the operation; its chapters are walked by real
    // orders in `firstMatchWalkthrough.test.ts`. Here: each chapter can be skipped on its
    // own, and skipping them all still ends on the closing step, not past it.
    expect(at()).toBe('market.open');
    const chapters: string[] = [];
    while (steps[tour.index]?.stage !== 'finale') {
      chapters.push(steps[tour.index]!.stage!);
      tour.skipStage();
    }
    expect(chapters).toEqual(['market', 'hero', 'ground', 'aviation', 'landing', 'assault']);
    expect(at()).toBe('done');
    expect(result).toBeUndefined();
    tour.tap();
    expect(result?.completed).toBe(true);
  });

  it('names every chapter, from the economy to the debrief', () => {
    const { deps } = firstMatchFixture();
    const steps = buildFirstMatchTour(deps);
    const stages = [...new Set(steps.map((s) => s.stage))];
    expect(stages).toEqual([
      'economy',
      'research',
      'fleet',
      'market',
      'hero',
      'ground',
      'aviation',
      'landing',
      'assault',
      'finale',
    ]);
    expect(steps.every((s) => s.stageTitle === `onb.stage.${s.stage}`)).toBe(true);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
  });

  it('teaches the phone details sheet and destination confirmation explicitly', () => {
    const { deps } = firstMatchFixture();
    const steps = buildFirstMatchTour({ ...deps, mouse: () => false, cardLayout: () => true });
    expect(steps.find((s) => s.id === 'details')?.target).toContain('details');
    expect(steps.find((s) => s.id === 'course-confirm')?.target).toContain('mobile-send');
    expect(steps.find((s) => s.id === 'nav')?.gestures?.[0]?.anim).toBe('pinch');
  });

  it('on a phone the operation finds windows under More and orders under the fleet More', () => {
    const { deps } = firstMatchFixture();
    const ids = (mobile: boolean) =>
      buildFirstMatchTour({ ...deps, operation: operationFixture(mobile) }).map((s) => s.id);
    const phoneOnly = ids(true).filter((id) => !ids(false).includes(id));
    expect(phoneOnly).toEqual([
      'market.market-more',
      'hero.production-more',
      'ground.details',
      'aviation.details',
      'landing.hero-details',
      'landing.troops-commands',
      'landing.send',
      'assault.hero-details',
      'assault.cast-commands',
      'assault.land-details',
    ]);
  });

  it('can collapse, reopen and skip while a task is still pending, without completion', () => {
    const { deps } = firstMatchFixture();
    let result: TourResult | undefined;
    const tour = new SpotlightTour(buildFirstMatchTour(deps), host, (r) => {
      result = r;
    });
    tour.start();
    tour.tap();
    tour.tap();
    tour.collapse();
    tour.refresh();
    tour.reopen();
    expect(tour.index).toBe(2);
    tour.skip();
    expect(result).toMatchObject({ skipped: true, completed: false });
  });
});
