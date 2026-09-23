/**
 * Сторож платформенной цели (`YAG-1.1b`) — в двух частях, и это не симметрия.
 *
 * **Всегда** проверяется САМ СНИППЕТ по `prototype/build.mjs`: это единственное место,
 * где ошибка стоит отказа модерации (п. 1.19.1 — «строго так, как указано»), и она не
 * требует сборки. Абсолютный адрес вместо относительного, потерянный `async`, тег после
 * скрипта игры — всё это ловится статически, в каждом прогоне гейта.
 *
 * **При наличии артефакта** проверяется его форма: раскладка, имена файлов, размер.
 * `dist/` не коммитится и в гейте не собирается, поэтому здесь `skipIf` — ровно та же
 * конвенция, что у durable-тестов с Postgres: фальшивый зелёный хуже честного пропуска.
 * Собрать: `pnpm run prototype`. В CI эту половину покрывает браузерный смоук, который
 * поднимает уже СОБРАННЫЙ бандл.
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
const BUILD_SCRIPT = readFileSync(new URL('../../build.mjs', import.meta.url), 'utf8');

const walk = (dir: string, prefix = ''): { path: string; size: number }[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? walk(join(dir, entry.name), rel)
      : [{ path: rel, size: statSync(join(dir, entry.name)).size }];
  });

// Эта половина работает ВСЕГДА — сборка ей не нужна.
describe('YAG-1.1b — сниппет подключения SDK (п. 1.19.1)', () => {
  /** ЗНАЧЕНИЕ константы, а не весь файл: упоминание адреса в комментарии — не подстановка
   *  его в тег. Первая редакция этого теста проверяла файл целиком и упала на соседней
   *  строке документации; проверять надо то, что реально уедет в разметку. */
  const loader = /const SDK_LOADER = `([\s\S]*?)`;/.exec(BUILD_SCRIPT)?.[1] ?? '';

  /** Шаблон `page()` целиком — от стрелки до закрывающего бэктика с точкой с запятой.
   *  Ровно он решает, что попадёт в разметку платформенной цели. */
  const pageTemplate = /const page = \([^)]*\) => `([\s\S]*?)`;\n/.exec(BUILD_SCRIPT)?.[1] ?? '';

  it('шаблон страницы найден — иначе проверки ниже молча проверяют пустоту', () => {
    expect(pageTemplate.length).toBeGreaterThan(1000);
  });

  it('константа лоадера найдена — иначе сторож молча проверяет пустоту', () => {
    expect(loader).not.toBe('');
  });

  it('тег дословно такой, как в документации, и путь ОТНОСИТЕЛЬНЫЙ', () => {
    expect(loader).toContain('<script async src="/sdk.js" onload="initSDK()"></script>');
  });

  it('абсолютный адрес S3 не подставлен: это вариант «свой домен», а мы грузим архив', () => {
    expect(loader).not.toContain('sdk.games.s3.yandex.net');
  });

  it('страница площадки подключает стили и скрипт игры ФАЙЛАМИ, лоадер — первым', () => {
    // `external` — тот самый параметр `page()`, который делает цель разложенной.
    //
    // ⚠️ Порядок проверяется ВНУТРИ шаблона страницы, а не по всему файлу, и это
    // не педантизм: первая редакция искала `SDK_LOADER` где угодно и находила его
    // ОБЪЯВЛЕНИЕ — мутация «убрать лоадер из шапки страницы» прошла мимо неё. Сторож
    // был слеп ровно к той поломке, ради которой заведён.
    //
    // Тег в переменной не держим: Semgrep (`unknown-value-with-script-tag`) помечает
    // соседство неизвестного значения с тегом `<script>`, и первая редакция получила
    // два алерта. Подавить директивой честно не выходит — правило приезжает из registry
    // (`p/javascript`), закрытого egress-политикой сессии, то есть проверить подавление
    // локально нечем, и оно осталось бы обещанием.
    expect(pageTemplate).toContain('<script src="assets/app.js"></script>');
    expect(pageTemplate).toContain('<link rel="stylesheet" href="assets/app.css">');
    expect(pageTemplate.indexOf('SDK_LOADER')).toBeGreaterThan(-1);
    expect(pageTemplate.indexOf('SDK_LOADER')).toBeLessThan(
      pageTemplate.indexOf('assets/app.js'),
    );
  });

  it('лоадер SDK стоит ДО стилей, иначе `initSDK` объявляется позже, чем зовётся', () => {
    // YAG-1.1c, нашёл робот `yandextest.mjs`. Встроенный `<script>` с `initSDK` ждёт уже
    // запрошенные стили, а `async`-скрипт SDK — нет. Стоял лоадер после `app.css` (323 КБ)
    // — маленький SDK доезжал раньше, его `onload` звал ещё не объявленный `initSDK`, и
    // каждый запуск писал в консоль ReferenceError. Игра стартовала (хост видит готовый
    // `YaGames` сам), но ошибку в консоли видит и модерация.
    expect(pageTemplate.indexOf('SDK_LOADER')).toBeLessThan(
      pageTemplate.indexOf('<link rel="stylesheet" href="assets/app.css">'),
    );
  });
});

// Форма артефакта: нужна собранная цель (см. шапку).
describe.skipIf(!BUILT)('YAG-1.1b — архив для площадки', () => {
  // ⚠️ Ленивое чтение, а не в теле `describe`: тело выполняется даже у пропущенного
  // набора (vitest собирает его, чтобы знать состав), и `scandir` по несуществующему
  // `dist/` уронил бы ВЕСЬ файл. Ровно это и случилось в CI на первом же прогоне.
  const files = BUILT ? walk(ROOT) : [];
  const index = BUILT ? readFileSync(join(ROOT, 'index.html'), 'utf8') : '';

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
