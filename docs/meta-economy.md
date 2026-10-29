# Мета-экономика v0: устройство и эксплуатация

Реализованный срез [экономического роадмапа](economy-roadmap.md), каталог `meta-v0.2`: снабжение,
сборка модулей, рынок материалов, сезон и граница Commerce. Все фазы EC/MSVC этим не закрываются.

## Границы и источники истины

- `data/metaEconomy.json` задаёт материалы, рецепты, бюджеты наград, сезон и продукты.
  `metaEconomyCatalog.ts` проверяет ссылки на игровые данные при запуске.
- `MetaEconomy` работает внутри Game-процесса; PostgreSQL-адаптер использует Game DB.
  Инвентарь, материалы, pity, кошелёк и receipts изменяются одной локальной транзакцией.
  Memory-адаптер сохраняет ту же атомарность, но не переживает перезапуск процесса.
- `main.ts` и `prototype/netserver.ts` подключают одинаковые доменные API и доставку.
  Commerce — отдельный процесс и отдельная БД; игровых stores и SQL-доступа к ним у него нет.
- Сессионная экономика и `GameState` не содержат кошельков Meta; локальный Sector Zero сюда не доставляется.
- «Широкий старт» (решение владельца 2026-10-15): в новой обычной партии с аутентификацией
  каждое свободное место начинает с полного каталога, поэтому боты играют без ограничений.
  Занявший место человек при входе получает снимок своего аккаунта до выдачи токена входа.
  Стартовый набор аккаунта (`starterArsenal.json`) — все корабли, кроме флагмана, и все
  простые модули; редкие модули дают дроп, мастерская и сезон.
  После выдачи/сборки/торговли `mainGameArsenal.ts` обновляет доступ к следующим постройкам
  через серверный `arsenal.sync`. Синхронизация идёт мимо лимита приказов игрока и
  повторяет временный отказ, чтобы проданный модуль не оставался доступным в идущих
  партиях. Готовые корабли не переоснащаются. Старые unrestricted матчи не мигрируются;
  корпоративные снимки обслуживает существующий контур AvA.

## Заработанный цикл и подтверждённое участие

Игрок выбирает рецепт, зарабатывает материалы, собирает модуль, использует его либо продаёт
разрешённый товар за Варранты. Пять материалов оборудования и шесть рецептов описаны в данных.
Три дополнительных материала корпораций выдаются за бои и торгуются на том же аукционе;
сезон, реклама и магазин их не дают. Казна и строительная оплата —
[corp-building-materials.md](corp-building-materials.md).
Цель снабжения показывает недостающее, но сама награду не выдаёт.

`metaEconomyDelivery.ts` принимает сохранённые сервером снимки и привязку место→аккаунт.
Клиентского endpoint награждения нет. Учитываются заслуги человека после занятия места, не AI/NPC.

| Роль | Проверяемый источник |
| --- | --- |
| Разведка | Новые известные миры относительно начального наблюдения; служебные fork-sites исключены |
| Логистика | Новые постройки/уровни, эвакуации и спасённые; дополнительно события `building.constructed`/`building.upgraded` |
| Оборона | Прирост участия в боях у сохранившихся войск либо `combat.round` защитника с ненулевым нанесённым/полученным уроном |
| Цели | Удерживаемые захваченные миры либо подтверждённое событие `planet.captured` |

За 3 разведанных мира, 2 логистических действия, 1 оборону или 1 цель начисляется
по очку участия; пороги этапов — 1 и 3 очка. Любая роль может выполнить порог сама.
Этапу нужны ещё и дни присутствия: собственные приказы игрока в 3 и 7 разных игровых днях
(`participation.stageDays`).
Пассивные XP, стартовые здания и простое присутствие награду не открывают.
Финал требует очка участия, итогового места в серверных `match.rewards` и собственного
приказа в последней четверти пребывания в партии (`participation.finalPresence`): от
`claimedAt` до поражения или `match.endedAt`. Место, брошенное ботам, полный бюджет не
получает; короткая партия получает финал и без этапов.

