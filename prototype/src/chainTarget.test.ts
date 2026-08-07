import { describe, it, expect } from 'vitest';
import { chainPointKind, chainTapTarget, nearestOwnWorld, type WorldPoint } from './chainTarget';

const ME = 'p1';
const мир = (id: string, owner: string | null, x: number, y = 0): WorldPoint => ({
  id,
  owner,
  x,
  y,
});

describe('точка плана — что забирает тап в режиме «Приказ»', () => {
  it('МИР ПРИОРИТЕТНЕЕ ФЛОТА: иначе штурм самого мира стал бы недостижим тапом', () => {
    // у вражеского мира почти всегда стоит его же флот — под пальцем оба
    expect(chainTapTarget({ id: 'p9', owner: 'p2' }, 'f9', ME)).toEqual({
      id: 'p9',
      kind: 'enemy',
    });
  });

  it('ОГОНЬ ПО ФЛОТУ ОСТАЁТСЯ — для флотов, у которых узла под пальцем нет', () => {
    expect(chainTapTarget(null, 'f9', ME)).toEqual({ id: 'f9', kind: 'fleet' });
  });

  it('пустой тап — это «закрыть меню», а не «оставить как было»', () => {
    expect(chainTapTarget(null, null, ME)).toBeNull();
  });

  it('свой мир под пальцем — своя точка, даже если рядом чужой флот', () => {
    expect(chainTapTarget({ id: 'p1', owner: ME }, 'f9', ME)).toEqual({ id: 'p1', kind: 'own' });
  });
});

describe('точка плана — вид точки', () => {
  it('ВИД РЕШАЕТ ВЛАДЕЛЕЦ: свой, чужой, ничей', () => {
    expect(chainPointKind(ME, ME)).toBe('own');
    expect(chainPointKind('p2', ME)).toBe('enemy');
    expect(chainPointKind(null, ME)).toBe('neutral');
  });

  it('мир без поля владельца — ничей, а не чужой', () => {
    expect(chainPointKind(undefined, ME)).toBe('neutral');
  });
});

describe('точка плана — «Домой»', () => {
  const карта = [мир('home', ME, 0), мир('near', ME, 10), мир('far', ME, 100), мир('foe', 'p2', 1)];

  it('берётся ближайший свой мир', () => {
    expect(nearestOwnWorld('home', карта, ME)).toBe('near');
  });

  it('ТОЧКА ОТСЧЁТА НЕ ГОДИТСЯ: «домой» из своего мира иначе значило бы «остаться»', () => {
    expect(nearestOwnWorld('home', [мир('home', ME, 0)], ME)).toBeNull();
  });

  it('ЧУЖОЙ МИР НЕ ДОМ, даже если он ближе всех', () => {
    expect(
      nearestOwnWorld('home', [мир('home', ME, 0), мир('foe', 'p2', 1), мир('mine', ME, 50)], ME),
    ).toBe('mine');
  });

  it('СВОИХ МИРОВ НЕТ — ПУНКТ ГАСНЕТ, а не уводит флот куда-нибудь', () => {
    expect(nearestOwnWorld('x', [мир('x', null, 0), мир('foe', 'p2', 1)], ME)).toBeNull();
  });

  it('неизвестная точка отсчёта дома не имеет', () => {
    expect(nearestOwnWorld('нет-такого', карта, ME)).toBeNull();
  });

  it('расстояние считается по обеим осям, а не по одной', () => {
    const по_диагонали = [мир('from', ME, 0, 0), мир('a', ME, 9, 9), мир('b', ME, 0, 10)];
    expect(nearestOwnWorld('from', по_диагонали, ME)).toBe('b'); // 10 против 12.7
  });
});
