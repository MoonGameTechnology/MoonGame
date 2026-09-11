import { describe, it, expect } from 'vitest';
import {
  canConfirm,
  canConfirmSplit,
  cargoSplit,
  clampTake,
  normalizeSlotTake,
  normalizeTake,
  shipCounts,
  shipTotals,
  splitSlots,
  splitTotals,
  stepTake,
} from './splitPlan';

describe('деление флота — состав', () => {
  it('стопки одного типа складываются', () => {
    expect(
      shipCounts([
        { unit: 'scout', count: 2 },
        { unit: 'scout', count: 3 },
      ]),
    ).toEqual({
      scout: 5,
    });
  });

  it('разные типы считаются отдельно', () => {
    expect(
      shipCounts([
        { unit: 'scout', count: 1 },
        { unit: 'cruiser', count: 2 },
      ]),
    ).toEqual({
      scout: 1,
      cruiser: 2,
    });
  });

  it('пустой флот — пустой состав', () => {
    expect(shipCounts([])).toEqual({});
  });
});

describe('деление флота — сколько уводим', () => {
  it('БОЛЬШЕ, ЧЕМ ЕСТЬ, УВЕСТИ НЕЛЬЗЯ', () => {
    expect(clampTake(99, 4)).toBe(4);
  });

  it('ОТРИЦАТЕЛЬНОГО ОТБОРА НЕ БЫВАЕТ: «−1» на нуле не уводит флот в минус', () => {
    expect(clampTake(-3, 4)).toBe(0);
    expect(stepTake(0, 4, 'dec', 1)).toBe(0);
  });

  it('«+10» У ОСТАТКА МЕНЬШЕ ДЕСЯТИ БЕРЁТ ОСТАТОК, а не ломается', () => {
    expect(stepTake(0, 4, 'inc', 10)).toBe(4);
    expect(stepTake(2, 4, 'inc', 10)).toBe(4);
  });

  it('«всё» берёт ровно наличное', () => {
    expect(stepTake(0, 7, 'all')).toBe(7);
    expect(stepTake(3, 7, 'all')).toBe(7);
  });

  it('обычный шаг работает как шаг', () => {
    expect(stepTake(1, 9, 'inc', 1)).toBe(2);
    expect(stepTake(5, 9, 'dec', 1)).toBe(4);
  });
});

describe('деление флота — пересчёт под живой состав', () => {
  it('КОРАБЛИ ПОГИБЛИ — ВЧЕРАШНИЙ ОТБОР УЖИМАЕТСЯ, а не уезжает в отказ на сервере', () => {
    expect(normalizeTake({ scout: 5 }, { scout: 2 })).toEqual({ scout: 2 });
  });

  it('тип исчез из состава — исчезает и из отбора', () => {
    expect(normalizeTake({ scout: 3, cruiser: 1 }, { scout: 3 })).toEqual({ scout: 3 });
  });

  it('новый тип во флоте начинается с нуля', () => {
    expect(normalizeTake({}, { scout: 3 })).toEqual({ scout: 0 });
  });
});

describe('деление флота — итоги и подтверждение', () => {
  const counts = { scout: 3, cruiser: 2 };

  it('считает уходящих, всех и остающихся', () => {
    expect(splitTotals(counts, { scout: 1, cruiser: 2 })).toEqual({
      takeTotal: 3,
      total: 5,
      left: 2,
    });
  });

  it('итоги тоже зажаты наличным — раздутый отбор их не сломает', () => {
    expect(splitTotals(counts, { scout: 99 }).takeTotal).toBe(3);
  });

  it('НОЛЬ УВЕСТИ НЕЛЬЗЯ — это не деление', () => {
    expect(canConfirm(0, 5)).toBe(false);
  });

  it('ВСЁ УВЕСТИ НЕЛЬЗЯ — это переименование флота, а не новый', () => {
    expect(canConfirm(5, 5)).toBe(false);
  });

  it('хотя бы один уходит и хотя бы один остаётся — можно', () => {
    expect(canConfirm(1, 5)).toBe(true);
    expect(canConfirm(4, 5)).toBe(true);
  });

  it('пустой флот подтвердить нельзя', () => {
    expect(canConfirm(0, 0)).toBe(false);
  });
});

