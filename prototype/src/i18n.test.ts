import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ru } from '../../localization/ru';
import { en } from '../../localization/en';
import { dataKey } from '../../localization';
import { GLOSSARY } from './codexIndex';
import { INTROS } from './intros';
import { FIRST_GOALS } from './firstGoals';
import { HUD_ORIENTATION_TOUR } from './onboardingTour';
import { buildFirstMatchTour } from './firstMatchTour';

/** Тур первого матча строится из предикатов хоста — для разбора копии они не важны. */
const TOUR_DEPS_STUB = {
  hasFleet: () => false,
  capturedWorld: () => false,
  scoreRose: () => false,
};

// Гейт локализации. Текст живёт в /localization, в коде — только ключи
// (`t('err.no-capacity')`). Эти тесты держат три инварианта:
//   1. локали не расходятся — у ru.ts и en.ts один и тот же набор ключей;
//   2. ключ из кода существует, а ключ из локали не осиротел;
//   3. в коде нет русского текста — только ключи (мост совместимости снят).
// Без них непереведённая строка молча уезжает в прод по-русски, а опечатка в ключе
// показывается игроку как `err.no-capaciti`.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** Читаем исходник БЕЗ строк-комментариев: doc-шапки показывают примеры вызовов
 *  (`t('fleet.eta', { n: 3 })`), и без этого они попали бы в разбор как настоящие. */
const read = (p: string): string =>
  readFileSync(path.join(repoRoot, p), 'utf8')
    .split('\n')
    .filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln))
    .join('\n');
const hasCyrillic = (s: string): boolean => /[А-Яа-яЁё]/.test(s);

/** Ключ = строчные сегменты через точку, минимум два: `err.no-capacity`. Старый
 *  msgid под это не подходит (кириллица, пробелы, заглавные), поэтому по одному
 *  виду литерала однозначно понятно, ключ это или мост. */
const KEY_RE = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;

const srcFiles = (): string[] =>
  readdirSync(path.join(repoRoot, 'prototype/src'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => `prototype/src/${f}`);

/** Первый строковый аргумент каждого `t(…)` / `tData(…)`. Идём посимвольно (regex
 *  ломается на `{placeholders}` / апострофах / переносах): на вызове читаем литерал,
 *  уважая экранирование. Вызов с переменной или шаблоном пропускается — такие ключи
 *  собираются в рантайме и покрыты списком DYNAMIC ниже. */
function extractCallArgs(src: string, fn: 't' | 'tData'): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < src.length - 1; i++) {
    if (fn === 'tData' ? !src.startsWith('tData(', i) : !(src[i] === 't' && src[i + 1] === '('))
      continue;
    const prev = i > 0 ? src[i - 1]! : ' ';
    if (/[A-Za-z0-9_$.]/.test(prev)) continue; // часть более длинного идентификатора
    let j = i + (fn === 'tData' ? 6 : 2);
    while (j < src.length && /\s/.test(src[j]!)) j++;
    const q = src[j];
    if (q !== "'" && q !== '"' && q !== '`') continue;
    j++;
    let lit = '';
    while (j < src.length) {
      const c = src[j]!;
      if (c === '\\') {
        lit += c + (src[j + 1] ?? '');
        j += 2;
        continue;
      }
      if (c === q) break;
      lit += c;
      j++;
    }
    if (q === '`' && lit.includes('${')) continue; // шаблон — ключ собирается в рантайме
    out.add(unescape_(lit));
  }
  return out;
}

const unescape_ = (lit: string): string =>
  lit
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\`/g, '`')
    .replace(/\\n/g, '\n')
    .replace(/\\\\/g, '\\');

/** Ключи, которых НЕТ в коде литералом — они собираются из идентификатора в рантайме.
 *  Каждая запись объясняет, кто их строит; иначе тест на сирот снесёт живой перевод. */
/** Ключи статичной разметки (`prototype/build.mjs`): `data-i18n="hub.play"` и
 *  атрибутные близнецы `-title` / `-ph` / `-aria`. Возвращает ЗНАЧЕНИЕ атрибута, а
 *  `null` — для старой формы без значения (ключ брался из текста узла): такой слот
 *  localizeStaticDom больше не переводит, поэтому он обязан всплыть как провал. */
function staticMarkupKeys(): Array<string | null> {
  const src = readFileSync(path.join(repoRoot, 'prototype/build.mjs'), 'utf8');
  const out: Array<string | null> = [];
  for (const tag of src.match(/<[a-z]+\b[^>]*>/g) ?? [])
    for (const marker of ['data-i18n', 'data-i18n-title', 'data-i18n-ph', 'data-i18n-aria'])
      if (new RegExp(`${marker}(?![-\\w])`).test(tag))
        out.push(new RegExp(`${marker}="([^"]*)"`).exec(tag)?.[1] ?? null);
  return out;
}

const DYNAMIC: Array<{ prefix: string; built_by: string }> = [
  { prefix: 'err.', built_by: 'errText() — из кода отказа ядра: E_NO_CAPACITY → err.no-capacity' },
  { prefix: 'data.', built_by: 'tData() через dataKey() — из имени в data/*.json' },
  { prefix: 'hud.resource.', built_by: 'renderHud() — из id ресурса в chip()' },
];
const isDynamic = (k: string): boolean => DYNAMIC.some((d) => k.startsWith(d.prefix));

