import { describe, expect, it, vi } from 'vitest';
import {
  WAIT_MARK,
  desyncVerdict,
  keepFocus,
  keepGroup,
  radarContacts,
  waitingBanner,
} from './snapshotIngest';

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

describe('проверка расхождения с сервером', () => {
  it('НЕТ ХЕША — НЕТ ВЕРДИКТА, и свой считать незачем', () => {
    const наш = vi.fn(() => 'h1');
    expect(desyncVerdict(undefined, наш)).toBeNull();
    expect(наш).not.toHaveBeenCalled();
  });

  it('хеши сошлись — расхождения нет', () => {
    expect(desyncVerdict('h1', () => 'h1')).toBe(false);
  });

  it('хеши разошлись — это десинк', () => {
    expect(desyncVerdict('h1', () => 'h2')).toBe(true);
  });
});

describe('чистка выбора после снимка', () => {
  it('одиночный выбор держится, пока объект в снимке есть', () => {
    expect(keepFocus('f1', true)).toBe('f1');
    expect(keepFocus('f1', false)).toBeNull();
    expect(keepFocus(null, true)).toBeNull();
  });

  it('ОДИНОЧНЫЙ ВЫБОР ЖИВЁТ И НА ЧУЖОМ ФЛОТЕ: карточка противника — это не приказ', () => {
    // владелец здесь вообще не спрашивается — важно только, есть ли объект в снимке
    expect(keepFocus('враг', true)).toBe('враг');
  });

  it('ГРУППОВОЙ ВЫБОР — ТОЛЬКО СВОИ: приказ чужому флоту отдать нельзя', () => {
    const владелец = (id: string) => ({ мой: 'p1', чужой: 'p2' })[id];
    expect(keepGroup(['мой', 'чужой'], владелец, 'p1')).toEqual(['мой']);
  });

  it('групповой выбор теряет исчезнувших из снимка', () => {
    const владелец = (id: string) => (id === 'живой' ? 'p1' : undefined);
    expect(keepGroup(['живой', 'пропал'], владелец, 'p1')).toEqual(['живой']);
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
