import { describe, expect, it } from 'vitest';
import { battleOutcome, battlePhaseKey, lossTally, type BattleLosses } from './battleLog';

const имя = (id: string) => ({ p1: 'Лазурные', p2: 'Багровые' })[id] ?? id;

describe('правило 1 — фаза называется всегда', () => {
  it('десант', () => {
    expect(battlePhaseKey('ground')).toBe('log.battle.phase.ground');
  });
  it('орбита', () => {
    expect(battlePhaseKey('orbit')).toBe('log.battle.phase.orbit');
  });
  it('фазы нет вовсе — считаем орбитой, строка не остаётся без фазы', () => {
    expect(battlePhaseKey(undefined)).toBe('log.battle.phase.orbit');
    expect(battlePhaseKey('из-будущего')).toBe('log.battle.phase.orbit');
  });
});

describe('правило 2 — победитель или ничья, третьего нет', () => {
  it('победитель называется', () => {
    expect(battleOutcome('p2')).toEqual({ key: 'log.battle.win', named: true });
  });
  it.each([undefined, null, ''])('нет победителя (%s) — ничья', (w) => {
    expect(battleOutcome(w)).toEqual({ key: 'log.battle.draw', named: false });
  });
});

describe('правила 3–5 — сводка потерь', () => {
  it('потерь не было — сводки нет', () => {
    expect(lossTally(undefined, имя)).toBe('');
  });
  it('пустая карта потерь тоже даёт пустую сводку', () => {
    expect(lossTally({}, имя)).toBe('');
  });
  it('одна сторона: типы СУММИРУЮТСЯ в одно число', () => {
    const l: BattleLosses = { p2: { cruiser: 2, scout: 1 } };
    expect(lossTally(l, имя)).toBe('Багровые −3');
  });
  it('две стороны — через запятую, в порядке появления', () => {
    const l: BattleLosses = { p2: { cruiser: 1 }, p1: { scout: 4 } };
    expect(lossTally(l, имя)).toBe('Багровые −1, Лазурные −4');
  });
  it('незнакомая сторона называется своим идентификатором', () => {
    expect(lossTally({ p9: { scout: 2 } }, имя)).toBe('p9 −2');
  });
  it('нулевые потери стороны показываются как −0, а не пропадают', () => {
    expect(lossTally({ p1: { scout: 0 } }, имя)).toBe('Лазурные −0');
  });
  it('минус — типографский, а не дефис', () => {
    expect(lossTally({ p1: { scout: 1 } }, имя)).toContain('−');
    expect(lossTally({ p1: { scout: 1 } }, имя).includes('-')).toBe(false);
  });
});
