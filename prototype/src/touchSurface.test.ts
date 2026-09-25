/**
 * Сторож поверхности касания и слоёв — статический, как соседние сторожа разметки: он
 * читает `build.mjs` и `main.ts`, потому что живой браузер телефона в vitest не поднять.
 *
 * Держит два требования Яндекс Игр, которые прогон архива нашёл нарушенными:
 *
 * - **п. 1.6.1.8 — долгий тап не выделяет и не открывает контекстное меню.** Меню
 *   гасилось только на ПК (`pcUi()`), а в CSS не было префиксных свойств Safari: на
 *   телефоне долгий тап по картинке (корабль в мастерской, портрет в Академии, кадр
 *   комикса) открывал системное «Скачать изображение».
 * - **п. 1.10.1 — элементы не накладываются так, что страдает кликабельность.** Открытое
 *   меню рельса (z 26) лежало ПОД всплывающими сообщениями (z 40), а те ловят нажатия:
 *   три стартовых сообщения забега закрывали «Дипломатию», «Науку» и «Сводки».
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const BUILD = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
/** CSS игры: у админки в том же файле своя страница со своими `body` и `input`. */
const GAME_CSS = BUILD.slice(0, BUILD.indexOf('const adminCss'));
const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

/** Тело CSS-правила ровно с этим селектором — с начала строки, а не хвостом чужого
 *  (`body{` сидит и внутри `html,body{`). */
function rule(selector: string): string {
  const head = `\n${selector}{`;
  const at = GAME_CSS.indexOf(head);
  if (at < 0) return '';
  const start = at + head.length;
  return GAME_CSS.slice(start, GAME_CSS.indexOf('}', start));
}
const zIndex = (selector: string): number => Number(/z-index:(\d+)/.exec(rule(selector))?.[1]);

describe('п. 1.6.1.8 — долгий тап', () => {
  it('тело страницы не выделяется и не зовёт выноску Safari', () => {
    const body = rule('body');
    expect(body).toContain('user-select:none');
    expect(body).toContain('-webkit-user-select:none');
    expect(body).toContain('-webkit-touch-callout:none');
  });

  it('поля ввода по-прежнему выделяются: вставка текста не ломается', () => {
    const fields = rule('input,textarea');
    expect(fields).toContain('user-select:text');
    expect(fields).toContain('-webkit-user-select:text');
  });

  it('системное меню гасится на ЛЮБОМ устройстве, а не только на ПК', () => {
    const at = MAIN.indexOf("document.addEventListener('contextmenu'");
    expect(at).toBeGreaterThan(0);
    const handler = MAIN.slice(at, MAIN.indexOf('});', at));
    expect(handler).toContain('ev.preventDefault()');
    expect(handler).not.toContain('pcUi()');
  });
});

describe('п. 1.10.1 — открытое меню рельса над всплывающими сообщениями', () => {
  it('меню выше сообщений, но ниже окон, которые оно открывает', () => {
    const open = zIndex('#rail.open');
    expect(open).toBeGreaterThan(zIndex('#toasts'));
    for (const win of ['#missionpanel', '#logwin', '#diplo'])
      expect(open).toBeLessThan(zIndex(win));
  });
});
