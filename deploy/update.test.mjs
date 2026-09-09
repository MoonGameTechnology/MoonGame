/**
 * Тесты механизма обновления прода (OPS-1).
 *
 * До OPS-1 скрипт обновления жил в heredoc установщика и на диске появлялся ОДИН раз,
 * при установке, — покрыть его тестом было физически нечем: файла в репозитории не
 * существовало. Теперь `deploy/update.sh` — обычный файл репозитория, и здесь
 * проверяется именно то, ради чего его переносили:
 *
 * 1. Скрипт считает пути ОТ СЕБЯ (он лежит на уровень глубже, чем раньше) — иначе
 *    переезд молча сломал бы git-каталог и compose-файлы.
 * 2. Установщик больше не несёт копию логики, а хелпер `moongame update` зовёт файл
 *    репозитория. Это машинная проверка «Готово, когда» кирпича: пока копия жива,
 *    развёрнутая машина продолжит исполнять её, а не свежий код.
 * 3. Поведение самого обновления (гейт подписи, откат по здоровью) переезд не изменил.
 *
 * Внешние команды подменяются заглушками на PATH: живой git/docker/systemctl в тесте
 * не участвует, проверяется КАКИЕ вызовы скрипт делает и в каком порядке.
 */
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const DEPLOY_DIR = dirname(fileURLToPath(import.meta.url));
const UPDATE_SH = join(DEPLOY_DIR, 'update.sh');
const INSTALLER = join(DEPLOY_DIR, 'install-ubuntu.sh');
const ENV_KEYS_SH = join(DEPLOY_DIR, 'env-keys.sh');

/** Заглушка-исполняемый файл: пишет свой вызов в лог и ведёт себя по сценарию. */
function stub(binDir, name, body) {
  const file = join(binDir, name);
  writeFileSync(file, `#!/bin/bash\n${body}\n`);
  chmodSync(file, 0o755);
}

/**
 * Песочница: клон репозитория с настоящим `update.sh` + заглушки внешних команд.
 * `healthFailFirst` — сколько первых проверок `/health` считать провальными
 * (так тест доходит до отката, не дожидаясь реальных таймаутов).
 */
function sandbox({ verifyExit = 0, healthFailFirst = 0, branch = 'playtest', serverEnv = '# stub\n' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'void-update-'));
  const repo = join(root, 'repo');
  const deploy = join(repo, 'deploy');
  const bin = join(root, 'bin');
  mkdirSync(deploy, { recursive: true });
  mkdirSync(bin, { recursive: true });

  writeFileSync(join(deploy, 'update.sh'), readFileSync(UPDATE_SH));
  chmodSync(join(deploy, 'update.sh'), 0o755);
  // Настоящий, не заглушка: добор ключей — часть проверяемого поведения.
  writeFileSync(join(deploy, 'env-keys.sh'), readFileSync(ENV_KEYS_SH));
  for (const f of ['docker-compose.yml', 'docker-compose.release.yml']) {
    writeFileSync(join(deploy, f), '# stub\n');
  }
  writeFileSync(join(deploy, 'server.env'), serverEnv);

  const log = join(root, 'calls.log');
  writeFileSync(log, '');
  const counter = join(root, 'health.count');
  writeFileSync(counter, '0');

  stub(bin, 'git', `echo "git $*" >> "$LOG"
if [ "$3" = "rev-parse" ]; then echo "${branch}"; fi`);
  stub(
    bin,
    'docker',
    `echo "docker[VOID_IMAGE=\${VOID_IMAGE:-}] $*" >> "$LOG"
case "$*" in
  *" ps -q server"*) echo "container-1" ;;
  inspect*) echo "sha256:prev-image" ;;
  *config\\ --images*) echo "moongame-server:local" ;;
esac`,
  );
  stub(bin, 'systemctl', `echo "systemctl $*" >> "$LOG"`);
  // sudo прозрачен: в песочнице владелец каталога — сам тестовый пользователь.
  stub(bin, 'sudo', `if [ "$1" = "-u" ]; then shift 2; fi\nexec "$@"`);
  stub(
    bin,
    'curl',
    `echo "curl $*" >> "$LOG"
n=$(cat "$HEALTH_COUNT"); n=$((n + 1)); echo "$n" > "$HEALTH_COUNT"
[ "$n" -le "$HEALTH_FAIL_FIRST" ] && exit 7
exit 0`,
  );
  stub(bin, 'sleep', 'exit 0'); // тест не ждёт реальных пауз
  writeFileSync(
    join(deploy, 'verify-image.sh'),
    `#!/bin/bash\necho "verify-image $*" >> "$LOG"\nexit ${verifyExit}\n`,
  );
  chmodSync(join(deploy, 'verify-image.sh'), 0o755);

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    LOG: log,
    HEALTH_COUNT: counter,
    HEALTH_FAIL_FIRST: String(healthFailFirst),
    HEALTH_TRIES: '1',
  };
  return {
    root,
    repo,
    deploy,
    env,
    readLog: () => readFileSync(log, 'utf8'),
    readEnvFile: () => readFileSync(join(deploy, 'server.env'), 'utf8'),
  };
}

