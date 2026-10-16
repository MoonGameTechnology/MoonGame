import { describe, expect, it } from 'vitest';
import { fallbackFor, showServerRow, type BrowserTab } from './browserFallback';

const TABS: BrowserTab[] = ['available', 'active', 'archived'];
const на = (tab: BrowserTab) => ({ tab });

describe('что вместо списка матчей', () => {
  it('список пришёл и в нём есть строки — рисуем список', () => {
    for (const tab of TABS)
      expect(fallbackFor({ loaded: true, failed: false, rows: 3, ...на(tab) })).toEqual({
        kind: 'list',
      });
  });

  it('НИКОГДА НЕ ТУПИК: сервер не ответил или открытых матчей нет — путь в одиночную игру', () => {
    for (const tab of TABS)
      expect(fallbackFor({ loaded: false, failed: true, rows: 0, ...на(tab) })).toMatchObject({
        next: 'solo',
      });
    expect(fallbackFor({ loaded: true, failed: false, rows: 0, ...на('available') })).toEqual({
      kind: 'empty',
      message: 'browser.empty.available',
      next: 'solo',
    });
  });

  it('пустые «Мои» зовут на «Доступные», пустому архиву звать некуда', () => {
    expect(fallbackFor({ loaded: true, failed: false, rows: 0, ...на('active') })).toEqual({
      kind: 'empty',
      message: 'browser.empty.active',
      next: 'available',
    });
    expect(fallbackFor({ loaded: true, failed: false, rows: 0, ...на('archived') })).toEqual({
      kind: 'empty',
      message: 'browser.empty.archived',
      next: null,
    });
  });

  it('ПОКА СПИСОК ГРУЗИТСЯ, ПУТЕЙ НЕ ПРЕДЛАГАЮТ: кнопка мигнула бы перед списком', () => {
    expect(fallbackFor({ loaded: false, failed: false, rows: 0, ...на('available') })).toEqual({
      kind: 'empty',
      message: 'browser.loading',
      next: null,
    });
  });

  it('«СЕРВЕР НЕ ОТВЕТИЛ» И «ЕЩЁ НЕ СПРАШИВАЛИ» — РАЗНЫЕ сообщения', () => {
    const упал = fallbackFor({ loaded: false, failed: true, rows: 0, ...на('available') });
    const небыло = fallbackFor({ loaded: false, failed: false, rows: 0, ...на('available') });
    expect(упал).toMatchObject({ message: 'browser.server-down' });
    expect(небыло).toMatchObject({ message: 'browser.loading' });
  });
});

describe('карточка «Сервер не отвечает»', () => {
  it('АДРЕС ВИДЕН РОВНО ТОГДА, КОГДА СЕРВЕР НЕ ОТВЕТИЛ: не во время загрузки и не над списком', () => {
    expect(showServerRow({ loaded: false, failed: true })).toBe(true);
    expect(showServerRow({ loaded: false, failed: false })).toBe(false);
    // Старый список в памяти, а строку «сервер недоступен» написал сетевой цикл: список
    // остаётся на экране, карточки над ним нет — строка статуса и говорит о беде.
    expect(showServerRow({ loaded: true, failed: true })).toBe(false);
    expect(showServerRow({ loaded: true, failed: false })).toBe(false);
  });
});

describe('фильтр спрятал всё (BRW-3)', () => {
  const скрыто = { loaded: true, failed: false, rows: 0, hiddenByFilter: 4, ...на('available') };

  it('«НИЧЕГО НЕ НАЙДЕНО» — ЭТО НЕ «СЕРВЕР ПУСТ»: разные сообщения, без одиночной игры', () => {
    expect(fallbackFor(скрыто)).toEqual({ kind: 'filtered', message: 'browser.filter.none' });
    expect(fallbackFor({ ...скрыто, hiddenByFilter: 0 })).toMatchObject({
      message: 'browser.empty.available',
    });
  });

  it('строки после фильтра есть — рисуем список, сколько бы ни было скрыто', () => {
    expect(fallbackFor({ ...скрыто, rows: 2, hiddenByFilter: 9 })).toEqual({ kind: 'list' });
  });

  it('СЕРВЕР МОЛЧИТ — ЭТО ВАЖНЕЕ ФИЛЬТРА: беда связи не подменяется «ничего не найдено»', () => {
    expect(fallbackFor({ ...скрыто, loaded: false, failed: true })).toMatchObject({
      message: 'browser.server-down',
    });
  });

  it('вызов без поля фильтра — пустая вкладка, а не «ничего не найдено»', () => {
    expect(fallbackFor({ loaded: true, failed: false, rows: 0, ...на('available') }).kind).toBe(
      'empty',
    );
  });
});
