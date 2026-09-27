/**
 * Сторож дверей перерисовки (REFM-206) — статический: `main.ts` живёт на DOM.
 *
 * Лист и ряд команд собирают разметку каждый кадр, а DOM перестраивают, только когда она
 * изменилась. Зона, которая поменяла мир, говорит «перерисуй» сбросом кэша, и раньше
 * делала это записью в чужую переменную: 27 копий `lastPanelHtml = ''` и 13 копий
 * `lastCmdHtml = ''`. Теперь это двери `invalidatePanel()` и `invalidateCmdBar()`, а кэш
 * уедет вместе со своей разметкой (REFM-225, REFM-226). Ломается это молча: новая
 * рукописная запись снова привяжет чужую зону к переменной, и переезд разметки упрётся в
 * неё. Компилятор такую запись не остановит, пока кэш живёт в `main.ts`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const body = (name: string): string =>
  new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(SRC)?.[1] ?? '';
const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0;

describe('REFM-206 — перерисовка по имени', () => {
  it('кэш листа сбрасывает только дверь', () => {
    expect(body('invalidatePanel')).toContain("lastPanelHtml = '';");
    // Кроме объявления и двери, переменную не присваивает никто.
    expect(count(SRC, /(?<!let )\blastPanelHtml = /g)).toBe(1);
    // Свои два перехода (лист закрыт — забыть всё; перестроен — запомнить) лист делает сам,
    // внутри `renderPanel`, через `panelCache.ts`.
    const own = /panel: lastPanelHtml\b/g;
    expect(count(body('renderPanel'), own)).toBe(2);
    expect(count(SRC, own)).toBe(2);
  });

  it('кэш ряда команд сбрасывает только дверь, а нарисованное помнит только разметка ряда', () => {
    expect(body('invalidateCmdBar')).toContain("lastCmdHtml = '';");
    expect(count(SRC, /(?<!let )\blastCmdHtml = '';/g)).toBe(1);
    // Полоска «Приказ», мобильная полоска приказа и сам ряд: кэш общий, пишут его только они.
    const drawn = /\blastCmdHtml = html;/g;
    const own = count(body('renderChainBar'), drawn) + count(body('renderCmdBar'), drawn);
    expect(own).toBeGreaterThan(0);
    expect(count(SRC, /(?<!let )\blastCmdHtml = /g)).toBe(1 + own);
  });
});
