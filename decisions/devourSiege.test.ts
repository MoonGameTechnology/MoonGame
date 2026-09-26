import { describe, expect, it } from 'vitest';
import { devourSieges } from './devourSiege';
import { createInitialState, type GameState, type Hero } from '../packages/shared-core/src/index';

const HOUR = 3_600_000;

function hero(id: string, siege: Hero['siege'], alive = true): Hero {
  return { id, owner: 'swarm', location: 'x', cooldowns: {}, alive, archetype: 'leviathan', ...(siege ? { siege } : {}) };
}
function state(time: number, heroes: Hero[]): GameState {
  const s = createInitialState({ seed: 'siege', version: { data: '0.1.0', manifest: '1' } });
  return { ...s, time, heroes: Object.fromEntries(heroes.map((h) => [h.id, h])) };
}

describe('devourSieges — таймер осады над миром игрока (PVR-4.7)', () => {
  it('отсчёт и доля пройденного — от записи осады', () => {
    const s = state(HOUR, [hero('b', { target: 'home', victim: 'me', since: 0, until: 4 * HOUR })]);
    expect(devourSieges(s, 'me')).toEqual([
      { target: 'home', archetype: 'leviathan', leftMs: 3 * HOUR, progress: 0.25 },
    ]);
  });

  it('только миры зрителя: чужую осаду не рисуют', () => {
    const s = state(0, [hero('b', { target: 'rim', victim: 'ally', since: 0, until: 4 * HOUR })]);
    expect(devourSieges(s, 'me')).toEqual([]);
  });

  it('мёртвый герой осады не ведёт, герой без осады — тоже', () => {
    const s = state(0, [
      hero('dead', { target: 'home', victim: 'me', since: 0, until: 4 * HOUR }, false),
      hero('idle', undefined),
    ]);
    expect(devourSieges(s, 'me')).toEqual([]);
    expect(devourSieges(state(0, []), 'me')).toEqual([]);
  });

  it('отсчёт не уходит в минус, доля — не больше единицы', () => {
    const s = state(5 * HOUR, [hero('b', { target: 'home', victim: 'me', since: 0, until: 4 * HOUR })]);
    expect(devourSieges(s, 'me')[0]).toMatchObject({ leftMs: 0, progress: 1 });
  });

  it('ближайшая гибель первой, равные сроки — по id мира', () => {
    const s = state(0, [
      hero('z', { target: 'b', victim: 'me', since: 0, until: 4 * HOUR }),
      hero('y', { target: 'a', victim: 'me', since: 0, until: 4 * HOUR }),
      hero('x', { target: 'c', victim: 'me', since: 0, until: 2 * HOUR }),
    ]);
    expect(devourSieges(s, 'me').map((m) => m.target)).toEqual(['c', 'a', 'b']);
  });
});
