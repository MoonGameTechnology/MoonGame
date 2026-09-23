import { describe, expect, it } from 'vitest';
import { platformLocale, RU_RESERVE_LANGUAGES } from './platformLocale';

describe('YAG-1.3 — язык площадки → наша локаль', () => {
  it('язык, который у нас есть, берётся как есть', () => {
    expect(platformLocale('ru')).toBe('ru');
    expect(platformLocale('en')).toBe('en');
  });

  it('регистр и региональный хвост не мешают: `RU`, `en-US`, `ru_RU`', () => {
    expect(platformLocale('RU')).toBe('ru');
    expect(platformLocale('en-US')).toBe('en');
    expect(platformLocale('ru_RU')).toBe('ru');
    expect(platformLocale(' en ')).toBe('en');
  });

  it('резерв площадки для be/kk/uk/uz — русский', () => {
    // Страница «Языки и домены»: для этих языков площадка сама подставляет `ru`, если в
    // игре нет их собственного. Играть против её резерва — значит показать игроку не тот
    // язык, который площадка ему пообещала.
    for (const lang of ['be', 'kk', 'uk', 'uz'])
      expect([lang, platformLocale(lang)]).toEqual([lang, 'ru']);
  });

  it('незнакомый язык вне этой четвёрки даёт английский — резерв площадки для всех прочих', () => {
    // `tr` — из рекомендованного площадкой минимума языков для трафика (ru, tr, en), и
    // для него резерв площадки — английский, а не русский.
    for (const lang of ['tr', 'de', 'es', 'ar', 'ja', 'hy']) {
      expect([lang, platformLocale(lang)]).toEqual([lang, 'en']);
    }
  });

  it('список резервных языков ровно тот, что на странице площадки', () => {
    // Порядок не важен, состав — важен: лишний язык молча уведёт игроков в русский.
    expect([...RU_RESERVE_LANGUAGES].sort()).toEqual(['be', 'kk', 'uk', 'uz']);
  });

  it('площадка языка не сообщила — решения нет, остаётся язык браузера', () => {
    // `null`, а не русский: без подсказки площадки лучше уже сделанный выбор по браузеру,
    // чем навязанный сверху. Отличать «не знаю» от «незнакомый язык» обязательно.
    for (const junk of [undefined, null, '', '   ', 42, {}, ['ru'], true]) {
      expect([junk, platformLocale(junk)]).toEqual([junk, null]);
    }
  });

  it('мусор вместо кода языка — тоже «не знаю», а не английский', () => {
    // Строка приезжает из чужого SDK. Английский по мусору перебил бы верный выбор по
    // браузеру у русскоязычного игрока — ровно ту аудиторию, ради которой мы на площадке.
    for (const junk of ['r', 'русский', '12', 'en-', '-en', 'english']) {
      expect([junk, platformLocale(junk)]).toEqual([junk, null]);
    }
  });
});
