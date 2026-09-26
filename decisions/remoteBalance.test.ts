import { describe, expect, it } from 'vitest';

import { shippedGameData } from '../data/bundle';
import { parseGameData } from '../packages/shared-core/src/index';
import { applyBalanceFlags, BALANCE_FLAGS, parseBalanceFlags } from './remoteBalance';

const data = shippedGameData();
const pve = () => data.modes['pve_waves']!.pve!;

describe('parseBalanceFlags', () => {
  it('reads known flags from the strings the platform sends', () => {
    expect(
      parseBalanceFlags({ pve_waves: '8', pve_wave_interval_hours: '4.5', pve_swarm_speed: '1' }),
    ).toEqual({ pve_waves: 8, pve_wave_interval_hours: 4.5, pve_swarm_speed: 1 });
  });

  it('drops garbage, fractions where an integer is needed and out-of-range values', () => {
    expect(
      parseBalanceFlags({
        pve_waves: '2.5',
        pve_hold_hours: '0',
        pve_wave_interval_hours: 'fast',
        pve_swarm_speed: '',
        pve_boss_reward: '1e9',
      }),
    ).toEqual({});
  });

  it('keeps only whitelisted names', () => {
    expect(
      parseBalanceFlags({
        npcFaction: 'terran',
        'modes.pve_waves.pve.waves': '3',
        __proto__: '5',
        toString: '5',
      }),
    ).toEqual({});
  });

  it('treats a missing or broken flag set as "no flags"', () => {
    for (const raw of [undefined, null, 'pve_waves=3', ['3'], 42]) {
      expect(parseBalanceFlags(raw)).toEqual({});
    }
  });
});

describe('applyBalanceFlags', () => {
  it('no flags → the very same catalogue', () => {
    expect(applyBalanceFlags(data, {})).toBe(data);
  });

  it('replaces exactly the flagged numbers and leaves the input untouched', () => {
    const before = JSON.stringify(data);
    const out = applyBalanceFlags(
      data,
      parseBalanceFlags({ pve_waves: '7', pve_hold_hours: '20' }),
    );
    expect(out.modes['pve_waves']!.pve!.waves).toBe(7);
    expect(out.modes['pve_waves']!.pve!.holdHours).toBe(20);
    expect(out.modes['pve_waves']!.pve!.waveIntervalHours).toBe(pve().waveIntervalHours);
    expect(JSON.stringify(data)).toBe(before);
    // Untouched branches are shared, not copied.
    expect(out.units).toBe(data.units);
  });

  it('a flag cannot change a rule: everything but the knob numbers stays identical', () => {
    const everyKnob = Object.fromEntries(
      Object.entries(BALANCE_FLAGS).map(([name, knob]) => [name, knob.max]),
    );
    const out = applyBalanceFlags(data, parseBalanceFlags(everyKnob));
    // Put the shipped numbers back: nothing else may differ.
    const restored = JSON.parse(JSON.stringify(out));
    const shipped = JSON.parse(JSON.stringify(data));
    for (const knob of Object.values(BALANCE_FLAGS)) {
      const at = (root: Record<string, unknown>) =>
        knob.path
          .slice(0, -1)
          .reduce<Record<string, unknown>>(
            (node, key) => node[key] as Record<string, unknown>,
            root,
          );
      const field = knob.path[knob.path.length - 1]!;
      expect(at(restored)[field]).toBe(knob.max);
      at(restored)[field] = at(shipped)[field];
    }
    expect(restored).toEqual(shipped);
  });

  it('never creates a field the catalogue does not have', () => {
    const noBoss = {
      ...data,
      modes: {
        ...data.modes,
        pve_waves: { ...data.modes['pve_waves']!, pve: { ...pve(), boss: undefined } },
      },
    };
    delete (noBoss.modes.pve_waves.pve as { boss?: unknown }).boss;
    const out = applyBalanceFlags(noBoss, parseBalanceFlags({ pve_boss_reward: '10' }));
    expect(out).toBe(noBoss);
  });

  it('every knob path points at a shipped number, and the result still passes the schema', () => {
    for (const [name, knob] of Object.entries(BALANCE_FLAGS)) {
      const value = knob.path.reduce<unknown>(
        (node, key) => (node as Record<string, unknown> | undefined)?.[key],
        data,
      );
      expect(typeof value, name).toBe('number');
    }
    for (const bound of ['min', 'max'] as const) {
      const flags = Object.fromEntries(
        Object.entries(BALANCE_FLAGS).map(([name, knob]) => [name, String(knob[bound])]),
      );
      const out = applyBalanceFlags(data, parseBalanceFlags(flags));
      expect(() => parseGameData(JSON.parse(JSON.stringify(out)))).not.toThrow();
    }
  });
});
