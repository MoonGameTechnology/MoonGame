// scripts/docs-check.mjs — `pnpm run docs-check`: целостность графа знаний в docs/.
//
// docs/ — это и есть граф знаний проекта (сотни перекрёстных ссылок между
// state.md / backlog.md / роадмапами), и рабочее соглашение требует «сверять
// доки с реальностью». Этот скрипт делает исполняемой ровно одну гарантию:
// каждая ссылка на .md-файл указывает на существующий файл, а зонные теги
// backlog'а берутся из известного словаря (правило «один кирпич — одна зона»
// живёт на блоках; словарь не даёт зонам тихо расползаться опечатками).
//
// Без зависимостей, как prototype/doctor.mjs. Части:
//   1. Markdown-ссылки `[текст](путь.md)` — резолв относительно файла-источника.
//   2. Backtick-упоминания `имя.md` — резолв от корня, от файла, либо по
//      уникальному имени файла в репозитории (так доки и ссылаются друг на друга).
//   3. Словарь зон в docs/backlog.md: каждый тег `[зона]` ∈ известному набору
//      (комбинированные `[a/b]` проверяются почастно).
//   4. Статусы кирпичей backlog'а: символ ∈ словарю легенды, а блокировка `🔒(ID)`
//      не указывает на кирпич, который уже ✅ или 🗑 (мёртвая блокировка держит
//      запертой работу, которую давно можно брать, — расчистка 2026-09-01 сняла
//      пять ложных замков и два самодельных символа статуса).
//
// Осознанные исключения — с причиной и датой (конвенция .trivyignore):
//   - docs/reviews/** не проверяется: это ДАТИРОВАННЫЕ исторические снапшоты,
//     им позволено ссылаться на имена, актуальные на их дату (в т.ч. на
//     предложенные и отклонённые доки).
//   - ALLOW: точечные forward-ссылки на ещё не созданные файлы.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, normalize, basename, sep } from 'node:path';

const ROOT = normalize(join(import.meta.dirname, '..'));

/** Каталоги, в которые обход не заходит (не наш контент / артефакты). */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.claude']);

/** Датированные исторические снапшоты — ссылки в них не проверяются (см. шапку). */
const HISTORICAL = [normalize('docs/reviews')];

/** Осознанные forward-ссылки на ещё не созданные файлы (причина + дата). */
const ALLOW = new Set([
  'core-engine.md', // запланированный архитектурный док — GDD §5.2 прямо зовёт его «ещё не созданным» · 2026-07
  'data-schemas.md', // запланированный док артиллерийной уязвимости — GDD §11 зовёт его «уточняется при наполнении» · 2026-07 (аудит BR1/BR4)
  'SECURITY.md', // политика раскрытия уязвимостей — подзадача SEC-8 secure-sdlc-roadmap, файла ещё нет · 2026-07
  'playtest-logs/2026-06-26-notes.md', // пример имени файла, который СОЗДАЁТ автор плейтеста по шаблону · 2026-07
  'scanner-coverage-2026-07-26.md', // security-отчёт из PR #357 · 2026-07
  'pipeline-architecture-2026-07-26.md', // security-отчёт из PR #358 · 2026-07
]);

/** Словарь зон backlog'а — зеркалит легенду «## Зоны» в docs/backlog.md. */
const ZONES = new Set(['core', 'act', 'srv', 'cli', 'proto', 'data', 'docs', 'sec', 'ops']);

// --- обход репозитория ---------------------------------------------------------

/** Все файлы репо (рекурсивно, включая скрытые каталоги вроде .github). */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const allFiles = walk(ROOT).map((f) => normalize(f).slice(ROOT.length + 1));
const fileSet = new Set(allFiles);
// имя файла → сколько раз встречается (для резолва «голых» упоминаний `имя.md`)
const byBasename = new Set(allFiles.map((f) => basename(f)));

const mdFiles = allFiles.filter(
  // `sep`, не '/': normalize даёт платформенный разделитель — с '/' историческое
  // исключение не срабатывало на Windows и локальный гейт краснел на чистом main.
  (f) => f.endsWith('.md') && !HISTORICAL.some((h) => f.startsWith(h + sep)),
);

// --- проверки ------------------------------------------------------------------

const problems = [];

