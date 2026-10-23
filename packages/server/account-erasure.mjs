import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
const outfile = 'packages/server/dist/account-erasure.mjs';
await build({ entryPoints: ['scripts/account-erasure.ts'], outfile, bundle: true,
  format: 'esm', platform: 'node', target: 'node22', external: ['pg'] });
await import(pathToFileURL(outfile).href);
