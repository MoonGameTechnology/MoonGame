import { describe, expect, it } from 'vitest';
import { isReconnectBanner, welcomePlan, type WelcomeState } from './netWelcome';

const состояние = (over: Partial<WelcomeState> = {}): WelcomeState => ({
  admitted: false,
  reconnecting: false,
  banner: null,
  ...over,
});

describe('приветственный снимок', () => {
  it('ПЕРВЫЙ снимок — это вход: место занято, звучит фанфара', () => {
    expect(welcomePlan(состояние())).toEqual({ admit: true, fanfare: true, banner: null });
  });

  it('ВХОД РОВНО ОДИН РАЗ НА СОКЕТ: иначе игра сбрасывалась бы на каждом снимке', () => {
    expect(welcomePlan(состояние({ admitted: true }))).toEqual({
      admit: false,
      fanfare: false,
      banner: null,
    });
  });

  it('ПЕРЕПОДКЛЮЧЕНИЕ — НЕ НОВЫЙ МАТЧ: место занимаем молча, без фанфары', () => {
    const план = welcomePlan(состояние({ reconnecting: true }));
    expect(план.admit).toBe(true); // вернуться в матч всё равно надо
    expect(план.fanfare).toBe(false);
  });

  it('обычный снимок НЕ трогает баннер — его ведут другие правила', () => {
    expect(welcomePlan(состояние({ admitted: true, banner: '⟳ переподключение…' })).banner).toBe(
      '⟳ переподключение…',
    );
  });
});

describe('баннер снимает тот, кто его поставил', () => {
  it('вход гасит СВОЙ баннер переподключения — иначе он врал бы поверх живой игры', () => {
    expect(welcomePlan(состояние({ reconnecting: true, banner: '⟳ переподключение…' })).banner).toBe(
      null,
    );
  });

  it('ЧУЖОЙ БАННЕР ВХОД НЕ ТРОГАЕТ: о нём он ничего не знает', () => {
    const ждём = '⏳ Ждём, пока хост начнёт…';
    expect(welcomePlan(состояние({ banner: ждём })).banner).toBe(ждём);
  });

  it('метка канала читается только в НАЧАЛЕ строки', () => {
    expect(isReconnectBanner('⟳ переподключение…')).toBe(true);
    expect(isReconnectBanner('связь потеряна ⟳')).toBe(false);
    expect(isReconnectBanner(null)).toBe(false);
    expect(isReconnectBanner('')).toBe(false);
  });
});

describe('исход определён на любом сочетании признаков', () => {
  it('вход случается тогда и только тогда, когда снимок первый', () => {
    for (const admitted of [true, false])
      for (const reconnecting of [true, false])
        for (const banner of [null, '⟳ п…', '⏳ ж…']) {
          const план = welcomePlan({ admitted, reconnecting, banner });
          expect(план.admit).toBe(!admitted);
          expect(план.fanfare && !план.admit).toBe(false); // фанфара — только на входе
          // чужой баннер переживает любой снимок
          if (banner === '⏳ ж…') expect(план.banner).toBe(banner);
        }
  });
});
