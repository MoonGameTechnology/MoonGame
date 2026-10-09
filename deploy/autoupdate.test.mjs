/**
 * Тесты агента автообновления (ZTP-1.2) и его журнала (ZTP-1.3).
 *
 * Агент — это решения, а не вызовы: катить ли (выключатель, окно, точка отката, уже
 * откатывались), чем проверять (подпись — ТЕКУЩЕЙ версией скриптов), откуда брать
 * deploy/ (из самого образа), когда переключать текущую версию (только после здоровья) и
 * как откатываться. Здесь проверяются именно они. Docker, curl и часы — заглушки на PATH;
 * `update.sh` в версиях тоже заглушки: его собственное поведение проверяет update.test.mjs,
 * а живые прогоны всей цепочки на настоящем Docker описаны в роадмапе ZTP (ZTP-1.2).
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
  readdirSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const DEPLOY_DIR = dirname(fileURLToPath(import.meta.url));

const REPO = 'ghcr.io/moongametechnology/moongame';
const OLD = `${REPO}@sha256:${'a'.repeat(64)}`;
const NEW = `${REPO}@sha256:${'b'.repeat(64)}`;
const OLD_ID = 'a'.repeat(12);
const NEW_ID = 'b'.repeat(12);

function stub(dir, name, body) {
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/bash\n${body}\n`);
  chmodSync(file, 0o755);
}

/** Версия deploy/ в том виде, в каком она лежит в образе: настоящие агент и stack.sh,
 *  заглушки там, где поведение проверяется отдельно. */
function writeRelease(dir, { updateExit = 0, verifyExit = 0, marker = '' } = {}) {
  mkdirSync(dir, { recursive: true });
  for (const f of ['autoupdate.sh', 'stack.sh', 'moongame.sh', 'env-keys.sh']) {
    cpSync(join(DEPLOY_DIR, f), join(dir, f));
    chmodSync(join(dir, f), 0o755);
  }
  for (const f of ['docker-compose.yml', 'docker-compose.release.yml'])
    writeFileSync(join(dir, f), '# stub\n');
  stub(
    dir,
    'verify-image.sh',
    `echo "verify $1 by ${marker || basename(dirname(dir))}" >> "$LOG"\nexit ${verifyExit}`,
  );
  // update.sh версии: пишет точку отката при успехе — как настоящий.
  stub(
    dir,
    'update.sh',
    `echo "update.sh(${marker || basename(dirname(dir))}) VOID_IMAGE=$VOID_IMAGE STATE_DIR=$STATE_DIR" >> "$LOG"
[ ${updateExit} -eq 0 ] && printf '%s\\n' "$VOID_IMAGE" > "$STATE_DIR/last-good-image"
exit ${updateExit}`,
  );
}

/**
 * Песочница хоста на автодеплое: $STATE_DIR с текущей версией (на ней OLD), реестр,
 * в котором :main указывает на `remote`, и образ, из которого `docker cp` достаёт
 * `imageRelease` (null — в образе нет deploy/).
 */
function sandbox({
  remote = NEW,
  lastGood = OLD,
  serverEnv = '',
  now = '05:00',
  newUpdateExit = 0,
  verifyExit = 0,
  imageRelease = {},
  withCurrent = true,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'void-autodeploy-'));
  const state = join(root, 'state');
  const bin = join(root, 'bin');
  const image = join(root, 'image-deploy');
  mkdirSync(join(state, 'releases'), { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(state, 'server.env'), serverEnv);
  if (lastGood) writeFileSync(join(state, 'last-good-image'), `${lastGood}\n`);

  const current = join(state, 'releases', OLD_ID);
  writeRelease(join(current, 'deploy'), { verifyExit, marker: 'current' });
  if (withCurrent) symlinkSync(current, join(state, 'current'));
  if (imageRelease)
    writeRelease(image, { ...imageRelease, updateExit: newUpdateExit, marker: 'new' });

  const log = join(root, 'calls.log');
  writeFileSync(log, '');
  stub(
    bin,
    'docker',
    `echo "docker $*" >> "$LOG"
case "$1 $2 $3" in
  "buildx imagetools inspect") echo "\${REMOTE#*@}" ;;
esac
case "$1" in
  create) echo cid-1 ;;
  cp) [ -d "$IMAGE_DEPLOY" ] || exit 1; cp -r "$IMAGE_DEPLOY" "$3" ;;
esac
exit 0`,
  );
  stub(bin, 'curl', `echo '{"ok":true,"version":"0123456789ab"}'`);
  stub(
    bin,
    'date',
    `case "$*" in
  "+%H:%M") echo "$FAKE_NOW" ;;
  *) echo "2026-10-09T04:05:00Z" ;;
esac`,
  );

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    LOG: log,
    STATE_DIR: state,
    REMOTE: remote,
    IMAGE_DEPLOY: imageRelease ? image : join(root, 'nothing'),
    FAKE_NOW: now,
  };
  const read = (f) => (existsSync(join(state, f)) ? readFileSync(join(state, f), 'utf8') : '');
  return {
    root,
    state,
    env,
    agentPath: withCurrent
      ? join(state, 'current', 'deploy', 'autoupdate.sh')
      : join(current, 'deploy', 'autoupdate.sh'),
    readLog: () => readFileSync(log, 'utf8'),
    history: () => read('deploy-history'),
    failed: () => read('failed-images'),
    lastGood: () => read('last-good-image').trim(),
    currentTarget: () => basename(readlinkSync(join(state, 'current'))),
    releases: () => readdirSync(join(state, 'releases')).sort(),
  };
}

