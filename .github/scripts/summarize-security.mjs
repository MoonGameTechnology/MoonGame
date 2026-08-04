#!/usr/bin/env node
// Aggregates every scanner's output (SARIF + TruffleHog NDJSON + per-tool
// status sentinels) from a directory tree into one Markdown report.
// Pure Node (no external deps — avoids the unpinned-install supply-chain vector).
//   node .github/scripts/summarize-security.mjs <inputDir> <outFile>
//
// TRUST: the report LEADS with a scan-confirmation table built from per-job status
// sentinels (`status-<key>.json`, written AFTER each scan with the real exit/outcome).
// A scanner that silently fails (docker pull error swallowed by the step) leaves no
// confirmed sentinel → it is flagged "⚠️ scan NOT confirmed", never a quiet "0".
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const inputDir = process.argv[2] ?? 'reports';
const outFile = process.argv[3] ?? 'security-report.md';
const sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);
const ref = process.env.GITHUB_REF_NAME ?? '';
const runUrl =
  process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : '';

// Each entry is a distinct diversity axis (method / source / surface), not a clone.
const EXPECTED = [
  { key: 'semgrep', name: 'Semgrep — SAST (паттерны)' },
  { key: 'codeql', name: 'CodeQL — SAST (data-flow/taint)' },
  { key: 'gitleaks', name: 'Gitleaks — секреты (дерево)' },
  { key: 'trufflehog', name: 'TruffleHog — секреты (история + верификация)' },
  { key: 'osv', name: 'OSV-Scanner — SCA (osv.dev)' },
  {
    key: 'dependency-check',
    name: 'OWASP Dependency-Check — SCA (NVD/CPE)',
    scheduledOnly: true,
    skipNote: 'по расписанию/вручную',
  },
  { key: 'trivy-fs', name: 'Trivy fs — vuln/secret/IaC' },
  { key: 'trivy-image', name: 'Trivy image — базовая ОС образа' },
  { key: 'trivy-deps', name: 'Trivy image — сторонние образы прода (postgres/caddy)' },
  { key: 'kics', name: 'KICS — IaC (Docker Compose прода)' },
  {
    key: 'dependency-review',
    name: 'Dependency Review — что вносит PR (GHSA)',
    prOnly: true,
    skipNote: 'только на PR',
  },
  { key: 'dast-zap', name: 'OWASP ZAP — DAST (baseline против запущенного сервера)' },
  { key: 'zizmor', name: 'zizmor — безопасность workflow' },
  {
    key: 'scorecard',
    name: 'OpenSSF Scorecard — постура',
    mainOnly: true,
    skipNote: 'только на main',
  },
  { key: 'sbom', name: 'Syft — SBOM (CycloneDX)' },
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const LEVELS = ['error', 'warning', 'note', 'none'];
const ICON = { error: '🔴', warning: '🟠', note: '🔵', none: '⚪' };
const RANK = { error: 3, warning: 2, note: 1, none: 0 };
const norm = (lvl) => (LEVELS.includes(lvl) ? lvl : 'warning');

const files = walk(inputDir);
const readJson = (f) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};

// --- per-tool status sentinels (the fail-open detector) ---
const sentinels = new Map(); // key -> { ok, exit? }
for (const f of files.filter(
  (f) => /(^|\/)status-[^/]+\.json$/.test(f) || /^status-/.test(basename(f)),
)) {
  const s = readJson(f);
  if (s && typeof s.key === 'string') sentinels.set(s.key, s);
}

