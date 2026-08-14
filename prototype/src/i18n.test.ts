import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ru } from '../../localization/ru';
import { en } from '../../localization/en';
import { dataKey } from '../../localization';
import { composeGameDataBundle } from '../../packages/shared-core/src/index';
import { GLOSSARY } from './codexIndex';
import { data } from './prototypeData';
import { INTROS } from './intros';
import { FIRST_GOALS } from './firstGoals';
import { HUD_ORIENTATION_TOUR } from './onboardingTour';
import { buildFirstMatchTour } from './firstMatchTour';

/** Тур первого матча строится из предикатов хоста — для разбора копии они не важны. */
const TOUR_DEPS_STUB = {
  homeOpened: () => false,
  shipsTabOpen: () => false,
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

/** Every `/localization` consumer's source — prototype (`prototype/src`) and, since
 *  LOC-3, the PWA client (`packages/client/src`). Both read the same shared pool, so
 *  the orphan/leak checks below must see both or a client-only key reads as dead. */
const srcFiles = (): string[] => [
  ...readdirSync(path.join(repoRoot, 'prototype/src'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => `prototype/src/${f}`),
  ...readdirSync(path.join(repoRoot, 'packages/client/src'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => `packages/client/src/${f}`),
];

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

/** ШИПНУТЫЙ игровой контент — `data/*.json`, собранные тем же композером, что и в
 *  проде (`composeGameDataBundle`, CP0.3). Это НЕ каталог прототипа: его читают
 *  `packages/client` и сервер, а `prototypeData.ts` — только прототип. Пары
 *  `[«каталог.id», name]` по всем record-каталогам бандла; `units.json` имён не несёт
 *  вовсе (юниты слагаются из id — это отдельная проверка выше) и честно даёт пусто. */
function shippedNames(): Array<[string, string]> {
  const bundle = composeGameDataBundle((name) =>
    JSON.parse(readFileSync(path.join(repoRoot, 'data', name), 'utf8')),
  ) as Record<string, unknown>;
  const out: Array<[string, string]> = [];
  for (const [table, items] of Object.entries(bundle)) {
    if (!items || typeof items !== 'object' || Array.isArray(items)) continue;
    for (const [id, def] of Object.entries(items as Record<string, unknown>)) {
      const name = (def as { name?: unknown } | null)?.name;
      if (typeof name === 'string') out.push([`${table}.${id}`, name]);
    }
  }
  return out;
}

/** Имена шипнутого контента, у которых ключа `data.*` ещё нет. Список ОБЯЗАН
 *  сокращаться: запись, для которой ключ уже появился, валит тест — иначе allowlist
 *  тихо зарастает и гейт превращается в декорацию. Две группы, и ни одна не чинится
 *  «просто дозавести ключ»:
 *   • здания (11) — `prototypeData.ts` держит для тех же сущностей ДРУГИЕ имена и частью
 *     другие id (`Metal Mine` против шипнутого `Metal Extractor I`, `Radar Array` против
 *     `Sensor Array I`), поэтому «какое имя каноническое» — это решение про судьбу
 *     второго каталога, AUD-8;
 *   • учёные (5), `planetTypes` (1), `sectorKinds` (1) — механика, но это правка
 *     КОНТЕНТА, а не гейта; русский текст для учёных уже написан под `sci.*.name`.
 *  Заведён 2026-08-06 (AUD-4) на 24 записях; фракции (6) сняты в AUD-14 — у них с обоими
 *  каталогами имена совпадали, так что «какое каноническое» решать было нечего. */
const DATA_KEY_GAPS = new Set([
  'data.biomass-pit',
  'data.energy-nexus',
  'data.fortress',
  'data.fusion-reactor-i',
  'data.ground-marshal',
  'data.metal-extractor-i',
  'data.metal-extractor-ii',
  'data.microelectronics-fab-i',
  'data.missile-chief',
  'data.orbital-aa-battery',
  'data.orbital-shipyard',
  'data.polymath',
  'data.salvage-metal-rig-i',
  'data.sensor-array-i',
  'data.void-admiral',
  'data.void-station',
  'data.wing-commander',
]);

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

  it('в исходнике локали нет дублей ключей', () => {
    // В собранном объекте дубль невидим (побеждает последняя запись), а «мёртвый»
    // ранний текст тихо живёт в файле и путает правки (чистка 2026-07 сняла 20
    // таких записей в каждой локали). tsc словари не проверяет — держим тут.
    for (const file of ['localization/ru.ts', 'localization/en.ts']) {
      const seen = new Map<string, number>();
      for (const m of readFileSync(path.join(repoRoot, file), 'utf8').matchAll(/^ {2}'([^']+)':/gm)) {
        seen.set(m[1]!, (seen.get(m[1]!) ?? 0) + 1);
      }
      const dupes = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
      expect({ file, dupes }).toEqual({ file, dupes: [] });
    }
  });

  it('ключи, лежащие в полях игрового каталога, заведены в локали', () => {
    // `prototypeData.ts` хранит в части полей (`scientists.name`, `heroAbilities.*`,
    // описания технологий и фракций…) не текст, а КЛЮЧ — он уходит в `t()`
    // переменной, поэтому разбор литералов его не видит. Опечатка здесь доехала бы
    // до игрока сырым ключом: ровно так на экране совета учёных светилось
    // `sci.overseer.name`.
    // `hook` — ИДЕНТИФИКАТОР эффекта (`fleet.speed`), а не ключ: по форме он от ключа
    // неотличим, но переводится через таблицу `HERO_HOOK_RU` → `hero.hook.*`.
    const NOT_A_KEY = new Set(['hook']);
    const bad: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (!node || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (typeof v === 'string') {
          if (!NOT_A_KEY.has(k) && KEY_RE.test(v) && !(v in ru)) bad.push(`${path}.${k}: ${v}`);
        } else walk(v, `${path}.${k}`);
      }
    };
    walk(data, 'data');
    expect(bad.sort()).toEqual([]);
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

  it('у каждого имени в каталоге ПРОТОТИПА есть ключ `data.*`', () => {
    // Проверка выше смотрит только юнитов — а `tData()` так же показывает здания,
    // модули, фитинги, сектора и типы планет. Промах у них тихий: `tData()` вернёт
    // исходное английское имя, и в русском интерфейсе всплывёт «Spaceport» (именно
    // это здание и жило без ключа с LOC-1).
    // Каталог здесь — рукописный `prototypeData.ts`, то есть контент играбельного
    // прототипа. Шипнутый бандл (`data/*.json`) — ДРУГИЕ данные и другие тесты, ниже.
    // `object` вместо `{name?: string}`: у юнитов поля name нет вовсе, и weak-type
    // правило TS не даёт присвоить их таблицу «все-поля-опциональному» типу; имя
    // читается ниже через сужение — таблица без имён честно даёт пустой список.
    const tables: Array<[string, Record<string, object>]> = [
      ['buildings', data.buildings],
      ['units', data.units],
      ['modules', data.modules],
      ['heroFittings', data.heroFittings],
      ['sectors', data.sectors],
      ['planetTypes', data.planetTypes],
    ];
    const missing: string[] = [];
    for (const [table, items] of tables) {
      const entries = Object.entries(items ?? {});
      expect(entries.length, `таблица ${table} не должна молча опустеть`).toBeGreaterThan(0);
      for (const [id, def] of entries) {
        const name = (def as { name?: string } | undefined)?.name;
        if (name && !(dataKey(name) in ru))
          missing.push(`${table}.${id}: ${name} → ${dataKey(name)}`);
      }
    }
    expect(missing.sort()).toEqual([]);
  });

  // --- шипнутый бандл (`data/*.json`) ------------------------------------------
  // До AUD-4 гейт смотрел ТОЛЬКО каталог прототипа, поэтому 28 кириллических имён в
  // `data/*.json` жили годами зелёными (AUD-3). Эти три теста закрывают ту дыру: два
  // жёстких правила о самом имени (обойти их нечем — allowlist на них не действует) и
  // покрытие ключами с сокращающимся списком известных пробелов.

  it('имя шипнутого контента не схлопывается в голый `data.`', () => {
    // `dataKey()` вырезает всё, кроме `[a-z0-9]`. Имя без единого такого символа даёт
    // ключ `data.` — перевод недостижим на ЛЮБОЙ локали, включая русскую: игрок везде
    // видит исходную строку. Это тот самый отказ, ради которого кирпич и делался.
    const names = shippedNames();
    expect(names.length, 'разбор бандла не должен молча опустеть').toBeGreaterThan(50);
    const collapsed = names.filter(([, name]) => dataKey(name) === 'data.').map(([at]) => at);
    expect(collapsed.sort()).toEqual([]);
  });

  it('в именах шипнутого контента нет кириллицы', () => {
    // Не дубль проверки выше, а её недостающая половина: `dataKey('Мина II')` даёт
    // `data.ii` — ключ не голый, но перевод всё равно недостижим, а промах ещё и
    // маскируется под живой ключ. Правило простое: имя игровых ДАННЫХ английское,
    // русский текст живёт в локали (CLAUDE.md, раздел «Локализация»).
    const leaks = shippedNames()
      .filter(([, name]) => hasCyrillic(name))
      .map(([at, name]) => `${at}: ${name}`);
    expect(leaks.sort()).toEqual([]);
  });

  it('у каждого имени шипнутого контента есть ключ `data.*` — кроме известных пробелов', () => {
    // Покрытие проверяется по ОБЕИМ локалям: ключ только в `ru` показал бы англоязычному
    // игроку русский текст (запасной путь рантайма), а это ровно тот тихий промах,
    // который гейт и обязан ловить.
    const uncovered = new Set<string>();
    const named = new Map<string, string>(); // ключ → где встретился (для сообщения)
    for (const [at, name] of shippedNames()) {
      const k = dataKey(name);
      named.set(k, at);
      if (!(k in ru) || !(k in en)) uncovered.add(k);
    }
    const fresh = [...uncovered].filter((k) => !DATA_KEY_GAPS.has(k)).map((k) => `${named.get(k)} → ${k}`);
    expect(fresh.sort(), 'новая сущность без перевода — заведите ключ в ru.ts и en.ts').toEqual([]);

    // Обратная половина: без неё список никогда не сократится. Запись, для которой ключ
    // уже появился (или чьё имя переименовали), обязана уйти из DATA_KEY_GAPS в том же
    // PR — иначе allowlist зарастает мёртвыми строками, как это было с мостом LOC-2.
    const stale = [...DATA_KEY_GAPS].filter((k) => !uncovered.has(k));
    expect(stale.sort(), 'ключ появился или имя ушло — снимите запись из DATA_KEY_GAPS').toEqual([]);
  });
});
