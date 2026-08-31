import { describe, it, expect } from 'vitest';
import {
  deathCount,
  scoreSide,
  tallyDeath,
  lossOwner,
  recordLoss,
  type KillStats,
} from './warTally';

const ME = 'p1';
const FOE = 'p2';
const zero: KillStats = { destroyed: 0, lost: 0 };

describe('warTally — военный счёт', () => {
  it('мои погибшие идут в «потеряно», чужие — в «уничтожено» (правило 2)', () => {
    expect(scoreSide(ME, ME)).toBe('lost');
    expect(scoreSide(FOE, ME)).toBe('destroyed');
  });

  it('третья сторона считается уничтоженной, а не отдельной графой (правило 2)', () => {
    expect(scoreSide('p3', ME)).toBe('destroyed');
    expect(tallyDeath(zero, 'p3', ME, 4)).toEqual({ destroyed: 4, lost: 0 });
  });

  it('безымянный владелец — не я, значит «уничтожено» (правило 2, fail-safe)', () => {
    expect(scoreSide(undefined, ME)).toBe('destroyed');
    expect(scoreSide(null, ME)).toBe('destroyed');
  });

  it('событие без числа павших считается нулём, а не NaN (правило 3)', () => {
    expect(deathCount(undefined)).toBe(0);
    expect(deathCount(null)).toBe(0);
    expect(deathCount('3')).toBe(0);
    expect(tallyDeath({ destroyed: 7, lost: 2 }, FOE, ME, undefined)).toEqual({
      destroyed: 7,
      lost: 2,
    });
  });

  it('число павших берётся как есть, включая ноль', () => {
    expect(deathCount(0)).toBe(0);
    expect(deathCount(12)).toBe(12);
  });

  it('счёт накапливается и не трогает исходный объект', () => {
    const before: KillStats = { destroyed: 5, lost: 1 };
    const after = tallyDeath(tallyDeath(before, FOE, ME, 3), ME, ME, 2);
    expect(after).toEqual({ destroyed: 8, lost: 3 });
    expect(before).toEqual({ destroyed: 5, lost: 1 });
  });
});

describe('warTally — ведомость потерь', () => {
  it('безымянный владелец сводится в «?», а не в undefined (правило 5)', () => {
    expect(lossOwner(undefined)).toBe('?');
    expect(lossOwner(null)).toBe('?');
    expect(lossOwner(7)).toBe('?');
    expect(lossOwner(FOE)).toBe(FOE);
    expect(Object.keys(recordLoss(undefined, undefined, 'fighter', 2))).toEqual(['?']);
  });

  it('первая запись заводит и сторону, и тип юнита', () => {
    expect(recordLoss(undefined, FOE, 'fighter', 3)).toEqual({ [FOE]: { fighter: 3 } });
  });

  it('повторная гибель того же типа СКЛАДЫВАЕТСЯ (правило 6)', () => {
    let led = recordLoss(undefined, FOE, 'fighter', 3);
    led = recordLoss(led, FOE, 'fighter', 4);
    expect(led).toEqual({ [FOE]: { fighter: 7 } });
  });

  it('разные типы у одной стороны живут рядом, а не вытесняют друг друга', () => {
    let led = recordLoss(undefined, FOE, 'fighter', 3);
    led = recordLoss(led, FOE, 'cruiser', 1);
    expect(led).toEqual({ [FOE]: { fighter: 3, cruiser: 1 } });
  });

  it('разные стороны не смешиваются', () => {
    let led = recordLoss(undefined, FOE, 'fighter', 3);
    led = recordLoss(led, ME, 'fighter', 2);
    expect(led).toEqual({ [FOE]: { fighter: 3 }, [ME]: { fighter: 2 } });
  });

  it('порядок сторон — порядок учёта и НЕ меняется от повторной записи (правило 6)', () => {
    let led = recordLoss(undefined, 'zeta', 'fighter', 1);
    led = recordLoss(led, 'alpha', 'fighter', 1);
    led = recordLoss(led, 'zeta', 'cruiser', 1);
    expect(Object.keys(led)).toEqual(['zeta', 'alpha']);
  });

  it('ведомость не трогает исходную — сборка ленты читает снимок', () => {
    const before = recordLoss(undefined, FOE, 'fighter', 3);
    const after = recordLoss(before, FOE, 'fighter', 3);
    expect(before).toEqual({ [FOE]: { fighter: 3 } });
    expect(after).toEqual({ [FOE]: { fighter: 6 } });
  });

  it('гибель без числа заводит сторону с нулём, а не ломает ведомость (правило 3)', () => {
    expect(recordLoss(undefined, FOE, 'fighter', undefined)).toEqual({ [FOE]: { fighter: 0 } });
  });
});
