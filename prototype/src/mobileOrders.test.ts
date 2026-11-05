import { describe, expect, it, vi } from 'vitest';
import { mobileDraftMatches, mobileTargetPoint, type MobileOrderDraft } from './mobileOrders';
import { releaseCommits } from '../../decisions/aimGesture';
import { dragIntent } from '../../decisions/dragIntent';

describe('phone orders require a stable selection and an explicit send', () => {
  const draft: MobileOrderDraft = {
    order: 'move',
    fleetIds: ['a', 'b'],
    target: { kind: 'planet', id: 'home' },
  };
  it('rejects the unsent target after changing command, selection or losing a fleet', () => {
    expect(mobileDraftMatches(draft, 'move', ['b', 'a'])).toBe(true);
    expect(mobileDraftMatches(draft, 'assault', ['a', 'b'])).toBe(false);
    expect(mobileDraftMatches(draft, 'move', ['a', 'c'])).toBe(false);
    expect(mobileDraftMatches(draft, 'move', ['a'])).toBe(false);
    expect(mobileDraftMatches(draft, null, ['a', 'b'])).toBe(false);
    expect(mobileDraftMatches(draft, 'move', [])).toBe(false);
  });
  it('pans with one finger, stages only a tap, and never taps after a pinch', () => {
    const gesture = {
      armed: true,
      pc: false,
      confirmRequired: true,
      pointers: 1,
      boxing: false,
      hasStart: true,
    };
    expect(dragIntent(gesture)).toBe('pan');
    expect(releaseCommits({ ...gesture, multiTouched: false, dragged: true })).toBe(false);
    expect(releaseCommits({ ...gesture, multiTouched: false, dragged: false })).toBe(true);
    expect(releaseCommits({ ...gesture, multiTouched: true, dragged: false })).toBe(false);
    expect(releaseCommits({ ...gesture, armed: false, multiTouched: true, dragged: false })).toBe(
      false,
    );
    expect(dragIntent({ ...gesture, pointers: 2 })).toBe('pinch');
  });
  it('keeps a lane fraction and a moving fleet identity across camera changes', () => {
    const target = { kind: 'lane' as const, from: 'a', to: 'b', t: 0.25 };
    const before = (id: string) => (id === 'a' ? { x: 10, y: 20 } : { x: 110, y: 60 });
    const after = (id: string) => {
      const p = before(id);
      return { x: p.x * 2 - 30, y: p.y * 2 + 12 };
    };
    // Curved road positions come from the world's road resolver, not its endpoint chord.
    const resolve = vi.fn(() => ({ x: 35, y: 130 }));
    expect(mobileTargetPoint(target, before, () => null, resolve)).toEqual({ x: 35, y: 130 });
    expect(resolve).toHaveBeenCalledWith(target);
    expect(mobileTargetPoint(target, after, () => null, () => ({ x: 40, y: 272 }))).toEqual({ x: 40, y: 272 });
    expect(
      mobileTargetPoint(
        target,
        () => null,
        () => null,
        () => null,
      ),
    ).toBeNull();
    expect(
      mobileTargetPoint({ kind: 'fleet', id: 'moving' }, before, (id) =>
        id === 'moving' ? { x: 210, y: 40 } : null,
        () => null,
      ),
    ).toEqual({ x: 210, y: 40 });
  });
});
