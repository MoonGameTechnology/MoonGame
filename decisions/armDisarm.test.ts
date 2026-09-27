import { describe, expect, it } from 'vitest';
import {
  AIMS,
  ALWAYS_DISARMED,
  DISARMED_BY,
  DROPS_MOVE,
  FLAGS,
  KEEPS_ARMED,
  POPOVERS,
  type ArmedState,
  type Flag,
  type Reason,
  armDisarms,
  commandDisarms,
  disarmedBy,
  disarms,
  keepsArmed,
} from './armDisarm';

const STATES = Object.keys(KEEPS_ARMED) as ArmedState[];

describe('keepsArmed', () => {
  // Правило 1: своя команда держит состояние взведённым.
  it('keeps every state armed under its own command', () => {
    for (const state of STATES)
      for (const cmd of KEEPS_ARMED[state]) expect(keepsArmed(state, cmd)).toBe(true);
  });

  // Правило 2: подкоманды поповера — свои, иначе меню закрывалось бы от своей же кнопки.
  it('keeps a popover alive while the player works inside it', () => {
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
    expect([...ALWAYS_DISARMED]).toEqual([
      'heroAim',
      'heroSpawnAim',
      'strikeAim',
      'retreatAim',
      'allyAim',
      'squadMerge',
    ]);
    for (const name of ALWAYS_DISARMED) expect(STATES).not.toContain(name as unknown as ArmedState);
  });
});

describe('the table itself', () => {
  // Правило 6: `chainMode` в таблицу не входит — полоска цепочки заменяет ряд целиком.
  it('covers the row states and not the chain mode', () => {
    expect(STATES.sort()).toEqual(
      ['assault', 'cast', 'engage', 'merge', 'pick', 'retreat', 'troops'].sort(),
    );
    expect(STATES).not.toContain('chain' as ArmedState);
    expect(FLAGS).not.toContain('chainMode' as Flag);
  });

  it('lists every state under its own name first', () => {
    expect(KEEPS_ARMED.merge[0]).toBe('merge');
    expect(KEEPS_ARMED.troops[0]).toBe('troops');
    // Окошко порога отхода закрывает выбор ступени — это уже приказ (2026-09-23).
    expect(keepsArmed('retreat', 'retrset')).toBe(false);
  });

  it('splits every flag into exactly one kind: aim or popover', () => {
    expect(new Set(FLAGS).size).toBe(FLAGS.length);
    expect(FLAGS).toHaveLength(16);
    for (const flag of FLAGS) expect(AIMS.includes(flag)).toBe(!POPOVERS.includes(flag));
  });
});

/**
 * Каждый повод × каждый флаг, на обеих платформах. `x` — гаснет везде, `P` — только на
 * телефоне, `.` — не гаснет. Сетка повторяет таблицу намеренно: правка строки в
 * `DISARMED_BY` обязана пройти и здесь, а разница видна глазами целиком.
 */
const GRID = `
              match back-aim back-popover deselect dismiss mobile-cancel bar-hidden
aiming          x      x          .           x        x          x           x
assaultAim      x      x          .           x        x          x           x
engageAim       x      x          .           x        x          x           x
merging         x      x          .           x        x          x           x
pickMode        x      x          .           x        x          x           .
retreatAim      x      x          .           .        .          .           .
heroAim         x      x          .           .        .          .           .
heroSpawnAim    x      x          .           .        .          .           .
strikeAim       x      x          .           .        .          .           .
allyAim         x      x          .           .        .          .           .
squadMerge      x      x          .           x        x          .           .
cmdMore         x      .          P           P        x          .           .
castMenu        x      .          x           x        x          .           x
retreatMenu     x      .          x           x        x          .           x
troopsPlan      x      .          x           x        x          .           x
splitState      x      .          .           x        x          .           .
`;

