/**
 * Учение восстановления БД (SE-3.4).
 *
 * Бэкап, из которого ни разу не восстанавливались, — это не бэкап, а предположение.
 * До этого файла в репозитории было именно предположение: процедура жила строкой
 * crontab в `deploy/README.md`, и проверить её было нечем.
 *
 * Здесь настоящий `pg_dump` снимает настоящую базу, база РАЗРУШАЕТСЯ до нуля таблиц,
 * `restore.sh` поднимает её обратно, и содержимое сверяется по отпечатку каждой
 * таблицы. Postgres НЕ подменяется намеренно: `update.test.mjs` рядом ставит заглушки
 * внешних команд, потому что проверяет, КАКИЕ вызовы делает скрипт, — а учение обязано
 * доказать, что ДАННЫЕ ВЕРНУЛИСЬ, и подменённый `pg_dump` этого не докажет. Заглушка
 * здесь ровно одна и на другом месте: `age` в тесте проводки шифрования, где предмет
 * проверки — наши флаги, а не чужая криптография.
 *
 * Каждый сторож скриптов проверен мутацией: снятый маркер полноты, выключенное
 * шифрование и убранный `--single-transaction` роняют соответствующий тест.
 *
 * Учение работает в СВОЕЙ базе (`void_backup_drill`), а не в той, что указана в
 * `DATABASE_URL`: по этому адресу в CI живёт `void_test`, который параллельно
 * использует `store.test.ts`, и разрушать его посреди прогона нельзя.
 *
 * Без `DATABASE_URL` набор пропускается — как и `store.test.ts`, чей путь к Postgres
 * гейтится тем же способом. В CI переменная задана, и учение бежит на каждый пуш.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const run = promisify(execFile);
const DEPLOY_DIR = dirname(fileURLToPath(import.meta.url));
const BACKUP_SH = join(DEPLOY_DIR, 'backup.sh');
const RESTORE_SH = join(DEPLOY_DIR, 'restore.sh');

const BASE_URL = process.env.DATABASE_URL;
/** Отдельная база под учение — на том же сервере, что и `DATABASE_URL`. Подменяем
 *  последний сегмент пути строкой, а не через `new URL`: форма с unix-сокетом
 *  (`postgresql://void@/void?host=/var/run/postgresql`) имеет ПУСТОЙ хост, и WHATWG-URL
 *  её отвергает — а именно так к базе ходят локально и в не-docker развёртывании. */
const drillUrl = (name) => {
  const [conn, query] = BASE_URL.split('?');
  return `${conn.replace(/\/[^/]*$/, `/${name}`)}${query ? `?${query}` : ''}`;
};
const DRILL_DB = 'void_backup_drill';

/** `age` есть локально, но на раннере GitHub его нет, а ставить пакет мимо политики
 *  пиннинга (docs/security/image-pinning.md) ради одного теста — плохой размен. Поэтому
 *  НАСТОЯЩИЙ криптокруг гоняется там, где `age` есть, а везде, CI включая, работают две
 *  проверки без него: отказ при ненастроенном шифровании и проводка через заглушку.
 *
 *  Проверка СИНХРОННАЯ и на уровне модуля: `it.skipIf(...)` вычисляется при сборе
 *  тестов, то есть ДО `beforeAll`, — флаг, выставленный там, всегда остался бы `false`,
 *  и шифрованный круг молча не бежал бы даже там, где `age` есть. */
