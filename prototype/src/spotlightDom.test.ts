/**
 * RESIL-2 — кадр подсветки не уносит с собой цикл.
 *
 * `spotlightDom.ts` — браузерный адаптер, и jsdom в репозитории нет; поэтому политика
 * кадра вынесена из цикла отдельной функцией (`tourFrame`) и проверяется здесь без DOM.
 * Держится ровно то, ради чего кирпич и брали: до него `requestAnimationFrame` стоял
 * ПОСЛЕ падающего `refresh()`, и одно исключение оставляло оверлей висеть на экране
 * навсегда, продолжая глотать нажатия.
 */
import { describe, expect, it, vi } from 'vitest';
import { tourFrame } from './spotlightDom';

describe('RESIL-2 — кадр живой подсветки', () => {
  it('ЦЕЛЫЙ КАДР ПЛАНИРУЕТ СЛЕДУЮЩИЙ: обычный ход цикла не тронут', () => {
    const again = vi.fn();
    const onBroken = vi.fn();
    tourFrame(() => {}, onBroken, again);
    expect(again).toHaveBeenCalledTimes(1);
    expect(onBroken).not.toHaveBeenCalled();
  });

  it('УПАВШИЙ КАДР ЗАКРЫВАЕТ ТУР, А НЕ ЗАМИРАЕТ: экран отпускается', () => {
    const again = vi.fn();
    const onBroken = vi.fn();
    const err = new Error('селектор шага пропал');
    tourFrame(
      () => {
        throw err;
      },
      onBroken,
      again,
    );
    expect(onBroken).toHaveBeenCalledWith(err); // ошибка доезжает целиком, со стеком
    expect(again).not.toHaveBeenCalled(); // и следующий кадр НЕ планируется
  });

  it('ИСКЛЮЧЕНИЕ НАРУЖУ НЕ УХОДИТ: цикл кадров зовёт браузер, ловить его там некому', () => {
    expect(() =>
      tourFrame(
        () => {
          throw new Error('boom');
        },
        () => {},
        () => {},
      ),
    ).not.toThrow();
  });
});
