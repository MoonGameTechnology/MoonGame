/**
 * RESIL-1 — фоновый промис называет свой исход.
 *
 * Тест держит ровно то, ради чего кирпич и делался: отказ ОБЯЗАН оставить след. До него
 * в браузерном клиенте было 60 мест вида `void f()` — вкладку они не роняли, но и следа
 * не оставляли, поэтому «нажал — ничего не произошло» разбиралось по пустой консоли.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detach } from './detach';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.restoreAllMocks());

describe('RESIL-1 — detach()', () => {
  it('ОТКАЗ НАЗВАН: в консоли имя работы и сама ошибка, а не голый стек', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('сеть отвалилась');
    detach('корпорация: заявка', Promise.reject(err));
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain('корпорация: заявка');
    expect(spy.mock.calls[0]?.[0]).toContain('[detached]'); // тот же префикс, что на сервере
    expect(spy.mock.calls[0]?.[1]).toBe(err); // ошибка целиком, со стеком
  });

  it('УСПЕХ МОЛЧИТ: удавшаяся фоновая работа консоль не засоряет', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    detach('хаб: список партий', Promise.resolve('ok'));
    await flush();
    expect(spy).not.toHaveBeenCalled();
  });

  it('ОТКЛОНЕНИЕ ОБРАБОТАНО, а не просто переброшено дальше', async () => {
    // Смысл обёртки — снять `unhandledrejection`. Если бы `.catch` возвращал
    // отклонённый промис дальше, на сервере это убивало бы процесс.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    detach('арсенал: обновление', Promise.reject(new Error('boom')));
    await flush();
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
