/**
 * SD-1.3 — инъекция в БД: доказательство, а не обещание.
 *
 * Половину кирпича держит СТАТИКА: правило Semgrep `no-sql-string-interpolation`
 * (`.semgrep/rules/`) роняет CI на первом же `${}` внутри шаблона запроса, а два
 * исключения (`nosemgrep`) стоят на списках КОЛОНОК, а не на значениях. Статика,
 * однако, доказывает только форму кода: что БД правда обращается с враждебной строкой
 * как с ДАННЫМИ, видно лишь на живой базе. Этот файл — вторая половина.
 *
 * Тесты идут против настоящего Postgres и пропускаются без `DATABASE_URL` (как и
 * остальной durable-контракт): фальшивый «зелёный» на памяти здесь хуже пропуска —
 * in-memory адаптер SQL не исполняет вовсе и пройдёт любую строку.
 *
 * Что именно проверяется:
 *
 * 1. **Враждебная строка — ЗНАЧЕНИЕ, а не код.** Ник с `'; DROP TABLE seats; --`
 *    сохраняется и читается дословно, а таблица остаётся на месте. Это и есть разница
 *    между параметром `$1` и склейкой: склейка выполнила бы `DROP`.
 * 2. **JSON-значение — тот же параметр.** `GameState` уезжает в JSONB целиком, и
 *    SQL-текст внутри ЗНАЧЕНИЯ поля обязан вернуться байт-в-байт. Именно этот путь
 *    называет «Готово, когда» кирпича: JSON-операторы — известный вектор обхода WAF,
 *    и защищает здесь не WAF, а параметризация.
 * 3. **Поиск точный, а не по шаблону.** `%` и `_` — подстановочные знаки LIKE. Если
 *    хоть один поиск когда-нибудь переедет на LIKE, ник `%` начнёт находить ЧУЖИЕ
 *    места, и это тест поймает: `%` обязан найти ровно себя.
 * 4. **Экранирование не «съедает» символы.** Обратный слэш, кавычки и NUL-подобные
 *    последовательности возвращаются как есть: молчаливая порча ника — своя ошибка,
 *    просто не такая громкая, как инъекция.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createInitialState } from '@void/shared-core';
import { PostgresAccountStore, PostgresMatchStore, PostgresUserStore, migrate } from './postgres';

/** Строки, которыми ломают склейку. Каждая — живой приём, а не случайный мусор. */
const HOSTILE = {
  drop: `'; DROP TABLE seats; --`,
  comment: `admin'--`,
  union: `' UNION SELECT NULL, NULL, NULL --`,
  quote: `O'Brien "the \\ backslash"`,
  wildcard: `%`,
  underscore: `_`,
  jsonBreak: `{"a": 1}'); DROP TABLE matches; --`,
} as const;

const DB = process.env.DATABASE_URL;

