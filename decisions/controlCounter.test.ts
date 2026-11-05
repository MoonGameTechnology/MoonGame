import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  uncontrolledPlanets,
  UNCONTROLLED_OUTPUT,
  type GameState,
  type Planet,
} from '../packages/shared-core/src/index';
import { shippedGameData } from '../data/bundle';
import { controlCounter, controlTip } from './controlCounter';

const data = shippedGameData();

const world = (id: string, x: number, owner: string | null, kind?: string): Planet =>
  ({
    id,
    owner,
    ...(kind ? { kind } : {}),
    position: { x, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
    links: [],
  }) as unknown as Planet;

/** Место p1 со столицей C и `n` планетами всего, астероид p1 и планета соперника. */
function match(n: number): GameState {
  const s = createInitialState({ seed: 'counter', version: { data: 'test', manifest: 'test' } });
  s.modeId = 'standard';
  const planets: Planet[] = [world('C', 0, 'p1')];
  for (let i = 1; i < n; i++) planets.push(world(`P${i}`, i * 10, 'p1'));
  planets.push(world('rock', 5, 'p1', 'asteroid'), world('E', 500, 'p2'));
  // Цепочка лейнов от столицы: обход управления идёт по прыжкам.
  for (let i = 1; i < planets.length; i++) {
    planets[i - 1]!.links = [...(planets[i - 1]!.links ?? []), planets[i]!.id];
    planets[i]!.links = [...(planets[i]!.links ?? []), planets[i - 1]!.id];
  }
  s.planets = Object.fromEntries(planets.map((p) => [p.id, p]));
  s.capital = { p1: 'C', p2: 'E' };
  return s;
}

describe('счётчик лимита управления (BAL-19)', () => {
  it('считает только планеты места: астероид и чужой мир не в счёте', () => {
    expect(controlCounter(match(3), data, 'p1', 5)).toEqual({ planets: 3, limit: 5, over: 0 });
  });

  it('сверх лимита — сколько планет за ним; поднятый лимит их возвращает', () => {
    const s = match(7);
    expect(controlCounter(s, data, 'p1', 5)).toEqual({ planets: 7, limit: 5, over: 2 });
    expect(controlCounter(s, data, 'p1', 10)).toEqual({ planets: 7, limit: 10, over: 0 });
  });

  it('за лимитом столько же планет, сколько их видит правило ядра', () => {
    for (const n of [1, 5, 6, 9, 13])
      for (const limit of [5, 10, 16]) {
        const s = match(n);
        expect(controlCounter(s, data, 'p1', limit)!.over).toBe(
          uncontrolledPlanets(s, data, 'p1', s.modeId, limit).size,
        );
      }
  });

  it('список миров хоста даёт тот же счёт, что запись мира', () => {
    const s = match(6);
    expect(controlCounter(s, data, 'p1', 5, Object.values(s.planets))).toEqual(
      controlCounter(s, data, 'p1', 5),
    );
  });

  it('чипа нет в PvE и у места без столицы', () => {
    const pve = { ...match(3), modeId: 'pve_waves' } as GameState;
    expect(controlCounter(pve, data, 'p1', 5)).toBeNull();
    const waves = { ...match(3), pve: { waveNumber: 1, totalWaves: 5 } } as unknown as GameState;
    expect(controlCounter(waves, data, 'p1', 5)).toBeNull();
    expect(controlCounter(match(3), data, 'p3', 5)).toBeNull();
    const lost = match(3);
    lost.capital = { p1: 'gone' };
    expect(controlCounter(lost, data, 'p1', 5)).toBeNull();
  });

  it('подсказка: под управлением не больше лимита, вне управления — остаток', () => {
    const p = Math.round(UNCONTROLLED_OUTPUT * 100);
    expect(controlTip({ planets: 3, limit: 5, over: 0 }, UNCONTROLLED_OUTPUT)).toEqual({
      key: 'hud.control.tip',
      args: { n: 3, limit: 5, over: 0, p },
    });
    expect(controlTip({ planets: 7, limit: 5, over: 2 }, UNCONTROLLED_OUTPUT)).toEqual({
      key: 'hud.control.tip.over',
      args: { n: 5, limit: 5, over: 2, p },
    });
  });
});
