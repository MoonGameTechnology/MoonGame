import { describe, expect, it } from 'vitest';
import { WAIT_MARK, radarContacts, waitingBanner } from './snapshotIngest';

describe('радар-контакты', () => {
  it('КОНТАКТЫ ЖИВУТ ОДИН СНИМОК: нет списка — он пуст, а не «прежний»', () => {
    expect(radarContacts(undefined)).toEqual([]);
  });

  it('присланный список берётся как есть', () => {
    const список = [{ node: 'n1' }, { node: 'n2' }];
    expect(radarContacts(список)).toBe(список);
  });

  it('пустой список от сервера — это «контактов нет», а не «нечего обновлять»', () => {
    expect(radarContacts([])).toEqual([]);
  });
});

describe('баннер ожидания', () => {
  it('сервер ждёт — баннер показан', () => {
    expect(waitingBanner(true, null)).toBe('show');
    expect(waitingBanner(true, WAIT_MARK + ' ждём')).toBe('show');
  });

  it('ждать больше нечего — свой баннер снимается', () => {
    expect(waitingBanner(false, WAIT_MARK + ' ждём')).toBe('clear');
  });

  it('СНИМАЕТ ТОЛЬКО СВОЙ: чужое сообщение снимок не трогает', () => {
    expect(waitingBanner(false, '⟳ переподключение')).toBe('keep');
    expect(waitingBanner(false, 'победа')).toBe('keep');
    expect(waitingBanner(false, null)).toBe('keep');
  });
});
