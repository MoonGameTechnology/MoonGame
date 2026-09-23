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
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

export const platformBuildOptions = {
  entryPoints: [here('./src/bootstrap.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  // Не `dataurl`: бинарники едут отдельными файлами в assets/ (см. шапку).
  loader: { '.webp': 'file' },
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
};
