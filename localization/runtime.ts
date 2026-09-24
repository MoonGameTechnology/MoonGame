// Точка входа для потребителей, которым нужны ВСЕ языки сразу: прототип (собирается
// esbuild'ом в один самодостаточный HTML, открываемый с диска без сервера) и тесты.
// Импорт этого файла подключает тексты всех локалей и отдаёт наружу тот же рантайм,
// что и раньше, — `t`, `tData`, `setLocale`, `localizeStaticDom` и прочее.
//
// PWA-клиент импортирует НЕ отсюда, а из `core.ts`, и подключает ровно одну локаль
// (`packages/client/src/locale.ts`): иначе игрок скачивал бы все языки — LOC-6.
// Архив площадки (`prototype/dist/yandex/`) этот файл тоже НЕ получает: его сборка
// подменяет импорт на `core.ts`, а язык игрока догружает файлом (`YAG-1.1d`,
// `prototype/platformBuild.mjs`).
import { LOCALE_SOURCES } from './bundles';
import { LOCALE_IDS } from './index';
import { registerMessages } from './core';

for (const id of LOCALE_IDS) registerMessages(id, LOCALE_SOURCES[id]);

export * from './core';
