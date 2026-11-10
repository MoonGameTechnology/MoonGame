import { describe, expect, it } from 'vitest';
import { SPY_TASKS, taskBlock } from './spyTasks';

const enemy = { owner: 'p2', coalitionMate: false };
const own = { owner: 'p1', coalitionMate: false };
const neutral = { owner: null, coalitionMate: false };
const mate = { owner: 'p3', coalitionMate: true };
const AGGRESSIVE = ['recon', 'research', 'theft', 'delay', 'disrupt', 'sabotage'] as const;

describe('spyTasks — карточки окна «Дать задание»', () => {
  it('правило 1: от безобидного к агрессивному, саботаж последним', () => {
    expect(SPY_TASKS[0]).toBe('relocate');
    expect(SPY_TASKS[1]).toBe('counter');
    expect(SPY_TASKS.at(-1)).toBe('sabotage');
    expect(new Set(SPY_TASKS).size).toBe(8);
  });

  it('правило 2: передислоцироваться можно куда угодно, кроме места, где шпион стоит', () => {
    for (const w of [enemy, own, neutral, mate]) expect(taskBlock('relocate', w, 'p1', false)).toBeNull();
    expect(taskBlock('relocate', enemy, 'p1', true)).toBe('here');
  });

  it('правило 3: контрразведка на своём и на чужом мире, но не на ничейном', () => {
    expect(taskBlock('counter', own, 'p1', false)).toBeNull();
    expect(taskBlock('counter', enemy, 'p1', false)).toBeNull();
    expect(taskBlock('counter', neutral, 'p1', false)).toBe('no-owner');
  });

  it('правило 4: агрессивные задания только против чужого мира вне своей коалиции', () => {
    for (const op of AGGRESSIVE) {
      expect(taskBlock(op, enemy, 'p1', false)).toBeNull();
      expect(taskBlock(op, enemy, 'p1', true)).toBeNull();
      expect(taskBlock(op, own, 'p1', false)).toBe('own-world');
      expect(taskBlock(op, neutral, 'p1', false)).toBe('no-owner');
      expect(taskBlock(op, mate, 'p1', false)).toBe('coalition');
    }
  });

  it('правило 5: без выбранного мира всё доступно', () => {
    for (const task of SPY_TASKS) expect(taskBlock(task, null, 'p1', false)).toBeNull();
  });
});
