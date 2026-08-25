import { describe, expect, it } from 'vitest';
import { isWing, wingCanAct, wingCanReturn, type WingFleet } from './wingOrders';

const wing = (over: Partial<WingFleet> = {}): WingFleet => ({
  owner: 'p1',
  homeBase: 'carrier',
  battleId: null,
  ...over,
});

describe('isWing — правила 1–2', () => {
  it('флот с базой и с эскадрильями — крыло', () => {
    expect(isWing(wing(), 'p1', true)).toBe(true);
  });

  it('без эскадрилий на борту — не крыло, даже если база осталась', () => {
    // Ровно случай, ради которого правило 1 и написано: крыло потеряло эскадрильи в
    // бою, база при нём. Ядро отклонит приказ E_NO_SHIPS — кнопка обязана погаснуть
    // раньше, чем игрок её нажмёт.
    expect(isWing(wing(), 'p1', false)).toBe(false);
  });

  it('без базы — не крыло', () => {
    expect(isWing(wing({ homeBase: undefined }), 'p1', true)).toBe(false);
  });

  it('чужим крылом не командуют', () => {
    expect(isWing(wing({ owner: 'p2' }), 'p1', true)).toBe(false);
  });

  it('нет флота — нет крыла', () => {
    expect(isWing(undefined, 'p1', true)).toBe(false);
  });
});

describe('wingCanAct — правило 3', () => {
  it('свободное крыло действует', () => {
    expect(wingCanAct(wing())).toBe(true);
  });

  it('в бою — занято', () => {
    expect(wingCanAct(wing({ battleId: 'b1' }))).toBe(false);
  });

  it('в перелёте — приказ уже есть', () => {
    expect(wingCanAct(wing({ freeMovement: { targetX: 1, targetY: 2 } }))).toBe(false);
  });

  it('нет флота — нечему действовать', () => {
    expect(wingCanAct(undefined)).toBe(false);
  });
});

describe('wingCanReturn — правило 4', () => {
  it('из свободного пространства вернуться можно', () => {
    expect(wingCanReturn(wing({ freePosition: { x: 10, y: 20 } }))).toBe(true);
  });

  it('уже у базы — возвращаться неоткуда', () => {
    expect(wingCanReturn(wing())).toBe(false);
  });

  it('занятость перевешивает: в бою не возвращаются даже из пространства', () => {
    expect(wingCanReturn(wing({ freePosition: { x: 1, y: 1 }, battleId: 'b1' }))).toBe(false);
  });
});
