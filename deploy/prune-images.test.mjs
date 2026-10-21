import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const script = join(dirname(fileURLToPath(import.meta.url)), 'prune-images.sh');
const repo = 'ghcr.io/moongametechnology/moongame';
const edge = `${repo}/caddy`;
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function image(n, repository = repo, revision = n) {
  const hex = n.toString(16).padStart(64, '0');
  return {
    id: `sha256:${hex}`,
    created: `2026-10-${String(n % 28 + 1).padStart(2, '0')}T10:00:00.123456789Z`,
    revision: revision.toString(16).padStart(40, '0'),
    digests: [`${repository}@sha256:${hex}`],
    tags: [`${repository}:build-${n}`],
  };
}

function sandbox(images, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'moongame-image-retention-'));
  roots.push(root);
  const log = join(root, 'calls.tsv');
  writeFileSync(log, '');
  const docker = join(root, 'docker');
  const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
  const emit = value => `printf '%s\\n' ${quote(value)}; exit 0`;
  const fail = reason => options.fail === reason ? 'exit 1' : '';
  const imageCases = images.map(image => {
    const aliases = [image.id, ...image.digests, ...image.tags].map(quote).join('|');
    const row = image.row ?? [image.id, image.created, image.revision, image.digests.join(','), image.tags.join(',')].join('|');
    return `${aliases})
      ${options.failImage === image.id ? 'exit 1' : ''}
      if [ "$4" = '{{.Id}}' ]; then ${emit(image.id)}; fi
      ${(image.missingFields ?? []).map(field => `if [[ "$4" == *${quote(field)}* ]]; then exit 1; fi`).join('\n')}
      ${options.changeImage === image.id ? `
      if [ -f "$CALLS.changed" ]; then ${options.changeKind === 'inspect-failure' ? 'exit 1' : emit(`${row},foreign.example/build:keep`)}; fi
      touch "$CALLS.changed"` : ''}
      ${emit(row)} ;;`;
  }).join('\n');
  const containers = options.containers ?? [];
  const containerCases = containers.map(container => `${quote(container.id)}) ${emit(container.image)} ;;`).join('\n');
  writeFileSync(docker, `#!/bin/bash
for arg in "$@"; do printf '%s\\t' "$arg"; done >> "$CALLS"
printf '\\n' >> "$CALLS"
case "$1 $2" in
  'image ls') ${fail('images')}
    ${emit(options.inventory ?? images.map(image => image.id).join('\n'))} ;;
  'container ls') ${fail('containers')}
    ${emit(containers.map(container => container.id).join('\n'))} ;;
  'container inspect') ${fail('container-inspect')}
    case "$5" in ${containerCases} esac; exit 1 ;;
  'image inspect') case "$5" in ${imageCases} esac; exit 1 ;;
  'image rm') [ "$#" = 3 ] || exit 1
    ${options.conflicts?.length ? `case "$3" in ${options.conflicts.map(quote).join('|')}) exit 1 ;; esac` : ''}
    exit 0 ;;
esac
exit 1
`);
  chmodSync(docker, 0o755);
  return {
    async invoke(args = ['--apply', images.at(-1).digests[0]]) {
      let result;
      try { result = { ...await run('bash', [script, ...args], {
        env: { ...process.env, PATH: `${root}:${process.env.PATH}`, CALLS: log, IMAGE_REPO: repo, CADDY_REPO: edge },
      }), status: 0 }; }
      catch (error) { result = { stdout: error.stdout, stderr: error.stderr, status: error.code }; }
      const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => line.split('\t').slice(0, -1));
      return { ...result, calls, removed: calls.filter(args => args[0] === 'image' && args[1] === 'rm').map(args => args[2]) };
    },
  };
}

