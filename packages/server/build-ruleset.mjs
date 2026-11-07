import process from 'node:process';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

/** Produce bounded, self-contained executable rules, whose digest includes code + data. */
export async function buildRuleset(outdir = 'packages/server/dist', options = {}) {
  let source = options.source || process.env.GIT_SHA;
  if (!source) {
    try {
      const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
      source = execFileSync('git', ['status', '--porcelain'], options).trim()
        ? 'local' : execFileSync('git', ['rev-parse', 'HEAD'], options).trim();
    }
    catch { source = 'local'; }
  }
  if (!/^(?:[a-f0-9]{40}|local)$/.test(source)) throw Error('E_RULESET_SOURCE');
  const result = await build({ entryPoints: [options.entry ?? 'scripts/ruleset-entry.ts'],
    bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022', minify: true,
    define: { RULESET_SOURCE_REVISION: JSON.stringify(source) }, metafile: true });
  if (Object.keys(result.metafile.outputs).some(key => result.metafile.outputs[key].imports.length)) throw Error('E_RULESET_EXTERNAL');
  const bytes = result.outputFiles[0].contents;
  const id = createHash('sha256').update(bytes).digest('hex');
  const native = await import(`data:text/javascript;base64,${Buffer.from(bytes).toString('base64')}`);
  const descriptor = { format: 1, id, source: source === 'local' ? `local:${id}` : source, data: { version: native.data.version, hash: native.dataHash },
    manifest: native.manifestVersion, modules: native.kernel.manifest.modules.map(({ id, version }) => ({ id, version })),
    actions: [...new Set(native.actions)].sort(), ...(native.view ? { view: native.view } : {}) };
  const bundlePath = join(outdir, 'current-ruleset.mjs');
  await mkdir(dirname(bundlePath), { recursive: true });
  await writeFile(bundlePath, bytes);
  await writeFile(join(outdir, 'current-ruleset.json'), `${JSON.stringify(descriptor)}\n`);
  return descriptor;
}
