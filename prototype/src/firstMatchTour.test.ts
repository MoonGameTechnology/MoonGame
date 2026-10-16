import { describe, expect, it } from 'vitest';
import {
  DEFENSE_BRANCH,
  DEFENSE_BUILDING,
  DEFENSE_TECH,
  buildFirstMatchTour,
  raidStarted,
  type FirstMatchDeps,
} from './firstMatchTour';
import {
  MAP_ANCHOR,
  SpotlightTour,
  type Rect,
  type SpotlightHost,
  type TourResult,
} from './spotlight';
import { overlayMode } from './tourGate';
import { data } from './gameData';

// A permissive host: every selector resolves, and renders are ignored — the test drives
// the machine.
const RECT: Rect = { left: 0, top: 0, width: 100, height: 40 };
function anyHost(): SpotlightHost {
  return { locate: () => RECT, render: () => {} };
}

/** Мир, в котором ничего ещё не сделано; `over` подменяет отдельные проверки. */
function deps(over: Partial<FirstMatchDeps> = {}): FirstMatchDeps {
  return {
    mouse: () => true,
    cardLayout: () => false,
    home: () => 'home',
    rival: () => 'rival',
    strikeFleet: () => 'p1-1',
    raidFleet: () => 'p2-1',
    homeOpened: () => false,
    panelOpen: () => false,
    techOpen: () => false,
    techTab: () => null,
    techDone: () => false,
    shipsTabOpen: () => false,
    buildingsTabOpen: () => false,
    buildWinOpen: () => false,
    hasFleet: () => false,
    raidBeaten: () => false,
    rivalOpened: () => false,
    fleetSelected: () => false,
    moveArmed: () => false,
    draftStaged: () => false,
    capturedWorld: () => false,
    ...over,
  };
}

const ids = (d: FirstMatchDeps): string[] => buildFirstMatchTour(d).map((s) => s.id);

