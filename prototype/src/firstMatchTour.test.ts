import { describe, expect, it } from 'vitest';
import { buildFirstMatchTour } from './firstMatchTour';
import { SpotlightTour, type Rect, type SpotlightHost, type TourResult } from './spotlight';

// A permissive host: every selector resolves (so `optional` HUD steps highlight
// rather than skip), and renders are ignored — the test drives the machine.
const RECT: Rect = { left: 0, top: 0, width: 100, height: 40 };
function anyHost(): SpotlightHost {
  return { locate: () => RECT, render: () => {} };
}

describe('buildFirstMatchTour — shape', () => {
  it('walks produce → build → move → capture → score → done', () => {
    const tour = buildFirstMatchTour({
      homeOpened: () => false,
      hasFleet: () => false,
      capturedWorld: () => false,
      scoreRose: () => false,
    });
    expect(tour.map((s) => s.id)).toEqual([
      'welcome',
      'home',
      'mine',
      'fleet',
      'course',
      'capture',
      'score',
      'done',
    ]);
    // the "do X" beats advance on real actions; capture/score/fleet/home on live state
    expect(tour.find((s) => s.id === 'mine')?.advance).toMatchObject({
      on: 'action',
      type: 'building.upgrade',
    });
    expect(tour.find((s) => s.id === 'course')?.advance).toMatchObject({
      on: 'action',
      type: 'fleet.move',
    });
    expect(tour.find((s) => s.id === 'home')?.advance.on).toBe('state');
    expect(tour.find((s) => s.id === 'fleet')?.advance.on).toBe('state');
    expect(tour.find((s) => s.id === 'capture')?.advance.on).toBe('state');
    expect(tour.find((s) => s.id === 'score')?.advance.on).toBe('state');
  });
});

describe('buildFirstMatchTour — capture is gated on real state', () => {
  it('does not pass the capture step until a world is actually taken', () => {
    let homeOpen = false;
    let fleetRaised = false;
    let captured = false;
    let scored = false;
    const tour = buildFirstMatchTour({
      homeOpened: () => homeOpen,
      hasFleet: () => fleetRaised,
      capturedWorld: () => captured,
      scoreRose: () => scored,
    });
    let result: TourResult | null = null;
    const t = new SpotlightTour(tour, anyHost(), (r) => (result = r));
    t.start();

    t.tap(); // welcome → home
    for (let f = 0; f < 30; f++) t.refresh(); // panel not opened yet — stays put
    expect(t.index).toBe(1);

    homeOpen = true;
    t.refresh(); // homeworld panel opened → home advances to mine
    t.notifyAction('building.upgrade'); // mine → fleet
    expect(t.index).toBe(3); // parked on the fleet step — a ship must actually auto-rally

    for (let f = 0; f < 30; f++) t.refresh(); // no fleet yet — stays put
    expect(t.index).toBe(3);

    fleetRaised = true;
    t.refresh(); // a built ship auto-rallied → fleet advances to course
    t.notifyAction('fleet.move'); // course → capture
    expect(t.index).toBe(5); // parked on the capture step

    for (let f = 0; f < 30; f++) t.refresh(); // world not yet taken — stays put
    expect(t.index).toBe(5);
    expect(result).toBeNull();

    captured = true;
    t.refresh(); // world taken → capture advances to score
    expect(t.index).toBe(6);

    scored = true;
    t.refresh(); // score moved → score advances to the final beat
    t.tap(); // done → finish
    expect(result).not.toBeNull();
    expect(result!.completed).toBe(true);
    expect(result!.reachedStep).toBe(7);
  });
});

describe('buildFirstMatchTour — skippable', () => {
  it('a skip mid-guide ends the whole chain as skipped', () => {
    const tour = buildFirstMatchTour({
      homeOpened: () => true, // already open — walk straight onto mine
      hasFleet: () => false,
      capturedWorld: () => false,
      scoreRose: () => false,
    });
    let result: TourResult | null = null;
    const t = new SpotlightTour(tour, anyHost(), (r) => (result = r));
    t.start();
    t.tap(); // welcome → home → (state already true) → mine
    t.skip();
    expect(result).not.toBeNull();
    expect(result!.skipped).toBe(true);
    expect(result!.completed).toBe(false);
    expect(t.active).toBe(false);
  });
});