function parseGrid(): { reasons: Reason[]; rows: Map<Flag, string[]> } {
  const [head, ...lines] = GRID.trim().split('\n');
  const reasons = head!.trim().split(/\s+/) as Reason[];
  const rows = new Map<Flag, string[]>();
  for (const line of lines) {
    const [flag, ...cells] = line.trim().split(/\s+/);
    rows.set(flag as Flag, cells);
  }
  return { reasons, rows };
}

describe('disarmedBy — каждый повод × каждый флаг', () => {
  const { reasons, rows } = parseGrid();

  it('the grid covers every reason and every flag', () => {
    expect([...reasons].sort()).toEqual(Object.keys(DISARMED_BY).sort());
    expect([...rows.keys()]).toEqual([...FLAGS]);
  });

  for (const [i, reason] of reasons.entries())
    for (const phone of [false, true])
      it(`${reason} на ${phone ? 'телефоне' : 'ПК'}`, () => {
        const got = disarmedBy(reason, phone);
        for (const flag of FLAGS) {
          const cell = rows.get(flag)![i];
          const expected = cell === 'x' || (cell === 'P' && phone);
          expect({ flag, dropped: got.includes(flag) }).toEqual({ flag, dropped: expected });
        }
      });

  it('never names a flag twice', () => {
    for (const reason of reasons)
      for (const phone of [false, true]) {
        const got = disarmedBy(reason, phone);
        expect(new Set(got).size).toBe(got.length);
      }
  });
});

describe('поводы — правила 8–14 словами', () => {
  const both = (reason: Reason): Flag[][] => [disarmedBy(reason, false), disarmedBy(reason, true)];
  const WINDOW_AIMS: Flag[] = ['retreatAim', 'heroAim', 'heroSpawnAim', 'strikeAim', 'allyAim'];

  // Правило 8: прицел и меню старого матча указывают на то, чего в новом нет.
  it('a new match drops everything on both platforms', () => {
    for (const got of both('match')) expect([...got].sort()).toEqual([...FLAGS].sort());
  });

  // Правило 9: Back снимает любой прицел, а поповеры — своей ступенью выше.
  it('Back drops every aim at the aim step and only popovers at the popover step', () => {
    for (const got of both('back-aim')) expect([...got].sort()).toEqual([...AIMS].sort());
    for (const got of both('back-popover'))
      for (const flag of got) expect(POPOVERS).toContain(flag);
  });

  // Правило 10: прицелы из окон взводятся без выделения и им не отменяются.
  it('an empty selection keeps the aims armed from windows', () => {
    for (const got of both('deselect'))
      for (const flag of WINDOW_AIMS) expect(got).not.toContain(flag);
  });

  // Правило 11: ✕ закрывает окно целиком — это пустое выделение и ☰.
  it('✕ is an empty selection plus ☰', () => {
    for (const phone of [false, true])
      expect([...disarmedBy('dismiss', phone)].sort()).toEqual(
        [...new Set([...disarmedBy('deselect', phone), 'cmdMore'])].sort(),
      );
  });

  // Правило 12: отмена мобильного приказа — только то, что ждёт подтверждения в полоске.
  it('a mobile cancel drops a subset of what an empty selection drops', () => {
    const deselect = disarmedBy('deselect', true);
    for (const flag of disarmedBy('mobile-cancel', true)) expect(deselect).toContain(flag);
  });

  // Правило 13: спрятанный ряд — то, что живёт В РЯДУ; окно деления и прицелы из окон нет.
  it('a hidden bar keeps the split dialog and the aims armed from windows', () => {
    for (const got of both('bar-hidden')) {
      expect(got).not.toContain('splitState');
      for (const flag of WINDOW_AIMS) expect(got).not.toContain(flag);
    }
  });

  // Правило 14: телефон отличается от ПК только ☰ — там он поповер.
  it('the phone differs from the PC only by ☰', () => {
    for (const reason of Object.keys(DISARMED_BY) as Reason[]) {
      const extra = disarmedBy(reason, true).filter((f) => !disarmedBy(reason, false).includes(f));
      for (const flag of extra) expect(flag).toBe('cmdMore');
    }
  });

  it('every flag has a way out besides a new match', () => {
    const exits = new Set(
      (Object.keys(DISARMED_BY) as Reason[])
        .filter((r) => r !== 'match')
        .flatMap((r) => disarmedBy(r, true)),
    );
    for (const flag of FLAGS) expect(exits).toContain(flag);
  });
});