const hasAge = (() => {
  try {
    execFileSync('age', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const psql = (url, sql) => run('psql', ['-tAqX', '-v', 'ON_ERROR_STOP=1', '-d', url, '-c', sql]);

/** Порядконезависимый отпечаток каждой таблицы: строки сортируются как текст, поэтому
 *  смена физического порядка при restore отпечаток не двигает, а потеря/порча — двигает. */
async function fingerprint(url) {
  const { stdout } = await psql(
    url,
    `select t.tablename from pg_tables t where t.schemaname='public' order by 1`,
  );
  const tables = stdout.split('\n').filter(Boolean);
  const out = [];
  for (const t of tables) {
    const { stdout: h } = await psql(
      url,
      `select coalesce(md5(string_agg(x::text,'' order by x::text)),'EMPTY') from public."${t}" x`,
    );
    out.push(`${h.trim()} ${t}`);
  }
  return out;
}

/** Схема учения повторяет РИСКОВЫЕ формы боевой схемы (`migrate()`): JSONB-состояние
 *  матча, `timestamptz`, уникальный индекс, NULL-евое поле. Именно они переживают
 *  dump/restore не сами собой. */
const FIXTURE = `
  CREATE TABLE matches (
    id           text PRIMARY KEY,
    data_version text NOT NULL,
    seq          integer NOT NULL,
    state        jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE users (
    id        text PRIMARY KEY,
    login     text NOT NULL,
    pass_hash text NOT NULL,
    email     text
  );
  CREATE UNIQUE INDEX users_login_idx ON users (lower(login));
  INSERT INTO matches (id, data_version, seq, state) VALUES
    ('m1', '0.1.17', 42, '{"tick":7,"fleets":[{"id":"f1","hp":3.5}],"note":"кавычка \\" и \\\\ слэш"}'),
    ('m2', '0.1.17', 0,  '{}');
  INSERT INTO users (id, login, pass_hash, email) VALUES
    ('u1', 'Командор', 'argon2$abc', 'a@b.c'),
    ('u2', 'vasya',    'argon2$def', NULL);
`;

describe.skipIf(!BASE_URL)('учение: бэкап → разрушение → restore (SE-3.4)', () => {
  let dir;
  let env;

  const seed = async () => {
    await psql(BASE_URL, `DROP DATABASE IF EXISTS ${DRILL_DB} WITH (FORCE)`);
    await psql(BASE_URL, `CREATE DATABASE ${DRILL_DB}`);
    await psql(drillUrl(DRILL_DB), FIXTURE);
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'void-drill-'));
    env = { ...process.env, DATABASE_URL: drillUrl(DRILL_DB), BACKUP_DIR: dir, PGTZ: 'UTC' };
    await seed();
  }, 60_000);

  afterAll(async () => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (BASE_URL) await psql(BASE_URL, `DROP DATABASE IF EXISTS ${DRILL_DB} WITH (FORCE)`);
  }, 30_000);

  /** Свой каталог на тест: иначе тесты читают бэкапы друг друга через `newest()` и
   *  начинают зависеть от порядка выполнения — запустить один тест по имени станет
   *  нельзя, а падение первого превратится в каскад. */
  const freshDir = () => mkdtempSync(join(dir, 'run-'));
  const backup = (into, extra = {}) =>
    run('bash', [BACKUP_SH], { env: { ...env, BACKUP_DIR: into, ...extra } });
  const restore = (file, extra = {}) =>
    run('bash', [RESTORE_SH, file], { env: { ...env, ...extra } });
  const newest = (into, suffix) =>
    join(into, readdirSync(into).filter((f) => f.endsWith(suffix)).sort().at(-1));

  /** Готовый открытый бэкап под тесты, которым нужен ИСХОДНЫЙ материал для порчи. */
  const plainBackup = async () => {
    const into = freshDir();
    await backup(into, { BACKUP_PLAINTEXT: '1' });
    return newest(into, '.sql.gz');
  };

  it('без настроенного шифрования бэкап ОТКАЗЫВАЕТ, а не выдаёт открытый дамп', async () => {
    // Fail-secure (инвариант 4). Дамп несёт `users.pass_hash` и почту — умолчание,
    // при котором он молча ложится на диск открытым, было бы утечкой по невнимательности.
    const into = freshDir();
    await expect(backup(into)).rejects.toThrow(/BACKUP_AGE_RECIPIENT/);
    expect(readdirSync(into), 'отказ не должен оставлять файлов').toEqual([]);
  }, 60_000);

  it('полный круг: база разрушена до нуля таблиц и восстановлена побайтово', async () => {
    const before = await fingerprint(drillUrl(DRILL_DB));
    expect(before).toHaveLength(2);

    const file = await plainBackup();

    // Разрушение — не «очистка таблиц», а потеря базы целиком: именно так выглядит
    // авария, ради которой бэкап и заводят.
    await psql(BASE_URL, `DROP DATABASE ${DRILL_DB} WITH (FORCE)`);
    await psql(BASE_URL, `CREATE DATABASE ${DRILL_DB}`);
    expect(await fingerprint(drillUrl(DRILL_DB)), 'база должна быть пуста').toEqual([]);

    await restore(file);
    expect(await fingerprint(drillUrl(DRILL_DB))).toEqual(before);
  }, 120_000);

  it('ОБРЕЗАННЫЙ дамп отвергается, и база остаётся цела', async () => {
    // Ключевой случай учения. Обрезанный дамп не содержит ОШИБОК — он выполняет DROP
    // всех таблиц и просто кончается, поэтому наивный `psql < dump` уничтожает базу с
    // кодом возврата 0 (на настоящем кластере: было 26 таблиц, осталось 10). Контрольная
    // сумма тут тоже бессильна — у обрезанного файла она честная. Ловит только маркер.
    const src = await plainBackup();
    const truncated = join(dirname(src), 'truncated.sql.gz');
    const plain = gunzipSync(readFileSync(src));
    const cut = plain.subarray(0, Math.floor(plain.length * 0.6));
    // Сторож самого теста: обрезка ДОЛЖНА снести хвостовой маркер. Фиксированное число
    // байт этого не гарантировало — на маленьком дампе «обрезанный» файл оказывался
    // целым, и тест молча переставал проверять то, ради чего написан.
    expect(cut.includes('PostgreSQL database dump complete'), 'обрезка не сняла маркер').toBe(
      false,
    );
    writeFileSync(truncated, gzipSync(cut));
    writeFileSync(
      `${truncated}.sha256`,
      `${createHash('sha256').update(readFileSync(truncated)).digest('hex')}  truncated.sql.gz\n`,
    );

    const before = await fingerprint(drillUrl(DRILL_DB));
    await expect(restore(truncated)).rejects.toThrow(/ОБОРВАН/);
    expect(await fingerprint(drillUrl(DRILL_DB)), 'база не должна пострадать').toEqual(before);
  }, 60_000);

  it('порча архива в хранилище ловится ДО того, как база тронута', async () => {
    const src = await plainBackup();
    const bad = join(dirname(src), 'bad.sql.gz');
    const bytes = readFileSync(src);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    writeFileSync(bad, bytes);
    writeFileSync(`${bad}.sha256`, `${'0'.repeat(64)}  bad.sql.gz\n`);

    const before = await fingerprint(drillUrl(DRILL_DB));
    await expect(restore(bad)).rejects.toThrow(/сумма НЕ СОВПАЛА/);
    expect(await fingerprint(drillUrl(DRILL_DB))).toEqual(before);
  }, 60_000);

  it('ошибка ПОСРЕДИ применения откатывает всё — половины восстановления не бывает', async () => {
    // Третий сторож, и единственный отказ, который первые два пропускают: файл цел,
    // сумма верна, маркер на месте — но дамп не ложится (конфликт версий, нехватка
    // прав). Без `--single-transaction` база осталась бы наполовину восстановленной:
    // DROP всех таблиц уже прошёл, а данные ещё нет.
    const file = await plainBackup(); // снимок состояния А
    // Уводим базу в состояние Б, чтобы откат был ОТЛИЧИМ от успешного применения:
    // будь дамп применён, строка исчезла бы вместе с состоянием А.
    await psql(drillUrl(DRILL_DB), `INSERT INTO users (id, login, pass_hash) VALUES ('u3','later','x')`);
    const stateB = await fingerprint(drillUrl(DRILL_DB));

    // Портим дамп В СЕРЕДИНЕ, оставляя хвостовой маркер нетронутым: сторож полноты
    // такой файл пропускает — ловить обязан именно ON_ERROR_STOP.
    const broken = join(dirname(file), 'broken.sql.gz');
    const text = gunzipSync(readFileSync(file)).toString('utf8');
    const marker = '-- PostgreSQL database dump complete';
    expect(text).toContain(marker);
    writeFileSync(
      broken,
      gzipSync(Buffer.from(text.replace(marker, `SELECT 1 / 0;\n${marker}`), 'utf8')),
    );
    writeFileSync(
      `${broken}.sha256`,
      `${createHash('sha256').update(readFileSync(broken)).digest('hex')}  broken.sql.gz\n`,
    );

    await expect(restore(broken)).rejects.toThrow();
    expect(await fingerprint(drillUrl(DRILL_DB)), 'база обязана остаться в состоянии Б').toEqual(
      stateB,
    );
  }, 60_000);

  it('архив без контрольной суммы не восстанавливают молча', async () => {
    const src = await plainBackup();
    const orphan = join(dirname(src), 'orphan.sql.gz');
    writeFileSync(orphan, readFileSync(src));
    await expect(restore(orphan)).rejects.toThrow(/целостность недоказуема/);
  }, 60_000);

  it('проводка шифрования: наружу уходит ВЫВОД age, и он же восстанавливается', async () => {
    // Этот тест бежит ВЕЗДЕ, в том числе в CI, где `age` не установлен: настоящий пакет
    // подменяется заглушкой на PATH — приём, которым рядом пользуется `update.test.mjs`.
    // Шифрование — путь ПО УМОЛЧАНИЮ (открытый бэкап скрипт отказывается делать), и
    // оставить его проводку непроверенной на гейте значило бы пускать в main регрессию
    // в единственном разрешённом режиме. Криптостойкость тут не проверяется — она
    // свойство age, а не наше; её проверяет соседний тест там, где age есть.
    const into = freshDir();
    const bin = mkdtempSync(join(dir, 'bin-'));
    const log = join(bin, 'calls.log');
    writeFileSync(log, '');
    // Заглушка обратима: «шифрует» восьмибайтовым заголовком, «расшифровывает» его
    // срезанием — так через неё проходит ВЕСЬ круг, и проверяется наша проводка целиком.
    writeFileSync(
      join(bin, 'age'),
      `#!/bin/bash
echo "age $*" >> "${log}"
mode=enc; out=; inp=; ident=
while [ $# -gt 0 ]; do
  case "$1" in
    -d) mode=dec ;;
    -r) shift ;;
    -i) ident="$2"; shift ;;
    -o) out="$2"; shift ;;
    --version) echo stub; exit 0 ;;
    *) inp="$1" ;;
  esac
  shift
done
if [ "$mode" = enc ]; then { printf 'STUBAGE\\n'; cat "$inp"; } > "$out"
else [ -s "$ident" ] || { echo "нет ключа" >&2; exit 1; }; tail -c +9 "$inp" > "$out"; fi
`,
    );
    chmodSync(join(bin, 'age'), 0o755);
    const key = join(bin, 'id.key');
    writeFileSync(key, 'STUB-IDENTITY\n');
    const withStub = { PATH: `${bin}:${process.env.PATH}` };

    const before = await fingerprint(drillUrl(DRILL_DB));
    await backup(into, { BACKUP_AGE_RECIPIENT: 'age1stub', ...withStub });

    const enc = newest(into, '.age');
    // Прямое утверждение: наружу отдан именно вывод age. Проверять «в каталоге нет
    // .sql.gz» было бы пустой проверкой — открытый файл лежит во временном каталоге и
    // умирает вместе с ним по trap в любом случае, даже если шифрование забыли.
    expect(readFileSync(enc).subarray(0, 8).toString()).toBe('STUBAGE\n');
    expect(readFileSync(log, 'utf8')).toMatch(/age -r age1stub -o \S+\.age \S+\.sql\.gz/);

    await psql(BASE_URL, `DROP DATABASE ${DRILL_DB} WITH (FORCE)`);
    await psql(BASE_URL, `CREATE DATABASE ${DRILL_DB}`);
    await restore(enc, { BACKUP_AGE_IDENTITY: key, ...withStub });
    expect(readFileSync(log, 'utf8')).toMatch(/age -d -i \S+id\.key/);
    expect(await fingerprint(drillUrl(DRILL_DB))).toEqual(before);
  }, 120_000);

  it.skipIf(!hasAge)('зашифрованный круг: архив нечитаем без ключа и восстанавливается с ним', async () => {
    const into = freshDir();
    const key = join(into, 'drill.key');
    const { stderr } = await run('age-keygen', ['-o', key]);
    const recipient = /age1[a-z0-9]+/.exec(stderr)[0];

    const before = await fingerprint(drillUrl(DRILL_DB));
    await backup(into, { BACKUP_AGE_RECIPIENT: recipient });
    const enc = newest(into, '.age');

    // Захват бэкап-хоста не должен раскрывать содержимое: на нём лежит только
    // ПУБЛИЧНЫЙ ключ, приватный там не нужен.
    const raw = readFileSync(enc).toString('latin1');
    expect(raw).not.toContain('PostgreSQL database dump');
    expect(raw).not.toContain('argon2$abc');
    await expect(restore(enc)).rejects.toThrow(/BACKUP_AGE_IDENTITY/);

    await psql(BASE_URL, `DROP DATABASE ${DRILL_DB} WITH (FORCE)`);
    await psql(BASE_URL, `CREATE DATABASE ${DRILL_DB}`);
    await restore(enc, { BACKUP_AGE_IDENTITY: key });
    expect(await fingerprint(drillUrl(DRILL_DB))).toEqual(before);
  }, 120_000);
});
