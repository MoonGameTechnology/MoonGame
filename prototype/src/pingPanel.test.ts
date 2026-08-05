// PING-PANEL — сторож прав на пинги.
//
// Главное, что держит этот файл, — РАЗНИЦА между своим и чужим пингом. Свой можно
// переписать и снять у всех; чужой — только спрятать у себя. Перепутать легко (обе
// операции выглядят как «убрать из списка»), а цена ошибки — игрок стирает метки
// союзникам посреди боя.
import { describe, it, expect } from 'vitest';
import { COALITION, type SessionMsg } from './conversations';
import {
  canEditPing,
  canRemovePing,
  pingRows,
  toggleHidden,
  visiblePingLocs,
} from './pingPanel';

const ME = 'p1';
const ALLY = 'p2';

const ping = (from: string, loc: string, text: string, at: number): SessionMsg => ({
  at,
  from,
  to: COALITION,
  text,
  sys: false,
  ping: loc,
});

const FEED: SessionMsg[] = [
  ping(ALLY, 'B', 'жду тут', 10),
  ping(ME, 'A', 'сюда', 20),
  { at: 30, from: ALLY, to: COALITION, text: 'просто чат', sys: false }, // без ping — не метка
  { at: 40, from: ME, to: 'p3', text: 'личное', sys: false, ping: 'C' }, // не коалиция
];

describe('PING-PANEL — список', () => {
  it('берёт только коалиционные сообщения С меткой', () => {
    const locs = pingRows(FEED, ME, new Set()).map((r) => r.loc);
    expect(locs).toEqual(['A', 'B']); // 'C' — личка, «просто чат» — без метки
  });

  it('одна строка на провинцию: последний пинг на мире побеждает', () => {
    const feed = [...FEED, ping(ALLY, 'B', 'уже ушёл', 50)];
    const rows = pingRows(feed, ME, new Set()).filter((r) => r.loc === 'B');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe('уже ушёл');
  });

  it('свои сверху, дальше по свежести — список не должен прыгать', () => {
    const feed = [...FEED, ping(ME, 'D', 'и сюда', 5)];
    const rows = pingRows(feed, ME, new Set());
    expect(rows.map((r) => r.loc)).toEqual(['A', 'D', 'B']);
    expect(rows.every((r, i) => i === 0 || !r.mine || rows[i - 1]!.mine)).toBe(true);
  });
});

describe('PING-PANEL — права: своё против чужого', () => {
  it('свой пинг правится и снимается', () => {
    const mine = pingRows(FEED, ME, new Set()).find((r) => r.loc === 'A')!;
    expect(mine.mine).toBe(true);
    expect(canEditPing(mine)).toBe(true);
    expect(canRemovePing(mine)).toBe(true);
  });

  it('ЧУЖОЙ пинг не правится и не снимается — стереть метку союзнику нельзя', () => {
    const theirs = pingRows(FEED, ME, new Set()).find((r) => r.loc === 'B')!;
    expect(theirs.mine).toBe(false);
    expect(canEditPing(theirs)).toBe(false);
    expect(canRemovePing(theirs)).toBe(false);
  });
});

describe('PING-PANEL — сокрытие ЛОКАЛЬНОЕ', () => {
  it('спрятать можно любой пинг, включая чужой — это моя карта, а не общая модель', () => {
    const hidden = toggleHidden(new Set(), 'B');
    const rows = pingRows(FEED, ME, hidden);
    expect(rows.find((r) => r.loc === 'B')!.hidden).toBe(true);
    expect(rows.find((r) => r.loc === 'A')!.hidden).toBe(false);
    // сама лента не тронута — у союзника метка на месте
    expect(FEED.some((m) => m.ping === 'B')).toBe(true);
  });

  it('переключатель возвращает НОВЫЙ набор и не мутирует прежний', () => {
    const before = new Set(['B']);
    const after = toggleHidden(before, 'B');
    expect(before.has('B')).toBe(true); // прежний не тронут
    expect(after.has('B')).toBe(false);
    expect(toggleHidden(after, 'B').has('B')).toBe(true); // туда-обратно
  });

  it('карта рисует активные МИНУС спрятанные', () => {
    expect(visiblePingLocs(FEED, ME, new Set())).toEqual(['A', 'B']);
    expect(visiblePingLocs(FEED, ME, new Set(['A']))).toEqual(['B']);
  });
});
