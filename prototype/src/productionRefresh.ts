import type { GameState } from '../../packages/shared-core/src/index';
import { patchLiveTimers } from './liveTimers';
import { refreshProductionStock } from './productionIncome';
import { productionQueueHtml } from './productionQueueView';

interface ProductionRefreshHost {
  root(): HTMLElement;
  state(): GameState;
  me(): string;
  tab(): string;
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
  let queuePainted = '';
  let lastAvailability = '';
  const queueHtml = (): string => {
    queuePainted = productionQueueHtml(host.state(), host.planet());
    return queuePainted;
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

  return {
    queueHtml,
    painted: () => {
      lastAvailability = availability(host);
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
    refreshQueue: () => {
      const root = host.root();
      if (!root.classList.contains('show')) return;
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
      patchLiveTimers(root, host.state().time);
      const el = root.querySelector('#cn-queue');
      if (!el) return;
      const before = queuePainted,
        html = queueHtml();
      if (html !== before) {
        const open = el.querySelector('details')?.open;
        el.innerHTML = html;
        const details = el.querySelector('details');
        if (details && open !== undefined) details.open = open;
      }
    },
  };
}
