#!/usr/bin/env node
/**
 * Сливает несколько SARIF-файлов в ОДИН файл с ОДНИМ `run`.
 *
 * Зачем. `github/codeql-action/upload-sarif` с 2025-07-21 отказывается грузить
 * несколько `runs` под одной категорией: «does not support uploading multiple SARIF
 * runs with the same category». Джоба `trivy-deps` сканирует по образу за раз и
 * писала по SARIF на образ, а грузила КАТАЛОГ под категорией `trivy-deps` — загрузка
 * падала с configuration error, а шаг стоит под `continue-on-error`, поэтому джоба
 * оставалась зелёной, находки в Code Scanning не приезжали, и заметить это было
 * неоткуда: sticky-комментарий PR'а строится из артефактов напрямую, а не из панели.
 *
 * Почему слияние, а не категория на образ. Категория на образ (`trivy-deps-caddy`,
 * `trivy-deps-postgres`) — то, что советует сам GitHub, но она требует matrix-джобы,
 * а список образов читается из `deploy/docker-compose*.yml` В РАНТАЙМЕ (SEC-11: чтобы
 * бамп дайджеста не разъезжался с тем, что сканирует CI). Matrix ещё и размножил бы
 * сентинел `status-trivy-deps.json`, который отчёт ждёт ровно в одном экземпляре —
 * то есть сломал бы таблицу подтверждения сканов, а она fail-secure. Слияние трогает
 * только форму загрузки.
 *
 * Атрибуция к образу при этом НЕ теряется: у находок Trivy путь артефакта — это путь
 * ВНУТРИ образа (`usr/bin/caddy` против `usr/local/bin/gosu`), и он переезжает в
 * слитый run как есть.
 *
 *   node .github/scripts/merge-sarif.mjs <выходной-файл> <вход.sarif> [ещё.sarif …]
 */
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * @param {unknown[]} docs разобранные SARIF-документы
 * @returns {object} SARIF с единственным `run`
 */
export function mergeSarif(docs) {
  /** @type {any[]} */
  const runs = [];
  for (const doc of docs) {
    const list = /** @type {any} */ (doc)?.runs;
    if (Array.isArray(list)) runs.push(...list);
  }

  // Правила складываем в общий список БЕЗ дублей по `id`: один и тот же CVE может
  // прийти из двух образов, и два одинаковых правила в одном run — невалидный SARIF.
  /** @type {any[]} */
  const rules = [];
  const ruleIndexById = new Map();
  /** @type {any[]} */
  const results = [];

  for (const run of runs) {
    const runRules = run?.tool?.driver?.rules ?? [];
    // Свой указатель на каждый run: `ruleIndex` в результате адресует правило В СВОЁМ
    // run, и после склейки его надо пересчитать в индекс общего списка. Пропустить
    // этот шаг — значит показать в панели ЧУЖОЕ описание у части находок.
    const localToMerged = new Map();
    for (let i = 0; i < runRules.length; i++) {
      const rule = runRules[i];
      const id = rule?.id;
      if (typeof id !== 'string') continue;
      if (!ruleIndexById.has(id)) {
        ruleIndexById.set(id, rules.length);
        rules.push(rule);
      }
      localToMerged.set(i, ruleIndexById.get(id));
    }

    for (const result of run?.results ?? []) {
      const copy = { ...result };
      if (typeof copy.ruleIndex === 'number') {
        const mapped = localToMerged.get(copy.ruleIndex);
        // Индекс, которому не нашлось правила, УДАЛЯЕМ, а не оставляем висеть: в SARIF
        // `ruleId` самодостаточен, а битый `ruleIndex` — это указание не на то правило.
        if (mapped === undefined) delete copy.ruleIndex;
        else copy.ruleIndex = mapped;
      }
      results.push(copy);
    }
  }

  // Драйвер берём у первого непустого run: сканер один и тот же, разойтись им нечем.
  const driver = runs.find((r) => r?.tool?.driver)?.tool?.driver ?? { name: 'unknown' };

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{ tool: { driver: { ...driver, rules } }, results }],
  };
}

// --- CLI ---------------------------------------------------------------------
// import.meta.main появился только в Node 24 — сравниваем пути, чтобы модуль
// оставался импортируемым тестом и на более старых рантаймах.
const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  const [out, ...inputs] = process.argv.slice(2);
  if (!out || inputs.length === 0) {
    process.stderr.write('usage: merge-sarif.mjs <out.sarif> <in.sarif> [in.sarif …]\n');
    process.exit(2);
  }
  const docs = inputs.map((p) => JSON.parse(readFileSync(p, 'utf8')));
  const merged = mergeSarif(docs);
  writeFileSync(out, JSON.stringify(merged));
  process.stdout.write(
    `merge-sarif: ${inputs.length} файл(ов) → ${merged.runs[0].results.length} находок, ` +
      `${merged.runs[0].tool.driver.rules.length} правил → ${out}\n`,
  );
}
