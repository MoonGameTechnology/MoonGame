import { describe, expect, it } from 'vitest';
import { orderPlan } from './orderRoute';

const соло = { net: false, hasClient: false, reconnecting: false };
const сеть = { net: true, hasClient: true, reconnecting: false };
const обрыв = { net: false, hasClient: true, reconnecting: true };

describe('куда уходит приказ игрока', () => {
  it('В СЕТИ — НАМЕРЕНИЕ СЕРВЕРУ: локальный редьюсер не трогаем, решает сервер', () => {
    expect(orderPlan(сеть).route).toBe('send');
  });

  it('СВЯЗЬ ОБОРВАНА — ОТКАЗ: локально применённый приказ исчез бы на первом welcome', () => {
    expect(orderPlan(обрыв).route).toBe('refuse');
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

  it('ОТКАЗ НЕ УЧИТ НИЧЕМУ: приказ не ушёл никуда', () => {
    expect(orderPlan(обрыв).tour).toBe('never');
  });
});
