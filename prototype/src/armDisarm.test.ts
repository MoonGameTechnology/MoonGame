import { describe, expect, it } from 'vitest';
import { ALWAYS_DISARMED, KEEPS_ARMED, type ArmedState, disarms, keepsArmed } from './armDisarm';

const STATES = Object.keys(KEEPS_ARMED) as ArmedState[];

describe('keepsArmed', () => {
  // Правило 1: своя команда держит состояние взведённым.
  it('keeps every state armed under its own command', () => {
    for (const state of STATES)
      for (const cmd of KEEPS_ARMED[state]) expect(keepsArmed(state, cmd)).toBe(true);
  });

  // Правило 2: подкоманды поповера — свои, иначе меню закрывалось бы от своей же кнопки.
  it('keeps a popover alive while the player works inside it', () => {
    expect(keepsArmed('firemode', 'fmset')).toBe(true);
    expect(keepsArmed('cast', 'castdo')).toBe(true);
    expect(keepsArmed('troops', 'tstep')).toBe(true);
    expect(keepsArmed('troops', 'tmax')).toBe(true);
    expect(keepsArmed('troops', 'tok')).toBe(true);
  });

  // Правило 3: ☰ и сам ⊕ — часть той же сессии выбора, настоящий приказ из неё выводит.
  it('keeps the group picking alive on ⊕ and ☰, drops it on a real order', () => {
    expect(keepsArmed('pick', 'pick')).toBe(true);
    expect(keepsArmed('pick', 'more')).toBe(true);
    expect(keepsArmed('pick', 'move')).toBe(false);
    expect(keepsArmed('pick', 'attack')).toBe(false);
  });

  it('drops every state under a foreign command', () => {
    for (const state of STATES) expect(keepsArmed(state, 'stop')).toBe(false);
  });

  // Правило 4: кнопка без команды гасит всё.
  it('drops every state when the button carries no command', () => {
    for (const state of STATES) expect(keepsArmed(state, undefined)).toBe(false);
    for (const state of STATES) expect(keepsArmed(state, '')).toBe(false);
  });

  // Ни одна команда не держит ДВА состояния разом — иначе одно пережило бы приказ другого.
  it('never keeps two states armed at once', () => {
    const all = new Set(STATES.flatMap((s) => KEEPS_ARMED[s]));
    for (const cmd of all) {
      const held = STATES.filter((s) => keepsArmed(s, cmd));
      expect(held).toHaveLength(1);
    }
  });
});

describe('disarms', () => {
  it('is the exact negation of keepsArmed', () => {
    for (const state of STATES)
      for (const cmd of ['merge', 'attack', 'tok', 'stop', 'more', undefined])
        expect(disarms(state, cmd)).toBe(!keepsArmed(state, cmd));
  });
});

describe('ALWAYS_DISARMED', () => {
  // Правило 5: у этих прицелов своей команды нет вовсе — они не в таблице.
  it('names the aims that no row command can keep', () => {
    expect([...ALWAYS_DISARMED]).toEqual(['heroAim', 'heroSpawnAim', 'squadronStrikeAim']);
    for (const name of ALWAYS_DISARMED) expect(STATES).not.toContain(name as unknown as ArmedState);
  });
});

describe('the table itself', () => {
  // Правило 6: `chainMode` в таблицу не входит — полоска цепочки заменяет ряд целиком.
  it('covers the seven row states and not the chain mode', () => {
    expect(STATES.sort()).toEqual(
      ['assault', 'barrage', 'cast', 'firemode', 'merge', 'pick', 'troops'].sort(),
    );
    expect(STATES).not.toContain('chain' as ArmedState);
  });

  it('lists every state under its own name first', () => {
    expect(KEEPS_ARMED.merge[0]).toBe('merge');
    expect(KEEPS_ARMED.firemode[0]).toBe('firemode');
    expect(KEEPS_ARMED.troops[0]).toBe('troops');
  });
});
