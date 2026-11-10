import { afterEach, expect, it, vi } from 'vitest';
import { newGame } from './game';
import { initProductionRefresh } from './productionRefresh';

afterEach(() => vi.useRealTimers());

function setup() {
  const state = newGame();
  const world = Object.values(state.planets).find((p) => p.owner === 'p1')!;
  const picker = { tagName: 'SELECT' };
  const document = { activeElement: null as typeof picker | null };
  const stock = { innerHTML: '' };
  let queueHtml = '';
  const queue = {
    get innerHTML() { return queueHtml; },
    set innerHTML(value: string) { queueHtml = value; },
  };
  const handlers: Record<string, () => void> = {};
  const root = {
    ownerDocument: document,
    classList: { contains: () => true },
    contains: (node: unknown) => node === picker,
    querySelector: (selector: string) =>
      selector === '.pw-stock' ? stock : selector === '#cn-queue' ? queue : null,
    querySelectorAll: () => [],
    addEventListener: (type: string, listener: () => void) => {
      handlers[type] = listener;
    },
  } as unknown as HTMLElement;
  let tab = 'ships',
    heroHtml = 'old',
    renderedHero = 'old',
    paints = 0;
  const refresh = initProductionRefresh({
    root: () => root,
    state: () => state,
    me: () => 'p1',
    planet: () => world.id,
    tab: () => tab,
    lane: () => null,
    heroPaneHtml: () => heroHtml,
    renderedHeroBody: () => renderedHero,
    paint: () => {
      paints++;
      renderedHero = heroHtml;
      refresh.painted();
    },
  });
  refresh.painted();
  queue.innerHTML = refresh.queueHtml();
  return {
    state,
    world,
    document,
    picker,
    stock,
    queue,
    handlers,
    refresh,
    paints: () => paints,
    tab: (value: string) => {
      tab = value;
    },
    heroHtml: (value: string) => {
      heroHtml = value;
    },
  };
}

it.each(['ships', 'buildings', 'infantry'])(
  'keeps the %s picker mounted while stock and queue update, then catches up after blur',
  (tab) => {
    const f = setup();
    f.tab(tab);
    f.document.activeElement = f.picker;
    f.refresh.refreshQueue();
    const beforeStock = f.stock.innerHTML,
      beforeQueue = f.queue.innerHTML;
    f.state.players.p1!.resources.credits = 12345;
    f.world.buildQueue = [{ id: 1, kind: 'unit', playerId: 'p1', unit: 'frigate', count: 1 }];
    f.refresh.refreshQueue();
    expect(f.paints()).toBe(0);
    expect(f.document.activeElement).toBe(f.picker);
    expect(f.stock.innerHTML).not.toBe(beforeStock);
    expect(f.queue.innerHTML).not.toBe(beforeQueue);
    f.document.activeElement = null;
    f.refresh.refreshQueue();
    expect(f.paints()).toBe(1);
  },
);

it('does not replace a focused native picker on the hero tab either', () => {
  const f = setup();
  f.tab('heroes');
  f.heroHtml('updated hero');
  f.document.activeElement = f.picker;
  f.refresh.refreshHeroes();
  expect(f.paints()).toBe(0);
  expect(f.stock.innerHTML).not.toBe('');
  f.document.activeElement = null;
  f.refresh.refreshHeroes();
  expect(f.paints()).toBe(1);
});

it('a select outside production does not defer its refresh', () => {
  const f = setup();
  f.document.activeElement = { tagName: 'SELECT' };
  f.state.players.p1!.resources.credits = 12345;
  f.refresh.refreshQueue();
  expect(f.paints()).toBe(1);
});

it('keeps the existing touch scrolling idle guard for automatic repaints', () => {
  vi.useFakeTimers();
  const f = setup();
  f.handlers.scroll!();
  f.state.players.p1!.resources.credits = 12345;
  f.refresh.refreshQueue();
  expect(f.paints()).toBe(0);
  vi.advanceTimersByTime(180);
  f.refresh.refreshQueue();
  expect(f.paints()).toBe(1);
});