/** Существует ли цель `ref`, упомянутая в файле `src`? */
function resolves(src, ref) {
  const target = ref.replace(/#.*$/, ''); // ссылка на секцию — проверяем файл
  if (target === '' || target.includes('*')) return true; // якорь / шаблон-маска — не файл
  if (ALLOW.has(target)) return true;
  const fromRoot = normalize(target.replace(/^\//, ''));
  if (fileSet.has(fromRoot)) return true;
  const fromFile = normalize(join(dirname(src), target));
  if (fileSet.has(fromFile)) return true;
  // «голое» упоминание `имя.md` — так доки ссылаются друг на друга через каталоги
  return byBasename.has(basename(target));
}

for (const file of mdFiles) {
  const text = readFileSync(join(ROOT, file), 'utf8');

  // 1. markdown-ссылки [..](x.md) — только относительные (http/mailto не наши)
  for (const m of text.matchAll(/\]\(([^)\s]+?\.md)(#[^)]*)?\)/g)) {
    const ref = m[1];
    if (/^[a-z]+:/i.test(ref)) continue; // http(s)://, mailto:
    if (!resolves(file, ref)) problems.push(`${file}: битая ссылка → ${ref}`);
  }

  // 2. backtick-упоминания `x.md` (в т.ч. с путём)
  for (const m of text.matchAll(/`([A-Za-z0-9._/*-]+\.md)`/g)) {
    if (!resolves(file, m[1])) problems.push(`${file}: висячее упоминание → \`${m[1]}\``);
  }
}

// 3. словарь зон backlog'а
const backlog = readFileSync(join(ROOT, 'docs/backlog.md'), 'utf8');
for (const m of backlog.matchAll(/`\[([a-z/+-]+)\]`/g)) {
  for (const part of m[1].split('/')) {
    if (!ZONES.has(part)) {
      problems.push(`docs/backlog.md: неизвестная зона \`[${m[1]}]\` (словарь: ${[...ZONES].join(', ')})`);
      break;
    }
  }
}

// 4. статусы кирпичей backlog'а: словарь + живость блокировок.
//
// Статус читают вместо тела кирпича («что можно брать?»), поэтому врёт он дорого, а
// проверить его глазами нельзя: кирпичей больше пятисот. Ловим два вида гнили, оба
// найдены расчисткой 2026-09-01: самодельный символ (❌/🟡 рядом с 🗑/🔶 — один смысл,
// два написания) и блокировка на кирпич, который давно закрыт (CONV-12 ждал закрытый
// CONV-11, G2 — закрытый G1, LARS-2 — закрытый LARS-1).
//
// Зависимость ВНЕ backlog'а (`🔒(EC-1.1)` — кирпич живёт в economy-roadmap.md,
// `🔒(Этап 7)` — этап, а не кирпич) не проверяется: здесь нет её статуса, а гадать
// хуже, чем молчать.
const STATUSES = ['✅', '⏳', '🔶', '🔒', '🗑'];
// Кирпич: `- **ID** <статус>`. Единственная законная строка без статуса — указатель
// «→ **перенесено в**» (так уехали SHIP-7..11 в squadrons-roadmap.md).
// Статус — первый символ после имени, поэтому альтернатива со словарём стоит ПЕРЕД
// «жадным» `\S+`: `🔒(CONV-12)` и `✅(прототип)` — законные уточнения при законном
// статусе, а `\S+` ловит целиком чужой символ (`❌`, `🟡`), чтобы назвать его в ошибке.
const BRICK_RE =
  /^- \*\*([A-Za-z][A-Za-z0-9]*(?:[-.][A-Za-z0-9]+)*(?:\.\.[A-Za-z0-9]+)?)\*\*[ \t]*(✅|⏳|🔶|🔒|🗑|→|\S+)/gm;
const MOVED = '→';

const brickStatus = new Map();
for (const m of backlog.matchAll(BRICK_RE)) {
  const [, id, mark] = m;
  if (mark === MOVED) continue;
  if (!STATUSES.includes(mark)) {
    problems.push(
      `docs/backlog.md: у кирпича ${id} статус «${mark}» вне словаря (${STATUSES.join(' ')}) — ` +
        'см. легенду «## Статусы»',
    );
    continue;
  }
  brickStatus.set(id, mark);
}

for (const m of backlog.matchAll(/^- \*\*([A-Za-z0-9.-]+)\*\*[ \t]*🔒\(([^)]*)\)/gm)) {
  const [, id, deps] = m;
  for (const dep of deps.split(/[,/]/).map((d) => d.trim())) {
    const st = brickStatus.get(dep);
    if (st === '✅' || st === '🗑') {
      problems.push(
        `docs/backlog.md: ${id} заперт на ${dep}, а тот уже ${st} — мёртвая блокировка, ` +
          'смени статус или укажи настоящую зависимость',
      );
    }
  }
}

// 5. счётчики модулей в docs/state.md §9 против КОДА.
//
// Числа модулей уже разъезжались молча: доки говорили 33/34, `DEV_MODULES` — 29, а в
// каталоге лежало 35. Ссылка на файл проверяема, а число — нет, поэтому оно и гниёт.
// Здесь число становится проверяемым: §9 объявлен единственным домом счётчика, а
// соседние доки ссылаются на него вместо своей копии.
//
// Источники правды берём максимально дёшево и без парсинга TS:
//   - каталог модулей — просто список файлов;
//   - `DEV_MODULES` — через ЗАКРЕПЛЁННЫЙ список id в moduleManifest.test.ts; сам он
//     сверяется с настоящим `DEV_MODULES` витестом (инвариант #6), так что цепочка
//     замкнута: код → сторож манифеста → этот скрипт → state.md;
//   - `MODULES` прототипа — массив в protoKernel.ts (своего сторожа у него нет:
//     поматчево он не версионируется).
const counts = (() => {
  const modDir = join(ROOT, 'packages/shared-core/src/modules');
  const files = readdirSync(modDir).filter((f) => f.endsWith('.ts') && !f.includes('.test.')).length;

  const guard = readFileSync(join(ROOT, 'packages/server/src/moduleManifest.test.ts'), 'utf8');
  const pinned = guard.match(/const PINNED_MODULE_IDS = \[([\s\S]*?)\n\];/);
  // Только строки-элементы: комментарии внутри массива элементами не являются.
  const dev = pinned
    ? pinned[1].split('\n').filter((l) => l.trim().startsWith("'")).length
    : null;

  const proto = readFileSync(join(ROOT, 'prototype/src/protoKernel.ts'), 'utf8');
  const arr = proto.match(/export const MODULES: GameModule\[\] = \[([\s\S]*?)\n\];/);
  const protoCount = arr
    ? arr[1].split('\n').filter((l) => /^[a-zA-Z]+Module,/.test(l.trim())).length
    : null;

  return { files, dev, proto: protoCount };
})();

const state = readFileSync(join(ROOT, 'docs/state.md'), 'utf8');
/** Достать число из §9 по метке, которой оно подписано в таблице/тексте. */
const claim = (re) => {
  const m = state.match(re);
  return m ? Number(m[1]) : null;
};
const CLAIMS = [
  // Форма слова зависит от числа (35 модулей / 34 модуля / 31 модуль) — если её не
  // допустить, подмена числа выглядела бы как «счётчик удалили», и сообщение об ошибке
  // отправило бы чинить не то.
  ['модулей в каталоге', claim(/\*\*(\d+) модул(?:ь|я|ей)\*\* на микроядре/), counts.files],
  ['DEV_MODULES', claim(/`scenario\.ts`\) \| \*\*(\d+)\*\*/), counts.dev],
  ['MODULES прототипа', claim(/`protoKernel\.ts`\) \| \*\*(\d+)\*\*/), counts.proto],
];
for (const [what, said, real] of CLAIMS) {
  if (real === null) {
    problems.push(`docs-check: не удалось прочитать из кода счётчик «${what}» — проверка счётчиков сломана, почини её`);
  } else if (said === null) {
    problems.push(`docs/state.md §9: счётчик «${what}» не найден — он объявлен единственным домом этого числа, не удаляй его`);
  } else if (said !== real) {
    problems.push(`docs/state.md §9: «${what}» — в доке ${said}, в коде ${real}`);
  }
}

// --- вердикт ---------------------------------------------------------------------

if (problems.length > 0) {
  console.error(`docs-check: ${problems.length} проблем(ы) целостности docs/:\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    '\nПравь ссылку/зону/статус, либо — для осознанной forward-ссылки — добавь её в ALLOW\n' +
      'внутри scripts/docs-check.mjs с причиной и датой (конвенция .trivyignore).',
  );
  process.exit(1);
}
console.log(
  `docs-check: OK — ${mdFiles.length} md-файлов, ссылки целы, зоны и статусы из словаря ` +
    `(кирпичей: ${brickStatus.size}), блокировки живые.`,
);
