import { describe, expect, it } from 'vitest';
import { placementOf } from './endScreen';
import { atLimit, callsign, liveStanding, standingShown, topSignature } from './standingLine';

const SEP = '\u0001';

describe('liveStanding', () => {
  // Правило 1: та же формула, что и на итоговом экране.
  it('agrees with the end-screen placement on the same table', () => {
    const scores = { p1: { total: 40 }, p2: { total: 120 }, p3: { total: 80 } };
    const st = liveStanding(scores, 'p1', 200);
    const end = placementOf(scores, 'p1');
    expect({ place: st.place, of: st.of, score: st.score }).toEqual({
      place: end.place,
      of: end.of,
      score: end.total,
    });
    expect(st.place).toBe(3);
    expect(st.of).toBe(3);
  });

  // Правило 2: пустая таблица даёт место 0 — печатать его нельзя.
  it('reports place 0 of 0 before any seat is scored', () => {
    expect(liveStanding({}, 'p1', 200)).toEqual({ place: 0, of: 0, score: 0, need: 200 });
  });

  // Сижу за столом, но счёт есть у других — место 0, потому что меня в таблице нет.
  it('reports place 0 when my seat is missing from the table', () => {
    const st = liveStanding({ p2: { total: 10 } }, 'p1', 200);
    expect(st.place).toBe(0);
    expect(st.of).toBe(1);
    expect(st.score).toBe(0);
  });

  it('rounds a fractional score the way the end screen does', () => {
    expect(liveStanding({ p1: { total: 40.6 } }, 'p1', 200).score).toBe(41);
  });

  // Правило 3: перебор порога — это ноль остатка, а не минус.
  it('clamps the remainder at zero once the limit is passed', () => {
    expect(liveStanding({ p1: { total: 260 } }, 'p1', 200).need).toBe(0);
    expect(liveStanding({ p1: { total: 200 } }, 'p1', 200).need).toBe(0);
    expect(liveStanding({ p1: { total: 199 } }, 'p1', 200).need).toBe(1);
  });
});

describe('standingShown', () => {
  it('prints the standing from first place up', () => {
    expect(standingShown(1)).toBe(true);
    expect(standingShown(7)).toBe(true);
  });

  // Правило 2 живьём: «1-е из 0» не печатается никогда.
  it('stays silent when there is no place at all', () => {
    expect(standingShown(0)).toBe(false);
  });
});

describe('atLimit', () => {
  // Правило 4: подсветка победы выводится из показанного остатка.
  it('lights up exactly when nothing is left to score', () => {
    expect(atLimit(0)).toBe(true);
    expect(atLimit(1)).toBe(false);
    expect(atLimit(200)).toBe(false);
  });
});

describe('callsign', () => {
  it('takes the typed callsign, trimmed', () => {
    expect(callsign('  Ворон  ', 'Дом Аркан')).toBe('Ворон');
  });

  // Правило 5: пустое поле не оставляет командира безымянным.
  it('falls back to the house name on an empty field', () => {
    expect(callsign('', 'Дом Аркан')).toBe('Дом Аркан');
    expect(callsign('   ', 'Дом Аркан')).toBe('Дом Аркан');
  });

  it('ends up empty only when there is no house either', () => {
    expect(callsign('', undefined)).toBe('');
    expect(callsign('', '')).toBe('');
  });
});

describe('topSignature', () => {
  it('carries every visible field', () => {
    expect(topSignature('Ворон', 2, 5, 120, 3, '01:02:03')).toBe(
      ['Ворон', '2/5', '120', '3', '01:02:03'].join(SEP),
    );
  });

  // Правило 6: каждое поле в отдельности меняет подпись, иначе строка застынет.
  it('changes when any single field changes', () => {
    const base = topSignature('Ворон', 2, 5, 120, 3, '01:02:03');
    expect(topSignature('Сокол', 2, 5, 120, 3, '01:02:03')).not.toBe(base);
    expect(topSignature('Ворон', 1, 5, 120, 3, '01:02:03')).not.toBe(base);
    expect(topSignature('Ворон', 2, 6, 120, 3, '01:02:03')).not.toBe(base);
    expect(topSignature('Ворон', 2, 5, 121, 3, '01:02:03')).not.toBe(base);
    expect(topSignature('Ворон', 2, 5, 120, 4, '01:02:03')).not.toBe(base);
    expect(topSignature('Ворон', 2, 5, 120, 3, '01:02:04')).not.toBe(base);
  });

  // Правило 7: без разделителя эти два состояния слились бы в одну подпись.
  it('separates a callsign that looks like the next field', () => {
    expect(topSignature('3', 5, 5, 1, 1, 'x')).not.toBe(topSignature('35', 5, 5, 1, 1, 'x'));
  });

  it('is stable for identical state', () => {
    expect(topSignature('Ворон', 2, 5, 120, 3, '01:02:03')).toBe(
      topSignature('Ворон', 2, 5, 120, 3, '01:02:03'),
    );
  });
});
