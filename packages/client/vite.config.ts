import { defineConfig, type Plugin } from 'vite';
import esbuild from 'esbuild';
import { bakedLocale } from '../../localization/bundles';
import { LOCALE_IDS, isLocaleId } from '../../localization/index';
import {
  buildId,
  cacheablePaths,
  digestOf,
  precachePaths,
  SW_FILE,
  type BuiltFile,
} from './src/sw/precache';

const PREFIX = 'virtual:void-locale/';
/** Rollup convention: a resolved virtual id is prefixed with NUL so no other plugin
 *  (and no file system) tries to claim it. */
const RESOLVED = '\0' + PREFIX;

/**
 * Serves one module per language — `virtual:void-locale/ru`, `…/en` — each holding
 * that language with the source language baked in as a fallback (LOC-6).
 *
 * Why a build step and not an `import('../../../localization/en')`: the shared runtime
 * falls back to the source language on a missing key, so a plain per-locale import
 * would still pull `ru.ts` into every player's download (it measured 30% of the client
 * bundle). Baking makes each locale self-contained, so `locale.ts` fetches exactly one.
 *
 * Vite bundles this config, so importing the `.ts` locale sources here is a build-time
 * read — none of it reaches the browser except the JSON it emits. (The build prints a
 * forward-compat notice about those extensionless imports under the experimental
 * `configLoader: 'native'`; the default bundling loader resolves them, and adding `.ts`
 * extensions would mean turning on `allowImportingTsExtensions` for every package.)
 */
function voidLocaleChunks(): Plugin {
  return {
    name: 'void-locale-chunks',
    resolveId: (id) => (id.startsWith(PREFIX) ? RESOLVED + id.slice(PREFIX.length) : null),
    load(id) {
      if (!id.startsWith(RESOLVED)) return null;
      const locale = id.slice(RESOLVED.length);
      if (!isLocaleId(locale)) {
        this.error(`unknown locale '${locale}' — known: ${LOCALE_IDS.join(', ')}`);
      }
      return `export default ${JSON.stringify(bakedLocale(locale))};`;
    },
  };
}

/**
 * Builds the Service Worker and emits it as `dist/sw.js` with this build's file list
 * baked in (CP2.2).
 *
 * It runs LAST (`enforce: 'post'`) and reads the finished bundle, because that is the
 * only moment the answer exists: every chunk is named after a hash of its contents, so
 * "what did this build ship" is not knowable from the sources. The worker is compiled
 * separately from the app rather than added as a second Rollup input — an input would
 * be hashed like any other chunk, and a worker whose URL changes on every deploy
 * registers a SECOND worker instead of updating the installed one.
 *
 * Only emitted files are listed. The `public/` directory (the manifest and the icons)
 * is copied outside the bundle and is deliberately left to the browser: neither is
 * needed to render the app offline, and the install prompt reads them through its own
 * machinery, not through `fetch`.
 */
function voidServiceWorker(): Plugin {
  return {
    name: 'void-service-worker',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_options, bundle) {
      const files: BuiltFile[] = Object.entries(bundle).map(([path, out]) => ({
        path,
        digest: digestOf(out.type === 'chunk' ? out.code : (out.source as string | Uint8Array)),
      }));
      const cacheable = cacheablePaths(files);
      const built = await esbuild.build({
        entryPoints: [new URL('./src/sw/sw.ts', import.meta.url).pathname],
        bundle: true,
        // A classic worker script: `type: 'module'` registration is still the newer of
        // the two paths, and this file has nothing to gain from modules — it is one
        // entry with no dynamic import.
        format: 'iife',
        target: 'es2022',
        write: false,
        // Left readable on purpose: when a player reports a stale screen, the first
        // question is what this worker was told to cache, and the answer should be
        // legible in the file they are actually running.
        minify: false,
        define: {
          __VOID_BUILD__: JSON.stringify(buildId(files)),
          __VOID_PRECACHE__: JSON.stringify(precachePaths(files, LOCALE_IDS)),
          __VOID_CACHEABLE__: JSON.stringify(cacheable),
        },
      });
      const code = built.outputFiles[0]?.text;
      if (code === undefined) this.error('service worker produced no output');
      this.emitFile({ type: 'asset', fileName: SW_FILE, source: code });
    },
  };
}

export default defineConfig({ plugins: [voidLocaleChunks(), voidServiceWorker()] });
