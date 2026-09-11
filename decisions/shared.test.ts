/**
 * Сторож САМОЙ ПАПКИ, а не отдельного решения.
 *
 * `/decisions` существует ради одного свойства: лежащее здесь видят ОБА клиента —
 * прототип и `packages/client`. Свойство это держится ни на чём, кроме дисциплины:
 * папка собирается обычными относительными импортами, и один импорт из `prototype/`
 * молча превращает общее решение обратно в прототипное. Диагноз из `README.md` —
 * «рефакторинг улучшает ровно тот клиент, который планируется заменить» — описывает
 * именно это: сотня решений уже уехала внутрь прототипа, потому что никто не проверял
 * направление зависимости.
 *
 * Здесь три правила из `README.md` становятся исполняемыми.
 *
 * 1. **Из `/decisions` не импортируют прототип.** Это и есть «общее для обоих»:
 *    стоит появиться такому импорту — и `packages/client`, собирая решение, потянет
 *    за собой `prototype/src`, то есть ровно тот код, от которого уходит. Запрет на
 *    ИМПОРТ, а не на упоминание: тест-фикстура вправе ЧИТАТЬ файл прототипа с диска
 *    (`netClientReuse.test.ts` так сканирует `main.ts`) — это не связь сборки.
 * 2. **Решение чистое.** Ни DOM, ни сети, ни часов, ни случайности. Решение с
 *    `document.` невозможно вызвать из теста без браузера, а с `Date.now()` — нельзя
 *    проверить воспроизводимо; и то и другое выталкивает логику обратно в экран.
 * 3. **У каждого решения есть тест рядом.** Папка оправдана тем, что её содержимое
 *    проверяемо без браузера; модуль без теста этого не подтверждает.
 *
 * Правила проверяются ЧТЕНИЕМ КАТАЛОГА, а не списком имён: список пришлось бы
 * дописывать руками при каждом переезде, и первый же забытый файл сделал бы сторожа
 * декоративным.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));
const sources = files.filter((f) => !f.endsWith('.test.ts'));
const read = (f: string): string => readFileSync(path.join(DIR, f), 'utf8');

/** Спецификаторы всех статических импортов файла (правило 1 — связь СБОРКИ). */
function importSpecifiers(code: string): string[] {
  return [...code.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
}

/**
 * Код без комментариев — правило 2 запрещает ВЫЗОВЫ, а не слова.
 *
 * Без этого сторож ловил бы прозу: `sessionStore.ts` объясняет свой интерфейс фразой
 * «минимум от `localStorage`, который нужен хранилищу», и сам при этом безупречно чист —
 * он принимает `KeyValueStore` и ничего не трогает. Запретить такое упоминание значило
 * бы заставить автора врать в комментарии о том, что модуль на самом деле заменяет.
 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

describe('/decisions — контракт общей папки', () => {
  it('папка не пуста и состоит из пар «решение + тест рядом» (правило 3)', () => {
    expect(sources.length).toBeGreaterThan(0);
    const orphans = sources
      .map((f) => path.basename(f, '.ts'))
      .filter((base) => !files.includes(`${base}.test.ts`));
    expect(orphans, 'решение без теста рядом').toEqual([]);
  });

  it('ничто в /decisions не импортирует прототип (правило 1)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const spec of importSpecifiers(read(f))) {
        if (/(^|\/)prototype\//.test(spec)) offenders.push(`${f} → ${spec}`);
      }
    }
    expect(
      offenders,
      'импорт из prototype/ снова делает решение прототипным — оба клиента его больше не разделяют',
    ).toEqual([]);
  });

  it('решения чистые: ни DOM, ни сети, ни часов, ни случайности (правило 2)', () => {
    // Только ИСХОДНИКИ: тест решения вправе звать что угодно, он и так живёт в Node.
    const banned =
      /\b(document|localStorage|sessionStorage)\b|\bwindow\.|\bfetch\(|\bWebSocket\b|\bDate\.now\(|\bperformance\.now\(|\bMath\.random\(/;
    const offenders = sources.filter((f) => banned.test(stripComments(read(f))));
    expect(offenders, 'решение перестало быть проверяемым без браузера').toEqual([]);
  });
});