Присутствие — это действие, пришедшее с клиента игрока и принятое миром (`MatchRoom`
пишет его, когда у подачи есть сокет). ИИ, Хранитель, стоячие приказы и `arsenal.sync`
идут без сокета и присутствием не считаются. `economyActivity` хранит для этого роли
`orders` (игровые дни), `ordersUtc` (UTC-дни) и `eliminated` (время поражения, началом
пакета событий — в пользу игрока).

`MatchSnapshot.economyObservations` хранит первое наблюдение для `[player, claimedAt]`.
`economyActivity` хранит события по `[player, claimedAt, role]`, вне `GameState` и wire-view.
Они сохраняются атомарно со снимком и принятым `seq`; устаревшая запись их не дополняет.
Первое наблюдение неизменно, события объединяются при последующих сохранениях и рестарте.
Неуспешный prospective persist не оставляет доказательства; timer-only события также сохраняются.

Серверная политика v0: максимум 256 уникальных фактов на роль/занятие места; оборона —
по battle ID, захват — по planet ID. Проигравший защитник учитывается и без выживших. Строительство — по planet/type/level: события ядра не несут UID,
поэтому повторная такая же постройка не создаёт дополнительного долговечного факта.
Потеря построек/планеты не стирает уже записанное достижение.

Game сохраняет снимок без обращения к Meta; доставка работает после сохранения и повторяет
сканирование каждые 30 секунд, включая завершённые матчи. До settlement сохраняется
неизменный конверт фактов с ключом account+match+stage/final. Повторный вход и рестарт
переиспользуют его. Receipt проверяет fingerprint: другой payload с тем же ключом конфликтует.
Сбой Meta задерживает выдачу; он не отменяет действие игры и не расходует награду заранее.

Этапы выдают накопительные 25% и 50% бюджета; финал доводит его до 100%, с бонусом
30% за первое место или 15% за места 2–3. Повторно уже выданная доля не начисляется.
Финал даёт 20 Варрантов (максимум 100 за UTC-день) и попытку blueprint-drop по drop tables/pity.
Claim дропа общий с прежним AvA-контуром: повторного roll нет.
Чеки содержат реальные изменения, потраченные лоты и odds/pity; экран результата читает их с сервера.

## Привязка, рынок и сезон

Лот материала хранит `source`, `sourceId`, количество и `soulbound`; разделение/продажа
не стирают происхождение. Сборка сначала расходует свободные материалы; если нужны
привязанные, требуется `allowSoulbound:true`, а результат тоже привязывается.
Разбор возвращает долю рецепта; предметы Commerce/ad/season/starter/rent/lootbox
не превращаются через него в свободный товар. Выставленный предмет разобрать нельзя.

Рынок резервирует продаваемые материалы; покупка, передача, списание и ledger атомарны.
Нельзя выставить платные/рекламные или привязанные материалы. Требуется 100 XP аккаунта;
комиссия — `ceil(price × 0.08)`, предел — 20 суммарных активных лотов продавца.
`META_MARKET_FAUCET` по умолчанию 0; ненулевой faucet предназначен только для тестового стенда.

## Суверены и витрина

Баланс Суверенов ◆ лежит в состоянии аккаунта Meta (`sovereigns`) и меняется в той же
транзакции, что материалы, арсенал и receipts. Зачисляют его проверенный entitlement
Commerce (товары `sovereigns_*`: база плюс `bonusSovereigns`), ежедневные ◆ премиума и
награды за медали профиля (ниже). Рекламой ◆ не выдаются.
Возврат пакета снимает ◆, если они ещё на счёте; потраченные уводят возврат в `review-required`.

