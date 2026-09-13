import { describe, expect, it } from 'vitest';
import { clearStatusLine, fallbackFor, showServerRow } from './browserFallback';

const dev = { playerBuild: false };
const игрок = { playerBuild: true };

describe('что вместо списка матчей', () => {
  it('список пришёл и в нём есть строки — рисуем список', () => {
    expect(fallbackFor({ loaded: true, failed: false, rows: 3, ...dev })).toEqual({ kind: 'list' });
  });

  it('НИКОГДА НЕ ТУПИК: нет списка — на экране всегда путь без сервера, в обеих сборках', () => {
    for (const сборка of [dev, игрок])
      for (const st of [
        { loaded: false, failed: true, rows: 0 },
        { loaded: false, failed: false, rows: 0 },
        { loaded: true, failed: false, rows: 0 },
      ]) {
        expect(fallbackFor({ ...st, ...сборка }).kind).toBe('empty');
      }
  });

  it('«СЕРВЕР НЕ ОТВЕТИЛ» И «ЕЩЁ НЕ СПРАШИВАЛИ» — РАЗНЫЕ сообщения', () => {
    const упал = fallbackFor({ loaded: false, failed: true, rows: 0, ...dev });
    const небыло = fallbackFor({ loaded: false, failed: false, rows: 0, ...dev });
    expect(упал).toMatchObject({ message: 'acc.server-down' });
    expect(небыло).toMatchObject({ message: 'browser.refresh-hint' });
    expect(упал).not.toEqual(небыло);
  });

  it('в сборке игрока у тех же двух бед свои тексты', () => {
    expect(fallbackFor({ loaded: false, failed: true, rows: 0, ...игрок })).toMatchObject({
      message: 'browser.server-down',
    });
    expect(fallbackFor({ loaded: false, failed: false, rows: 0, ...игрок })).toMatchObject({
      message: 'browser.loading',
    });
  });

  it('ответ пришёл, но матчей нет — это третья, отдельная причина', () => {
    expect(fallbackFor({ loaded: true, failed: false, rows: 0, ...dev })).toMatchObject({
      message: 'browser.empty',
    });
  });
});

describe('строка адреса сервера и строка статуса', () => {
  it('адрес спрашивают, ПОКА список не загрузился, и только в сборке игрока', () => {
    expect(showServerRow(true, false)).toBe(true);
    expect(showServerRow(true, true)).toBe(false);
    expect(showServerRow(false, false)).toBe(false);
  });

  it('ОДНО СООБЩЕНИЕ ОБ ОДНОЙ БЕДЕ: дубль под списком гасит строку статуса', () => {
    expect(clearStatusLine(true, true)).toBe(true);
    expect(clearStatusLine(true, false)).toBe(false);
    expect(clearStatusLine(false, true)).toBe(false); // в dev строка статуса своя
  });
});

describe('фильтр спрятал всё (BRW-3)', () => {
  const скрыто = { loaded: true, failed: false, rows: 0, hiddenByFilter: 4 };

  it('«НИЧЕГО НЕ НАЙДЕНО» — ЭТО НЕ «СЕРВЕР ПУСТ»: разные сообщения', () => {
    expect(fallbackFor({ loaded: true, failed: false, rows: 0, ...dev })).toEqual({
      kind: 'empty',
      message: 'browser.empty',
    });
    expect(fallbackFor({ ...скрыто, ...dev })).toEqual({
      kind: 'filtered',
      message: 'browser.filter.none',
    });
  });

  it('СОЛО НЕ ПРЕДЛАГАЕТСЯ: список есть, игрок сам его сузил — это не тупик', () => {
    for (const сборка of [dev, игрок]) {
      expect(fallbackFor({ ...скрыто, ...сборка }).kind).toBe('filtered');
    }
  });

  it('строки после фильтра есть — рисуем список, сколько бы ни было скрыто', () => {
    expect(fallbackFor({ loaded: true, failed: false, rows: 2, hiddenByFilter: 9, ...dev })).toEqual({
      kind: 'list',
    });
  });

  it('СЕРВЕР МОЛЧИТ — ЭТО ВАЖНЕЕ ФИЛЬТРА: беда связи не подменяется «ничего не найдено»', () => {
    expect(fallbackFor({ loaded: false, failed: true, rows: 0, hiddenByFilter: 4, ...dev }).kind).toBe(
      'empty',
    );
  });

  it('старый вызов без поля работает по-прежнему (мягкая деградация)', () => {
    expect(fallbackFor({ loaded: true, failed: false, rows: 0, ...dev })).toEqual({
      kind: 'empty',
      message: 'browser.empty',
    });
  });
});
