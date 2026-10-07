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

/** Файлы, где рисуются кнопки шпионажа: карточка мира в `main.ts`, ростер, карточка места
 *  и вкладка «Шпионаж» — в окне дипломатии (`diploWindow.ts`, REFM-214). */
const FILES = ['main.ts', 'diploWindow.ts'];
const src = Object.fromEntries(
  FILES.map((f) => [f, readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').split('\n')]),
);

/** Строки, где рисуется кнопка шпионажа: разведка мира и операции ростера. */
const doors = FILES.flatMap((file) =>
  src[file]!.map((line, i) => ({ file, line, i })).filter(
    ({ line }) => line.includes("btn('spyplanet'") || line.includes('class="dp-spy"'),
  ),
);

/** Имя функции верхнего уровня, внутри которой стоит строка `i` файла `file`. */
function enclosingFunction(file: string, i: number): string | null {
  const lines = src[file]!;
  for (let k = i; k >= 0; k--) {
    const m = /^(?:export )?function (\w+)/.exec(lines[k]!);
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
      .filter(({ file, i }) => {
        // Вкладка «Шпионаж» (`intelTabHtml`) рисуется, только когда есть её кнопка (`spyTab`).
        if (enclosingFunction(file, i) === 'intelTabHtml') return false;
        return !src[file]!.slice(Math.max(0, i - 25), i + 1)
          .join('\n')
          .includes('espionageShown(');
      })
      .map(({ file, i, line }) => `${file}:${i + 1}: ${line.trim().slice(0, 60)}`);
    expect(unguarded).toEqual([]);
  });

  it('вкладка «Шпионаж» закрыта в экспедиции', () => {
    const win = src['diploWindow.ts']!.join('\n');
    expect(win).toContain("if (!spyTab && diploTab === 'intel') diploTab = 'diplo';");
    expect(win).toContain("${spyTab ? tabBtn('intel'");
  });
});
