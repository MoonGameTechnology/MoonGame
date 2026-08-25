import { describe, expect, it } from 'vitest';
import { newMatchId } from './matchId';

describe('идентификатор партии (ADDR-1)', () => {
  it('ЭТО НЕ ПОРЯДКОВЫЙ НОМЕР В ПРОЦЕССЕ — форма id не оставляет места счётчику', () => {
    // Ровно то, от чего уводит ADDR-1: `proto`, `proto-2`, … — это «комната №N ЭТОГО
    // процесса», а не адрес партии. Перезапуск хоста выдал бы те же имена другим мирам,
    // и закладка игрока указала бы не туда.
    expect(newMatchId()).toMatch(
      /^m-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('каждый вызов даёт НОВЫЙ идентификатор', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newMatchId()));
    expect(ids.size).toBe(1000);
  });

  it('префикс `m-` стабилен: id опознаётся как адрес партии, а не как случайная строка', () => {
    expect(newMatchId().startsWith('m-')).toBe(true);
  });
});
