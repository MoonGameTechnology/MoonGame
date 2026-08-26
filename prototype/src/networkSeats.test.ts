import { describe, expect, it } from 'vitest';
import { getStance } from '../../packages/shared-core/src/index';
import {
  networkSeats,
  newGame,
  parseNetworkMatchMode,
  seatAiDecision,
  START_CANDIDATES,
} from './game';

describe('prototype network seats', () => {
  it('defaults to ten unique claimable FFA chairs and starts', () => {
    const seats = networkSeats();
    expect(seats.map((seat) => seat.id)).toEqual(Array.from({ length: 10 }, (_, i) => `p${i + 1}`));
    expect(new Set(seats.map((seat) => seat.start))).toEqual(new Set(START_CANDIDATES));
    expect(seats.every((seat) => seat.ai === false && seat.team === undefined)).toBe(true);
    expect(Object.keys(newGame({ seats }).players)).toHaveLength(10);
  });

  it('builds a ten-chair 5v5 with allied teams at war', () => {
    const seats = networkSeats('5v5');
    expect(seats).toHaveLength(10);
    expect(seats.slice(0, 5).every((seat) => seat.team === 'A')).toBe(true);
    expect(seats.slice(5).every((seat) => seat.team === 'B')).toBe(true);
    expect(new Set(seats.map((seat) => seat.start)).size).toBe(10);

    const state = newGame({ seats });
    expect(getStance(state, 'p1', 'p5')).toBe('alliance');
    expect(getStance(state, 'p6', 'p10')).toBe('alliance');
    expect(getStance(state, 'p1', 'p10')).toBe('war');
  });

  it('preserves the four-chair 2v2 mode with distinct starts', () => {
    const seats = networkSeats('2v2');
    expect(seats.map((seat) => seat.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(seats.map((seat) => seat.team)).toEqual(['A', 'A', 'B', 'B']);
    expect(new Set(seats.map((seat) => seat.start)).size).toBe(4);
    expect(seats.every((seat) => seat.ai === false)).toBe(true);
  });

  it('cycles the four factions without duplicating chair names', () => {
    const seats = networkSeats();
    expect(seats.map((seat) => seat.faction)).toEqual([
      'azure',
      'crimson',
      'amber',
      'violet',
      'azure',
      'crimson',
      'amber',
      'violet',
      'azure',
      'crimson',
    ]);
    expect(new Set(seats.map((seat) => seat.name)).size).toBe(10);
  });

  it('accepts supported TEAMS values and rejects unsupported ones', () => {
    expect(parseNetworkMatchMode(undefined)).toBe('ffa');
    for (const mode of ['ffa', '1v1', '2v2', '3v3', '4v4', '5v5', 'pve'] as const) {
      expect(parseNetworkMatchMode(mode), mode).toBe(mode);
    }
    expect(() => parseNetworkMatchMode('6v6')).toThrow('TEAMS must be');
  });

  it('ПУСТОЙ `TEAMS=` — ЭТО FFA, А НЕ ПАДЕНИЕ ХОСТА', () => {
    // `deploy/README.md` обещает «пусто = FFA на 10», а в `.env` докер-компоуза
    // незаполненная строка приезжает пустой, НЕ отсутствующей. До этого хост на такой
    // отказывался стартовать — обещание доки и поведение кода разъезжались.
    expect(parseNetworkMatchMode('')).toBe('ffa');
    expect(parseNetworkMatchMode('   ')).toBe('ffa');
  });
});

describe('командные форматы 1v1..5v5 (PVE-1.1)', () => {
  it('КАЖДЫЙ ФОРМАТ ДАЁТ СВОЁ ЧИСЛО КРЕСЕЛ, ПОРОВНУ НА СТОРОНУ', () => {
    for (const [mode, chairs] of [
      ['1v1', 2],
      ['2v2', 4],
      ['3v3', 6],
      ['4v4', 8],
      ['5v5', 10],
    ] as const) {
      const seats = networkSeats(mode);
      expect(seats, mode).toHaveLength(chairs);
      const half = chairs / 2;
      expect(seats.slice(0, half).every((s) => s.team === 'A'), mode).toBe(true);
      expect(seats.slice(half).every((s) => s.team === 'B'), mode).toBe(true);
    }
  });

  it('СТАРТЫ НЕ ПОВТОРЯЮТСЯ И ВСЕ ИЗ КАТАЛОГА КАРТЫ — два дома на одном мире невозможны', () => {
    for (const mode of ['1v1', '3v3', '4v4'] as const) {
      const starts = networkSeats(mode).map((s) => s.start);
      expect(new Set(starts).size, mode).toBe(starts.length);
      expect(starts.every((st) => START_CANDIDATES.includes(st)), mode).toBe(true);
    }
  });

  it('СОЮЗНИКИ СТАРТУЮТ РЯДОМ, СОПЕРНИКИ — НАПРОТИВ: сторона это дуга периметра', () => {
    // START_CANDIDATES обходит периметр по часовой стрелке, поэтому «рядом» — это
    // соседние индексы, а «напротив» — сдвиг на половину круга (+5 из десяти точек).
    // Иначе команда рассыпана по карте, и союз не даёт ничего, кроме подписи.
    const idx = (mode: '3v3' | '4v4'): number[] =>
      networkSeats(mode).map((s) => START_CANDIDATES.indexOf(s.start));
    for (const mode of ['3v3', '4v4'] as const) {
      const half = networkSeats(mode).length / 2;
      const a = idx(mode).slice(0, half);
      const b = idx(mode).slice(half);
      // дуга: индексы внутри стороны идут подряд
      for (let i = 1; i < a.length; i++) expect(Math.abs(a[i]! - a[i - 1]!), mode).toBe(1);
      for (let i = 1; i < b.length; i++) expect(Math.abs(b[i]! - b[i - 1]!), mode).toBe(1);
      // напротив: каждому месту A отвечает диаметрально противоположное место B
      expect(b, mode).toEqual(a.map((i) => (i + 5) % 10));
    }
  });

  it('в бою 3v3 свои в союзе, чужие в войне', () => {
    const state = newGame({ seats: networkSeats('3v3') });
    expect(Object.keys(state.players)).toHaveLength(6);
    expect(getStance(state, 'p1', 'p3')).toBe('alliance');
    expect(getStance(state, 'p4', 'p6')).toBe('alliance');
    expect(getStance(state, 'p1', 'p6')).toBe('war');
  });

  it('ДУЭЛЬ 1v1 — ЭТО ТОЖЕ КОМАНДЫ, а не ffa на двоих: стороны названы, значит война', () => {
    const state = newGame({ seats: networkSeats('1v1') });
    expect(getStance(state, 'p1', 'p2')).toBe('war');
  });

  it('«pve» осталось прежним раскладом: двое людей против сильного бота', () => {
    // Отдельная ось: `TEAMS=pve` описывает СОСТАВ кресел (кто за столом), а волны Роя —
    // это `modeId: pve_waves` из data/modes.json. Командные форматы её не трогают.
    const seats = networkSeats('pve');
    expect(seats).toHaveLength(3);
    expect(seats.map((s) => s.ai)).toEqual([false, false, true]);
    expect(seats.map((s) => s.team)).toEqual(['A', 'A', 'B']);
  });
});

describe('seatAiDecision — Хранитель vs заместитель (SES-2.2)', () => {
  it('a live Steward delegation always plays its posture — beats presence AND the grace', () => {
    // The player's OWN autopilot runs regardless of whether they are connected or
    // how long they have been away: they explicitly turned it on.
    for (const hasHuman of [true, false]) {
      for (const graceExpired of [true, false]) {
        expect(seatAiDecision(hasHuman, 'defend', graceExpired)).toEqual({
          kind: 'steward',
          posture: 'defend',
        });
      }
    }
    expect(seatAiDecision(false, 'active_defend', true)).toEqual({
      kind: 'steward',
      posture: 'active_defend',
    });
  });

  it('a present human with no delegation commands their own chair — no AI', () => {
    expect(seatAiDecision(true, null, false)).toEqual({ kind: 'none', posture: null });
    // Even past the grace, a connected player is never displaced by the bot.
    expect(seatAiDecision(true, null, true)).toEqual({ kind: 'none', posture: null });
  });

  it('an empty chair waits out the real-time grace before the substitute bot seizes it', () => {
    // Absent, grace still running (a drop / restart blip / a day or two away) → nobody
    // drives it; the empire holds its own until the owner returns.
    expect(seatAiDecision(false, null, false)).toEqual({ kind: 'none', posture: null });
    // Absent PAST the grace (3 real days by default) → the expansion bot takes over.
    expect(seatAiDecision(false, null, true)).toEqual({ kind: 'substitute', posture: 'expand' });
  });
});
