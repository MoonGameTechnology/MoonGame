import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Картинки клиента, вынесенные из HTML отдельными файлами (`prototype/build.mjs`, цель
 * `dist/served`). Однофайловый документ уходит с `no-store`, так что 16 МБ base64-арта
 * игрок перекачивал при КАЖДОМ открытии страницы. Вынесенный файл назван по хешу своего
 * содержимого: под этим именем он не изменится никогда, и браузер держит его год.
 *
 * Скрипт среди них один — поток расчёта соло-мира (`sim-worker-<хеш>.js`): политика
 * документа пускает только поток со своего origin (`securityHeaders.ts`, правило 9). Его
 * имя проверяется отдельно и строже картинок: любой другой `.js` в каталоге не отдаётся.
 *
 * Отдаём только то, что прочитано здесь при старте: имя из запроса ищется в карте и
 * никогда не становится путём на диске, поэтому `..` и прочие обходы некуда подставить.
 */
export const ASSET_TYPES: Readonly<Record<string, string>> = {
  webp: 'image/webp',
  svg: 'image/svg+xml',
  js: 'text/javascript; charset=utf-8',
};

const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.(webp|svg)$/;
const WORKER_NAME = /^sim-worker-[0-9a-f]+\.js$/;

/** Поток расчёта соло-мира, который отдаёт сборка (см. шапку). */
export function isWorkerAsset(name: string): boolean {
  return WORKER_NAME.test(name);
}

/** Файлы каталога, которые сервер готов отдавать: имя → байты. Чужое имя пропускается. */
export function readAssetDir(dir: string): Map<string, Buffer> {
  const assets = new Map<string, Buffer>();
  for (const name of readdirSync(dir)) {
    if (ASSET_NAME.test(name) || isWorkerAsset(name)) {
      assets.set(name, readFileSync(join(dir, name)));
    }
  }
  return assets;
}

/** Тип содержимого по расширению; имя уже прошло `ASSET_NAME` или `WORKER_NAME`. */
export function assetType(name: string): string {
  return ASSET_TYPES[name.slice(name.lastIndexOf('.') + 1)] ?? 'application/octet-stream';
}
