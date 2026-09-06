import { defineConfig, type Plugin } from 'vite';
import { bakedLocale } from '../../localization/bundles';
import { LOCALE_IDS, isLocaleId } from '../../localization/index';

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

export default defineConfig({ plugins: [voidLocaleChunks()] });
