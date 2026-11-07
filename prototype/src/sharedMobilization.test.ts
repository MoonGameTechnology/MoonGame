import { describe, expect, it } from 'vitest';
import { newGame, networkSeats } from './matchSetup';
import { data } from './gameData';
import { order, advance } from './protoKernel';
import { spawnHero, buildUnit, act } from '../../decisions/actions';
import {
  createKernel,
  constructionModule,
  heroModule,
  activeHeroCount,
} from '../../packages/shared-core/src/index';

function ready() {
  const s = newGame({ mapId: 'duel-1', seats: networkSeats('ffa', 'duel-1') });
  s.players.p1!.technologies!.completed = Object.keys(data.technologies);
  for (const key of Object.keys(s.players.p1!.resources)) s.players.p1!.resources[key] = 100000;
  s.planets.home_1!.buildings.push(
    { type: 'barracks', level: 1, hp: 100 },
    { type: 'factory', level: 1, hp: 100 },
  );
  const hero = Object.values(s.heroes!).find((h) => h.owner === 'p1')!;
  return { s, hero };
}
const activeUnits = (s: ReturnType<typeof ready>['s']) =>
  s.scheduled.filter((e) => e.type === 'construction.complete');

describe('shared ground and hero mobilization', () => {
  it('preserves FIFO across unit → hero → vehicle and JSON restore, without paying waiting orders', () => {
    const { s, hero } = ready();
    const troop = order(s, buildUnit('p1', 'home_1', 'militia', 1), s.time);
    expect(troop.error).toBeUndefined();
    const queued = order(troop.state, spawnHero('p1', hero.id, 'home_1'), s.time);
    expect(queued.error).toBeUndefined();
    expect(queued.state.heroes![hero.id]!.mobilization?.queued).toBe(true);
    expect(activeHeroCount(queued.state, 'p1')).toBe(1);
    const last = order(queued.state, buildUnit('p1', 'home_1', 'tank', 1), s.time);
    expect(last.error).toBeUndefined();
    expect(last.state.players.p1!.resources).toEqual(queued.state.players.p1!.resources);
    const deadline = activeUnits(last.state)[0]!.at;
    const restored = JSON.parse(JSON.stringify(last.state));
    const heroStarted = advance(restored, deadline).state;
    expect(heroStarted.heroes![hero.id]!.mobilization?.queued).toBeUndefined();
    expect(heroStarted.heroes![hero.id]!.mobilization?.readyAt).toBeGreaterThan(deadline);
    expect(activeUnits(heroStarted)).toHaveLength(0);
    const done = advance(heroStarted, heroStarted.heroes![hero.id]!.mobilization!.readyAt).state;
    expect(done.heroes![hero.id]!.fleetId).toBeTruthy();
    expect(activeUnits(done)).toHaveLength(1);
    expect(activeUnits(done)[0]!.payload).toMatchObject({ unit: 'tank' });
  });
  it('a running hero holds the ground line and duplicate spawn cannot reserve another slot', () => {
    const { s, hero } = ready();
    const first = order(s, spawnHero('p1', hero.id, 'home_1'), s.time);
    const duplicate = order(first.state, spawnHero('p1', hero.id, 'home_1'), s.time);
    expect(duplicate.error).toBe('E_HERO_MOBILIZING');
    const unit = order(first.state, buildUnit('p1', 'home_1', 'militia', 1), s.time);
    expect(unit.error).toBeUndefined();
    expect(activeUnits(unit.state)).toHaveLength(0);
    expect(unit.state.planets.home_1!.buildQueue).toHaveLength(1);
  });
  it('allows cancellation only for an owned waiting hero and frees its reservation', () => {
    const { s, hero } = ready();
    const first = order(s, buildUnit('p1', 'home_1', 'militia', 1), s.time).state;
    const waiting = order(first, spawnHero('p1', hero.id, 'home_1'), s.time).state;
    const payload = { heroId: hero.id };
    expect(order(waiting, act('p2', 'hero.mobilization.cancel', payload), s.time).error).toBe(
      'E_FORBIDDEN',
    );
    const cancelled = order(waiting, act('p1', 'hero.mobilization.cancel', payload), s.time);
    expect(cancelled.error).toBeUndefined();
    expect(cancelled.state.heroes![hero.id]!.mobilization).toBeUndefined();
    expect(activeHeroCount(cancelled.state, 'p1')).toBe(0);
    const live = order(s, spawnHero('p1', hero.id, 'home_1'), s.time).state;
    expect(order(live, act('p1', 'hero.mobilization.cancel', payload), s.time).error).toBe(
      'E_FORBIDDEN',
    );
  });
  it('counts both kinds against the same five waiting places', () => {
    const { s, hero } = ready();
    let state = order(s, buildUnit('p1', 'home_1', 'militia', 1), s.time).state;
    for (let i = 0; i < 4; i++) {
      const next = order(state, buildUnit('p1', 'home_1', 'militia', 1), s.time);
      expect(next.error).toBeUndefined();
      state = next.state;
    }
    const queued = order(state, spawnHero('p1', hero.id, 'home_1'), s.time);
    expect(queued.error).toBeUndefined();
    expect(order(queued.state, buildUnit('p1', 'home_1', 'tank', 1), s.time).error).toBe(
      'E_QUEUE_FULL',
    );
  });
  it('an unpaid unit at the head cannot be bypassed by a free hero; cancelling wakes the hero once', () => {
    const { s, hero } = ready();
    let state = order(s, buildUnit('p1', 'home_1', 'militia', 1), s.time).state;
    state = order(state, buildUnit('p1', 'home_1', 'tank', 1), s.time).state;
    state = order(state, spawnHero('p1', hero.id, 'home_1'), s.time).state;
    const deadline = activeUnits(state)[0]!.at;
    for (const k of Object.keys(state.players.p1!.resources)) state.players.p1!.resources[k] = 0;
    // Direct kernel advance avoids unrelated empire production replenishing the test wallet.
    const kernel = createKernel([constructionModule, heroModule]);
    const result = kernel.advanceTo(state, { now: deadline, data });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.state;
    expect(state.heroes![hero.id]!.mobilization?.queued).toBe(true);
    const seq = state.planets.home_1!.buildQueue![0]!.id;
    const cancelled = kernel.applyAction(
      state,
      act('p1', 'construction.cancel', { planetId: 'home_1', seq }),
      { now: deadline, data },
    );
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.state.heroes![hero.id]!.mobilization?.queued).toBeUndefined();
    expect(
      cancelled.state.scheduled.filter((e) => e.type === 'hero.mobilization.complete'),
    ).toHaveLength(1);
  });
  it('does not deploy a waiting hero on a captured planet', () => {
    const { s, hero } = ready();
    const first = order(s, buildUnit('p1', 'home_1', 'militia', 1), s.time).state;
    const waiting = order(first, spawnHero('p1', hero.id, 'home_1'), s.time).state;
    const kernel = createKernel([
      constructionModule,
      heroModule,
      {
        id: 'capture-test',
        version: '1',
        setup(api) {
          api.onAction('test.capture', (_a, h) => {
            h.state.planets.home_1!.owner = 'p2';
            h.emit('planet.captured', { planetId: 'home_1', owner: 'p2' });
          });
        },
      },
    ]);
    const result = kernel.applyAction(waiting, act('p2', 'test.capture', {}), {
      now: waiting.time,
      data,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const later = result.state;
    expect(later.heroes![hero.id]!.fleetId).toBeUndefined();
    expect(later.heroes![hero.id]!.mobilization).toBeUndefined();
  });
});
