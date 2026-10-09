/**
 * Стек хоста на автодеплое (ZTP-1.2): stack.sh, update.sh в режиме каталога состояния и
 * то, что ставит install-autodeploy.sh.
 *
 * Главный вопрос здесь — «что поднимется после перезагрузки». До автодеплоя юнит
 * поднимал голый `docker compose up` на локальной сборке, и выкатка подписанного образа
 * жила до первого ребута. Теперь юнит, хелпер и update.sh собирают стек одним stack.sh,
 * и эти тесты держат именно это: один файл, один дайджест, одно состояние.
 */
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const DEPLOY_DIR = dirname(fileURLToPath(import.meta.url));
const IMAGE = `ghcr.io/moongametechnology/moongame@sha256:${'c'.repeat(64)}`;

function stub(dir, name, body) {
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/bash\n${body}\n`);
  chmodSync(file, 0o755);
}

function sandbox({ lastGood = IMAGE, healthOk = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'void-stack-'));
  const state = join(root, 'state');
  const release = join(root, 'releases', 'cccccccccccc', 'deploy');
  const bin = join(root, 'bin');
  mkdirSync(state, { recursive: true });
  mkdirSync(release, { recursive: true });
  mkdirSync(bin);
  for (const f of ['stack.sh', 'update.sh', 'env-keys.sh']) {
    cpSync(join(DEPLOY_DIR, f), join(release, f));
    chmodSync(join(release, f), 0o755);
  }
  for (const f of ['docker-compose.yml', 'docker-compose.release.yml'])
    writeFileSync(join(release, f), '# stub\n');
  stub(release, 'verify-image.sh', 'echo "verify $*" >> "$LOG"');
  writeFileSync(join(state, 'server.env'), 'POSTGRES_PASSWORD=pw\n');
  if (lastGood) writeFileSync(join(state, 'last-good-image'), `${lastGood}\n`);

  const log = join(root, 'calls.log');
  writeFileSync(log, '');
  stub(bin, 'docker', 'echo "docker[VOID_IMAGE=${VOID_IMAGE:-}] $*" >> "$LOG"');
  stub(bin, 'git', 'echo "git $*" >> "$LOG"');
  stub(bin, 'curl', `exit ${healthOk ? 0 : 7}`);
  stub(bin, 'sleep', 'exit 0');
  stub(bin, 'openssl', 'echo 0123456789abcdef');
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    LOG: log,
    STATE_DIR: state,
    HEALTH_TRIES: '1',
  };
  return { root, state, release, env, readLog: () => readFileSync(log, 'utf8') };
}

async function sh(file, args, env) {
  try {
    const { stdout, stderr } = await run('bash', [file, ...args], { env });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('stack.sh — что поднимается после перезагрузки', () => {
  it('поднимает дайджест из точки отката, с server.env из каталога состояния', async () => {
    const sb = sandbox();
    const res = await sh(join(sb.release, 'stack.sh'), ['up'], sb.env);

    expect(res.code).toBe(0);
    const log = sb.readLog();
    expect(log).toContain(`docker[VOID_IMAGE=${IMAGE}] compose --env-file ${sb.state}/server.env`);
    expect(log).toContain(
      `-f ${sb.release}/docker-compose.yml -f ${sb.release}/docker-compose.release.yml`,
    );
    // Реестр недоступен при загрузке — игра всё равно поднимается на уже скачанном образе.
    expect(log).toContain('up -d --no-build --pull missing');
  });

  it('без подписанного образа не поднимает ничего (и не откатывается на локальную сборку)', async () => {
    const sb = sandbox({ lastGood: '' });
    const res = await sh(join(sb.release, 'stack.sh'), ['up'], sb.env);

    expect(res.code).toBe(1);
    expect(sb.readLog()).toBe('');
    expect(res.stderr).toContain('Нет подписанного образа');
  });
});

describe('update.sh — режим каталога состояния (хост на автодеплое)', () => {
  it('поднимает новый образ тем же stack.sh и пишет точку отката в каталог состояния', async () => {
    const sb = sandbox({ lastGood: '' });
    const res = await sh(join(sb.release, 'update.sh'), [], { ...sb.env, VOID_IMAGE: IMAGE });

    expect(res.code).toBe(0);
    const log = sb.readLog();
    expect(log).toContain(`verify ${IMAGE}`);
    expect(log).toContain(`docker[VOID_IMAGE=${IMAGE}] compose --env-file ${sb.state}/server.env`);
    expect(log).toContain('--pull missing');
    expect(readFileSync(join(sb.state, 'last-good-image'), 'utf8').trim()).toBe(IMAGE);
    expect(existsSync(join(sb.release, 'server.env'))).toBe(false);
  });

  it('сборки из исходников на таком хосте нет: без VOID_IMAGE — отказ, git не трогается', async () => {
    const sb = sandbox();
    const res = await sh(join(sb.release, 'update.sh'), [], sb.env);

    expect(res.code).toBe(2);
    expect(sb.readLog()).not.toContain('git ');
    expect(sb.readLog()).not.toContain('build');
  });
});

describe('install-autodeploy.sh — что остаётся на машине', () => {
  const installer = readFileSync(join(DEPLOY_DIR, 'install-autodeploy.sh'), 'utf8');

  it('юнит сервера поднимает стек через stack.sh текущей версии, а не голый compose up', () => {
    expect(installer).toMatch(/ExecStart=\/bin\/bash \$STATE_DIR\/current\/deploy\/stack\.sh up/);
    expect(installer).not.toMatch(/ExecStart=\/usr\/bin\/docker compose up/);
  });

  it('таймер раз в 5 минут зовёт агента текущей версии от сервисной учётки', () => {
    expect(installer).toMatch(/ExecStart=\/bin\/bash \$STATE_DIR\/current\/deploy\/autoupdate\.sh/);
    expect(installer).toMatch(/OnUnitActiveSec=5min/);
    expect(installer).toMatch(/User=\$SERVICE_USER/);
  });

  it('юниты ставятся только после удачной первой выкатки', () => {
    expect(installer.indexOf('autoupdate.sh" --bootstrap')).toBeLessThan(
      installer.indexOf('[Service]'),
    );
  });

  it('свой реестр пишется в server.env, а не в юнит: `moongame update` видит то же, что таймер', () => {
    expect(installer).not.toMatch(/Environment=VOID_IMAGE_REPO/);
    expect(installer).toMatch(/for key in VOID_IMAGE_REPO VOID_TRACK_TAG; do/);
  });

  it('хост с TLS-оверлеем не переводится наполовину', () => {
    expect(installer).toContain("'^DOMAIN=");
    expect(installer).toContain('com.docker.compose.service=caddy');
  });

  it('каждый файл, который агент требует от версии deploy/, есть в репозитории', () => {
    const agent = readFileSync(join(DEPLOY_DIR, 'autoupdate.sh'), 'utf8');
    const list = agent.match(/^REQUIRED_FILES="([^"]+)"/m)?.[1].split(/\s+/) ?? [];
    expect(list.length).toBeGreaterThan(0);
    for (const f of list) expect(existsSync(join(DEPLOY_DIR, f)), f).toBe(true);
  });
});