describe('обучение основной игры — состав', () => {
  it('камера → экономика → наука → корабль → оборона → разведка → рейд → атака → победа', () => {
    expect(ids(deps())).toEqual([
      'welcome',
      'nav',
      'home',
      'mine',
      'tech-open',
      'tech-branch',
      'tech-research',
      'home-ships',
      'ships-tab',
      'units-open',
      'ship',
      'fleet',
      'tech-wait',
      'home-build',
      'build-tab',
      'build-open',
      'fort',
      'spy-open',
      'spy',
      'raid',
      'troops',
      'pick-fleet',
      'move-btn',
      'course',
      'capture',
    ]);
  });

  it('каждый урок закрывается настоящим приказом, а не «Далее»', () => {
    const tour = buildFirstMatchTour(deps());
    const actions = Object.fromEntries(
      tour
        .filter((s) => s.advance.on === 'action')
        .map((s) => [s.id, (s.advance as { type: string }).type]),
    );
    expect(actions).toEqual({
      mine: 'building.upgrade',
      'tech-research': 'technology.research',
      ship: 'unit.build',
      fort: 'building.construct',
      spy: 'espionage.spy',
      course: 'fleet.move',
    });
    // на телефоне курс уходит кнопкой «Отправить приказ», а мир только ставит цель
    const phone = buildFirstMatchTour(deps({ cardLayout: () => true }));
    expect(phone.find((s) => s.id === 'course')!.advance.on).toBe('state');
    expect(phone.find((s) => s.id === 'send')!.advance).toEqual({
      on: 'action',
      type: 'fleet.move',
    });
    // «Далее» — только у шагов-объяснений
    expect(tour.filter((s) => s.advance.on === 'tap').map((s) => s.id)).toEqual([
      'welcome',
      'nav',
      'troops',
    ]);
  });

  it('каждый шаг, где есть что нажать, запирает экран на цели (золотая подсветка)', () => {
    const tour = buildFirstMatchTour(deps());
    // Шаги «сделай» — запертые; без запрета остаются объяснения и ожидания.
    const doing = tour.filter(
      (s) => s.advance.on !== 'tap' && s.target !== null && !['raid', 'capture'].includes(s.id),
    );
    expect(doing.length).toBeGreaterThan(12);
    for (const s of doing) {
      expect(s.gate, s.id).toBe(true);
      expect(overlayMode(s, true), s.id).toBe('gate');
    }
    // ожидания (стройка, рейд, захват) — экран свободен: смотреть на карту можно
    for (const id of ['fleet', 'tech-wait', 'raid', 'capture']) {
      const s = tour.find((x) => x.id === id)!;
      expect(overlayMode(s, true), id).toBe('free');
    }
  });

  it('точки карты подсвечиваются якорем: свой мир, флот, мир соперника', () => {
    const tour = buildFirstMatchTour(deps());
    const map = Object.fromEntries(
      tour.filter((s) => s.mapTarget).map((s) => [s.id, s.mapTarget!()]),
    );
    expect(map).toEqual({
      home: { kind: 'planet', id: 'home' },
      'home-ships': { kind: 'planet', id: 'home' },
      'home-build': { kind: 'planet', id: 'home' },
      'spy-open': { kind: 'planet', id: 'rival' },
      raid: { kind: 'fleet', id: 'p2-1' },
      'pick-fleet': { kind: 'fleet', id: 'p1-1' },
      course: { kind: 'planet', id: 'rival' },
      capture: { kind: 'planet', id: 'rival' },
    });
    for (const s of tour.filter((x) => x.mapTarget)) expect(s.target, s.id).toContain(MAP_ANCHOR);
    // на телефоне тап по месту, где мир и флоты, открывает выбор — цель тогда строка выбора
    expect(tour.find((s) => s.id === 'pick-fleet')!.target).toContain(
      '.mobile-choices [data-kind="fleet"]',
    );
    expect(tour.find((s) => s.id === 'home')!.target).toContain(
      '.mobile-choices [data-kind="planet"]',
    );
    // нет флота — нет точки, якорь прячется, а не указывает в пустоту
    const none = buildFirstMatchTour(deps({ strikeFleet: () => null }));
    expect(none.find((s) => s.id === 'pick-fleet')!.mapTarget!()).toBeNull();
  });

  it('кнопка науки ищется и на ПК, и на телефоне одним шагом', () => {
    const open = buildFirstMatchTour(deps()).find((s) => s.id === 'tech-open')!;
    expect(open.target).toContain('#holo-tech');
    expect(open.target).toContain('[data-phone-tab="science"]');
  });

  it('цели держатся за реальные данные: технология открывает форт и лежит в своей ветке', () => {
    const tech = data.technologies[DEFENSE_TECH];
    expect(tech?.branch).toBe(DEFENSE_BRANCH);
    expect(tech?.unlocks?.buildings).toContain(DEFENSE_BUILDING);
    const tour = buildFirstMatchTour(deps());
    expect(tour.find((s) => s.id === 'tech-research')!.target).toContain(
      `data-go="${DEFENSE_TECH}"`,
    );
    expect(tour.find((s) => s.id === 'fort')!.target).toContain(`data-bw-go="${DEFENSE_BUILDING}"`);
  });

  it('на телефоне шаг про карту показывает жесты пальцев, строка та же', () => {
    const pc = buildFirstMatchTour(deps({ mouse: () => true })).find((s) => s.id === 'nav');
    const phone = buildFirstMatchTour(deps({ mouse: () => false })).find((s) => s.id === 'nav');
    expect(phone?.gestures?.map((g) => g.anim)).toEqual(['pinch', 'swipe', 'double-tap', 'hold']);
    expect(phone?.copy).toBe(pc?.copy);
    expect(phone?.hands).toBe(true);
  });

  it('карточка мира: «Сведения» после каждого открытия мира, на ПК их нет', () => {
    const card = ids(deps({ cardLayout: () => true }));
    for (const [home, details] of [
      ['home', 'details'],
      ['home-ships', 'details-ships'],
      ['home-build', 'details-build'],
      ['spy-open', 'details-spy'],
      ['course', 'send'],
    ])
      expect(card[card.indexOf(home!) + 1], home).toBe(details);
    expect(ids(deps()).some((id) => id.startsWith('details'))).toBe(false);
  });
});

