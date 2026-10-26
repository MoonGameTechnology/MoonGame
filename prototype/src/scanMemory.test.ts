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
    kind: 'planet',
    terrain: 'nebula',
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
      environment: { kind: 'planet', terrain: 'nebula' },
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
      environment: { kind: 'planet', terrain: 'nebula' },
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
      environment: { kind: 'planet', terrain: 'nebula' },
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
      environment: { kind: 'planet', terrain: 'nebula' },
    });
  });

  it('скрытая смена среды не меняет снимок до нового опознания', () => {
    const mem = createScanMemory();
    mem.remember(['A'], worlds(world('A')));
    // Мир не правят на месте, а заменяют: сменившаяся среда — новый объект мира.
    const changed = world('A', { kind: 'pirate_base', terrain: 'asteroid_field' });
    mem.remember([], worlds(changed));
    expect(mem.get('A')!.environment).toEqual({ kind: 'planet', terrain: 'nebula' });
    mem.remember(['A'], worlds(changed));
    expect(mem.get('A')!.environment).toEqual({ kind: 'pirate_base', terrain: 'asteroid_field' });
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

describe('память разведки — номер правки', () => {
  it('растёт с записью, очисткой и восстановлением, а чтение его не трогает', () => {
    const mem = createScanMemory();
    const fresh = mem.version();
    mem.remember(['A'], worlds(world('A')));
    const written = mem.version();
    expect(written).toBeGreaterThan(fresh);
    mem.get('A');
    mem.has('A');
    mem.ownerOf('A');
    const saved = mem.dump();
    expect(mem.version()).toBe(written);
    mem.clear();
    const cleared = mem.version();
    expect(cleared).toBeGreaterThan(written);
    mem.restore(saved);
    expect(mem.version()).toBeGreaterThan(cleared);
  });
});

describe('память разведки — тот же объект мира не переснимается (W8)', () => {
  it('тот же объект — тот же снимок, новый объект — новый снимок', () => {
    const mem = createScanMemory();
    const a = world('A');
    mem.remember(['A'], worlds(a));
    const first = mem.get('A');
    mem.remember(['A'], worlds(a));
    expect(mem.get('A')).toBe(first);
    mem.remember(['A'], worlds(world('A', { owner: 'p3' })));
    expect(mem.get('A')).not.toBe(first);
    expect(mem.ownerOf('A')).toBe('p3');
  });

  it('вернувшийся прежний объект снимается заново, а не остаётся снимком другого', () => {
    const mem = createScanMemory();
    const before = world('A');
    mem.remember(['A'], worlds(before));
    mem.remember(['A'], worlds(world('A', { owner: 'p3' })));
    mem.remember(['A'], worlds(before));
    expect(mem.ownerOf('A')).toBe('p2');
  });

  it('мир, правленный на месте, снимается заново только после retake()', () => {
    const mem = createScanMemory();
    const live = world('A');
    mem.remember(['A'], worlds(live));
    live.owner = 'p9';
    mem.remember(['A'], worlds(live));
    expect(mem.ownerOf('A')).toBe('p2');
    mem.retake();
    mem.remember(['A'], worlds(live));
    expect(mem.ownerOf('A')).toBe('p9');
  });

  it('после очистки и восстановления узел снимается заново с того же объекта', () => {
    const mem = createScanMemory();
    const a = world('A');
    mem.remember(['A'], worlds(a));
    mem.clear();
    mem.remember(['A'], worlds(a));
    expect(mem.has('A')).toBe(true);

    const saved = mem.dump();
    const now = world('A', { owner: 'p3' });
    mem.remember(['A'], worlds(now));
    mem.restore(saved);
    expect(mem.ownerOf('A')).toBe('p2');
    mem.remember(['A'], worlds(now));
    expect(mem.ownerOf('A')).toBe('p3');
  });
});
