/**
 * Сторож архива площадки (`YAG-1.1c`) — по ОПИСИ сборщика, а не по исходникам.
 *
 * Архив Яндекса собирается из того же кода, что и Void Dominion, но с флагом
 * `__SECTOR_ZERO_ONLY__`: экраны хаба, инструменты живой партии, которых в забеге нет, и
 * большие карты фронтира остаются за условием и выпадают из бандла. Сломать это можно
 * тихо и в обе стороны:
 *
 * 1. **Основная игра возвращается в архив.** Новый импорт или вызов мимо флага — и через
 *    цепочку зависимостей в архив едет полигры. Игрок этого не увидит, он просто дольше
 *    ждёт загрузку.
 * 2. **Флаг перестаёт вырезать.** Ранний `return` вместо условия, флаг через константу-
 *    псевдоним — код не выполняется, но сборщик всё равно кладёт его в архив.
 *
 * Поэтому сторож собирает архив РОВНО теми настройками, что `build.mjs`
 * (`platformBuild.mjs`), и читает опись сборщика (`metafile`): сколько байт каждый
 * исходник внёс в `app.js`. Сборка в памяти, меньше секунды — сторож работает в каждом
 * прогоне гейта, а не только когда кто-то собрал `dist/`.
 */
import { describe, expect, it } from 'vitest';
import { build, type Metafile } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { platformBuildOptions } from '../../platformBuild.mjs';
import { LOCALE_IDS } from '../../../localization/index';

/**
 * От модуля, чей код вырезан, в бандле может остаться ЗАГЛУШКА: `main.ts` грузится
 * динамическим импортом, и сборщик сохраняет пустую обёртку инициализации модуля плюс
 * мелкие помощники, которые читает общий код (`originLabel` у арсенала читает верфь).
 * Это сотни байт; настоящий экран — килобайты.
 */
const STUB_BYTES = 1024;

/** Что не должно попасть в архив, и почему — одной строкой на группу. */
const FORBIDDEN = {
  // Экраны хаба: у Sector Zero на площадке хаба нет.
  hub: [
    'prototype/src/friendsScreen.ts',
    'prototype/src/rankScreen.ts',
    'prototype/src/arsenalScreen.ts',
    'prototype/src/metaMarketScreen.ts',
    'prototype/src/profileScreen.ts',
    'prototype/src/passwordReset.ts',
  ],
  // Инструменты живой партии, которых в забеге нет (`decisions/sectorZeroTools.ts`). Почты
  // здесь нет намеренно: её код — вкладка переписки дипломатии, а дипломатию владелец оставил.
  tools: [
    'prototype/src/chatWindow.ts',
    'prototype/src/pingUi.ts',
    'prototype/src/corpScreen.ts',
    'prototype/src/marketScreen.ts',
    'prototype/src/stewardScreen.ts',
  ],
  // Автообновление APK: архив площадки обновляет сама площадка.
  apk: ['prototype/src/apkUpdate.ts'],
};
/** Большие карты фронтира: Sector Zero играет только на картах глав. */
const FRONTIER = ['data/frontier-50.json', 'data/frontier-100.json'];
/** Тексты языков (`YAG-1.1d`): в архиве они едут отдельными файлами, по одному на язык.
 *  Список — из `LOCALE_IDS`: новый язык попадает под сторожа сам. */
const LOCALES = LOCALE_IDS.map((id) => `localization/${id}.ts`);

/**
 * Сколько байт каждый исходник внёс в `app.js` — ключ по пути от корня репозитория.
 * `archive` — ровно настройки архива; «полная» сборка — те же настройки без обоих вырезов
 * архива (флага продукта и подмены рантайма языков), то есть обычная игровая сборка.
 */
async function inventory(archiveCut: boolean): Promise<Map<string, number>> {
  const res = await build({
    ...platformBuildOptions,
    // Пути описи — от корня репозитория, откуда бы ни запустили тесты.
    absWorkingDir: fileURLToPath(new URL('../../../', import.meta.url)),
    metafile: true,
    define: { ...platformBuildOptions.define, __SECTOR_ZERO_ONLY__: String(archiveCut) },
    plugins: archiveCut ? platformBuildOptions.plugins : [],
  });
  const meta: Metafile = res.metafile!;
  const [, app] = Object.entries(meta.outputs).find(([file]) => file.endsWith('/app.js'))!;
  return new Map(Object.entries(app.inputs).map(([file, input]) => [file, input.bytesInOutput]));
}

