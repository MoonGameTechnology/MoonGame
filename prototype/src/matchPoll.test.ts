import { describe, expect, it } from 'vitest';
import { pollLine, pollTick } from './matchPoll';

describe('когда тикает фоновый переопрос списка', () => {
  it('СПИСОК НА ЭКРАНЕ: переспрашиваем', () => {
    expect(pollTick({ overlay: true, browser: true })).toBe('poll');
  });

  it('оверлей закрыт (игрок в матче) — молчим: результат ушёл бы в чужую строку статуса', () => {
    expect(pollTick({ overlay: false, browser: true })).toBe('skip');
  });

  it('приветственный шаг — молчим: списка ещё никто не просил', () => {
    expect(pollTick({ overlay: true, browser: false })).toBe('skip');
  });

  it('ни того, ни другого — тем более молчим', () => {
    expect(pollTick({ overlay: false, browser: false })).toBe('skip');
  });
});

describe('что переопрос пишет в строку статуса', () => {
  it('ТИХИЙ НЕ МИГАЕТ: над показанным списком «загрузка» не появляется', () => {
    expect(pollLine('start', true)).toEqual({ kind: 'keep' });
  });

  it('явное обновление — наоборот, показывает «загрузка»', () => {
    expect(pollLine('start', false)).toEqual({ kind: 'text', key: 'browser.loading' });
  });

  it('О БЕДЕ ГОВОРЯТ ОБА: иначе устаревший список выглядит живым', () => {
    const беда = { kind: 'text', key: 'acc.server-down' };
    expect(pollLine('failed', true)).toEqual(беда);
    expect(pollLine('failed', false)).toEqual(беда);
  });

  it('удача гасит строку — иначе заглушка «сервер не ответил» осталась бы над живыми матчами', () => {
    expect(pollLine('loaded', true)).toEqual({ kind: 'clear' });
    expect(pollLine('loaded', false)).toEqual({ kind: 'clear' });
  });

  it('строку трогает только «тихий старт» — остальное всегда одинаково', () => {
    expect(pollLine('start', true).kind).toBe('keep');
    for (const quiet of [true, false]) {
      expect(pollLine('loaded', quiet).kind).not.toBe('keep');
      expect(pollLine('failed', quiet).kind).not.toBe('keep');
    }
  });
});
