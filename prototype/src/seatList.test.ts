import { describe, expect, it } from 'vitest';
import { houseLine, seatView, type SeatPhase } from './seatList';

describe('что окно выбора места показывает вместо списка', () => {
  it('ОКНО ПОДНИМАЕТСЯ СРАЗУ: пока список едет, стоит «Загрузка…»', () => {
    expect(seatView('opening')).toEqual({
      kind: 'placeholder',
      key: 'seatpick.loading',
      tone: 'dim',
    });
  });

  it('места получены — рисуем дома', () => {
    expect(seatView('loaded')).toEqual({ kind: 'houses' });
  });

  it('беда — красная заглушка: тон отличается раньше, чем игрок дочитает строку', () => {
    const беда = { kind: 'placeholder', key: 'seatpick.load-failed', tone: 'bad' };
    expect(seatView('refused')).toEqual(беда);
    expect(seatView('unreachable')).toEqual(беда);
  });

  it('дома показываются РОВНО в одном случае из четырёх — остальное заглушки', () => {
    const фазы: SeatPhase[] = ['opening', 'loaded', 'refused', 'unreachable'];
    expect(фазы.filter((p) => seatView(p).kind === 'houses')).toEqual(['loaded']);
  });

  it('заглушка ожидания и заглушка беды не совпадают ни текстом, ни тоном', () => {
    const ждём = seatView('opening');
    const беда = seatView('refused');
    expect(ждём).not.toEqual(беда);
    if (ждём.kind === 'placeholder' && беда.kind === 'placeholder') {
      expect(ждём.tone).not.toBe(беда.tone);
      expect(ждём.key).not.toBe(беда.key);
    }
  });
});

describe('подписи строки дома', () => {
  it('СЛОВО И СЧЁТ: «свободно» и сколько мест осталось', () => {
    expect(houseLine({ free: 1, total: 2, full: false })).toEqual({
      statusKey: 'browser.free',
      count: '1/2',
    });
  });

  it('полный дом — «занято», счёт всё равно показан', () => {
    expect(houseLine({ free: 0, total: 2, full: true })).toEqual({
      statusKey: 'browser.taken',
      count: '0/2',
    });
  });

  it('слово идёт от признака полноты, а не от нуля свободных', () => {
    expect(houseLine({ free: 0, total: 3, full: false }).statusKey).toBe('browser.free');
    expect(houseLine({ free: 2, total: 3, full: true }).statusKey).toBe('browser.taken');
  });

  it('счёт — это свободные из ВСЕХ, а не из занятых', () => {
    expect(houseLine({ free: 3, total: 4, full: false }).count).toBe('3/4');
  });
});