// Подавления правила (`nosemgrep`) остаются честными, только пока подставляется
// КОНСТАНТА-перечень колонок. Сторож читает исходник и проверяет это сам, поэтому
// новое подавление, поставленное над чем угодно другим, роняет тест, а не проезжает
// мимо. База здесь не нужна: это вопрос о форме кода.
describe('SD-1.3 — в шаблон запроса попадают только списки колонок', () => {
  const src = readFileSync(new URL('./postgres.ts', import.meta.url), 'utf8');
  /** Литералы модульных констант: `const NAME = '…'` (возможно, с переносом строки). */
  const consts = new Map<string, string>();
  for (const m of src.matchAll(/^const ([A-Z][A-Z0-9_]*) =\s*\n?\s*'([^']*)'/gm))
    consts.set(m[1]!, m[2]!);
  // Ищем по САМИМ шаблонам, а не по вызову `.query(`: между скобкой и шаблоном стоит
  // комментарий `nosemgrep`, и привязка к вызову молча перестала бы что-либо находить.
  const sqlTemplates = [...src.matchAll(/`(?:[^`\\]|\\.)*`/g)]
    .map((m) => m[0])
    .filter((t) => /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i.test(t));
  const spliced = sqlTemplates.flatMap((t) =>
    [...t.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]!.trim()),
  );

  it('подстановки есть, и все они — известные константы', () => {
    expect(sqlTemplates.length).toBeGreaterThan(50); // иначе сторож молча проверяет пустоту
    expect(spliced.length).toBeGreaterThan(0);
    for (const name of spliced) expect([name, consts.has(name)]).toEqual([name, true]);
  });

  it('каждая такая константа — перечень идентификаторов, ничего больше', () => {
    for (const name of new Set(spliced))
      expect([name, consts.get(name)]).toEqual([name, expect.stringMatching(/^[a-z_]+(?:, [a-z_]+)*$/)]);
  });
});

// Правило Semgrep живёт в `.semgrep/rules/` и гоняется в security-пайплайне, то есть
// НЕ в `pnpm run check`. Сторож ниже прогоняет ЕГО ЖЕ регулярки по серверным исходникам
// прямо в гейте — те же выражения, прочитанные из того же файла, поэтому разъехаться
// правилу и сторожу нечем.
describe('SD-1.3 — склейка запроса не проходит и локальный гейт', () => {
  const yaml = readFileSync(new URL('../../../../.semgrep/rules/no-sql-string-interpolation.yaml', import.meta.url), 'utf8');
  // YAML-скаляр в одинарных кавычках: удвоенная кавычка внутри значит одну.
  const patterns = [...yaml.matchAll(/- pattern-regex: '((?:[^']|'')*)'/g)].map(
    (m) => new RegExp(m[1]!.replaceAll("''", "'")),
  );
  const sources = ['./postgres.ts', '../metaMarket.ts'].map((rel) => ({
    rel,
    text: readFileSync(new URL(rel, import.meta.url), 'utf8'),
  }));

  it('регулярки правила прочитаны, и их две', () => {
    expect(patterns).toHaveLength(2);
  });

  for (const { rel, text } of sources)
    it(`${rel} — ни интерполяции, ни конкатенации в запросе`, () => {
      for (const re of patterns) {
        const hit = re.exec(text);
        // В сообщении — сам кусок кода: искать его по номеру строки не придётся.
        expect([rel, hit?.[0] ?? null]).toEqual([rel, null]);
      }
    });
});

describe.skipIf(!DB)('SD-1.3 — враждебный ввод против живого Postgres', () => {
  const pool = new Pool({ connectionString: DB });
  // Общие таблицы между прогонами: метка разводит ряды, но НЕ вычищает враждебность
  // из проверяемой части строки — она остаётся ровно такой, какой её пишет злоумышленник.
  const stamp = `${process.pid}_${Date.now()}`;
  const uniq = (p: string): string => `${p}_${stamp}`;

  beforeAll(async () => {
    await migrate(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  /** Живы ли таблицы, по которым били. Пустой список = ни одна не исчезла. */
  const missingTables = async (): Promise<string[]> => {
    const r = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [['seats', 'matches', 'users']],
    );
    const found = new Set(r.rows.map((x) => x.table_name));
    return ['seats', 'matches', 'users'].filter((t) => !found.has(t));
  };

  it('ник с `DROP TABLE` — это ник (правило 1)', async () => {
    const store = new PostgresAccountStore(pool);
    const room = uniq('inj-room');
    const nick = `${HOSTILE.drop} ${stamp}`;
    const seat = await store.resolveSeat(room, nick, ['p1', 'p2']);
    expect(seat?.playerId).toBe('p1');
    // Тот же ник возвращается на своё место — строка сравнилась ДОСЛОВНО.
    expect(await store.seatOf(room, nick)).toBe('p1');
    expect(await missingTables()).toEqual([]);
  });

  it('комментарий SQL не обрезает запрос: `admin\'--` не занимает чужое место', async () => {
    const store = new PostgresAccountStore(pool);
    const room = uniq('inj-comment');
    await store.resolveSeat(room, `${HOSTILE.comment} ${stamp}`, ['p1', 'p2']);
    // Соседний ник — своё, ОТДЕЛЬНОЕ место: первая строка не «закомментировала» условие.
    const other = await store.resolveSeat(room, `admin ${stamp}`, ['p1', 'p2']);
    expect(other?.playerId).toBe('p2');
    expect(await store.seatOf(room, `admin ${stamp}`)).toBe('p2');
  });

  it('SQL внутри JSON-ЗНАЧЕНИЯ возвращается байт-в-байт (правило 2)', async () => {
    const store = new PostgresMatchStore(pool);
    const matchId = uniq('inj-json');
    const s = createInitialState({ seed: 'inj', version: { data: 't', manifest: 't' } });
    // Враждебные строки уезжают ВЛОЖЕННЫМИ значениями объекта (имя и фракция игрока) —
    // ровно так их и приносит игрок: свежее состояние игроков ещё не содержит, места
    // занимают позже. Обе строки едут в JSONB одним параметром.
    const me = 'p1';
    s.players[me] = {
      id: me,
      name: HOSTILE.jsonBreak,
      faction: HOSTILE.union,
      status: 'active',
      resources: {},
    };
    await store.save({ matchId, dataVersion: 't', seq: 1, status: 'ongoing', state: s });
    const loaded = await store.load(matchId);
    expect(loaded?.state.players[me]?.name).toBe(HOSTILE.jsonBreak);
    expect(loaded?.state.players[me]?.faction).toBe(HOSTILE.union);
    expect(loaded?.state).toEqual(s);
    expect(await missingTables()).toEqual([]);
    // И нормализованная колонка рядом с блобом не пострадала.
    expect(await store.ongoingMatchIds()).toContain(matchId);
  });

  it('`%` и `_` — обычные символы, а не шаблон поиска (правило 3)', async () => {
    const store = new PostgresAccountStore(pool);
    const room = uniq('inj-like');
    await store.resolveSeat(room, `${HOSTILE.wildcard}${stamp}`, ['p1', 'p2']);
    await store.resolveSeat(room, `${HOSTILE.underscore}${stamp}`, ['p1', 'p2']);
    // Каждый нашёл СВОЁ место: будь поиск по LIKE, `%` совпал бы с обоими.
    expect(await store.seatOf(room, `${HOSTILE.wildcard}${stamp}`)).toBe('p1');
    expect(await store.seatOf(room, `${HOSTILE.underscore}${stamp}`)).toBe('p2');
    // И ник, которого нет, не находится «по шаблону» соседа.
    expect(await store.seatOf(room, `нет-такого-${stamp}`)).toBeNull();
  });

  it('кавычки и слэши доезжают целыми (правило 4)', async () => {
    const store = new PostgresUserStore(pool);
    const login = `${HOSTILE.quote} ${stamp}`;
    const created = await store.createUser(login, 'hash');
    expect(created.ok).toBe(true);
    const found = await store.findUser(login);
    expect(found?.login).toBe(login);
    // Тот же логин повторно — отказ, а не второй аккаунт: сравнение точное.
    const again = await store.createUser(login, 'hash2');
    expect(again).toEqual({ ok: false, code: 'E_LOGIN_TAKEN' });
  });
});
