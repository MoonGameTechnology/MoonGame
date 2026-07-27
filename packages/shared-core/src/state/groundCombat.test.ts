import { describe, it, expect } from 'vitest';
import {
  damageBuckets,
  groundTick,
  resolveGround,
  makeSide,
  GROUND_ROSTER,
  type GroundRoster,
} from './groundCombat';

// FND-4 (game-vision-roadmap.md): port of the prototype's groundcombat.test.ts —
// same assertions, same numbers, verifying the ported engine matches the
// already-tuned/already-tested prototype bit-for-bit. Officer-bonus coverage is
// deliberately NOT ported (out of FND-4's stated scope, see groundCombat.ts).

const empty = { heavy_infantry: { hp: 24, atk: {}, def: {} }, tank: { hp: 46, atk: {}, def: {} } };

describe('ground combat — matrix damage weighted by target composition', () => {
  it('routes a unit’s atk(inf 1, tank 2) into a 2-inf+2-tank target (50/50)', () => {
    const roster: GroundRoster = { ...empty, tank: { hp: 46, atk: { heavy_infantry: 1, tank: 2 }, def: {} } };
    const attacker = makeSide(roster, { tank: 1 });
    const defender = makeSide(roster, { heavy_infantry: 2, tank: 2 });
    const b = damageBuckets(roster, attacker, defender, 'atk');
    expect(b.heavy_infantry).toBeCloseTo(0.5);
    expect(b.tank).toBeCloseTo(1.0);
    expect(b.heavy_infantry! / 2).toBeCloseTo(0.25);
    expect(b.tank! / 2).toBeCloseTo(0.5);
  });

  it('weights anti-inf 10 / anti-armour 6 by a 3-inf+3-tank target → 5 + 3 = 8 total', () => {
    const roster: GroundRoster = { ...empty, tank: { hp: 46, atk: { heavy_infantry: 10, tank: 6 }, def: {} } };
    const attacker = makeSide(roster, { tank: 1 });
    const defender = makeSide(roster, { heavy_infantry: 3, tank: 3 });
    const b = damageBuckets(roster, attacker, defender, 'atk');
    expect(b.heavy_infantry).toBeCloseTo(5);
    expect(b.tank).toBeCloseTo(3);
    expect((b.heavy_infantry ?? 0) + (b.tank ?? 0)).toBeCloseTo(8);
  });

  it('a pure-heavy_infantry target takes ALL the anti-heavy_infantry damage, none routed to armour', () => {
    const attacker = makeSide(GROUND_ROSTER, { tank: 6 });
    const defender = makeSide(GROUND_ROSTER, { heavy_infantry: 6 });
    const b = damageBuckets(GROUND_ROSTER, attacker, defender, 'atk');
    expect(b.heavy_infantry).toBeCloseTo(6 * GROUND_ROSTER.tank!.atk.heavy_infantry!);
    expect(b.tank).toBeUndefined();
  });

  it('both sides trade each tick — the defender returns its def damage', () => {
    const attacker = makeSide(GROUND_ROSTER, { tank: 2 });
    const defender = makeSide(GROUND_ROSTER, { tank: 2 });
    const t = groundTick(GROUND_ROSTER, attacker, defender);
    expect(t.toDefender.tank).toBeCloseTo(2 * GROUND_ROSTER.tank!.atk.tank!);
    expect(t.toAttacker.tank).toBeCloseTo(2 * GROUND_ROSTER.tank!.def.tank!);
  });

  it('caps firepower at 12 firing units — the rest are reserve HP', () => {
    const target = makeSide(GROUND_ROSTER, { tank: 1 });
    const out12 = damageBuckets(GROUND_ROSTER, makeSide(GROUND_ROSTER, { heavy_infantry: 12 }), target, 'atk');
    const out13 = damageBuckets(GROUND_ROSTER, makeSide(GROUND_ROSTER, { heavy_infantry: 13 }), target, 'atk');
    expect(out13.tank).toBeCloseTo(out12.tank!);
  });

  it('the 12 firing slots go to the units MOST EFFECTIVE vs the enemy (best counter fires)', () => {
    const defenders = makeSide(GROUND_ROSTER, { tank: 12, heavy_infantry: 12 });
    const enemy = makeSide(GROUND_ROSTER, { tank: 12 });
    const mixed = damageBuckets(GROUND_ROSTER, defenders, enemy, 'def').tank!;
    const tankOnly = damageBuckets(GROUND_ROSTER, makeSide(GROUND_ROSTER, { tank: 12 }), enemy, 'def').tank!;
    const infOnly = damageBuckets(GROUND_ROSTER, makeSide(GROUND_ROSTER, { heavy_infantry: 12 }), enemy, 'def').tank!;
    expect(mixed).toBeCloseTo(tankOnly);
    expect(mixed).not.toBeCloseTo(infOnly);
  });

  it('vs an heavy_infantry enemy the best counter (tanks) fills the slots first', () => {
    const out = damageBuckets(
      GROUND_ROSTER,
      makeSide(GROUND_ROSTER, { heavy_infantry: 10, tank: 5 }),
      makeSide(GROUND_ROSTER, { heavy_infantry: 1 }),
      'atk',
    );
    const exp = 5 * GROUND_ROSTER.tank!.atk.heavy_infantry! + 7 * GROUND_ROSTER.heavy_infantry!.atk.heavy_infantry!;
    expect(out.heavy_infantry).toBeCloseTo(exp);
  });

  it('resolves the counter web: tanks overrun heavy_infantry', () => {
    const six = (u: 'heavy_infantry' | 'tank') => makeSide(GROUND_ROSTER, { [u]: 6 });
    expect(resolveGround(GROUND_ROSTER, six('tank'), six('heavy_infantry')).winner).toBe('attacker');
  });

  it('kills whole units as the HP pool drops, and ends with a winner', () => {
    const out = resolveGround(GROUND_ROSTER, makeSide(GROUND_ROSTER, { tank: 6 }), makeSide(GROUND_ROSTER, { heavy_infantry: 6 }));
    expect(out.winner).toBe('attacker');
    expect(out.defender).toHaveLength(0);
    expect(out.attacker[0]!.count).toBeGreaterThan(0);
    expect(out.rounds).toBeGreaterThan(0);
  });

  it('special forces (man-portable AT) bite armour harder than any other infantry', () => {
    const vsTank = (type: 'militia' | 'heavy_infantry' | 'special_forces'): number =>
      GROUND_ROSTER[type]!.atk.tank!;
    expect(vsTank('special_forces')).toBeGreaterThan(vsTank('heavy_infantry'));
    expect(vsTank('special_forces')).toBeGreaterThan(vsTank('militia'));
  });
});
