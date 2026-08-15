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
      mouse: () => true,
      homeOpened: () => false,
      shipsTabOpen: () => false,
      hasFleet: () => false,
      capturedWorld: () => false,
      scoreRose: () => false,
    });
    expect(tour.map((s) => s.id)).toEqual([
      'welcome',
      'nav',
      'home',
      'mine',
      'ships-tab',
      'ship',
      'fleet',
      'scan',
      'troops',
      'spy',
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
    // подсказка про карту: без проверок («Далее») и БЕЗ запрета экрана — её пробуют руками
    const nav = tour.find((s) => s.id === 'nav');
    expect(nav?.advance).toEqual({ on: 'tap' });
    expect(nav?.hands).toBe(true);
    expect(nav?.gate).toBeUndefined();
    // «постройте корабль» — это ДВА нажатия по реальным местам панели, а не пустой шаг:
    // сперва вкладка заказа, потом строка корабля (живой отзыв: «нажимать нечего»)
    // цели должны существовать в реальной разметке: старый селектор улучшения
    // (`[data-act="upgrade"]`) не совпадал уже ни с чем, и шаг молча не подсвечивал
    expect(tour.find((s) => s.id === 'mine')?.target).toBe('[data-codex^="b:mine:"]');
    expect(tour.find((s) => s.id === 'ships-tab')?.target).toBe('[data-act="tab"][data-arg="ships"]');
    expect(tour.find((s) => s.id === 'ship')?.target).toBe('[data-buildorder^="unit:"]');
    expect(tour.find((s) => s.id === 'ship')?.advance).toMatchObject({
      on: 'action',
      type: 'unit.build',
    });
    // запираем экран ровно там, где цель И ЕСТЬ то, что просят нажать
    expect(tour.filter((s) => s.gate).map((s) => s.id)).toEqual(['mine', 'ships-tab', 'ship']);
    // а там, где до места ещё надо добраться (выбрать мир, выбрать флот), — не запираем
    expect(tour.find((s) => s.id === 'home')?.gate).toBeUndefined();
    expect(tour.find((s) => s.id === 'course')?.gate).toBeUndefined();
    expect(tour.find((s) => s.id === 'fleet')?.advance.on).toBe('state');
    // scan/troops/spy are concept-only (nothing to gate a predicate on) — tap-advance
    // beats, not gated on a real action
    expect(tour.find((s) => s.id === 'scan')?.advance.on).toBe('tap');
    expect(tour.find((s) => s.id === 'troops')?.advance.on).toBe('tap');
    expect(tour.find((s) => s.id === 'spy')?.advance.on).toBe('tap');
    expect(tour.find((s) => s.id === 'capture')?.advance.on).toBe('state');
    expect(tour.find((s) => s.id === 'score')?.advance.on).toBe('state');
  });
});

describe('buildFirstMatchTour — capture is gated on real state', () => {
  it('does not pass the capture step until a world is actually taken', () => {
    let homeOpen = false;
    let shipsTab = false;
    let fleetRaised = false;
    let captured = false;
    let scored = false;
    const tour = buildFirstMatchTour({
      mouse: () => true,
      homeOpened: () => homeOpen,
      shipsTabOpen: () => shipsTab,
      hasFleet: () => fleetRaised,
      capturedWorld: () => captured,
      scoreRose: () => scored,
    });
    let result: TourResult | null = null;
    const t = new SpotlightTour(tour, anyHost(), (r) => (result = r));
    t.start();

    t.tap(); // welcome → nav (подсказка про карту)
    t.tap(); // nav → home
    for (let f = 0; f < 30; f++) t.refresh(); // panel not opened yet — stays put
    expect(t.index).toBe(2);

    homeOpen = true;
    t.refresh(); // homeworld panel opened → home advances to mine
    t.notifyAction('building.upgrade'); // mine → ships-tab

    for (let f = 0; f < 30; f++) t.refresh(); // вкладка заказа не открыта — стоим на месте
    expect(t.index).toBe(4);

    shipsTab = true;
    t.refresh(); // вкладка «Корабли» открыта → шаг заказа корабля
    expect(t.index).toBe(5);
    t.notifyAction('unit.build'); // заказ отдан → ждём, пока корабль выйдет на орбиту
    expect(t.index).toBe(6); // parked on the fleet step — a ship must actually auto-rally

    for (let f = 0; f < 30; f++) t.refresh(); // no fleet yet — stays put
    expect(t.index).toBe(6);

    fleetRaised = true;
    t.refresh(); // a built ship auto-rallied → fleet advances to the (informational) scan step
    expect(t.index).toBe(7);
    t.tap(); // scan → troops
    expect(t.index).toBe(8); // parked on the (informational) troops step
    t.tap(); // troops → spy
    t.tap(); // spy → course
    t.notifyAction('fleet.move'); // course → capture
    expect(t.index).toBe(11); // parked on the capture step

    for (let f = 0; f < 30; f++) t.refresh(); // world not yet taken — stays put
    expect(t.index).toBe(11);
    expect(result).toBeNull();

    captured = true;
    t.refresh(); // world taken → capture advances to score
    expect(t.index).toBe(12);

    scored = true;
    t.refresh(); // score moved → score advances to the final beat
    t.tap(); // done → finish
    expect(result).not.toBeNull();
    expect(result!.completed).toBe(true);
    expect(result!.reachedStep).toBe(13);
  });
});

describe('buildFirstMatchTour — skippable', () => {
  it('a skip mid-guide ends the whole chain as skipped', () => {
    const tour = buildFirstMatchTour({
      mouse: () => true,
      homeOpened: () => true, // already open — walk straight onto mine
      shipsTabOpen: () => false,
      hasFleet: () => false,
      capturedWorld: () => false,
      scoreRose: () => false,
    });
    let result: TourResult | null = null;
    const t = new SpotlightTour(tour, anyHost(), (r) => (result = r));
    t.start();
    t.tap(); // welcome → nav
    t.tap(); // nav → home → (state already true) → mine
    t.skip();
    expect(result).not.toBeNull();
    expect(result!.skipped).toBe(true);
    expect(result!.completed).toBe(false);
    expect(t.active).toBe(false);
  });
});
