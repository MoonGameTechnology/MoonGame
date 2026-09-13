import { describe, expect, it } from 'vitest';
import { closeAction, isCurrentSocket, type CloseState } from './socketFate';

const состояние = (over: Partial<CloseState> = {}): CloseState => ({
  current: true,
  inMatch: false,
  userClosed: false,
  reconnecting: false,
  admitted: false,
  ...over,
});

describe('чей сокет', () => {
  it('НАШ ТОЛЬКО ТЕКУЩИЙ: устаревший не трогает общее состояние', () => {
    const a = {};
    const b = {};
    expect(isCurrentSocket(a, a)).toBe(true);
    expect(isCurrentSocket(a, b)).toBe(false);
    expect(isCurrentSocket(a, null)).toBe(false);
  });
});

describe('что значит закрытие сокета', () => {
  it('УСТАРЕВШИЙ ИГНОРИРУЕТСЯ ВСЕГДА: иначе он погасит таймеры живой сессии', () => {
    // даже если по остальным признакам это выглядит как обрыв в матче
    expect(closeAction(состояние({ current: false, inMatch: true }))).toBe('ignore');
    expect(closeAction(состояние({ current: false, reconnecting: true }))).toBe('ignore');
  });

  it('игрок вышел сам — говорим об этом и показываем экран подключения', () => {
    expect(closeAction(состояние({ inMatch: true, userClosed: true, admitted: true }))).toBe(
      'closed-by-user',
    );
  });

  it('ОБРЫВ В МАТЧЕ — МОЛЧА ПЕРЕПОДКЛЮЧАЕМСЯ: матч на сервере продолжается без нас', () => {
    expect(closeAction(состояние({ inMatch: true, admitted: true }))).toBe('reconnect');
  });

  it('ВЫХОД И ОБРЫВ ПУТАТЬ НЕЛЬЗЯ: одно тихо возвращает в матч, другое отпускает игрока', () => {
    const обрыв = closeAction(состояние({ inMatch: true }));
    const выход = closeAction(состояние({ inMatch: true, userClosed: true }));
    expect(обрыв).not.toBe(выход);
  });

  it('попытка переподключения не дошла до входа — отступаем и повторяем', () => {
    expect(closeAction(состояние({ reconnecting: true, admitted: false }))).toBe('retry-admit');
  });

  it('переподключение УСПЕЛО впустить — повторять нечего', () => {
    expect(closeAction(состояние({ reconnecting: true, admitted: true }))).toBe('keep-reason');
  });

  it('ОТКАЗ ВО ВХОДЕ НЕ СТИРАЕТ ПРИЧИНУ: ответ сервера остаётся в строке статуса', () => {
    expect(closeAction(состояние())).toBe('keep-reason');
  });

  it('исход всегда один из пяти, на любом сочетании признаков', () => {
    const исходы = new Set<string>();
    for (const current of [true, false])
      for (const inMatch of [true, false])
        for (const userClosed of [true, false])
          for (const reconnecting of [true, false])
            for (const admitted of [true, false])
              исходы.add(closeAction({ current, inMatch, userClosed, reconnecting, admitted }));
    expect([...исходы].sort()).toEqual([
      'closed-by-user',
      'ignore',
      'keep-reason',
      'reconnect',
      'retry-admit',
    ]);
  });
});