// --- SARIF findings ---
const perTool = new Map();
const totals = { error: 0, warning: 0, note: 0, none: 0 };
const findings = [];
/** Сколько результатов сканеры пометили как подавленные (см. фильтр ниже). */
let suppressedCount = 0;
const sarifTools = new Set();
const toolOf = (name) => {
  if (!perTool.has(name)) perTool.set(name, { error: 0, warning: 0, note: 0, none: 0 });
  return perTool.get(name);
};
for (const f of files.filter((f) => f.endsWith('.sarif') || f.endsWith('.sarif.json'))) {
  const data = readJson(f);
  if (!data) continue;
  for (const run of data.runs ?? []) {
    const name = run.tool?.driver?.name ?? 'Unknown';
    sarifTools.add(name);
    for (const r of run.results ?? []) {
      // Непустой `suppressions` — находка, ПОДАВЛЕННАЯ самим сканером (инлайн
      // `nosemgrep`, dismissal в UI и т.п.). Semgrep оставляет её в SARIF с этой
      // пометкой, но выходит с кодом 0 — для гейта её нет. Считать её наравне с живыми
      // значит показывать как проблему то, что уже разобрано и обосновано: именно так
      // «подавленная» находка в `wsServer.tls.test.ts` месяцами висела в отчёте, создавая
      // впечатление, что подавление не работает. Счётчик остаётся — молча прятать тоже
      // нельзя, число подавлений само по себе показатель.
      if (Array.isArray(r.suppressions) && r.suppressions.length > 0) {
        suppressedCount++;
        continue;
      }
      const level = norm(r.level);
      toolOf(name)[level]++;
      totals[level]++;
      const loc = r.locations?.[0]?.physicalLocation;
      findings.push({
        tool: name,
        level,
        rule: r.ruleId ?? '',
        path: loc?.artifactLocation?.uri ?? '',
        line: loc?.region?.startLine ?? '',
        msg: (r.message?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 140),
      });
    }
  }
}

