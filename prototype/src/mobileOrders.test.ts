import { describe, expect, it } from 'vitest';
import { mobileDraftMatches, mobileTargetPoint, type MobileOrderDraft } from './mobileOrders';
import { releaseCommits } from './aimGesture';
import { dragIntent } from './dragIntent';

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
    expect(mobileTargetPoint(target, before, () => null)).toEqual({ x: 35, y: 30 });
    expect(mobileTargetPoint(target, after, () => null)).toEqual({ x: 40, y: 72 });
    expect(
      mobileTargetPoint(
        target,
        () => null,
        () => null,
      ),
    ).toBeNull();
    expect(
      mobileTargetPoint({ kind: 'fleet', id: 'moving' }, before, (id) =>
        id === 'moving' ? { x: 210, y: 40 } : null,
      ),
    ).toEqual({ x: 210, y: 40 });
  });
});
