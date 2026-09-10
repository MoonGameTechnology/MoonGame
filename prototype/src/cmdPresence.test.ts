import { describe, it, expect } from 'vitest';
import { cmdShown, type CmdSelection } from './cmdPresence';

const пусто: CmdSelection = {
  stoppable: false,
  castHero: false,
  more: false,
  picking: false,
};
const с = (p: Partial<CmdSelection>): CmdSelection => ({ ...пусто, ...p });

describe('cmdPresence — что показывается отсутствием (правило 2)', () => {
  it('остановка появляется только когда ядро согласно хоть на один флот', () => {
    expect(cmdShown(пусто).stop).toBe(false);
    expect(cmdShown(с({ stoppable: true })).stop).toBe(true);
  });

  it('способности — только при флагмане с кастуемым на борту', () => {
    expect(cmdShown(пусто).cast).toBe(false);
    expect(cmdShown(с({ castHero: true })).cast).toBe(true);
  });

});

describe('cmdPresence — набор группы (правило 4)', () => {
  it('видна под раскрытым ☰', () => {
    expect(cmdShown(с({ more: true })).pick).toBe(true);
  });

  it('видна и при СВЁРНУТОМ ☰, если набор уже включён — иначе из режима не выйти', () => {
    expect(cmdShown(с({ more: false, picking: true })).pick).toBe(true);
  });

  it('скрыта, только когда ☰ свёрнут И набор выключен', () => {
    expect(cmdShown(пусто).pick).toBe(false);
  });
});

describe('cmdPresence — редкие команды (правило 5)', () => {
  it('форсаж и стоячие приказы живут только под раскрытым ☰', () => {
    expect(cmdShown(пусто).extras).toBe(false);
    expect(cmdShown(с({ more: true })).extras).toBe(true);
  });

  it('включённый набор сам по себе ☰ не раскрывает', () => {
    expect(cmdShown(с({ picking: true })).extras).toBe(false);
  });
});
