/**
 * Главный экран хаба (UIX-10.1) — статический сторож разметки и проводки. Хаб рисуют
 * `build.mjs` и `main.ts`, а смоуки ходят по нему кнопками, не глядя ни на порядок, ни на
 * подписи. Держит то, что UIX-10.1 обещал игроку: одна дверь над режимами, режимы списком
 * со строкой отличия, пять вкладок, рейтинг и друзья в «Ещё». Какая дверь видна — решение
 * `decisions/hubDoor.ts` со своим тестом.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { en } from '../../localization/en';
import { ru } from '../../localization/ru';

const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const BUILD = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
const between = (from: string, to: string): string => {
  const start = BUILD.indexOf(from);
  return BUILD.slice(start, BUILD.indexOf(to, start));
};
const HOME = between('<div class="hub-panel" id="hp-home">', '<div class="hub-panel" id="hp-meta"');
const MORE = between('<div class="hub-panel" id="hp-more"', '<div class="hub-note"');
const NAV = between('<nav class="hub-nav">', '</nav>');

describe('главный экран хаба (UIX-10.1)', () => {
  it('дверь стоит над режимами: «Продолжить», за ней обучение, потом список', () => {
    const cont = HOME.indexOf('<button id="hub-solo-continue" class="hub-door"');
    const tutor = HOME.indexOf('<button id="ob-start" class="hub-door"');
    const modes = HOME.indexOf('data-i18n="hub.modes"');
    expect(cont).toBeGreaterThan(-1);
    expect(tutor).toBeGreaterThan(cont);
    expect(modes).toBeGreaterThan(tutor);
  });

  it('режимы списком: название и строка, чем режим отличается', () => {
    const modes = [
      ...HOME.matchAll(
        /<button id="([\w-]+)" class="hub-mode" type="button"><b data-i18n="([\w.-]+)"><\/b><span data-i18n="([\w.-]+)"><\/span><\/button>/g,
      ),
    ];
    expect(modes.map((m) => m[1])).toEqual(['hub-solo', 'hub-play', 'hub-sector-zero', 'hub-proving-ground']);
    for (const [, , name, desc] of modes) {
      for (const loc of [ru, en]) {
        expect(loc[desc!], desc).toBeTruthy();
        expect(loc[desc!]).not.toBe(loc[name!]);
      }
    }
    // Капс «ИГРАТЬ СЕЙЧАС» ушёл вместе с прежней главной кнопкой.
    expect(ru['hub.play']).toBe('Игра по сети');
  });

  it('пять вкладок: Домой, Игры, Арсенал, Альянсы, Ещё', () => {
    expect([...NAV.matchAll(/data-hub="(\w+)"/g)].map((m) => m[1])).toEqual([
      'home',
      'games',
      'arsenal',
      'ally',
      'more',
    ]);
  });

  it('рейтинг и друзья — плитки «Ещё»; пока открыты они, подсвечена «Ещё»', () => {
    expect(MORE).toContain('id="hub-rank"');
    expect(MORE).toContain('id="hub-friends"');
    expect(MAIN).toContain(
      "document.getElementById('hub-rank')?.addEventListener('click', () => hubTab('rank'));",
    );
    expect(MAIN).toContain(
      "document.getElementById('hub-friends')?.addEventListener('click', () => hubTab('friends'));",
    );
    expect(MAIN).toContain("new Set(['meta', 'auction', 'rank', 'friends'])");
    expect(MAIN).toContain("const navTab = HUB_UNDER_MORE.has(tab) ? 'more' : tab;");
  });

  it('«Продолжить» называет партию: режим, карта и день', () => {
    expect(MAIN).toContain(
      "t('solo.save.continue.sub', { map: mapLabel(door.mapId), day: gameDay(door.time) })",
    );
    expect(ru['solo.save.continue.sub']).toBe('Одиночная игра · {map} · день {day}');
    expect(en['solo.save.continue.sub']).toBe('Solo game · {map} · day {day}');
    // «Нексус» — именем, а не id карты, как и Фронтир.
    expect(MAIN).toContain("mapId === 'nexus' ? t('map.nexus')");
  });

  it('пустые «Мои партии» — строка и «Начать партию» в обозреватель', () => {
    expect(MAIN).toContain('<button type="button" class="hm-go">${t(\'hub.mine.start\')}</button>');
    expect(MAIN).toContain("el.querySelector('.hm-go')?.addEventListener('click', () => hubTab('games'));");
  });

  it('игра не пошаговая: сводка хаба ждёт «события», а не «ходы»', () => {
    expect(ru['hub.digest.empty.sub']).toContain('события');
    expect(ru['hub.digest.empty.sub']).not.toContain('ходы');
    expect(en['hub.digest.empty.sub']).toContain('events');
    expect(en['hub.digest.empty.sub']).not.toContain('moves');
  });
});
