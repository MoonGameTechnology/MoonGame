import { describe, expect, it } from 'vitest';
import { nextCycleStep, redialPlan } from './reconnectCycle';
import { RECONNECT_MAX_ATTEMPTS, REAP_WINDOW_MS, reconnectDelayMs } from './reconnect';

describe('очередная попытка переподключения', () => {
  it('ОДНА ПОПЫТКА ЗА РАЗ: к одному обрыву приходит несколько сигналов', () => {
    expect(nextCycleStep({ timerPending: true, attempts: 0 })).toEqual({ kind: 'busy' });
    expect(nextCycleStep({ timerPending: true, attempts: 99 })).toEqual({ kind: 'busy' });
  });

  it('первая попытка ждёт секунду, дальше задержка растёт', () => {
    expect(nextCycleStep({ timerPending: false, attempts: 0 })).toEqual({
      kind: 'wait',
      delayMs: 1_000,
    });
    expect(nextCycleStep({ timerPending: false, attempts: 1 })).toEqual({
      kind: 'wait',
      delayMs: 2_000,
    });
  });

  it('СЧЁТЧИК РАСТЁТ СКВОЗЬ ДОЗВОНЫ: иначе цикл не кончился бы никогда', () => {
    // шаг зависит ТОЛЬКО от числа уже сделанных попыток, а не от того, какой это дозвон
    const шаги = [];
    for (let сделано = 0; сделано <= RECONNECT_MAX_ATTEMPTS; сделано++) {
      шаги.push(nextCycleStep({ timerPending: false, attempts: сделано }));
    }
    expect(шаги.filter((ш) => ш.kind === 'wait')).toHaveLength(RECONNECT_MAX_ATTEMPTS);
    expect(шаги[RECONNECT_MAX_ATTEMPTS]).toEqual({ kind: 'give-up' });
  });

  it('БЮДЖЕТ ЦИКЛА ПЕРЕЖИВАЕТ РЕАП МЕСТА: иначе сдаёмся ровно тогда, когда место освободилось', () => {
    let сумма = 0;
    for (let n = 1; n <= RECONNECT_MAX_ATTEMPTS; n++) сумма += reconnectDelayMs(n) ?? 0;
    expect(сумма).toBeGreaterThan(REAP_WINDOW_MS);
  });

  it('за пределом бюджета шаг всегда «сдаться» — цикл не оживает сам', () => {
    expect(nextCycleStep({ timerPending: false, attempts: RECONNECT_MAX_ATTEMPTS + 5 })).toEqual({
      kind: 'give-up',
    });
  });
});

describe('с чего начинается повторный дозвон', () => {
  it('без аккаунтов — сразу дозвон: опознаёт позывной с билетом места', () => {
    expect(redialPlan(false, false)).toBe('dial');
    expect(redialPlan(false, true)).toBe('dial');
  });

  it('в режиме аккаунтов СНАЧАЛА свежий токен: прежний живёт минуты, цикл — десятки секунд', () => {
    expect(redialPlan(true, true)).toBe('mint-token');
  });

  it('СЕССИИ НЕТ — ЭКРАН ВХОДА, а не новый круг: попытки с мёртвой сессией не кончатся ничем', () => {
    expect(redialPlan(true, false)).toBe('sign-in-again');
  });
});