async function agent(sb, args = [], extraEnv = {}) {
  try {
    const { stdout } = await run('bash', [sb.agentPath, ...args], {
      env: { ...sb.env, ...extraEnv },
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('autoupdate.sh — когда катить', () => {
  it('новая подписанная сборка в окне: выкатывает и делает её версию текущей', async () => {
    const sb = sandbox({ serverEnv: 'AUTODEPLOY_WINDOW=04:00-07:00\n', now: '05:00' });
    const res = await agent(sb);

    expect(res.code).toBe(0);
    const log = sb.readLog();
    // Подпись проверила ТЕКУЩАЯ версия скриптов, а выкатила — новая, из самого образа.
    expect(log).toContain(`verify ${NEW} by current`);
    expect(log).toContain(`update.sh(new) VOID_IMAGE=${NEW} STATE_DIR=${sb.state}`);
    expect(log.indexOf('verify')).toBeLessThan(log.indexOf('docker pull'));
    expect(sb.lastGood()).toBe(NEW);
    expect(sb.currentTarget()).toBe(NEW_ID);
    expect(readlinkSync(join(sb.state, 'current', 'deploy', 'certs'))).toBe(
      join(sb.state, 'certs'),
    );
    expect(sb.history()).toContain(`timer ${OLD_ID} -> ${NEW_ID} ok version=0123456789ab`);
  });

  it('тот же дайджест, что запущен: ничего не делает и в журнал не пишет', async () => {
    const sb = sandbox({ remote: OLD });
    const res = await agent(sb);

    expect(res.code).toBe(0);
    expect(sb.readLog()).not.toContain('docker pull');
    expect(sb.history()).toBe('');
  });

  it('вне окна не ходит даже в реестр', async () => {
    const sb = sandbox({ serverEnv: 'AUTODEPLOY_WINDOW=04:00-07:00\n', now: '19:30' });
    await agent(sb);

    expect(sb.readLog()).toBe('');
    expect(sb.lastGood()).toBe(OLD);
  });

  it('окно через полночь: 01:30 внутри 23:00-02:00, 03:00 — снаружи', async () => {
    const inside = sandbox({ serverEnv: 'AUTODEPLOY_WINDOW=23:00-02:00\n', now: '01:30' });
    await agent(inside);
    expect(inside.lastGood()).toBe(NEW);

    const outside = sandbox({ serverEnv: 'AUTODEPLOY_WINDOW=23:00-02:00\n', now: '03:00' });
    await agent(outside);
    expect(outside.lastGood()).toBe(OLD);
  });

  it('пустое окно — катить сразу', async () => {
    const sb = sandbox({ serverEnv: 'AUTODEPLOY_WINDOW=\n', now: '19:30' });
    await agent(sb);
    expect(sb.lastGood()).toBe(NEW);
  });

  it('окно с опечаткой не превращается в «когда угодно»: не катит и говорит почему', async () => {
    const sb = sandbox({ serverEnv: 'AUTODEPLOY_WINDOW=4-7\n', now: '05:00' });
    const res = await agent(sb);

    expect(sb.lastGood()).toBe(OLD);
    expect(res.stdout).toContain("AUTODEPLOY_WINDOW='4-7'");
  });

  it('AUTODEPLOY=0 выключает таймер целиком', async () => {
    const sb = sandbox({ serverEnv: 'AUTODEPLOY=0\n' });
    await agent(sb);

    expect(sb.readLog()).toBe('');
    expect(sb.lastGood()).toBe(OLD);
  });

  it('без точки отката не катит: первый перевод хоста — только руками', async () => {
    const sb = sandbox({ lastGood: '' });
    const res = await agent(sb);

    expect(res.code).toBe(0);
    expect(sb.readLog()).toBe('');
    expect(res.stdout).toContain('нет точки отката');
  });

  it('--now катит мимо окна и выключателя (срочная починка руками)', async () => {
    const sb = sandbox({
      serverEnv: 'AUTODEPLOY=0\nAUTODEPLOY_WINDOW=04:00-07:00\n',
      now: '19:30',
    });
    await agent(sb, ['--now']);

    expect(sb.lastGood()).toBe(NEW);
    expect(sb.history()).toContain(`now ${OLD_ID} -> ${NEW_ID} ok`);
  });
  it('свой реестр и тег из server.env: `moongame update` смотрит туда же, куда таймер', async () => {
    // `moongame update` = `autoupdate.sh --now` без переменных окружения юнита.
    const fork = 'registry.example:5000/fork/moongame';
    const sb = sandbox({ serverEnv: `VOID_IMAGE_REPO=${fork}\nVOID_TRACK_TAG=stage\n` });
    await agent(sb, ['--now']);

    const log = sb.readLog();
    expect(log).toContain(`docker buildx imagetools inspect ${fork}:stage`);
    expect(log).toContain(`update.sh(new) VOID_IMAGE=${fork}@sha256:${'b'.repeat(64)}`);
  });
});

describe('autoupdate.sh — гейты', () => {
  it('подпись не подтвердилась: образ не скачан, сервер не тронут, в журнале одна строка на дайджест', async () => {
    const sb = sandbox({ verifyExit: 1 });
    const first = await agent(sb);
    await agent(sb);

    expect(first.code).not.toBe(0);
    const log = sb.readLog();
    expect(log).not.toContain('docker pull');
    expect(log).not.toContain('update.sh');
    expect(sb.lastGood()).toBe(OLD);
    expect(sb.history().match(/signature-rejected/g)).toHaveLength(1);
  });

  it('образ без deploy/ (собран до автодеплоя): не катит и больше не пробует', async () => {
    const sb = sandbox({ imageRelease: null });
    const res = await agent(sb);

    expect(res.code).not.toBe(0);
    expect(sb.readLog()).not.toContain('update.sh');
    expect(sb.failed()).toContain(NEW);
    expect(sb.currentTarget()).toBe(OLD_ID);
    expect(sb.releases()).toEqual([OLD_ID]);
  });
});

describe('autoupdate.sh — откат', () => {
  it('новая сборка не поднялась: прежние образ и deploy/, дайджест помечен, версия удалена', async () => {
    const sb = sandbox({ newUpdateExit: 1 });
    const res = await agent(sb);

    expect(res.code).not.toBe(0);
    const log = sb.readLog();
    // Второй подъём — ТЕКУЩЕЙ версией скриптов и прежним образом.
    expect(log).toContain(`update.sh(current) VOID_IMAGE=${OLD}`);
    expect(log.indexOf('update.sh(new)')).toBeLessThan(log.indexOf('update.sh(current)'));
    expect(sb.lastGood()).toBe(OLD);
    expect(sb.currentTarget()).toBe(OLD_ID);
    expect(sb.failed()).toContain(NEW);
    expect(sb.releases()).toEqual([OLD_ID]);
    expect(sb.history()).toContain(`timer ${OLD_ID} -> ${NEW_ID} rolled-back`);
  });

  it('на откатившийся дайджест таймер больше не тратит рестарт, а --now пробует снова', async () => {
    const sb = sandbox({ newUpdateExit: 1 });
    await agent(sb);
    const before = sb.readLog().length;
    await agent(sb);
    const retry = sb.readLog().slice(before);
    expect(retry).not.toContain('docker pull');
    expect(retry).not.toContain('update.sh');

    const forced = sb.readLog().length;
    await agent(sb, ['--now']);
    expect(sb.readLog().slice(forced)).toContain('update.sh(new)');
  });
});

describe('autoupdate.sh — первый перевод и уборка', () => {
  it('--bootstrap без точки отката выкатывает и заводит текущую версию', async () => {
    const sb = sandbox({ lastGood: '', withCurrent: false });
    const res = await agent(sb, ['--bootstrap']);

    expect(res.code).toBe(0);
    expect(sb.lastGood()).toBe(NEW);
    expect(sb.currentTarget()).toBe(NEW_ID);
    expect(sb.history()).toContain(`bootstrap none -> ${NEW_ID} ok`);
  });

  it('--bootstrap на хосте, уже работающем на этом образе: без рестарта, только версия', async () => {
    const sb = sandbox({ remote: OLD, withCurrent: false });
    await agent(sb, ['--bootstrap']);

    expect(sb.readLog()).not.toContain('update.sh');
    expect(sb.currentTarget()).toBe(OLD_ID);
    expect(sb.history()).toContain(`bootstrap ${OLD_ID} -> ${OLD_ID} adopted`);
  });

  it('хранит две версии — текущую и предыдущую, остальные удаляет', async () => {
    const sb = sandbox();
    writeRelease(join(sb.state, 'releases', 'cccccccccccc', 'deploy'));
    await agent(sb);

    expect(sb.releases()).toEqual([OLD_ID, NEW_ID]);
  });

  it('второй прогон, пока идёт первый, ничего не делает', async () => {
    const sb = sandbox();
    // Держим замок так же, как держал бы его идущий прогон.
    const holder = run('flock', [join(sb.state, 'autoupdate.lock'), 'bash', '-c', 'sleep 2'], {
      env: sb.env,
    });
    await new Promise((r) => setTimeout(r, 300));
    const res = await agent(sb);
    await holder;

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('уже идёт другая выкатка');
    expect(sb.lastGood()).toBe(OLD);
  });
});
