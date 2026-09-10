/**
 * ТРАССА ВЫЛЕТА (остаток SHU-3.1) — что карта показывает про летящие эскадры.
 *
 * До этого кирпича `state.strikes` не читал в прототипе НИКТО: игрок отправлял удар и
 * видел результат в журнале, но не путь. Здесь закреплены решения трассы; рисование
 * (канва) остаётся в `main.ts`.
 */
import { describe, expect, it } from 'vitest';
import { strikeProgress, strikeTrails, type BasePos } from './strikeTrail';
import type { ShuttleStrike } from '../../packages/shared-core/src/index';

const strike = (over: Partial<ShuttleStrike> = {}): ShuttleStrike => ({
  id: 'st:1',
  owner: 'p1',
  base: { kind: 'planet', id: 'A' },
  squadronId: 'sq:p1:1',
  units: [{ unit: 'interceptor', count: 3 }],
  target: { kind: 'planet', id: 'B' },
  to: { x: 100, y: 0 },
  departedAt: 0,
  arrivesAt: 1000,
  leg: 'out',
  ...over,
});

/** База «A» стоит в начале координат, носитель «F» — в стороне. */
const basePos: BasePos = (base) =>
  base.id === 'A' ? { x: 0, y: 0 } : base.id === 'F' ? { x: 0, y: 60 } : null;

describe('SHU-3.1 — доля пути', () => {
  it('ЭСКАДРА ИДЁТ ПО ВРЕМЕНИ МИРА: половина срока — половина пути', () => {
    expect(strikeProgress(strike(), 500)).toBeCloseTo(0.5);
  });

  it('ДОЛЯ ЗАЖАТА В [0,1]: кадр может прийти позже прибытия, за цель эскадру не уносит', () => {
    expect(strikeProgress(strike(), -50)).toBe(0);
    expect(strikeProgress(strike(), 9999)).toBe(1);
  });

  it('НУЛЕВАЯ ДЛИТЕЛЬНОСТЬ НЕ ДЕЛИТСЯ НА НОЛЬ: мгновенный вылет стоит в конце', () => {
    expect(strikeProgress(strike({ departedAt: 700, arrivesAt: 700 }), 700)).toBe(1);
  });
});

describe('SHU-3.1 — трасса', () => {
  it('НОГА «ТУДА» ИДЁТ ОТ БАЗЫ К ТОЧКЕ УДАРА, и значок ползёт по ней', () => {
    const [tr] = strikeTrails([strike()], { me: 'p1', now: 250, basePos });
    expect(tr?.from).toEqual({ x: 0, y: 0 });
    expect(tr?.to).toEqual({ x: 100, y: 0 });
    expect(tr?.at.x).toBeCloseTo(25);
    expect(tr?.machines).toBe(3);
  });

  it('НОГА «ОБРАТНО» РАЗВЁРНУТА: от точки удара к базе — иначе значок пошёл бы вспять', () => {
    const [tr] = strikeTrails([strike({ leg: 'back' })], { me: 'p1', now: 250, basePos });
    expect(tr?.from).toEqual({ x: 100, y: 0 });
    expect(tr?.to).toEqual({ x: 0, y: 0 });
    expect(tr?.at.x).toBeCloseTo(75);
  });

  it('КОНЕЦ У БАЗЫ БЕРЁТСЯ ЖИВОЙ, а не из снимка: носитель ушёл — трасса идёт за ним', () => {
    const [tr] = strikeTrails([strike({ base: { kind: 'fleet', id: 'F' } })], {
      me: 'p1',
      now: 0,
      basePos,
    });
    expect(tr?.from).toEqual({ x: 0, y: 60 });
  });

  it('ЧУЖИХ ВЫЛЕТОВ НА КАРТЕ НЕ БЫВАЕТ — соло обязано повторять серверный фильтр', () => {
    expect(strikeTrails([strike({ owner: 'p2' })], { me: 'p1', now: 250, basePos })).toEqual([]);
  });

  it('БЕЗ ЖИВОЙ БАЗЫ ТРАССЫ НЕТ: порт снесли — тянуть линию в никуда нечестно', () => {
    const gone = strike({ base: { kind: 'planet', id: 'Z' } });
    expect(strikeTrails([gone], { me: 'p1', now: 250, basePos })).toEqual([]);
  });

  it('ПУСТОЙ СПИСОК — НЕ ОШИБКА: вылетов нет, рисовать нечего', () => {
    expect(strikeTrails(undefined, { me: 'p1', now: 0, basePos })).toEqual([]);
  });

  it('ПОЗЫВНОЙ ЗВЕНА ЕДЕТ С ТРАССОЙ: значок подписан тем же именем, что карточка в порту', () => {
    const [tr] = strikeTrails([strike()], { me: 'p1', now: 0, basePos });
    expect(tr?.squadronId).toBe('sq:p1:1');
  });
});
