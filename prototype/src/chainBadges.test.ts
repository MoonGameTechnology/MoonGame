import { describe, it, expect } from 'vitest';
import { badgeCount, badgePulse, groupByAnchor, shownOrders } from './chainBadges';

const ME = 'p1';
interface Запись {
  fleetId: string;
  owner: string | null | undefined;
  anchor: string | null;
}
const план = (over: Partial<Запись> = {}): Запись => ({
  fleetId: 'f1',
  owner: ME,
  anchor: 'W1',
  ...over,
});
const НИКТО: ReadonlySet<string> = new Set();

describe('слой планов — что вообще показываем', () => {
  it('ТОЛЬКО СВОИ ПЛАНЫ: чужой приказ — это разведданные, которых у игрока нет', () => {
    expect(shownOrders([план({ owner: 'p2' })], ME, НИКТО)).toEqual([]);
    expect(shownOrders([план()], ME, НИКТО)).toHaveLength(1);
  });

  it('РЕДАКТИРУЕМЫЙ ПЛАН НЕ ДУБЛИРУЕТСЯ: иначе он же нарисуется черновиком', () => {
    expect(shownOrders([план({ fleetId: 'f9' })], ME, new Set(['f9']))).toEqual([]);
  });

  it('план без якоря отбор проходит — бейджа его лишает уже группировка', () => {
    expect(shownOrders([план({ anchor: null })], ME, НИКТО)).toHaveLength(1);
    expect(groupByAnchor([план({ anchor: null })]).size).toBe(0);
  });

  it('план без владельца — не свой', () => {
    expect(shownOrders([план({ owner: null }), план({ owner: undefined })], ME, НИКТО)).toEqual([]);
  });

  it('ПОРЯДОК ВХОДА СОХРАНЯЕТСЯ: бейджи не должны прыгать от кадра к кадру', () => {
    const list = shownOrders(
      [план({ fleetId: 'a' }), план({ fleetId: 'b' }), план({ fleetId: 'c' })],
      ME,
      НИКТО,
    );
    expect(list.map((e) => e.fleetId)).toEqual(['a', 'b', 'c']);
  });
});

describe('слой планов — группировка по якорю', () => {
  it('НЕСКОЛЬКО ФЛОТОВ В ОДИН МИР — ОДИН БЕЙДЖ, а не стопка одинаковых значков', () => {
    const g = groupByAnchor([
      план({ fleetId: 'a', anchor: 'W1' }),
      план({ fleetId: 'b', anchor: 'W1' }),
    ]);
    expect(g.size).toBe(1);
    expect(g.get('W1')).toEqual(['a', 'b']);
  });

  it('разные якоря — разные бейджи', () => {
    const g = groupByAnchor([
      план({ fleetId: 'a', anchor: 'W1' }),
      план({ fleetId: 'b', anchor: 'W2' }),
    ]);
    expect([...g.keys()]).toEqual(['W1', 'W2']);
  });

  it('порядок якорей — порядок первого появления, чтобы бейджи не прыгали', () => {
    const g = groupByAnchor([
      план({ fleetId: 'a', anchor: 'W2' }),
      план({ fleetId: 'b', anchor: 'W1' }),
      план({ fleetId: 'c', anchor: 'W2' }),
    ]);
    expect([...g.keys()]).toEqual(['W2', 'W1']);
    expect(g.get('W2')).toEqual(['a', 'c']);
  });

  it('план без якоря в группы не попадает', () => {
    expect(groupByAnchor([план({ anchor: null })]).size).toBe(0);
  });

  it('пустой вход — пустая карта бейджей', () => {
    expect(groupByAnchor([]).size).toBe(0);
  });
});

describe('слой планов — счётчик и пульс', () => {
  it('«1» НА БЕЙДЖЕ — ШУМ: счётчик появляется только при двух и более', () => {
    expect(badgeCount(1)).toBeNull();
    expect(badgeCount(0)).toBeNull();
    expect(badgeCount(2)).toBe('2');
    expect(badgeCount(7)).toBe('7');
  });

  it('пульс бейджа держится в своём диапазоне', () => {
    for (const t of [0, 130, 260, 999, 123_456]) {
      expect(badgePulse(t)).toBeGreaterThanOrEqual(0.1 - 1e-12);
      expect(badgePulse(t)).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('пульс доходит до обоих концов, а не топчется в середине', () => {
    const край = [0, Math.PI / 2, (3 * Math.PI) / 2].map((a) => badgePulse(a * 260));
    expect(Math.max(...край)).toBeCloseTo(1, 6);
    expect(Math.min(...край)).toBeCloseTo(0.1, 6);
  });
});
