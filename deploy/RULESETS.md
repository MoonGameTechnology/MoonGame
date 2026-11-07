# Пакеты правил сетевых матчей

Хост исполняет каждый матч на закреплённых kernel/data/config и проекции видимости.
Исходники механизма: `packages/server/src/rulesets/`, `scripts/ruleset-entry.ts`,
`packages/server/build-ruleset.mjs`. [Политика и roadmap](../docs/versioning.md).

## Штатная доставка

Подписанный image содержит `packages/server/dist/current-ruleset.mjs` и `.json`.
`update.sh` после `verify-image.sh` вызывает `ruleset-cache.mjs`: он проверяет digest
байтов и источник image, сохраняет пакет в `$STATE_DIR/rulesets` и не исполняет код.
Пакет архивируется до миграции и запуска Game. Для подписанного обновления из git-клона
без `STATE_DIR` используется `<repo>/rulesets`, соответствующий mount Compose.
Файлы root:root 0444, каталог 0755;
права устанавливаются явно, включая системный `UMask=0077`.

Compose подключает этот каталог к `/app/rulesets:ro`. Отдельный постоянный том
`void-ruleset-keys` хранит `/app/ruleset-keys/key` (32 байта, 0600, uid 65532).
Образ задаёт `RULESET_KEY_FILE` и `RULESET_CACHE_DIR`; контейнер не получает права
публиковать исполняемые файлы. Ключ создаётся один раз атомарно. При существующих пинах
отсутствующий ключ останавливает загрузку, вместо выпуска новых подписей другим ключом.

`matches.ruleset` содержит HMAC-пин версии и конфига; `state.version.manifest` —
`ruleset:<sha256>`. SQL-функция/триггер не дают заменить пин или сохранить противоречивый
заголовок. Функцией владеет NOLOGIN `vd_schema`; runtime-пользователь не получает DDL.
Provision и восстановление возвращают это владение перед следующей миграцией.

## Проверка снимков

Через защищённый административный доступ к БД можно проверить метаданные, не выводя мир:

```sql
SELECT id, data_version, seq, status, state->'version' AS version,
       ruleset->>'id' AS ruleset_id
FROM matches ORDER BY created_at;
```

`E_MATCH_RULES_MISMATCH (ruleset:E_RULESET_MISSING)` означает отсутствие пакета/пина;
`E_RULESET_INTEGRITY` — несоответствие подписи или байтов; `E_RULESET_UNSUPPORTED` —
неподдерживаемый контракт. Такой матч остаётся в БД и не заменяется новым. Непустой
стор не засевается заново, даже если не поднята ни одна комната.

## Старые снимки без пина

Совпадение data/hash не доказывает, какой код исполнялся при запуске. Нужны история
доставки и точный исходный commit. Соберите самодостаточный пакет из этого исходника,
сохранив родные алгоритмы, модули, каталог, конфиг, автоматику и проекции. Сверьте
исходный data/hash, проверьте ссылочную целостность мира и прогон на отдельной копии.

Проверенный оператором пакет устанавливается в защищённый кэш через `installRuleset`
из `ruleset-cache.mjs`. Не принимайте байты или путь из пользовательского запроса.
Свидетельство запуска — JSON следующего вида (значения — из проверенной истории):

```json
{
  "matchId": "MATCH_ID",
  "createdAt": 0,
  "source": "FULL_LAUNCH_COMMIT_SHA",
  "deployedAt": 0,
  "nextDeployedAt": 1,
  "version": { "data": "ORIGINAL_VERSION", "manifest": "ORIGINAL_MANIFEST", "dataHash": "ORIGINAL_HASH" },
  "nativeManifest": "NATIVE_MANIFEST",
  "config": { "timeScale": 1, "victory": { "scoreLimit": 3800 } }
}
```

Нужно `deployedAt <= createdAt < nextDeployedAt`. CLI проверяет все значения и родной
конфиг. Перед применением сохраняется резервный комплект. Файл свидетельства должен
быть приватным и доступным uid контейнера; сам ключ в аргументы не передаётся.

```bash
docker exec deploy-server-1 /nodejs/bin/node \
  packages/server/dist/ruleset-legacy-bind.mjs MATCH_ID RULESET_SHA256 \
  /tmp/private-witness.json --dry-run

docker exec deploy-server-1 /nodejs/bin/node \
  packages/server/dist/ruleset-legacy-bind.mjs MATCH_ID RULESET_SHA256 \
  /tmp/private-witness.json --apply
```

Применение выполняет compare-and-swap по исходным состоянию, seq и часам. Меняются
только внешний пин и manifest, указывающий на **старый** движок. Родные data/hash,
мир, очереди, `pricing`, seq, часы и `created_at` сохраняются; исходный заголовок
остаётся в подписанном свидетельстве. Неподтверждённые снимки остаются изолированными.
Production prototype читает состав комнат при запуске: после применения нужен штатный
контролируемый перезапуск игрового процесса для подключения комнаты.

## Резервный комплект

Для восстановления нужны SQL-снимок, **тот же** HMAC-ключ и все упомянутые в снимке
пакеты `.mjs`/`.json`. SQL-резервирование само по себе не копирует том ключа и root-кэш.
После первого запуска сохраните их отдельной зашифрованной копией в защищённом месте;
проверьте расшифровку и наличие каждого ID из SQL-снимка. Ключ не выводят в чат/логи,
не хранят в БД и не ротируют с JWT или очередным image.

При восстановлении возвращают ключ с uid 65532 и правами 0600, пакеты — в проверенный
root-кэш с проверкой SHA-256. Восстанавливаемые архивы проверяют до извлечения: допустимы
только ожидаемые обычные файлы ключа/пакетов, без symlink и произвольных путей.
Запуск с утраченной подписью не является миграцией матчей.

