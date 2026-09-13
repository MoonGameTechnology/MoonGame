import { describe, expect, it } from 'vitest';
import { errorTarget, refusalKey } from './errorRoute';

describe('куда попадает отказ сервера', () => {
  it('ОТКАЗ УСТАРЕВШЕГО СОКЕТА — НЕ НАШ: он перетёр бы статус живой сессии', () => {
    expect(errorTarget({ current: false, admitted: true, code: 'E_CHAT_FLOOD' })).toBe('ignore');
    expect(errorTarget({ current: false, admitted: false, code: 'E_MATCH_FULL' })).toBe('ignore');
  });

  it('ПОСЛЕ ВХОДА — ТОСТОМ: экран подключения скрыт, его строку никто не прочитает', () => {
    expect(errorTarget({ current: true, admitted: true, code: 'E_CHAT_FLOOD' })).toBe('toast');
    expect(errorTarget({ current: true, admitted: true, code: 'E_CHAT_TARGET' })).toBe('toast');
  });

  it('ДО ВХОДА — В СТРОКУ ЭКРАНА ПОДКЛЮЧЕНИЯ: там игрок и ждёт ответа', () => {
    expect(errorTarget({ current: true, admitted: false, code: 'E_MATCH_FULL' })).toBe('status');
    expect(errorTarget({ current: true, admitted: false, code: 'E_CHAT_FLOOD' })).toBe('status');
  });
});

describe('причина отказа словами', () => {
  it('у отказов входа есть человеческая причина, а не код', () => {
    expect(refusalKey('E_SLOT_TAKEN')).toBe('net.slot-taken');
    expect(refusalKey('E_UNKNOWN_PLAYER')).toBe('net.no-seat');
    expect(refusalKey('E_MATCH_FULL')).toBe('net.match-full');
    expect(refusalKey('E_ENTRY_CLOSED')).toBe('net.join-closed');
  });

  it('незнакомый код причины не выдумывает — вызывающий покажет сам код', () => {
    expect(refusalKey('E_WHATEVER')).toBeNull();
    expect(refusalKey('')).toBeNull();
  });
});
