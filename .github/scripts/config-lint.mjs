#!/usr/bin/env node
// Offline configuration scans. Findings are informational; execution/format failures
// are not a clean scan. Only tracked regular files are passed to pinned containers.
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Official release tags resolved and exercised on 2026-11-07. Re-pin deliberately
// after checking the new release's JSON and exit-code contract with the tests below.
const TOOLS = {
  actionlint: {
    name: 'actionlint',
    version: '1.7.12',
    image:
      'rhysd/actionlint@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667',
    entry: '/usr/local/bin/actionlint',
    args: ['-pyflakes=', '-format', '{{json .}}'],
  },
  shellcheck: {
    name: 'ShellCheck',
    version: '0.11.0',
    image:
      'koalaman/shellcheck@sha256:61862eba1fcf09a484ebcc6feea46f1782532571a34ed51fedf90dd25f925a8d',
    entry: '/bin/shellcheck',
    args: ['--format=json1'],
  },
  hadolint: {
    name: 'Hadolint',
    version: '2.15.1',
    image:
      'hadolint/hadolint@sha256:32dac94127fd60b7b7e3fbfc65e1383b9b5e25c9bfd7b8536de7a539fe68a12d',
    entry: '/bin/hadolint',
    args: ['--format', 'json', '--failure-threshold', 'style'],
  },
};

export function selectFiles(key, paths, read) {
  return paths.filter((path) => {
    if (key === 'actionlint') return /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path);
    if (key === 'hadolint')
      return /^(Dockerfile(?:\.(?!md$)[\w-]+)?|.+\.Dockerfile)$/.test(basename(path));
    if (key === 'shellcheck')
      return (
        /\.(sh|bash|ksh)$/.test(path) ||
        (!basename(path).includes('.') &&
          /^#![^\n]*\b(?:ba|da|k)?sh\b/.test(read(path).split('\n', 1)[0]))
      );
    throw new Error('E_SCANNER_KEY');
  });
}

export function toSarif(key, raw) {
  const tool = TOOLS[key];
  if (!tool) throw new Error('E_SCANNER_KEY');
  const json = JSON.parse(raw);
  const rows = key === 'shellcheck' ? json?.comments : json;
  if (!Array.isArray(rows)) throw new Error('E_SCANNER_FORMAT');
  const rules = new Map();
  const results = rows.map((row) => {
    const path = (key === 'actionlint' ? row?.filepath : row?.file)?.replace(/^\.\//, '');
    const embedded =
      key === 'actionlint' && row?.kind === 'shellcheck'
        ? /\b(SC[0-9]+):(error|warning|info|style):/.exec(row.message)
        : null;
    const id = embedded
      ? `shellcheck-${embedded[1]}`
      : key === 'actionlint'
        ? row?.kind
        : key === 'shellcheck'
          ? `SC${row?.code}`
          : row?.code;
    const level = embedded
      ? { error: 'error', warning: 'warning', info: 'note', style: 'note' }[embedded[2]]
      : key === 'actionlint'
        ? 'error'
        : { error: 'error', warning: 'warning', info: 'note', style: 'note' }[row?.level];
    if (
      !path ||
      path.startsWith('/') ||
      path.split('/').includes('..') ||
      !Number.isSafeInteger(row.line) ||
      row.line < 1 ||
      !Number.isSafeInteger(row.column) ||
      row.column < 1 ||
      typeof id !== 'string' ||
      !/^[a-zA-Z0-9_-]+$/.test(id) ||
      (key === 'shellcheck' && !Number.isSafeInteger(row.code)) ||
      !level ||
      typeof row.message !== 'string' ||
      !row.message
    )
      throw new Error('E_SCANNER_FORMAT');
    if (!rules.has(id)) rules.set(id, { id });
    return {
      ruleId: id,
      level,
      message: { text: row.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: path.split('/').map(encodeURIComponent).join('/') },
            region: { startLine: row.line, startColumn: row.column },
          },
        },
      ],
    };
  });
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: tool.name, version: tool.version, rules: [...rules.values()] } },
        results,
      },
    ],
  };
}

export function scan(
  key,
  {
    root = process.cwd(),
    out = '.',
    paths,
    read = (p) => readFileSync(join(root, p), 'utf8'),
    run = spawnSync,
  } = {},
) {
  const tool = TOOLS[key];
  if (!tool) throw new Error('E_SCANNER_KEY');
  mkdirSync(out, { recursive: true });
  const status = { key, ok: false, exit: null, files: 0, findings: null, image: tool.image };
  try {
    for (const suffix of ['sarif', 'json', 'log'])
      rmSync(join(out, `${key}.${suffix}`), { force: true });
    const tracked =
      paths ??
      execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
        .split('\0')
        .filter((p) => p && lstatSync(join(root, p)).isFile());
    const files = selectFiles(key, tracked, read);
    status.files = files.length;
    if (!files.length) throw new Error('E_SCANNER_NO_INPUT');
    const result = run(
      'docker',
      [
        'run',
        '--rm',
        '--network=none',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--user',
        `${process.getuid()}:${process.getgid()}`,
        '-v',
        `${resolve(root)}:/src:ro`,
        '-w',
        '/src',
        '--entrypoint',
        tool.entry,
        tool.image,
        ...tool.args,
        ...files.map((p) => `./${p}`),
      ],
      { encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 },
    );
    status.exit = result.status;
    writeFileSync(join(out, `${key}.json`), result.stdout ?? '');
    writeFileSync(join(out, `${key}.log`), result.stderr ?? '');
    if (result.error || ![0, 1].includes(result.status)) throw new Error('E_SCANNER_EXEC');
    const sarif = toSarif(key, result.stdout);
    const count = sarif.runs[0].results.length;
    if ((result.status === 0) !== (count === 0)) throw new Error('E_SCANNER_EXIT');
    writeFileSync(join(out, `${key}.sarif`), JSON.stringify(sarif, null, 2) + '\n');
    status.findings = count;
    status.ok = true;
  } catch {
    // Preserve stderr in the artifact; don't reflect arbitrary scanner output into
    // Actions workflow commands. Unknown failures must not become zero findings.
    status.error = 'E_CONFIG_SCAN';
  }
  writeFileSync(join(out, `status-${key}.json`), JSON.stringify(status, null, 2) + '\n');
  return status.ok;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const key = process.argv[2];
  if (!Object.hasOwn(TOOLS, key) || !scan(key, { out: process.argv[3] ?? '.' })) {
    console.error('E_CONFIG_SCAN: scan not confirmed; inspect status and log artifacts.');
    process.exitCode = 1;
  }
}
