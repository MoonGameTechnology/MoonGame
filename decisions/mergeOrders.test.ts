import { describe, expect, it } from 'vitest';
import { mergePlan, type MergeFleet } from './mergeOrders';

const МОЙ = 'p1';
const стоит = (где: string, owner = МОЙ): MergeFleet => ({ owner, location: где, movingTo: null });
const летит = (куда: string, owner = МОЙ): MergeFleet => ({ owner, location: null, movingTo: куда });

describe('годится ли якорь', () => {
  it('ЧУЖОЙ ЯКОРЬ — НЕ ПРОИСХОДИТ НИЧЕГО: приказ отскочил бы, а игрок уже увидел бы «слито»', () => {
    expect(mergePlan({ a: стоит('N1'), x: стоит('N1', 'p2') }, ['a'], 'x', МОЙ)).toBe(null);
  });

  it('якоря больше нет — тоже ничего', () => {
    expect(mergePlan({ a: стоит('N1') }, ['a'], 'нет-такого', МОЙ)).toBe(null);
  });
});

describe('кого пропускают молча', () => {
  it('САМ В СЕБЯ не сливается — рамка выделения захватывает и якорь', () => {
    const plan = mergePlan({ a: стоит('N1') }, ['a'], 'a', МОЙ);
    expect(plan?.steps).toEqual([]);
  });

  it('чужой и погибший среди сливаемых пропускаются, живые — сливаются', () => {
    const флоты = { a: стоит('N1'), b: стоит('N1'), x: стоит('N1', 'p2') };
    const plan = mergePlan(флоты, ['b', 'x', 'нет-такого'], 'a', МОЙ);
    expect(plan?.steps).toEqual([{ kind: 'now', mover: 'b' }]);
  });
});

describe('сливать сейчас или лететь', () => {
  it('ОБА СТОЯТ В ОДНОЙ ТОЧКЕ — сливаем немедленно', () => {
    const plan = mergePlan({ a: стоит('N1'), b: стоит('N1') }, ['b'], 'a', МОЙ);
    expect(plan?.steps).toEqual([{ kind: 'now', mover: 'b' }]);
    expect(plan?.queued).toBe(0);
  });

  it('разные точки — лететь к якорю', () => {
    const plan = mergePlan({ a: стоит('N1'), b: стоит('N2') }, ['b'], 'a', МОЙ);
    expect(plan?.steps).toEqual([{ kind: 'route', mover: 'b', sendTo: 'N1' }]);
    expect(plan?.queued).toBe(1);
  });

  it('ОТБЫВАЮЩИЙ ЯКОРЬ не сливается на месте, хотя сливаемый стоит там же', () => {
    // Точка ещё его, но он уже уходит: слить «на месте» — значит слить с тем, кого тут
    // сейчас не станет. Лететь при этом никуда не надо — сливаемый уже в точке встречи.
    const отбывает = { owner: МОЙ, location: 'N1', movingTo: 'N2' };
    const plan = mergePlan({ a: отбывает, b: стоит('N1') }, ['b'], 'a', МОЙ);
    expect(plan?.dest).toBe('N1');
    expect(plan?.steps).toEqual([{ kind: 'route', mover: 'b', sendTo: null }]);
  });

  it('летящий сливаемый — тоже не на месте', () => {
    const plan = mergePlan({ a: стоит('N1'), b: летит('N1') }, ['b'], 'a', МОЙ);
    expect(plan?.steps).toEqual([{ kind: 'route', mover: 'b', sendTo: 'N1' }]);
  });
});

describe('точка встречи', () => {
  it('ГДЕ ЯКОРЬ БУДЕТ, а не где он есть: у летящего берут конец пути', () => {
    const plan = mergePlan({ a: летит('N9'), b: стоит('N2') }, ['b'], 'a', МОЙ);
    expect(plan?.dest).toBe('N9');
    expect(plan?.steps).toEqual([{ kind: 'route', mover: 'b', sendTo: 'N9' }]);
  });

  it('кто уже стоит в точке встречи — никуда не летит, но намерение записывается', () => {
    const якорьЛетит = { owner: МОЙ, location: null, movingTo: 'N2' };
    const plan = mergePlan({ a: якорьЛетит, b: стоит('N2') }, ['b'], 'a', МОЙ);
    expect(plan?.steps).toEqual([{ kind: 'route', mover: 'b', sendTo: null }]);
    expect(plan?.queued).toBe(1);
  });

  it('якорь ни стоит, ни летит — лететь некуда, но намерение всё равно есть', () => {
    const нигде = { owner: МОЙ, location: null, movingTo: null };
    const plan = mergePlan({ a: нигде, b: стоит('N2') }, ['b'], 'a', МОЙ);
    expect(plan?.dest).toBe(null);
    expect(plan?.steps).toEqual([{ kind: 'route', mover: 'b', sendTo: null }]);
  });
});

describe('группа целиком', () => {
  it('часть сливается сразу, часть летит — счётчик считает только летящих', () => {
    const флоты = { a: стоит('N1'), b: стоит('N1'), c: стоит('N2'), d: стоит('N3') };
    const plan = mergePlan(флоты, ['b', 'c', 'd'], 'a', МОЙ);
    expect(plan?.steps).toEqual([
      { kind: 'now', mover: 'b' },
      { kind: 'route', mover: 'c', sendTo: 'N1' },
      { kind: 'route', mover: 'd', sendTo: 'N1' },
    ]);
    expect(plan?.queued).toBe(2);
  });

  it('порядок шагов повторяет порядок выделения — приказы уходят в том же порядке', () => {
    const флоты = { a: стоит('N1'), b: стоит('N2'), c: стоит('N3') };
    expect(mergePlan(флоты, ['c', 'b'], 'a', МОЙ)?.steps.map((s) => s.mover)).toEqual(['c', 'b']);
  });
});
