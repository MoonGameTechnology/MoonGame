/**
 * SLIM-1: сторож размеров кода — храповик, который не даёт крупным файлам и функциям
 * расти дальше.
 *
 * Зачем. План REFM за месяц распилил `prototype/src/main.ts` с 17 619 до 3 967 строк, а
 * за пять дней после финиша файл снова дорос до 4 046: росту ничто не мешало. За тот же
 * октябрь восемь других крупных файлов выросли на 40–90% (аудит 2026-11-01, блок SLIM в
 * `docs/backlog.md`). Ревью такой рост не видит: каждая правка добавляет «всего 30 строк».
 *
 * Правила (бюджет — `scripts/code-size-budget.json`):
 *   1. Файл исходников длиннее FILE_LIMIT строк обязан стоять в бюджете, и его длина не
 *      выше потолка. Новый файл длиннее FILE_LIMIT не проходит: его режут сразу.
 *   2. Функция длиннее FUNCTION_LIMIT строк — то же самое, ключ `файл::путь`.
 *   3. Храповик: файл, ставший короче потолка больше чем на SLACK строк, требует опустить
 *      потолок; файл или функция, ставшие короче лимита (или исчезнувшие), — убрать
 *      запись. Освобождённое место не занимают заново.
 *
 * Поднять потолок можно, но только явно: правкой бюджета в том же PR, с причиной в его
 * описании. Тогда рост виден в диффе, а не размазан по сотне коммитов.
 *
 * Что считается исходником: всё под git с расширением кода или CSS, кроме тестов,
 * объявлений типов (`.d.ts`) и файлов локалей (`localization/<код>.ts` — плоские карты
 * текста, а не логика). Длина функции — строки от её начала (без комментария над ней) до
 * закрывающей скобки включительно; вложенная функция считается и сама по себе, и в длине
 * внешней.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_FILE = 'scripts/code-size-budget.json';

/** Файл длиннее — только по бюджету. */
const FILE_LIMIT = 1000;
/** Функция длиннее — только по бюджету. */
const FUNCTION_LIMIT = 300;
/** Насколько файл может быть короче своего потолка, пока потолок не пора опускать. */
const FILE_SLACK = 100;
/** То же для функции. */
const FUNCTION_SLACK = 50;

const SOURCE_RE = /\.(ts|tsx|mts|cts|js|mjs|cjs|css)$/;
const SKIP_RE =
  /(^|\/)(node_modules|dist)\/|\.test\.[cm]?[jt]sx?$|\.d\.[cm]?ts$|^localization\/[a-z]{2}(-[A-Z]{2})?\.ts$/;

interface Budget {
  files: Record<string, number>;
  functions: Record<string, number>;
}

const sources = (): string[] =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter((f) => SOURCE_RE.test(f) && !SKIP_RE.test(f));

const lineCount = (text: string): number => {
  if (text === '') return 0;
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
};

const scriptKind = (file: string): ts.ScriptKind =>
  file.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : /\.[cm]?ts$/.test(file)
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS;

const isFunctionLike = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node) ||
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node);

const nameText = (
  name: ts.PropertyName | ts.BindingName | undefined,
  sf: ts.SourceFile,
): string | undefined =>
  name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name))
    ? name.text
    : name?.getText(sf);

/** Имя владельца объектного литерала или класса: `const shuttleModule = { setup() {} }` → `shuttleModule`. */
const holderName = (node: ts.Node, sf: ts.SourceFile): string | undefined => {
  if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name)
    return node.name.text;
  const p = node.parent;
  if (!p) return undefined;
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p)) return nameText(p.name, sf);
  // `{ … } satisfies GameModule`, `({ … }) as X` — владелец стоит на шаг выше.
  if (ts.isSatisfiesExpression(p) || ts.isAsExpression(p) || ts.isParenthesizedExpression(p))
    return holderName(p, sf);
  return undefined;
};

/**
 * Устойчивое имя функции: собственное имя, иначе имя переменной или свойства, иначе вызов,
 * которому она передана (`api.onAction('shuttle.strike')`). Методы — с именем класса или
 * объекта: `MatchRoom.receive`, `shuttleModule.setup`.
 */
const ownName = (node: ts.FunctionLikeDeclaration, sf: ts.SourceFile): string => {
  if (ts.isConstructorDeclaration(node))
    return `${node.parent.name?.text ?? '<class>'}.constructor`;
  if (
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    const holder = holderName(node.parent, sf);
    const own = nameText(node.name, sf) ?? '<method>';
    return holder ? `${holder}.${own}` : own;
  }
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isFunctionExpression(node) && node.name) return node.name.text;
  const p = node.parent;
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) {
    const own = nameText(p.name, sf) ?? '<anonymous>';
    const holder = ts.isPropertyAssignment(p)
      ? holderName(p.parent, sf)
      : ts.isPropertyDeclaration(p)
        ? holderName(p.parent, sf)
        : undefined;
    return holder ? `${holder}.${own}` : own;
  }
  if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
    const callee = p.expression.getText(sf).replace(/\s+/g, '');
    const first = p.arguments?.[0];
    const tag = first && ts.isStringLiteralLike(first) ? `'${first.text}'` : '…';
    return `${callee}(${tag})`;
  }
  return '<anonymous>';
};

interface FunctionSize {
  key: string;
  lines: number;
}

