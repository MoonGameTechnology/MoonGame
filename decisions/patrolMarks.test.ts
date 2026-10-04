import { describe, expect, it } from 'vitest';
import type { ShuttleStrike } from '../packages/shared-core/src/index';
import { basePatrols, patrolMarks } from './patrolMarks';

const patrol = (over: Partial<ShuttleStrike> = {}): ShuttleStrike => ({
  id: 'st:1',
  owner: 'p1',
  base: { kind: 'planet', id: 'A' },
  squadronId: 'sq:p1:1',
  units: [{ unit: 'interceptor', count: 2 }],
  target: { kind: 'point' },
  to: { x: 80, y: 30 },
  departedAt: 1000,
  arrivesAt: 5000,
  leg: 'patrol',
  patrol: { hours: 4, radius: 60 },
  ...over,
});

describe('SHU-6.3 — метки патрулей', () => {
  it('ВИСЯЩИЙ ПАТРУЛЬ: круг в его точке и остаток до разворота', () => {
    expect(patrolMarks([patrol()], { me: 'p1', now: 2000 })).toEqual([
      {
        id: 'st:1',
        squadronId: 'sq:p1:1',
        base: { kind: 'planet', id: 'A' },
        at: { x: 80, y: 30 },
        radius: 60,
        active: true,
        leftMs: 3000,
      },
    ]);
  });

  it('НА ПУТИ К ТОЧКЕ круг уже виден, но отсчёта нет: бить эскадра ещё не начала', () => {
    const [m] = patrolMarks([patrol({ leg: 'out' })], { me: 'p1', now: 2000 });
    expect(m?.active).toBe(false);
    expect(m?.leftMs).toBeNull();
  });

  it('ОБРАТНАЯ НОГА МЕТКИ НЕ ДАЁТ: круг обещал бы прикрытие, которого уже нет', () => {
    expect(patrolMarks([patrol({ leg: 'back' })], { me: 'p1', now: 2000 })).toEqual([]);
  });

  it('ЧУЖОЙ ПАТРУЛЬ НЕ ВИДЕН — соло повторяет серверный фильтр вылетов', () => {
    expect(patrolMarks([patrol({ owner: 'p2' })], { me: 'p1', now: 2000 })).toEqual([]);
  });

  it('УДАР ПО ЦЕЛИ — НЕ ПАТРУЛЬ: у него нет круга', () => {
    const strike = patrol({ target: { kind: 'fleet', id: 'F' }, leg: 'out' });
    delete strike.patrol;
    expect(patrolMarks([strike], { me: 'p1', now: 2000 })).toEqual([]);
  });

  it('КРУГ БЕЗ РАДИУСА НЕ РИСУЕТСЯ: «радиус 0» — не факт о мире', () => {
    expect(
      patrolMarks([patrol({ patrol: { hours: 4, radius: 0 } })], { me: 'p1', now: 2000 }),
    ).toEqual([]);
  });

  it('КАДР ОПЕРЕДИЛ ТИК РАЗВОРОТА — остаток ноль, а не минус', () => {
    const [m] = patrolMarks([patrol()], { me: 'p1', now: 9000 });
    expect(m?.leftMs).toBe(0);
  });

  it('ПУСТОЙ СПИСОК — НЕ ОШИБКА', () => {
    expect(patrolMarks(undefined, { me: 'p1', now: 0 })).toEqual([]);
  });
});

describe('SHU-6.3 — патрули базы', () => {
  it('БАЗА СРАВНИВАЕТСЯ ВИДОМ И ID: мир «A» и корабль «A» — разные базы', () => {
    const marks = patrolMarks(
      [
        patrol({ id: 'st:port' }),
        patrol({ id: 'st:ship', base: { kind: 'fleet', id: 'A' } }),
        patrol({ id: 'st:other', base: { kind: 'planet', id: 'B' } }),
      ],
      { me: 'p1', now: 2000 },
    );
    expect(basePatrols(marks, { kind: 'planet', id: 'A' }).map((m) => m.id)).toEqual(['st:port']);
    expect(basePatrols(marks, { kind: 'fleet', id: 'A' }).map((m) => m.id)).toEqual(['st:ship']);
  });
});
