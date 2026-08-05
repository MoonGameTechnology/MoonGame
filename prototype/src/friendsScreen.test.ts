// FRIENDS-1 — сторож вкладки «Друзья».
//
// Держит то, что решает ЭКРАН (а не сервер): порядок строк, честность подписи
// присутствия и набор кнопок у каждого вида ребра. Правила графа проверяет
// `friendService.test.ts` на сервере — здесь их копии нет и быть не должно.
import { describe, expect, it } from 'vitest';
import { friendsPanelHtml, presenceText, sortRows, type FriendRow } from './friendsScreen';

const HOUR = 3_600_000;
const row = (over: Partial<FriendRow> = {}): FriendRow => ({
  accountId: 'a1',
  login: 'Вектор-3',
  kind: 'friend',
  presence: { kind: 'online' },
  ...over,
});

describe('присутствие — подпись не выдумывает того, чего сервер не знает', () => {
  it('в матче показывает день', () => {
    expect(presenceText({ kind: 'match', day: 2 })).toContain('2');
  });

  it('«нет данных» — это НЕ «офлайн»: сервер просто не помнит', () => {
    // Метка присутствия живёт в памяти процесса; после перезапуска она пуста, и
    // сказать «был(а) давно» здесь значило бы соврать про чужой аккаунт.
    const unknown = presenceText({ kind: 'unknown' });
    expect(unknown).not.toBe(presenceText({ kind: 'seen', agoMs: 99 * HOUR }));
    expect(unknown.trim().length).toBeGreaterThan(0);
  });

  it('давность выбирает единицу по величине, а не показывает «0 ч»', () => {
    expect(presenceText({ kind: 'seen', agoMs: 5 * 60_000 })).toContain('5');
    expect(presenceText({ kind: 'seen', agoMs: 3 * HOUR })).toContain('3');
    expect(presenceText({ kind: 'seen', agoMs: 50 * HOUR })).toContain('2');
    // Меньше минуты — всё равно «1», а не ноль.
    expect(presenceText({ kind: 'seen', agoMs: 900 })).toContain('1');
  });
});

describe('порядок списка — сначала то, что требует действия', () => {
  it('входящие заявки идут выше друзей, свои исходящие — ниже всех', () => {
    const out = sortRows([
      row({ login: 'Гадюка-5', kind: 'outgoing', presence: { kind: 'unknown' } }),
      row({ login: 'Вектор-3', kind: 'friend', presence: { kind: 'online' } }),
      row({ login: 'Квазар-7', kind: 'incoming', presence: { kind: 'unknown' } }),
    ]);
    expect(out.map((r) => r.login)).toEqual(['Квазар-7', 'Вектор-3', 'Гадюка-5']);
  });

  it('среди друзей выше те, кто ЖИВЕЕ: в матче → онлайн → давно', () => {
    const out = sortRows([
      row({ login: 'C', presence: { kind: 'seen', agoMs: HOUR } }),
      row({ login: 'A', presence: { kind: 'match', day: 3 } }),
      row({ login: 'B', presence: { kind: 'online' } }),
    ]);
    expect(out.map((r) => r.login)).toEqual(['A', 'B', 'C']);
  });

  it('при равенстве — по позывному, чтобы список не прыгал между перерисовками', () => {
    const out = sortRows([row({ login: 'Я' }), row({ login: 'А' })]);
    expect(out.map((r) => r.login)).toEqual(['А', 'Я']);
  });

  it('не мутирует вход', () => {
    const src = [row({ login: 'B' }), row({ login: 'A' })];
    sortRows(src);
    expect(src.map((r) => r.login)).toEqual(['B', 'A']);
  });
});

describe('разметка — кнопки ровно по виду ребра', () => {
  it('у входящей заявки есть «Принять» и «Отклонить»', () => {
    const html = friendsPanelHtml([row({ kind: 'incoming', login: 'Квазар-7' })]);
    expect(html).toContain('data-fr-act="accept"');
    expect(html).toContain('data-fr-act="drop"');
  });

  it('у друга «Принять» НЕТ — принимать нечего', () => {
    const html = friendsPanelHtml([row({ kind: 'friend' })]);
    expect(html).not.toContain('data-fr-act="accept"');
    expect(html).toContain('data-fr-act="drop"');
  });

  it('у своей исходящей вместо кнопки — состояние «отправлено»', () => {
    const html = friendsPanelHtml([row({ kind: 'outgoing' })]);
    expect(html).not.toContain('data-fr-act="accept"');
    expect(html).toContain('fr-wait');
  });

  it('позывной экранируется — он приходит от ЧУЖОГО аккаунта', () => {
    const html = friendsPanelHtml([row({ login: '<img src=x onerror=alert(1)>' })]);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('гостю показывается причина, а не пустой список', () => {
    const html = friendsPanelHtml([], { signedIn: false });
    expect(html).toContain('hub-empty');
    expect(html).not.toContain('fr-find'); // искать некого — аккаунта нет
  });

  it('у вошедшего с пустым списком есть поиск и подсказка', () => {
    const html = friendsPanelHtml([], { signedIn: true });
    expect(html).toContain('fr-find');
    expect(html).toContain('hub-empty');
  });
});
