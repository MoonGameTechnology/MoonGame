import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fleet, GameState } from '../../packages/shared-core/src/index';
import { drawTroopTransferEffects } from './mapTransfers';

const env = vi.hoisted(() => ({ motion: true, halo: 0.12 }));
vi.mock('./fleetGeometry', () => ({ fleetAnchor: () => ({ x: 170, y: 100 }) }));
vi.mock('./mapCamera', () => ({
  world: (point: { x: number; y: number }) => point,
  visible: (point: { x: number; y: number }) => point.x >= 0 && point.x < 500,
}));
vi.mock('./mapPalette', () => ({
  TAU: Math.PI * 2,
  ownerColor: () => '#00ffcc',
  blitGlow: () => {},
}));
vi.mock('./graphicsPrefs', () => ({ motionOn: () => env.motion, fxBreath: () => env.halo }));
afterEach(() => {
  env.motion = true;
});

const claim = { unit: 'militia', count: 1, from: 'earth', startAt: 0, doneAt: 1000 };
const fleet = (id: string, owner = 'p1', location = 'earth'): Fleet => ({
  id,
  owner,
  location,
  movement: null,
  units: [],
  traits: [],
  loading: [claim],
});
const scene = (fleets: Fleet[]): GameState =>
  ({
    time: 500,
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
    planets: { earth: { position: { x: 100, y: 100 } }, away: { position: { x: -1000, y: 100 } } },
  }) as unknown as GameState;
function paint(s: GameState, now = 1000): Array<[string, ...number[]]> {
  const calls: Array<[string, ...number[]]> = [];
  const cx = new Proxy(
    {},
    {
      get:
        (_target, key) =>
        (...args: number[]) =>
          calls.push([String(key), ...args]),
    },
  ) as CanvasRenderingContext2D;
  drawTroopTransferEffects(s, 'p1', cx, now);
  return calls;
}

describe('отрисовка перевозок', () => {
  it('движется по часам; при выключенном движении остаётся неизменный видимый путь', () => {
    const s = scene([fleet('carrier')]);
    expect(paint(s, 1000)).not.toEqual(paint(s, 1300));
    env.motion = false;
    const a = paint(s, 1000),
      b = paint(s, 1300);
    expect(a).toEqual(b);
    expect(a.filter((c) => c[0] === 'quadraticCurveTo')).toHaveLength(1);
    expect(a.filter((c) => c[0] === 'lineTo').length).toBeGreaterThan(0);
  });

  it('не рисует чужие, завершённые и отсутствующие заявки', () => {
    const s = scene([fleet('enemy', 'p2')]);
    expect(paint(s).filter((c) => c[0] === 'quadraticCurveTo')).toHaveLength(0);
    s.fleets = { own: fleet('own') };
    s.time = 1000;
    expect(paint(s).filter((c) => c[0] === 'quadraticCurveTo')).toHaveLength(0);
    s.time = 500;
    s.fleets.own!.loading = [];
    expect(paint(s).filter((c) => c[0] === 'quadraticCurveTo')).toHaveLength(0);
  });

  it('ограничивает число видимых потоков; невидимые заявки не отнимают бюджет', () => {
    const offscreen = Array.from({ length: 30 }, (_, i) => ({
      ...fleet(`off-${i}`, 'p1', 'away'),
      loading: [{ ...claim, from: 'away' }],
    }));
    const onscreen = Array.from({ length: 50 }, (_, i) => fleet(`on-${i}`));
    const calls = paint(scene([...offscreen, ...onscreen]));
    expect(calls.filter((c) => c[0] === 'quadraticCurveTo')).toHaveLength(24);
    expect(calls.filter((c) => c[0] === 'save')).toHaveLength(1);
    expect(calls.filter((c) => c[0] === 'restore')).toHaveLength(1);
  });
});