describe('published image retention', () => {
  it('keeps current/rollback pins and images of running, stopped and paused containers in both repositories', async () => {
    const server = Array.from({ length: 9 }, (_, n) => image(n + 1));
    const caddy = Array.from({ length: 9 }, (_, n) => image(n + 11, edge, n + 1));
    const result = await sandbox([...server, ...caddy], { containers: [
      { id: 'a'.repeat(64), image: server[1].id, state: 'running' },
      { id: 'b'.repeat(64), image: caddy[0].id, state: 'exited' },
      { id: 'c'.repeat(64), image: server[0].id, state: 'paused' },
    ] }).invoke(['--apply', server[0].digests[0], caddy[1].digests[0]]);
    expect(result.status).toBe(0);
    expect(result.removed.sort()).toEqual([server[2].id, server[3].id, caddy[2].id, caddy[3].id].sort());
    expect(result.calls.find(args => args[0] === 'container' && args[1] === 'ls')).toContain('--all');
    expect(result.calls.every(args => !args.includes('--force') && !args.includes('prune'))).toBe(true);
  });

  it('keeps five distinct revisions per repository, including every image of a retained revision', async () => {
    const images = Array.from({ length: 6 }, (_, n) => image(n + 1));
    const duplicates = Array.from({ length: 6 }, (_, n) => image(n + 7, repo, 6));
    const result = await sandbox([...images, ...duplicates]).invoke();
    expect(result.status).toBe(0);
    expect(result.removed).toEqual([images[0].id]);
  });

  it('keeps unrelated images, local/dangling builds and any image with a foreign alias', async () => {
    const own = Array.from({ length: 7 }, (_, n) => image(n + 1));
    const foreignTag = image(20); foreignTag.tags.push('developer/private:work');
    const foreignDigest = image(21); foreignDigest.digests.push(`other.example/thing@sha256:${'a'.repeat(64)}`);
    const local = image(22); local.digests = []; local.tags = ['local-build:latest'];
    const dangling = image(23); dangling.digests = []; dangling.tags = [];
    const noRevision = image(24); noRevision.revision = '';
    const unrelated = image(25, 'other.example/game');
    const result = await sandbox([...own, foreignTag, foreignDigest, local, dangling, noRevision, unrelated]).invoke(['--apply', own[6].digests[0]]);
    expect(result.status).toBe(0);
    expect(result.removed.sort()).toEqual([own[0].id, own[1].id]);
  });

  it('accepts own digest aliases in RepoTags without treating them as foreign tags', async () => {
    const images = Array.from({ length: 6 }, (_, n) => image(n + 1));
    images[0].tags.push(images[0].digests[0]);
    const result = await sandbox(images).invoke();
    expect(result.status).toBe(0);
    expect(result.removed).toEqual([images[0].id]);
  });

  it('keeps local images when Docker omits optional Labels, RepoDigests and RepoTags fields', async () => {
    const images = Array.from({ length: 6 }, (_, n) => image(n + 1));
    const local = image(20);
    local.revision = ''; local.digests = []; local.tags = [];
    // Docker's Go template field access fails for an absent map entry. This
    // reproduces the actual imported/local image which blocked the VPS dry-run.
    local.missingFields = ['.Config.Labels', '.RepoDigests', '.RepoTags'];
    const result = await sandbox([...images, local]).invoke(['--apply', images[5].digests[0]]);
    expect(result.status).toBe(0);
    expect(result.removed).toEqual([images[0].id]);
  });

  it('keeps a local image with Docker zero Created without blocking published image cleanup', async () => {
    const images = Array.from({ length: 6 }, (_, n) => image(n + 1));
    const local = image(20);
    local.created = '0001-01-01T00:00:00Z';
    local.revision = ''; local.digests = []; local.tags = [];
    const result = await sandbox([...images, local]).invoke(['--apply', images[5].digests[0]]);
    expect(result.status).toBe(0);
    expect(result.removed).toEqual([images[0].id]);
  });

  it('prints a dry-run plan without deleting anything', async () => {
    const images = Array.from({ length: 7 }, (_, n) => image(n + 1));
    const result = await sandbox(images).invoke(['--dry-run', images[6].digests[0]]);
    expect(result.status).toBe(0);
    expect(result.removed).toEqual([]);
    expect(result.stdout).toContain(`plan ${images[0].id}`);
    expect(result.stdout).toContain('candidates=2');
  });

  it('aborts before any deletion if a pinned checkpoint cannot be resolved', async () => {
    const images = Array.from({ length: 7 }, (_, n) => image(n + 1));
    const result = await sandbox(images).invoke(['--apply', `${repo}@sha256:${'f'.repeat(64)}`]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('E_IMAGE_PRUNE_PIN');
    expect(result.removed).toEqual([]);
  });

  it.each(['images', 'containers', 'container-inspect'])('aborts before deletion on %s inventory failure', async fail => {
    const images = Array.from({ length: 7 }, (_, n) => image(n + 1));
    const result = await sandbox(images, { fail, containers: [{ id: 'a'.repeat(64), image: images[0].id }] }).invoke();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('E_IMAGE_PRUNE_');
    expect(result.removed).toEqual([]);
  });

  it('completes every image inspection before deleting and aborts on a late inspection failure', async () => {
    const images = Array.from({ length: 7 }, (_, n) => image(n + 1));
    const result = await sandbox(images, { failImage: images[6].id }).invoke();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('E_IMAGE_PRUNE_INSPECT');
    expect(result.removed).toEqual([]);
  });

  it.each(['not-an-image-id', 'sha256:abc'])('rejects malformed image inventory %s', async inventory => {
    const result = await sandbox([image(1)], { inventory }).invoke();
    expect(result.status).not.toBe(0);
    expect(result.removed).toEqual([]);
  });

  it.each(['2026-02-31T10:00:00Z', 'not-a-date', '2026-10-01T10:00:00Z|injected'])('aborts before deletion on invalid created metadata %s', async created => {
    const images = Array.from({ length: 7 }, (_, n) => image(n + 1));
    images[6].created = created;
    const result = await sandbox(images).invoke();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('E_IMAGE_PRUNE_METADATA');
    expect(result.removed).toEqual([]);
  });

  it('skips a Docker deletion conflict without forcing deletion or failing the deployment', async () => {
    const images = Array.from({ length: 7 }, (_, n) => image(n + 1));
    const result = await sandbox(images, { conflicts: [images[0].id] }).invoke();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`skip ${images[0].id} E_IMAGE_PRUNE_REMOVE`);
    expect(result.stdout).toContain('removed=1 skipped=1');
    expect(result.calls.filter(args => args[0] === 'image' && args[1] === 'rm').every(args => args.length === 3)).toBe(true);
  });

  it.each(['foreign-alias', 'inspect-failure'])('keeps an image after a concurrent %s during deletion recheck', async changeKind => {
    const images = Array.from({ length: 7 }, (_, n) => image(n + 1));
    const result = await sandbox(images, { changeImage: images[0].id, changeKind }).invoke();
    expect(result.status).toBe(0);
    expect(result.removed).toEqual([images[1].id]);
    expect(result.stdout).toContain(`skip ${images[0].id} E_IMAGE_PRUNE_RECHECK`);
    expect(result.stdout).toContain('removed=1 skipped=1');
  });

  it.each([[], ['--apply'], ['--oops'], ['--apply', '--force']].map(args => ({ args })))('requires an explicit mode and full pinned checkpoint: $args', async ({ args }) => {
    const result = await sandbox([image(1)]).invoke(args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('E_IMAGE_PRUNE_USAGE');
    expect(result.calls).toEqual([]);
  });
});
