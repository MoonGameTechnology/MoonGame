import { describe, expect, it } from 'vitest';
import { buildFirstMatchTour } from './firstMatchTour';
import { firstMatchFixture } from './firstMatchTour.fixture';
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
    expect(at()).toBe('done');
    tour.tap();
    expect(result?.completed).toBe(true);
  });

  it('teaches the phone details sheet and destination confirmation explicitly', () => {
    const { deps } = firstMatchFixture();
    const steps = buildFirstMatchTour({ ...deps, mouse: () => false, cardLayout: () => true });
    expect(steps.find((s) => s.id === 'details')?.target).toContain('details');
    expect(steps.find((s) => s.id === 'course-confirm')?.target).toContain('mobile-send');
    expect(steps.find((s) => s.id === 'nav')?.gestures?.[0]?.anim).toBe('pinch');
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
