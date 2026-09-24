/**
 * Настройки сборщика для архива площадки — ОДНИ на сборку (`build.mjs`) и на сторожа описи
 * (`src/platform/productCut.test.ts`). Сторож, собирающий архив своими настройками,
 * проверял бы не тот архив, что уедет на площадку.
 *
 * Платформенная цель (`YAG-1.1b`) — РАЗЛОЖЕННЫЙ артефакт, а не один HTML. Решение владельца
 * 2026-09-17: `index.html` в корне архива плюс `assets/` рядом. Остальные три цели инлайнят
 * всё в один файл (`loader: dataurl`), и для площадки это был бы самый простой архив —
 * ровно один файл. Но data-URL это base64, то есть около +33% на каждом бинарнике, и
 * кэшировать по частям нечего: правка одной строки заставляет игрока перекачать весь
 * бандл. Раскладка принята ДО того, как приедет настоящий арт.
 *
 * Имена ассетов задаём мы (`[name]-[hash]`), потому что требование 1.22 запрещает пробелы
 * и кириллицу в именах файлов и папок архива; сторож в `buildTarget.test.ts` проверяет это
 * на готовом артефакте, а не на обещании.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

/**
 * `YAG-1.1d`: в архиве ОДИН язык на игрока, а не все сразу.
 *
 * Прототип импортирует `localization/runtime.ts`, который подключает тексты всех языков
 * (так нужно однофайловым сборкам: их открывают с диска, без сервера). Для архива площадки
 * этот импорт подменяется на `core.ts` — тот же рантайм без единого текста, — а нужный
 * язык `bootstrap.ts` догружает файлом `assets/locale-<id>.json` (`platformLocaleFiles`).
 * Сторож описи (`productCut.test.ts`) держит, что `ru.ts`/`en.ts` в `app.js` не попали.
 */
const oneLocale = {
  name: 'one-locale',
  setup(b) {
    b.onResolve({ filter: /\/localization\/runtime(\.ts)?$/ }, () => ({
      path: here('../localization/core.ts'),
    }));
  },
};

export const platformBuildOptions = {
  entryPoints: [here('./src/bootstrap.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  // Не `dataurl`: бинарники едут отдельными файлами в assets/ (см. шапку).
  loader: { '.webp': 'file', '.svg': 'file' },
  assetNames: 'assets/[name]-[hash]',
  entryNames: 'assets/app',
  outdir: here('./dist/yandex'),
  // Пути внутри бандла — ОТНОСИТЕЛЬНЫЕ: архив распаковывают в произвольный префикс на
  // стороне площадки, и абсолютный `/assets/...` там просто не найдётся.
  publicPath: '.',
  minify: true,
  legalComments: 'none',
  write: false,
  // `YAG-1.1c`: в архиве площадки только Sector Zero. Код основной игры стоит за этим
  // флагом и выпадает из бандла (как это устроено — у объявления флага в `main.ts`).
  define: { __PLAYER_BUILD__: 'true', __SECTOR_ZERO_ONLY__: 'true' },
  plugins: [oneLocale],
};

/** Путь файла языка в архиве — его же запрашивает `bootstrap.ts` (`localeAssetPath`). */
export const localeAssetPath = (id) => `assets/locale-${id}.json`;

/**
 * Файлы языков для архива: по одному на язык, каждый — `bakedLocale(id)`, то есть язык
 * поверх русского источника. Фолбэк запечён, поэтому игроку хватает ОДНОГО файла.
 *
 * Тексты лежат в TypeScript, а сборка — обычный Node-скрипт: модуль локалей сначала
 * собирается esbuild'ом в ESM и уже потом импортируется. JSON, а не JS: это данные,
 * их не исполняют, и кириллица в них остаётся UTF-8, а не `\uXXXX` (в бандле каждая
 * русская буква весит 6 байт вместо двух).
 */
export async function platformLocaleFiles() {
  const res = await build({
    stdin: {
      contents: "export { bakedLocale } from './bundles';\nexport { LOCALE_IDS } from './index';\n",
      resolveDir: here('../localization'),
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
  });
  const code = Buffer.from(res.outputFiles[0].text).toString('base64');
  const { bakedLocale, LOCALE_IDS } = await import(`data:text/javascript;base64,${code}`);
  return LOCALE_IDS.map((id) => ({
    id,
    path: localeAssetPath(id),
    contents: JSON.stringify(bakedLocale(id)),
  }));
}
