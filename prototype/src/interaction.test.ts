import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DISARMED_BY,
  FLAGS,
  type Flag,
  type Reason,
  disarmedBy,
  forgetsSelection,
} from '../../decisions/armDisarm';
import * as I from './interaction';
import type { MobileOrderDraft } from './mobileOrders';

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

describe('interaction — владелец выбора (REFM-208)', () => {
  const mine = (id: string): boolean => id.startsWith('my');
  const DRAFT: MobileOrderDraft = {
    order: 'move',
    fleetIds: ['my1'],
    target: { kind: 'planet', id: 'w1' },
  };
  const selection = () => ({
    fleet: I.selFleet,
    planet: I.selPlanet,
    group: [...I.selFleets],
    inspect: I.inspectFleet,
    draft: I.mobileDraft,
    choices: [...I.mobileChoices],
  });
  const NOTHING = {
    fleet: null,
    planet: null,
    group: [],
    inspect: null,
    draft: null,
    choices: [],
  };

  it('starts empty', () => {
    expect(selection()).toEqual(NOTHING);
  });

  it('picks only own fleets: one is a single, several a group, a lone foreign one is inspected', () => {
    I.pickFleets(['my1'], mine);
    expect(selection()).toEqual({ ...NOTHING, fleet: 'my1', group: ['my1'] });
    I.pickFleets(['my1', 'my2', 'foe'], mine);
    expect(selection()).toEqual({ ...NOTHING, group: ['my1', 'my2'] });
    I.pickFleets(['foe'], mine);
    expect(selection()).toEqual({ ...NOTHING, inspect: 'foe' });
  });

  it('a fleet selection drops the world, the staged phone target and the chooser', () => {
    I.pickWorld('w1');
    I.stageDraft(DRAFT);
    I.offerChoices([{ kind: 'planet', id: 'w1' }]);
    I.pickFleets(['my1'], mine);
    expect(selection()).toEqual({ ...NOTHING, fleet: 'my1', group: ['my1'] });
  });

  it('a world selection drops the fleets and keeps the aims', () => {
    I.pickFleets(['my1', 'my2'], mine);
    armSample('aiming');
    I.pickWorld('w1');
    expect(selection()).toEqual({ ...NOTHING, planet: 'w1' });
    expect(I.aiming).toBe(true);
  });

  it('deselecting the fleets keeps the group picking: «Clear» on the group card, an empty box', () => {
    armSample('pickMode');
    I.pickFleets(['my1', 'my2'], mine);
    I.deselectFleets();
    expect(selection()).toEqual(NOTHING);
    expect(I.pickMode).toBe(true);
  });

  // `selectionPrune.ts`, правила 1–3: одиночные ссылки держатся, пока флот есть; группа —
  // пока флот жив и свой.
  it('after a world change drops what points at a vanished fleet, and the captured from the group', () => {
    I.pickFleets(['my1', 'my2', 'my3'], mine);
    armSample('splitState');
    armSample('troopsPlan');
    I.pruneSelection({ my2: { owner: 'p1' }, my3: { owner: 'p2' } }, 'p1');
    expect([...I.selFleets]).toEqual(['my2']);
    expect(I.splitState).toBeNull(); // SAMPLE держит флот f1, его больше нет
    expect(I.troopsPlan).toBeNull();
  });

  it('keeps the split dialog and the troops menu of a living fleet', () => {
    armSample('splitState');
    armSample('troopsPlan');
    I.pruneSelection({ f1: { owner: 'p1' } }, 'p1');
    expect(I.splitState).toEqual(SAMPLE.splitState);
    expect(I.troopsPlan).toEqual(SAMPLE.troopsPlan);
  });

  it('a single reference does not ask the owner: the panel shows who owns the fleet now', () => {
    I.pickFleets(['my1'], mine);
    I.pruneSelection({ my1: { owner: 'p2' } }, 'p1');
    expect(selection()).toEqual({ ...NOTHING, fleet: 'my1' });
    I.pickFleets(['foe'], mine);
    I.pruneSelection({ foe: { owner: 'p2' } }, 'p1');
    expect(I.inspectFleet).toBe('foe');
    I.pruneSelection({}, 'p1');
    expect(I.inspectFleet).toBeNull();
  });

  // Развилка (FORT-6.1) — тоже выбор: без неё в списке лист с кнопкой крепости не открывался.
  it('any pick holds the sheet open, the fork included; nothing picked holds nothing', () => {
    expect(I.hasSelection()).toBe(false);
    I.pickFork({ province: 'w1', trail: 0 });
    expect(I.hasSelection()).toBe(true);
    I.pickWorld('w1');
    expect(I.hasSelection()).toBe(true);
    I.pickFleets(['foe'], mine);
    expect(I.hasSelection()).toBe(true);
    I.pickFleets(['my1', 'my2'], mine);
    expect(I.hasSelection()).toBe(true);
    I.disarm('match', false);
    expect(I.hasSelection()).toBe(false);
  });

  // Правило 16: выбор забывают смена матча, пустое выделение и ✕, остальные поводы его держат.
  it('a reason forgets the whole selection exactly when the table says so', () => {
    for (const reason of Object.keys(DISARMED_BY) as Reason[])
      for (const phone of [false, true]) {
        I.pickFleets(['my1'], mine);
        I.stageDraft(DRAFT);
        I.offerChoices([{ kind: 'fleet', id: 'my1' }]);
        const before = selection();
        I.disarm(reason, phone);
        expect({ reason, phone, after: selection() }).toEqual({
          reason,
          phone,
          after: forgetsSelection(reason) ? NOTHING : before,
        });
      }
  });
});

describe('проводка в main.ts (REFM-207, REFM-208)', () => {
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

  // Лист и его Escape спрашивают «выбрано ли что-то» у владельца, а не своей копией списка:
  // в копиях не было развилки, и её карточка не открывалась.
  it('the sheet and its Escape layer ask the owner whether anything is picked', () => {
    expect(count('hasSelection: hasSelection(),')).toBe(1);
    expect(count("{ id: 'side', isOpen: hasSelection,")).toBe(1);
    expect(main).not.toMatch(/selPlanet !== null \|\| selFleets\.size > 0/);
  });

  // Ход локального мира и снимок сервера чистят выбор одним вызовом: у снимка была своя
  // копия правил, и она не закрывала окно деления и ⇅-меню погибшего флота.
  it('the local world and the server snapshot prune the selection with one call', () => {
    expect(count('pruneSelection(s.fleets, ME);')).toBe(2);
    expect(main).not.toMatch(/\b(keepFocus|keepGroup|refSurvives|pruneGroup)\(/);
  });
});
