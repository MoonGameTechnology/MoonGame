import { describe, it, expect } from 'vitest';
import {
  houseBonusKey,
  houseChoice,
  houseColor,
  houseName,
  houseRows,
  type MatchSeat,
} from './seatPicker';

const seat = (playerId: string, faction: string, taken = false): MatchSeat => ({
  playerId,
  faction,
  taken,
});

describe('выбор дома — сведение кресел в строки', () => {
  it('дома считают свои кресла', () => {
    const rows = houseRows([
      seat('p1', 'azure', true),
      seat('p5', 'azure'),
      seat('p2', 'crimson'),
    ]);
    expect(rows.map((r) => [r.faction, r.free, r.total])).toEqual([
      ['azure', 1, 2],
      ['crimson', 1, 1],
    ]);
  });

  it('ПОРЯДОК ДОМОВ — по первому появлению: окно не тасует их между открытиями', () => {
    const order = ['violet', 'amber', 'azure'];
    const rows = houseRows(order.map((f, i) => seat(`p${i}`, f)));
    expect(rows.map((r) => r.faction)).toEqual(order);
  });

  it('пустой список мест — пустой выбор, а не сбой', () => {
    expect(houseRows([])).toEqual([]);
  });
});

describe('выбор дома — какое кресло достанется', () => {
  it('КРЕСЛО БЕРЁТСЯ ПЕРВОЕ СВОБОДНОЕ, а не первое: seats[0] сплошь и рядом чужое', () => {
    const rows = houseRows([seat('p1', 'azure', true), seat('p5', 'azure'), seat('p9', 'azure')]);
    expect(rows[0]!.slot).toBe('p5');
  });

  it('у полного дома кресла нет', () => {
    const rows = houseRows([seat('p1', 'azure', true), seat('p5', 'azure', true)]);
    expect(rows[0]!.full).toBe(true);
    expect(rows[0]!.slot).toBeNull();
  });

  it('одно свободное кресло из одного — дом не полон', () => {
    const rows = houseRows([seat('p3', 'amber')]);
    expect(rows[0]!).toMatchObject({ free: 1, total: 1, full: false, slot: 'p3' });
  });
});

describe('выбор дома — что уходит в запрос', () => {
  it('ДОМ И КРЕСЛО ВМЕСТЕ (BF-30): играешь одним, начинаешь в другом месте', () => {
    const [row] = houseRows([seat('p1', 'crimson', true), seat('p6', 'crimson')]);
    expect(houseChoice(row!)).toEqual({ slot: 'p6', faction: 'crimson' });
  });

  it('ПОЛНЫЙ ДОМ ВЫБРАТЬ НЕЛЬЗЯ — иначе тык по серой строке уедет отказом с сервера', () => {
    const [row] = houseRows([seat('p1', 'azure', true)]);
    expect(houseChoice(row!)).toBeNull();
  });

  it('строка без кресла не выбирается, даже если её назвали свободной', () => {
    expect(houseChoice({ faction: 'azure', free: 1, total: 2, full: false, slot: null })).toBeNull();
  });
});

describe('выбор дома — подписи строки', () => {
  it('У КАЖДОГО ДОМА СВОЙ КЛЮЧ ПАССИВА — на экране должен быть текст, а не ключ', () => {
    for (const f of ['azure', 'crimson', 'amber', 'violet']) {
      expect(houseBonusKey(f), f).toBe(`seatpick.bonus.${f}`);
    }
  });

  it('незнакомый дом остаётся БЕЗ подписи, а не с ключом на экране', () => {
    expect(houseBonusKey('teal')).toBeNull();
  });

  it('цвет и имя незнакомого дома не роняют строку', () => {
    expect(houseColor('teal')).toBe('var(--cyan)');
    expect(houseName('teal')).toBe('teal');
  });

  it('знакомый дом называется своим именем и красится своим цветом', () => {
    expect(houseName('violet')).toBe('Violet Ascendancy');
    expect(houseColor('violet')).toBe('#b366ff');
  });
});
