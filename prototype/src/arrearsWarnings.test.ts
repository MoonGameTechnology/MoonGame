import { describe, it, expect } from 'vitest';
import { owes, showsBlackout, showsStarving } from './arrearsWarnings';

describe('долги — есть ли вообще', () => {
  it('ресурс в списке — долг есть', () => {
    expect(owes(['food'], 'food')).toBe(true);
  });

  it('ПУСТОЙ И ОТСУТСТВУЮЩИЙ СПИСОК — ДОЛГОВ НЕТ, а не «неизвестно»', () => {
    expect(owes([], 'food')).toBe(false);
    expect(owes(undefined, 'food')).toBe(false);
    expect(owes(null, 'food')).toBe(false);
  });

  it('ДОЛГИ НЕЗАВИСИМЫ: еда ничего не говорит про энергию', () => {
    expect(owes(['food'], 'energy')).toBe(false);
    expect(owes(['energy'], 'food')).toBe(false);
    expect(owes(['food', 'energy'], 'energy')).toBe(true);
  });
});

describe('долги — метка голода', () => {
  it('свой, с наземными, при долге по еде — показываем', () => {
    expect(showsStarving(true, 3, ['food'])).toBe(true);
  });

  it('ЧУЖОЙ ДОЛГ НЕ НАША ИНФОРМАЦИЯ: панель врага экономику не раскрывает', () => {
    expect(showsStarving(false, 3, ['food'])).toBe(false);
  });

  it('НЕКОМУ ГОЛОДАТЬ — НЕТ И МЕТКИ: штраф бьёт по наземным, а их нет', () => {
    expect(showsStarving(true, 0, ['food'])).toBe(false);
  });

  it('без долга по еде метки нет, даже если есть другой долг', () => {
    expect(showsStarving(true, 3, [])).toBe(false);
    expect(showsStarving(true, 3, ['energy'])).toBe(false);
  });
});

describe('долги — блэкаут', () => {
  it('свой мир и долг по энергии — показываем', () => {
    expect(showsBlackout(true, ['energy'])).toBe(true);
  });

  it('БЛЭКАУТ — СВОЙСТВО ВЛАДЕЛЬЦА: метка не зависит от построек этого мира', () => {
    // на входе только «свой» и список долгов — про электростанцию правило не спрашивает
    expect(showsBlackout(true, ['energy'])).toBe(true);
    expect(showsBlackout(true, ['food', 'energy'])).toBe(true);
  });

  it('чужой мир метку не получает', () => {
    expect(showsBlackout(false, ['energy'])).toBe(false);
  });

  it('без долга по энергии метки нет', () => {
    expect(showsBlackout(true, ['food'])).toBe(false);
    expect(showsBlackout(true, [])).toBe(false);
  });
});
