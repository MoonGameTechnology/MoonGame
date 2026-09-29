/**
 * ШПИОНАЖ — ТОЛЬКО В ОСНОВНОЙ ИГРЕ (заказ владельца 2026-09-25, повторён 2026-09-29).
 *
 * Правило живёт в `decisions/sectorZeroTools.ts` (`espionageShown`), но дверей у шпионажа
 * несколько, и каждую хост рисует сам. Одна из них — кнопка разведки на карточке мира,
 * который игрок помнит, но не видит, — правило не спрашивала, и шпионаж всплывал в
 * экспедиции. Сторож держит все двери разом: новая кнопка без проверки роняет гейт.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8').split('\n');

/** Строки, где рисуется кнопка шпионажа: разведка мира и операции ростера. */
const doors = main
  .map((line, i) => ({ line, i }))
  .filter(({ line }) => line.includes("btn('spyplanet'") || line.includes('class="dp-spy"'));

/** Имя функции верхнего уровня, внутри которой стоит строка `i`. */
function enclosingFunction(i: number): string | null {
  for (let k = i; k >= 0; k--) {
    const m = /^function (\w+)/.exec(main[k]!);
    if (m) return m[1]!;
  }
  return null;
}

describe('двери шпионажа спрашивают режим', () => {
  it('кнопок шпионажа несколько — сторожу есть что держать', () => {
    expect(doors.length).toBeGreaterThanOrEqual(4);
  });

  it('каждую кнопку рисует ветка под espionageShown (или флагом вкладки из него)', () => {
    const unguarded = doors
      .filter(({ i }) => {
        // Вкладка «Шпионаж» (`intelTabHtml`) рисуется, только когда есть её кнопка (`spyTab`).
        if (enclosingFunction(i) === 'intelTabHtml') return false;
        return !main.slice(Math.max(0, i - 25), i + 1).join('\n').includes('espionageShown(');
      })
      .map(({ i, line }) => `main.ts:${i + 1}: ${line.trim().slice(0, 60)}`);
    expect(unguarded).toEqual([]);
  });

  it('вкладка «Шпионаж» закрыта в экспедиции', () => {
    const src = main.join('\n');
    expect(src).toContain("if (!spyTab && diploTab === 'intel') diploTab = 'diplo';");
    expect(src).toContain("${spyTab ? tabBtn('intel'");
  });
});