// --- TruffleHog NDJSON (one finding per line; .Verified marks a live credential) ---
const thFile = files.find((f) => /(^|\/)trufflehog\.json$/.test(f));
if (thFile) {
  let verified = 0;
  let unverified = 0;
  for (const line of readFileSync(thFile, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    let o;
    try {
      o = JSON.parse(t);
    } catch {
      continue;
    }
    if (o.DetectorName === undefined && o.SourceMetadata === undefined) continue;
    const isV = o.Verified === true;
    if (isV) verified++;
    else unverified++;
    const level = isV ? 'error' : 'note';
    toolOf('TruffleHog')[level]++;
    totals[level]++;
    findings.push({
      tool: 'TruffleHog',
      level,
      rule: String(o.DetectorName ?? 'secret') + (isV ? ' (VERIFIED)' : ''),
      path: '',
      line: '',
      msg: isV ? 'Verified live credential' : 'Unverified potential secret',
    });
  }
  if (verified || unverified) sarifTools.add('TruffleHog');
}

// --- OWASP ZAP baseline (собственный JSON: SARIF эта утилита не умеет) ---
// ЗАЧЕМ ОТДЕЛЬНЫЙ РАЗБОР. Выше читаются только `*.sarif` и NDJSON TruffleHog, а `zap`
// кладёт свой `zap-report.json` — он лежал в артефакте НЕПРОЧИТАННЫМ. Из-за этого
// алерты DAST не попадали ни в таблицу «По инструментам», ни в список находок, ни в
// счётчики: при живых находках отчёт мог напечатать «Сканеры не вернули находок», и
// единственным следом оставалась `::warning::`-аннотация в логе джобы. Строка
// «✅ просканировано» при этом была формально верной — сентинел не врал, врала полнота.
const zapFile = files.find((f) => /(^|\/)zap-report\.json$/.test(f));
if (zapFile) {
  const data = readJson(zapFile);
  // riskcode: 3=High, 2=Medium, 1=Low, 0=Informational. Раскладка по тем же вёдрам,
  // что у SARIF, чтобы находка DAST весила столько же, сколько равная ей из SAST.
  const LEVEL = { 3: 'error', 2: 'warning', 1: 'note', 0: 'none' };
  let seen = 0;
  for (const site of data?.site ?? []) {
    for (const a of site.alerts ?? []) {
      const level = LEVEL[Number(a.riskcode)] ?? 'note';
      seen++;
      toolOf('ZAP')[level]++;
      totals[level]++;
      findings.push({
        tool: 'ZAP',
        level,
        rule: String(a.pluginid ?? a.alertRef ?? ''),
        // У DAST «где» — это URL, а не файл: берём первый инстанс, их число в msg.
        path: a.instances?.[0]?.uri ?? site['@name'] ?? '',
        line: '',
        msg: `${String(a.alert ?? a.name ?? '').replace(/\s+/g, ' ').trim()}${
          Number(a.count) > 1 ? ` (×${a.count})` : ''
        }`.slice(0, 140),
      });
    }
  }
  if (seen) sarifTools.add('ZAP');
}

// --- pnpm run check ---
let checkLine = '_неизвестно_';
const checkFile = files.find((f) => /check-status\.json$/.test(f));
if (checkFile) {
  const o = readJson(checkFile)?.check;
  if (o) checkLine = o === 'success' ? '✅ зелёный (lint+typecheck+test)' : `⚠️ ${o}`;
}

const sboms = files.filter((f) => /\.cdx\.json$/i.test(f)).map((f) => basename(f));

// --- scan-confirmation (fail-open detector) ---
const isMain = ref === 'main';
const event = process.env.GITHUB_EVENT_NAME ?? '';
const confirm = EXPECTED.map((t) => {
  const s = sentinels.get(t.key);
  // Confirmed if the job wrote a sentinel with ok=true. Единственный фолбэк — SBOM, и он
  // ограничен ИМЕННО тем файлом, который производит джоба `sbom`. (Раньше тут же
  // описывался общий фолбэк «есть SARIF с драйвером ⇒ подтверждён»; в коде его давно
  // нет, и держать в комментарии несуществующее поведение опаснее, чем не описывать его
  // вовсе: читатель поверит, что сканер без сентинела всё равно засчитается.)
  // Было `sboms.length > 0` — под это подходил и `sbom-image.cdx.json` от ДРУГОЙ джобы
  // (`trivy-image`), так что джоба `sbom` могла упасть целиком, а таблица доверия
  // печатала «✅ просканировано» (воспроизведено на фикстуре).
  const ok = (s && s.ok === true) || (!s && t.key === 'sbom' && sboms.includes('sbom.cdx.json'));
  // A job that was SKIPPED BY DESIGN is not a fail-open and must not raise the
  // "NOT confirmed" alarm — that alarm has to keep meaning «a scan that should have run
  // didn't». Three such designs exist: main-only (Scorecard), schedule-only
  // (Dependency-Check — too slow for the PR loop) and PR-only (Dependency Review — it
  // diffs base against head, so outside a pull_request there is nothing to compare).
  let state;
  if (ok) state = 'ok';
  else if (t.mainOnly && !isMain && !s) state = 'skipped';
  // Зеркало условия в security.yml: джоба бежит ТОЛЬКО на schedule/workflow_dispatch.
  // Проверять здесь `event === 'push'` было бы неверно — с появлением `pull_request`
  // в триггерах пропуск на PR читался бы как «скан не подтверждён», то есть ложная
  // тревога на каждом PR, а это ровно то, что обесценивает главный сигнал отчёта.
  else if (t.scheduledOnly && event !== 'schedule' && event !== 'workflow_dispatch' && !s)
    state = 'skipped';
  // Зеркало `if: github.event_name == 'pull_request'` в security.yml.
  else if (t.prOnly && event !== 'pull_request' && !s) state = 'skipped';
  else state = 'bad';
  return { ...t, state };
});
const okCount = confirm.filter((c) => c.state === 'ok').length;
const skipped = confirm.filter((c) => c.state === 'skipped');
const bad = confirm.filter((c) => c.state === 'bad');

findings.sort((a, b) => RANK[b.level] - RANK[a.level] || a.tool.localeCompare(b.tool));
const CAP = 30;

const L = [];
L.push('## 🛡️ Security scan — сводный отчёт');
L.push('');
L.push(
  `**Коммит:** \`${sha || '—'}\`${ref ? ` · **ветка:** \`${ref}\`` : ''}${runUrl ? ` · [лог прогона](${runUrl})` : ''}`,
);
L.push('');

// TRUST FIRST: did every scanner actually run?
L.push(
  `### 🔎 Подтверждение сканов — ${okCount}/${EXPECTED.length}${skipped.length ? ` (+${skipped.length} пропущено)` : ''}`,
);
if (bad.length) {
  L.push('');
  L.push(
    `> **⚠️ ВНИМАНИЕ: ${bad.length} скан(ов) НЕ подтверждены** — отчёт по ним нельзя считать «чисто». Не доверяй «0 находок» от них. См. лог прогона.`,
  );
}
L.push('');
L.push('| Сканер | Подтверждён |');
L.push('| --- | --- |');
const CELL = {
  ok: '✅ просканировано',
  skipped: '⏭ пропущено',
  bad: '⚠️ **НЕ подтверждён**',
};
// Пропуск по дизайну обязан объяснять СЕБЯ: иначе «⏭» читается как «что-то не сработало».
for (const c of confirm)
  L.push(
    `| ${c.name} | ${CELL[c.state]}${c.state === 'skipped' && c.skipNote ? ` (${c.skipNote})` : ''} |`,
  );
