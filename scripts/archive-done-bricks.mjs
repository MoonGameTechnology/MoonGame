// scripts/archive-done-bricks.mjs — `node scripts/archive-done-bricks.mjs`: выносит
// закрытые (✅) кирпичи из docs/backlog.md в docs/backlog-archive.md.
//
// ЗАЧЕМ. Бэклог дорос до 17 тысяч строк, из них ~15 тысяч — тела закрытых кирпичей. Их
// читает каждая сессия, которая ищет, что взять, а взять из них нечего: 665 из 703
// кирпичей бэклога уже ✅. Архив хранит те же тексты под теми же заголовками блоков, а
// `docs-check` читает оба файла как один бэклог — статусы, живость блокировок `🔒(ID)`
// и индекс кирпичей (колонка «Где») видят и то, что уехало.
//
// ЧТО СЧИТАЕТСЯ ТЕЛОМ КИРПИЧА. Строка `- **ID** ✅…` и всё, что идёт за ней С ОТСТУПОМ
// (пустые строки внутри — тоже, если за ними снова отступ). Первая строка без отступа —
// уже не кирпич: это проза блока или следующий кирпич, и она остаётся на месте. 🔶, ⏳,
// 🔒 и 🗑 не трогаем: 🗑 — запись о снятом решении, её читают, чтобы не завести заново.
//
// Скрипт идемпотентен: повторный запуск дописывает в архив только новые ✅, в разделы с
// тем же заголовком, в порядке бэклога. Запускать время от времени, отдельным PR —
// закрытие кирпича по-прежнему отмечается ✅ прямо в бэклоге (скилл `brick`).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKLOG = join(ROOT, 'docs/backlog.md');
const ARCHIVE = join(ROOT, 'docs/backlog-archive.md');

const HEADER = `# Архив бэклога — закрытые кирпичи

> Сюда \`scripts/archive-done-bricks.mjs\` выносит ✅-кирпичи из [\`backlog.md\`](backlog.md),
> чтобы тот показывал то, что ещё можно взять. Тексты не правятся — это запись о сделанном.
> Разделы повторяют блоки бэклога, кирпичи внутри — в прежнем порядке. \`docs-check\` читает
> этот файл вместе с бэклогом: статусы, блокировки \`🔒(ID)\` и индекс кирпичей
> (\`bricks-index.md\`) видят оба. Искать кирпич — по id в \`bricks-index.md\`.
`;

const BRICK = /^- \*\*[A-Za-z][A-Za-z0-9]*(?:[-.][A-Za-z0-9]+)*(?:\.\.[A-Za-z0-9]+)?\*\*[ \t]*(\S)/u;
const indented = (s) => s.startsWith(' ') || s.startsWith('\t');

/** Конец тела кирпича, начавшегося на строке i (индекс первой строки ПОСЛЕ него). */
function bodyEnd(lines, i) {
  let j = i + 1;
  while (j < lines.length) {
    if (indented(lines[j])) {
      j++;
      continue;
    }
    if (lines[j] === '') {
      let k = j;
      while (k < lines.length && lines[k] === '') k++;
      if (k < lines.length && indented(lines[k])) {
        j = k;
        continue;
      }
    }
    break;
  }
  return j;
}

const lines = readFileSync(BACKLOG, 'utf8').split('\n');
const keep = [];
/** Заголовок раздела `## …` → вынесенные из него кирпичи, в порядке бэклога. */
const moved = new Map();
let section = '';
let count = 0;
for (let i = 0; i < lines.length; ) {
  const line = lines[i];
  if (line.startsWith('## ')) section = line;
  const m = BRICK.exec(line);
  if (!m) {
    keep.push(line);
    i++;
    continue;
  }
  const end = bodyEnd(lines, i);
  if (m[1] !== '✅') {
    keep.push(...lines.slice(i, end));
    i = end;
    continue;
  }
  if (!moved.has(section)) moved.set(section, []);
  moved.get(section).push(lines.slice(i, end).join('\n'));
  count++;
  i = end;
}

if (!count) {
  console.log('archive-done-bricks: закрытых кирпичей в бэклоге нет — нечего выносить');
  process.exit(0);
}

// Кирпич списка мог стоять между двумя пустыми строками; после выноса они слипаются.
const collapsed = keep.join('\n').replace(/\n{3,}/g, '\n\n');
writeFileSync(BACKLOG, collapsed.endsWith('\n') ? collapsed : `${collapsed}\n`);

// Архив: существующие разделы дополняются, новые встают в конец в порядке бэклога.
const sections = new Map(); // заголовок → массив кирпичей
const order = [];
if (existsSync(ARCHIVE)) {
  let cur = null;
  const old = readFileSync(ARCHIVE, 'utf8').split('\n');
  for (let i = 0; i < old.length; ) {
    if (old[i].startsWith('## ')) {
      cur = old[i];
      if (!sections.has(cur)) {
        sections.set(cur, []);
        order.push(cur);
      }
      i++;
      continue;
    }
    if (cur && BRICK.test(old[i])) {
      const end = bodyEnd(old, i);
      sections.get(cur).push(old.slice(i, end).join('\n'));
      i = end;
      continue;
    }
    i++;
  }
}
for (const [head, bricks] of moved) {
  const key = head || '## Без раздела';
  if (!sections.has(key)) {
    sections.set(key, []);
    order.push(key);
  }
  sections.get(key).push(...bricks);
}
const out = [HEADER];
for (const head of order) out.push(head, '', sections.get(head).join('\n'), '');
writeFileSync(ARCHIVE, out.join('\n'));
console.log(`archive-done-bricks: вынесено ${count} ✅-кирпичей в docs/backlog-archive.md`);
