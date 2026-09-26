import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * РЕЕСТР ДОВЕРИЯ ↔ ГРАФ ЗАВИСИМОСТЕЙ. Таблица «просканировано/НЕ подтверждён» строится
 * из реестра `EXPECTED` в `summarize-security.mjs`, а собирает её джоба `report` — и
 * забирает артефакты БЕЗ `name`, то есть только те, что успели загрузиться к её старту.
 * Значит джоба, которой нет в `needs`, гонку проигрывает молча: сканер отработал
 * начисто, сентинел опоздал, в отчёте — «⚠️ НЕ подтверждён».
 *
 * Это хуже обычного ложного сигнала: обесценивается ровно тот столбец, ради которого
 * таблица и заведена (отличить «сканер чист» от «сканер не запускался»). Правило до сих
 * пор держал комментарий в `security.yml` — и был нарушен трижды: `kics` (#471),
 * `dependency-review` (#473), `trivy-caddy` (найден в живом прогоне PR #1003). Три
 * повтора — это не невнимательность, а незакрытое правило, поэтому оно здесь
 * исполняемое.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = readFileSync(join(root, '.github/workflows/security.yml'), 'utf8');
const summarizer = readFileSync(join(root, '.github/scripts/summarize-security.mjs'), 'utf8');

/** Ключи реестра доверия — ровно то, что таблица обязана подтвердить. */
const expectedKeys = () => [...summarizer.matchAll(/^\s*\{?\s*key: '([a-z0-9-]+)'/gm)].map((m) => m[1]);

/** Идентификаторы джоб: записи первого уровня ПОСЛЕ `jobs:` (до него на той же
 *  глубине лежат ключи `on:` — `push`, `schedule`, — и они джобами не являются). */
const jobIds = () =>
  [...workflow.slice(workflow.indexOf('\njobs:')).matchAll(/^ {2}([a-z0-9-]+):$/gm)].map((m) => m[1]);

/** Список `needs` джобы `report` — то, что реально удерживает сборку отчёта. */
const reportNeeds = () => {
  const block = workflow.slice(workflow.indexOf('\n  report:'));
  const list = /\n {4}needs:\s*\n?\s*\[([^\]]*)\]/.exec(block);
  if (!list) throw new Error('у джобы report не нашёлся needs — разбор устарел');
  return list[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

/** Ключи реестра, которые джобами НЕ являются: сентинел пишет ШАГ внутри чужой джобы,
 *  и удерживать в `needs` тут нечего. Список закрытый — новый такой ключ обязан быть
 *  осознанным, иначе это просто забытая джоба. */
const STEP_ONLY = ['smoke-caddy', 'smoke-image'];

describe('отчёт безопасности: реестр доверия и needs', () => {
  it('каждый сканер реестра удерживает джобу report', () => {
    const jobs = new Set(jobIds());
    const needs = new Set(reportNeeds());
    const missing = expectedKeys().filter((k) => jobs.has(k) && !needs.has(k));
    expect(missing).toEqual([]);
  });

  it('в needs нет призраков — каждая запись это существующая джоба', () => {
    const jobs = new Set(jobIds());
    expect(reportNeeds().filter((n) => !jobs.has(n))).toEqual([]);
  });

  it('ключи реестра без своей джобы — только известные шаги-сентинелы', () => {
    const jobs = new Set(jobIds());
    const orphans = expectedKeys().filter((k) => !jobs.has(k));
    expect(orphans.sort()).toEqual(STEP_ONLY);
  });

  it('разбор жив: джобы и реестр непусты', () => {
    // Страховка от «регексп перестал совпадать» — без неё все проверки выше стали бы
    // зелёными на пустых списках, то есть перестали бы что-либо проверять.
    expect(jobIds().length).toBeGreaterThan(10);
    expect(expectedKeys().length).toBeGreaterThan(10);
    expect(reportNeeds().length).toBeGreaterThan(10);
  });
});

/**
 * БАЗОВАЯ ЛИНИЯ С `main`. Одни и те же CVE стороннего образа (postgres, gosu) висели
 * в топе sticky-отчёта на КАЖДОМ PR, и новая находка тонула под ними. Отчёт сверяет
 * находки с последним отчётом `main` и в таблицу кладёт только новые; известные
 * называет числом. Номер строки в ключ не входит: правка выше по файлу сдвигает его.
 */
describe('отчёт безопасности: новые находки против базовой линии main', () => {
  const sarif = (results) =>
    JSON.stringify({
      runs: [
        {
          tool: { driver: { name: 'Trivy' } },
          results: results.map(([ruleId, uri, line]) => ({
            ruleId,
            level: 'error',
            message: { text: `finding ${ruleId}` },
            locations: [
              { physicalLocation: { artifactLocation: { uri }, region: { startLine: line } } },
            ],
          })),
        },
      ],
    });

  const run = async (current, baseline) => {
    const { mkdtempSync, writeFileSync: write, mkdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { execFileSync } = await import('node:child_process');
    const dir = mkdtempSync(join(tmpdir(), 'sec-report-'));
    mkdirSync(join(dir, 'cur'));
    write(join(dir, 'cur', 'trivy.sarif'), sarif(current));
    const args = [
      join(root, '.github/scripts/summarize-security.mjs'),
      join(dir, 'cur'),
      join(dir, 'out.md'),
    ];
    if (baseline) {
      mkdirSync(join(dir, 'base'));
      write(join(dir, 'base', 'trivy.sarif'), sarif(baseline));
      args.push(join(dir, 'base'));
    }
    execFileSync(process.execPath, args, { env: { ...process.env, GITHUB_REF_NAME: 'feat/x' } });
    return readFileSync(join(dir, 'out.md'), 'utf8');
  };

  it('в таблице только новое, известное — числом; сдвиг строки не делает находку новой', async () => {
    const md = await run(
      [
        ['CVE-OLD', 'library/postgres', 12],
        ['CVE-NEW', 'library/postgres', 3],
      ],
      [['CVE-OLD', 'library/postgres', 1]],
    );
    expect(md).toContain('**Уже есть на `main`:** 1');
    expect(md).toContain('### Новые находки (топ 1 из 1)');
    expect(md).toContain('CVE-NEW');
    expect(md).not.toContain('`CVE-OLD`');
  });

  it('кратность считается: третья такая же находка при двух на main — новая', async () => {
    const same = ['CVE-X', 'a', 1];
    const md = await run([same, same, same], [same, same]);
    expect(md).toContain('**Уже есть на `main`:** 2');
    expect(md).toContain('### Новые находки (топ 1 из 1)');
  });

  it('без базовой линии показано всё и сказано почему', async () => {
    const md = await run([['CVE-OLD', 'library/postgres', 1]]);
    expect(md).toContain('Базовая линия с `main` недоступна');
    expect(md).toContain('### Находки (топ 1 из 1)');
  });
});
