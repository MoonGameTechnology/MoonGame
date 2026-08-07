import { describe, it, expect } from 'vitest';
import { assaultOrderState, dropsOrder, type QueuedFleet } from './assaultQueue';

const flying = (destination: string | null, to?: string | null): QueuedFleet => ({
  movement: { destination, to },
});

describe('очередь штурма — флот в пути', () => {
  it('летит к цели — приказ ждёт', () => {
    expect(assaultOrderState(flying('A'), 'A')).toBe('in-transit');
  });

  it('ПЕРЕНАПРАВЛЕН ВРУЧНУЮ — ПРИКАЗ СНИМАЕТСЯ: игрок передумал, бить не туда нельзя', () => {
    expect(assaultOrderState(flying('B'), 'A')).toBe('redirected');
  });

  it('ТРАНЗИТНЫЙ УЗЕЛ — НЕ ОТМЕНА: смотрят на конечную цель маршрута, а не на ближайший', () => {
    // летит в A через промежуточный узел M
    expect(assaultOrderState(flying('A', 'M'), 'A')).toBe('in-transit');
  });

  it('без конечной цели годится ближайший узел — старый маршрут не роняет очередь', () => {
    expect(assaultOrderState(flying(null, 'A'), 'A')).toBe('in-transit');
    expect(assaultOrderState(flying(null, 'B'), 'A')).toBe('redirected');
  });
});

describe('очередь штурма — флот не в пути', () => {
  it('БОЙ ПО ПРИЛЁТЕ — ЭТО И ЕСТЬ ПУТЬ К ШТУРМУ, приказ ждёт', () => {
    expect(assaultOrderState({ location: 'A', battleId: 'b1' }, 'A')).toBe('in-battle');
  });

  it('бой ждут, даже если флот оказался не в цели — исход боя решит, где он', () => {
    expect(assaultOrderState({ location: 'B', battleId: 'b1' }, 'A')).toBe('in-battle');
  });

  it('ВСТАЛ НЕ В ЦЕЛИ — ПРИКАЗ ПРОТУХ: штурмовать нечего', () => {
    expect(assaultOrderState({ location: 'B' }, 'A')).toBe('lapsed');
    expect(assaultOrderState({ location: null }, 'A')).toBe('lapsed');
  });

  it('на месте и цел — пора спрашивать ядро', () => {
    expect(assaultOrderState({ location: 'A' }, 'A')).toBe('ready');
    expect(assaultOrderState({ location: 'A', battleId: null }, 'A')).toBe('ready');
  });

  it('ИСЧЕЗ ФЛОТ — ИСЧЕЗ ПРИКАЗ: иначе очередь копит мусор на весь матч', () => {
    expect(assaultOrderState(null, 'A')).toBe('gone');
    expect(assaultOrderState(undefined, 'A')).toBe('gone');
  });
});

describe('очередь штурма — что снимает приказ', () => {
  it('снимают: пропавший флот, перенаправленный и вставший не там', () => {
    expect(dropsOrder('gone')).toBe(true);
    expect(dropsOrder('redirected')).toBe(true);
    expect(dropsOrder('lapsed')).toBe(true);
  });

  it('ЖДУТ, А НЕ СНИМАЮТ: полёт и бой — это ещё не провал приказа', () => {
    expect(dropsOrder('in-transit')).toBe(false);
    expect(dropsOrder('in-battle')).toBe(false);
  });

  it('готовность приказ не снимает — его как раз пора издавать', () => {
    expect(dropsOrder('ready')).toBe(false);
  });
});