Витрина (`store` в `data/metaEconomy.json`) продаёт за ◆ пять видов товаров, по одному на
предложение: дни премиум-аккаунта (`premiumDays`, новый срок продлевает идущий, итог —
`premiumUntil`), премиум-дорожку сезона, модули, материалы и стили базы корпорации
(`corpStyle`). Цена модуля — `modulePrices`;
набор платит только за модули, которых в арсенале ещё нет, со скидкой `discountPercent`, и
выдаёт только их. Всё купленное привязано (`commerce`, soulbound): модули приходят чертежами.
`limit` ограничивает покупки на аккаунт. Цену и доступность для аккаунта сервер отдаёт в
`GET /meta-economy/me` (`store`), клиент цену не присылает.

Стиль базы корпорации (CORP-14) покупает глава за свои ◆ для всей корпорации через
`POST /meta-economy/corp-style/buy`; `store/buy` его не продаёт. Купленные стили и
применённый лежат в записи корпорации `corp:<corpId>` того же хранилища, а списание ◆ и
запись стиля идут одной транзакцией над двумя записями. Стиль остаётся у корпорации при
смене главы и пропадает с ней; стандартный есть у каждой корпорации бесплатно. Фон базы
(CORP-15, `corpBackdrop`) продаётся и применяется тем же путём и лежит в той же записи:
сервер отличает фон от стиля по каталогу, и одно не снимает другое. Правила —
[corporation-building-art.md](corporation-building-art.md), раздел 4.

Премиум (`store.premium`, пока идёт `premiumUntil`) даёт `dailySovereigns` (5 ◆) раз в UTC-день
по `POST /meta-economy/premium/daily` и `extraDailyAds` (+1) к дневному пределу снабжения за
рекламу. Пять ◆ в день держат премиум дешевле, чем он возвращает: 30 дней за 449 ◆ дают 150 ◆
(тест «keeps premium cheaper»). Ещё премиум открывает цвет текста чата и метку ★ в профиле:
`GET /profile` отдаёт `premium: true`, другим игрокам тоже. `GET /meta-economy/me` отдаёт
`premiumPerks`, `premiumDaily` (сумма и забран ли сегодня) и `ads` (использовано и предел).

Медали профиля платят за каждую достигнутую степень один раз на аккаунт ◆, ⌖ и опытом
командира (`medals` в `data/metaEconomy.json`, [ONB-16](onboarding-roadmap.md)): III —
10/20/50, II — 25/50/150, I — 60/120/400. Медали из `medals.sovereignsOnly` (регистрация и
урок на устройстве) платят только ◆. `MetaEconomy.claimMedals` ставит счётчики
`medal:<id>:<grade>` и зачисляет ◆ и ⌖ (`medal_reward` в журнале аукциона) одной
транзакцией; опыт до неё зачисляет `medalRewards.ts`.

Экран «Магазин» хаба (`prototype/src/shopScreen.ts`, решения — `decisions/shopView.ts`)
показывает вкладки Суверены, Премиум, Модули, Материалы и Стили. Пакеты Суверенов и
снабжение за рекламу берутся из `GET /commerce/offers` и пока недоступны: провайдера оплаты
нет. Остальные вкладки продают витрину за ◆. Кнопку стиля решает `decisions/corpStyle.ts`
по `GET /meta-economy/corp-style`: купить и применить может глава, остальные видят причину.
Арсенал ведёт на штучный товар модуля, «Снабжение» больше ничего не продаёт.

`frontier_fleet_2026`: 56 дней, 50 уровней, 200 XP на уровень после первого,
бесплатные и premium milestones, восемь еженедельно открываемых контрактов.
Темп сезона идёт от реального времени: каждый UTC-день с собственными приказами в любой
обычной партии даёт активной дорожке `dailyXp` (100) один раз на аккаунт
(`MetaEconomy.settleActiveDay`, receipt по аккаунту и дню). Без этого 50-й уровень при
`TIME_SCALE=1` был недостижим: опыт за партию рассчитан на ускоренные сессии.
Начатый пропуск продолжается после конца; новый истёкший начать нельзя. Milestones выдаются
один раз, выбор чертежа явный, награды привязаны. Косметические entitlements сохраняются; art/equip нет.

## API игрока

