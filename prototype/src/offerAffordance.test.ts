import { describe, expect, it } from 'vitest';
import {
  type OfferAffordance,
  offerAffordance,
  offerClass,
  offerDisabled,
  offerMark,
} from './offerAffordance';

const ВСЕ: OfferAffordance[] = ['accept', 'waiting', 'plain'];

describe('offerAffordance — чей сейчас ход', () => {
  it('их предложение — тап принимает', () => {
    expect(offerAffordance(false, true, false)).toBe('accept');
  });

  it('моё предложение — ждём их', () => {
    expect(offerAffordance(false, false, true)).toBe('waiting');
  });

  it('ничего не висит — обычная кнопка', () => {
    expect(offerAffordance(false, false, false)).toBe('plain');
  });

  it('правило 2: встречные предложения решаются в МОЮ пользу — принять, а не ждать', () => {
    // Иначе обе стороны сидели бы с «⏳» и сделка умерла бы молча.
    expect(offerAffordance(false, true, true)).toBe('accept');
  });

  it('правило 3: подавитель гасит ОБА предложения разом', () => {
    for (const theirs of [false, true])
      for (const mine of [false, true]) expect(offerAffordance(true, theirs, mine)).toBe('plain');
  });

  it('вердикт всегда один из трёх — молчащих входов нет', () => {
    for (const s of [false, true])
      for (const t of [false, true])
        for (const m of [false, true]) expect(ВСЕ).toContain(offerAffordance(s, t, m));
  });
});

describe('offerClass — правило 4', () => {
  it('базовый класс сохраняется во всех состояниях: по нему кнопку и находят', () => {
    for (const a of ВСЕ)
      for (const active of [false, true]) expect(offerClass('dp-act', active, a)).toContain('dp-act');
  });

  it('их предложение помечается `offer`, моё — `pend`', () => {
    expect(offerClass('dp-act', false, 'accept')).toBe('dp-act offer');
    expect(offerClass('dp-act', false, 'waiting')).toBe('dp-act pend');
    expect(offerClass('dp-act', false, 'plain')).toBe('dp-act');
  });

  it('«уже действует» — своя пометка, независимая от предложений', () => {
    expect(offerClass('dp-map', true, 'plain')).toBe('dp-map on');
    // Чип стойки МОЖЕТ быть одновременно текущим и предложенным ими — так было и до
    // выноса, и вынос этого не меняет.
    expect(offerClass('dp-act', true, 'accept')).toBe('dp-act on offer');
  });

  it('`offer` и `pend` никогда не стоят вместе — состояния взаимоисключающи', () => {
    for (const a of ВСЕ) {
      const cls = offerClass('dp-act', true, a);
      expect(cls.includes('offer') && cls.includes('pend')).toBe(false);
    }
  });
});

describe('offerDisabled — правила 5 и 6', () => {
  it('своё отправленное предложение заперто: повторный тап послал бы дубликат', () => {
    expect(offerDisabled('waiting', false)).toBe(true);
  });

  it('их предложение и обычная кнопка — открыты', () => {
    expect(offerDisabled('accept', false)).toBe(false);
    expect(offerDisabled('plain', false)).toBe(false);
  });

  it('запрет запирает НЕЗАВИСИМО от предложений — ядро всё равно откажет', () => {
    for (const a of ВСЕ) expect(offerDisabled(a, true)).toBe(true);
  });
});

describe('offerMark — пометка перед названием', () => {
  it('их предложение помечается галкой, моё — песочными часами', () => {
    expect(offerMark('accept')).toBe('✓');
    expect(offerMark('waiting')).toBe('⏳');
  });

  it('обычная кнопка пометки не получает: лишний значок читался бы как состояние', () => {
    expect(offerMark('plain')).toBeNull();
  });
});
