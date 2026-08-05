// Собирает и запускает прото-сервер — ПУТЬ ДЛЯ РАЗРАБОТКИ.
// Запуск из корня репозитория: node prototype/netserver.mjs (или pnpm dev:proto-server)
//
// Прод-образ так больше НЕ стартует. Он печёт бандл на этапе сборки
// (`prototype/bundle-netserver.mjs`) и запускает готовый файл, поэтому esbuild и весь
// остальной дев-тулчейн в образ не попадают. Конфигурация сборки одна на оба пути и
// живёт в bundle-netserver.mjs — чтобы дев и прод не разъехались.
import { pathToFileURL } from 'node:url';
import { bundleNetserver } from './bundle-netserver.mjs';

const outfile = await bundleNetserver();
await import(pathToFileURL(outfile).href);