Аккаунт берётся из сессии; команды Meta имеют `requestId`, строгий body и лимит запросов.
Повтор того же намерения возвращает сохранённый результат.

| Метод и путь | Назначение / поля body кроме `requestId` |
| --- | --- |
| `GET /meta-economy/me` | Материалы, рецепты, предметы, цель, сезон, Суверены, премиум и витрина |
| `GET /meta-economy/matches/:matchId/rewards` | Собственные награды конкретного матча |
| `POST /meta-economy/supply-goal` | `recipeId` или `null` |
| `POST /meta-economy/craft` | `recipeId`, `allowSoulbound` |
| `POST /meta-economy/salvage` | `itemId` |
| `POST /meta-economy/season/select` | `seasonId` |
| `POST /meta-economy/season/claim` | `seasonId`, `level`, `defId` для выбора |
| `POST /meta-economy/store/buy` | `offerId`: покупка за Суверены; отказы `E_SOVEREIGNS`, `E_ALREADY_OWNED`, `E_OFFER_LIMIT` |
| `POST /meta-economy/premium/daily` | Ежедневные ◆ премиума; отказы `E_PREMIUM`, `E_DAILY_CLAIMED` |
| `GET /meta-economy/corp-style` | Стили своей корпорации: `corp: { head, active, owned }`, `null` вне корпорации и у новобранца |
| `POST /meta-economy/corp-style/buy` | `offerId`: стиль базы за ◆ главы; отказы `E_NOT_MEMBER`, `E_FORBIDDEN`, `E_SOVEREIGNS`, `E_ALREADY_OWNED`, `E_META_OFFER` |
| `POST /meta-economy/corp-style/apply` | `styleId`: купленный стиль или `standard`; отказы `E_NOT_MEMBER`, `E_FORBIDDEN`, `E_CORP_STYLE` |
| `POST /profiles/rewards/medals` | Без body: выплата невыплаченных степеней медалей, ответ `granted` |
| `GET /meta-market` | Баланс, доступ к торговле, лоты и история |
| `POST /meta-market/material/list`, `/buy`, `/cancel` | Материальные лоты; list: `materialId,quantity,price,requestId`, buy: `listingId,tradeId`, cancel: `listingId` |
| `GET /commerce/offers` | Версия и точное содержимое витрины |

## Commerce: готовность и доверие

`commerceMain.ts` запускается без provider adapters: все десять offers unavailable (четыре
товара и шесть пакетов Суверенов), цен/checkout нет.
Реальные платежи требуют `CommerceProvider.verify`, проверки протокола провайдера и подключения
Game→Commerce order gateway; env недостаточно. Fake adapter есть только в тестах; SDK callback не proof.

Commerce хранит versioned order, проверенный proof и durable outbox; provider transaction
нельзя привязать к другому заказу/аккаунту. `EntitlementCommandV1` передаёт product/version/source,
стабильный ID и SHA-256 payload hash, без произвольных сумм. Meta применяет свой каталог;
при его смене старые версии незавершённых заказов нужно подключать через `catalogHistory`.

`POST /internal/commerce/entitlements` и `GET /internal/commerce/entitlements/:commandId`
принимают HMAC-подписанные issuer/audience/capability/keyId/nonce/time; ответ тоже подписан.
Nonce долговечен, окно времени ±30 секунд. Game без ключей эти маршруты не открывает.
Commerce order API (`POST /commerce/orders`, `GET /commerce/orders/:orderId`) принимает только
подпись `game→commerce`, capability `orders.self`; Game JWT/его секрет туда не передаются.
Webhook: `POST /commerce/webhooks/:provider`, исходные байты проверяет adapter.

## Commerce: установка и запуск

Нужны Node 22 и зависимости `pg`/`fastify`. Сборка из корня: `node prototype/bundle-netserver.mjs`.

Администратор создаёт отдельную БД; пароли — через `\password`/secret manager. Пример без role membership:

