import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { DISARMED_BY, FLAGS, type Flag, type Reason, disarmedBy } from '../../decisions/armDisarm';
import * as I from './interaction';

/** Живое значение флага по имени: модуль отдаёт их как `export let`. */
const value = (flag: Flag): unknown => (I as unknown as Record<Flag, unknown>)[flag];
const armed = (flag: Flag): boolean => value(flag) !== false && value(flag) !== null;

const SAMPLE: { [F in Flag]: I.Armed[F] } = {
  aiming: true,
  assaultAim: true,
  engageAim: true,
  merging: true,
  pickMode: true,
  retreatAim: 'f1',
  heroAim: { heroId: 'h1', abilityId: 'a1' },
  heroSpawnAim: 'h1',
  strikeAim: { from: { planetId: 'w1' }, squadronId: 's1' },
  allyAim: 'guard',
  squadMerge: { from: 's1' },
  cmdMore: true,
  castMenu: true,
  retreatMenu: true,
  troopsPlan: { fleetId: 'f1', plan: {} },
  splitState: { fleetId: 'f1', take: {} },
};

const armSample = <F extends Flag>(flag: F): void => I.arm(flag, SAMPLE[flag]);

beforeEach(() => I.disarm('match', false));

describe('interaction — владелец флагов', () => {
  it('starts with nothing armed, and a new match leaves nothing armed', () => {
    for (const flag of FLAGS) expect(armed(flag)).toBe(false);
    for (const flag of FLAGS) armSample(flag);
    I.disarm('match', false);
    for (const flag of FLAGS) expect(armed(flag)).toBe(false);
  });

  it('arm stores the value, drop puts the flag back to off', () => {
    for (const flag of FLAGS) {
      armSample(flag);
      expect(value(flag)).toEqual(SAMPLE[flag]);
      I.drop(flag);
      expect(armed(flag)).toBe(false);
    }
  });

  // Правило 15: два прицела сразу — тап сработает не тем.
  it('arming an aim drops the aim armed before it', () => {
    armSample('aiming');
    armSample('heroAim');
    expect(armed('aiming')).toBe(false);
    expect(armed('heroAim')).toBe(true);
  });

  it('opening a popover keeps the armed aim', () => {
    armSample('aiming');
    armSample('troopsPlan');
    armSample('cmdMore');
    expect(armed('aiming')).toBe(true);
  });

  it('toggle arms an off flag and drops an armed one', () => {
    I.toggle('engageAim');
    expect(I.engageAim).toBe(true);
    I.toggle('engageAim');
    expect(I.engageAim).toBe(false);
  });

  // Сама `disarm` не решает ничего: она исполняет строку таблицы. Проверяем по одному
  // взведённому флагу — все прицелы разом правило 15 взвести не даст.
  it('disarm drops exactly what the table names, for every reason × flag', () => {
    for (const reason of Object.keys(DISARMED_BY) as Reason[])
      for (const phone of [false, true])
        for (const flag of FLAGS) {
          I.disarm('match', phone);
          armSample(flag);
          I.disarm(reason, phone);
          expect({ reason, phone, flag, off: !armed(flag) }).toEqual({
            reason,
            phone,
            flag,
            off: disarmedBy(reason, phone).includes(flag),
          });
        }
  });

  it('anyArmed opens a Back step only while something of the reason is armed', () => {
    expect(I.anyArmed('back-aim', false)).toBe(false);
    armSample('allyAim'); // прицел из окна — Back снимает и его (правило 9)
    expect(I.anyArmed('back-aim', false)).toBe(true);
    expect(I.anyArmed('back-popover', false)).toBe(false);
    armSample('cmdMore');
    expect(I.anyArmed('back-popover', false)).toBe(false); // ☰ на ПК — вид ряда
    expect(I.anyArmed('back-popover', true)).toBe(true); // на телефоне — поповер
  });

  it('a row button drops what the table says before its own action', () => {
    armSample('engageAim');
    I.disarmForCommand('move', false);
    expect(armed('engageAim')).toBe(false);
    armSample('aiming');
    I.disarmForCommand('boost', false); // прямой приказ «Курс» не трогает
    expect(armed('aiming')).toBe(true);
    armSample('strikeAim');
    I.disarmForCommand('more', false); // прицел из окна гаснет от любой кнопки
    expect(armed('strikeAim')).toBe(false);
  });
});

describe('проводка в main.ts (REFM-207)', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const count = (needle: string): number => main.split(needle).length - 1;

  it('every row of the table has a caller: a dead row would be a lie', () => {
    for (const reason of Object.keys(DISARMED_BY) as Reason[]) {
      const used = count(`disarm('${reason}', MOBILE)`) + count(`anyArmed('${reason}', MOBILE)`);
      expect({ reason, used: used > 0 }).toEqual({ reason, used: true });
    }
  });

  // Правило 8: соло и сеть меняют матч одной строкой — раньше это были два разных списка.
  it('a new match goes through the table in solo and in the network', () => {
    expect(count("disarm('match', MOBILE)")).toBe(2);
  });

  it('the row buttons go through the table, not a hand-written preamble', () => {
    expect(count('disarmForCommand(cmd, MOBILE);')).toBe(1);
    expect(main).not.toMatch(/\bdisarms\(/);
  });
});
