import { describe, it, expect } from 'vitest';
import { newGame } from './game';
import { createScanMemory, snapshotOf } from './scanMemory';
import type { Planet } from '../../packages/shared-core/src/index';

const base = newGame();
const anyPlanet = Object.values(base.planets)[0]!;

const world = (id: string, over: Partial<Planet> = {}): Planet =>
  ({
    ...anyPlanet,
    id,
    owner: 'p2',
    garrison: [{ unit: 'militia', count: 3 }],
    buildings: [{ type: 'mine', level: 2, hp: 100 }],
    ...over,
  }) as Planet;

const worlds = (...ps: Planet[]): Record<string, Planet> =>
  Object.fromEntries(ps.map((p) => [p.id, p]));

describe('память разведки — снимок', () => {
  it('запоминает владельца, численность гарнизона и постройки с уровнями', () => {
    expect(snapshotOf(world('A'))).toEqual({
      owner: 'p2',
      garrison: 3,
      buildings: [{ type: 'mine', level: 2 }],
    });
  });

  it('гарнизон складывается по всем стекам', () => {
    const p = world('A', {
      garrison: [
        { unit: 'militia', count: 3 },
        { unit: 'tank', count: 2 },
      ],
    });
    expect(snapshotOf(p).garrison).toBe(5);
  });

  it('ничейный мир помнится ничейным, а не забытым', () => {
    expect(snapshotOf(world('A', { owner: null })).owner).toBeNull();
  });

  it('пустой мир даёт нули, а не отсутствие полей', () => {
    expect(snapshotOf(world('A', { garrison: [], buildings: [] }))).toEqual({
      owner: 'p2',
      garrison: 0,
      buildings: [],
    });
  });
});

describe('память разведки — что попадает внутрь', () => {
  it('пишутся ТОЛЬКО переданные опознанные узлы', () => {
    const mem = createScanMemory();
    const a = world('A');
    const b = world('B');
    mem.remember(['A'], worlds(a, b));
    expect(mem.has('A')).toBe(true);
    expect(mem.has('B')).toBe(false); // радарный контакт состава не выдаёт
  });

  it('несуществующий узел не создаёт пустой записи', () => {
    const mem = createScanMemory();
    mem.remember(['нет-такого'], worlds(world('A')));
    expect(mem.has('нет-такого')).toBe(false);
  });

  it('повторное опознание обновляет снимок', () => {
    const mem = createScanMemory();
    const a = world('A');
    mem.remember(['A'], worlds(a));
    mem.remember(['A'], worlds(world('A', { owner: 'p3', garrison: [] })));
    expect(mem.get('A')).toEqual({
      owner: 'p3',
      garrison: 0,
      buildings: [{ type: 'mine', level: 2 }],
    });
  });
});

describe('память разведки — снимок НЕ следует за живым миром', () => {
  it('изменения мира после опознания в память не протекают', () => {
    const mem = createScanMemory();
    const live = world('A');
    mem.remember(['A'], worlds(live));

    live.owner = 'p9';
    live.garrison.push({ unit: 'tank', count: 7 });
    live.buildings.push({ type: 'radar', level: 1, hp: 100 });

    expect(mem.get('A')).toEqual({
      owner: 'p2',
      garrison: 3,
      buildings: [{ type: 'mine', level: 2 }],
    });
  });

  it('список построек в памяти — своя копия, живой массив её не трогает', () => {
    const live = world('A');
    const snap = snapshotOf(live);
    live.buildings.length = 0;
    expect(snap.buildings).toHaveLength(1);
  });
});

describe('память разведки — владелец и срок жизни', () => {
  it('последний известный владелец достаётся по узлу', () => {
    const mem = createScanMemory();
    mem.remember(['A'], worlds(world('A')));
    expect(mem.ownerOf('A')).toBe('p2');
  });

  it('незнакомый узел владельца не выдумывает', () => {
    expect(createScanMemory().ownerOf('A')).toBeNull();
  });

  it('ПАМЯТЬ ПРИНАДЛЕЖИТ МАТЧУ: очистка стирает разведку прошлой партии', () => {
    const mem = createScanMemory();
    mem.remember(['A'], worlds(world('A')));
    mem.clear();
    expect(mem.has('A')).toBe(false);
    expect(mem.get('A')).toBeUndefined();
    expect(mem.ownerOf('A')).toBeNull();
  });
});