describe('локализация — ключи', () => {
  it('ru.ts и en.ts описывают ровно один и тот же набор ключей', () => {
    const onlyRu = Object.keys(ru)
      .filter((k) => !(k in en))
      .sort();
    const onlyEn = Object.keys(en)
      .filter((k) => !(k in ru))
      .sort();
    expect({ onlyRu, onlyEn }).toEqual({ onlyRu: [], onlyEn: [] });
  });

  it('каждый ключ из кода заведён в локали', () => {
    const missing: string[] = [];
    for (const f of srcFiles())
      for (const lit of extractCallArgs(read(f), 't'))
        if (KEY_RE.test(lit) && !(lit in ru)) missing.push(`${f}: ${lit}`);
    expect(missing.sort()).toEqual([]);
  });

  it('статичная разметка переведена ключами, старой формы не осталось', () => {
    const keys = staticMarkupKeys();
    expect(keys.length).toBeGreaterThan(100); // разбор разметки не должен молча опустеть
    // `null` = `data-i18n` без значения: старая форма, где ключом был текст узла.
    expect(keys.filter((k) => k === null)).toEqual([]);
    const bad = keys.filter((k): k is string => k !== null).filter((k) => !(k in ru));
    expect([...new Set(bad)].sort()).toEqual([]);
  });

  it('каждый ключ локали используется (нет осиротевших переводов)', () => {
    // Ищем ключ в КАВЫЧКАХ, а не подстрокой: подстрочный поиск считал живым любой
    // ключ, чей текст встречается внутри другого литерала, и так мост годами
    // держал десятки мёртвых записей.
    const hay = [...srcFiles().map(read), read('prototype/build.mjs')].join('\n');
    const quoted = new Set([
      ...[...hay.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]!),
      ...[...hay.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]!),
    ]);
    const orphans = Object.keys(ru)
      .filter((k) => !isDynamic(k) && !quoted.has(k))
      .sort();
    expect(orphans).toEqual([]);
  });

  it('в коде нет русского текста — только ключи', () => {
    // Инвариант, ради которого этап 2 и делался: мост совместимости снят, поэтому
    // русский литерал в `t()`/`tData()` больше НЕ переведётся — он доедет до
    // игрока как есть. Проверяем оба вызова во всех исходниках прототипа.
    const leaks: string[] = [];
    for (const f of srcFiles()) {
      const src = read(f);
      for (const fn of ['t', 'tData'] as const)
        for (const lit of extractCallArgs(src, fn))
          if (hasCyrillic(lit)) leaks.push(`${f}: ${fn}(${JSON.stringify(lit)})`);
    }
    expect(leaks.sort()).toEqual([]);
  });

  it('в английских значениях не осталось русского', () => {
    const leaks = Object.entries(en)
      .filter(([, v]) => hasCyrillic(v))
      .map(([k]) => k);
    expect(leaks).toEqual([]);
  });

  it('таблицы копии отдают ключи, а не текст', () => {
    // Эти таблицы — чистые модули с копией: ключ уходит в `t()` ПЕРЕМЕННОЙ, поэтому
    // разбор литералов его не видит, и опечатка доехала бы до игрока как
    // `codex.term.fog.bodi`. Проверяем состав напрямую.
    const TABLES: Array<[string, string[]]> = [
      ['GLOSSARY', GLOSSARY.flatMap((g) => [g.titleKey, g.bodyKey])],
      ['INTROS', INTROS.flatMap((c) => [c.titleKey, c.bodyKey])],
      ['FIRST_GOALS', FIRST_GOALS.map((g) => g.labelKey)],
      ['HUD_ORIENTATION_TOUR', HUD_ORIENTATION_TOUR.map((s) => s.copy)],
      ['firstMatchTour', buildFirstMatchTour(TOUR_DEPS_STUB).map((s) => s.copy)],
    ];
    const bad: string[] = [];
    for (const [name, keys] of TABLES) {
      expect(keys.length, `${name} не должна молча опустеть`).toBeGreaterThan(3);
      for (const k of keys) if (!KEY_RE.test(k) || !(k in ru)) bad.push(`${name}: ${k}`);
    }
    expect(bad.sort()).toEqual([]);
  });

  it('у каждого юнита прототипа есть переведённое имя', () => {
    // displayUnit() показывает юнита как tData(id с пробелами) → data.<слаг>.
    // dataKey() — единственный мост между таблицей юнитов и локалью, поэтому
    // переименование id здесь всплывает как потерянный перевод, а не как
    // английское имя, тихо просочившееся в русский интерфейс.
    const table = /units:\s*\{(.*?)\n {2}\}/s.exec(read('prototype/src/prototypeData.ts'))?.[1];
    const ids = [...(table ?? '').matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(5); // разбор таблицы не должен молча опустеть
    const missing = ids.map((id) => dataKey(id.replace(/_/g, ' '))).filter((k) => !(k in ru));
    expect(missing).toEqual([]);
  });
});
