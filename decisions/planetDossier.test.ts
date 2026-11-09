import { describe, expect, it } from 'vitest';
import { groupBuildings, hpTone, incomeCells, scanAgeHours } from './planetDossier';

describe('planetDossier', () => {
  it('groups buildings in the build-window order and drops empty groups', () => {
    const groupOf = (t: string) => (t === 'fort' ? 'defense' : t === 'mine' ? 'economy' : 'infra');
    const out = groupBuildings(
      [{ type: 'radar' }, { type: 'mine' }, { type: 'shipyard' }, { type: 'mine2' }],
      (t) => (t === 'mine2' ? 'economy' : groupOf(t)),
    );
    expect(out.map((g) => g.group)).toEqual(['economy', 'infra']);
    expect(out[0]!.items.map((b) => b.type)).toEqual(['mine', 'mine2']);
    expect(out[1]!.items.map((b) => b.type)).toEqual(['radar', 'shipyard']);
  });

  it('keeps the resource order and leaves zero rates out', () => {
    expect(
      incomeCells({ metal: 33.6, credits: 51.3, energy: 0.01, food: -2 }, [
        'credits',
        'metal',
        'food',
        'energy',
        'microelectronics',
      ]),
    ).toEqual([
      { res: 'credits', perHour: 51.3 },
      { res: 'metal', perHour: 33.6 },
      { res: 'food', perHour: -2 },
    ]);
  });

  it('colours the health bar by how hurt the stack is', () => {
    expect(hpTone(100)).toBe('full');
    expect(hpTone(70)).toBe('hurt');
    expect(hpTone(29)).toBe('low');
  });

  it('names the age of a scan in whole hours', () => {
    const H = 3_600_000;
    expect(scanAgeHours(undefined, 10 * H, H)).toBeNull();
    expect(scanAgeHours(7 * H, 10 * H + 1, H)).toBe(3);
    expect(scanAgeHours(11 * H, 10 * H, H)).toBe(0);
  });
});
