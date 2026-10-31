import { describe, expect, it } from 'vitest';
import { MENU_FRAME_MS } from './simClock';
import {
  ERROR_CHARS,
  FREEZE_MS,
  SESSIONS_KEPT,
  STALLS_KEPT,
  STALL_MS,
  isStall,
  parseSessions,
  stallKind,
  startSession,
  withError,
  withStall,
  type Stall,
} from './renderBlackBox';

const stall = (at: number, ms: number, open = false): Stall => ({
  at,
  ms,
  kind: 'gpu',
  scale: 3,
  preparing: false,
  ...(open ? { open: true as const } : {}),
});

describe('чёрный ящик отрисовки', () => {
  it('остановка — долгий разрыв на виду; пауза меню и фон ею не считаются', () => {
    expect(isStall(STALL_MS, true)).toBe(true);
    expect(isStall(MENU_FRAME_MS + 60, true)).toBe(false);
    expect(isStall(60_000, false)).toBe(false);
  });

  it('пульс молчал почти всю остановку — занят главный поток, шёл — ждали видеочип', () => {
    expect(stallKind(4000, 3990)).toBe('main');
    expect(stallKind(4000, 2000)).toBe('main');
    expect(stallKind(4000, 260)).toBe('gpu');
  });

  it('новый запуск встаёт первым, из прошлых остаются последние', () => {
    let sessions = startSession([], 'v1', 1000);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      build: 'v1',
      startedAt: 1000,
      lastAt: 1000,
      closed: false,
      stalls: [],
    });
    for (let i = 2; i <= 5; i++) sessions = startSession(sessions, 'v' + i, i * 1000);
    expect(sessions.map((s) => s.build)).toEqual(['v5', 'v4', 'v3'].slice(0, SESSIONS_KEPT));
  });

  it('запуск с зависанием переживает чистые перезапуски, пока не придёт новое зависание', () => {
    let sessions = startSession([], 'v1', 1000);
    sessions[0] = withStall(sessions[0]!, stall(10, FREEZE_MS, true));
    for (let i = 2; i <= 5; i++) sessions = startSession(sessions, 'v' + i, i * 1000);
    expect(sessions.map((s) => s.build)).toEqual(['v5', 'v4', 'v3', 'v1']);
    // Секундная остановка зависанием не считается: такой запуск уходит как обычный.
    sessions[0] = withStall(sessions[0]!, stall(10, FREEZE_MS - 1));
    sessions = startSession(sessions, 'v6', 6000);
    expect(sessions.map((s) => s.build)).toEqual(['v6', 'v5', 'v4', 'v1']);
    // Новое зависание среди последних — старое больше не держится.
    sessions[0] = withStall(sessions[0]!, stall(10, FREEZE_MS + 1));
    sessions = startSession(sessions, 'v7', 7000);
    expect(sessions.map((s) => s.build)).toEqual(['v7', 'v6', 'v5']);
    for (let i = 8; i <= 9; i++) sessions = startSession(sessions, 'v' + i, i * 1000);
    expect(sessions.map((s) => s.build)).toEqual(['v9', 'v8', 'v7', 'v6']);
    expect(parseSessions(JSON.stringify(sessions))).toEqual(sessions);
  });

  it('идущую остановку обновляет, новую добавляет, хранит последние', () => {
    let [session] = startSession([], '', 0);
    session = withStall(session!, stall(500, 1200, true));
    session = withStall(session, stall(500, 9000, true)); // та же, ещё идёт
    expect(session.stalls).toEqual([stall(500, 9000, true)]);
    session = withStall(session, stall(500, 9400)); // кадр её закрыл
    expect(session.stalls).toEqual([stall(500, 9400)]);
    expect([session.stallCount, session.worstMs]).toEqual([1, 9400]);
    for (let i = 1; i <= STALLS_KEPT + 2; i++)
      session = withStall(session, stall(20_000 + i * 2000, 1000 + i));
    expect(session.stalls).toHaveLength(STALLS_KEPT);
    expect(session.stalls[0]!.at).toBe(20_000 + 3 * 2000);
    expect([session.stallCount, session.worstMs]).toEqual([STALLS_KEPT + 3, 9400]);
  });

  it('закрытую остановку с тем же началом не путает с идущей', () => {
    let [session] = startSession([], '', 0);
    session = withStall(session!, stall(500, 1200));
    session = withStall(session, stall(500, 1300));
    expect(session.stallCount).toBe(2);
  });

  it('помнит начало первой ошибки кадра, а не последней', () => {
    let [session] = startSession([], '', 0);
    session = withError(session!, 'x'.repeat(ERROR_CHARS + 50));
    session = withError(session, 'вторая');
    expect(session.firstError).toBe('x'.repeat(ERROR_CHARS));
  });

  it('читает свою запись и не падает на чужой', () => {
    const sessions = startSession([], 'v1', 1000);
    sessions[0] = withStall(sessions[0]!, stall(10, 1500));
    expect(parseSessions(JSON.stringify(sessions))).toEqual(sessions);
    for (const raw of [
      null,
      '',
      '{',
      'null',
      '{"a":1}',
      '[1,"x",null]',
      JSON.stringify([{ ...sessions[0], stalls: [{ at: 1 }] }]),
    ])
      expect(parseSessions(raw)).toEqual([]);
    const many = Array.from({ length: SESSIONS_KEPT + 2 }, () => sessions[0]);
    expect(parseSessions(JSON.stringify(many))).toHaveLength(SESSIONS_KEPT + 1);
  });
});