const functionSizes = (file: string, text: string): FunctionSize[] => {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const out: FunctionSize[] = [];
  const seen = new Map<string, number>();
  const visit = (node: ts.Node, path: string[]): void => {
    let inner = path;
    if (isFunctionLike(node)) {
      const name = ownName(node, sf);
      inner = [...path, name];
      const from = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
      const to = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
      const lines = to - from + 1;
      if (lines > FUNCTION_LIMIT) {
        const base = `${file}::${inner.join(' > ')}`;
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        out.push({ key: n === 1 ? base : `${base} #${n}`, lines });
      }
    }
    ts.forEachChild(node, (child) => visit(child, inner));
  };
  visit(sf, []);
  return out;
};

/** Замер всего репозитория: длины крупных файлов и функций. */
const measure = (): { files: Map<string, number>; functions: Map<string, number> } => {
  const files = new Map<string, number>();
  const functions = new Map<string, number>();
  for (const file of sources()) {
    let text: string;
    try {
      text = readFileSync(join(ROOT, file), 'utf8');
    } catch {
      continue; // удалён в рабочей копии, но ещё в индексе
    }
    const n = lineCount(text);
    if (n > FILE_LIMIT) files.set(file, n);
    if (!file.endsWith('.css'))
      for (const f of functionSizes(file, text)) functions.set(f.key, f.lines);
  }
  return { files, functions };
};

const check = (
  kind: 'файл' | 'функция',
  actual: Map<string, number>,
  budget: Record<string, number>,
  limit: number,
  slack: number,
): string[] => {
  const problems: string[] = [];
  for (const [key, n] of actual) {
    const cap = budget[key];
    if (cap === undefined) {
      problems.push(
        `${kind} ${key}: ${n} строк, а без бюджета можно не больше ${limit} — разрежь его`,
      );
    } else if (n > cap) {
      problems.push(`${kind} ${key}: ${n} строк, потолок ${cap} — вынеси новое в отдельный модуль`);
    } else if (cap - n > slack) {
      problems.push(
        `${kind} ${key}: ${n} строк, потолок ${cap} — опусти потолок до ${n} в ${BUDGET_FILE}`,
      );
    }
  }
  for (const key of Object.keys(budget)) {
    if (!actual.has(key)) {
      problems.push(
        `${kind} ${key}: уже не длиннее ${limit} строк (или переименован) — убери запись из ${BUDGET_FILE}`,
      );
    }
  }
  return problems;
};

describe('сторож размеров кода (SLIM-1)', () => {
  const budget = JSON.parse(readFileSync(join(ROOT, BUDGET_FILE), 'utf8')) as Budget;
  const actual = measure();

  it(`файлы длиннее ${FILE_LIMIT} строк не растут`, () => {
    expect(check('файл', actual.files, budget.files, FILE_LIMIT, FILE_SLACK)).toEqual([]);
  });

  it(`функции длиннее ${FUNCTION_LIMIT} строк не растут`, () => {
    expect(
      check('функция', actual.functions, budget.functions, FUNCTION_LIMIT, FUNCTION_SLACK),
    ).toEqual([]);
  });

  it('потолки бюджета не ниже лимитов: запись короче лимита не нужна', () => {
    const low = [
      ...Object.entries(budget.files).filter(([, cap]) => cap <= FILE_LIMIT),
      ...Object.entries(budget.functions).filter(([, cap]) => cap <= FUNCTION_LIMIT),
    ];
    expect(low).toEqual([]);
  });
});

describe('замер функций сторожа', () => {
  const body = (n: number): string =>
    Array.from({ length: n }, (_, i) => `  const v${i} = ${i};`).join('\n');
  const sizes = (text: string): Record<string, number> =>
    Object.fromEntries(functionSizes('x.ts', text).map((f) => [f.key, f.lines]));

  it('считает строки от начала функции до закрывающей скобки, без комментария над ней', () => {
    const src = `/** doc */\nexport function big(): void {\n${body(FUNCTION_LIMIT)}\n}\n`;
    expect(sizes(src)).toEqual({ 'x.ts::big': FUNCTION_LIMIT + 2 });
  });

  it('называет методы по классу и объекту, колбэки — по вызову', () => {
    const big = `{\n${body(FUNCTION_LIMIT)}\n}`;
    const src = [
      `class Room { receive() ${big} }`,
      `export const shuttleModule = { setup(api) { api.onAction('shuttle.strike', (a, h) => ${big}); } };`,
      `const handler = () => ${big};`,
    ].join('\n');
    expect(Object.keys(sizes(src)).sort()).toEqual(
      [
        "x.ts::shuttleModule.setup > api.onAction('shuttle.strike')",
        'x.ts::Room.receive',
        'x.ts::handler',
        'x.ts::shuttleModule.setup',
      ].sort(),
    );
  });

  it('различает одноимённые функции номером', () => {
    const big = `{\n${body(FUNCTION_LIMIT)}\n}`;
    const src = `run(() => ${big});\nrun(() => ${big});\n`;
    expect(Object.keys(sizes(src))).toEqual(['x.ts::run(…)', 'x.ts::run(…) #2']);
  });

  it('короткие функции не попадают в замер', () => {
    expect(sizes(`function small() {\n${body(10)}\n}`)).toEqual({});
  });
});