describe('armDisarms', () => {
  // Правило 15: два прицела сразу — тап сработает не тем, чем игрок целился последним.
  it('arming an aim drops every other aim and nothing else', () => {
    for (const aim of AIMS)
      expect([...armDisarms(aim)].sort()).toEqual(AIMS.filter((f) => f !== aim).sort());
  });

  it('opening a popover drops nothing: a menu is not an intent for the map', () => {
    for (const popover of POPOVERS) expect(armDisarms(popover)).toEqual([]);
  });
});

describe('commandDisarms', () => {
  const ROW_COMMANDS = [
    'move',
    'engage',
    'merge',
    'attack',
    'stop',
    'split',
    'troops',
    'tstep',
    'tmax',
    'tok',
    'target',
    'more',
    'cast',
    'castdo',
    'boost',
    'qauto',
    'qretr',
    'retrset',
    'pick',
    'rocket-mine',
  ];

  // Правило 5: прицел из окна своей кнопки в ряду не имеет — гаснет от любой.
  it('every button drops the aims armed from windows', () => {
    for (const cmd of [...ROW_COMMANDS, undefined])
      for (const phone of [false, true])
        for (const aim of ALWAYS_DISARMED) expect(commandDisarms(cmd, phone)).toContain(aim);
  });

  it('keeps a state armed under its own command, as the REFM-195 table says', () => {
    expect(commandDisarms('merge', false)).not.toContain('merging');
    expect(commandDisarms('castdo', false)).not.toContain('castMenu');
    expect(commandDisarms('tok', false)).not.toContain('troopsPlan');
    expect(commandDisarms('qretr', false)).not.toContain('retreatMenu');
    expect(commandDisarms('more', true)).not.toContain('pickMode');
    expect(commandDisarms('stop', false)).toContain('pickMode');
  });

  // Правило 7: «Курс» гасят новое намерение и поповер ряда, но не прямой приказ и не ☰.
  it('drops Move only on a command that arms another intent or opens a row popover', () => {
    for (const cmd of DROPS_MOVE) expect(commandDisarms(cmd, false)).toContain('aiming');
    for (const cmd of ['move', 'stop', 'boost', 'qauto', 'retrset', 'more', undefined])
      expect(commandDisarms(cmd, false)).not.toContain('aiming');
    expect(commandDisarms('qretr', false)).toContain('aiming');
  });

  // Правило 14: выбор приказа на телефоне сворачивает ☰; на ПК ☰ — вид ряда и остаётся.
  it('folds ☰ on the phone when an order is picked from it, never on the PC', () => {
    for (const cmd of ['move', 'engage', 'merge', 'attack', 'pick', 'target']) {
      expect(commandDisarms(cmd, true)).toContain('cmdMore');
      expect(commandDisarms(cmd, false)).not.toContain('cmdMore');
    }
    expect(commandDisarms('more', true)).not.toContain('cmdMore');
    expect(commandDisarms('boost', true)).not.toContain('cmdMore');
  });

  it('never touches the split dialog: it has its own backdrop and Back step', () => {
    for (const cmd of [...ROW_COMMANDS, undefined])
      for (const phone of [false, true])
        expect(commandDisarms(cmd, phone)).not.toContain('splitState');
  });

  it('never names a flag twice', () => {
    for (const cmd of [...ROW_COMMANDS, undefined])
      for (const phone of [false, true]) {
        const got = commandDisarms(cmd, phone);
        expect(new Set(got).size).toBe(got.length);
      }
  });
});
