import { describe, expect, it } from 'vitest';
import { orderPlan } from './orderRoute';

const соло = { net: false, hasClient: false, reconnecting: false };
const сеть = { net: true, hasClient: true, reconnecting: false };
const обрыв = { net: false, hasClient: true, reconnecting: true };

describe('куда уходит приказ игрока', () => {
  it('В СЕТИ — НАМЕРЕНИЕ СЕРВЕРУ: локальный редьюсер не трогаем, решает сервер', () => {
    expect(orderPlan(сеть).route).toBe('send');
  });

  it('СВЯЗЬ ОБОРВАНА, КЛИЕНТ ЖИВ — В ОЧЕРЕДЬ: он досылает её сам на реконнектном welcome', () => {
    expect(orderPlan(обрыв).route).toBe('queue');
  });

  it('СВЯЗЬ ОБОРВАНА И КЛИЕНТА НЕТ — ОТКАЗ: очередить некуда, приказ не уйдёт никогда', () => {
    expect(orderPlan({ net: false, hasClient: false, reconnecting: true }).route).toBe('refuse');
  });

  it('соло — локальный редьюсер и есть истина', () => {
    expect(orderPlan(соло).route).toBe('local');
  });

  it('сетевой матч без живого транспорта, но и без цикла переподключения — локально', () => {
    // граница, унаследованная от прежнего кода: отправить нечем, отказывать не за что
    expect(orderPlan({ net: true, hasClient: false, reconnecting: false }).route).toBe('local');
  });

  it('живой транспорт побеждает флаг переподключения: слать можно — значит слать', () => {
    expect(orderPlan({ net: true, hasClient: true, reconnecting: true }).route).toBe('send');
  });
});

describe('чему учится обучение', () => {
  it('В СЕТИ — НА НАМЕРЕНИИ: ждать ответа сервера значит вешать шаг тура на задержку', () => {
    expect(orderPlan(сеть).tour).toBe('now');
  });

  it('в соло — только на ПРИНЯТОМ приказе: отвергнутый шаг не двигает', () => {
    expect(orderPlan(соло).tour).toBe('on-accept');
  });

  it('ОЧЕРЕДЬ УЧИТ КАК ОТПРАВКА: намерение выражено, доставка — вопрос времени', () => {
    expect(orderPlan(обрыв).tour).toBe('now');
  });

  it('ОТКАЗ НЕ УЧИТ НИЧЕМУ: приказ не ушёл никуда', () => {
    expect(orderPlan({ net: false, hasClient: false, reconnecting: true }).tour).toBe('never');
  });
});
