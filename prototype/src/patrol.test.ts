import { describe, expect, it } from 'vitest';
import {
  freshSortie,
  spendSortie,
  tickRearm,
  canSortie,
  patrolTarget,
  scrambleOrder,
  type Patrol,
} from './game';
import type { Fleet } from '../../packages/shared-core/src/index';

// Патруль крыла (SQ-4.1) и реактивный дежурный вылет (CC-4) — это `patrol.ts`
// прототипа, а не хелперы крыла: те свелись в ядро (CONV-5) и проверяются в
// `packages/shared-core/src/state/squadron.test.ts`, а предикаты «действующего крыла»
// уехали в `decisions/wingOrders.ts`. Файл переехал из `squadron.test.ts` вместе со
// сведением — здесь осталось ровно то, чего в ядре нет.

describe('squadron patrol (SQ-4.1)', () => {
  const center = { x: 500, y: 500 };
  const patrol = (sortie = freshSortie(3)): Patrol => ({ center, radius: 180, sortie });

  it('strikes the lowest-id enemy inside the radius', () => {
    const enemies = [
      { id: 'foe-b', pos: { x: 560, y: 500 } }, // in range
      { id: 'foe-a', pos: { x: 500, y: 560 } }, // in range, lower id → wins the tie-break
      { id: 'foe-c', pos: { x: 900, y: 900 } }, // out of range
    ];
    expect(patrolTarget(patrol(), enemies)).toBe('foe-a');
  });

  it('holds fire when no enemy is inside the radius', () => {
    expect(patrolTarget(patrol(), [{ id: 'far', pos: { x: 5000, y: 5000 } }])).toBeNull();
  });

  it('holds fire while rearming even with an enemy in the zone', () => {
    const grounded = patrol({ fuel: 0, rearming: 2 });
    expect(patrolTarget(grounded, [{ id: 'foe', pos: center }])).toBeNull();
  });

  it('full loop: enemy in zone → strike each round until dry → rearm → active again', () => {
    const max = 3,
      rearm = 2;
    let p = patrol(freshSortie(max));
    const enemy = [{ id: 'raider', pos: { x: 540, y: 500 } }]; // parked inside the zone
    // Burns exactly maxFuel sorties while the raider loiters.
    let strikes = 0;
    while (patrolTarget(p, enemy) !== null) {
      p = { ...p, sortie: spendSortie(p.sortie, rearm) };
      strikes++;
    }
    expect(strikes).toBe(max);
    expect(p.sortie.rearming).toBe(rearm); // now grounded, rearming
    // Rearm to completion — patrol still holds fire.
    for (let i = 0; i < rearm; i++) {
      expect(patrolTarget(p, enemy)).toBeNull();
      p = { ...p, sortie: tickRearm(p.sortie, max) };
    }
    // Refuelled → the patrol re-engages the same loitering raider.
    expect(patrolTarget(p, enemy)).toBe('raider');
    expect(canSortie(p.sortie)).toBe(true);
  });
});

describe('reactive auto-scramble order (CC-4)', () => {
  const center = { x: 500, y: 500 };
  const patrol = (sortie = freshSortie(3)): Patrol => ({ center, radius: 180, sortie });
  const wing = (location: string | null): Fleet =>
    ({ id: 'wing', owner: 'green', location, movement: null, units: [] }) as unknown as Fleet;
  const targets = [
    { id: 'raider', location: 'p2', pos: { x: 540, y: 500 } }, // in range, on a node
    { id: 'far', location: 'p9', pos: { x: 5000, y: 5000 } }, // out of range
  ];

  it('engages a co-located in-range contact and burns a sortie', () => {
    const r = scrambleOrder('green', wing('p2'), patrol(), targets, 2);
    expect(r.action?.type).toBe('fleet.engage');
    expect(r.action?.payload).toMatchObject({ fleetId: 'wing', targetId: 'raider' });
    expect(r.sortie).toEqual({ fuel: 2, rearming: 0 }); // one fuel spent
  });

  it('flies to intercept an in-range contact parked elsewhere', () => {
    const r = scrambleOrder('green', wing('p1'), patrol(), targets, 2);
    expect(r.action?.type).toBe('fleet.move');
    expect(r.action?.payload).toMatchObject({ fleetId: 'wing', to: 'p2' }); // toward the raider's node
    expect(r.sortie.fuel).toBe(2);
  });

  it('holds fire (no order, no fuel spent) when nothing is in range', () => {
    const r = scrambleOrder('green', wing('p1'), patrol(), [targets[1]!], 2);
    expect(r.action).toBeNull();
    expect(r.sortie).toEqual({ fuel: 3, rearming: 0 });
  });

  it('holds fire while rearming', () => {
    const r = scrambleOrder('green', wing('p2'), patrol({ fuel: 0, rearming: 2 }), targets, 2);
    expect(r.action).toBeNull();
    expect(r.sortie).toEqual({ fuel: 0, rearming: 2 });
  });
});
