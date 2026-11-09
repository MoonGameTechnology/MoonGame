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
// ЗАКРЫТЫЙ БЛОК. Когда из блока `## …` ушёл последний кирпич, в бэклоге остаётся его проза:
// заказ, разбор, указатель на роадмап. Брать там нечего, а читать её приходится — после
// первого прогона так осталась половина бэклога. Поэтому блок без единого кирпича едет в
// архив целиком (проза встаёт в начало раздела с тем же заголовком), если только он не
// ведёт на док с живыми кирпичами (⏳ 🔶 🔒 по `bricks-index.md`): такой блок — указатель
// на работу, его оставляем. Разделы-правила в начале бэклога (`KEEP`) не трогаем.
//
// Скрипт идемпотентен: повторный запуск дописывает в архив только новые ✅ и новые закрытые
// блоки, в разделы с тем же заголовком, в порядке бэклога. Запускать время от времени,
// отдельным PR — закрытие кирпича по-прежнему отмечается ✅ прямо в бэклоге (скилл `brick`).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKLOG = join(ROOT, 'docs/backlog.md');
const ARCHIVE = join(ROOT, 'docs/backlog-archive.md');
const INDEX = join(ROOT, 'docs/bricks-index.md');
/** Разделы-правила бэклога: не блоки работы, в архив не едут. */
const KEEP = ['## Как взять кирпичик', '## Зоны', '## Статусы'];

const HEADER = `# Архив бэклога — закрытые кирпичи

> Сюда \`scripts/archive-done-bricks.mjs\` выносит ✅-кирпичи и прозу закрытых
> блоков из [\`backlog.md\`](backlog.md), чтобы тот показывал то, что ещё можно взять.
> Тексты не правятся — это запись о сделанном. Разделы повторяют блоки бэклога, кирпичи
> внутри — в прежнем порядке. \`docs-check\` читает этот файл вместе с бэклогом: статусы,
> блокировки \`🔒(ID)\` и индекс кирпичей (\`bricks-index.md\`) видят оба. Искать кирпич — по
> id в \`bricks-index.md\`.
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

// Закрытые блоки. Доки, где ещё есть живые кирпичи, — по индексу кирпичей (`docs-check`
// держит его в согласии с источниками); сам бэклог и его архив — не «указатель на работу».
const liveDocs = new Set();
if (existsSync(INDEX)) {
  for (const row of readFileSync(INDEX, 'utf8').split('\n')) {
    const m = /^\| [^|]+ \| (⏳|🔶|🔒)[^|]* \| [^|]* \| `([^`]+)` \|/u.exec(row);
    if (m) liveDocs.add(m[2].split('/').pop());
  }
}
liveDocs.delete('backlog.md');
liveDocs.delete('backlog-archive.md');
const mentionsLiveDoc = (body) =>
  [...body.join('\n').matchAll(/([\w.-]+\.md)\b/g)].some((m) => liveDocs.has(m[1]));

/** Заголовок → проза закрытого блока (без краевых пустых строк), в порядке бэклога. */
const closedBlocks = new Map();
const rest = [];
for (let i = 0; i < keep.length; ) {
  if (!keep[i].startsWith('## ') || KEEP.some((k) => keep[i].startsWith(k))) {
    rest.push(keep[i]);
    i++;
    continue;
  }
  let end = i + 1;
  while (end < keep.length && !keep[end].startsWith('## ')) end++;
  const body = keep.slice(i + 1, end);
  if (body.some((l) => BRICK.test(l)) || mentionsLiveDoc(body)) {
    rest.push(...keep.slice(i, end));
  } else {
    // Разделитель `---` принадлежит раскладке бэклога, а не блоку.
    const prose = body.filter((l) => l !== '---');
    while (prose.length && prose[0] === '') prose.shift();
    while (prose.length && prose[prose.length - 1] === '') prose.pop();
    closedBlocks.set(keep[i], prose);
    if (body.includes('---')) rest.push('---', '');
  }
  i = end;
}

if (!count && !closedBlocks.size) {
  console.log('archive-done-bricks: закрытых кирпичей и блоков в бэклоге нет — нечего выносить');
  process.exit(0);
}

// Кирпич списка мог стоять между двумя пустыми строками; после выноса они слипаются, а
// вынесенный блок мог оставить два разделителя подряд.
let collapsed = rest.join('\n').replace(/\n{3,}/g, '\n\n');
for (let prev = ''; prev !== collapsed; ) {
  prev = collapsed;
  collapsed = collapsed.replace(/\n---\n\n---\n/, '\n---\n');
}
writeFileSync(BACKLOG, collapsed.endsWith('\n') ? collapsed : `${collapsed}\n`);

// Архив: раздел — заголовок и его текст как есть (проза блока, потом кирпичи). Существующие
// разделы дополняются, новые встают в конец в порядке бэклога.
const sections = new Map(); // заголовок → строки раздела
const order = [];
const sectionOf = (head) => {
  if (!sections.has(head)) {
    sections.set(head, []);
    order.push(head);
  }
  return sections.get(head);
};
if (existsSync(ARCHIVE)) {
  let cur = null;
  for (const line of readFileSync(ARCHIVE, 'utf8').split('\n')) {
    if (line.startsWith('## ')) cur = sectionOf(line);
    else if (cur) cur.push(line);
  }
}
const trim = (body) => {
  while (body.length && body[0] === '') body.shift();
  while (body.length && body[body.length - 1] === '') body.pop();
  return body;
};
for (const [head, bricks] of moved) trim(sectionOf(head || '## Без раздела')).push(...bricks);
for (const [head, prose] of closedBlocks) {
  const body = trim(sectionOf(head));
  if (prose.length) body.unshift(...prose, ...(body.length ? [''] : []));
}
const out = [HEADER];
for (const head of order) out.push(head, '', trim(sections.get(head)).join('\n'), '');
writeFileSync(ARCHIVE, out.join('\n'));
console.log(
  `archive-done-bricks: вынесено ${count} ✅-кирпичей и ${closedBlocks.size} закрытых блоков в docs/backlog-archive.md`,
);
