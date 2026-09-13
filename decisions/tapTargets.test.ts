import { describe, expect, it } from 'vitest';
import { fleetsUnderTap, type FleetAt } from './tapTargets';

const флот = (id: string, x: number, y: number, extra: Partial<FleetAt> = {}): FleetAt => ({
  id,
  mine: true,
  visible: false,
  anchor: { x, y },
  ...extra,
});

describe('кто попадает под тап', () => {
  it('свой флот в радиусе — претендент', () => {
    expect(fleetsUnderTap([флот('a', 100, 100)], 100, 100, 20)).toEqual(['a']);
  });

  it('ЧУЖОЙ НЕВИДИМЫЙ НЕ ПОПАДАЕТ: иначе тап по пустому месту выдал бы туман', () => {
    const чужой = флот('x', 100, 100, { mine: false, visible: false });
    expect(fleetsUnderTap([чужой], 100, 100, 20)).toEqual([]);
  });

  it('чужой опознанный или радарный — попадает: его можно ОСМОТРЕТЬ', () => {
    const видимый = флот('x', 100, 100, { mine: false, visible: true });
    expect(fleetsUnderTap([видимый], 100, 100, 20)).toEqual(['x']);
  });

  it('у своего видимость не спрашивают', () => {
    const свой = флот('a', 100, 100, { mine: true, visible: false });
    expect(fleetsUnderTap([свой], 100, 100, 20)).toEqual(['a']);
  });

  it('ФЛОТ БЕЗ ТОЧКИ НА КАРТЕ — не претендент: тапнуть по нему игрок не мог', () => {
    expect(fleetsUnderTap([флот('a', 0, 0, { anchor: null })], 0, 0, 20)).toEqual([]);
  });
});

describe('радиус и порядок', () => {
  it('за радиусом — не претендент вовсе', () => {
    expect(fleetsUnderTap([флот('a', 100, 100)], 130, 100, 20)).toEqual([]);
  });

  it('ровно на границе радиуса — уже мимо (строгое сравнение)', () => {
    expect(fleetsUnderTap([флот('a', 100, 100)], 120, 100, 20)).toEqual([]);
    expect(fleetsUnderTap([флот('a', 100, 100)], 119, 100, 20)).toEqual(['a']);
  });

  it('БЛИЖАЙШИЙ ПЕРВЫМ, а не в порядке создания флотов', () => {
    const стопка = [флот('далёкий', 115, 100), флот('близкий', 102, 100), флот('средний', 108, 100)];
    expect(fleetsUnderTap(стопка, 100, 100, 20)).toEqual(['близкий', 'средний', 'далёкий']);
  });

  it('широкий радиус пальца ловит то, что мимо курсора', () => {
    const один = [флот('a', 130, 100)];
    expect(fleetsUnderTap(один, 100, 100, 20)).toEqual([]);
    expect(fleetsUnderTap(один, 100, 100, 44)).toEqual(['a']);
  });

  it('пустая карта — пустой список', () => {
    expect(fleetsUnderTap([], 0, 0, 44)).toEqual([]);
  });
});
