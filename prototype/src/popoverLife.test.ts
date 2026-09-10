import { describe, it, expect } from 'vitest';
import { barStays, popoverLife, type OpenPopovers, type PopoverBases } from './popoverLife';

const БАЗА: PopoverBases = {
  selected: 1,
  picking: false,
  castHero: true,
  troopsInput: true,
  loneId: 'f1',
};
const ОТКРЫТО: OpenPopovers = { cast: true, troopsFleetId: 'f1' };
const жизнь = (b: Partial<PopoverBases> = {}, o: Partial<OpenPopovers> = {}) =>
  popoverLife({ ...БАЗА, ...b }, { ...ОТКРЫТО, ...o });

describe('поповеры — основание живо', () => {
  it('всё на месте — всё и остаётся', () => {
    expect(жизнь()).toEqual({ bar: true, cast: true, troops: true });
  });

  it('не стало флагмана — гаснет ✨', () => {
    expect(жизнь({ castHero: false }).cast).toBe(false);
  });

  it('нечего показать — гаснет ⇅', () => {
    expect(жизнь({ troopsInput: false }).troops).toBe(false);
  });

  it('гаснет только своё: пропажа героя ⇅ не трогает', () => {
    expect(жизнь({ castHero: false }).troops).toBe(true);
  });
});

describe('поповеры — ⇅ привязан к своему флоту', () => {
  it('ВЫБРАЛИ ДРУГОЙ ФЛОТ — ПЛАН ДЕСАНТА ГАСНЕТ: иначе он отправит чужой гарнизон', () => {
    expect(жизнь({ loneId: 'f2' }).troops).toBe(false);
  });

  it('выделили группу — одиночного флота нет, план гаснет', () => {
    expect(жизнь({ selected: 3, loneId: null }).troops).toBe(false);
  });

  it('закрытое меню не открывается само', () => {
    expect(жизнь({}, { troopsFleetId: null }).troops).toBe(false);
  });
});

describe('поповеры — пустое выделение', () => {
  it('ПУСТОЕ ВЫДЕЛЕНИЕ ГАСИТ ВСЁ РАЗОМ: иначе меню всплывёт над следующим флотом', () => {
    expect(жизнь({ selected: 0, loneId: null })).toEqual({
      bar: false,
      cast: false,
      troops: false,
    });
  });

  it('НАБОР ГРУППЫ ДЕРЖИТ РЯД ЖИВЫМ НА НУЛЕ: без ⊕ из режима не выйти', () => {
    const st = жизнь({ selected: 0, picking: true, loneId: null });
    expect(st.bar).toBe(true);
    expect(st.troops).toBe(false); // но привязанный план всё равно не выживает
  });

  it('ряд команд спрашивается и до подсчёта оснований — тем же правилом', () => {
    expect(barStays(0, false)).toBe(false);
    expect(barStays(0, true)).toBe(true);
    expect(barStays(2, false)).toBe(true);
  });

  it('закрытые поповеры при живом выделении так и остаются закрытыми', () => {
    expect(жизнь({}, { cast: false })).toEqual({
      bar: true,
      cast: false,
      troops: true,
    });
  });
});
