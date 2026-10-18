import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const DEPLOY = dirname(fileURLToPath(import.meta.url));
const APP = `ghcr.io/moongametechnology/moongame@sha256:${'a'.repeat(64)}`;
const EDGE = `ghcr.io/moongametechnology/moongame/caddy@sha256:${'b'.repeat(64)}`;
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'void-tls-release-'));
  const state = join(dir, 'state'), bin = join(dir, 'bin'), release = join(dir, 'deploy');
  for (const p of [state, bin, release]) mkdirSync(p);
  for (const f of ['stack.sh', 'release-state.sh', 'production-preflight.sh']) cpSync(join(DEPLOY, f), join(release, f));
  for (const f of ['docker-compose.yml','docker-compose.release.yml','docker-compose.tls.yml','docker-compose.release-tls.yml']) writeFileSync(join(release, f),'# stub\n');
  writeFileSync(join(state,'server.env'),'DOMAIN=play.example.com\nPROD=0\nSERVER_BIND=127.0.0.1\nCOMPOSE_EXTRA_FILE='+join(state,'policy.yml')+'\n');
  writeFileSync(join(state,'policy.yml'),'# fixed host policy\n');
  writeFileSync(join(state,'last-good-release'),`version=1\nserver=${APP}\ncaddy=${EDGE}\n`);
  const docker = join(bin,'docker');
  writeFileSync(docker,'#!/bin/bash\nprintf "%s\\n" "$VOID_IMAGE $VOID_CADDY_IMAGE $*" >> "$LOG"\n');chmodSync(docker,0o755);
  return {state,release,log:join(dir,'calls'),env:{...process.env,STATE_DIR:state,PROD:'0',PATH:bin+':'+process.env.PATH,LOG:join(dir,'calls')}};
}
describe('TLS signed release checkpoint',()=>{
  it('reboots on the exact app/edge pair and retains TLS plus host policy overlays',async()=>{
    const f=fixture();
    await run('bash',[join(f.release,'stack.sh'),'up'],{env:f.env});
    const log=readFileSync(f.log,'utf8');
    expect(log).toContain(APP+' '+EDGE);
    expect(log).toContain('docker-compose.tls.yml');
    expect(log).toContain('docker-compose.release-tls.yml');
    expect(log).toContain(join(f.state,'policy.yml'));
    expect(log).toContain('up -d --no-build --pull missing');
  });
  it('refuses a missing edge checkpoint instead of booting a different pair',async()=>{
    const f=fixture();writeFileSync(join(f.state,'last-good-release'),`version=1\nserver=${APP}\ncaddy=latest\n`);
    await expect(run('bash',[join(f.release,'stack.sh'),'up'],{env:f.env})).rejects.toMatchObject({code:1});
  });
  it('never treats checkpoint content as executable shell',async()=>{
    const f=fixture();writeFileSync(join(f.state,'last-good-release'),`version=1\nserver=${APP}\ncaddy=$(touch ${f.log})\n`);
    await expect(run('bash',[join(f.release,'stack.sh'),'up'],{env:f.env})).rejects.toMatchObject({code:1});
  });
  it('can start only PostgreSQL and wait for its health before the migration job', async () => {
    const f = fixture();
    await run('bash', [join(f.release, 'stack.sh'), 'db-up'], { env: f.env });
    expect(readFileSync(f.log, 'utf8')).toContain('up -d --no-build --pull missing --wait --wait-timeout 60 postgres');
  });
});

