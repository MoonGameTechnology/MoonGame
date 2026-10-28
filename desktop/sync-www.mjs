// Builds the prototype and stages its platform target (`prototype/dist/yandex/`:
// index.html + assets/) as the desktop web root `desktop/www/`. Paths are relative to
// this file, so it works regardless of the current working directory.
import { execSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const src = fileURLToPath(new URL('../prototype/dist/yandex/', import.meta.url));
const www = fileURLToPath(new URL('./www/', import.meta.url));

execSync('node prototype/build.mjs', { cwd: root, stdio: 'inherit' });
rmSync(www, { recursive: true, force: true });
cpSync(src, www, { recursive: true });
console.log('staged desktop/www/ from prototype/dist/yandex (Sector Zero platform build)');
