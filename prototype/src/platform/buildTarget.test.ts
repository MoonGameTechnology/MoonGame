/**
 * Сторож платформенной цели (`YAG-1.1b`) — проверяет ГОТОВЫЙ артефакт, а не намерение.
 *
 * Требования площадки к архиву проверяются модерацией по тому, что мы отправили, поэтому
 * и здесь источник истины — `prototype/dist/yandex/`, а не строки в `build.mjs`. Сборка
 * долгая, а `dist/` не коммитится, поэтому тесты пропускаются, когда артефакта нет:
 * фальшивый зелёный тут хуже пропуска. Собрать: `pnpm run prototype`.
 *
 * Что именно проверяется и почему:
 *
 * 1. **`index.html` в КОРНЕ архива** — п. 1.22, дословное требование.
 * 2. **Ни пробелов, ни кириллицы в именах** — тот же пункт. Имена ассетов задаёт
 *    `assetNames`, но новый импорт с «плохим» именем попал бы в архив молча.
 * 3. **Лоадер SDK дословно как в документации** — п. 1.19.1, и модерация отдельно
 *    смотрит его версию на debug-панели (`IT` против `IF`). Путь обязан быть
 *    ОТНОСИТЕЛЬНЫМ: это вариант «архив через Консоль разработчика».
 * 4. **Скрипт игры после лоадера** — иначе `YaGames is not defined`.
 * 5. **Размер меньше 100 МБ в распакованном виде** — п. 1.21.
 * 6. **Ни одной ссылки наружу в разметке** — архив обязан запускаться без доступа к
 *    репозиторию и без нашего CDN; заодно это и п. 8.4.2 (внешние ссылки).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../dist/yandex/', import.meta.url).pathname;
const BUILT = existsSync(join(ROOT, 'index.html'));

const walk = (dir: string, prefix = ''): { path: string; size: number }[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? walk(join(dir, entry.name), rel)
      : [{ path: rel, size: statSync(join(dir, entry.name)).size }];
  });

describe.skipIf(!BUILT)('YAG-1.1b — архив для площадки', () => {
  const files = walk(ROOT);
  const index = readFileSync(join(ROOT, 'index.html'), 'utf8');

  it('`index.html` лежит в корне, а рядом — assets/ (п. 1.22)', () => {
    expect(files.map((f) => f.path)).toContain('index.html');
    expect(files.some((f) => f.path.startsWith('assets/'))).toBe(true);
    // Раскладка, а не один самодостаточный HTML: решение владельца 2026-09-17.
    expect(files.length).toBeGreaterThan(2);
  });

  it('в именах файлов и папок нет пробелов и кириллицы (п. 1.22)', () => {
    for (const { path } of files) expect([path, /^[A-Za-z0-9._/-]+$/.test(path)]).toEqual([path, true]);
  });

  it('лоадер SDK подключён дословно и ОТНОСИТЕЛЬНЫМ путём (п. 1.19.1)', () => {
    expect(index).toContain('<script async src="/sdk.js" onload="initSDK()"></script>');
    // Абсолютный адрес S3 — вариант «свой домен». Перепутать их значит получить
    // замечание модерации на ровном месте.
    expect(index).not.toContain('sdk.games.s3.yandex.net');
  });

  it('скрипт игры подключён ФАЙЛОМ и ПОСЛЕ лоадера', () => {
    expect(index).toContain('<script src="assets/app.js"></script>');
    expect(index.indexOf('/sdk.js')).toBeLessThan(index.indexOf('assets/app.js'));
    // Инлайн-бандла в этой цели быть не должно — иначе кэшировать нечего.
    expect(index).not.toMatch(/<script>\s*\(\(\)\s*=>/);
  });

  it('стили и картинки — отдельными файлами, ссылки относительные', () => {
    expect(index).toContain('<link rel="stylesheet" href="assets/app.css">');
    const js = readFileSync(join(ROOT, 'assets/app.js'), 'utf8');
    expect(js).toMatch(/assets\/[a-z0-9-]+-[A-Z0-9]+\.webp/);
    // Абсолютный `/assets/...` не найдётся: архив распаковывают в произвольный префикс.
    expect(js).not.toMatch(/"\/assets\//);
  });

  it('разметка не ходит наружу: ни http(s)-ссылок, ни чужих доменов (п. 8.4.2)', () => {
    const external = [...index.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/g)].map((m) => m[0]);
    expect(external).toEqual([]);
  });

  it('распакованный архив далеко не дотягивает до 100 МБ (п. 1.21)', () => {
    const bytes = files.reduce((sum, f) => sum + f.size, 0);
    expect(bytes).toBeLessThan(100 * 1024 * 1024);
    // И заодно: цель не должна незаметно раздуться вдвое против однофайловой.
    expect(bytes).toBeLessThan(8 * 1024 * 1024);
  });
});