describe('TLS updater rollback boundary',()=>{
  function updater() {
    const f=fixture();
    for(const name of ['update.sh','env-keys.sh']) cpSync(join(DEPLOY,name),join(f.release,name));
    const verify=join(f.release,'verify-image.sh');
    writeFileSync(verify,'#!/bin/bash\necho "verify $1" >> "$LOG"\n');chmodSync(verify,0o755);
    const curl=join(dirname(f.log),'bin','curl');
    writeFileSync(curl,'#!/bin/bash\nif [[ "$*" == *https://* ]] && [ ! -e "$EDGE_FAILED" ]; then touch "$EDGE_FAILED"; exit 7; fi\nexit 0\n');chmodSync(curl,0o755);
    f.env.HEALTH_TRIES='1';f.env.EDGE_FAILED=join(dirname(f.log),'edge-failed');
    return f;
  }
  it('rolls both images back when Game is healthy but the public edge is not ready',async()=>{
    const f=updater(), app=APP.replace('a'.repeat(64),'c'.repeat(64)),edge=EDGE.replace('b'.repeat(64),'d'.repeat(64));
    await expect(run('bash',[join(f.release,'update.sh')],{env:{...f.env,VOID_IMAGE:app,VOID_CADDY_IMAGE:edge}})).rejects.toMatchObject({code:1});
    const calls=readFileSync(f.log,'utf8');
    expect(calls).toContain(app+' '+edge+' compose');
    expect(calls).toContain(APP+' '+EDGE+' compose');
    expect(readFileSync(join(f.state,'last-good-release'),'utf8')).toBe(`version=1\nserver=${APP}\ncaddy=${EDGE}\n`);
  });
  it('missing recovery readiness prevents any container update even with a valid release pair',async()=>{
    const f=updater();
    writeFileSync(join(f.state,'server.env'),'DOMAIN=play.example.com\nPROD=1\nDB_AUTO_MIGRATE=0\nDB_REQUIRE_LEAST_PRIVILEGE=1\n');
    await expect(run('bash',[join(f.release,'update.sh')],{env:{...f.env,PROD:'1',VOID_IMAGE:APP,VOID_CADDY_IMAGE:EDGE}})).rejects.toMatchObject({code:1});
    const calls=readFileSync(f.log,'utf8');
    expect(calls).not.toContain(' compose');
    expect(calls).not.toContain(' pull');
    expect(readFileSync(join(f.state,'last-good-release'),'utf8')).toContain(`caddy=${EDGE}`);
  });

  function stoppedDatabase(f, exit = 0) {
    writeFileSync(join(f.state, 'server.env'), readFileSync(join(f.state, 'server.env'), 'utf8') + 'DB_AUTO_MIGRATE=0\n');
    writeFileSync(join(f.state, 'migration.env'), 'DB_MIGRATION_URL=fixture-only\n', { mode: 0o600 });
    writeFileSync(f.env.EDGE_FAILED, 'skip injected edge failure');
    f.env.PG_UP = join(dirname(f.log), 'postgres-up');
    const docker = join(dirname(f.log), 'bin', 'docker');
    writeFileSync(docker, `#!/bin/bash
printf '%s\\n' "$VOID_IMAGE $VOID_CADDY_IMAGE $*" >> "$LOG"
if [[ "$*" == *"--wait --wait-timeout 60 postgres" ]]; then
  [ ${exit} -eq 0 ] || exit ${exit}
  touch "$PG_UP"
fi
if [ "$1" = run ]; then [ -f "$PG_UP" ] || exit 8; fi
`);
    chmodSync(docker, 0o755);
  }

  it('recovers PostgreSQL stopped by the legacy unit before migrating and starting Game', async () => {
    const f = updater();
    stoppedDatabase(f);
    await run('bash', [join(f.release, 'update.sh')], { env: { ...f.env, VOID_IMAGE: APP, VOID_CADDY_IMAGE: EDGE } });
    const calls = readFileSync(f.log, 'utf8');
    const database = calls.indexOf('--wait --wait-timeout 60 postgres');
    const migration = calls.indexOf('packages/server/dist/database-admin.mjs migrate');
    const game = calls.lastIndexOf('up -d --no-build --pull missing');
    expect(database).toBeGreaterThan(-1);
    expect(database).toBeLessThan(migration);
    expect(migration).toBeLessThan(game);
  });

  it('does not run the migrator or Game if PostgreSQL never becomes healthy', async () => {
    const f = updater();
    stoppedDatabase(f, 1);
    await expect(run('bash', [join(f.release, 'update.sh')], { env: { ...f.env, VOID_IMAGE: APP, VOID_CADDY_IMAGE: EDGE } }))
      .rejects.toMatchObject({ code: 1 });
    const calls = readFileSync(f.log, 'utf8');
    expect(calls).toContain('--wait --wait-timeout 60 postgres');
    expect(calls).not.toContain('database-admin.mjs migrate');
    expect(calls).not.toMatch(/up -d --no-build --pull missing\n/);
  });
});
