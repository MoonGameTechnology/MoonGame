// Transpiles + bundles the dev server (TypeScript, importing the workspace's
// `@void/shared-core` TS source) and runs it. Mirrors prototype/build.mjs so we
// reuse the repo's existing esbuild — no extra runtime dependency.
// Run from the repo root: node packages/server/dev.mjs  (or: pnpm dev:server)
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const outfile = 'packages/server/dist/dev-server.mjs';
mkdirSync('packages/server/dist', { recursive: true });

await build({
  entryPoints: ['packages/server/src/main.ts'],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // `ws`, `pg`, `fastify` and `web-push` ship native/optional bits and dynamic requires
  // (fastify's avvio/find-my-way/pino; web-push's vapid-helper does `require('crypto')`,
  // which esbuild's CJS-in-ESM shim can't resolve — ELIFECYCLE at boot otherwise); leave
  // them for Node to resolve at runtime. Everything else (incl. the @void/shared-core TS
  // source) is bundled. `pg` only loads with DATABASE_URL.
  external: ['ws', 'pg', 'fastify', 'web-push'],
});

await import(pathToFileURL(outfile).href);
