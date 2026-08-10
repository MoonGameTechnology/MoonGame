import { describe, it, expect } from 'vitest';
import {
  carrierHolds,
  loadStep,
  makeLoads,
  queuedCargo,
  queuedFromWorld,
  queuedOf,
  type Carrier,
  type PendingLoad,
} from './loadQueue';

const ЧАС = 3_600_000;
const груз = (unit: string) => (unit === 'tank' ? 3 : 1);
const запись = (fleetId: string, unit: string, doneAt = ЧАС): PendingLoad => ({
  fleetId,
  unit,
  startAt: 0,
  doneAt,
});

describe('погрузка — постановка в очередь', () => {
  it('ПОШТУЧНО, А НЕ ПАРТИЕЙ: ядро грузит «всё или ничего»', () => {
    const из = makeLoads('f1', 'inf', 3, 1000, ЧАС);
    expect(из).toHaveLength(3);
    expect(из.every((p) => p.fleetId === 'f1' && p.unit === 'inf')).toBe(true);
  });

  it('ПОГРУЗКА ЗАНИМАЕТ ЧАС, а не мгновение', () => {
    const [p] = makeLoads('f1', 'inf', 1, 1000, ЧАС);
    expect(p?.startAt).toBe(1000);
    expect(p?.doneAt).toBe(1000 + ЧАС);
  });

  it('нулевой заказ очередь не трогает', () => {
    expect(makeLoads('f1', 'inf', 0, 0, ЧАС)).toEqual([]);
  });
});

describe('погрузка — резерв трюма', () => {
  it('МЕСТО ЗАНИМАЕТСЯ ЗАРАНЕЕ: иначе два заказа перегрузят трюм', () => {
    const очередь = [запись('f1', 'inf'), запись('f1', 'tank')];
    expect(queuedCargo(очередь, 'f1', груз)).toBe(4);
  });

  it('чужие погрузки трюм этого флота не занимают', () => {
    expect(queuedCargo([запись('f2', 'tank')], 'f1', груз)).toBe(0);
  });
});

describe('погрузка — резерв гарнизона', () => {
  const где = (id: string): string | null => (id === 'f1' || id === 'f2' ? 'C1' : 'C9');

  it('РЕЗЕРВ СЧИТАЕТСЯ ПО МИРУ: у флотов на одном приколе гарнизон общий', () => {
    const очередь = [запись('f1', 'inf'), запись('f2', 'inf')];
    expect(queuedFromWorld(очередь, 'C1', 'inf', где)).toBe(2);
  });

  it('погрузка из другого мира этот гарнизон не трогает', () => {
    expect(queuedFromWorld([запись('f9', 'inf')], 'C1', 'inf', где)).toBe(0);
  });

  it('другой тип части не считается', () => {
    expect(queuedFromWorld([запись('f1', 'tank')], 'C1', 'inf', где)).toBe(0);
  });

  it('счётчик по флоту и типу отдельный от мирового', () => {
    const очередь = [запись('f1', 'inf'), запись('f2', 'inf'), запись('f1', 'tank')];
    expect(queuedOf(очередь, 'f1', 'inf')).toBe(1);
  });
});

describe('погрузка — жив ли носитель', () => {
  it('стоящий у мира флот везёт', () => {
    expect(carrierHolds({ location: 'C1' })).toBe(true);
  });

  it('УШЁЛ В ПУТЬ — ЗАКАЗ ОТМЕНЯЕТСЯ: везти уже некому', () => {
    expect(carrierHolds({ location: 'C1', movement: { to: 'C2' } })).toBe(false);
  });

  it('вступил в бой — тоже отмена', () => {
    expect(carrierHolds({ location: 'C1', battleId: 'b1' })).toBe(false);
  });

  it('исчезнувший флот заказ не держит', () => {
    expect(carrierHolds(undefined)).toBe(false);
  });

  it('флот без места стоянки не грузится', () => {
    expect(carrierHolds({ location: null })).toBe(false);
  });
});

describe('погрузка — кадр очереди', () => {
  const жив = (): Carrier => ({ location: 'C1' });

  it('созревшая уходит приказом и покидает очередь', () => {
    const шаг = loadStep([запись('f1', 'inf', 500)], 500, жив);
    expect(шаг.fire).toHaveLength(1);
    expect(шаг.keep).toEqual([]);
  });

  it('незрелая остаётся ждать', () => {
    const шаг = loadStep([запись('f1', 'inf', 500)], 499, жив);
    expect(шаг.fire).toEqual([]);
    expect(шаг.keep).toHaveLength(1);
  });

  it('ОТМЕНЁННАЯ НЕ УХОДИТ И НЕ ЖДЁТ: её просто нет', () => {
    const шаг = loadStep([запись('f1', 'inf', 0)], 999, () => ({
      location: 'C1',
      movement: { to: 'C2' },
    }));
    expect(шаг.fire).toEqual([]);
    expect(шаг.keep).toEqual([]);
  });

  it('разные флоты в одном кадре разбираются независимо', () => {
    const очередь = [запись('f1', 'inf', 100), запись('f2', 'inf', 900)];
    const шаг = loadStep(очередь, 500, жив);
    expect(шаг.fire.map((p) => p.fleetId)).toEqual(['f1']);
    expect(шаг.keep.map((p) => p.fleetId)).toEqual(['f2']);
  });

  it('пустая очередь даёт пустой кадр', () => {
    expect(loadStep([], 0, жив)).toEqual({ fire: [], keep: [] });
  });
});
