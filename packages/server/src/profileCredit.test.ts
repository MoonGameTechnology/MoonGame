import { describe, expect, it } from 'vitest';
import { createInitialState, type GameState, type Planet } from '@void/shared-core';
import { matchProfileProgress } from './profileCredit';

const world = (id: string, owner: string | null, extra: Partial<Planet> = {}): Planet => ({
  id,
  owner,
  position: { x: 0, y: 0 },
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
  ...extra,
});

describe('matchProfileProgress — площадка крепости на развилке (замечание Codex на #1410)', () => {
  it('крепость на развилке не мир и не разведанная провинция', () => {
    const s: GameState = createInitialState({ seed: 'profile', version: { data: '0.1.0', manifest: '1' } });
    s.planets = {
      A: world('A', 'p1', { buildings: [{ type: 'mine', level: 1, hp: 10 }] }),
      'fork-A-0': world('fork-A-0', 'p1', { fork: { province: 'A', trail: 0 }, buildings: [{ type: 'starfort', level: 1, hp: 10 }] }),
      'fork-B-0': world('fork-B-0', null, { fork: { province: 'B', trail: 0 } }),
    };
    s.fog = { p1: { A: {}, 'fork-A-0': {}, 'fork-B-0': {} } } as unknown as GameState['fog'];
    s.match = { ...s.match, status: 'ended', winner: 'p1' };
    const p = matchProfileProgress(s, 'p1');
    expect(p.worlds).toBe(1);
    expect(p.defended).toBe(1);
    expect(p.buildings).toBe(1);
    expect(p.explored).toBe(1);
  });
});
