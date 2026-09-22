# Индекс кирпичей — что где лежит и в каком статусе

<!-- ГЕНЕРИРУЕТСЯ scripts/docs-check.mjs. Руками не править: гейт сверяет этот файл с
     разбором бэклога и роадмапов и краснеет на расхождении. Перегенерировать —
     node scripts/docs-check.mjs --write-index -->

> **Зачем файл нужен.** «Есть ли уже кирпич про X?» — вопрос ПЕРЕД тем, как завести
> новый. Без индекса ответ стоил перебора двенадцати тысяч строк бэклога и полутора
> десятков роадмапов, и дубль ловился везением. Здесь он находится одним поиском.

> **Источник правды — не этот файл.** Тело кирпича, его условие готовности и разбор
> живут там, куда указывает колонка «Где». Здесь только адрес и статус.

> Статусы: ✅ ⏳ 🔶 🔒 🗑 — легенда в разделе «## Статусы» бэклога.

| ID | Ст. | Зоны | Где | Заголовок |
| --- | --- | --- | --- | --- |
| A1 | ✅ |  | `docs/backlog.md:50` | Проекция visibleState(state, viewerId, data) — identify (1 прыжок) + |
| A1m | ✅ |  | `docs/backlog.md:53` | Память последнего увиденного (вариант B): GameState.fog (per-player |
| A2 | ✅ |  | `docs/backlog.md:56` | радар-постройка с 3 уровнями |
| A3 | ✅ |  | `docs/backlog.md:64` | Разведка флотом: транзитный флот опознаёт ближайший узел по ходу (fleetNode), |
| A4 | ✅ |  | `docs/backlog.md:67` | Хелпер isVisibleTo(state, viewer, {planetId/fleetId}, data) — «видим ли объект |
| A5 | ✅ |  | `docs/backlog.md:71` | Общая видимость союза/коалиции: coverageFor объединяет покрытие по «блоку |
| B1 | ✅ |  | `docs/backlog.md:81` | Расширить FactionDef: стартовый лоадаут (startingLoadout: ресурсы/флот/ |
| B2 | ✅ |  | `docs/backlog.md:85` | factionModule: пассивы фракции через хуки economy.production/fleet.speed/ |
| B3 | ✅ |  | `docs/backlog.md:87` | factionStart(data, faction) — чистая детерминированная сборка старта из |
| B4 | 🗑 |  | `docs/backlog.md:89` | вырезано: |
| C1 | ✅ |  | `docs/backlog.md:97` | Схема TechnologyDef + data/technologies.json (анлоки/бонусы/стоимость/время). |
| C2 | ✅ |  | `docs/backlog.md:98` | technologyModule + действие technology.research, состояние анлоков (Player.technologies). |
| C3 | ✅ |  | `docs/backlog.md:99` | Предматчевый выбор: SlotAssignment.technologies (buildFromMap) — стартовые |
| C4 | ✅ |  | `docs/backlog.md:104` | Бонусы тех на хуках (производство/скорость/бой) + гейт постройки юнитов/зданий. |
| D1 | ✅ |  | `docs/backlog.md:108` | Состояние дипломатии в GameState: diplomacy?: Record<pairKey, DiplomaticStance> |
| D2 | ✅ |  | `docs/backlog.md:112` | diplomacyModule (modules/diplomacy.ts): действие diplomacy.declare |
| D3 | ✅ |  | `docs/backlog.md:120` | Consent-протокол смягчения — то же действие diplomacy.declare, взаимно: |
| D4 | ✅ | proto | `docs/backlog.md:128` | Миграция прототипа на ядровый diplomacyModule завершена. Игровая |
| E1 | ✅ |  | `docs/backlog.md:138` | Зод-схемы на каждый тип действия (закрыт SV-1.2: |
| E2 | ✅ |  | `docs/backlog.md:140` | Стор receipts с интерфейсом под персистентность (закрыт сервером: |
| E3 | ✅ |  | `docs/backlog.md:142` | Интеграционный тест: невалидное / повтор по тому же id / несанкц. |
| F1 | ✅ |  | `docs/backlog.md:147` | Скелет Fastify + health-роут (SV-0.1: /health·/ready·/metrics, pino, drain). |
| F2 | ✅ |  | `docs/backlog.md:148` | Postgres JSONB: load/save GameState + квитанции (store/postgres.ts), |
| F3 | ✅ |  | `docs/backlog.md:150` | (переопределён): будилка по scheduled-событиям — v1 без Redis/BullMQ |
| F4 | ✅ |  | `docs/backlog.md:153` | WebSocket-слой: пуш per-player дельт (wsServer.ts + protocol.ts). |
| F5 | ✅ |  | `docs/backlog.md:154` | Последовательная обработка действий: per-room актор-mailbox на durable-пути |
| F6 | ✅ |  | `docs/backlog.md:156` | перед |
| F7 | ✅ |  | `docs/backlog.md:160` | JWT в WS-handshake (SE-0.1: join-токен в ?token=, auth.ts, пин алгоритма, |
| F8 | ✅ |  | `docs/backlog.md:162` | Persist + драйвер пробуждения в packages/server/src/main.ts (паритет с |
| G1 | ✅ |  | `docs/backlog.md:184` | (в PWA-варианте, G1→CP1) Оболочка — Vite-shell вместо RN (решение |
| G2 | 🗑 |  | `docs/backlog.md:189` | Skia-рендер карты (зум / скролл / culling) — RN-вариант, снят вместе с RN. |
| G3 | ✅ |  | `docs/backlog.md:193` | (в @void/client: applyDelta-применение серверных diff'ов уже зашиплено; RN-вариант не нужен). |
| G4 | ✅ |  | `docs/backlog.md:194` | Превью через shared-core («если атакую — что будет?»): ядровая половина — |
| H1 | ✅ |  | `docs/backlog.md:207` | victoryModule подключён в кернел прототипа (game.ts MODULES — а значит и в |
| H2 | ✅ |  | `docs/backlog.md:212` | орбитальное |
| H3 | ✅ |  | `docs/backlog.md:221` | фракции |
| H4 | 🗑 |  | `docs/backlog.md:230` | Конструктор наземной армии: пехота в 3 вариантах (militia — дешёвое мясо, |
| H5 | ✅ |  | `docs/backlog.md:258` | Шпионаж играбелен (SPY-1 → прототип): ядровый espionageModule в MODULES |
| SPY-2 | ✅ | core | `docs/backlog.md:264` | Контрразведка: каждый оплаченный espionage.spy дополнительно |
| SPY-UX | ✅ | proto | `docs/backlog.md:273` | Весь шпионаж в одном месте (фидбек плейтеста 2026-07-18): |
| H6 | ✅ |  | `docs/backlog.md:282` | Локализация прототипа (1 язык = 1 файл): prototype/src/i18n.ts — |
| LOC-1 | ✅ | proto docs | `docs/backlog.md:293` | Локализация на КЛЮЧАХ, единая папка /localization |
| LOC-2 | ✅ | proto | `docs/backlog.md:315` | Этап 2: домиграция остальных вызовов на ключи — ЗАКРЫТ. |
| LOC-3 | ✅ | cli | `docs/backlog.md:496` | Подключить packages/client к /localization. |
| LOC-4 | ✅ | proto | `docs/backlog.md:524` | Разъединить смёрженные ключи локализации — ПРОВЕРЕНО, работы нет. |
| LOC-5 | ✅ | proto cli | `docs/backlog.md:548` | Один рантайм локализации вместо двух копий. |
| LOC-6 | ✅ | cli | `docs/backlog.md:568` | Локаль грузится по требованию, а не обе сразу. |
| LOC-7 | ✅ | proto | `docs/backlog.md:635` | Отказы ядра без текста: 67 кодов из 116 доезжают до игрока |
| REL-5 | ✅ | srv cli proto ops | `docs/backlog.md:669` | Замок мест: посадочный билет на ник-логине |
| REL-4 | ✅ | srv ops | `docs/backlog.md:689` | Action-гейт включён на играбельном пути (netserver). |
| REL-3 | ✅ | ops | `docs/backlog.md:700` | Сервер одной командой + отказоустойчивая инфраструктура. |
| REL-2 | ✅ | core proto | `docs/backlog.md:713` | Полнота гейт-схем — вся игра играбельна через |
| REL-1 | ✅ | proto | `docs/backlog.md:724` | Цепочка приказов УДАЛЕНА к релизу |
| CC-6 | ✅ |  | `docs/backlog.md:736` | Лимит очереди по ПРИКАЗАМ игрока (не шагам) + подписка: один enqueue = |
| CC-srv-2 | ✅ |  | `docs/backlog.md:747` | Стоячие приказы серверно-авторитетны (CC-2 авто-штурм + CC-4 дежурный |
| ECON-1 | ✅ |  | `docs/backlog.md:762` | Набор ресурсов → 5: credits(деньги)/metal/food/energy/microelectronics |
| ECON-2 | ✅ |  | `docs/backlog.md:765` | Сессионная биржа (marketModule, GameState.market): market.list |
| ECON-3 | ✅ |  | `docs/backlog.md:768` | Производители energy/microelectronics (здания): powerplant (Fusion |
| ECON-4 | ✅ |  | `docs/backlog.md:774` | (прототип) UI биржи: окно «Рынок» в рельсе — вкладки ресурсов, продажа/покупка с эскроу, листинг/от… |
| ECON-5 | ✅ |  | `docs/backlog.md:775` | Экономика зданий (содержание + brownout): BuildingDef/BuildingLevel |
| SES-1 | ✅ | core proto | `docs/backlog.md:804` | Коалиционный порог победы (GDD §3.3). |
| AVA-0 | ✅ | core proto | `docs/backlog.md:813` | Играбельный командный бой (2v2 и т.п.) — первый шаг к |
| SES-2 | ✅ | core srv | `docs/backlog.md:824` | Награды по итогам сессии (GDD §3.4). |
| SES-3 | ✅ | core data | `docs/backlog.md:855` | Премиум-добыча (GDD §4.3). |
| EFX-1 | ✅ | core | `docs/backlog.md:871` | Универсальный движок трейтов/эффектов. |
| CORP-0 | ✅ | srv | `docs/backlog.md:893` | База корпораций (членство/роли RBAC + store + REST). |
| AVA-1 | ✅ | srv core | `docs/backlog.md:911` | Командная дипломатия на серверном пути. |
| AVA-2 | ✅ | srv | `docs/backlog.md:919` | Очки влияния корпорации. |
| AVA-3 | ✅ | srv | `docs/backlog.md:924` | Флаги готовности к AvA. |
| AVA-4 | ✅ | srv | `docs/backlog.md:929` | Вызов/принятие (S0–S2). |
| AVA-5 | ✅ | core data | `docs/backlog.md:939` | Пул AvA-карт + eligibility. |
| AVA-6 | ✅ | srv | `docs/backlog.md:947` | Сбор ростера + лок (S3). |
| AVA-7 | ✅ | srv | `docs/backlog.md:961` | Оркестратор: сессия из ростера (S4). |
| AVA-8 | ✅ | srv | `docs/backlog.md:973` | Мир→война→итог (S5–S7). |
| AVA-9 | ✅ | srv | `docs/backlog.md:992` | Публичная лента корпораций. |
| ARS-0 | ✅ | docs | `docs/backlog.md:1030` | Развилки решены владельцем (2026-07-14): |
| ARS-1 | ✅ | data core | `docs/backlog.md:1034` | Схема предмета/чертежа. |
| ARS-2 | ✅ | srv | `docs/backlog.md:1042` | ArsenalStore |
| ARS-3 | ✅ | core srv | `docs/backlog.md:1054` | Снапшот в матч. |
| ARS-4 | ✅ | srv | `docs/backlog.md:1066` | Дроп по месту + сальваж. |
| ARS-5 | ✅ | proto srv | `docs/backlog.md:1072` | Витрина + фильтр Верфи. |
| ARS-6 | ✅ | srv | `docs/backlog.md:1085` | Корп-склад + аренда. |
| ARS-7 | ✅ | srv | `docs/backlog.md:1110` | Ролл помнит версию таблицы, которая его произвела. |
| ARS-8 | ✅ | core | `docs/backlog.md:1132` | Гейт владения спрашивает ТОЛЬКО ПРО КОРАБЛИ. |
| LARS-0 | ✅ | docs | `docs/backlog.md:1167` | Решено владельцем (2026-07-14): |
| LARS-1 | ✅ | core srv | `docs/backlog.md:1173` | Живая авторизация постройки. |
| LARS-2 | 🔒 | srv | `docs/backlog.md:1193` | (EC-1.2, EC-2/EC-3 — economy-roadmap.md) Цепочка валют → фронт |
| LARS-3 | ✅ | srv data | `docs/backlog.md:1197` | Баланс и гайки честности. |
| LARS-4 | ✅ | proto | `docs/backlog.md:1211` | Живая Верфь в матче. |
| META-1 | ✅ |  | `docs/backlog.md:1226` | Деревья прокачки + меню: prototype/src/meta.ts — 3 прямые ветки |
| HERO-0 | ✅ |  | `docs/backlog.md:1253` | Скелет: герой-позиция (GameState.heroes/tempLanes/topology), |
| HERO-1 | ✅ | data | `docs/backlog.md:1256` | Схемы + data/heroes.json (архетипы: commander/ravager/vanguard/warden, |
| HERO-2 | ✅ |  | `docs/backlog.md:1262` | корабль |
| HERO-3 | ✅ |  | `docs/backlog.md:1269` | своём |
| HERO-4 | ✅ |  | `docs/backlog.md:1278` | Обобщённый hero.ability {heroId, abilityId, target?}: генерические гейты из |
| HERO-5 | ✅ |  | `docs/backlog.md:1287` | Пассивки из данных → хуки. data/heroPassives.json + HeroPassiveDefSchema |
| HERO-6 | ✅ |  | `docs/backlog.md:1295` | Фитинги корабля: data/heroFittings.json (HeroFittingDef {statMods, |
| HERO-7 | ✅ |  | `docs/backlog.md:1307` | Дерево навыков: data/heroSkillTrees.json (HeroSkillNode {name, branch?, |
| HERO-8 | ✅ |  | `docs/backlog.md:1317` | на флоте / у союзника |
| HERO-9 | ✅ |  | `docs/backlog.md:1323` | Ростер: SlotAssignment.heroes?: string[] (buildFromMap) — пред-матч |
| HERO-FX1 | ✅ | core | `docs/backlog.md:1330` | Первый провайдер шва hero.effect.<type> — heroEffectsModule |
| HERO-FX2 | ✅ | core | `docs/backlog.md:1340` | Второй провайдер — hero.effect.aura (rally/bulwark): |
| HERO-FX3 | ✅ | core | `docs/backlog.md:1351` | Третий провайдер шва — hero.effect.reveal (scan): |
| HERO-10 | ✅ | core | `docs/backlog.md:1363` | Каждый герой ведёт СВОЙ флот |
| HERO-AURA-R | ⏳ | data core | `docs/backlog.md:1382` | Радиус ауры: начать маленьким и растить навыком |
| SHIP-1 | ✅ | proto | `docs/backlog.md:1422` | Модель: prototype/src/ships.ts — корпуса (SHIPHULLS: cruiser 3 · |
| SHIP-2 | ✅ | proto | `docs/backlog.md:1426` | →♻ UI «Верфь». Первая версия — pre-match вкладка в setup — была |
| CON-1 | ✅ | proto | `docs/backlog.md:1429` | Единый таб-конструктор «Верфь» |
| CON-2 | ✅ | proto | `docs/backlog.md:1437` | Эскадрильи |
| CON-3 | 🗑 | proto | `docs/backlog.md:1440` | Армия |
| CON-4 | ✅ | proto | `docs/backlog.md:1447` | Герои |
| CON-5 | ✅ | proto | `docs/backlog.md:1450` | Мобильная адаптация «Верфи» |
| SHIP-3 | ✅ | core | `docs/backlog.md:1455` | Эффекты живые: util/loadout.ts (effectiveStats) читается боем |
| SHIP-4 | ✅ | core | `docs/backlog.md:1459` | Обобщён фиттинг-движок: один генерик инсталл-гейт |
| SHIP-5 | 🔒 | srv | `docs/backlog.md:1469` | предметы мета-экономики |
| SHIP-6 | ✅ |  | `docs/backlog.md:1471` | Типизированные слоты: корпуса в data/units.json несут |
| NETP0-1 | ✅ | proto | `docs/backlog.md:1484` | (PR #128) Порог победы в сети: netserver не передаёт config в |
| NETP0-2 | ✅ | proto | `docs/backlog.md:1487` | (PR #128) Совет учёных для p2: DEFAULTSETUP помечает p2 как AI и |
| NETP0-3 | ✅ | cli proto | `docs/backlog.md:1491` | (PR #128) Доменные события по сети: сервер уже шлёт |
| NETP0-4 | ✅ | proto srv cli | `docs/backlog.md:1495` | Сетевой чат: relay по образцу ally-пингов — |
| NETP0-5 | ✅ | proto | `docs/backlog.md:1499` | Переговоры между людьми: consent-офферы в прототипной |
| NETP0-6 | ✅ | proto | `docs/backlog.md:1507` | (PR #128) EN-локализация свежих окон: steward («Хранитель») и |
| ONB-0 | ✅ | proto | `docs/backlog.md:1520` | Флаг первого запуска + воронка. |
| ONB-1 | ✅ | proto | `docs/backlog.md:1526` | Движок гайд-марок (spotlight). |
| ONB-2 | ✅ | proto | `docs/backlog.md:1542` | Гайдовый первый матч. |
| ONB-3 | ✅ | proto | `docs/backlog.md:1549` | Just-in-time интро механик. |
| ONB-4 | ✅ | proto | `docs/backlog.md:1563` | Help/кодекс-хаб («?» везде). |
| ONB-5 | 🔶 | proto srv | `docs/backlog.md:1568` | Async-модель + дневной дайджест. |
| ONB-6 | ✅ | core proto | `docs/backlog.md:1580` | Combat-preview. |
| ONB-7 | ✅ | proto | `docs/backlog.md:1591` | Цели первой сессии. |
| ONB-8 | ✅ | proto | `docs/backlog.md:1595` | Онбординг в соц/мета-слой (корпорации/AvA) — ONB-3-механизмом, |
| ONB-9 | ✅ | proto | `docs/backlog.md:1599` | Состав мира — списком, у групп есть описание по удержанию |
| ONB-10 | ✅ | proto | `docs/backlog.md:1624` | Обучение показывало в пустоту: «постройте корабль» — а нажимать |
| ONB-11 | ✅ | proto | `docs/backlog.md:1659` | Обучение не объясняло, КАК смотреть на мир. |
| ST-3.1 | ✅ | core | `docs/backlog.md:1692` | Доля потерь по прогнозу + трипваер «враг близко». |
| ST-3.2 | ✅ | srv proto | `docs/backlog.md:1702` | Эвакуация под угрозой (поза defend). |
| THREAT-HUD | ✅ | proto | `docs/backlog.md:1711` | «Враг у ваших рубежей» живому игроку. |
| ST-3.4 | ✅ | srv proto | `docs/backlog.md:1715` | Анти-шаттл гистерезис. |
| ST-2.4 | ✅ | core srv cli | `docs/backlog.md:1719` | SITREP — журнал решений + утренний рапорт. |
| ST-3.3 | ✅ | core srv proto | `docs/backlog.md:1726` | Поза «Активная оборона». |
| ST-2.1 | ✅ | core srv proto | `docs/backlog.md:1733` | Guard-режим: точки удержания. |
| ST-4 | ✅ | proto | `docs/backlog.md:1743` | Окно «Хранителя» не закрывается по Back/Escape. |
| SES-2.1 | ✅ | srv proto | `docs/backlog.md:1764` | Автостарт сессий — мир живёт с создания. |
| SES-2.2 | ✅ | srv | `docs/backlog.md:1773` | ИИ-заместитель после 3 РЕАЛЬНЫХ дней отсутствия. |
| SES-2.3 | ✅ | srv | `docs/backlog.md:1786` | Окно входа 4 реальных дня. |
| SES-2.4 | ✅ | proto | `docs/backlog.md:1801` | Лента сессий в главном меню. |
| SES-2.5 | ✅ | srv proto | `docs/backlog.md:1812` | Регистрация/логин на игровом пути. |
| SES-2.6 | ✅ | srv ops | `docs/backlog.md:1830` | Плейтест-цикл ×24 — полный цикл живьём. |
| BRW-0 | ✅ | srv proto | `docs/backlog.md:1868` | Разные сессии — предпосылка ВСЕХ трёх фильтров. |
| BRW-1 | ✅ | srv | `docs/backlog.md:1938` | Режим в read-model. |
| BRW-2 | ✅ | proto | `docs/backlog.md:1954` | Чистый модуль фильтрации matchFilter.ts (без UI). |
| BRW-3 | ✅ | proto | `docs/backlog.md:1970` | Панель фильтров над списком «Доступные». |
| BRW-4 | ✅ | proto | `docs/backlog.md:1996` | Режим на карточке. |
| ENTRY-1 | ✅ | srv | `docs/backlog.md:2036` | join в боевом сервере теряет slot и faction — молча. |
| ENTRY-2 | ✅ | proto | `docs/backlog.md:2055` | Экран сетевого входа по образцу «Настройки схватки». |
| ENTRY-3 | ✅ | srv | `docs/backlog.md:2079` | Совет учёных доезжает до сетевого матча. |
| ENTRY-4 | ✅ | proto | `docs/backlog.md:2101` | Строка «Совет учёных» на экране сетевого входа. |
| ADDR-1 | ✅ | srv | `docs/backlog.md:2132` | Партия как сущность, а не комната из MATCHES=N. |
| ADDR-2 | ✅ | srv proto | `docs/backlog.md:2174` | Развести адрес партии и приглашение. |
| ADDR-3 | ✅ | proto srv | `docs/backlog.md:2209` | Путь вместо параметра. |
| ADDR-4 | ✅ | proto | `docs/backlog.md:2243` | «Мои партии» в хабе. |
| ADDR-5 | ✅ | proto | `docs/backlog.md:2281` | Чужой или неизвестный id сессии не должен давать пустой экран. |
| ADDR-6 | ✅ | srv proto | `docs/backlog.md:2308` | GET /matches/:id/seats отдаёт расклад партии кому угодно (IDOR, A01). |
| OPS-1 | ✅ | ops | `docs/backlog.md:2342` | update-dev.sh генерируется установщиком, поэтому не может обновить сам себя. |
| ADM-0 | ✅ | srv | `docs/backlog.md:2390` | Лобби целиком регистрируется с одного адреса. |
| ADM-1 | ✅ | srv core proto | `docs/backlog.md:2402` | Кик: названная власть над ЗАКРЕПЛЁННЫМ местом. |
| ADM-2 | ✅ | srv core | `docs/backlog.md:2423` | Кресло, сменившее владельца, несёт поколение. |
| ADM-3 | ✅ | core | `docs/backlog.md:2436` | Крыло эскадрильи: чистый состав и одна координата. |
| ADM-4 | ✅ | proto | `docs/backlog.md:2456` | Песочница: открыть все технологии одной кнопкой. |
| CONV-1 | ✅ | proto | `docs/backlog.md:2543` | Мгновенный ремонт и форс-марш: копии удаляются, ядро включается. |
| CONV-2 | ✅ | proto | `docs/backlog.md:2578` | Доковый ремонт (econScrews → fleetRepair). |
| CONV-3 | ✅ | proto | `docs/backlog.md:2600` | Гражданский налог. |
| CONV-4 | ✅ | proto | `docs/backlog.md:2624` | Столица (capital.designate). |
| CONV-5 | ✅ | core proto | `docs/backlog.md:2648` | Слоты совета учёных: прототип начинает грузить scientistModule. |
| CONV-6 | ✅ | proto | `docs/backlog.md:2682` | Хелперы крыла (src/shuttle.ts → state/shuttle.ts). |
| CONV-7 | ✅ | proto | `docs/backlog.md:2722` | Постоянные приказы. |
| CONV-8 | ✅ | proto | `docs/backlog.md:2758` | Операции с флотом (fleetLaunch → fleetOps). |
| CONV-10 | ✅ | core | `docs/backlog.md:2800` | Авто-сбора построенного нет в каноне — это пробел, а не дубль. |
| CONV-9 | ✅ | core proto | `docs/backlog.md:2836` | Рынок — единственный кирпич, где сводить придётся В ЯДРО. |
| CONV-11 | ✅ | proto data | `docs/backlog.md:2886` | Дрейф двух каталогов контента ничем не остановлен. |
| CONV-12 | ✅ | proto data | `docs/backlog.md:2936` | Свести контент к одному каталогу. |
| CORE-PARITY | ✅ | srv | `docs/backlog.md:3071` | Канон не грузил четыре модуля, которые прототип грузил — |
| CONV-13 | ✅ | docs | `docs/backlog.md:3099` | Статус кирпича врал, и проверить это было нечем. |
| CONV-14 | ✅ | docs | `docs/backlog.md:3124` | Та же гниль в роадмапах — и её оказалось вдвое больше, чем видел |
| CONV-15 | ✅ | data | `docs/backlog.md:3161` | Дефолт схемы молча менял правила: в шипнутом каталоге флот |
| CONV-16 | ✅ | proto | `docs/backlog.md:3189` | Три технологии прототипа не может открыть никто. |
| CONV-17 | ✅ | data | `docs/backlog.md:3224` | В каноническом каталоге лежала готовая проза вместо ключа — |
| CONV-18 | ✅ | docs | `docs/backlog.md:3257` | Эталон приёмки протух, и на него ссылались два кирпича. |
| AI-BAL-1 | ✅ | proto | `docs/backlog.md:3299` | Бот исследует технологии + харнес их видит. |
| AI-BAL-2 | ✅ | proto | `docs/backlog.md:3326` | Бот строит оборону и держит миры. |
| AI-BAL-3 | ✅ | proto | `docs/backlog.md:3356` | Наземная армия и десант. |
| AI-BAL-4 | ✅ | proto | `docs/backlog.md:3402` | Эскадрильи, артиллерия, герой. |
| AI-BAL-6 | ✅ | proto | `docs/backlog.md:3440` | Сессия фиксированной длины вместо гонки к порогу очков |
| AI-BAL-5 | ✅ | proto | `docs/backlog.md:3475` | Разброс между сидами — прибор НЕ ДАВАЛ статистики. |
| AI-BAL-7 | ✅ | proto | `docs/backlog.md:3507` | Бот умеет проигрывать бой. |
| AI-BAL-8 | ✅ | proto core | `docs/backlog.md:3568` | Герой вошёл в измерение. |
| AI-BAL-9 | ✅ | proto | `docs/backlog.md:3617` | Рынок ожил в обе стороны. |
| AI-BAL-10 | ✅ | proto core | `docs/backlog.md:3661` | Отчёт смешивал три вида «мёртвого» — теперь называет каждый. |
| AI-BAL-11 | ✅ | proto | `docs/backlog.md:3725` | Отступление не удешевило размен — выигрыш кто-то съедает. |
| AI-BAL-12 | ✅ | proto | `docs/backlog.md:3769` | Две фракции из четырёх вне измерения. |
| CORE-DMG-1 | ✅ | core | `docs/backlog.md:3788` | Все каналы урона идут через хук combat.damage. |
| CORE-DMG-2 | ✅ | core | `docs/backlog.md:3827` | Пропустить хук combat.damage всё ещё МОЖНО — примитив урона |
| CORE-DMG-3 | ⏳ | core | `docs/backlog.md:3872` | Ауры и пассивы героя не доходят до неближнего боя — асимметрия, |
| AI-BAL-13 | ✅ | proto | `docs/backlog.md:3891` | Бот не знает правила «один герой на флот» — и от этого стоит |
| AI-BAL-1.1 | ✅ | proto | `docs/backlog.md:3945` | Тест-боты отделены от игровых. |
| BAL-1 | ✅ | proto | `docs/backlog.md:3985` | Стартовые позиции больше не решают матч — карта-«колесо». |
| BAL-2 | ✅ | proto data | `docs/backlog.md:4018` | Фракции: перекос есть, но ВДВОЕ МЕНЬШЕ и в другую сторону. |
| BAL-3 | 🔶 | proto data | `docs/backlog.md:4057` | Кредиты, энергия и еда — декорации, а не ресурсы. |
| BAL-4 | ✅ | core proto | `docs/backlog.md:4102` | Захват прилётом обесценивает армию. |
| BAL-5 | ✅ | proto core | `docs/backlog.md:4140` | Снежный ком: 71–75%, камбэк есть у каждого четвёртого. |
| BAL-10 | ✅ | proto data core | `docs/backlog.md:4184` | Восемь дней сессии ничего не решают — что с этим |
| BAL-11 | ✅ | proto data | `docs/backlog.md:4212` | Скорость флота — сильнейший пассив, а «сбалансированный» |
| BAL-6 | 🔶 | proto data | `docs/backlog.md:4263` | Дерево технологий не даёт выбора — но причина НЕ цена. |
| BAL-7 | ⏳ | proto data | `docs/backlog.md:4303` | У heavyinfantry нет ниши. |
| BAL-8 | ✅ | proto data | `docs/backlog.md:4310` | Типы планет вернулись на карту — но только косметически. |
| BAL-9 | ✅ | proto | `docs/backlog.md:4349` | Карта была честной ценой того, что стала плоской. |
| BAL-12 | ✅ | proto | `docs/backlog.md:4402` | Прибор не достаёт до слоя hasscientist — ни один такой узел |
| BAL-13 | ✅ | proto data | `docs/backlog.md:4456` | Достроить ростер учёных: три ветки из пяти без |
| BAL-14 | ✅ | proto | `docs/backlog.md:4512` | Бот исследует псевдоузлы мета-прокачки — и получает даром то, |
| BAL-15 | ✅ | core | `docs/backlog.md:4579` | Бот не исследует НИЧЕГО: запрет грант-узлов поставлен в |
| PC-UI | ✅ | proto | `docs/backlog.md:4631` | Десктоп-полировка правой панели (consolidation, ветка |
| PERF-2 | ✅ |  | `docs/backlog.md:4655` | Оптимизационный проход по shared-core (3-линзовый агент-ревью: горячие пути |
| PERF-1 | ✅ |  | `docs/backlog.md:4670` | Сведено и проверено |
| WIKI-1 | ✅ | docs | `docs/backlog.md:4675` | найти, в каком из 98 доков искать правило про X, можно только |
| SEC-0 | ✅ |  | `docs/backlog.md:4741` | Базовый DevSecOps-пайплайн: SAST (Semgrep) + SCA (pnpm audit + osv-scanner) |
| SEC-1 | ✅ |  | `docs/backlog.md:4744` | Триаж + baseline: находок — ноль (Gitleaks v8.18.4 локально + pnpm audit + |
| SEC-2 | ✅ |  | `docs/backlog.md:4750` | Кастомные Semgrep-правила под инварианты ядра: запрет Math.random/ |
| SEC-3 | ✅ |  | `docs/backlog.md:4765` | Безопасность самого пайплайна: пин образов сканеров по sha256, |
| SEC-4 | ✅ |  | `docs/backlog.md:4769` | (аудитом доков — GitHub Code Scanning половина уже была реализована, не |
| SEC-5 | ✅ |  | `docs/backlog.md:4778` | Container scanning: Dockerfile (multi-stage, пин distroless-базы) + |
| SEC-6 | ✅ |  | `docs/backlog.md:4781` | DAST: dast-zap-джоба в security.yml (не было закомментированной |
| SEC-7 | ✅ |  | `docs/backlog.md:4793` | (SEC-5 — замок снят) Supply-chain integrity (A08): подпись |
| SEC-8 | 🔒 |  | `docs/backlog.md:4813` | OWASP Top 10 2021 |
| SEC-10 | ✅ | sec | `docs/backlog.md:4814` | Еженедельный ре-скан: security.yml получил schedule: cron |
| SEC-11 | ✅ | sec | `docs/backlog.md:4822` | Сканирование сторонних образов прода: джоба trivy-deps. |
| SEC-12 | ✅ | sec | `docs/backlog.md:4830` | Хардненинг рантайма контейнеров + честная запись о том, что на |
| SEC-14 | ✅ | sec | `docs/backlog.md:4847` | Триаж 71 находки, накопившейся после посадки trivy-deps/SEC-11. |
| SEC-18 | ✅ | sec | `docs/backlog.md:4867` | Поимённый триаж десяти находок Trivy в бинаре caddy + починка |
| SEC-22 | ✅ | sec | `docs/backlog.md:4898` | две LOW в glibc закрыли очередь мержа всему репозиторию. |
| SEC-23 | ✅ | sec | `docs/backlog.md:4914` | красный trivy-image теперь объясняет себя в логе. |
| SEC-29 | ✅ | sec ops | `docs/backlog.md:4930` | пин postgres отстал на пересборку, и предупреждение об |
| SEC-30 | ✅ | sec | `docs/backlog.md:4951` | триаж caddy протух: набор вырос вдвое, в нём CRITICAL, а два |
| SEC-32 | ✅ | sec | `docs/backlog.md:4986` | разобран весь остаток находок: postgres 35, TruffleHog 10, и |
| SEC-33 | ✅ | srv sec | `docs/backlog.md:5026` | личный JSON игрока оседал в кэше браузера: cache-control |
| SEC-34 | ✅ | sec ops | `docs/backlog.md:5054` | за пинами в Dockerfile не следил никто, и пин рантайм-базы |
| SEC-35 | ✅ | sec ops | `docs/backlog.md:5074` | свой образ Caddy публикуется и подписывается, как серверный. |
| SEC-36 | ⏳ | sec ops | `docs/backlog.md:5121` | увести Caddy с root внутри контейнера. |
| SEC-39 | ✅ | sec ops | `docs/backlog.md:5160` | исправленная libc6 в серверном образе без новых исключений. |
| SEC-40 | ✅ | sec ops | `docs/backlog.md:5172` | 43 🔴 сводного отчёта были протухшими базами, а не нашим |
| SEC-37 | ✅ | sec proto | `docs/backlog.md:5222` | браузерный сторож был мёртв с 2026-08-15 и молчал об |
| SEC-31 | ✅ | sec ops | `docs/backlog.md:5258` | собственная сборка Caddy: закрыты ВСЕ СЕМЬ достижимых CVE, |
| SEC-24 | ✅ | sec | `docs/backlog.md:5335` | неоценённая CVE в glibc снова закрыла очередь мержа. |
| SEC-27 | ✅ | sec ops | `docs/backlog.md:5349` | гейт trivy image фильтрует по ЧИНИМОСТИ, а не по |
| SEC-28 | ✅ | sec | `docs/backlog.md:5372` | вычищены подавления, ставшие после SEC-27 избыточными и |
| SEC-26 | ✅ | sec | `docs/backlog.md:5399` | пятый за две недели красный trivy-image на пустом месте, и |
| SEC-25 | ✅ | sec ops | `docs/backlog.md:5418` | бамп дайджеста базового образа + ревизия подавлений. |
| SEC-19 | ✅ | sec | `docs/backlog.md:5449` | Находки trivy-deps не доезжали до Code Scanning вообще. |
| SEC-20 | ✅ | sec | `docs/backlog.md:5473` | Триаж всего остатка находок: KICS 23, ZAP 4, TruffleHog 2. |
| SEC-21 | ✅ | srv sec | `docs/backlog.md:5505` | HTTP-периметр не уважал Origin-allowlist — теперь уважает. |
| SEC-15 | ✅ | sec | `docs/backlog.md:5542` | Второй SCA-движок: джоба dependency-check (OWASP Dependency-Check, |
| SEC-17 | ✅ | sec ops | `docs/backlog.md:5564` | [sec/ops] Прод-образ больше не везёт дев-тулчейн + гейт «образ вообще |
| SEC-13 | ✅ | sec ops | `docs/backlog.md:5597` | [sec/ops] Closed loop «просканировано → то же самое в проде»: воркфлоу |
| SEC-9 | ✅ |  | `docs/backlog.md:5620` | Ремедиация Code Scanning (dashboard-триаж 2026-07-24): CodeQL-варнинги |
| H4-REVERT | ✅ | core srv proto data | `docs/backlog.md:5629` | Снос системы дивизий, возврат к |
| GRND-1 | ✅ | proto | `docs/backlog.md:5666` | Десант — кнопка в ряду команд + меню «кого и сколько». |
| CHAIN-UX | ✅ | proto | `docs/backlog.md:5708` | Режим «Приказ» — цепочка тапами по карте с иконками и |
| SND-1 | ✅ | proto | `docs/backlog.md:5750` | Синтезированные звуки интерфейса. |
| SND-2 | ✅ | proto | `docs/backlog.md:5787` | Пинг гидролокатора: развёртка засекла цель. |
| HUD-DOCK | ✅ | proto | `docs/backlog.md:5808` | Низ экрана ведёт себя как одно целое. |
| BACK-1 | ✅ | proto | `docs/backlog.md:5842` | Реестр слоёв Back/Escape достроен — и закрыт как КЛАСС. |
| H4-TAIL | ✅ | proto | `docs/backlog.md:5887` | Уборка мёртвого кода за снесёнными фичами. |
| RANGE-UX | ✅ | proto core | `docs/backlog.md:5917` | Радиусы огня видно, и они РАВНЫ ядерным. |
| CAST-UX | ✅ | proto | `docs/backlog.md:5948` | Прицел каста: хаб уходит, дальность и область видны. |
| RECAP-FOG | ✅ | proto sec | `docs/backlog.md:5971` | Сводка перестала раскрывать чужую экономику. |
| HERO-CORRIDOR | ✅ | core data | `docs/backlog.md:5998` | Коридор стал ЛИЧНЫМ: дыра в общий граф закрыта. |
| HERO-CORRIDOR-2 | ✅ | core proto | `docs/backlog.md:6037` | Коридор стало ВИДНО, и посреди него больше |
| AIM-PAN | ✅ | proto | `docs/backlog.md:6068` | При вооружённом приказе камеру снова можно двигать. |
| MAPSHARE-1 | ✅ | core proto | `docs/backlog.md:6205` | Договор об обмене картами + высадка к своим. |
| PING-PANEL | ✅ | proto | `docs/backlog.md:6249` | Окно «Метки коалиции»: свои и союзные в одном списке. |
| UI-STD | ✅ | proto | `docs/backlog.md:6275` | Кнопки окна меток — стандартные; дерево технологий — |
| CMD-VIS | ✅ | core proto | `docs/backlog.md:6300` | Стоп в коридоре запрещён; «нет приказа — нет |
| FRIENDS-1 | ✅ | srv proto | `docs/backlog.md:6327` | Вкладка «Друзья» в хабе — с настоящим сервером. |
| BUILD-1 | ✅ | proto | `docs/backlog.md:6369` | Окно построек мира + карточка здания с уровнями. |
| ABIL-RING | ✅ | proto | `docs/backlog.md:6416` | Радиусы способностей — фиолетовым пунктиром, и не только |
| SENSOR-1 | ✅ | data core proto | `docs/backlog.md:6445` | Сенсорный фрегат: носитель радара — и сам радар |
| TABS-GRID | ✅ | proto | `docs/backlog.md:6486` | Вкладки штаба героев и дерева технологий — сеткой, |
| CORP-HUB | ✅ | proto | `docs/backlog.md:6507` | Хаб корпорации по макету: вкладки сеткой, «Штаб», «Битвы», |
| UI-RES2 | ✅ | proto | `docs/backlog.md:6560` | Ресурс нигде не печатается словом — везде иконка и цвет. |
| TT-4 | ✅ | proto | `docs/backlog.md:6596` | Вкладка технологий в матче — список ярусами вместо сетки. |
| RANK-1 | ✅ | srv proto | `docs/backlog.md:6633` | Вкладка «Рейтинги» в хабе — с настоящим сервером. |
| RETASK | ✅ | core | `docs/backlog.md:6680` | Флоту в пути можно дать новый «Курс». |
| ORBIT-ORIGIN | ✅ | proto | `docs/backlog.md:6715` | Кольцо — картинка, отсчёт — от центра мира. |
| RULES-5 | ✅ | core proto | `docs/backlog.md:6740` | Туман карты спрашивается у ядра, а не выводится |
| RULES-4 | ✅ | core proto | `docs/backlog.md:6773` | Клиентские предикаты: решение — ядру, подача — |
| RULES-3 | ✅ | core srv proto | `docs/backlog.md:6830` | Драйверы постоянных приказов спрашивают |
| RULES-2 | ✅ | core data proto | `docs/backlog.md:6894` | Правила про контент стали данными. |
| RULES-2.1 | ✅ | core proto | `docs/backlog.md:6939` | Довести maxPerPlanet > 1 до рабочего состояния. |
| RULES-1 | ✅ | core proto | `docs/backlog.md:6962` | «Можно ли?» — один вопрос к одним правилам. |
| SEC-16 | ✅ | core srv | `docs/backlog.md:7008` | Два сторожа под авто-мердж: правила, которые до сих пор |
| SEC-41 | ✅ | sec ops | `docs/backlog.md:7028` | весь наш security-контур смотрит в репозиторий; на |
| NETA2-0a | ✅ | srv | `docs/backlog.md:7087` | Начисление XP на reject-but-advanced: observeEndIfNeeded не |
| NETA2-0b | ✅ | cli | `docs/backlog.md:7091` | Клиент ре-шлёт конверт и на EUNAVAILABLE (сервер откатывает |
| NETA2-0c | ✅ | proto | `docs/backlog.md:7093` | playerOrder в net-матче на реконнекте отклоняет приказ с |
| NETA2-0d | ✅ | srv | `docs/backlog.md:7095` | ping.clientTime требует Number.isFinite (как desync/perf). |
| NETA2-1 | ✅ | srv cli | `docs/backlog.md:7096` | Прозрачные причины отказа хендшейка |
| NETA2-2 | ✅ | proto | `docs/backlog.md:7106` | Бюджет реконнекта > окна reap'а сокета |
| NETA2-3 | ✅ | srv | `docs/backlog.md:7113` | netserver не дублирует запись квитанций |
| NETA2-4 | ✅ | srv cli | `docs/backlog.md:7119` | Единый источник wire-протокола — контракт объявлен ОДИН раз. |
| NETA2-5 | ✅ | proto cli | `docs/backlog.md:7146` | Прототип использует outbox транспорта на |
| NETA2-6 | ✅ | srv proto | `docs/backlog.md:7178` | Один оффлайн-шедулер |
| NETA2-7 | ✅ | srv | `docs/backlog.md:7188` | Один джойн-хендшейк |
| NETA2-8 | ✅ | srv | `docs/backlog.md:7197` | Единое apply-ядро |
| NETA2-9 | ✅ | srv cli | `docs/backlog.md:7230` | Полировка протокола |
| NETA2-10 | ✅ | srv | `docs/backlog.md:7241` | Восстановление seat-ticket под SEATLOCK |
| NETA2-mon | ✅ | srv | `docs/backlog.md:7254` | Сигналы сбоев наружу + durable-логи |
| REFP-1 | ✅ | proto | `docs/backlog.md:7275` | prototypeData.ts |
| REFP-2 | ✅ | proto | `docs/backlog.md:7280` | map.ts |
| REFP-3 | ✅ | proto | `docs/backlog.md:7283` | fleetStacks.ts |
| REFP-4 | ✅ | proto | `docs/backlog.md:7286` | tax.ts |
| REFP-5 | ✅ | proto | `docs/backlog.md:7289` | formations.ts |
| REFP-6 | ✅ | proto | `docs/backlog.md:7293` | botFavour.ts |
| REFP-7 | ✅ | proto | `docs/backlog.md:7296` | shuttle.ts |
| REFP-8 | ✅ | proto | `docs/backlog.md:7301` | chain.ts |
| REFP-9 | ✅ | proto | `docs/backlog.md:7304` | hunger.ts |
| REFP-10 | ✅ | proto | `docs/backlog.md:7306` | fleetLaunch.ts |
| REFP-11 | ✅ | proto | `docs/backlog.md:7313` | botDiplomacy.ts |
| REFP-12 | ✅ | proto | `docs/backlog.md:7316` | sessionMarket.ts |
| REFP-13 | 🗑 | proto | `docs/backlog.md:7319` | division.ts |
| REFP-14 | ✅ | proto | `docs/backlog.md:7337` | capital.ts |
| REFP-15 | ✅ | proto | `docs/backlog.md:7340` | standingOrders.ts |
| REFP-16 | ✅ | proto | `docs/backlog.md:7343` | forcedMarch.ts |
| REFP-17 | ✅ | proto | `docs/backlog.md:7346` | instantRepair.ts |
| REFP-18 | ✅ | proto | `docs/backlog.md:7349` | econScrews.ts |
| REFP-19 | ✅ | proto | `docs/backlog.md:7352` | economy.ts |
| REFP-20 | ✅ | proto | `docs/backlog.md:7358` | matchSetup.ts |
| REFP-21 | ✅ | proto | `docs/backlog.md:7369` | protoKernel.ts |
| REFP-22 | ✅ | proto | `docs/backlog.md:7375` | actions.ts |
| REFP-23 | ✅ | proto | `docs/backlog.md:7383` | patrol.ts |
| REFP-24 | ✅ | proto | `docs/backlog.md:7390` | serverDrivers.ts |
| REFP-25 | ✅ | proto | `docs/backlog.md:7405` | stewardGuard.ts |
| REFP-26 | ✅ | proto | `docs/backlog.md:7412` | ai.ts |
| REFP-27 | ✅ | proto | `docs/backlog.md:7419` | canTraverse |
| REFP-28 | ✅ | proto | `docs/backlog.md:7423` | Финальная очистка |
| REFM-0 | ✅ | proto | `docs/backlog.md:7452` | Страховка: typecheck прототипа в гейте. |
| REFM-0.1 | ✅ | proto | `docs/backlog.md:7465` | ESLint для prototype/ |
| REFM-1 | ✅ | proto | `docs/backlog.md:7484` | Инвентаризация main.ts |
| REFM-2 | ✅ | proto | `docs/backlog.md:7590` | format.ts |
| REFM-3 | ✅ | proto | `docs/backlog.md:7602` | icons.ts |
| REFM-4 | ✅ | proto | `docs/backlog.md:7608` | dossiers.ts |
| REFM-5 | ✅ | proto | `docs/backlog.md:7626` | arsenalScreen.ts |
| REFM-6 | ✅ | proto | `docs/backlog.md:7647` | marketScreen.ts |
| REFM-7 | ✅ | proto | `docs/backlog.md:7665` | stewardScreen.ts |
| REFM-8 | 🗑 | proto | `docs/backlog.md:7686` | divisionDesigner.ts |
| REFM-9 | ✅ | proto | `docs/backlog.md:7709` | techTree.ts |
| REFM-10 | ✅ | proto | `docs/backlog.md:7730` | profileScreen.ts |
| REFM-11 | ✅ | proto | `docs/backlog.md:7755` | corpScreen.ts |
| REFM-12 | ✅ | proto | `docs/backlog.md:7775` | chatWindow.ts |
| UI-RES | ✅ | proto | `docs/backlog.md:7813` | Единая семья иконок ресурсов + «сколько не хватает». |
| REFM-13 | ✅ | proto | `docs/backlog.md:7831` | «Верфь» |
| REFM-14 | ✅ | proto | `docs/backlog.md:7854` | «Штаб героев» |
| REFM-15 | ✅ | proto | `docs/backlog.md:7880` | Конверсации |
| REFM-16 | ✅ | proto | `docs/backlog.md:7900` | prefs.ts — клиентские настройки одним правилом. |
| REFM-17 | ✅ | proto | `docs/backlog.md:7930` | sideColors.ts — цвет стороны: одна палитра, два |
| REFM-18 | ✅ | proto | `docs/backlog.md:7970` | Выбор совета учёных |
| REFM-19 | ✅ | proto | `docs/backlog.md:7991` | Сброс пароля |
| REFM-20 | ✅ | proto | `docs/backlog.md:8014` | Экран итогов матча |
| REFM-21 | ✅ | proto | `docs/backlog.md:8035` | Графические настройки |
| REFM-22 | ✅ | proto | `docs/backlog.md:8054` | Оверлей настроек |
| REFM-23 | ✅ | proto | `docs/backlog.md:8076` | Самообновление APK |
| REFM-24 | ✅ | proto | `docs/backlog.md:8096` | Вьюпорт и звёздный фон |
| REFM-25 | ✅ | proto | `docs/backlog.md:8118` | Витрина меток провинций |
| REFM-26 | ✅ | proto | `docs/backlog.md:8141` | Соло-драйверы |
| REFM-27 | ✅ | proto | `docs/backlog.md:8162` | Конец матча и награда |
| REFM-28 | ✅ | proto | `docs/backlog.md:8183` | Окна краденой разведки |
| REFM-29 | ✅ | proto | `docs/backlog.md:8203` | Политика оповещений и радарная память |
| REFM-30 | ✅ | proto | `docs/backlog.md:8222` | Сравнение дипломатии снимков |
| REFM-31 | ✅ | proto | `docs/backlog.md:8243` | Ход стройки |
| REFM-32 | ✅ | proto | `docs/backlog.md:8263` | Клиентская очередь стройки |
| REFM-33 | ✅ | proto | `docs/backlog.md:8284` | Геометрия ввода |
| REFM-34 | ✅ | proto | `docs/backlog.md:8304` | Геометрия фигур карты |
| REFM-35 | ✅ | proto | `docs/backlog.md:8323` | Кирпичики боковой панели |
| REFM-36 | ✅ | proto | `docs/backlog.md:8345` | Конвейер стройки |
| REFM-37 | ✅ | proto | `docs/backlog.md:8370` | Сводка армии |
| REFM-38 | ✅ | proto | `docs/backlog.md:8396` | Сводка мира |
| REFM-39 | ✅ | proto | `docs/backlog.md:8423` | Выбор карточки панели |
| REFM-40 | ✅ | proto | `docs/backlog.md:8448` | Карточка флота: пулы и порог хромоты из одного места |
| REFM-41 | ✅ | proto | `docs/backlog.md:8464` | Вкладки карточки мира |
| REFM-42 | ✅ | proto | `docs/backlog.md:8487` | Плитка каталога и замок повторного заказа |
| REFM-43 | ✅ | proto | `docs/backlog.md:8509` | Память разведки |
| REFM-44 | ✅ | proto | `docs/backlog.md:8532` | Раскладка мест сетапа |
| REFM-45 | ✅ | proto | `docs/backlog.md:8558` | Мини-карта экрана сетапа |
| UI-BLD | ✅ | proto | `docs/backlog.md:8581` | Плитки зданий и ряд скорости на телефоне |
| UI-BLD2 | ✅ | proto | `docs/backlog.md:8602` | Построенные здания — снова списком в столбик |
| REFM-46 | ✅ | proto | `docs/backlog.md:8622` | Хранение сессии |
| REFM-47 | ✅ | proto | `docs/backlog.md:8647` | Правила учётных данных и разбор ответов auth |
| REFM-48 | ✅ | proto | `docs/backlog.md:8672` | Обмен сессии на место в матче |
| REFM-49 | ✅ | proto | `docs/backlog.md:8701` | Выбор дома при входе в матч |
| REFM-50 | ✅ | proto | `docs/backlog.md:8726` | Строка обозревателя матчей |
| REFM-51 | ✅ | proto | `docs/backlog.md:8753` | Отложенный вход в матч |
| REFM-52 | ✅ | proto | `docs/backlog.md:8777` | Форма регистрации и подсказка позывного |
| REFM-53 | ✅ | proto | `docs/backlog.md:8807` | Зеркало опыта командующего |
| REFM-54 | ✅ | proto | `docs/backlog.md:8825` | Припуск камеры под открытой панелью |
| REFM-55 | ✅ | proto | `docs/backlog.md:8845` | Разбор нажатия на карту |
| REFM-56 | ✅ | proto | `docs/backlog.md:8869` | Стартовый вид карты |
| REFM-57 | ✅ | proto | `docs/backlog.md:8888` | Сборка окна войны |
| REFM-58 | ✅ | proto | `docs/backlog.md:8914` | Очередь «штурм по прилёте» |
| REFM-59 | ✅ | proto | `docs/backlog.md:8940` | Порядок подтверждения войны и марш по лейну |
| REFM-60 | ✅ | proto | `docs/backlog.md:8961` | Решение о перепечке статического слоя |
| REFM-61 | ✅ | proto | `docs/backlog.md:8983` | Семена политической карты и её рамка |
| REFM-62 | ✅ | proto | `docs/backlog.md:9007` | Уровень видимости узла под туманом |
| REFM-63 | ✅ | proto | `docs/backlog.md:9029` | Источники радарного покрытия |
| REFM-64 | ✅ | proto | `docs/backlog.md:9051` | Приоритет тапа по карте |
| REFM-65 | ✅ | proto | `docs/backlog.md:9073` | Выбор под тапом и перебор стопки |
| REFM-66 | ✅ | proto | `docs/backlog.md:9101` | Точка плана: прицел и вид точки |
| REFM-67 | ✅ | proto | `docs/backlog.md:9127` | Время в пути с форс-маршем |
| REFM-68 | ✅ | proto | `docs/backlog.md:9149` | Способности героя-флагмана |
| REFM-69 | ✅ | proto | `docs/backlog.md:9172` | Якорь DOM над точкой карты |
| REFM-70 | ✅ | proto | `docs/backlog.md:9196` | Жизнь экранной вспышки |
| REFM-71 | ✅ | proto | `docs/backlog.md:9223` | Раскладка плана на карте |
| REFM-72 | ✅ | proto | `docs/backlog.md:9251` | Пульс метки и сонарные кольца |
| REFM-73 | ✅ | proto | `docs/backlog.md:9281` | Отбор и группировка планов (◎-бейджи) |
| REFM-74 | ✅ | proto | `docs/backlog.md:9308` | Политика брифинга возвращения |
| REFM-75 | ✅ | proto | `docs/backlog.md:9331` | Размещение подсказок и политика удержания |
| REFM-76 | ✅ | proto | `docs/backlog.md:9353` | Арифметика деления флота |
| REFM-77 | ✅ | proto | `docs/backlog.md:9377` | Живые числа панели — свести к одной формуле |
| REFM-78 | ✅ | proto | `docs/backlog.md:9398` | Доступность командных кнопок |
| REFM-79 | ✅ | proto | `docs/backlog.md:9420` | Состояние полоски режима «Приказ» |
| REFM-80 | ✅ | proto | `docs/backlog.md:9446` | Жизнь долгого нажатия |
| REFM-81 | ✅ | proto | `docs/backlog.md:9466` | Источники ⇅-меню десанта |
| REFM-82 | ✅ | proto | `docs/backlog.md:9493` | Досье под указателем |
| REFM-83 | ✅ | proto | `docs/backlog.md:9529` | Подъём камеры из-под нижнего листа |
| REFM-84 | ✅ | proto | `docs/backlog.md:9557` | Время жизни всплывающих меню командного ряда |
| REFM-85 | ✅ | proto | `docs/backlog.md:9582` | Быстрый заказ стройки правым кликом |
| REFM-86 | ✅ | proto | `docs/backlog.md:9619` | Видимость событий в журнале |
| REFM-87 | ✅ | proto | `docs/backlog.md:9645` | Часы кадра: когда мир идёт и на сколько |
| REFM-88 | ✅ | proto | `docs/backlog.md:9671` | Судьба вооружённого приказа при тапе |
| REFM-89 | ✅ | proto | `docs/backlog.md:9693` | Пометки о долгах владельца |
| REFM-90 | ✅ | proto | `docs/backlog.md:9721` | Условия кнопок ремонта |
| REFM-91 | ✅ | proto | `docs/backlog.md:9745` | Предложения панели мира: столица и точка удержания |
| REFM-92 | ✅ | proto | `docs/backlog.md:9767` | Предложение шпионажа на панели мира |
| REFM-93 | ✅ | proto | `docs/backlog.md:9788` | Семантический зум карты: что растворяется на схеме |
| REFM-94 | ✅ | proto | `docs/backlog.md:9822` | Геометрия орбитального кольца |
| REFM-95 | ✅ | proto | `docs/backlog.md:9855` | Пунктирный маршрут идущего флота |
| REFM-96 | ✅ | proto | `docs/backlog.md:9886` | Кто может стать радарной отметкой |
| REFM-97 | ✅ | proto | `docs/backlog.md:9912` | Очередь часовой погрузки десанта |
| REFM-98 | ✅ | proto | `docs/backlog.md:9936` | Постановка стоек: авто-штурм и дежурный вылет |
| REFM-99 | ✅ | proto | `docs/backlog.md:9960` | Чем меряется прогресс первых целей ONB-7 |
| REFM-100 | ✅ | proto | `docs/backlog.md:9981` | Когда приказ поднимает обучающую вставку ONB-3 |
| REFM-101 | ✅ | proto | `docs/backlog.md:9998` | Как сообщение попадает в журнал матча |
| REFM-102 | ✅ | proto | `docs/backlog.md:10019` | Что теряет силу, когда состояние сменилось |
| REFM-103 | ✅ | proto | `docs/backlog.md:10036` | Видимость ФЛОТА под туманом |
| REFM-104 | ✅ | proto | `docs/backlog.md:10054` | Когда песочница возвращает ресурсы за стройку |
| REFM-105 | ✅ | proto | `docs/backlog.md:10076` | Всплывающее уведомление над картой |
| REFM-106 | ✅ | proto | `docs/backlog.md:10093` | Какие миры обводятся при взведённом ШТУРМЕ |
| REFM-107 | ✅ | proto | `docs/backlog.md:10116` | Догоняющее слияние флотов |
| REFM-108 | ✅ | proto | `docs/backlog.md:10139` | Переход камеры к точке карты |
| REFM-109 | ✅ | proto | `docs/backlog.md:10173` | Дальномер выбранного мира |
| REFM-110 | ✅ | proto | `docs/backlog.md:10197` | Координатная сетка фона |
| REFM-111 | ✅ | proto | `docs/backlog.md:10223` | Расписание баллистического залпа |
| REFM-112 | ✅ | proto | `docs/backlog.md:10254` | Два тира зенитного огня |
| REFM-113 | ✅ | proto | `docs/backlog.md:10287` | Послесвечение радарной развёртки |
| REFM-114 | ✅ | proto | `docs/backlog.md:10324` | У каких узлов есть орбитальное кольцо |
| REFM-115 | ✅ | proto | `docs/backlog.md:10348` | Из чего складывается эмблема флота |
| REFM-116 | ✅ | proto | `docs/backlog.md:10354` | Читаемая вместимость трюмов флота. |
| REFM-117 | ✅ | proto | `docs/backlog.md:10372` | Подпись узла на карте |
| REFM-117.1 | ✅ | proto | `docs/backlog.md:10395` | Ветка «нет телеметрии» у подписи узла — МЁРТВЫЙ КОД. |
| REFM-118 | ✅ | proto | `docs/backlog.md:10429` | Отметка боя на карте |
| REFM-119 | ✅ | proto | `docs/backlog.md:10460` | Лучи радарной развёртки |
| REFM-120 | ✅ | proto | `docs/backlog.md:10483` | Сводная граница видимости |
| REFM-120.1 | ✅ | proto | `docs/backlog.md:10517` | Гейты «прозрачность > 0» и «толщина > 0» внутри тира — |
| REFM-121 | ✅ | proto | `docs/backlog.md:10545` | Голографический бейдж типа провинции |
| REFM-122 | ✅ | proto | `docs/backlog.md:10580` | Ряд значков построек под узлом |
| REFM-123 | ✅ | proto | `docs/backlog.md:10611` | Дальность артиллерии рисовалась ДВАЖДЫ |
| REFM-124 | ✅ | proto | `docs/backlog.md:10641` | Вспышка захвата строила клетку СВОЕЙ копией формул мозаики |
| REFM-125 | ✅ | proto | `docs/backlog.md:10665` | Прицельное превью ловило узел СВОЕЙ копией радиуса захвата |
| REFM-126 | ✅ | proto | `docs/backlog.md:10690` | Тап по мини-карте расстановки |
| REFM-126.1 | ✅ | proto | `docs/backlog.md:10716` | Окно выбора совета учёных перекрывает мини-карту |
| REFM-127 | ✅ | proto | `docs/backlog.md:10749` | Сеть путей большой карты рисовалась своим циклом |
| REFM-128 | ✅ | proto | `docs/backlog.md:10771` | Точка на трассе под пальцем считалась своей геометрией |
| REFM-129 | ✅ | proto | `docs/backlog.md:10797` | Модификаторы постера считались дважды, разными числами |
| REFM-130 | ✅ | proto | `docs/backlog.md:10824` | Форма дуги осадного залпа считалась в кадровом цикле |
| REFM-131 | ✅ | proto | `docs/backlog.md:10848` | У карты была СВОЯ КОПИЯ долгого нажатия |
| REFM-132 | ✅ | proto | `docs/backlog.md:10876` | Перевод «дальность карты → пиксели» существовал в ПЯТИ |
| REFM-133 | ✅ | proto | `docs/backlog.md:10907` | Поправки посадки применяла только ОДНА из двух коробок над |
| REFM-134 | ✅ | proto | `docs/backlog.md:10933` | Обратный перевод «страница → холст» жил двумя копиями в |
| REFM-135 | ✅ | proto | `docs/backlog.md:10954` | Панель и обработчики по-разному понимали, что такое |
| REFM-136 | ✅ | proto | `docs/backlog.md:10982` | Перевод игрового времени в часы стоял ЧЕТЫРЬМЯ выражениями |
| REFM-137 | ✅ | proto | `docs/backlog.md:11006` | «Дыхание» живых слоёв фазировалось четырьмя способами, и |
| REFM-138 | ✅ | proto | `docs/backlog.md:11032` | Право вкладки хаба ходить в сеть стояло ПЯТЬЮ байт-в-байт |
| REFM-139 | ✅ | proto | `docs/backlog.md:11054` | Разбор дипломатического клика стоял ДВАЖДЫ |
| REFM-140 | ✅ | proto | `docs/backlog.md:11078` | Развилка «пустить в матч или послать на вход» стояла тремя |
| REFM-141 | ✅ | proto | `docs/backlog.md:11102` | Связка приказов штурма была выписана дважды |
| REFM-142 | ✅ | proto | `docs/backlog.md:11120` | Адрес дозвона в матч собирался прямо в connect() |
| REFM-143 | ✅ | proto | `docs/backlog.md:11144` | Жизнь сетевого сокета разбиралась прямо в обработчиках |
| REFM-144 | ✅ | proto | `docs/backlog.md:11168` | Приветственный снимок разбирался внутри connect() |
| REFM-145 | ✅ | proto | `docs/backlog.md:11202` | Политика цикла переподключения стояла внутри |
| REFM-146 | ✅ | proto | `docs/backlog.md:11234` | Разбор входящего снимка стоял хвостом внутри onSnapshot |
| REFM-147 | ✅ | proto | `docs/backlog.md:11257` | Маршрут исходящего приказа стоял тремя ветвями внутри |
| REFM-148 | ✅ | proto | `docs/backlog.md:11283` | Разбор ретранслированной строки ленты стоял двумя копиями |
| REFM-149 | ✅ | proto | `docs/backlog.md:11307` | Развилка «куда показать отказ сервера» стояла лесенкой if-ов |
| REFM-150 | ✅ | proto | `docs/backlog.md:11334` | Адреса запросов к серверу матчей собирались строкой в четырёх |
| REFM-151 | ✅ | proto | `docs/backlog.md:11360` | «Что показать вместо списка матчей» стояло тремя вложенными |
| REFM-152 | ✅ | proto | `docs/backlog.md:11394` | Что значит выбор места и во что превращается «Играть» |
| REFM-153 | ✅ | proto | `docs/backlog.md:11416` | Когда переопрашивать список матчей и что писать в строку |
| REFM-154 | ✅ | proto | `docs/backlog.md:11446` | Как клиент узнаёт, чем на этом сервере является позывной |
| REFM-155 | ✅ | proto | `docs/backlog.md:11470` | Что окно выбора места показывает вместо списка домов |
| REFM-156 | ✅ | proto | `docs/backlog.md:11499` | Что клиент кладёт в запрос к /auth и какой ответ считает |
| REFM-157 | ✅ | proto | `docs/backlog.md:11528` | Чем кончается «в архив» / «вернуть» и что игрок при этом |
| REFM-158 | ✅ | proto | `docs/backlog.md:11555` | Режим огня артиллерии |
| REFM-159 | ✅ | proto | `docs/backlog.md:11584` | Жизнь и разметка окна «Разделить» |
| REFM-160 | ✅ | proto | `docs/backlog.md:11606` | выносы по карте REFM-1, один кирпич = одна секция = один |
| REFM-161 | ✅ | proto | `docs/backlog.md:11631` | Просьба выслать ссылку для сброса пароля |
| REFM-162 | ✅ | proto | `docs/backlog.md:11665` | Как из набранного игроком получается адрес сервера |
| REFM-163 | ✅ | proto | `docs/backlog.md:11695` | Что значит выделить флот и как выделение меняется по |
| REFM-164 | ✅ | proto | `docs/backlog.md:11731` | Какие флоты попадают под тап по карте и в каком порядке |
| REFM-165 | ✅ | proto | `docs/backlog.md:11755` | Что значит приказ «слить флоты» |
| REFM-166 | ✅ | proto | `docs/backlog.md:11788` | Что происходит с выделением, когда тап выбрал объект |
| REFM-167 | ✅ | proto | `docs/backlog.md:11807` | Что значит «штурмовать» для каждого флота группы |
| REFM-168 | ✅ | proto | `docs/backlog.md:11828` | Что написано в запросе «объявить войну?» и что на его |
| REFM-169 | ✅ | proto | `docs/backlog.md:11853` | «тревога „враг у ваших рубежей“: когда звенит и что говорит» |
| REFM-170 | ✅ | proto | `docs/backlog.md:11884` | «сколько шума даёт флот и как далеко слышит мир» |
| REFM-171 | ✅ | proto | `docs/backlog.md:11913` | «с каким запасом крыло встаёт на дежурство и что от него |
| REFM-172 | ✅ | proto | `docs/backlog.md:11943` | «когда очередь мира пускает следующий заказ и когда сборный |
| REFM-173 | ✅ | proto | `docs/backlog.md:11976` | «когда меню десанта открывается и чьи числа в него попадают» |
| REFM-174 | ✅ | proto | `docs/backlog.md:12004` | «что игрок узнаёт о дипломатии и куда это попадает» |
| REFM-175 | ✅ | proto | `docs/backlog.md:12032` | «что стройка сообщает игроку» (prototype/src/buildLog.ts + |
| REFM-176 | ✅ | proto | `docs/backlog.md:12060` | «что „Хранитель“ сообщает при постановке, снятии и возврате |
| REFM-177 | ✅ | proto | `docs/backlog.md:12088` | «шпионаж: кому адресовано событие и что оно говорит» |
| REFM-178 | ✅ | proto | `docs/backlog.md:12113` | «куда рисовать вспышку залпа и сколько вспышек держать» |
| REFM-179 | ✅ | proto | `docs/backlog.md:12136` | «что игрок узнаёт о бое» (prototype/src/battleLog.ts + |
| REFM-180 | ✅ | proto | `docs/backlog.md:12160` | «военный счёт и ведомость потерь» (prototype/src/warTally.ts |
| REFM-181 | ✅ | proto | `docs/backlog.md:12196` | «кому есть дело до флотских новостей» |
| REFM-182 | ✅ | proto | `docs/backlog.md:12231` | «кому адресована дипломатия в СОЛО» |
| REFM-183 | ✅ | proto | `docs/backlog.md:12268` | «подача списка первых целей и награда за него» |
| REFM-184 | ✅ | proto | `docs/backlog.md:12296` | «что игрок узнаёт о приобретениях: мир и открытие» |
| REFM-185 | ✅ | proto | `docs/backlog.md:12332` | «какие команды появляются в ряду, а какие просто гаснут» |
| REFM-186 | ✅ | proto | `docs/backlog.md:12368` | «какая кнопка ряда горит и почему» |
| REFM-187 | ✅ | proto | `docs/backlog.md:12398` | «кого можно взять целью взведённого приказа» |
| REFM-188 | ✅ | proto | `docs/backlog.md:12432` | «когда лист перестраивается и что при этом нельзя потерять» |
| REFM-189 | ✅ | proto | `docs/backlog.md:12460` | «кого зовут значки внимания и куда ложится цифра» |
| REFM-190 | ✅ | proto | `docs/backlog.md:12489` | «как число на фишке ресурса говорит правду» |
| REFM-191 | ✅ | proto | `docs/backlog.md:12520` | «живое положение игрока в верхней строке» |
| REFM-192 | ✅ | proto | `docs/backlog.md:12556` | «служебное наложение: FPS, задержка и десинк» |
| REFM-193 | ✅ | proto | `docs/backlog.md:12592` | «чем кадр даёт выйти из матча и начать заново» |
| REFM-194 | ✅ | proto | `docs/backlog.md:12624` | «как часто живёт открытое окно и почему сроки разные» |
| REFM-195 | ✅ | proto | `docs/backlog.md:12661` | «что гаснет от СОСЕДНЕЙ команды ряда» |
| REFM-196 | ✅ | proto | `docs/backlog.md:12698` | «превью взведённого „Хода“: куда идёт линия и что она обещает» |
| REFM-197 | ✅ | proto | `docs/backlog.md:12738` | «что карточка флота признаёт о его состоянии» |
| REFM-198 | ✅ | proto | `docs/backlog.md:12774` | «что ЗНАЧИТ нажатие „Назад“» |
| REFM-199 | ✅ | proto | `docs/backlog.md:12817` | «что означает ЕДУЩИЙ палец» |
| REFM-200 | ✅ | proto | `docs/backlog.md:12868` | «что карточка пришвартованного флота ПРЕДЛАГАЕТ сделать» |
| REFM-201 | ✅ | proto | `docs/backlog.md:12912` | «чей сейчас ход в переговорах» |
| REFM-202 | ✅ | proto | `docs/backlog.md:12957` | «как подписано место в списке» + починка того, что подпись |
| MIG-1 | ✅ | cli proto | `docs/backlog.md:13045` | Вход в сетевой матч переехал в /decisions. |
| MIG-2 | ✅ | cli srv | `docs/backlog.md:13061` | Клиент ПОТРЕБЛЯЕТ переехавшее: вход, обзор, место, отказы. |
| MIG-3 | ✅ | cli | `docs/backlog.md:13099` | HUD-модели наконец РИСУЮТСЯ, и интентов стало три. |
| MIG-4 | ✅ | cli proto | `docs/backlog.md:13139` | Цепочка «приказ выделенному флоту» переехала в /decisions. |
| MIG-5 | ✅ | cli proto | `docs/backlog.md:13163` | ВСЕ строители приказов переехали в /decisions — и клиент бросил свои копии. |
| MIG-6 | ✅ | cli proto | `docs/backlog.md:13194` | Словарь ЖЕСТОВ переехал в /decisions — третья, последняя недостающая половина. |
| MIG-7 | ✅ | cli | `docs/backlog.md:13233` | КНОПКИ: панель состава наконец отдаёт приказы, интентов стало семь. |
| MIG-8 | ✅ | cli core | `docs/backlog.md:13273` | ПАНЕЛЬ МИРА: тап по миру перестал уходить в пустоту, интентов девять. |
| MIG-9 | ✅ | cli | `docs/backlog.md:13304` | ДЕЛЕНИЕ и СЛИЯНИЕ флотов: интентов одиннадцать. |
| MIG-10 | ✅ | cli proto | `docs/backlog.md:13333` | Ворота стройки: зеркало заменено решением. |
| AUD-1 | ✅ | cli | `docs/backlog.md:13377` | клиент собирал 11 фрагментов из 18. |
| AUD-2 | ✅ | srv core | `docs/backlog.md:13397` | фог-роутинг событий не покрыт тестом. |
| AUD-11 | ✅ | core | `docs/backlog.md:13426` | effect.applied всегда называет адресата. |
| AUD-15 | ✅ | srv | `docs/backlog.md:13458` | сканер фог-контракта больше не слеп к комментариям. |
| AUD-3 | ✅ | data | `docs/backlog.md:13481` | 28 непереводимых имён игровых данных вычищены. |
| AUD-4 | ✅ | proto | `docs/backlog.md:13512` | гейт локализации увидел шипнутый контент. |
| AUD-14 | ✅ | proto | `docs/backlog.md:13544` | имена домов доезжают до игрока переводом. |
| AUD-12 | ✅ | proto | `docs/backlog.md:13566` | шапка досье героя больше не показывает игроку сам ключ. |
| AUD-13 | ✅ | core proto | `docs/backlog.md:13582` | hero.name — отображаемый текст, вшитый в |
| AUD-5 | ✅ | core | `docs/backlog.md:13626` | экспортирован runUntil(kernel, state, ctx, opts?). |
| AUD-6 | ✅ | core | `docs/backlog.md:13641` | actionPayloadSchemas и CLIENTACTIONTYPES публичны. |
| AUD-7 | ✅ | proto | `docs/backlog.md:13649` | SELFPLAYJSON отдаёт всё, что печатает человеку. |
| AUD-8 | 🗑 | proto | `docs/backlog.md:13657` | сведён в CONV-12 |
| AUD-9 | ✅ | sec | `docs/backlog.md:13665` | merge-queue выбрасывал PR с CIFAILURE при зелёном коде. |
| AUD-10 | ✅ | sec | `docs/backlog.md:13693` | зелёный PR не вставал в очередь: у автомержа один шанс, и он |
| FSPLIT-1 | ✅ | core act proto | `docs/backlog.md:13836` | Отбор при делении адресует СТЕК, а не тип корабля. |
| FSPLIT-2 | ✅ | core act proto | `docs/backlog.md:13846` | Десант делится вместе с кораблями, по трюму обеих половин. |
| AIDIFF-1 | ✅ | proto | `docs/backlog.md:13874` | Строка места переключается «выкл → слабый → сильный». |
| RESIL-1 | ✅ | proto | `docs/backlog.md:14028` | Фоновые промисы браузерного клиента. |
| RESIL-2 | ✅ | proto | `docs/backlog.md:14055` | Цикл подсветки обучающего тура. |
| RESIL-3 | ✅ | srv | `docs/backlog.md:14072` | Именованный фатал процесса. |
| RESIL-4 | ✅ | srv | `docs/backlog.md:14092` | Соак проверяет, что мир не встал. |
| RESIL-5 | ✅ | srv proto | `docs/backlog.md:14110` | Генеральная репетиция: весь стек разом, и |
| RESIL-6 | ✅ | srv proto | `docs/backlog.md:14145` | Достоверность генералки: настоящая база, |
| ADDR-7 | ✅ | sec proto | `docs/backlog.md:14287` | Ссылка на партию не пускает по незнанию: |
| OPS-2 | ✅ | ops sec | `docs/backlog.md:14325` | Обновление доносит до машины новые ключи |
| REL-6 | ✅ | srv | `docs/backlog.md:14347` | Возврат на своё место мгновенный: перехват вместо |
| CMB-4 | ✅ | core | `docs/backlog.md:14362` | Первый раунд боя — на самой встрече, а не через |
| BLD-1 | ✅ | core proto | `docs/backlog.md:14382` | Очередь строительства: заказы встают в |
| UI-14 | ✅ | proto | `docs/backlog.md:14422` | Осмотр чужого флота должен быть находимым. |
| CMB-5 | ✅ | core | `docs/backlog.md:14448` | Вражда началась — стоящие рядом флоты сходятся |
| ATK-1 | ✅ | proto | `docs/backlog.md:14464` | Кнопка «Атака» и честный гейт кнопки ШТУРМ. |
| SHIPART-1 | ✅ | proto cli | `docs/backlog.md:14490` | Реалистичные портреты в постройке и описаниях, |
| HEROART-1 | ✅ | proto cli | `docs/backlog.md:14502` | Портреты, досье и читаемый счёт флота |
| YARD-1 | ✅ | data proto srv | `docs/backlog.md:14612` | Корабли строит ВЕРФЬ, челноки — |
| YARD-2 | ✅ | data | `docs/backlog.md:14646` | У верфи два яруса: дешёвый строит, дорогой |
| CMB-7 | ✅ | core | `docs/backlog.md:14670` | Перемирие посреди боя не останавливало бой. |
| RLY-1 | ✅ | proto | `docs/backlog.md:14691` | Сбор построенного: соло и сеть играли по РАЗНЫМ |
| CARGO-1 | ✅ | core proto | `docs/backlog.md:14723` | Часовая погрузка десанта жила в |
| MRG-1 | ✅ | core proto | `docs/backlog.md:14771` | «Слиться по прибытии» — вторая половина |
| ART-0 | ✅ | core data proto | `docs/backlog.md:14794` | Артиллерия снята из игры целиком |
| ORB-1 | ✅ | core data proto | `docs/backlog.md:14825` | Орбитальный слой объявлен в |
| ORB-4 | ✅ | core data proto | `docs/backlog.md:14861` | в астероидном поле строилось всё, что угодно: |
| ORB-2 | ✅ | data proto | `docs/backlog.md:14902` | «Изучается технология, строится здание» не |
| ORB-3 | ✅ | proto | `docs/backlog.md:14930` | Звёздный форт выдавал орбитальное ПКО мимо |
| CMB-6 | ✅ | core | `docs/backlog.md:14967` | После ничьей третий враждебный флот получает свой |
| ORD-2 | ✅ | proto | `docs/backlog.md:14997` | Нацеленный ШТУРМ теперь переживает закрытую |
| FOG-10 | ✅ | proto core | `docs/backlog.md:15017` | Память разведки перестала жить только |
| FOG-9 | ✅ | core | `docs/backlog.md:15041` | Приостановленная стройка чужого мира была видна |
| TEST-4 | ✅ | srv | `docs/backlog.md:15051` | topXp падал на живой базе разработчика. |
| PHONE-STRATEGY | ✅ |  | `docs/backlog.md:15276` | Технологии, постройки, производство, рынок и дипломатия |
| MAP-PERF | ✅ |  | `docs/backlog.md:15288` | Ускорение движения раскрытой голографической карты и подготовка |
| PERK-0.1 | ✅ | docs | `docs/backlog.md:15314` | Резолюция владельца: два класса бонусов + третья группа |
| PERK-1.1 | ✅ | core | `docs/backlog.md:15333` | Три группы вместо одной цепочки. |
| PERK-1.2 | ⏳ | data proto | `docs/backlog.md:15367` | Перевести массовые перки в параллельную |
| PERK-2.1 | ✅ | core | `docs/backlog.md:15377` | Снижение урона: один пул, одна форма, один кап. |
| PERK-3.1 | ⏳ | core data | `docs/backlog.md:15420` | Кто и за что выдаёт последовательные множители. |
| PERK-3.2 | 🔒 | core | `docs/backlog.md:15440` | (PERK-3.1) Случайный промоушен: параллельный бонус становится |
| OBJP-1 | ✅ | proto | `docs/backlog.md:15455` | Значок боя наконец открывает окно, а окно даёт |
| OBJP-2 | ✅ | proto | `docs/backlog.md:15481` | Подробности объекта встают РЯДОМ с карточкой, а не |
| OBJP-3 | ✅ | proto | `docs/backlog.md:15493` | Каталог юнитов уехал в окно производства — туда же, |
| CMD-VIS-2 | ✅ | proto | `docs/backlog.md:15511` | Кнопка штурма появляется только когда есть кем |
| EVT-1 | ✅ | core data proto | `docs/backlog.md:15541` | Тёмные события наконец видны игроку, |
| EVT-2 | ⏳ | core data | `docs/backlog.md:15591` | Трофеи за бой: доля от стоимости уничтоженного. |
| EVT-3 | 🔒 | core data | `docs/backlog.md:15615` | (EVT-2) Пассивка героя: «мародёр» — лестница из пяти |
| RETR-1 | ⏳ | core | `docs/backlog.md:15659` | Отступление получает ТОЧКУ: fleet.retreat умеет уводить, а не |
| RETR-2 | 🔒 | core srv proto | `docs/backlog.md:15672` | (RETR-1) Авто-отступление: условие выхода из боя |
| TXT-0.1 | ✅ | docs | `docs/backlog.md:15770` | Канон формулировок: записать правило и эталон, пока чистка не |
| TXT-1 | ⏳ | proto | `docs/backlog.md:15807` | Досье зданий: 14 ключей, 2505 симв., проза вместо |
| TXT-2 | ⏳ | proto | `docs/backlog.md:15820` | Досье юнитов: 10 ключей, 3046 симв. — самый раздутый домен |
| TXT-3 | ⏳ | proto | `docs/backlog.md:15831` | Тавтологии и дубли в досье — чистая вырезка, самый дешёвый |
| TXT-4 | ⏳ | proto | `docs/backlog.md:15846` | Герои: описание способности не называет величину — 10 из |
| TXT-5 | ⏳ | proto | `docs/backlog.md:15863` | Онбординг: 36 ключей, 5019 симв. — учит законно, но |
| TXT-6 | ⏳ | proto | `docs/backlog.md:15877` | Кодекс: 7 статей, средн. 187 симв. — тренерский хвост в |
| TXT-7 | 🔒 | proto docs | `docs/backlog.md:15886` | Сторож в гейте: чтобы вода не вернулась. |
| AC-0.1 | ✅ | srv data | `docs/accounts-roadmap.md:44` | Сущность Account + связь с Player |
| AC-0.2 | ⏳ | srv | `docs/accounts-roadmap.md:53` | Сессии и refresh |
| AC-0.3 | 🔒 | srv data | `docs/accounts-roadmap.md:58` | Уровень/опыт аккаунта |
| AC-1.1 | ⏳ | srv sec | `docs/accounts-roadmap.md:67` | OAuth/OIDC-вход |
| AC-1.2 | ⏳ | srv sec | `docs/accounts-roadmap.md:72` | Email magic-link (без пароля) |
| AC-1.3 | 🔒 | srv sec | `docs/accounts-roadmap.md:77` | JWT для WS-рукопожатия |
| AC-2.1 | 🔒 | srv | `docs/accounts-roadmap.md:86` | Привязка нескольких identity к аккаунту |
| AC-2.2 | 🔒 | srv sec | `docs/accounts-roadmap.md:90` | Восстановление доступа и защита от захвата |
| AC-2.3 | ⏳ | srv docs | `docs/accounts-roadmap.md:94` | Приватность аккаунта (GDPR-база) |
| ARS-0 | ✅ | docs | `docs/arsenal-roadmap.md:52` | Развилки за владельцем — решено (2026-07-14) |
| ARS-1 | ✅ | data core | `docs/arsenal-roadmap.md:88` | Схема предмета/чертежа — реализовано |
| ARS-2 | ✅ | srv | `docs/arsenal-roadmap.md:127` | ArsenalStore + стартовый набор — реализовано |
| ARS-3 | ✅ | srv | `docs/arsenal-roadmap.md:166` | Снапшот в матч — реализовано |
| ARS-4 | ✅ | srv | `docs/arsenal-roadmap.md:209` | Источники: дроп по месту + сальваж — реализовано |
| ARS-5 | ✅ | proto srv | `docs/arsenal-roadmap.md:280` | UI: витрина + фильтр Верфи — реализовано |
| ARS-6 | ✅ | srv | `docs/arsenal-roadmap.md:327` | Корп-склад + аренда — реализовано |
| AVA-1 | ✅ | srv core | `docs/ava-lifecycle-roadmap.md:43` | Командная дипломатия на серверном пути [srv/core] — реализовано |
| AVA-2 | ✅ | srv | `docs/ava-lifecycle-roadmap.md:86` | Очки влияния корпорации |
| AVA-3 | ✅ | srv | `docs/ava-lifecycle-roadmap.md:118` | Флаги готовности к AvA |
| AVA-4 | ✅ | srv | `docs/ava-lifecycle-roadmap.md:149` | Вызов / принятие (S0→S2) |
| AVA-5 | ✅ | core data | `docs/ava-lifecycle-roadmap.md:188` | Пул AvA-карт + eligibility [core/data] — реализовано |
| AVA-6 | ✅ | srv | `docs/ava-lifecycle-roadmap.md:224` | Сбор ростера + лок (S3) — реализовано |
| AVA-7 | ✅ | srv | `docs/ava-lifecycle-roadmap.md:273` | Оркестратор: создание сессии (S4) ★ — реализовано |
| AVA-8 | ✅ | srv | `docs/ava-lifecycle-roadmap.md:347` | Мир → война → итог (S5–S7) ★ — реализовано |
| AVA-9 | ✅ | srv | `docs/ava-lifecycle-roadmap.md:426` | Публичная лента корпораций — реализовано |
| CC-0.1 | ✅ | core data | `docs/command-chains-roadmap.md:59` | Схема цепочки + каталог блоков (частично, прототип) |
| CC-0.2 | ✅ | docs core | `docs/command-chains-roadmap.md:67` | РЕШЕНИЕ: где исполняется |
| CC-1.1 | ✅ | core | `docs/command-chains-roadmap.md:79` | Завершение шага → следующий шаг (прототип) |
| CC-2.1 | ⏳ | core data | `docs/command-chains-roadmap.md:89` | Курируемые триггеры (сделаны: on-arrival, at-time, 🔁) |
| CC-3.1 | ⏳ | core data | `docs/command-chains-roadmap.md:99` | Ограниченные предикаты + повтор (повтор + стоячие приказы ) |
| CC-4.1 | ⏳ | srv cli | `docs/command-chains-roadmap.md:118` | Итог/инцидент цепочки → лента + push (минимум ) |
| CC-5.1 | ✅ | core srv | `docs/command-chains-roadmap.md:127` | Лимиты + конфликт-резолюция (базово) |
| CC-6 | ✅ | core srv cli | `docs/command-chains-roadmap.md:135` | Лимит по ПРИКАЗАМ игрока + подписка |
| CC-5.2 | ⏳ |  | `docs/command-chains-roadmap.md:148` | Конструктор цепочек (клиент) (список-версия ) |
| CR-0.1 | ⏳ | core data | `docs/core-roadmap.md:30` | Версия данных/правил per-match + миграции |
| CR-0.2 | ✅ | core | `docs/core-roadmap.md:36` | Детерминированный реплей-тулинг 🚧 (ядро 2026-07-21) |
| CR-1.1 | ✅ | core data | `docs/core-roadmap.md:61` | Расширить FactionDef + данные |
| CR-1.2 | ✅ | core | `docs/core-roadmap.md:66` | factionModule: пассивы через хуки |
| CR-1.3 | ✅ | core | `docs/core-roadmap.md:71` | Сборка старта матча по фракции |
| CR-2.1 | ✅ | core | `docs/core-roadmap.md:87` | Память «последнего увиденного» |
| CR-2.2 | ⏳ | core data | `docs/core-roadmap.md:92` | Сенсорная/радарная дальность от зданий (частично) |
| CR-2.3 | ✅ | core | `docs/core-roadmap.md:98` | Разведка флотом + хелпер видимости |
| CR-3.1 | ✅ | core data | `docs/core-roadmap.md:111` | Предматчевый выбор технологий + бусты |
| CR-3.2 | ✅ | core | `docs/core-roadmap.md:116` | Состояние дипломатии |
| CR-3.3 | ✅ | core | `docs/core-roadmap.md:121` | diplomacyModule |
| CR-4.1 | ⏳ | core data | `docs/core-roadmap.md:131` | Движок трейтов (универсальный триггер→эффект) |
| CP0.1 | ✅ | cli | `docs/cross-platform-roadmap.md:80` | Каркас веб-клиента |
| CP0.2 | ⏳ | cli proto | `docs/cross-platform-roadmap.md:92` | Вынести рендер-слой из прототипа |
| CP0.3 | ✅ | cli core | `docs/cross-platform-roadmap.md:102` | Общий загрузчик данных |
| CP1.1 | ✅ | cli | `docs/cross-platform-roadmap.md:116` | Реальный WS-транспорт |
| CP1.2 | ✅ | cli proto | `docs/cross-platform-roadmap.md:126` | Снять локальную авторитетность |
| CP1.3 | 🔶 | cli | `docs/cross-platform-roadmap.md:142` | Интенты из UI |
| CP1.4 | ✅ | cli | `docs/cross-platform-roadmap.md:170` | Реконнект и резюме |
| CP2.1 | ✅ | cli | `docs/cross-platform-roadmap.md:206` | Web App Manifest |
| CP2.2 | ✅ | cli | `docs/cross-platform-roadmap.md:213` | Service Worker + app-shell |
| CP2.3 | ✅ | cli | `docs/cross-platform-roadmap.md:261` | Кэш снапшота (IndexedDB) |
| CP2.4 | ⏳ | cli | `docs/cross-platform-roadmap.md:317` | Install UX и Lighthouse-бюджет |
| CP2.5 | 🔒 | cli srv | `docs/cross-platform-roadmap.md:324` | Авто-обновление + force-update handshake |
| CP3.1 | 🔒 | cli | `docs/cross-platform-roadmap.md:340` | Предпросмотр-прогон |
| CP3.2 | 🔒 | cli | `docs/cross-platform-roadmap.md:347` | Сверка предпросмотр ↔ сервер |
| CP3.3 | 🔒 | cli | `docs/cross-platform-roadmap.md:354` | «Что будет, если…» |
| CP4.1 | 🔒 | cli | `docs/cross-platform-roadmap.md:368` | Интеграция Pixi v8 (слой карты) |
| CP4.2 | 🔒 | cli | `docs/cross-platform-roadmap.md:375` | Камера, culling, DPI |
| CP4.3 | 🔒 | cli | `docs/cross-platform-roadmap.md:382` | Off-thread рендер/симуляция (опц.) |
| CP4.4 | 🔒 | cli | `docs/cross-platform-roadmap.md:389` | Перф-бюджет в CI |
| CP5.1 | 🔒 | cli | `docs/cross-platform-roadmap.md:400` | Pointer vs touch |
| CP5.2 | 🔒 | cli | `docs/cross-platform-roadmap.md:407` | Жесты и хаптика |
| CP5.3 | 🔒 | cli | `docs/cross-platform-roadmap.md:414` | Адаптивные раскладки |
| CP6.1 | 🔒 | cli sec | `docs/cross-platform-roadmap.md:425` | Android TWA |
| CP6.2 | 🔒 | cli | `docs/cross-platform-roadmap.md:432` | iOS (и альт-Android) через Capacitor |
| CP6.3 | 🔒 | sec | `docs/cross-platform-roadmap.md:444` | CI-артефакты сборок |
| CP7.1 | ⏳ | cli | `docs/cross-platform-roadmap.md:458` | Web Push (браузеры / Android PWA) |
| CP7.2 | 🔒 | cli | `docs/cross-platform-roadmap.md:462` | iOS native push через Capacitor |
| CP7.3 | ⏳ |  | `docs/cross-platform-roadmap.md:466` | Серверные триггеры пушей [→F3] |
| EC-0.1 | ✅ | docs | `docs/economy-roadmap.md:88` | Жанровое решение — решено (см. «Зафиксированные решения» выше) |
| EC-0.2 | ✅ | docs | `docs/economy-roadmap.md:97` | Денежная модель на бумаге — решено (2026-07-19) |
| EC-0.3 | ✅ | docs sec | `docs/economy-roadmap.md:134` | RMT/фрод threat-model — решено (2026-07-19) |
| EC-0.4 | ⏳ | docs sec | `docs/economy-roadmap.md:160` | Юридический/сторовый ревью |
| EC-0.5 | ✅ | docs | `docs/economy-roadmap.md:243` | Зависимость от платформенного стека — решено (см. «Жёсткий гейт» выше) |
| EC-1.1 | ⏳ | data core | `docs/economy-roadmap.md:255` | Data-driven модель предметов/модулей/чертежей |
| EC-1.2 | ⏳ | srv | `docs/economy-roadmap.md:259` | Две валюты: серверный кошелёк |
| EC-1.3 | 🔒 | srv | `docs/economy-roadmap.md:264` | Персистентный инвентарь финансового качества |
| EC-2.1 | 🔒 | srv core | `docs/economy-roadmap.md:272` | Заточка: гарант низа + серверный RNG выше |
| EC-2.2 | 🔒 | srv data | `docs/economy-roadmap.md:277` | Осколки → сборка soulbound-модуля |
| EC-2.3 | 🔒 | srv cli | `docs/economy-roadmap.md:281` | Раскрытие шансов |
| EC-3.1 | 🔒 | srv sec | `docs/economy-roadmap.md:318` | Леджер аукциона |
| EC-3.2 | 🔒 | srv | `docs/economy-roadmap.md:322` | Листинг/покупка за рыночную валюту + комиссия-бёрн |
| EC-3.3 | ⏳ | srv sec | `docs/economy-roadmap.md:326` | Анти-абьюз рынка |
| EC-4.1 | 🔒 | srv sec | `docs/economy-roadmap.md:335` | Платежи/биллинг сторов |
| EC-4.2 | 🔒 | srv | `docs/economy-roadmap.md:339` | Бонусные варранты с покупки — осознанно |
| EC-4.3 | 🔒 | srv cli | `docs/economy-roadmap.md:343` | Подписка + косметика + донат-предметы (soulbound) |
| EC-5.1 | 🔒 | srv | `docs/economy-roadmap.md:351` | Экономическая телеметрия |
| EC-5.2 | 🔒 | data | `docs/economy-roadmap.md:355` | Балансные рычаги через данные (live-ops) |
| EC-6.1 | 🔒 | srv sec | `docs/economy-roadmap.md:368` | Детекция RMT-паттернов |
| EC-6.2 | 🔒 | srv docs | `docs/economy-roadmap.md:372` | Модерация торговли и споры |
| FORT-0.1 | 🗑 | data | `docs/fortress-roadmap.md:406` | Узлы empty в картах канона — снято 2026-09-15 |
| FORT-0.2 | ✅ | core proto | `docs/fortress-roadmap.md:421` | Крепость в прототипе: модуль, правило, кнопка |
| FORT-1.1 | 🗑 |  | `docs/fortress-roadmap.md:456` | Технический юнит + технология — снято 2026-09-15 |
| FORT-1.2 | 🗑 |  | `docs/fortress-roadmap.md:471` | Конверсия расходует техюнит — снято 2026-09-15 |
| FORT-1.3 | 🗑 |  | `docs/fortress-roadmap.md:485` | Вкладка технических юнитов в «Верфи» — снято 2026-09-15 |
| FORT-1.4 | ✅ | proto | `docs/fortress-roadmap.md:497` | Недостающие ключи отказов |
| FORT-2.1 | ✅ | data | `docs/fortress-roadmap.md:519` | Юнит «Гарнизон» |
| FORT-2.2 | ✅ | core data | `docs/fortress-roadmap.md:537` | Форт выдаёт и забирает гарнизон |
| FORT-2.3 | ✅ | data core | `docs/fortress-roadmap.md:556` | Потолок гарнизона и фракционный модификатор |
| FORT-3.1 | ✅ | data | `docs/fortress-roadmap.md:575` | Уровни зенитных батарей |
| FORT-3.2 | ✅ |  | `docs/fortress-roadmap.md:588` | Выполнен ЧУЖОЙ работой; остаток снят как противоречащий более позднему решению |
| FORT-4.1 | ✅ | core data | `docs/fortress-roadmap.md:615` | Какие ещё узлы конвертируются |
| FORT-5.1 | ✅ | data core | `docs/fortress-roadmap.md:639` | Технологию крепости надо ИЗУЧИТЬ |
| FORT-5.2 | ✅ | data core | `docs/fortress-roadmap.md:669` | Ядро крепости: starfort дорос до пяти уровней |
| FORT-5.3 | ✅ | core data | `docs/fortress-roadmap.md:715` | Слоты построек |
| FORT-5.4 | ✅ | core data | `docs/fortress-roadmap.md:742` | Крепость ВСТУПАЕТ В БОЙ |
| FORT-5.12 | ✅ | core data | `docs/fortress-roadmap.md:794` | Крепость под ударом: не обстреливают, и бой глушит работу |
| FORT-5.5 | ✅ | data core | `docs/fortress-roadmap.md:828` | Класс корпуса у кораблей |
| FORT-5.6 | ✅ | data | `docs/fortress-roadmap.md:864` | Верфь крепости: три уровня |
| FORT-5.7 | ✅ | data core | `docs/fortress-roadmap.md:874` | Ангар крепости |
| FORT-5.8 | ✅ | core | `docs/fortress-roadmap.md:895` | Док чинит СОЮЗНИКУ |
| FORT-5.9 | ✅ | core data | `docs/fortress-roadmap.md:919` | Госпиталь лечит ТРЮМ |
| FORT-5.10 | ✅ | core data | `docs/fortress-roadmap.md:938` | Щиты крепости |
| FORT-5.11 | ✅ | data | `docs/fortress-roadmap.md:980` | Технологии открывают постройки крепости |
| FORT-5.13 | ✅ | core | `docs/fortress-roadmap.md:1016` | Сбитая крепость уничтожается |
| GI-0.1 | ✅ | srv sec | `docs/game-integrity-roadmap.md:41` | Rate-limiting действий |
| GI-0.2 | ⏳ | srv | `docs/game-integrity-roadmap.md:49` | Per-player очередь (анти-double-spend) |
| GI-0.3 | ✅ | srv | `docs/game-integrity-roadmap.md:53` | Туман как граница (анти-maphack) (в основном) |
| GI-1.1 | 🔒 | srv sec | `docs/game-integrity-roadmap.md:66` | Сигналы и метрики честности |
| GI-1.2 | 🔒 | sec | `docs/game-integrity-roadmap.md:71` | Алерты на аномалии |
| GI-1.3 | 🔒 | srv | `docs/game-integrity-roadmap.md:75` | Аудит-реплей подозрительного матча |
| GI-2.1 | ⏳ | srv sec | `docs/game-integrity-roadmap.md:84` | Анти-мультиаккаунт / связи |
| GI-2.2 | 🔒 | srv | `docs/game-integrity-roadmap.md:89` | Поведенческая bot-detection |
| GI-2.3 | 🔒 | srv core | `docs/game-integrity-roadmap.md:94` | Защита экономики/обменов |
| GI-3.1 | 🔒 | srv docs | `docs/game-integrity-roadmap.md:103` | Санкции и апелляции |
| GM-0.1 | ✅ | core data | `docs/game-modes-roadmap.md:51` | config.mode + реестр режимов |
| GM-0.2 | ⏳ | core | `docs/game-modes-roadmap.md:76` | Мульти-исход и приоритет |
| GM-0.3 | ⏳ | srv | `docs/game-modes-roadmap.md:85` | Выбор режима в лобби [client] |
| GM-1.1 | ✅ | data | `docs/game-modes-roadmap.md:104` | Пресет standard (score/domination/timeout) |
| GM-1.2 | ✅ | core | `docs/game-modes-roadmap.md:113` | Коалиционный порог очков (SES-1: реализовано и покрыто тестами) |
| GM-2.1 | ⏳ | core data | `docs/game-modes-roadmap.md:127` | Сущность столицы |
| GM-2.2 | 🔒 | core | `docs/game-modes-roadmap.md:135` | capitalModule: поражение по потере штаба |
| GM-2.3 | 🔒 |  | `docs/game-modes-roadmap.md:146` | UX столицы [client] |
| GM-3.1 | ⏳ | core data | `docs/game-modes-roadmap.md:155` | Контрольные точки в данных |
| GM-3.2 | 🔒 | core | `docs/game-modes-roadmap.md:163` | holdPointsModule: таймеры удержания |
| GM-3.3 | 🔒 |  | `docs/game-modes-roadmap.md:174` | UX точек и прогресса [client] |
| GM-4.5 | 🔶 | core | `docs/game-modes-roadmap.md:208` | Командные варианты (2v2v2 / фракционные блоки) |
| GM-4.6 | ✅ |  | `docs/game-modes-roadmap.md:225` | Кооп против ИИ (PvE «волны») [core+data] |
| GM-4.7 | 🔒 | srv | `docs/game-modes-roadmap.md:247` | Связка с метой (AvA как режим) — Контур 2 |
| HC-0.1 | ✅ | docs | `docs/hero-collection-roadmap.md:168` | Откуда берутся слоты: архетип или редкость 2026-09-07 |
| HC-1.1 | 🗑 | core | `docs/hero-collection-roadmap.md:181` | Ядро применяет слоты по редкости — перенесено в HPR-1.1/HPR-1.2 |
| HC-1.2 | ⏳ | core data | `docs/hero-collection-roadmap.md:190` | Герой как пустая болванка |
| HC-1.3 | 🔒 | data core | `docs/hero-collection-roadmap.md:198` | Предрасположенность |
| HC-1.4 | ⏳ | core data | `docs/hero-collection-roadmap.md:205` | Губернатор и наземный герой |
| HC-2.1 | 🔒 | srv data | `docs/hero-collection-roadmap.md:218` | Способности как предметы инвентаря |
| HC-2.2 | 🔒 | srv | `docs/hero-collection-roadmap.md:226` | Герой как собственность аккаунта |
| HC-2.3 | 🔒 | srv data | `docs/hero-collection-roadmap.md:233` | Детальки → повышение редкости |
| HC-2.4 | 🔒 | srv | `docs/hero-collection-roadmap.md:241` | Герои и детальки на аукционе |
| HC-3.1 | ✅ | data | `docs/hero-collection-roadmap.md:259` | Пассив «скорость флота в радиусе» 2026-09-07 |
| HC-3.2 | ✅ | core data | `docs/hero-collection-roadmap.md:276` | Варп-прыжок: hero.effect.jump 2026-09-07 |
| HC-3.3 | ✅ | core data | `docs/hero-collection-roadmap.md:293` | Фантомный радарный сигнал 2026-09-07 |
| HC-3.4 | ⏳ | core data | `docs/hero-collection-roadmap.md:315` | «Опытный командир»: юниты союзника под управление |
| HPR-0.1 | ✅ | docs | `docs/hero-progression-roadmap.md:554` | Кому принадлежат звёзды: только главному или всем 2026-09-07 |
| HPR-0.2 | ✅ | docs | `docs/hero-progression-roadmap.md:563` | Ресурс прогрессии: что это, откуда берётся, куда уходит |
| HPR-0.3 | ⏳ | docs data | `docs/hero-progression-roadmap.md:595` | Лестница редкости скилла и её ЦВЕТА |
| HPR-0.4 | 🔒 | docs sec | `docs/hero-progression-roadmap.md:610` | Заточка скиллов включена в лутбокс-ревью |
| HPR-1.1 | ⏳ | core data | `docs/hero-progression-roadmap.md:629` | Четвёртая редкость, main вон из лестницы, слоты ОТ РЕДКОСТИ |
| HPR-1.2 | ✅ | core | `docs/hero-progression-roadmap.md:648` | Ядро применяет бюджет слотов скиллов 2026-09-07 |
| HPR-1.3 | 🔒 | core data | `docs/hero-progression-roadmap.md:670` | Звёзды: поле и слот |
| HPR-1.4 | 🔒 | proto | `docs/hero-progression-roadmap.md:700` | Витрина редкости и звёзд в штабе героев |
| HPR-1.5.1 | ✅ | data | `docs/hero-progression-roadmap.md:716` | Корабль героя берёт обычные модули 2026-09-08 |
| HPR-1.5.2 | ✅ | core | `docs/hero-progression-roadmap.md:731` | Лоадаут корабля живёт на герое 2026-09-08 |
| HPR-1.5.3 | ✅ | data | `docs/hero-progression-roadmap.md:762` | Два «скилла в обёртке» переезжают в скиллы 2026-09-08 |
| HPR-1.5.4 | ✅ | core proto | `docs/hero-progression-roadmap.md:776` | Снос hero.fit и вкладки фиттингов 2026-09-08 |
| HPR-1.6.1 | ⏳ | core data | `docs/hero-progression-roadmap.md:806` | Гейты переоснащения для скиллов И модулей |
| HPR-1.6.2 | 🔒 | proto | `docs/hero-progression-roadmap.md:843` | Экран переоснащения говорит, ГДЕ и ПОЧЁМ |
| HPR-2.1 | 🔒 | data core | `docs/hero-progression-roadmap.md:858` | Редкость у СКИЛЛА — поле и лестница |
| HPR-2.2 | 🔒 | srv data | `docs/hero-progression-roadmap.md:867` | heroskill как вид предмета арсенала |
| HPR-2.3 | 🔒 | srv | `docs/hero-progression-roadmap.md:874` | Дубликаты: инвентарь умеет считать количество |
| HPR-2.4 | 🔒 | data srv | `docs/hero-progression-roadmap.md:882` | Скиллы и дубликаты в пуле дропа |
| HPR-3.1 | 🔒 | data core | `docs/hero-progression-roadmap.md:896` | Уровень скилла: данные и кривая |
| HPR-3.2 | 🔒 | srv | `docs/hero-progression-roadmap.md:909` | Заточка скилла на движке EC-2.1 |
| HPR-3.3 | 🔒 | core srv | `docs/hero-progression-roadmap.md:921` | Уровень доезжает в матч через снапшот |
| HPR-3.4 | 🔒 | srv cli | `docs/hero-progression-roadmap.md:933` | Сток, раскрытие шансов и честный UI |
| HPR-4.1 | ⏳ | srv data | `docs/hero-progression-roadmap.md:943` | Ресурсы прогрессии: кран и сток |
| HPR-4.2 | 🔒 | srv cli | `docs/hero-progression-roadmap.md:959` | Ритуал повышения звезды |
| HTTPS-0.1 | ⏳ | docs | `docs/https-roadmap.md:52` | Зафиксировать «TLS терминирует прокси» как стандарт — S → SE-1.2 |
| HTTPS-1.1 | ✅ | srv sec | `docs/https-roadmap.md:63` | Доверие прокси: X-Forwarded-Proto/Host + Origin — M → SE-6.1, SE-1.2 |
| HTTPS-1.2 | ⏳ | srv | `docs/https-roadmap.md:90` | (Опц.) In-process TLS как запасной путь — S → SE-1.2 |
| HTTPS-2.1 | ✅ | ops sec | `docs/https-roadmap.md:102` | Caddy/Nginx-пример с ACME перед сервером (код; домен — deploy-time вход) — M → SE-1.2 |
| HTTPS-2.2 | ✅ | ops sec | `docs/https-roadmap.md:117` | Жизненный цикл сертификата (авто-продление + staging via Caddy) / (мониторинг истечения) — S → SE-1… |
| HTTPS-3.1 | ✅ | ops | `docs/https-roadmap.md:129` | Render: зафиксировать https-инвариант (работает) / (формализация) — S → SE-1.2 |
| HTTPS-3.2 | ✅ | ops sec | `docs/https-roadmap.md:136` | Cloudflare/туннель: TLS на крае + скрытие origin (туннель) / (Cloudflare-перед-origin) — M → SE-1.1… |
| HTTPS-4.1 | ✅ | cli sec | `docs/https-roadmap.md:147` | wss по умолчанию + блок mixed-content (частично) / — S → SE-7.1 |
| HTTPS-4.2 | ⏳ | cli docs | `docs/https-roadmap.md:155` | Сообщения о URL: печатать https/wss |
| HTTPS-5.1 | 🔒 | cli sec | `docs/https-roadmap.md:167` | Убрать cleartext в release, отделить debug-LAN профиль — M → SE-7.2 |
| HTTPS-6.1 | ⏳ | srv docs | `docs/https-roadmap.md:183` | localhost остаётся ws, опц. mkcert для https-dev |
| HTTPS-7.1 | ⏳ | sec | `docs/https-roadmap.md:195` | Проверка «нет plaintext, TLS корректен» — S → SE-1.2 |
| LARS-0 | ✅ | docs | `docs/live-arsenal-roadmap.md:76` | Решение: живой билд-каталог — решено (2026-07-14) |
| LARS-1 | ✅ | core srv | `docs/live-arsenal-roadmap.md:106` | Живая авторизация постройки [core/srv] — реализовано |
| LARS-2 | 🔒 | srv | `docs/live-arsenal-roadmap.md:152` | Цепочка валют → живой фронт end-to-end |
| LARS-3 | ✅ | srv data | `docs/live-arsenal-roadmap.md:175` | Баланс и гайки честности [srv/data] — реализовано (частично осознанно) |
| LARS-4 | ✅ | proto | `docs/live-arsenal-roadmap.md:211` | UI: живая Верфь в матче — реализовано |
| M0.1 | ✅ | docs | `docs/map-roadmap.md:75` | Зафиксировать модель в дизайн-доках — |
| M0.2 | ✅ | core | `docs/map-roadmap.md:83` | Развести sectorType → terrain — |
| M1.1 | ✅ | data | `docs/map-roadmap.md:101` | Схема карты data/maps/.json — |
| M1.3 | ✅ | core | `docs/map-roadmap.md:120` | Валидация путей: только к соседям — |
| M2.1 | ✅ | core data | `docs/map-roadmap.md:135` | Виды секторов (kind) в данные — |
| M2.2 | ✅ | core | `docs/map-roadmap.md:154` | «Захват заходом» как правило ядра — |
| M2.3 | ✅ | core cli | `docs/map-roadmap.md:165` | Масштаб / вес сектора (планета = меньше) — (интерактивный ресайз — в M3.1) |
| M2.4 | ✅ | core data | `docs/map-roadmap.md:177` | Связность — свойство местности, а не координат — |
| M2.5 | ✅ | core data | `docs/map-roadmap.md:224` | Параллельные пути через провинцию — |
| M2.6 | ✅ | core data | `docs/map-roadmap.md:276` | Непроходимость перестала быть декоративной — |
| M2.7 | ✅ | cli proto | `docs/map-roadmap.md:326` | Граница, через которую нет пути, видна как барьер — |
| M3.1 | 🔒 |  | `docs/map-roadmap.md:376` | Редактор карты [tools] |
| M3.2 | ⏳ |  | `docs/map-roadmap.md:384` | Процедурный пресет → формат карты [tools] |
| M4.1 | ✅ | cli | `docs/map-roadmap.md:394` | Рендер из данных сектора — /🚧 |
| M4.3 | ✅ | core data cli | `docs/map-roadmap.md:400` | Соседство выводится из мозаики — |
| M4.2 | ⏳ | docs | `docs/map-roadmap.md:449` | Сверка с метаигрой и отложенным регионом |
| MM-0.1 | ⏳ | srv | `docs/matchmaking-roadmap.md:27` | Состояния матча: lobby→active→ended→archived |
| MM-0.2 | ✅ | core proto srv | `docs/matchmaking-roadmap.md:33` | Подключить victoryModule + баннер |
| MM-1.1 | 🔒 | srv | `docs/matchmaking-roadmap.md:43` | Лобби (создание/присоединение) |
| MM-1.2 | 🔒 | cli srv | `docs/matchmaking-roadmap.md:49` | Предматчевый экран: фракция/технологии |
| MM-2.1 | 🔒 | srv | `docs/matchmaking-roadmap.md:58` | Базовый подбор |
| MM-2.2 | 🔒 | srv | `docs/matchmaking-roadmap.md:63` | Регион/латентность |
| MM-3.1 | ⏳ | srv | `docs/matchmaking-roadmap.md:71` | Подведение итогов и счёт |
| MM-3.2 | 🔒 | srv cli | `docs/matchmaking-roadmap.md:75` | История матчей и реплеи |
| M0 | ✅ | cli docs | `docs/metrics-roadmap.md:125` | Снятие данных с ручных тестов [server] — реализовано |
| M1 | ✅ | core | `docs/metrics-roadmap.md:137` | Инструментирование ядра (детерминизм-safe) [server] — реализовано |
| M2 | ✅ | cli | `docs/metrics-roadmap.md:155` | Клиентская перф-телеметрия + перф-гейт [tools] — реализовано |
| M3 | ✅ |  | `docs/metrics-roadmap.md:173` | Сборщик телеметрии + отчёт по матчу [server][tools] — реализовано |
| M4 | ✅ | core | `docs/metrics-roadmap.md:187` | Балансная аналитика + self-play [tools] — реализовано |
| M5 | 🔒 |  | `docs/metrics-roadmap.md:211` | Ops-дашборды и алерты [server] |
| M6 | ⏳ |  | `docs/metrics-roadmap.md:218` | Продуктовая аналитика (категория H) [server][tools] |
| MS-0.1 | 🔒 | data core | `docs/missiles-roadmap.md:36` | Тип missile + пусковой модуль |
| MS-1.1 | 🔒 | core | `docs/missiles-roadmap.md:46` | launchMissile(targetNode) |
| MS-1.2 | 🔒 | core | `docs/missiles-roadmap.md:51` | Полёт (неуправляемый) + детект |
| MS-2.1 | 🔒 | core | `docs/missiles-roadmap.md:61` | Перехват ближним ПВО (pointDefense) |
| MS-2.2 | 🔒 | core data | `docs/missiles-roadmap.md:68` | Детонация |
| MS-3.1 | 🔒 | core data | `docs/missiles-roadmap.md:75` | Пусковой/ракеты как предмет + P2W-guardrail |
| MS-4.1 | 🔒 | cli | `docs/missiles-roadmap.md:83` | Рендер полёта/перехвата/удара |
| MSB-0 | ✅ | docs | `docs/multiside-combat-roadmap.md:388` | Решение владельца: (а), (б) или (в) |
| MSB-1 | ✅ | core | `docs/multiside-combat-roadmap.md:393` | Battle стал СПИСКОМ сторон |
| MSB-2 | ✅ | core | `docs/multiside-combat-roadmap.md:431` | Правило деления урона |
| MSB-3 | ✅ | core | `docs/multiside-combat-roadmap.md:486` | Вступление в идущий бой |
| MSB-4 | ✅ | core | `docs/multiside-combat-roadmap.md:556` | Совместный штурм и чей мир |
| MSB-5 | ✅ | core | `docs/multiside-combat-roadmap.md:623` | Что делает бой при смене владельца стороны |
| MSB-6 | ✅ | proto cli | `docs/multiside-combat-roadmap.md:660` | Панель боя на N сторон |
| MSB-7 | ✅ | core | `docs/multiside-combat-roadmap.md:695` | Зенитки и обстрел при N сторонах |
| ONB-0 | ✅ | proto srv | `docs/onboarding-roadmap.md:101` | Состояние первого запуска + воронка [proto/srv] (proto) |
| ONB-1 | ✅ | proto | `docs/onboarding-roadmap.md:137` | Движок гайд-марок (spotlight) ★ |
| ONB-2 | ✅ | proto | `docs/onboarding-roadmap.md:188` | Гайдовый первый матч (скриптовая соло-песочница) ★ |
| ONB-3 | ✅ | proto | `docs/onboarding-roadmap.md:241` | Just-in-time интро механик (прогрессивное раскрытие) |
| ONB-4 | ✅ | proto | `docs/onboarding-roadmap.md:284` | Help/кодекс-хаб («?» везде) |
| ONB-7 | ✅ | proto | `docs/onboarding-roadmap.md:391` | Цели первой сессии / чек-лист успеха |
| ONB-8 | ✅ | proto | `docs/onboarding-roadmap.md:421` | Онбординг в соц/мета-слой |
| OPS-0.1 | ⏳ | srv sec | `docs/operations-roadmap.md:28` | Структурные логи + трейсинг |
| OPS-0.2 | 🔒 | srv sec | `docs/operations-roadmap.md:33` | Метрики и трекинг ошибок |
| OPS-0.3 | 🔒 | srv | `docs/operations-roadmap.md:37` | Игровая телеметрия/аналитика |
| OPS-1.1 | ⏳ | srv sec | `docs/operations-roadmap.md:46` | Деплой при долгих WS-соединениях |
| OPS-1.2 | 🔒 | sec | `docs/operations-roadmap.md:51` | Нагрузочное и хаос-тестирование |
| OPS-1.3 | 🔒 | docs sec | `docs/operations-roadmap.md:56` | Статус-страница и инцидент-комм |
| OPS-2.1 | ⏳ | srv | `docs/operations-roadmap.md:64` | Шардинг по матчу + горизонт |
| OPS-2.2 | 🔒 | srv sec | `docs/operations-roadmap.md:69` | Мульти-регион |
| OPS-2.3 | ⏳ | docs | `docs/operations-roadmap.md:74` | Стоимостная модель |
| OPS-3.1 | 🔒 | data sec | `docs/operations-roadmap.md:82` | Пайплайн публикации контента + версии |
| OPS-3.2 | ⏳ | srv | `docs/operations-roadmap.md:87` | Feature-flags и A/B |
| OPS-3.3 | 🔒 | docs core | `docs/operations-roadmap.md:91` | Тулинг баланса экономики |
| OPS-4.1 | ⏳ | srv sec | `docs/operations-roadmap.md:99` | Модерация и анти-абьюз |
| OPS-4.2 | ⏳ | srv sec | `docs/operations-roadmap.md:104` | Транзакционная почта/коммуникации |
| PA-0.1 | 🔒 | sec srv | `docs/persistence-accounts-roadmap.md:53` | Честная аутентификация (ник → JWT/сессии) |
| PA-0.3 | 🔒 | sec ops | `docs/persistence-accounts-roadmap.md:71` | (= SE-3) |
| PA-0.4 | 🔒 | sec ops | `docs/persistence-accounts-roadmap.md:82` | (= PE-3.1 / SE-9) |
| PA-1.1 | ✅ | data srv | `docs/persistence-accounts-roadmap.md:96` | Схема матчей + мест — реализовано |
| PA-1.2 | ✅ | srv data | `docs/persistence-accounts-roadmap.md:109` | (= PE-0.2 / E2) |
| PA-1.3 | 🔒 | data core | `docs/persistence-accounts-roadmap.md:119` | (= PE-1.2) |
| PA-2.1 | ✅ | srv | `docs/persistence-accounts-roadmap.md:129` | Store-слой + снапшоты — реализовано |
| PA-2.2 | ⏳ | srv core | `docs/persistence-accounts-roadmap.md:137` | (= PE-1.1 / CR-0.2) |
| PA-2.3 | ⏳ | srv | `docs/persistence-accounts-roadmap.md:144` | (= PE-0.3) |
| PA-3.1 | ✅ | srv cli | `docs/persistence-accounts-roadmap.md:153` | Ник-логин + возврат за свою сторону — реализовано |
| PA-3.2 | 🔒 | srv sec | `docs/persistence-accounts-roadmap.md:158` | (= accounts-roadmap) |
| PA-3.3 | ⏳ | srv core | `docs/persistence-accounts-roadmap.md:163` | Семантика возврата и offline |
| PA-4.1 | ✅ | srv | `docs/persistence-accounts-roadmap.md:173` | v1 (одно-процессная) |
| PA-4.2 | ⏳ | core srv | `docs/persistence-accounts-roadmap.md:193` | (= PE-2.2) |
| PA-5.1 | ✅ | ops | `docs/persistence-accounts-roadmap.md:204` | Self-hosted Postgres на VPS — реализовано |
| PA-5.2 | 🔒 | ops srv | `docs/persistence-accounts-roadmap.md:209` | (↔ metrics-roadmap) |
| PE-0.1 | ✅ | srv | `docs/persistence-roadmap.md:31` | Схема и load/save GameState |
| PE-0.2 | ✅ | srv act | `docs/persistence-roadmap.md:37` | Стор квитанций (идемпотентность) |
| PE-0.3 | ⏳ | srv | `docs/persistence-roadmap.md:43` | Hot/cold: Redis горячее, Postgres холодное |
| PE-1.1 | ⏳ | srv | `docs/persistence-roadmap.md:51` | Журнал действий + снапшоты |
| PE-1.2 | 🔒 | srv data | `docs/persistence-roadmap.md:56` | Миграция сейв-формата в хранилище |
| PE-2.1 | ✅ | srv | `docs/persistence-roadmap.md:65` | Будилка по scheduled-событиям — v1 (одно-процессная), v2 |
| PE-2.2 | ⏳ | srv core | `docs/persistence-roadmap.md:71` | Корректный offline-catch-up |
| PE-3.1 | ⏳ | srv sec | `docs/persistence-roadmap.md:80` | Зашифрованные бэкапы + PITR + учение restore |
| PE-3.2 | ⏳ | srv | `docs/persistence-roadmap.md:85` | Переживание рестарта посреди матча |
| PVE-0.1 | ✅ | core data | `docs/pve-team-modes-roadmap.md:81` | GameModeDef zod-схема + modes в GameData |
| PVE-0.2 | ✅ | core srv | `docs/pve-team-modes-roadmap.md:111` | modeId в MatchConfig + консервация |
| PVE-0.3 | ✅ | data | `docs/pve-team-modes-roadmap.md:145` | Пресет standard |
| PVE-1.1 | ✅ | proto | `docs/pve-team-modes-roadmap.md:165` | Командные форматы в NetworkMatchMode |
| PVE-1.2 | ✅ | data | `docs/pve-team-modes-roadmap.md:193` | Пресеты командных режимов |
| PVE-1.3 | ✅ | data | `docs/pve-team-modes-roadmap.md:205` | Локализация режимов |
| PVE-2.1 | ✅ | data | `docs/pve-team-modes-roadmap.md:223` | swarm в data/factions.json — уже в контенте |
| PVE-2.2 | ✅ | data | `docs/pve-team-modes-roadmap.md:229` | Локализация Роя — уже в обеих локалях |
| PVE-2.3 | ✅ | data | `docs/pve-team-modes-roadmap.md:234` | Bump data/manifest.json — сделано в PVE-0.1 |
| PVE-3.1 | ✅ | core | `docs/pve-team-modes-roadmap.md:246` | state.pve в GameState |
| PVE-3.2 | ✅ | core | `docs/pve-team-modes-roadmap.md:254` | pveModule — спавн волн |
| PVE-3.3 | ✅ | core srv | `docs/pve-team-modes-roadmap.md:274` | Регистрация в DEVMODULES + bump манифеста |
| PVE-3.4 | ✅ | core | `docs/pve-team-modes-roadmap.md:281` | Кооп-враждебность NPC — правок не потребовалось |
| PVE-4.1 | ✅ | core | `docs/pve-team-modes-roadmap.md:288` | MatchEndReason расширение |
| PVE-4.2 | ✅ | core | `docs/pve-team-modes-roadmap.md:294` | PvE-чек в victoryModule |
| PVE-4.3 | ✅ | data | `docs/pve-team-modes-roadmap.md:313` | Пресет pvewaves |
| PVE-5.1 | ✅ | srv | `docs/pve-team-modes-roadmap.md:323` | pveOrchestrator скелет |
| PVE-5.2 | ✅ | srv | `docs/pve-team-modes-roadmap.md:349` | Интеграция через serverOrders |
| PVE-6.1 | ✅ | docs | `docs/pve-team-modes-roadmap.md:387` | Обновить docs/game-modes-roadmap.md |
| PVE-6.2 | ✅ | docs | `docs/pve-team-modes-roadmap.md:403` | Обновить docs/state.md |
| PVE-6.3 | ✅ | docs | `docs/pve-team-modes-roadmap.md:418` | Обновить CODE-MAP.md |
| PVE-6.4 | ✅ | docs | `docs/pve-team-modes-roadmap.md:441` | ADR 05/06 → accepted |
| ROS-0.1 | ✅ | data proto core | `docs/roster-roadmap.md:116` | ПКО и зональное ПВО: имя насквозь 2026-09-09 |
| ROS-0.2 | ✅ | proto | `docs/roster-roadmap.md:147` | «Верфь» → «Производство» 2026-09-09 |
| ROS-1.1 | ✅ | core data proto | `docs/roster-roadmap.md:165` | Пехота и техника: два рода наземных войск 2026-09-09 |
| ROS-1.2 | ✅ | data proto | `docs/roster-roadmap.md:199` | Фрегат: корабль поддержки под модули 2026-09-09 |
| ROS-1.3 | ✅ | core data | `docs/roster-roadmap.md:233` | Осадная платформа осаждает планету, а не флот 2026-09-09 |
| ROS-1.4 | ✅ | core data proto | `docs/roster-roadmap.md:259` | Бомбардировщик и профили урона челноков 2026-09-09 |
| ROS-1.5 | ✅ | core data proto | `docs/roster-roadmap.md:295` | Десантный челнок: высадка вместо удара 2026-09-09 |
| ROS-2.1 | ✅ | core data proto | `docs/roster-roadmap.md:345` | Три линии 50/30/20, артиллерия без ответного огня 2026-09-09 |
| ROS-2.1a | ✅ | proto | `docs/roster-roadmap.md:396` | Управление огнём показывается только тем, кто может стрелять 2026-09-09 |
| ROS-2.2 | ✅ | core data proto | `docs/roster-roadmap.md:422` | Челнок — сторона боя: ответный урон и зональное ПВО 2026-09-09 |
| ROS-3.1 | ✅ | proto | `docs/roster-roadmap.md:459` | Экран «Производство»: пять типов, модули, количество, планета 2026-09-09 |
| ROS-3.2 | ✅ | proto | `docs/roster-roadmap.md:497` | Шаттл — корабль во всём интерфейсе 2026-09-09 |
| SZE-0.1 | ✅ | docs | `docs/sector-zero-economy-roadmap.md:228` | Свести §4.5 с магазином |
| SZE-0.2 | ✅ | docs data | `docs/sector-zero-economy-roadmap.md:236` | Цена звезды и потолок |
| SZE-0.3 | ✅ | docs proto | `docs/sector-zero-economy-roadmap.md:248` | Детерминизм заточки без сервера |
| SZE-1.1 | ✅ | data core proto | `docs/sector-zero-economy-roadmap.md:275` | Звезда у модуля: поле и потолок |
| SZE-1.2 | ✅ | proto | `docs/sector-zero-economy-roadmap.md:313` | Экран Мастерской |
| SZE-1.3 | ✅ | data proto | `docs/sector-zero-economy-roadmap.md:356` | Осколки и pity |
| SZE-2.1 | 🔒 | proto | `docs/sector-zero-economy-roadmap.md:392` | Экран Академии на движке Мастерской |
| SZE-3.1 | ✅ | data proto | `docs/sector-zero-economy-roadmap.md:407` | Витрина и три способа оплаты |
| SZE-3.2 | ✅ | data proto | `docs/sector-zero-economy-roadmap.md:449` | Ассортимент |
| SZE-3.3 | ⏳ | docs sec | `docs/sector-zero-economy-roadmap.md:481` | Покупки в Sector Zero и площадка |
| SZE-4.1 | ✅ | data | `docs/sector-zero-economy-roadmap.md:490` | Уровень у модуля Роя |
| SZE-4.2 | ✅ | core | `docs/sector-zero-economy-roadmap.md:532` | Контригра против уровня |
| PVR-0.1 | ✅ | data | `docs/sector-zero-roadmap.md:1240` | Карта pve-1 снова строится |
| PVR-0.2 | ✅ | proto | `docs/sector-zero-roadmap.md:1271` | pveModule в ядре прототипа |
| PVR-0.3 | ✅ | proto | `docs/sector-zero-roadmap.md:1298` | Сохранение: сперва мета, потом забег |
| PVR-0.4 | ✅ | data | `docs/sector-zero-roadmap.md:1377` | Карта — развилки из линий |
| PVR-1.1 | ✅ | proto core data cli | `docs/sector-zero-roadmap.md:1434` | Соло-запуск задаёт modeId |
| PVR-1.2 | ✅ | proto | `docs/sector-zero-roadmap.md:1476` | HUD забега: волна N из M и время до следующей |
| PVR-1.3 | ✅ | data | `docs/sector-zero-roadmap.md:1508` | Состав волны перестаёт быть одним дроном |
| PVR-1.4 | ✅ | proto core | `docs/sector-zero-roadmap.md:1569` | Выбор между волнами |
| PVR-1.5 | ✅ | core | `docs/sector-zero-roadmap.md:1626` | Волны Роя враждебны и доходят до боя |
| PVR-1.6 | ✅ | core data | `docs/sector-zero-roadmap.md:1665` | Забег доходит до вердикта |
| PVR-1.7 | ✅ | core data proto | `docs/sector-zero-roadmap.md:1734` | Пиратская база для первого боя |
| PVR-2.1 | ✅ | proto | `docs/sector-zero-roadmap.md:1764` | Выбор сложности на запуске забега |
| PVR-2.2 | ✅ | proto | `docs/sector-zero-roadmap.md:1800` | У забега свой темп и ускорение |
| PVR-3.1 | ⏳ | docs | `docs/sector-zero-roadmap.md:1843` | Резолюция: чем PvE-прокачка НЕ является |
| PVR-3.2 | ✅ | proto | `docs/sector-zero-roadmap.md:1855` | Хранилище PvE-прогресса |
| PVR-3.3 | ✅ | proto | `docs/sector-zero-roadmap.md:1867` | Награда за забег |
| PVR-4.1 | ✅ | docs | `docs/sector-zero-roadmap.md:1892` | Резолюция: что из §3 входит в первую версию |
| PVR-4.2 | ✅ | core | `docs/sector-zero-roadmap.md:1910` | Память Роя как состояние |
| PVR-4.3 | ✅ | core data | `docs/sector-zero-roadmap.md:1947` | Одна читаемая адаптация от сигнала до формы |
| PVR-4.4 | ✅ | data | `docs/sector-zero-roadmap.md:1989` | Структуры первого набора |
| PVR-4.5 | ✅ | proto | `docs/sector-zero-roadmap.md:2019` | Журнал адаптаций |
| SE-0.1 | ✅ | srv sec | `docs/secure-environment-roadmap.md:48` | JWT в WebSocket-рукопожатии |
| SE-0.2 | ✅ | srv | `docs/secure-environment-roadmap.md:55` | Авторизация на соединении и на сообщении |
| SE-0.3 | ⏳ | sec | `docs/secure-environment-roadmap.md:64` | Сервисные идентичности и scoped-токены |
| SE-1.1 | ⏳ | sec | `docs/secure-environment-roadmap.md:73` | Cloudflare: DDoS / WAF / rate-limit на краю |
| SE-1.2 | ⏳ | srv sec | `docs/secure-environment-roadmap.md:78` | TLS 1.3 везде + приватная сеть [A02] |
| SE-1.3 | 🔒 | sec | `docs/secure-environment-roadmap.md:84` | Скрытие origin + egress-контроль |
| SE-2.1 | ⏳ | sec | `docs/secure-environment-roadmap.md:93` | Секрет-стор + инъекция в рантайме |
| SE-2.2 | 🔒 | sec | `docs/secure-environment-roadmap.md:98` | Ротация и аудит доступа к секретам |
| SE-3.1 | ⏳ | srv sec | `docs/secure-environment-roadmap.md:107` | Least-privilege роли БД |
| SE-3.2 | ⏳ | srv | `docs/secure-environment-roadmap.md:112` | Шифрование at-rest + in-transit [A02] |
| SE-3.3 | ⏳ | srv | `docs/secure-environment-roadmap.md:117` | RLS как defense-in-depth |
| SE-3.4 | 🔶 | srv sec | `docs/secure-environment-roadmap.md:122` | Бэкапы + PITR + проверенный restore |
| SE-4.1 | ⏳ | srv sec | `docs/secure-environment-roadmap.md:159` | ACL / TLS / приватный bind |
| SE-5.1 | ✅ | srv sec | `docs/secure-environment-roadmap.md:168` | Минимальный non-root read-only образ |
| SE-5.2 | ✅ | sec | `docs/secure-environment-roadmap.md:177` | Сканирование образа сервера |
| SE-6.1 | ⏳ | srv | `docs/secure-environment-roadmap.md:187` | Лимиты соединений и сообщений |
| SE-6.2 | ⏳ | srv sec | `docs/secure-environment-roadmap.md:192` | Rate-limiting действий |
| SE-6.3 | ⏳ | srv | `docs/secure-environment-roadmap.md:198` | Per-player очередь (анти-double-spend) |
| SE-6.4 | ✅ | srv | `docs/secure-environment-roadmap.md:204` | Фильтр видимости перед отправкой |
| SE-6.5 | ⏳ | srv | `docs/secure-environment-roadmap.md:211` | Масштаб WS без поломки auth/видимости |
| SE-7.1 | 🔶 | cli sec | `docs/secure-environment-roadmap.md:220` | CSP + Trusted Types + HSTS 2026-09-21 |
| SE-7.2 | ⏳ | cli sec | `docs/secure-environment-roadmap.md:254` | SRI и безопасные куки |
| SE-8.1 | ⏳ | srv sec | `docs/secure-environment-roadmap.md:263` | Структурное аудит-логирование |
| SE-8.2 | 🔒 | sec | `docs/secure-environment-roadmap.md:268` | Алерты на аномалии |
| SE-8.3 | ⏳ | srv sec | `docs/secure-environment-roadmap.md:273` | Метрики и трекинг ошибок |
| SE-9.1 | ⏳ | srv | `docs/secure-environment-roadmap.md:282` | Переживание рестарта посреди матча |
| SE-9.2 | 🔒 | docs sec | `docs/secure-environment-roadmap.md:287` | DR: RTO/RPO, runbooks, kill-switch |
| SE-10.1 | 🔒 | docs | `docs/secure-environment-roadmap.md:296` | Минимизация данных и GDPR-база |
| SD-0.1 | ⏳ | docs sec | `docs/secure-sdlc-roadmap.md:65` | Цель ASVS L2 + threat-model-кадэнс |
| SD-0.2 | ✅ | sec | `docs/secure-sdlc-roadmap.md:70` | SEC-1: триаж и baseline сканеров |
| SD-1.1 | ⏳ | core act srv | `docs/secure-sdlc-roadmap.md:87` | Валидация на каждой границе доверия |
| SD-1.2 | ⏳ | cli proto | `docs/secure-sdlc-roadmap.md:93` | Вывод/экранирование — XSS в клиенте |
| SD-1.3 | ✅ | srv | `docs/secure-sdlc-roadmap.md:99` | Инъекции — БД 2026-09-22 |
| SD-1.4 | ⏳ | core | `docs/secure-sdlc-roadmap.md:135` | Prototype pollution и безопасная десериализация |
| SD-1.5 | ⏳ | core act srv | `docs/secure-sdlc-roadmap.md:141` | ReDoS-гигиена |
| SD-2.1 | ✅ | sec | `docs/secure-sdlc-roadmap.md:150` | Кастомные Semgrep-правила под инварианты ядра |
| SD-2.2 | ⏳ | sec | `docs/secure-sdlc-roadmap.md:166` | ESLint security-плагины + типизованные правила |
| SD-2.3 | ⏳ | sec | `docs/secure-sdlc-roadmap.md:171` | CodeQL default setup |
| SD-2.4 | ⏳ | sec | `docs/secure-sdlc-roadmap.md:176` | Секреты: Gitleaks + GitHub push protection |
| SD-3.1 | ⏳ | sec | `docs/secure-sdlc-roadmap.md:188` | pnpm: блокировка lifecycle-скриптов + cooldown |
| SD-3.2 | ⏳ | sec | `docs/secure-sdlc-roadmap.md:194` | SCA-гейт + автообновления с политикой |
| SD-3.3 | ✅ | sec | `docs/secure-sdlc-roadmap.md:200` | Провенанс артефактов + проверка (SEC-5 ) |
| SD-3.4 | ✅ | sec | `docs/secure-sdlc-roadmap.md:213` | SBOM в IR-поток → |
| SD-4.1 | ⏳ | docs sec | `docs/secure-sdlc-roadmap.md:222` | Threat-model-as-code в репо |
| SD-4.2 | 🔒 | docs | `docs/secure-sdlc-roadmap.md:227` | Кадэнс per-feature |
| SD-5.1 | ⏳ | sec | `docs/secure-sdlc-roadmap.md:236` | CODEOWNERS + защита ветки |
| SD-5.2 | ⏳ | sec | `docs/secure-sdlc-roadmap.md:241` | Pre-commit хуки + подпись коммитов |
| SD-6.1 | ⏳ | sec | `docs/secure-sdlc-roadmap.md:250` | SHA-пин экшенов и образов + least-priv токены |
| SD-6.2 | ⏳ | sec | `docs/secure-sdlc-roadmap.md:256` | OIDC вместо долгоживущих секретов |
| SD-6.3 | ✅ | sec | `docs/secure-sdlc-roadmap.md:261` | Агрегация находок (SARIF) |
| SD-7.1 | ⏳ | act | `docs/secure-sdlc-roadmap.md:274` | Расширить abuse-тесты слоя действий |
| SD-7.2 | ⏳ | core srv | `docs/secure-sdlc-roadmap.md:279` | Фаззинг валидаторов и парсеров (частично ) |
| SD-7.3 | ✅ | core | `docs/secure-sdlc-roadmap.md:289` | Property-based тесты детерминизма |
| SD-8.1 | 🔒 | docs sec | `docs/secure-sdlc-roadmap.md:306` | ASVS L2 self-verification |
| SD-8.2 | ⏳ | sec | `docs/secure-sdlc-roadmap.md:311` | DAST против живого сервера |
| SD-8.3 | ⏳ | docs | `docs/secure-sdlc-roadmap.md:316` | Процесс реакции на уязвимости |
| SV-0.1 | ✅ | srv | `docs/server-roadmap.md:44` | Fastify-скелет + health/readiness |
| SV-0.2 | ✅ | srv | `docs/server-roadmap.md:50` | Match-actor модель |
| SV-1.1 | ✅ | srv act | `docs/server-roadmap.md:60` | Подключить @void/action-layer к WS-потоку |
| SV-1.2 | ✅ | act | `docs/server-roadmap.md:66` | zod-схемы на каждый тип действия |
| SV-2.1 | ✅ | srv | `docs/server-roadmap.md:75` | Прод-WS поверх Fastify |
| SV-2.2 | ✅ | srv | `docs/server-roadmap.md:81` | Монотонный seq + ресинк |
| SV-2.3 | ⏳ | srv | `docs/server-roadmap.md:89` | Per-player очередь (анти-double-spend) |
| SV-2.5 | ✅ | srv | `docs/server-roadmap.md:93` | Фабрика матчей + лента открытых |
| SV-3.1 | ✅ | srv | `docs/server-roadmap.md:101` | Фильтр видимости перед broadcast |
| SV-3.2 | ⏳ | srv | `docs/server-roadmap.md:107` | Interest management при масштабе |
| SV-4.1 | ⏳ | srv | `docs/server-roadmap.md:115` | Фан-аут между инстансами |
| SH-0.1 | ✅ | data core | `docs/shields-roadmap.md:45` | Стат shield + двойной пул в UnitStack |
| SH-0.2 | ✅ | core | `docs/shields-roadmap.md:50` | applyDamage двухслойно |
| SH-1.1 | ✅ | core | `docs/shields-roadmap.md:60` | Реген щита на time.advanced |
| SH-1.2 | ⏳ | core | `docs/shields-roadmap.md:69` | Щит восстанавливается В БОЮ |
| SH-2.1 | ✅ | core data | `docs/shields-roadmap.md:95` | Ремонт в порту |
| SH-2.2 | 🔒 | core | `docs/shields-roadmap.md:102` | Ремонтные дроны — единственный in-combat ремонт |
| SH-2.3 | 🔒 | core data | `docs/shields-roadmap.md:109` | Ремонтный модуль |
| SM-0.1 | 🔒 | data | `docs/ship-modules-roadmap.md:77` | Схема ModuleDef + каталог data/modules.json |
| SM-0.2 | 🔒 | data core | `docs/ship-modules-roadmap.md:90` | Стат moduleSlots + поле UnitStack.modules |
| SM-0.3 | 🔒 | core | `docs/ship-modules-roadmap.md:98` | Лоадаут-aware идентичность стека |
| SM-0.4 | 🔒 | core | `docs/ship-modules-roadmap.md:106` | Хелпер effectiveStats(def, stack, data) |
| SM-0.5 | 🔒 | core | `docs/ship-modules-roadmap.md:116` | Маршрутизация cargoCapacity через эффективный лукап |
| SM-0.6 | 🔒 | core | `docs/ship-modules-roadmap.md:127` | Действие loadout.equip / loadout.unequip |
| SM-0.7 | 🔒 | cli | `docs/ship-modules-roadmap.md:139` | CLI лоадаута |
| SM-1.1 | 🔒 | data | `docs/ship-modules-roadmap.md:146` | Модуль +N cargoCapacity (плоский, тиры) |
| SM-1.2 | 🔒 | data srv | `docs/ship-modules-roadmap.md:154` | Фейрнес расширителя (F2P + soulbound) |
| SM-2.1 | 🔒 | data | `docs/ship-modules-roadmap.md:170` | Семейство «дройды» (новый контент) |
| SM-2.2 | 🔒 | data | `docs/ship-modules-roadmap.md:176` | Трейт transport + модуль-фабрика |
| SM-2.3 | 🔒 | core | `docs/ship-modules-roadmap.md:185` | fleet.assembleDroids — fleet-scoped производство |
| SM-2.4 | 🔒 | core | `docs/ship-modules-roadmap.md:197` | Завершение + бой-фриз + ОГРАНИЧЕННЫЙ re-defer |
| SM-2.5 | 🔒 | cli | `docs/ship-modules-roadmap.md:212` | Рендер фабрики |
| SM-2.6 | 🔒 | data srv | `docs/ship-modules-roadmap.md:216` | Фейрнес/P2W-гард фабрики |
| SHU-0.1 | ✅ | core data proto | `docs/shuttles-roadmap.md:105` | Переименование: эскадрильи → челноки |
| SHU-1.1 | ✅ | core data | `docs/shuttles-roadmap.md:115` | Ангар космопорта |
| SHU-1.2 | ✅ | core proto | `docs/shuttles-roadmap.md:139` | Удар и возврат |
| SHU-1.3 | ✅ | core data | `docs/shuttles-roadmap.md:167` | Перехват |
| SHU-2.1 | ✅ | core data | `docs/shuttles-roadmap.md:203` | Носитель как мобильный космопорт |
| SHU-2.2 | ✅ | core srv proto | `docs/shuttles-roadmap.md:235` | Снос старой машинерии 2026-09-11 |
| SHU-2.3 | ✅ | core proto | `docs/shuttles-roadmap.md:301` | Вылет с ИДУЩЕГО носителя 2026-09-16 |
| SHU-3.1 | ✅ | proto | `docs/shuttles-roadmap.md:352` | Интерфейс 2026-09-10 |
| SHU-3.2 | ✅ | proto | `docs/shuttles-roadmap.md:514` | Бот умеет челноки 2026-09-09 |
| SHU-3.3 | ✅ | proto | `docs/shuttles-roadmap.md:556` | Носитель у бота 2026-09-15 |
| SHU-3.4 | ✅ | proto core data | `docs/shuttles-roadmap.md:597` | Наземная война бота: разведка, уверенность, высадка 2026-09-16 |
| SHU-3.5 | ✅ | proto data | `docs/shuttles-roadmap.md:663` | Гарнизон по развитости: подвоз и производство 2026-09-16 |
| SHU-4.1 | ✅ | proto | `docs/shuttles-roadmap.md:731` | Словарь: эскадра у мира, флот у кораблей 2026-09-10 |
| SHU-4.2 | ✅ | core data | `docs/shuttles-roadmap.md:773` | Эскадра как соединение ангара 2026-09-10 |
| SHU-4.3 | ✅ | proto | `docs/shuttles-roadmap.md:833` | Панель мира: эскадры как флоты 2026-09-10 |
| SHU-4.4 | ✅ | core | `docs/shuttles-roadmap.md:885` | Погоня: удар по движущейся цели 2026-09-13 |
| ST-3.1 | ✅ | core | `docs/steward-roadmap.md:68` | Ядро: доля потерь по прогнозу + трипваер «враг близко» |
| ST-3.2 | ✅ | srv proto | `docs/steward-roadmap.md:89` | Драйвер: эвакуация под угрозой (поза defend) |
| ST-3.3 | ✅ | core srv proto | `docs/steward-roadmap.md:116` | Поза «Активная оборона» — контрудар при приемлемых потерях |
| ST-2.1 | ✅ | core srv proto | `docs/steward-roadmap.md:146` | Guard-режим: точки удержания |
| ST-2.2 | ⏳ | srv core | `docs/steward-roadmap.md:171` | PvE-экспансия (платный тир) |
| ST-2.3 | ⏳ | srv | `docs/steward-roadmap.md:177` | Сим-гейт по порогу потерь |
| ST-3.4 | ✅ | srv proto | `docs/steward-roadmap.md:188` | Анти-шаттл гистерезис эвакуации |
| THREAT-HUD | ✅ | proto | `docs/steward-roadmap.md:199` | «Враг у ваших рубежей» — трипваер живому игроку |
| ST-2.4 | ✅ | core srv cli | `docs/steward-roadmap.md:208` | SITREP (журнал решений + утренний рапорт) |
| ST-2.5 | ⏳ | srv | `docs/steward-roadmap.md:229` | Мета-гейт тиров (free / paid) |
| TT-0.1 | ✅ | data core | `docs/tech-tree-roadmap.md:72` | Ветки branch |
| TT-0.2 | ✅ | data core | `docs/tech-tree-roadmap.md:79` | День-гейт dayGate |
| TT-0.3 | 🔒 | data core | `docs/tech-tree-roadmap.md:88` | Условия conditions[] |
| TT-1.1 | 🔒 | core | `docs/tech-tree-roadmap.md:96` | Правило доступности |
| TT-1.2 | 🔒 | core | `docs/tech-tree-roadmap.md:102` | Исследование → завершение (reuse) |
| TT-1.3 | 🔒 | core | `docs/tech-tree-roadmap.md:107` | Слоты исследований (РЕШЕНО: 2 → до 3) |
| TT-2.1 | 🔒 | srv core | `docs/tech-tree-roadmap.md:117` | Анлок узлов уровнем аккаунта |
| TT-3.1 | ✅ | cli | `docs/tech-tree-roadmap.md:125` | Вкладки веток + состояния узлов |
| TT-4.1 | ⏳ | data core | `docs/tech-tree-roadmap.md:146` | Слот учёного + выбор на старте |
| TT-4.2 | 🔒 | data core | `docs/tech-tree-roadmap.md:153` | Капстоун: супер-юнит / особое здание (лейт-гейм) |
| TT-4.3 | 🔒 | data core | `docs/tech-tree-roadmap.md:160` | Учёный «+слот» |
| VET-1 | ✅ | core | `docs/unit-medals-roadmap.md:214` | Вклад стека в залп перестаёт выбрасываться |
| VET-2 | ✅ | core | `docs/unit-medals-roadmap.md:246` | Счётчики ветерана на стеке |
| VET-3 | ✅ | core data | `docs/unit-medals-roadmap.md:285` | Грейды и пороги |
| VET-4 | ✅ | core data | `docs/unit-medals-roadmap.md:311` | Выплата, растущая со степенью |
| VET-5 | ✅ | proto cli | `docs/unit-medals-roadmap.md:341` | Медали в карточке юнита |
| YAG-0.1 | ✅ | docs | `docs/yandex-games-roadmap.md:559` | Сверить требования с первоисточником 2026-09-22 |
| YAG-1.1a | ✅ | proto | `docs/yandex-games-roadmap.md:621` | Контракты GamePlatform и WebPlatformAdapter |
| YAG-1.1b | ⏳ | proto | `docs/yandex-games-roadmap.md:655` | Платформенная цель сборки и раскладка архива |
| YAG-1.2 | 🔶 | proto | `docs/yandex-games-roadmap.md:692` | YandexGamesAdapter: инициализация и жизненный цикл 2026-09-22 |
| YAG-1.3 | 🔒 | proto | `docs/yandex-games-roadmap.md:744` | Язык от площадки |
| YAG-1.4 | 🔒 | proto | `docs/yandex-games-roadmap.md:749` | Гость и повышение до аккаунта площадки |
| YAG-2.1 | ⏳ | proto | `docs/yandex-games-roadmap.md:790` | PortableMetaSave: компактный дескриптор забега |
| YAG-2.2 | 🔒 | proto | `docs/yandex-games-roadmap.md:800` | PlatformSave в адаптере Яндекса |
| YAG-3.1 | 🔒 | proto | `docs/yandex-games-roadmap.md:810` | PlatformAds в адаптере Яндекса |
| YAG-3.2 | 🔒 | proto | `docs/yandex-games-roadmap.md:817` | Placements по правилам |
| YAG-4.1 | 🔒 | srv | `docs/yandex-games-roadmap.md:829` | Эндпойнт проверки подписи |
| YAG-4.2 | 🔒 | proto | `docs/yandex-games-roadmap.md:848` | PlatformIAP в адаптере Яндекса |
| YAG-5.1 | 🔶 | proto | `docs/yandex-games-roadmap.md:859` | PlatformAnalytics: словарь событий |
| YAG-5.2 | 🔒 | docs | `docs/yandex-games-roadmap.md:879` | Карточка игры и подача в модерацию |
| YAG-6.1 | 🔒 | proto | `docs/yandex-games-roadmap.md:890` | Серверное время вместо системного |
| YAG-6.2 | 🔒 | proto | `docs/yandex-games-roadmap.md:898` | Пауза площадки: что делает мир |
| YAG-6.3 | 🔒 | proto | `docs/yandex-games-roadmap.md:907` | Удалённый конфиг баланса |
| YAG-6.4 | 🔒 | proto | `docs/yandex-games-roadmap.md:915` | Кнопка «назад» и выход |
