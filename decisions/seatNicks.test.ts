import { describe, expect, it } from 'vitest';
import { NICK_MAX, NICKS_REFRESH_MS, nicksFromSeats, nicksRefreshDue } from './seatNicks';

describe('nicksFromSeats — ники из расклада мест', () => {
  it('кресло с ником даёт строку, свободное кресло — нет', () => {
    const body = {
      seats: [
        { playerId: 'p1', nick: 'Orion', taken: true },
        { playerId: 'p2', nick: null, taken: false },
        { playerId: 'p3', taken: false },
      ],
    };
    expect(nicksFromSeats(body)).toEqual({ p1: 'Orion' });
  });

  it('пробелы по краям срезаются, пустой и слишком длинный ник отбрасываются', () => {
    const body = {
      seats: [
        { playerId: 'p1', nick: '  Vega ' },
        { playerId: 'p2', nick: '   ' },
        { playerId: 'p3', nick: 'x'.repeat(NICK_MAX + 1) },
      ],
    };
    expect(nicksFromSeats(body)).toEqual({ p1: 'Vega' });
  });

  it('сломанный ответ даёт пустую карту, а не исключение', () => {
    expect(nicksFromSeats(null)).toEqual({});
    expect(nicksFromSeats({ seats: 'нет' })).toEqual({});
    expect(nicksFromSeats({ seats: [null, 5, { playerId: 7, nick: 'a' }] })).toEqual({});
  });
});

describe('nicksRefreshDue — не чаще раза в промежуток', () => {
  it('первый запрос нужен всегда', () => {
    expect(nicksRefreshDue(null, 0)).toBe(true);
  });

  it('внутри промежутка — нет, по его истечении — да', () => {
    expect(nicksRefreshDue(1000, 1000 + NICKS_REFRESH_MS - 1)).toBe(false);
    expect(nicksRefreshDue(1000, 1000 + NICKS_REFRESH_MS)).toBe(true);
  });
});
