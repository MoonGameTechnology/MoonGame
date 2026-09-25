/**
 * Сторож таблицы справочника (`.cx-stats`): число стоит рядом со своей подписью.
 *
 * Строка была флексом `space-between`: подпись у левого края, число у правого. На ПК окно
 * справочника шириной 800px, и между «Корпус» и «60» лежало ~700px пустоты — глаз терял
 * строку (замечание владельца 2026-09-25: «цифры от слов слишком далеко, неудобно
 * считывать»). Теперь таблица — сетка из двух колонок: подписи шириной по самой длинной,
 * значения сразу за ними. Живой вёрстки в vitest нет, поэтому сторож читает CSS, как
 * соседний `touchSurface.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const BUILD = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
/** CSS игры: у админки в том же файле своя страница. */
const GAME_CSS = BUILD.slice(0, BUILD.indexOf('const adminCss'));

/** Тело CSS-правила ровно с этим селектором — с начала строки. */
function rule(selector: string): string {
  const head = `\n${selector}{`;
  const at = GAME_CSS.indexOf(head);
  if (at < 0) return '';
  const start = at + head.length;
  return GAME_CSS.slice(start, GAME_CSS.indexOf('}', start));
}

describe('справочник — число рядом с подписью', () => {
  it('таблица — две колонки: подписи по ширине самой длинной, значения сразу за ними', () => {
    const table = rule('.cx-stats');
    expect(table).toContain('display:grid');
    // `fit-content(60%)` — ширина по самой длинной подписи, но не шире 60%: на узком
    // телефоне длинная подпись переносится, а не выдавливает число за край.
    expect(table).toContain('grid-template-columns:fit-content(60%) 1fr');
  });

  it('строка не растягивает подпись и число по краям окна', () => {
    // Строка отдаёт свои ячейки сетке, иначе колонка подписей у каждой строки своя.
    expect(rule('.cx-stats>.cx-row')).toContain('display:contents');
    expect(GAME_CSS).not.toMatch(/\n\.cx-row\{[^}]*space-between/);
    expect(rule('.cx-stats>.cx-row>.cx-v')).toContain('text-align:left');
  });
});