```sql
CREATE ROLE commerce_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE commerce_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE commerce OWNER commerce_migration;
REVOKE ALL ON DATABASE commerce FROM PUBLIC;
GRANT CONNECT ON DATABASE commerce TO commerce_runtime;
\connect commerce
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO commerce_runtime;
```

Migration job с `COMMERCE_DATABASE_MIGRATION_URL`: `node packages/server/dist/commerce-migrate.mjs`. Затем grants:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON commerce_orders, commerce_provider_transactions,
  commerce_provider_receipts, commerce_delivery, commerce_gateway_nonces TO commerce_runtime;
GRANT SELECT ON commerce_schema_revision TO commerce_runtime;
```

Runtime получает `COMMERCE_DATABASE_URL` с ограниченной ролью, `COMMERCE_META_URL` (origin HTTPS;
HTTP разрешён только loopback), `COMMERCE_META_KEY_ID`/`COMMERCE_META_KEY` и отдельную пару
`COMMERCE_GATEWAY_KEY_ID`/`COMMERCE_GATEWAY_KEY`; используйте случайные ASCII-ключи от 32 символов.
Запуск: `node packages/server/dist/commerce-server.mjs`. Адрес по умолчанию `127.0.0.1:8790`,
переопределяется `COMMERCE_HOST`/`COMMERCE_PORT`; `COMMERCE_TLS_CERT`/`COMMERCE_TLS_KEY` — парные пути.
Migration URL, Game `DATABASE_URL` и `AUTH_JWT_SECRET` в окружение Commerce runtime не передаются.
Проверка старта запрещает DDL/TEMP, membership, владение таблицами, доступ к сторонним таблицам,
запись revision и избыточные grants. Несовпадение schema fingerprint останавливает запуск.

Game/Meta получает соответствующую `COMMERCE_META_KEY_ID`/`COMMERCE_META_KEY` либо
`COMMERCE_META_KEYS` (JSON keyring, до восьми ключей). Ротация: сначала добавить новый receiver
key и перезапустить Game, затем переключить Commerce sender; после остановки старых sender
удалить старый key. Gateway runtime принимает одну пару; бесшовная ротация gateway не реализована.
Game DB мигрируется своим `database-admin.mjs migrate` с `DB_MIGRATION_URL`; Commerce migration
не запускает Game migrations, его таблицы не входят в Game `APP_TABLES`.

## Сбои, возвраты и проверенные сценарии

`/health` проверяет процесс; `/ready` — только Commerce DB. Отключённый Meta не делает
Commerce локально неготовым и не блокирует Game. Доставка сначала спрашивает status,
затем повторяет неизменный command; HTTP timeout — 2 секунды, есть dependency circuit breaker.
Worker берёт до восьми deliveries, lease 15 секунд, следующий проход через секунду после окончания.
Сетевые сбои повторяются с exponential backoff/jitter; после восьмого сбоя — `review-required`.
Доменный отказ отправляет на review сразу. Для диагностики нужны order ID, command ID и receipt,
а не повторная выдача с новым ID. `CommerceService.retry(commandId)` — программный операторский
порт без CLI/HTTP endpoint; он не переоткрывает уже подтверждённые receipts.

Refund/chargeback ждёт подтверждённый исходный grant. Meta отзывает только его нерасходованные
привязанные лоты/предмет; расход или выданная premium-награда требуют review без удаления earned.
Review блокирует новые заказы аккаунта. Отмена до подтверждения grant также требует review.
Проверки: `metaEconomy*.test.ts`, `metaCombatWiring.test.ts`, `mainGameArsenal.test.ts`,
`metaMarket*.test.ts`, `commerce*.test.ts`, `databaseSecurity.test.ts`: включая PostgreSQL,
атомарность, конкурентные повторы, рестарт, stale seq, потерю защитника/построек/целей и grants.
Live smoke собранного Commerce выполнен с отдельной PostgreSQL БД и ограниченной ролью:
миграция и запуск успешны, `/ready` возвращал 200 при недоступном Meta, четыре offers unavailable,
анонимный order — 401; процесс штатно завершился. Это проверка runtime, не реальных платежей.
