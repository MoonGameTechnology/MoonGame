// SHU-3.1 — сторож на то, что челноки вообще ВИДНЫ игроку.
//
// Дефект, который чинит кирпич: вкладка «Крылья» показывала гарнизон, а челнок с
// SHU-1.1 в гарнизоне не бывает — он в `planet.hangar`. Вкладка была гарантированно
// пустой, построенные машины исчезали для игрока, и применить их было нечем.
import { describe, it, expect } from 'vitest';
import { data } from './gameData';
import { fleetHangar, hasHangar, planetHangar, transferOffer } from './hangarPanel';
import type { Fleet, Planet } from '../../packages/shared-core/src/index';

const port = (over: Partial<Planet> = {}): Planet => ({
  id: 'A',
  owner: 'p1',
  position: { x: 0, y: 0 },
  resources: {},
  buildings: [{ type: 'spaceport', level: 1, hp: data.buildings.spaceport!.hp }],
  garrison: [],
  traits: [],
  ...over,
});

const carrier = (over: Partial<Fleet> = {}): Fleet => ({
  id: 'F',
  owner: 'p1',
  location: 'A',
  movement: null,
  units: [{ unit: 'shuttle_carrier', count: 1 }],
  traits: [],
  battleId: null,
  ...over,
});

describe('SHU-3.1 — ангар МИРА виден игроку', () => {
  it('ЧЕЛНОКИ БЕРУТСЯ ИЗ АНГАРА, А НЕ ИЗ ГАРНИЗОНА — их там не бывает', () => {
    const p = port({
      hangar: [{ unit: 'interceptor', count: 2 }],
      garrison: [{ unit: 'militia', count: 5 }],
    });
    const v = planetHangar(p, data)!;
    expect(v.stacks).toEqual([{ unit: 'interceptor', count: 2 }]);
    expect(v.used).toBe(2);
  });

  it('ПУСТОЙ ПОРТ ПОКАЗЫВАЕТСЯ: «0 из N» говорит «сюда можно строить»', () => {
    const v = planetHangar(port(), data)!;
    expect(hasHangar(v)).toBe(true);
    expect(v.used).toBe(0);
    expect(v.bay).toBeGreaterThan(0);
    expect(v.blocked).toBe('empty');
  });

  it('НЕТ ПОРТА — НЕТ БЛОКА ВОВСЕ, а не «0 из 0»', () => {
    expect(planetHangar(port({ buildings: [] }), data)).toBeNull();
  });

  it('выбитый стек в состав не попадает', () => {
    const v = planetHangar(port({ hangar: [{ unit: 'interceptor', count: 0 }] }), data)!;
    expect(v.stacks).toEqual([]);
    expect(v.free).toBe(v.bay);
  });

  it('ТРИ ПРИЧИНЫ «НЕЛЬЗЯ ЛЕТЕТЬ» НАЗЫВАЮТСЯ РАЗНЫМИ СЛОВАМИ', () => {
    const full = { hangar: [{ unit: 'interceptor', count: 1 }] };
    expect(planetHangar(port(full), data)!.blocked).toBeNull();
    expect(planetHangar(port({ ...full, sortie: { fuel: 2, rearming: 3 } }), data)!.blocked).toBe(
      'rearming',
    );
    expect(planetHangar(port({ ...full, sortie: { fuel: 0, rearming: 0 } }), data)!.blocked).toBe(
      'no-fuel',
    );
    expect(planetHangar(port(), data)!.blocked).toBe('empty');
  });

  it('топливо — счётчик МЕСТА, и у пустого порта его не показывают', () => {
    expect(planetHangar(port(), data)!.sortie).toBeUndefined();
    const v = planetHangar(port({ hangar: [{ unit: 'interceptor', count: 1 }] }), data)!;
    expect(v.sortie?.maxFuel).toBe(data.units.interceptor!.stats.fuel);
  });
});

describe('SHU-3.1 — трюм НОСИТЕЛЯ виден той же формой', () => {
  it('«Шаттл» несёт ангар, и его состав читается так же, как у порта', () => {
    const v = fleetHangar(carrier({ hangar: [{ unit: 'bomber', count: 2 }] }), data)!;
    expect(v.used).toBe(2);
    expect(v.bay).toBe(data.units.shuttle_carrier!.stats.shuttleBay);
  });

  it('обычный корабль ангара не несёт — блока нет', () => {
    expect(fleetHangar(carrier({ units: [{ unit: 'cruiser', count: 3 }] }), data)).toBeNull();
  });
});

describe('SHU-3.1 — перегрузка порт ⇄ носитель предлагается, только если ПРОЙДЁТ', () => {
  const full = planetHangar(port({ hangar: [{ unit: 'interceptor', count: 2 }] }), data);
  const empty = planetHangar(port(), data);
  const hold = fleetHangar(carrier(), data);
  const heldFull = fleetHangar(
    carrier({ hangar: [{ unit: 'bomber', count: data.units.shuttle_carrier!.stats.shuttleBay! }] }),
    data,
  );

  it('носитель у мира и место есть — можно поднять на борт', () => {
    expect(transferOffer(full, hold, { docked: true, mine: true }).load).toBe(true);
  });

  it('пустой порт поднимать нечем, полный трюм принять не может', () => {
    expect(transferOffer(empty, hold, { docked: true, mine: true }).load).toBe(false);
    expect(transferOffer(full, heldFull, { docked: true, mine: true }).load).toBe(false);
  });

  it('в трюме есть машины и порт не полон — можно ссадить', () => {
    expect(transferOffer(empty, heldFull, { docked: true, mine: true }).unload).toBe(true);
  });

  it('НОСИТЕЛЬ НЕ У МИРА ИЛИ НЕ СВОЙ — КНОПОК НЕТ ВОВСЕ, а не серых', () => {
    expect(transferOffer(full, hold, { docked: false, mine: true })).toEqual({
      load: false,
      unload: false,
    });
    expect(transferOffer(full, hold, { docked: true, mine: false })).toEqual({
      load: false,
      unload: false,
    });
  });

  it('корабль без ангара перегрузку не предлагает', () => {
    const plain = fleetHangar(carrier({ units: [{ unit: 'cruiser', count: 1 }] }), data);
    expect(transferOffer(full, plain, { docked: true, mine: true })).toEqual({
      load: false,
      unload: false,
    });
  });
});