async function runUpdate(sb, extraEnv = {}) {
  try {
    const { stdout } = await run('bash', [join(sb.deploy, 'update.sh')], {
      env: { ...sb.env, ...extraEnv },
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('deploy/update.sh — сборка из исходников', () => {
  it('обновляет ТЕКУЩУЮ ветку в каталоге репозитория, а не в собственном каталоге', async () => {
    const sb = sandbox({ branch: 'playtest' });
    const res = await runUpdate(sb);

    expect(res.code).toBe(0);
    const log = sb.readLog();
    // Ключевая проверка переезда: скрипт лежит в deploy/, а git обязан работать
    // на КОРНЕ клона — иначе `-C` указал бы в deploy/ и обновление не сработало бы.
    expect(log).toContain(`git -C ${sb.repo} fetch origin playtest`);
    expect(log).toContain(`git -C ${sb.repo} merge --ff-only origin/playtest`);
    expect(log).not.toContain(`git -C ${sb.deploy}`);
  });

  it('берёт compose-файлы и server.env из своего каталога deploy/', async () => {
    const sb = sandbox();
    await runUpdate(sb);

    const log = sb.readLog();
    expect(log).toContain(`--env-file ${sb.deploy}/server.env`);
    expect(log).toContain(`-f ${sb.deploy}/docker-compose.yml`);
  });

  it('пересобирает образ и перезапускает сервис, когда /health отвечает', async () => {
    const sb = sandbox();
    const res = await runUpdate(sb);

    expect(res.code).toBe(0);
    const log = sb.readLog();
    expect(log).toMatch(/docker\[[^\]]*] compose .* build/);
    expect(log).toContain('systemctl restart moongame');
    // Ровно один рестарт: откат не запускался.
    expect(log.match(/^systemctl restart moongame$/gm)).toHaveLength(1);
  });

  it('BRANCH из окружения перебивает текущую ветку', async () => {
    const sb = sandbox({ branch: 'playtest' });
    await runUpdate(sb, { BRANCH: 'main' });

    expect(sb.readLog()).toContain('fetch origin main');
  });

  it('мёртвый /health → откат на предыдущий образ и ненулевой код', async () => {
    // Первая проверка здоровья (после рестарта) проваливается, вторая (после отката) — нет.
    const sb = sandbox({ healthFailFirst: 1 });
    const res = await runUpdate(sb);

    expect(res.code).toBe(1);
    const log = sb.readLog();
    expect(log).toContain('docker[VOID_IMAGE=] tag sha256:prev-image moongame-server:local');
    expect(log.match(/^systemctl restart moongame$/gm)).toHaveLength(2);
  });
});

describe('deploy/update.sh — путь подписанного образа', () => {
  const IMAGE = 'ghcr.io/moongametechnology/moongame@sha256:deadbeef';

  it('непроверенная подпись → сервер не тронут', async () => {
    const sb = sandbox({ verifyExit: 1 });
    const res = await runUpdate(sb, { VOID_IMAGE: IMAGE });

    expect(res.code).toBe(1);
    const log = sb.readLog();
    expect(log).toContain(`verify-image ${IMAGE}`);
    expect(log).not.toContain('docker[');
    expect(log).not.toContain('systemctl');
  });

  it('подпись подтверждена → образ поднят и записан как последний хороший', async () => {
    const sb = sandbox();
    const res = await runUpdate(sb, { VOID_IMAGE: IMAGE });

    expect(res.code).toBe(0);
    const log = sb.readLog();
    expect(log).toContain(`pull ${IMAGE}`);
    expect(log).toContain(`docker[VOID_IMAGE=${IMAGE}] compose`);
    // Точка отката лежит рядом с клоном, а не внутри deploy/.
    expect(readFileSync(join(sb.repo, '.last-good-image'), 'utf8').trim()).toBe(IMAGE);
  });

  it('мёртвый /health → стек поднимается на образе из .last-good-image', async () => {
    const sb = sandbox({ healthFailFirst: 1 });
    const prev = 'ghcr.io/moongametechnology/moongame@sha256:0ldimage';
    writeFileSync(join(sb.repo, '.last-good-image'), `${prev}\n`);

    const res = await runUpdate(sb, { VOID_IMAGE: IMAGE });

    expect(res.code).toBe(1);
    // Откат передаёт предыдущий образ ЯВНО — унаследованный VOID_IMAGE здесь чужой.
    expect(sb.readLog()).toContain(`docker[VOID_IMAGE=${prev}] compose`);
    // Провалившийся образ хорошим не записан.
    expect(readFileSync(join(sb.repo, '.last-good-image'), 'utf8').trim()).toBe(prev);
  });
});

describe('install-ubuntu.sh — механизм обновления больше не копируется на диск', () => {
  const installer = readFileSync(INSTALLER, 'utf8');

  it('скрипт обновления существует в репозитории и исполняем', () => {
    expect(existsSync(UPDATE_SH)).toBe(true);
    expect(readFileSync(UPDATE_SH, 'utf8').startsWith('#!/bin/bash')).toBe(true);
  });

  it('установщик не генерирует update-dev.sh собственным heredoc', () => {
    // Ровно та ловушка, ради которой заведён OPS-1: сгенерированная копия остаётся на
    // хосте навсегда, и починка механизма обновления до машины не доезжает.
    expect(installer).not.toContain('UPDATEEOF');
    expect(installer).not.toMatch(/cat > "\$INSTALL_DIR\/update-dev\.sh"/);
  });

  it('хелпер moongame update зовёт файл репозитория, а не копию', () => {
    expect(installer).toContain('$INSTALL_DIR/deploy/update.sh');
    expect(installer).not.toMatch(/bash \$INSTALL_DIR\/update-dev\.sh/);
  });
});

/**
 * OPS-2. Добор ключей `server.env` при обновлении.
 *
 * Дефект нашёлся на живом сервере: установщик пишет этот файл РОВНО ОДИН РАЗ и потом
 * бережно сохраняет, а обновление его только читало. Значит ключ, добавленный в
 * установщик позже, до развёрнутой машины не доезжал никогда. Так на сервере владельца
 * потерялись `TIME_SCALE` (мир шёл в реальном времени, постройки по 3–24 часа — на
 * плейтесте «ничего не происходило») и `AUTH_JWT_SECRET` — а без него сервер стоит
 * БЕЗ АККАУНТОВ: место в партии берёт любой, кто знает позывной.
 */
describe('update.sh — добор недостающих ключей server.env (OPS-2)', () => {
  it('дописывает ключи, которых в файле нет', async () => {
    const sb = sandbox({ serverEnv: '# старый файл\nPORT=8788\n' });
    await runUpdate(sb);
    const env = sb.readEnvFile();
    expect(env).toMatch(/^TIME_SCALE=100$/m);
    expect(env).toMatch(/^GATE=1$/m);
    expect(env).toMatch(/^SEAT_LOCK=1$/m);
    // Секрет генерируется, а не берётся из константы: 32 байта hex.
    expect(env).toMatch(/^AUTH_JWT_SECRET=[0-9a-f]{64}$/m);
  });

  it('НЕ трогает значение, которое оператор уже выставил', async () => {
    const sb = sandbox({ serverEnv: 'TIME_SCALE=7\nAUTH_JWT_SECRET=already-mine\n' });
    await runUpdate(sb);
    const env = sb.readEnvFile();
    // Правило 1: существующее значение неприкосновенно — оператор мог настроить руками.
    expect(env).toMatch(/^TIME_SCALE=7$/m);
    expect(env).toMatch(/^AUTH_JWT_SECRET=already-mine$/m);
    expect(env).not.toMatch(/^TIME_SCALE=100$/m);
  });

  it('НЕ генерирует POSTGRES_PASSWORD, а закрепляет дефолт compose', async () => {
    // Иначе — `28P01 password authentication failed` на уже созданном томе: том хранит
    // тот пароль, что действовал при создании. Ровно этот отказ и ловили на живой машине.
    const sb = sandbox({ serverEnv: '# пусто\n' });
    await runUpdate(sb);
    expect(sb.readEnvFile()).toMatch(/^POSTGRES_PASSWORD=void$/m);
  });

  it('ALLOWED_ORIGINS не угадывает, а предупреждает', async () => {
    // Правило 3: неверный allowlist отбивает рукопожатие у ВСЕХ — «починка» стала бы
    // полным отказом. Дыра называется вслух, значение выбирает человек.
    const sb = sandbox({ serverEnv: '# пусто\n' });
    const { stdout } = await runUpdate(sb);
    expect(stdout).toContain('ALLOWED_ORIGINS');
    expect(sb.readEnvFile()).not.toMatch(/^ALLOWED_ORIGINS=/m);
  });

  it('говорит вслух, что дописал и чем это грозило', async () => {
    const sb = sandbox({ serverEnv: '# пусто\n' });
    const { stdout } = await runUpdate(sb);
    expect(stdout).toContain('дописаны недостающие ключи');
    expect(stdout).toContain('БЕЗ АККАУНТОВ');
  });

  it('на полном файле не дописывает ничего', async () => {
    const full = [
      'PORT=8788',
      'TIME_SCALE=24',
      'MATCHES=1',
      'POSTGRES_PASSWORD=secret',
      'GATE=1',
      'SEAT_LOCK=1',
      'AUTH_JWT_SECRET=abc',
      'PROD=0',
      'ALLOWED_ORIGINS=http://host:8788',
    ].join('\n');
    const sb = sandbox({ serverEnv: `${full}\n` });
    const { stdout } = await runUpdate(sb);
    expect(stdout).not.toContain('дописаны недостающие ключи');
    expect(sb.readEnvFile().trim()).toBe(full);
  });

  // Находки ревью на PR #939 — каждая ниже закрывает свою.
  it('добирает PROD=0: без него compose подставит 1 и сервер не стартует без TLS', async () => {
    // Установка, которая старше самого ключа, осталась бы без TLS под fail-secure
    // гардом — то есть починка сломала бы ровно те машины, ради которых делалась.
    const sb = sandbox({ serverEnv: '# старая установка\n' });
    const { stdout } = await runUpdate(sb);
    expect(sb.readEnvFile()).toMatch(/^PROD=0$/m);
    expect(stdout).toContain('без TLS');
  });

  it('пустое ALLOWED_ORIGINS= считается ненастроенным и всё равно предупреждает', async () => {
    // Для сервера пустое значение равносильно отсутствию allowlist: защита от CSWSH
    // выключена так же. Считать строку «существующей» значило бы подавить единственное
    // предупреждение об этом.
    const sb = sandbox({ serverEnv: 'ALLOWED_ORIGINS=\n' });
    const { stdout } = await runUpdate(sb);
    expect(stdout).toContain('ALLOWED_ORIGINS');
    expect(sb.readEnvFile()).toMatch(/^ALLOWED_ORIGINS=$/m); // не перезаписали
  });

  it('добирает ключи и на пути подписанного образа (рекомендованном)', async () => {
    // Иначе OPS-2 чинил бы только менее безопасную сборку из исходников.
    const sb = sandbox({ serverEnv: '# пусто\n' });
    await runUpdate(sb, { VOID_IMAGE: 'ghcr.io/x/y@sha256:deadbeef' });
    const env = sb.readEnvFile();
    expect(env).toMatch(/^TIME_SCALE=100$/m);
    expect(env).toMatch(/^AUTH_JWT_SECRET=[0-9a-f]{64}$/m);
  });

  it('при откате возвращает server.env к состоянию до обновления', async () => {
    // Откат обязан вернуть машину туда, где она была, ЦЕЛИКОМ: с новым `server.env` и
    // прежним образом health отвечал бы, скрипт рапортовал бы успех, а игроки больше не
    // вошли бы прежним способом — дописанный секрет переводит сервер на аккаунты.
    const before = '# старая установка\nPORT=8788\n';
    const sb = sandbox({ serverEnv: before, healthFailFirst: 99 });
    await runUpdate(sb, { VOID_IMAGE: 'ghcr.io/x/y@sha256:deadbeef' });
    expect(sb.readEnvFile()).toBe(before);
  });

  it('список ключей и установщик не разъезжаются', () => {
    // Единственная машинная защита от повторения дефекта: ключ, заведённый в
    // установщике, обязан быть и в общем списке — иначе он снова не доедет до уже
    // развёрнутой машины, и узнаем мы об этом опять на живом сервере.
    const keys = readFileSync(ENV_KEYS_SH, 'utf8')
      .match(/^ENV_REQUIRED_KEYS="([^"]+)"/m)[1]
      .split(/\s+/);
    const installer = readFileSync(INSTALLER, 'utf8');
    for (const key of keys) {
      expect(installer, `${key} нет в install-ubuntu.sh`).toMatch(
        new RegExp(`^${key}=`, 'm'),
      );
    }
  });
});
