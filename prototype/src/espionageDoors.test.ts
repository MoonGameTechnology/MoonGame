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

/** Файлы, где рисуются кнопки шпионажа: карточка мира (`worldCard.ts`, REFM-223) — живого и
 *  памятного — и окно «Шпионаж» (`spyWindow.ts`, заказ владельца 2026-11-10). В окне
 *  дипломатии (`diploWindow.ts`, REFM-214) их больше нет, но новая там обязана спросить
 *  режим. `main.ts` остаётся в списке: новая дверь там тоже обязана спросить режим. */
const FILES = ['main.ts', 'worldCard.ts', 'diploWindow.ts', 'spyWindow.ts'];
const src = Object.fromEntries(
  FILES.map((f) => [f, readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').split('\n')]),
);

/** Строки, где рисуется кнопка шпионажа: «Шпионы» карточки мира и старые приказы. */
const doors = FILES.flatMap((file) =>
  src[file]!.map((line, i) => ({ file, line, i })).filter(
    ({ line }) =>
      /\.push\(spyButtonHtml\(\)\)/.test(line) || line.includes("btn('spyplanet'") || line.includes('class="dp-spy"'),
  ),
);

describe('двери шпионажа спрашивают режим', () => {
  it('кнопок шпионажа несколько — сторожу есть что держать', () => {
    expect(doors.length).toBeGreaterThanOrEqual(2);
  });

  it('каждую кнопку рисует ветка под espionageShown (или флагом вкладки из него)', () => {
    const unguarded = doors
      .filter(({ file, i }) => {
        return !src[file]!.slice(Math.max(0, i - 25), i + 1)
          .join('\n')
          .includes('espionageShown(');
      })
      .map(({ file, i, line }) => `${file}:${i + 1}: ${line.trim().slice(0, 60)}`);
    expect(unguarded).toEqual([]);
  });

  it('окно «Шпионаж» и его кнопка в меню закрыты в экспедиции', () => {
    const win = src['spyWindow.ts']!.join('\n');
    expect(win).toContain("if (!espionageShown(game.sectorZeroToolsHidden())) return;");
    expect(win).toContain("if (!espionageShown(game.sectorZeroToolsHidden())) return closeSpyWindow();");
  });
});