const [archive, full] = await Promise.all([inventory(true), inventory(false)]);
const bytes = (map: Map<string, number>, file: string): number => map.get(file) ?? 0;

describe('YAG-1.1c — в архиве площадки только Sector Zero', () => {
  it('опись собрана — иначе проверки ниже молча смотрят в пустоту', () => {
    expect(archive.size).toBeGreaterThan(300);
    expect(bytes(archive, 'prototype/src/sectorZeroMenu.ts')).toBeGreaterThan(STUB_BYTES);
  });

  it('каждый запрещённый модуль ЕСТЬ в полной сборке — иначе список устарел', () => {
    // Переименованный или удалённый экран иначе «проходил» бы проверку ниже вечно.
    for (const file of [...Object.values(FORBIDDEN).flat(), ...FRONTIER, ...LOCALES]) {
      expect([file, bytes(full, file) > STUB_BYTES]).toEqual([file, true]);
    }
  });

  it('от экранов основной игры в архиве остаётся не больше заглушки', () => {
    for (const file of Object.values(FORBIDDEN).flat()) {
      expect(bytes(archive, file), file).toBeLessThanOrEqual(STUB_BYTES);
    }
  });

  it('карт фронтира в архиве нет вовсе', () => {
    for (const file of FRONTIER) expect([file, bytes(archive, file)]).toEqual([file, 0]);
  });

  it('текстов языков в бандле нет вовсе — игрок скачивает файл только своего (YAG-1.1d)', () => {
    for (const file of LOCALES) expect([file, bytes(archive, file)]).toEqual([file, 0]);
  });

  it('двери по ссылке закрыты флагом: ни сброса пароля, ни входа в партию', () => {
    // Поведение проверяет робот `yandextest.mjs` (`?join=…` и `?reset=…` открывают тот же
    // Sector Zero), но в CI он не блокирует — поэтому здесь ещё и сам источник.
    const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/const bootReset = __SECTOR_ZERO_ONLY__ \? '' :/);
    expect(main).toMatch(/const bootJoinId =\s+!__SECTOR_ZERO_ONLY__ && bootParams \?/);
  });
});

describe('YAG-1.1c — флаг объявлен каждому сборщику прототипа', () => {
  // `main.ts` читает флаг напрямую, как `__PLAYER_BUILD__`: сборщик без `define` отдаёт
  // игру, которая падает на старте с ReferenceError. Харнесы гоняют редко, поэтому
  // забытый флаг всплыл бы не в тот день, когда его забыли.
  const dir = new URL('../../', import.meta.url);
  const bundlers = readdirSync(dir)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => [f, readFileSync(new URL(f, dir), 'utf8')] as const)
    .filter(([, src]) => /__PLAYER_BUILD__:/.test(src));

  it('сборщики найдены', () => {
    expect(bundlers.map(([f]) => f)).toContain('build.mjs');
    expect(bundlers.length).toBeGreaterThan(3);
  });

  it('кто задаёт `__PLAYER_BUILD__`, тот задаёт и `__SECTOR_ZERO_ONLY__`', () => {
    for (const [file, src] of bundlers) {
      const player = src.match(/__PLAYER_BUILD__:/g)?.length ?? 0;
      const product = src.match(/__SECTOR_ZERO_ONLY__:/g)?.length ?? 0;
      expect([file, product]).toEqual([file, player]);
    }
  });

  it('`build.mjs` собирает архив ТЕМИ ЖЕ настройками, что проверяет сторож', () => {
    const src = readFileSync(new URL('build.mjs', dir), 'utf8');
    expect(src).toMatch(
      /import \{[^}]*\bplatformBuildOptions\b[^}]*\} from '\.\/platformBuild\.mjs';/,
    );
    expect(src).toContain('build(platformBuildOptions)');
  });
});
