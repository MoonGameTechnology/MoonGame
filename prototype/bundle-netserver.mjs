// Сборка бандла прото-сервера — ОДНА конфигурация на два сценария.
//
// Раньше эта сборка жила внутри netserver.mjs и выполнялась НА СТАРТЕ контейнера. Из
// этого следовало неприятное: esbuild (а с ним весь дев-тулчейн — typescript, eslint,
// vitest, prettier) обязан был присутствовать в прод-образе, потому что без него сервер
// не поднимался. У корневого package.json прод-зависимостей нет вообще — всё лежит в
// devDependencies, — так что образ вёз с собой компилятор целиком.
//
// Стало видно, когда TypeScript 7 начал поставлять НАТИВНЫЙ tsc на Go: Trivy нашёл в
// нашем прод-образе Go-CVE из @typescript/typescript-linux-x64 и заблокировал PR #489.
// Уязвимость была в компиляторе, которому в проде делать нечего.
//
// Теперь бандл печётся на этапе СБОРКИ образа, а рантайм запускает готовый файл. Сборку
// и запуск разделяет ровно этот файл: он только собирает и ничего не импортирует.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

/** Куда кладём бандл. `ws`/`pg`/`fastify` остаются внешними, поэтому файл обязан лежать
 *  там, где pnpm сможет их разрешить — в packages/server/dist, не в prototype/dist. */
export const outfile = 'packages/server/dist/proto-server.mjs';

export async function bundleNetserver() {
  mkdirSync('packages/server/dist', { recursive: true });
  await build({
    entryPoints: ['prototype/netserver.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    // `ws`, `pg` и `fastify` тащат нативные/опциональные части и динамические require
    // (avvio/find-my-way/pino) — оставляем их Node на рантайм. Всё остальное (@void/*
    // TS-исходники и игра) вбандливается. Зеркалит packages/server/dev.mjs.
    external: ['ws', 'pg', 'fastify'],
  });
  return outfile;
}

// Запуск напрямую (`node prototype/bundle-netserver.mjs`) — собрать и выйти. Именно так
// его зовёт Dockerfile перед тем, как выкинуть devDependencies из образа.
if (import.meta.url === `file://${process.argv[1]}`) {
  await bundleNetserver();
  process.stdout.write(`bundled → ${outfile}\n`);
}
