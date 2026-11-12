import type { GameState } from '../../packages/shared-core/src/index';
import { patchLiveTimers } from './liveTimers';
import { refreshProductionStock } from './productionIncome';
import { laneStripHtml, productionLanesHtml } from './productionQueueView';
import type { ProductionLane } from '../../decisions/productionSections';

interface ProductionRefreshHost {
  root(): HTMLElement;
  state(): GameState;
  me(): string;
  /** Подвкладка открытого каталога; пусто — каталог закрыт. */
  tab(): string;
  lane(): ProductionLane | null;
  planet(): string;
  heroPaneHtml(): string;
  renderedHeroBody(): string;
  paint(): void;
}

function availability(host: ProductionRefreshHost): string {
  const state = host.state(),
    me = host.me(),
    player = state.players[me];
  return JSON.stringify([
    player?.resources,
    player?.technologies,
    player?.arsenal,
    state.capital?.[me],
    player?.stewardHoldPoints,
    state.rallyPoints?.[me],
    Object.values(state.planets)
      .filter((p) => p.owner === me)
      .map((p) => [p.id, p.buildings]),
  ]);
}

/** A full repaint disconnects the native select and dismisses its open popup.
 * Keep it mounted until change or blur; only passive refreshes are deferred. */
function selecting(root: HTMLElement): boolean {
  const active = root.ownerDocument?.activeElement;
  return active?.tagName === 'SELECT' && root.contains(active);
}

/** Periodic stock, queue and hero updates share the same stable window root. */
export function initProductionRefresh(host: ProductionRefreshHost) {
  let scrolling = false;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  let lastAvailability = '';
  /** Список линий и очередь открытой линии обновляются на месте, без перерисовки окна, и
   *  только когда их разметка изменилась: узел под пальцем не пересоздаётся каждую секунду. */
  const painted = new Map<string, string>();
  const remember = (selector: string, html: string): string => (painted.set(selector, html), html);
  const queueHtml = (): string => remember('#cn-queue', productionLanesHtml(host.state(), host.planet(), host.lane()));
  const stripHtml = (): string => {
    const lane = host.lane();
    return remember('.pw-lane-strip', lane ? laneStripHtml(host.state(), host.planet(), lane) : '');
  };
  const patch = (selector: string, html: () => string): void => {
    const el = host.root().querySelector(selector);
    const before = painted.get(selector);
    if (el && html() !== before) el.innerHTML = painted.get(selector)!;
  };
  // Scroll does not bubble. Preserve the existing touch/inertia idle guard.
  host.root().addEventListener(
    'scroll',
    () => {
      if (!host.root().classList.contains('show')) return;
      scrolling = true;
      if (scrollTimer !== null) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        scrolling = false;
        scrollTimer = null;
      }, 180);
    },
    true,
  );

  /** Заказ, который закончится раньше следующего ежесекундного обновления, окно снимает в
   *  тот же миг, а не держит до секунды с нулём на таймере. Темп мира берётся из двух
   *  соседних обновлений: на паузе он ноль, и ждать нечего. */
  let last: { time: number; real: number } | null = null;
  let early: ReturnType<typeof setTimeout> | null = null;
  const watchCompletion = (refresh: () => void): void => {
    const { time, scheduled } = host.state();
    const real = performance.now();
    const rate = last && real > last.real ? (time - last.time) / (real - last.real) : 0;
    last = { time, real };
    if (early !== null) clearTimeout(early);
    early = null;
    if (rate <= 0) return;
    let next = Infinity;
    for (const e of scheduled)
      if ((e.type === 'construction.complete' || e.type === 'hero.mobilization.complete') && e.at > time && e.at < next) next = e.at;
    const wait = (next - time) / rate;
    if (wait < 1000) early = setTimeout(refresh, wait + 30);
  };

  return {
    queueHtml,
    stripHtml,
    painted: () => {
      lastAvailability = availability(host);
      painted.clear();
    },
    refreshHeroes: () => {
      const root = host.root();
      if (host.tab() !== 'heroes' || !root.classList.contains('show')) return;
      refreshProductionStock(root, host.state(), host.me());
      if (scrolling) return;
      if (selecting(root) || host.heroPaneHtml() === host.renderedHeroBody())
        return patchLiveTimers(root, host.state().time);
      const scroll = root.querySelector('#constructorbody')?.scrollTop ?? 0;
      const focused = root.ownerDocument?.activeElement as HTMLElement | null;
      const focusAttrs =
        focused && root.contains(focused)
          ? Array.from(focused.attributes)
              .filter((a) => a.name.startsWith('data-h'))
              .map((a) => [a.name, a.value] as const)
          : [];
      host.paint();
      const box = root.querySelector('#constructorbody');
      if (box) box.scrollTop = scroll;
      if (focusAttrs.length)
        Array.from(root.querySelectorAll<HTMLElement>('button'))
          .find((el) => focusAttrs.every(([name, value]) => el.getAttribute(name) === value))
          ?.focus({ preventScroll: true });
    },
    refreshQueue: function refreshQueue(): void {
      const root = host.root();
      if (!root.classList.contains('show')) return;
      watchCompletion(refreshQueue);
      refreshProductionStock(root, host.state(), host.me());
      if (scrolling) return;
      if (
        !selecting(root) &&
        host.tab() !== 'heroes' &&
        (host.tab() === 'buildings' || availability(host) !== lastAvailability)
      ) {
        host.paint();
        return;
      }
      patch('#cn-queue', queueHtml);
      patch('.pw-lane-strip', stripHtml);
      patchLiveTimers(root, host.state().time);
    },
  };
}
