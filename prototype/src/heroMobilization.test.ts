import { describe, expect, it } from 'vitest';
import { newGame, networkSeats } from './matchSetup';
import { data } from './gameData';
import { order, advance, canOrder } from './protoKernel';
import { spawnHero, researchTech } from '../../decisions/actions';
import {
  activeHeroCount,
  heroActiveCap,
  matchHours,
  matchUnitHours,
  createKernel,
  heroModule,
} from '../../packages/shared-core/src/index';
import { initHeroStaff } from './heroStaff';
import { liveText } from './liveTimers.fixture';
import { techFx } from './techTree';
import { setLocale, t } from '../../localization/runtime';
import { HOUR } from './time';

function ready() {
  const state = newGame({ mapId: 'duel-1', seats: networkSeats('ffa', 'duel-1') });
  state.players.p1!.technologies!.completed.push('signal_corps', 'flagship_command');
  const heroes = Object.values(state.heroes!).filter((h) => h.owner === 'p1');
  return { state, heroes, duration: matchUnitHours(state, data.units.hero!.buildTimeHours) * HOUR };
}

describe('main-game hero mobilization', () => {
  it('starts with one place and opens the second and third through completed research', () => {
    const { state } = ready();
    expect(heroActiveCap(state, 'p1', data)).toBe(1);
    state.players.p1!.technologies!.completed.push('hero_command_ii');
    expect(heroActiveCap(state, 'p1', data)).toBe(2);
    state.players.p1!.technologies!.completed.push('hero_command_iii', 'hero_command_ii');
    expect(heroActiveCap(state, 'p1', data)).toBe(3);
    expect(heroActiveCap(state, 'p2', data)).toBe(1);
  });

  it('creates no ship until the authoritative deadline and leaves input untouched', () => {
    const { state, heroes, duration } = ready();
    const hero = heroes[0]!;
    const before = JSON.stringify(state);
    const result = order(state, spawnHero('p1', hero.id, 'home_1'), state.time);
    expect(result.error).toBeUndefined();
    expect(JSON.stringify(state)).toBe(before);
    const pending = result.state.heroes![hero.id]!;
    expect(pending.fleetId).toBeUndefined();
    expect(pending.mobilization).toEqual({ target: 'home_1', startedAt: 0, readyAt: duration });
    const early = advance(result.state, duration - 1).state;
    expect(early.heroes![hero.id]!.fleetId).toBeUndefined();
    const done = advance(early, duration).state;
    expect(done.heroes![hero.id]!.mobilization).toBeUndefined();
    expect(done.heroes![hero.id]!.alive).toBe(true);
    expect(done.fleets[done.heroes![hero.id]!.fleetId!]!.location).toBe('home_1');
  });

  it('reserves the place and rejects duplicate preparation and a second hero', () => {
    const { state, heroes } = ready();
    const pending = order(state, spawnHero('p1', heroes[0]!.id, 'home_1'), state.time).state;
    expect(activeHeroCount(pending, 'p1')).toBe(1);
    expect(canOrder(pending, spawnHero('p1', heroes[0]!.id, 'home_1'))).toBe('E_HERO_MOBILIZING');
    expect(canOrder(pending, spawnHero('p1', heroes[1]!.id, 'home_1'))).toBe('E_HERO_CAP');
  });

  it('allows two preparations after unlocking a place and still blocks a third', () => {
    const { state, heroes } = ready();
    state.players.p1!.technologies!.completed.push('hero_command_ii');
    const first = order(state, spawnHero('p1', heroes[0]!.id, 'home_1'), state.time).state;
    const second = order(first, spawnHero('p1', heroes[1]!.id, 'home_1'), first.time);
    expect(second.error).toBeUndefined();
    expect(activeHeroCount(second.state, 'p1')).toBe(2);
    expect(canOrder(second.state, spawnHero('p1', heroes[2]!.id, 'home_1'))).toBe('E_HERO_CAP');
  });

  it('continues identically after JSON save/restore', () => {
    const { state, heroes, duration } = ready();
    const pending = order(state, spawnHero('p1', heroes[0]!.id, 'home_1'), state.time).state;
    expect(advance(JSON.parse(JSON.stringify(pending)), duration).state).toEqual(
      advance(pending, duration).state,
    );
  });

  it('cancels and releases the place if the deployment world is lost', () => {
    const { state, heroes, duration } = ready();
    const pending = order(state, spawnHero('p1', heroes[0]!.id, 'home_1'), state.time).state;
    pending.planets.home_1!.owner = 'p2';
    pending.planets.home_2!.owner = 'p1'; // keep the match alive while the original site is lost
    const done = advance(pending, duration).state;
    expect(done.heroes![heroes[0]!.id]!.fleetId).toBeUndefined();
    expect(done.heroes![heroes[0]!.id]!.mobilization).toBeUndefined();
    expect(activeHeroCount(done, 'p1')).toBe(0);
  });

  it('keeps legacy and campaign place limits unchanged', () => {
    const state = newGame();
    expect(heroActiveCap(state, 'p1', data)).toBe(3);
  });

  it('grants the extra place only after the research timer finishes', () => {
    const { state } = ready();
    state.time = 2 * 24 * HOUR;
    state.players.p1!.resources = { credits: 10000, metal: 10000, microelectronics: 1000 };
    const result = order(state, researchTech('p1', 'hero_command_ii'), state.time);
    expect(result.error).toBeUndefined();
    expect(heroActiveCap(result.state, 'p1', data)).toBe(1);
    const done = advance(result.state, state.time + matchHours(state, 8) * HOUR).state;
    expect(done.players.p1!.technologies!.completed).toContain('hero_command_ii');
    expect(heroActiveCap(done, 'p1', data)).toBe(2);
  });

  it('compresses preparation by the authoritative match time scale', () => {
    const { state, heroes, duration } = ready();
    const kernel = createKernel([heroModule]);
    const ctx = { now: state.time, data, config: { timeScale: 4 } };
    const result = kernel.applyAction(state, spawnHero('p1', heroes[0]!.id, 'home_1'), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.heroes![heroes[0]!.id]!.mobilization!.readyAt).toBe(duration / 4);
    const done = kernel.advanceTo(result.state, { ...ctx, now: duration / 4 });
    expect(done.ok).toBe(true);
    if (!done.ok) throw new Error(done.code);
    expect(done.state.heroes![heroes[0]!.id]!.alive).toBe(true);
  });

  it('shows the live preparation timer and counts its occupied place in headquarters', () => {
    setLocale('ru');
    const { state, heroes } = ready();
    let current = order(state, spawnHero('p1', heroes[0]!.id, 'home_1'), state.time).state;
    const staff = initHeroStaff({
      state: () => current,
      me: () => 'p1',
      order: () => {},
      note: () => {},
      armCast: () => {},
      armSpawn: () => {},
    });
    const before = staff.paneHtml();
    // Отсчёт — живой узел (`liveTimers.ts`): цифры ставит патч, разметка с часами не меняется.
    const seen = (html: string): string => liveText(html, current.time);
    expect(seen(before)).toContain('Мобилизация: 40:00:00');
    expect(before).toContain(t('hero.hq.deployed-count', { a: 1, c: 1 }));
    expect(before).not.toContain(`data-hspawn="${heroes[0]!.id}"`);
    current = advance(current, 1000).state;
    expect(staff.paneHtml()).toBe(before);
    expect(seen(before)).toContain('Мобилизация: 39:59:59');
    expect(techFx(data.technologies.hero_command_ii!)).toContain('+1 слот героя');
    expect(techFx(data.technologies.hero_command_ii!)).not.toContain('100%');
  });

  it('offers mobilization again when a dead hero can return and a place has become free', () => {
    const { state, heroes } = ready();
    const hero = heroes[0]!;
    hero.alive = false;
    hero.cooldowns.respawn = 0;
    const staff = initHeroStaff({ state: () => state, me: () => 'p1', order: () => {},
      note: () => {}, armCast: () => {}, armSpawn: () => {} });
    expect(staff.paneHtml()).toContain(`data-hspawn="${hero.id}"`);
    expect(canOrder(state, spawnHero('p1', hero.id, 'home_1'))).toBeNull();
  });
});
