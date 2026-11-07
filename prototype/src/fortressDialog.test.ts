import { afterEach, expect, it, vi } from 'vitest';
import { createInitialState, FORTRESS_DEPLOY_COST } from '../../packages/shared-core/src/index';
import { openFortressDialog } from './fortressDialog';
import { cost } from './format';

const originalPrice = { ...FORTRESS_DEPLOY_COST };
afterEach(() => {
  Object.assign(FORTRESS_DEPLOY_COST, originalPrice);
  vi.unstubAllGlobals();
});

it.each([1, 2])('keeps the hull price stable while fitting and retrying an order at cost ×%i', (factor) => {
  const listeners = new Map<string, (event: Event) => void>();
  const dialog = {
    id: '', innerHTML: '', setAttribute: vi.fn(), showModal: vi.fn(), close: vi.fn(), remove: vi.fn(),
    addEventListener: (name: string, listener: (event: Event) => void) => listeners.set(name, listener),
  };
  vi.stubGlobal('document', {
    getElementById: () => null, createElement: () => dialog, body: { appendChild: vi.fn() },
  });
  const state = createInitialState({ seed: 'fortress-price', version: { data: 'test', manifest: '1' } });
  state.players.p1 = { id: 'p1', name: 'p1', faction: 'azure', status: 'active', resources: { metal: 10000 } };
  if (factor !== 1) state.pricing = { cost: { metal: factor } };
  const order = vi.fn(() => false); // A rejected order repaints the current selection.
  openFortressDialog({ state: () => state, me: () => 'p1', probe: () => null, order, placed: vi.fn() }, 'A');
  const click = (selector: string, element: object = {}) => listeners.get('click')!({
    target: { closest: (match: string) => match === selector ? element : null },
  } as unknown as Event);

  click('[data-fit]', { dataset: { fit: 'cargo_bay' } });
  expect(dialog.innerHTML).toContain('data-fit="cargo_bay" aria-pressed="true"');
  // The shipped cargo bay costs 45 metal, added once to the 480-metal hull.
  const fittedPrice = cost({ metal: 525 * factor }, state.players.p1.resources);
  expect(dialog.innerHTML).toContain(fittedPrice);
  expect(FORTRESS_DEPLOY_COST).toEqual({ metal: 480 });
  click('[data-fort-build]');
  expect(order).toHaveBeenCalledWith(expect.objectContaining({ payload: { planetId: 'A', modules: ['cargo_bay'] } }));
  expect(dialog.innerHTML).toContain(fittedPrice);
  expect(FORTRESS_DEPLOY_COST).toEqual({ metal: 480 });
  click('[data-fit]', { dataset: { fit: 'cargo_bay' } });
  expect(dialog.innerHTML).toContain(cost({ metal: 480 * factor }, state.players.p1.resources));
  expect(FORTRESS_DEPLOY_COST).toEqual({ metal: 480 });
});