L.push('');

L.push('| Серьёзность | Σ |');
L.push('| --- | --: |');
for (const l of LEVELS) L.push(`| ${ICON[l]} ${l} | ${totals[l]} |`);
L.push('');
if (suppressedCount)
  L.push(
    `**Подавлено сканерами (с обоснованием в коде/конфиге):** ${suppressedCount} — в таблицы ниже не входят.  `,
  );
L.push(`**pnpm run check:** ${checkLine}  `);
L.push(`**SBOM (CycloneDX):** ${sboms.length ? `✅ ${sboms.join(', ')}` : '—'}`);
L.push('');

if (perTool.size) {
  L.push('### По инструментам');
  L.push('| Инструмент | 🔴 | 🟠 | 🔵 |');
  L.push('| --- | --: | --: | --: |');
  for (const [name, c] of [...perTool.entries()].sort())
    L.push(`| ${name} | ${c.error} | ${c.warning} | ${c.note} |`);
  L.push('');
}

if (findings.length) {
  L.push(`### Находки (топ ${Math.min(CAP, findings.length)} из ${findings.length})`);
  L.push('| | Инструмент | Правило | Где | Сообщение |');
  L.push('| --- | --- | --- | --- | --- |');
  for (const f of findings.slice(0, CAP)) {
    const where = f.path ? `\`${f.path}${f.line ? ':' + f.line : ''}\`` : '—';
    L.push(
      `| ${ICON[f.level]} | ${f.tool} | \`${f.rule}\` | ${where} | ${f.msg.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} |`,
    );
  }
  if (findings.length > CAP)
    L.push(`\n_…и ещё ${findings.length - CAP}. Полные SARIF — в артефактах прогона._`);
  L.push('');
} else {
  L.push(
    '_Сканеры не вернули находок (см. таблицу подтверждения выше — «0» значимо только для подтверждённых)._',
  );
  L.push('');
}

L.push('---');
L.push(
  'ℹ️ _Блокирующие сканеры (SEC-1): Semgrep, Gitleaks, OSV, Trivy fs/image — находка или сбой скана валит их джобу; остальные (CodeQL, TruffleHog, Trivy deps, Dependency-Check, zizmor, Scorecard) — информационные. Разные движки/источники — для перекрёстной валидации; «0» достоверно только у подтверждённых сканеров. Полные SARIF/SBOM — в артефактах прогона._',
);

writeFileSync(outFile, L.join('\n'));
process.stdout.write(L.join('\n') + '\n');

// --- полный список находок в ЛОГ (не в комментарий) ---------------------------
// Отчёт выше намеренно урезан до топ-30: он едет в комментарий PR, и полный список
// сделал бы его нечитаемым. Но триаж требует ВСЕХ находок с точными id — а достать их
// из артефактов можно не всегда (SARIF лежат в blob-хранилище GitHub, доступ к которому
// может быть закрыт политикой сети; в логи же попадает всё, что джоба напечатала).
// Поэтому здесь тот же набор находок печатается целиком, по одной на строку, в
// tab-separated виде: grep/awk по логу работает, а комментарий остаётся коротким.
// Маркеры BEGIN/END дают надёжные границы блока при чтении хвоста лога.
const FULL_CAP = 2000; // предохранитель: шумный сканер не должен раздуть лог до предела
const shown = findings.slice(0, FULL_CAP);
process.stdout.write(`\n--- FULL FINDINGS BEGIN (${shown.length}/${findings.length}) ---\n`);
for (const f of shown) {
  const where = f.path ? `${f.path}${f.line ? ':' + f.line : ''}` : '-';
  // Табы — разделители, поэтому из полей они вычищаются вместе с переводами строк.
  const msg = f.msg.replace(/[\t\r\n]+/g, ' ').slice(0, 200);
  process.stdout.write(`${f.level}\t${f.tool}\t${f.rule || '-'}\t${where}\t${msg}\n`);
}
if (findings.length > FULL_CAP)
  process.stdout.write(`… обрезано: ${findings.length - FULL_CAP} находок сверх лимита\n`);
process.stdout.write('--- FULL FINDINGS END ---\n');