describe('обучение основной игры — проход', () => {
  it('шаг-страховка «откройте мир» засчитывается сразу, если мир уже открыт', () => {
    const tour = buildFirstMatchTour(deps({ homeOpened: () => true, techOpen: () => false }));
    const t = new SpotlightTour(tour, anyHost());
    t.start();
    t.tap(); // welcome
    t.tap(); // nav → home (уже открыт) → mine
    expect(tour[t.index]?.id).toBe('mine');
    t.notifyAction('building.upgrade');
    expect(tour[t.index]?.id).toBe('tech-open');
  });

  it('полный проход: каждый шаг ждёт своего дела, захват — настоящего захвата', () => {
    const w = {
      home: false,
      tech: false,
      tab: null as string | null,
      done: false,
      ships: false,
      builds: false,
      win: false,
      fleet: false,
      beaten: false,
      rival: false,
      picked: false,
      armed: false,
      captured: false,
    };
    const tour = buildFirstMatchTour(
      deps({
        homeOpened: () => w.home,
        techOpen: () => w.tech,
        techTab: () => w.tab,
        techDone: () => w.done,
        shipsTabOpen: () => w.ships,
        buildingsTabOpen: () => w.builds,
        buildWinOpen: () => w.win,
        hasFleet: () => w.fleet,
        raidBeaten: () => w.beaten,
        rivalOpened: () => w.rival,
        fleetSelected: () => w.picked,
        moveArmed: () => w.armed,
        capturedWorld: () => w.captured,
      }),
    );
    let result: TourResult | null = null;
    const t = new SpotlightTour(tour, anyHost(), (r) => (result = r));
    const at = (): string | undefined => tour[t.index]?.id;
    const idle = (): void => {
      for (let f = 0; f < 20; f++) t.refresh();
    };
    t.start();
    t.tap();
    t.tap();
    idle();
    expect(at()).toBe('home');
    w.home = true;
    t.refresh();
    t.notifyAction('fleet.move'); // чужой приказ шаг не двигает
    expect(at()).toBe('mine');
    t.notifyAction('building.upgrade');
    idle();
    expect(at()).toBe('tech-open');
    w.home = false; // окно науки закрыло панель мира
    w.tech = true;
    t.refresh();
    w.tab = 'space';
    idle();
    expect(at()).toBe('tech-branch');
    w.tab = DEFENSE_BRANCH;
    t.refresh();
    t.notifyAction('technology.research');
    w.tech = false; // окно закрывает хост
    idle();
    expect(at()).toBe('home-ships'); // мир закрыт — страховка ждёт
    w.home = true;
    t.refresh();
    w.ships = true;
    t.refresh();
    expect(at()).toBe('units-open');
    w.win = true;
    t.refresh();
    t.notifyAction('unit.build');
    w.win = false;
    idle();
    expect(at()).toBe('fleet');
    w.fleet = true;
    t.refresh();
    idle();
    expect(at()).toBe('tech-wait');
    w.done = true;
    t.refresh(); // home-build засчитан сразу: мир открыт
    expect(at()).toBe('build-tab');
    w.builds = true;
    t.refresh();
    w.win = true;
    t.refresh();
    expect(at()).toBe('fort');
    t.notifyAction('building.construct');
    idle();
    expect(at()).toBe('spy-open');
    w.rival = true;
    t.refresh();
    t.notifyAction('espionage.spy');
    idle();
    expect(at()).toBe('raid');
    w.beaten = true;
    t.refresh();
    t.tap(); // troops
    idle();
    expect(at()).toBe('pick-fleet');
    w.picked = true;
    t.refresh();
    expect(at()).toBe('move-btn');
    w.armed = true;
    t.refresh();
    t.notifyAction('fleet.move');
    idle();
    expect(at()).toBe('capture');
    expect(result).toBeNull();
    w.captured = true;
    t.refresh(); // мир взят — обучение пройдено, итог показывает экран конца матча
    expect(result).toMatchObject({ completed: true, skipped: false });
  });

  it('пропуск на середине кончает обучение как пропущенное', () => {
    let result: TourResult | null = null;
    const t = new SpotlightTour(buildFirstMatchTour(deps()), anyHost(), (r) => (result = r));
    t.start();
    t.tap();
    t.tap();
    t.skip();
    expect(result).toMatchObject({ completed: false, skipped: true, reachedStep: 2 });
  });
});

describe('рейд соперника', () => {
  it('начинается, пока строится корабль, и дальше, но не раньше и не после конца тура', () => {
    const tour = buildFirstMatchTour(deps());
    expect(raidStarted(tour, 'ship')).toBe(false);
    expect(raidStarted(tour, 'fleet')).toBe(true);
    expect(raidStarted(tour, 'fort')).toBe(true);
    expect(raidStarted(tour, 'course')).toBe(true);
    expect(raidStarted(tour, null)).toBe(false);
    expect(raidStarted(tour, 'unknown')).toBe(false);
  });
});