// FSPLIT-1/2 — адрес отбора это СТЕК, а не тип, и десант делится вместе с кораблями.
describe('слоты отбора: стек, а не тип', () => {
  const units = [
    { unit: 'cruiser', count: 2, modules: ['railgun'] },
    { unit: 'cruiser', count: 3 },
    { unit: 'scout', count: 1 },
  ];

  it('ОДИН КОРПУС — ДВЕ СТРОКИ, если начинка разная', () => {
    const slots = splitSlots(units);
    expect(slots.map((x) => `${x.unit}:${x.have}`)).toEqual(['cruiser:2', 'cruiser:3', 'scout:1']);
    expect(slots[0]!.modules).toEqual(['railgun']);
    expect(slots[1]!.modules).toBeUndefined();
    expect(new Set(slots.map((x) => x.key)).size).toBe(3); // адреса различимы
  });

  it('порядок модулей не создаёт третью строку — лоадаут это НАБОР', () => {
    const slots = splitSlots([
      { unit: 'cruiser', count: 1, modules: ['a', 'b'] },
      { unit: 'cruiser', count: 2, modules: ['b', 'a'] },
    ]);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.have).toBe(3);
  });

  it('десант идёт своими слотами, после кораблей', () => {
    const slots = splitSlots([{ unit: 'cruiser', count: 1 }], [{ unit: 'militia', count: 4 }]);
    expect(slots.map((x) => x.kind)).toEqual(['ship', 'landing']);
  });

  it('СТЕК ИСЧЕЗ — исчезает и его отбор (бой под открытым окном)', () => {
    const before = splitSlots(units);
    const take = normalizeSlotTake({ [before[0]!.key]: 2, [before[2]!.key]: 1 }, before);
    const after = splitSlots([{ unit: 'scout', count: 1 }]); // фиттованные крейсеры погибли
    const fixed = normalizeSlotTake(take, after);
    expect(Object.keys(fixed)).toEqual([after[0]!.key]);
  });

  it('«не ноль и не всё» считается по КОРАБЛЯМ: десант в этот счёт не входит', () => {
    const slots = splitSlots([{ unit: 'cruiser', count: 2 }], [{ unit: 'militia', count: 5 }]);
    const ships = slots[0]!.key;
    expect(shipTotals(slots, { [ships]: 1 })).toEqual({ takeTotal: 1, total: 2, left: 1 });
    // весь десант с одним из двух кораблей — деление честное
    expect(shipTotals(slots, { [ships]: 1, [slots[1]!.key]: 5 }).takeTotal).toBe(1);
  });
});

describe('трюм при делении', () => {
  // крейсер везёт 2, скаут — 0; militia занимает 1
  const capacity = (unit: string) => (unit === 'cruiser' ? 2 : 0);
  const size = () => 1;
  const slots = splitSlots(
    [
      { unit: 'cruiser', count: 2 },
      { unit: 'scout', count: 1 },
    ],
    [{ unit: 'militia', count: 3 }],
  );
  const [ships, scouts, troops] = [slots[0]!.key, slots[1]!.key, slots[2]!.key];

  it('считает обе половины: что уезжает и что остаётся', () => {
    const c = cargoSplit(slots, { [ships]: 1, [troops]: 2 }, capacity, size);
    expect(c).toMatchObject({ takenUsed: 2, takenCapacity: 2, keptUsed: 1, keptCapacity: 2 });
    expect(c.fits).toBe(true);
  });

  it('ПЕРЕГРУЗ УЕЗЖАЮЩИХ ВИДЕН ДО ОТПРАВКИ: три солдата на один крейсер не влезут', () => {
    const c = cargoSplit(slots, { [ships]: 1, [troops]: 3 }, capacity, size);
    expect(c.fits).toBe(false);
    expect(canConfirmSplit(slots, { [ships]: 1, [troops]: 3 }, c)).toBe(false);
  });

  it('БРОСИТЬ ВОЙСКА ТОЖЕ НЕЛЬЗЯ: увели оба крейсера, десант остался на скауте', () => {
    const take = { [ships]: 2, [scouts]: 0, [troops]: 0 };
    const c = cargoSplit(slots, take, capacity, size);
    expect(c).toMatchObject({ keptUsed: 3, keptCapacity: 0 });
    expect(canConfirmSplit(slots, take, c)).toBe(false);
  });

  it('честное деление с трюмом подтверждается', () => {
    const take = { [ships]: 1, [troops]: 2 };
    expect(canConfirmSplit(slots, take, cargoSplit(slots, take, capacity, size))).toBe(true);
  });
});