Старые пакеты не удаляют по возрасту image: живые комнаты, архивы и резервные копии
могут ссылаться на них после удаления контейнера. Автоматическая сборка мусора и единый
offsite-комплект остаются в [roadmap](../docs/versioning.md#6-следующие-этапы-и-границы-vps).

## Дополнительные окружения и откат

У отдельного stage/локального durable-хоста должны быть собственные постоянные ключ
и кэш. Stage с корневой ФС и mounts только для чтения требует заранее подготовленного
приватного ключа, доступного uid 65532, и read-only mounts ключа/кэша до обновления image.
Production-ключ не копируют в stage. Полная матрица исторических пакетов и нагрузочные
проверки выполняются вне игрового VPS.

Откат на прежний хост, ещё не понимающий капсулы, сохраняет строки БД, но изолирует
такие матчи из-за manifest. Для продолжения нужен хост с поддержкой соответствующего
формата; переписывание пинов под старый бинарник недопустимо.

## Воспроизводимый entry для исходного запуска 0.1.76

Ниже сохранён адаптер для commit `77d0fccbb46c9d10fa69636cfc6dd7a9de8d03ac`
(родной манифест 97, data/hash `0.1.76` / `10b0717c0fb8c5`). Он связывает родные
функции с контрактом капсулы; исходная симуляция не редактируется. Сверьте чистоту
checkout и его полный commit. Установите зависимости из его lockfile.
Замените только два префикса путей и сохраните entry вне исторического checkout.
Сборщик и его lockfile тоже сохраняются на точной версии из этого изменения.

```ts
import { createKernel, GAME_MODULES, FORTRESS_DEPLOY_COST, hashGameDataBundle, resolveMatchConfig, type GameState, type MatchConfig } from '/path/to/launch-source/packages/shared-core/src/index';
import { data } from '/path/to/launch-source/prototype/src/gameData';
import { victoryFor } from '/path/to/launch-source/prototype/src/mapCatalog';
import { captureKernel } from '/path/to/current-builder/packages/server/src/rulesets/captureKernel';
import { aiOrders } from '/path/to/launch-source/prototype/src/ai';
import { botBehaviorOrders } from '/path/to/launch-source/prototype/src/botBehavior';
import { aiOrderSlices } from '/path/to/launch-source/prototype/src/aiOrderSlices';
import { serverAutoRetreatActions, serverAutoAssaultActions, serverChainActions } from '/path/to/launch-source/prototype/src/serverDrivers';
import { chainStamp } from '/path/to/launch-source/decisions/actions';
import { pveOrders } from '/path/to/launch-source/packages/server/src/pveOrchestrator';
import { SWARM_MEMORY_WINDOW } from '/path/to/launch-source/packages/shared-core/src/index';
import { standingOrderTickActions } from '/path/to/launch-source/packages/server/src/standingOrderDriver';
export { data };
export const sourceRevision='77d0fccbb46c9d10fa69636cfc6dd7a9de8d03ac';
export const formatVersion=1, manifestVersion='97';
export const dataHash=hashGameDataBundle(data);
export const {kernel,actions}=captureKernel(createKernel,GAME_MODULES);
export const view={fortressDeployCost:FORTRESS_DEPLOY_COST};
export function configFor(state:Pick<GameState,'mapId'|'modeId'>):MatchConfig {
  const config:MatchConfig={timeScale:1,...(state.modeId?{modeId:state.modeId}:{}),victory:victoryFor(state)};
  const result=resolveMatchConfig(data,config);
  if(!result.ok)throw Error(result.code);
  return result.config;
}
export const drivers={
  ai:aiOrders,bot:botBehaviorOrders,slices:aiOrderSlices,
  pve:(state:GameState,seq:number,session:string)=>pveOrders(state,data,{seq,session,memoryWindow:SWARM_MEMORY_WINDOW.weak}),
  *standing(state:()=>GameState){
    for(const i of serverAutoRetreatActions(state()))yield {actions:i.actions,stopOnFailure:false};
    for(const i of serverAutoAssaultActions(state()))yield {actions:i.actions,stopOnFailure:true};
    for(const c of serverChainActions(state(),state().time))yield {stopOnFailure:false,actions:[...(c.patch?[chainStamp(c.owner,c.fleetId,c.patch.steps,c.patch.waitUntil)]:[]),...c.actions]};
  },
  canonicalStanding:(state:GameState,probe:Parameters<typeof standingOrderTickActions>[2])=>standingOrderTickActions(state,data,probe),
};

import {coalitionWallNow,effectiveVictoryRules,flashBattles,getStance,identifiedNodes,inVisionBloc,visibleView} from '/path/to/launch-source/packages/shared-core/src/index';
import {approvalView} from '/path/to/launch-source/prototype/src/botFavour';
export const projection={hostFog:approvalView,coalitionWallNow,effectiveVictoryRules,flashBattles,getStance,identifiedNodes,inVisionBloc,visibleView};
```

Из корня текущего сборщика вызовите его API:

```js
import { buildRuleset } from './packages/server/build-ruleset.mjs';
await buildRuleset('/safe/output', {
  entry: '/safe/launch-entry.ts',
  source: '77d0fccbb46c9d10fa69636cfc6dd7a9de8d03ac',
});
```

Перед установкой сверяют data/hash и манифест, SHA-256 готовых байтов и результаты
изолированного прогона. Для других исходников нужен отдельный проверенный адаптер;
этот entry нельзя выдавать за поддержку произвольной старой версии.
