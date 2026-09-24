# Индекс кирпичей — что где лежит и в каком статусе

<!-- ГЕНЕРИРУЕТСЯ scripts/docs-check.mjs. Руками не править: гейт сверяет этот файл с
     разбором бэклога и роадмапов и краснеет на расхождении. Перегенерировать —
     node scripts/docs-check.mjs --write-index -->

> **Зачем файл нужен.** «Есть ли уже кирпич про X?» — вопрос ПЕРЕД тем, как завести
> новый. Без индекса ответ стоил перебора двенадцати тысяч строк бэклога и полутора
> десятков роадмапов, и дубль ловился везением. Здесь он находится одним поиском.

> **Источник правды — не этот файл.** Тело кирпича, его условие готовности и разбор
> живут в файле из колонки «Где» — ищи там по id кирпича, он уникален. Номера строки
> здесь нет намеренно (WIKI-2): с ним индекс конфликтовал почти в каждом параллельном
> PR, потому что вставка кирпича в середину бэклога сдвигала адреса у всего, что ниже.

> Статусы: ✅ ⏳ 🔶 🔒 🗑 — легенда в разделе «## Статусы» бэклога.

| ID | Ст. | Зоны | Где | Заголовок |
| --- | --- | --- | --- | --- |
| A1 | ✅ |  | `docs/backlog.md` | Проекция visibleState(state, viewerId, data) — identify (1 прыжок) + |
| A1m | ✅ |  | `docs/backlog.md` | Память последнего увиденного (вариант B): GameState.fog (per-player |
| A2 | ✅ |  | `docs/backlog.md` | радар-постройка с 3 уровнями |
| A3 | ✅ |  | `docs/backlog.md` | Разведка флотом: транзитный флот опознаёт ближайший узел по ходу (fleetNode), |
| A4 | ✅ |  | `docs/backlog.md` | Хелпер isVisibleTo(state, viewer, {planetId/fleetId}, data) — «видим ли объект |
| A5 | ✅ |  | `docs/backlog.md` | Общая видимость союза/коалиции: coverageFor объединяет покрытие по «блоку |
| A6 | ✅ |  | `docs/backlog.md` | Зрение — только круги (решение владельца 2026-09-24 после плейтеста: «вижу |
| B1 | ✅ |  | `docs/backlog.md` | Расширить FactionDef: стартовый лоадаут (startingLoadout: ресурсы/флот/ |
| B2 | ✅ |  | `docs/backlog.md` | factionModule: пассивы фракции через хуки economy.production/fleet.speed/ |
| B3 | ✅ |  | `docs/backlog.md` | factionStart(data, faction) — чистая детерминированная сборка старта из |
| B4 | 🗑 |  | `docs/backlog.md` | вырезано: |
| C1 | ✅ |  | `docs/backlog.md` | Схема TechnologyDef + data/technologies.json (анлоки/бонусы/стоимость/время). |
| C2 | ✅ |  | `docs/backlog.md` | technologyModule + действие technology.research, состояние анлоков (Player.technologies). |
| C3 | ✅ |  | `docs/backlog.md` | Предматчевый выбор: SlotAssignment.technologies (buildFromMap) — стартовые |
| C4 | ✅ |  | `docs/backlog.md` | Бонусы тех на хуках (производство/скорость/бой) + гейт постройки юнитов/зданий. |
| D1 | ✅ |  | `docs/backlog.md` | Состояние дипломатии в GameState: diplomacy?: Record<pairKey, DiplomaticStance> |
| D2 | ✅ |  | `docs/backlog.md` | diplomacyModule (modules/diplomacy.ts): действие diplomacy.declare |
| D3 | ✅ |  | `docs/backlog.md` | Consent-протокол смягчения — то же действие diplomacy.declare, взаимно: |
| D4 | ✅ | proto | `docs/backlog.md` | Миграция прототипа на ядровый diplomacyModule завершена. Игровая |
| E1 | ✅ |  | `docs/backlog.md` | Зод-схемы на каждый тип действия (закрыт SV-1.2: |
| E2 | ✅ |  | `docs/backlog.md` | Стор receipts с интерфейсом под персистентность (закрыт сервером: |
| E3 | ✅ |  | `docs/backlog.md` | Интеграционный тест: невалидное / повтор по тому же id / несанкц. |
| F1 | ✅ |  | `docs/backlog.md` | Скелет Fastify + health-роут (SV-0.1: /health·/ready·/metrics, pino, drain). |
| F2 | ✅ |  | `docs/backlog.md` | Postgres JSONB: load/save GameState + квитанции (store/postgres.ts), |
| F3 | ✅ |  | `docs/backlog.md` | (переопределён): будилка по scheduled-событиям — v1 без Redis/BullMQ |
| F4 | ✅ |  | `docs/backlog.md` | WebSocket-слой: пуш per-player дельт (wsServer.ts + protocol.ts). |
| F5 | ✅ |  | `docs/backlog.md` | Последовательная обработка действий: per-room актор-mailbox на durable-пути |
| F6 | ✅ |  | `docs/backlog.md` | перед |
| F7 | ✅ |  | `docs/backlog.md` | JWT в WS-handshake (SE-0.1: join-токен в ?token=, auth.ts, пин алгоритма, |
| F8 | ✅ |  | `docs/backlog.md` | Persist + драйвер пробуждения в packages/server/src/main.ts (паритет с |
| G1 | ✅ |  | `docs/backlog.md` | (в PWA-варианте, G1→CP1) Оболочка — Vite-shell вместо RN (решение |
| G2 | 🗑 |  | `docs/backlog.md` | Skia-рендер карты (зум / скролл / culling) — RN-вариант, снят вместе с RN. |
| G3 | ✅ |  | `docs/backlog.md` | (в @void/client: applyDelta-применение серверных diff'ов уже зашиплено; RN-вариант не нужен). |
| G4 | ✅ |  | `docs/backlog.md` | Превью через shared-core («если атакую — что будет?»): ядровая половина — |
| H1 | ✅ |  | `docs/backlog.md` | victoryModule подключён в кернел прототипа (game.ts MODULES — а значит и в |
| H2 | ✅ |  | `docs/backlog.md` | орбитальное |
| H3 | ✅ |  | `docs/backlog.md` | фракции |
| H4 | 🗑 |  | `docs/backlog.md` | Конструктор наземной армии: пехота в 3 вариантах (militia — дешёвое мясо, |
| H5 | ✅ |  | `docs/backlog.md` | Шпионаж играбелен (SPY-1 → прототип): ядровый espionageModule в MODULES |
| SPY-2 | ✅ | core | `docs/backlog.md` | Контрразведка: каждый оплаченный espionage.spy дополнительно |
| SPY-UX | ✅ | proto | `docs/backlog.md` | Весь шпионаж в одном месте (фидбек плейтеста 2026-07-18): |
| H6 | ✅ |  | `docs/backlog.md` | Локализация прототипа (1 язык = 1 файл): prototype/src/i18n.ts — |
| LOC-1 | ✅ | proto docs | `docs/backlog.md` | Локализация на КЛЮЧАХ, единая папка /localization |
| LOC-2 | ✅ | proto | `docs/backlog.md` | Этап 2: домиграция остальных вызовов на ключи — ЗАКРЫТ. |
| LOC-3 | ✅ | cli | `docs/backlog.md` | Подключить packages/client к /localization. |
| LOC-4 | ✅ | proto | `docs/backlog.md` | Разъединить смёрженные ключи локализации — ПРОВЕРЕНО, работы нет. |
| LOC-5 | ✅ | proto cli | `docs/backlog.md` | Один рантайм локализации вместо двух копий. |
| LOC-6 | ✅ | cli | `docs/backlog.md` | Локаль грузится по требованию, а не обе сразу. |
| LOC-7 | ✅ | proto | `docs/backlog.md` | Отказы ядра без текста: 67 кодов из 116 доезжают до игрока |
| REL-5 | ✅ | srv cli proto ops | `docs/backlog.md` | Замок мест: посадочный билет на ник-логине |
| REL-4 | ✅ | srv ops | `docs/backlog.md` | Action-гейт включён на играбельном пути (netserver). |
| REL-3 | ✅ | ops | `docs/backlog.md` | Сервер одной командой + отказоустойчивая инфраструктура. |
| REL-2 | ✅ | core proto | `docs/backlog.md` | Полнота гейт-схем — вся игра играбельна через |
| REL-1 | ✅ | proto | `docs/backlog.md` | Цепочка приказов УДАЛЕНА к релизу |
| CC-6 | ✅ |  | `docs/backlog.md` | Лимит очереди по ПРИКАЗАМ игрока (не шагам) + подписка: один enqueue = |
| CC-srv-2 | ✅ |  | `docs/backlog.md` | Стоячие приказы серверно-авторитетны (CC-2 авто-штурм + CC-4 дежурный |
| ECON-1 | ✅ |  | `docs/backlog.md` | Набор ресурсов → 5: credits(деньги)/metal/food/energy/microelectronics |
| ECON-2 | ✅ |  | `docs/backlog.md` | Сессионная биржа (marketModule, GameState.market): market.list |
| ECON-3 | ✅ |  | `docs/backlog.md` | Производители energy/microelectronics (здания): powerplant (Fusion |
| ECON-4 | ✅ |  | `docs/backlog.md` | (прототип) UI биржи: окно «Рынок» в рельсе — вкладки ресурсов, продажа/покупка с эскроу, листинг/от… |
| ECON-5 | ✅ |  | `docs/backlog.md` | Экономика зданий (содержание + brownout): BuildingDef/BuildingLevel |
| SES-1 | ✅ | core proto | `docs/backlog.md` | Коалиционный порог победы (GDD §3.3). |
| AVA-0 | ✅ | core proto | `docs/backlog.md` | Играбельный командный бой (2v2 и т.п.) — первый шаг к |
| SES-2 | ✅ | core srv | `docs/backlog.md` | Награды по итогам сессии (GDD §3.4). |
| SES-3 | ✅ | core data | `docs/backlog.md` | Премиум-добыча (GDD §4.3). |
| EFX-1 | ✅ | core | `docs/backlog.md` | Универсальный движок трейтов/эффектов. |
| CORP-0 | ✅ | srv | `docs/backlog.md` | База корпораций (членство/роли RBAC + store + REST). |
| AVA-1 | ✅ | srv core | `docs/backlog.md` | Командная дипломатия на серверном пути. |
| AVA-2 | ✅ | srv | `docs/backlog.md` | Очки влияния корпорации. |
| AVA-3 | ✅ | srv | `docs/backlog.md` | Флаги готовности к AvA. |
| AVA-4 | ✅ | srv | `docs/backlog.md` | Вызов/принятие (S0–S2). |
| AVA-5 | ✅ | core data | `docs/backlog.md` | Пул AvA-карт + eligibility. |
| AVA-6 | ✅ | srv | `docs/backlog.md` | Сбор ростера + лок (S3). |
| AVA-7 | ✅ | srv | `docs/backlog.md` | Оркестратор: сессия из ростера (S4). |
| AVA-8 | ✅ | srv | `docs/backlog.md` | Мир→война→итог (S5–S7). |
| AVA-9 | ✅ | srv | `docs/backlog.md` | Публичная лента корпораций. |
| ARS-0 | ✅ | docs | `docs/backlog.md` | Развилки решены владельцем (2026-07-14): |
| ARS-1 | ✅ | data core | `docs/backlog.md` | Схема предмета/чертежа. |
| ARS-2 | ✅ | srv | `docs/backlog.md` | ArsenalStore |
| ARS-3 | ✅ | core srv | `docs/backlog.md` | Снапшот в матч. |
| ARS-4 | ✅ | srv | `docs/backlog.md` | Дроп по месту + сальваж. |
| ARS-5 | ✅ | proto srv | `docs/backlog.md` | Витрина + фильтр Верфи. |
| ARS-6 | ✅ | srv | `docs/backlog.md` | Корп-склад + аренда. |
| ARS-7 | ✅ | srv | `docs/backlog.md` | Ролл помнит версию таблицы, которая его произвела. |
| ARS-8 | ✅ | core | `docs/backlog.md` | Гейт владения спрашивает ТОЛЬКО ПРО КОРАБЛИ. |
| LARS-0 | ✅ | docs | `docs/backlog.md` | Решено владельцем (2026-07-14): |
| LARS-1 | ✅ | core srv | `docs/backlog.md` | Живая авторизация постройки. |
| LARS-2 | 🔒 | srv | `docs/backlog.md` | (EC-1.2, EC-2/EC-3 — economy-roadmap.md) Цепочка валют → фронт |
| LARS-3 | ✅ | srv data | `docs/backlog.md` | Баланс и гайки честности. |
| LARS-4 | ✅ | proto | `docs/backlog.md` | Живая Верфь в матче. |
| META-1 | ✅ |  | `docs/backlog.md` | Деревья прокачки + меню: prototype/src/meta.ts — 3 прямые ветки |
| HERO-0 | ✅ |  | `docs/backlog.md` | Скелет: герой-позиция (GameState.heroes/tempLanes/topology), |
| HERO-1 | ✅ | data | `docs/backlog.md` | Схемы + data/heroes.json (архетипы: commander/ravager/vanguard/warden, |
| HERO-2 | ✅ |  | `docs/backlog.md` | корабль |
| HERO-3 | ✅ |  | `docs/backlog.md` | своём |
| HERO-4 | ✅ |  | `docs/backlog.md` | Обобщённый hero.ability {heroId, abilityId, target?}: генерические гейты из |
| HERO-5 | ✅ |  | `docs/backlog.md` | Пассивки из данных → хуки. data/heroPassives.json + HeroPassiveDefSchema |
| HERO-6 | ✅ |  | `docs/backlog.md` | Фитинги корабля: data/heroFittings.json (HeroFittingDef {statMods, |
| HERO-7 | ✅ |  | `docs/backlog.md` | Дерево навыков: data/heroSkillTrees.json (HeroSkillNode {name, branch?, |
| HERO-8 | ✅ |  | `docs/backlog.md` | на флоте / у союзника |
| HERO-9 | ✅ |  | `docs/backlog.md` | Ростер: SlotAssignment.heroes?: string[] (buildFromMap) — пред-матч |
| HERO-FX1 | ✅ | core | `docs/backlog.md` | Первый провайдер шва hero.effect.<type> — heroEffectsModule |
| HERO-FX2 | ✅ | core | `docs/backlog.md` | Второй провайдер — hero.effect.aura (rally/bulwark): |
| HERO-FX3 | ✅ | core | `docs/backlog.md` | Третий провайдер шва — hero.effect.reveal (scan): |
| HERO-10 | ✅ | core | `docs/backlog.md` | Каждый герой ведёт СВОЙ флот |
| HERO-11 | ✅ | data | `docs/backlog.md` | Разделение на трансгуманизм и псионику убрано ИЗ |
| HERO-12 | ✅ | proto | `docs/backlog.md` | Обводка героя — по редкости. |
| HERO-AURA-R | ✅ | data | `docs/backlog.md` | Радиус ауры: начать маленьким и растить навыком |
| HERO-PASS-R | ✅ | data | `docs/backlog.md` | Пассивные ауры героя тоже опущены до 42 — |
| HERO-REQ-T | ✅ | proto | `docs/backlog.md` | Имена узлов в списке требований переведены: |
| SHIP-1 | ✅ | proto | `docs/backlog.md` | Модель: prototype/src/ships.ts — корпуса (SHIPHULLS: cruiser 3 · |
| SHIP-2 | ✅ | proto | `docs/backlog.md` | →♻ UI «Верфь». Первая версия — pre-match вкладка в setup — была |
| CON-1 | ✅ | proto | `docs/backlog.md` | Единый таб-конструктор «Верфь» |
| CON-2 | ✅ | proto | `docs/backlog.md` | Эскадрильи |
| CON-3 | 🗑 | proto | `docs/backlog.md` | Армия |
| CON-4 | ✅ | proto | `docs/backlog.md` | Герои |
| CON-5 | ✅ | proto | `docs/backlog.md` | Мобильная адаптация «Верфи» |
| SHIP-3 | ✅ | core | `docs/backlog.md` | Эффекты живые: util/loadout.ts (effectiveStats) читается боем |
| SHIP-4 | ✅ | core | `docs/backlog.md` | Обобщён фиттинг-движок: один генерик инсталл-гейт |
| SHIP-5 | 🔒 | srv | `docs/backlog.md` | предметы мета-экономики |
| SHIP-6 | ✅ |  | `docs/backlog.md` | Типизированные слоты: корпуса в data/units.json несут |
| NETP0-1 | ✅ | proto | `docs/backlog.md` | (PR #128) Порог победы в сети: netserver не передаёт config в |
| NETP0-2 | ✅ | proto | `docs/backlog.md` | (PR #128) Совет учёных для p2: DEFAULTSETUP помечает p2 как AI и |
| NETP0-3 | ✅ | cli proto | `docs/backlog.md` | (PR #128) Доменные события по сети: сервер уже шлёт |
| NETP0-4 | ✅ | proto srv cli | `docs/backlog.md` | Сетевой чат: relay по образцу ally-пингов — |
| NETP0-5 | ✅ | proto | `docs/backlog.md` | Переговоры между людьми: consent-офферы в прототипной |
| NETP0-6 | ✅ | proto | `docs/backlog.md` | (PR #128) EN-локализация свежих окон: steward («Хранитель») и |
| ONB-0 | ✅ | proto | `docs/backlog.md` | Флаг первого запуска + воронка. |
| ONB-1 | ✅ | proto | `docs/backlog.md` | Движок гайд-марок (spotlight). |
| ONB-2 | ✅ | proto | `docs/backlog.md` | Гайдовый первый матч. |
| ONB-3 | ✅ | proto | `docs/backlog.md` | Just-in-time интро механик. |
| ONB-4 | ✅ | proto | `docs/backlog.md` | Help/кодекс-хаб («?» везде). |
| ONB-5 | 🔶 | proto srv | `docs/backlog.md` | Async-модель + дневной дайджест. |
| ONB-6 | ✅ | core proto | `docs/backlog.md` | Combat-preview. |
| ONB-7 | ✅ | proto | `docs/backlog.md` | Цели первой сессии. |
| ONB-8 | ✅ | proto | `docs/backlog.md` | Онбординг в соц/мета-слой (корпорации/AvA) — ONB-3-механизмом, |
| ONB-9 | ✅ | proto | `docs/backlog.md` | Состав мира — списком, у групп есть описание по удержанию |
| ONB-10 | ✅ | proto | `docs/backlog.md` | Обучение показывало в пустоту: «постройте корабль» — а нажимать |
| ONB-11 | ✅ | proto | `docs/backlog.md` | Обучение не объясняло, КАК смотреть на мир. |
| ST-3.1 | ✅ | core | `docs/backlog.md` | Доля потерь по прогнозу + трипваер «враг близко». |
| ST-3.2 | ✅ | srv proto | `docs/backlog.md` | Эвакуация под угрозой (поза defend). |
| THREAT-HUD | ✅ | proto | `docs/backlog.md` | «Враг у ваших рубежей» живому игроку. |
| ST-3.4 | ✅ | srv proto | `docs/backlog.md` | Анти-шаттл гистерезис. |
| ST-2.4 | ✅ | core srv cli | `docs/backlog.md` | SITREP — журнал решений + утренний рапорт. |
| ST-3.3 | ✅ | core srv proto | `docs/backlog.md` | Поза «Активная оборона». |
| ST-2.1 | ✅ | core srv proto | `docs/backlog.md` | Guard-режим: точки удержания. |
| ST-4 | ✅ | proto | `docs/backlog.md` | Окно «Хранителя» не закрывается по Back/Escape. |
| SES-2.1 | ✅ | srv proto | `docs/backlog.md` | Автостарт сессий — мир живёт с создания. |
| SES-2.2 | ✅ | srv | `docs/backlog.md` | ИИ-заместитель после 3 РЕАЛЬНЫХ дней отсутствия. |
| SES-2.3 | ✅ | srv | `docs/backlog.md` | Окно входа 4 реальных дня. |
| SES-2.4 | ✅ | proto | `docs/backlog.md` | Лента сессий в главном меню. |
| SES-2.5 | ✅ | srv proto | `docs/backlog.md` | Регистрация/логин на игровом пути. |
| SES-2.6 | ✅ | srv ops | `docs/backlog.md` | Плейтест-цикл ×24 — полный цикл живьём. |
| BRW-0 | ✅ | srv proto | `docs/backlog.md` | Разные сессии — предпосылка ВСЕХ трёх фильтров. |
| BRW-1 | ✅ | srv | `docs/backlog.md` | Режим в read-model. |
| BRW-2 | ✅ | proto | `docs/backlog.md` | Чистый модуль фильтрации matchFilter.ts (без UI). |
| BRW-3 | ✅ | proto | `docs/backlog.md` | Панель фильтров над списком «Доступные». |
| BRW-4 | ✅ | proto | `docs/backlog.md` | Режим на карточке. |
| ENTRY-1 | ✅ | srv | `docs/backlog.md` | join в боевом сервере теряет slot и faction — молча. |
| ENTRY-2 | ✅ | proto | `docs/backlog.md` | Экран сетевого входа по образцу «Настройки схватки». |
| ENTRY-3 | ✅ | srv | `docs/backlog.md` | Совет учёных доезжает до сетевого матча. |
| ENTRY-4 | ✅ | proto | `docs/backlog.md` | Строка «Совет учёных» на экране сетевого входа. |
| ADDR-1 | ✅ | srv | `docs/backlog.md` | Партия как сущность, а не комната из MATCHES=N. |
| ADDR-2 | ✅ | srv proto | `docs/backlog.md` | Развести адрес партии и приглашение. |
| ADDR-3 | ✅ | proto srv | `docs/backlog.md` | Путь вместо параметра. |
| ADDR-4 | ✅ | proto | `docs/backlog.md` | «Мои партии» в хабе. |
| ADDR-5 | ✅ | proto | `docs/backlog.md` | Чужой или неизвестный id сессии не должен давать пустой экран. |
| ADDR-6 | ✅ | srv proto | `docs/backlog.md` | GET /matches/:id/seats отдаёт расклад партии кому угодно (IDOR, A01). |
| OPS-1 | ✅ | ops | `docs/backlog.md` | update-dev.sh генерируется установщиком, поэтому не может обновить сам себя. |
| ADM-0 | ✅ | srv | `docs/backlog.md` | Лобби целиком регистрируется с одного адреса. |
| ADM-1 | ✅ | srv core proto | `docs/backlog.md` | Кик: названная власть над ЗАКРЕПЛЁННЫМ местом. |
| ADM-2 | ✅ | srv core | `docs/backlog.md` | Кресло, сменившее владельца, несёт поколение. |
| ADM-3 | ✅ | core | `docs/backlog.md` | Крыло эскадрильи: чистый состав и одна координата. |
| ADM-4 | ✅ | proto | `docs/backlog.md` | Песочница: открыть все технологии одной кнопкой. |
| CONV-1 | ✅ | proto | `docs/backlog.md` | Мгновенный ремонт и форс-марш: копии удаляются, ядро включается. |
| CONV-2 | ✅ | proto | `docs/backlog.md` | Доковый ремонт (econScrews → fleetRepair). |
| CONV-3 | ✅ | proto | `docs/backlog.md` | Гражданский налог. |
| CONV-4 | ✅ | proto | `docs/backlog.md` | Столица (capital.designate). |
| CONV-5 | ✅ | core proto | `docs/backlog.md` | Слоты совета учёных: прототип начинает грузить scientistModule. |
| CONV-6 | ✅ | proto | `docs/backlog.md` | Хелперы крыла (src/shuttle.ts → state/shuttle.ts). |
| CONV-7 | ✅ | proto | `docs/backlog.md` | Постоянные приказы. |
| CONV-8 | ✅ | proto | `docs/backlog.md` | Операции с флотом (fleetLaunch → fleetOps). |
| CONV-10 | ✅ | core | `docs/backlog.md` | Авто-сбора построенного нет в каноне — это пробел, а не дубль. |
| CONV-9 | ✅ | core proto | `docs/backlog.md` | Рынок — единственный кирпич, где сводить придётся В ЯДРО. |
| CONV-11 | ✅ | proto data | `docs/backlog.md` | Дрейф двух каталогов контента ничем не остановлен. |
| CONV-12 | ✅ | proto data | `docs/backlog.md` | Свести контент к одному каталогу. |
| CORE-PARITY | ✅ | srv | `docs/backlog.md` | Канон не грузил четыре модуля, которые прототип грузил — |
| CONV-13 | ✅ | docs | `docs/backlog.md` | Статус кирпича врал, и проверить это было нечем. |
| CONV-14 | ✅ | docs | `docs/backlog.md` | Та же гниль в роадмапах — и её оказалось вдвое больше, чем видел |
| CONV-15 | ✅ | data | `docs/backlog.md` | Дефолт схемы молча менял правила: в шипнутом каталоге флот |
| CONV-16 | ✅ | proto | `docs/backlog.md` | Три технологии прототипа не может открыть никто. |
| CONV-17 | ✅ | data | `docs/backlog.md` | В каноническом каталоге лежала готовая проза вместо ключа — |
| CONV-18 | ✅ | docs | `docs/backlog.md` | Эталон приёмки протух, и на него ссылались два кирпича. |
| CONV-19 | ✅ | docs | `docs/backlog.md` | Индексация проверяла только ИСХОДЯЩИЕ ссылки: док мог лежать в |
| AI-BAL-1 | ✅ | proto | `docs/backlog.md` | Бот исследует технологии + харнес их видит. |
| AI-BAL-2 | ✅ | proto | `docs/backlog.md` | Бот строит оборону и держит миры. |
| AI-BAL-3 | ✅ | proto | `docs/backlog.md` | Наземная армия и десант. |
| AI-BAL-4 | ✅ | proto | `docs/backlog.md` | Эскадрильи, артиллерия, герой. |
| AI-BAL-6 | ✅ | proto | `docs/backlog.md` | Сессия фиксированной длины вместо гонки к порогу очков |
| AI-BAL-5 | ✅ | proto | `docs/backlog.md` | Разброс между сидами — прибор НЕ ДАВАЛ статистики. |
| AI-BAL-7 | ✅ | proto | `docs/backlog.md` | Бот умеет проигрывать бой. |
| AI-BAL-8 | ✅ | proto core | `docs/backlog.md` | Герой вошёл в измерение. |
| AI-BAL-9 | ✅ | proto | `docs/backlog.md` | Рынок ожил в обе стороны. |
| AI-BAL-10 | ✅ | proto core | `docs/backlog.md` | Отчёт смешивал три вида «мёртвого» — теперь называет каждый. |
| AI-BAL-11 | ✅ | proto | `docs/backlog.md` | Отступление не удешевило размен — выигрыш кто-то съедает. |
| AI-BAL-12 | ✅ | proto | `docs/backlog.md` | Две фракции из четырёх вне измерения. |
| CORE-DMG-1 | ✅ | core | `docs/backlog.md` | Все каналы урона идут через хук combat.damage. |
| CORE-DMG-2 | ✅ | core | `docs/backlog.md` | Пропустить хук combat.damage всё ещё МОЖНО — примитив урона |
| CORE-DMG-3 | ✅ | core | `docs/backlog.md` | Ауры и пассивы героя не доходят до неближнего боя — асимметрия, |
| CORE-DMG-4 | ⏳ | core | `docs/backlog.md` | Пси-зона героя (лестница scan) работает только в свалке — |
| AI-BAL-13 | ✅ | proto | `docs/backlog.md` | Бот не знает правила «один герой на флот» — и от этого стоит |
| AI-BAL-1.1 | ✅ | proto | `docs/backlog.md` | Тест-боты отделены от игровых. |
| BAL-1 | ✅ | proto | `docs/backlog.md` | Стартовые позиции больше не решают матч — карта-«колесо». |
| BAL-2 | ✅ | proto data | `docs/backlog.md` | Фракции: перекос есть, но ВДВОЕ МЕНЬШЕ и в другую сторону. |
| BAL-3 | 🔶 | proto data | `docs/backlog.md` | Кредиты, энергия и еда — декорации, а не ресурсы. |
| BAL-4 | 🗑 | core proto | `docs/backlog.md` | Захват прилётом обесценивает армию. |
| BAL-5 | ✅ | proto core | `docs/backlog.md` | Снежный ком: 71–75%, камбэк есть у каждого четвёртого. |
| BAL-10 | 🔶 | proto data core | `docs/backlog.md` | Восемь дней сессии ничего не решают — что с этим |
| BAL-11 | ✅ | proto data | `docs/backlog.md` | Скорость флота — сильнейший пассив, а «сбалансированный» |
| BAL-6 | 🔶 | proto data | `docs/backlog.md` | Дерево технологий не даёт выбора — но причина НЕ цена. |
| BAL-7 | ⏳ | proto data | `docs/backlog.md` | У heavyinfantry нет ниши. |
| BAL-8 | ✅ | proto data | `docs/backlog.md` | Типы планет вернулись на карту — но только косметически. |
| BAL-9 | ✅ | proto | `docs/backlog.md` | Карта была честной ценой того, что стала плоской. |
| BAL-12 | ✅ | proto | `docs/backlog.md` | Прибор не достаёт до слоя hasscientist — ни один такой узел |
| BAL-13 | ✅ | proto data | `docs/backlog.md` | Достроить ростер учёных: три ветки из пяти без |
| BAL-14 | ✅ | proto | `docs/backlog.md` | Бот исследует псевдоузлы мета-прокачки — и получает даром то, |
| BAL-15 | ✅ | core | `docs/backlog.md` | Бот не исследует НИЧЕГО: запрет грант-узлов поставлен в |
| PC-UI | ✅ | proto | `docs/backlog.md` | Десктоп-полировка правой панели (consolidation, ветка |
| PERF-2 | ✅ |  | `docs/backlog.md` | Оптимизационный проход по shared-core (3-линзовый агент-ревью: горячие пути |
| PERF-1 | ✅ |  | `docs/backlog.md` | Сведено и проверено |
| WIKI-1 | ✅ | docs | `docs/backlog.md` | найти, в каком из 98 доков искать правило про X, можно только |
| WIKI-2 | ✅ | docs | `docs/backlog.md` | bricks-index.md конфликтует почти в каждом параллельном PR — |
| SEC-0 | ✅ |  | `docs/backlog.md` | Базовый DevSecOps-пайплайн: SAST (Semgrep) + SCA (pnpm audit + osv-scanner) |
| SEC-1 | ✅ |  | `docs/backlog.md` | Триаж + baseline: находок — ноль (Gitleaks v8.18.4 локально + pnpm audit + |
| SEC-2 | ✅ |  | `docs/backlog.md` | Кастомные Semgrep-правила под инварианты ядра: запрет Math.random/ |
| SEC-3 | ✅ |  | `docs/backlog.md` | Безопасность самого пайплайна: пин образов сканеров по sha256, |
| SEC-4 | ✅ |  | `docs/backlog.md` | (аудитом доков — GitHub Code Scanning половина уже была реализована, не |
| SEC-5 | ✅ |  | `docs/backlog.md` | Container scanning: Dockerfile (multi-stage, пин distroless-базы) + |
| SEC-6 | ✅ |  | `docs/backlog.md` | DAST: dast-zap-джоба в security.yml (не было закомментированной |
| SEC-7 | ✅ |  | `docs/backlog.md` | (SEC-5 — замок снят) Supply-chain integrity (A08): подпись |
| SEC-8 | 🔒 |  | `docs/backlog.md` | OWASP Top 10 2021 |
| SEC-10 | ✅ | sec | `docs/backlog.md` | Еженедельный ре-скан: security.yml получил schedule: cron |
| SEC-11 | ✅ | sec | `docs/backlog.md` | Сканирование сторонних образов прода: джоба trivy-deps. |
| SEC-12 | ✅ | sec | `docs/backlog.md` | Хардненинг рантайма контейнеров + честная запись о том, что на |
| SEC-14 | ✅ | sec | `docs/backlog.md` | Триаж 71 находки, накопившейся после посадки trivy-deps/SEC-11. |
| SEC-18 | ✅ | sec | `docs/backlog.md` | Поимённый триаж десяти находок Trivy в бинаре caddy + починка |
| SEC-22 | ✅ | sec | `docs/backlog.md` | две LOW в glibc закрыли очередь мержа всему репозиторию. |
| SEC-23 | ✅ | sec | `docs/backlog.md` | красный trivy-image теперь объясняет себя в логе. |
| SEC-29 | ✅ | sec ops | `docs/backlog.md` | пин postgres отстал на пересборку, и предупреждение об |
| SEC-30 | ✅ | sec | `docs/backlog.md` | триаж caddy протух: набор вырос вдвое, в нём CRITICAL, а два |
| SEC-32 | ✅ | sec | `docs/backlog.md` | разобран весь остаток находок: postgres 35, TruffleHog 10, и |
| SEC-33 | ✅ | srv sec | `docs/backlog.md` | личный JSON игрока оседал в кэше браузера: cache-control |
| SEC-34 | ✅ | sec ops | `docs/backlog.md` | за пинами в Dockerfile не следил никто, и пин рантайм-базы |
| SEC-35 | ✅ | sec ops | `docs/backlog.md` | свой образ Caddy публикуется и подписывается, как серверный. |
| SEC-36 | ⏳ | sec ops | `docs/backlog.md` | увести Caddy с root внутри контейнера. |
| SEC-39 | ✅ | sec ops | `docs/backlog.md` | исправленная libc6 в серверном образе без новых исключений. |
| SEC-40 | ✅ | sec ops | `docs/backlog.md` | 43 🔴 сводного отчёта были протухшими базами, а не нашим |
| SEC-37 | ✅ | sec proto | `docs/backlog.md` | браузерный сторож был мёртв с 2026-08-15 и молчал об |
| SEC-31 | ✅ | sec ops | `docs/backlog.md` | собственная сборка Caddy: закрыты ВСЕ СЕМЬ достижимых CVE, |
| SEC-24 | ✅ | sec | `docs/backlog.md` | неоценённая CVE в glibc снова закрыла очередь мержа. |
| SEC-27 | ✅ | sec ops | `docs/backlog.md` | гейт trivy image фильтрует по ЧИНИМОСТИ, а не по |
| SEC-28 | ✅ | sec | `docs/backlog.md` | вычищены подавления, ставшие после SEC-27 избыточными и |
| SEC-26 | ✅ | sec | `docs/backlog.md` | пятый за две недели красный trivy-image на пустом месте, и |
| SEC-25 | ✅ | sec ops | `docs/backlog.md` | бамп дайджеста базового образа + ревизия подавлений. |
| SEC-19 | ✅ | sec | `docs/backlog.md` | Находки trivy-deps не доезжали до Code Scanning вообще. |
| SEC-20 | ✅ | sec | `docs/backlog.md` | Триаж всего остатка находок: KICS 23, ZAP 4, TruffleHog 2. |
| SEC-21 | ✅ | srv sec | `docs/backlog.md` | HTTP-периметр не уважал Origin-allowlist — теперь уважает. |
| SEC-15 | ✅ | sec | `docs/backlog.md` | Второй SCA-движок: джоба dependency-check (OWASP Dependency-Check, |
| SEC-17 | ✅ | sec ops | `docs/backlog.md` | [sec/ops] Прод-образ больше не везёт дев-тулчейн + гейт «образ вообще |
| SEC-13 | ✅ | sec ops | `docs/backlog.md` | [sec/ops] Closed loop «просканировано → то же самое в проде»: воркфлоу |
| SEC-9 | ✅ |  | `docs/backlog.md` | Ремедиация Code Scanning (dashboard-триаж 2026-07-24): CodeQL-варнинги |
| H4-REVERT | ✅ | core srv proto data | `docs/backlog.md` | Снос системы дивизий, возврат к |
| GRND-1 | ✅ | proto | `docs/backlog.md` | Десант — кнопка в ряду команд + меню «кого и сколько». |
| CHAIN-UX | ✅ | proto | `docs/backlog.md` | Режим «Приказ» — цепочка тапами по карте с иконками и |
| SND-1 | ✅ | proto | `docs/backlog.md` | Синтезированные звуки интерфейса. |
| SND-2 | ✅ | proto | `docs/backlog.md` | Пинг гидролокатора: развёртка засекла цель. |
| HUD-DOCK | ✅ | proto | `docs/backlog.md` | Низ экрана ведёт себя как одно целое. |
| BACK-1 | ✅ | proto | `docs/backlog.md` | Реестр слоёв Back/Escape достроен — и закрыт как КЛАСС. |
| H4-TAIL | ✅ | proto | `docs/backlog.md` | Уборка мёртвого кода за снесёнными фичами. |
| RANGE-UX | ✅ | proto core | `docs/backlog.md` | Радиусы огня видно, и они РАВНЫ ядерным. |
| CAST-UX | ✅ | proto | `docs/backlog.md` | Прицел каста: хаб уходит, дальность и область видны. |
| RECAP-FOG | ✅ | proto sec | `docs/backlog.md` | Сводка перестала раскрывать чужую экономику. |
| HERO-CORRIDOR | ✅ | core data | `docs/backlog.md` | Коридор стал ЛИЧНЫМ: дыра в общий граф закрыта. |
| HERO-CORRIDOR-2 | ✅ | core proto | `docs/backlog.md` | Коридор стало ВИДНО, и посреди него больше |
| AIM-PAN | ✅ | proto | `docs/backlog.md` | При вооружённом приказе камеру снова можно двигать. |
| MAPSHARE-1 | ✅ | core proto | `docs/backlog.md` | Договор об обмене картами + высадка к своим. |
| PING-PANEL | ✅ | proto | `docs/backlog.md` | Окно «Метки коалиции»: свои и союзные в одном списке. |
| UI-STD | ✅ | proto | `docs/backlog.md` | Кнопки окна меток — стандартные; дерево технологий — |
| CMD-VIS | ✅ | core proto | `docs/backlog.md` | Стоп в коридоре запрещён; «нет приказа — нет |
| FRIENDS-1 | ✅ | srv proto | `docs/backlog.md` | Вкладка «Друзья» в хабе — с настоящим сервером. |
| BUILD-1 | ✅ | proto | `docs/backlog.md` | Окно построек мира + карточка здания с уровнями. |
| ABIL-RING | ✅ | proto | `docs/backlog.md` | Радиусы способностей — фиолетовым пунктиром, и не только |
| SENSOR-1 | ✅ | data core proto | `docs/backlog.md` | Сенсорный фрегат: носитель радара — и сам радар |
| TABS-GRID | ✅ | proto | `docs/backlog.md` | Вкладки штаба героев и дерева технологий — сеткой, |
| CORP-HUB | ✅ | proto | `docs/backlog.md` | Хаб корпорации по макету: вкладки сеткой, «Штаб», «Битвы», |
| UI-RES2 | ✅ | proto | `docs/backlog.md` | Ресурс нигде не печатается словом — везде иконка и цвет. |
| TT-4 | ✅ | proto | `docs/backlog.md` | Вкладка технологий в матче — список ярусами вместо сетки. |
| RANK-1 | ✅ | srv proto | `docs/backlog.md` | Вкладка «Рейтинги» в хабе — с настоящим сервером. |
| RETASK | ✅ | core | `docs/backlog.md` | Флоту в пути можно дать новый «Курс». |
| ORBIT-ORIGIN | ✅ | proto | `docs/backlog.md` | Кольцо — картинка, отсчёт — от центра мира. |
| RULES-5 | ✅ | core proto | `docs/backlog.md` | Туман карты спрашивается у ядра, а не выводится |
| RULES-4 | ✅ | core proto | `docs/backlog.md` | Клиентские предикаты: решение — ядру, подача — |
| RULES-3 | ✅ | core srv proto | `docs/backlog.md` | Драйверы постоянных приказов спрашивают |
| RULES-2 | ✅ | core data proto | `docs/backlog.md` | Правила про контент стали данными. |
| RULES-2.1 | ✅ | core proto | `docs/backlog.md` | Довести maxPerPlanet > 1 до рабочего состояния. |
| RULES-1 | ✅ | core proto | `docs/backlog.md` | «Можно ли?» — один вопрос к одним правилам. |
| SEC-16 | ✅ | core srv | `docs/backlog.md` | Два сторожа под авто-мердж: правила, которые до сих пор |
| SEC-41 | ✅ | sec ops | `docs/backlog.md` | весь наш security-контур смотрит в репозиторий; на |
| NETA2-0a | ✅ | srv | `docs/backlog.md` | Начисление XP на reject-but-advanced: observeEndIfNeeded не |
| NETA2-0b | ✅ | cli | `docs/backlog.md` | Клиент ре-шлёт конверт и на EUNAVAILABLE (сервер откатывает |
| NETA2-0c | ✅ | proto | `docs/backlog.md` | playerOrder в net-матче на реконнекте отклоняет приказ с |
| NETA2-0d | ✅ | srv | `docs/backlog.md` | ping.clientTime требует Number.isFinite (как desync/perf). |
| NETA2-1 | ✅ | srv cli | `docs/backlog.md` | Прозрачные причины отказа хендшейка |
| NETA2-2 | ✅ | proto | `docs/backlog.md` | Бюджет реконнекта > окна reap'а сокета |
| NETA2-3 | ✅ | srv | `docs/backlog.md` | netserver не дублирует запись квитанций |
| NETA2-4 | ✅ | srv cli | `docs/backlog.md` | Единый источник wire-протокола — контракт объявлен ОДИН раз. |
| NETA2-5 | ✅ | proto cli | `docs/backlog.md` | Прототип использует outbox транспорта на |
| NETA2-6 | ✅ | srv proto | `docs/backlog.md` | Один оффлайн-шедулер |
| NETA2-7 | ✅ | srv | `docs/backlog.md` | Один джойн-хендшейк |
| NETA2-8 | ✅ | srv | `docs/backlog.md` | Единое apply-ядро |
| NETA2-9 | ✅ | srv cli | `docs/backlog.md` | Полировка протокола |
| NETA2-10 | ✅ | srv | `docs/backlog.md` | Восстановление seat-ticket под SEATLOCK |
| NETA2-mon | ✅ | srv | `docs/backlog.md` | Сигналы сбоев наружу + durable-логи |
| REFP-1 | ✅ | proto | `docs/backlog.md` | prototypeData.ts |
| REFP-2 | ✅ | proto | `docs/backlog.md` | map.ts |
| REFP-3 | ✅ | proto | `docs/backlog.md` | fleetStacks.ts |
| REFP-4 | ✅ | proto | `docs/backlog.md` | tax.ts |
| REFP-5 | ✅ | proto | `docs/backlog.md` | formations.ts |
| REFP-6 | ✅ | proto | `docs/backlog.md` | botFavour.ts |
| REFP-7 | ✅ | proto | `docs/backlog.md` | shuttle.ts |
| REFP-8 | ✅ | proto | `docs/backlog.md` | chain.ts |
| REFP-9 | ✅ | proto | `docs/backlog.md` | hunger.ts |
| REFP-10 | ✅ | proto | `docs/backlog.md` | fleetLaunch.ts |
| REFP-11 | ✅ | proto | `docs/backlog.md` | botDiplomacy.ts |
| REFP-12 | ✅ | proto | `docs/backlog.md` | sessionMarket.ts |
| REFP-13 | 🗑 | proto | `docs/backlog.md` | division.ts |
| REFP-14 | ✅ | proto | `docs/backlog.md` | capital.ts |
| REFP-15 | ✅ | proto | `docs/backlog.md` | standingOrders.ts |
| REFP-16 | ✅ | proto | `docs/backlog.md` | forcedMarch.ts |
| REFP-17 | ✅ | proto | `docs/backlog.md` | instantRepair.ts |
| REFP-18 | ✅ | proto | `docs/backlog.md` | econScrews.ts |
| REFP-19 | ✅ | proto | `docs/backlog.md` | economy.ts |
| REFP-20 | ✅ | proto | `docs/backlog.md` | matchSetup.ts |
| REFP-21 | ✅ | proto | `docs/backlog.md` | protoKernel.ts |
| REFP-22 | ✅ | proto | `docs/backlog.md` | actions.ts |
| REFP-23 | ✅ | proto | `docs/backlog.md` | patrol.ts |
| REFP-24 | ✅ | proto | `docs/backlog.md` | serverDrivers.ts |
| REFP-25 | ✅ | proto | `docs/backlog.md` | stewardGuard.ts |
| REFP-26 | ✅ | proto | `docs/backlog.md` | ai.ts |
| REFP-27 | ✅ | proto | `docs/backlog.md` | canTraverse |
| REFP-28 | ✅ | proto | `docs/backlog.md` | Финальная очистка |
| REFM-0 | ✅ | proto | `docs/backlog.md` | Страховка: typecheck прототипа в гейте. |
| REFM-0.1 | ✅ | proto | `docs/backlog.md` | ESLint для prototype/ |
| REFM-1 | ✅ | proto | `docs/backlog.md` | Инвентаризация main.ts |
| REFM-2 | ✅ | proto | `docs/backlog.md` | format.ts |
| REFM-3 | ✅ | proto | `docs/backlog.md` | icons.ts |
| REFM-4 | ✅ | proto | `docs/backlog.md` | dossiers.ts |
| REFM-5 | ✅ | proto | `docs/backlog.md` | arsenalScreen.ts |
| REFM-6 | ✅ | proto | `docs/backlog.md` | marketScreen.ts |
| REFM-7 | ✅ | proto | `docs/backlog.md` | stewardScreen.ts |
| REFM-8 | 🗑 | proto | `docs/backlog.md` | divisionDesigner.ts |
| REFM-9 | ✅ | proto | `docs/backlog.md` | techTree.ts |
| REFM-10 | ✅ | proto | `docs/backlog.md` | profileScreen.ts |
| REFM-11 | ✅ | proto | `docs/backlog.md` | corpScreen.ts |
| REFM-12 | ✅ | proto | `docs/backlog.md` | chatWindow.ts |
| UI-RES | ✅ | proto | `docs/backlog.md` | Единая семья иконок ресурсов + «сколько не хватает». |
| REFM-13 | ✅ | proto | `docs/backlog.md` | «Верфь» |
| REFM-14 | ✅ | proto | `docs/backlog.md` | «Штаб героев» |
| REFM-15 | ✅ | proto | `docs/backlog.md` | Конверсации |
| REFM-16 | ✅ | proto | `docs/backlog.md` | prefs.ts — клиентские настройки одним правилом. |
| REFM-17 | ✅ | proto | `docs/backlog.md` | sideColors.ts — цвет стороны: одна палитра, два |
| REFM-18 | ✅ | proto | `docs/backlog.md` | Выбор совета учёных |
| REFM-19 | ✅ | proto | `docs/backlog.md` | Сброс пароля |
| REFM-20 | ✅ | proto | `docs/backlog.md` | Экран итогов матча |
| REFM-21 | ✅ | proto | `docs/backlog.md` | Графические настройки |
| REFM-22 | ✅ | proto | `docs/backlog.md` | Оверлей настроек |
| REFM-23 | ✅ | proto | `docs/backlog.md` | Самообновление APK |
| REFM-24 | ✅ | proto | `docs/backlog.md` | Вьюпорт и звёздный фон |
| REFM-25 | ✅ | proto | `docs/backlog.md` | Витрина меток провинций |
| REFM-26 | ✅ | proto | `docs/backlog.md` | Соло-драйверы |
| REFM-27 | ✅ | proto | `docs/backlog.md` | Конец матча и награда |
| REFM-28 | ✅ | proto | `docs/backlog.md` | Окна краденой разведки |
| REFM-29 | ✅ | proto | `docs/backlog.md` | Политика оповещений и радарная память |
| REFM-30 | ✅ | proto | `docs/backlog.md` | Сравнение дипломатии снимков |
| REFM-31 | ✅ | proto | `docs/backlog.md` | Ход стройки |
| REFM-32 | ✅ | proto | `docs/backlog.md` | Клиентская очередь стройки |
| REFM-33 | ✅ | proto | `docs/backlog.md` | Геометрия ввода |
| REFM-34 | ✅ | proto | `docs/backlog.md` | Геометрия фигур карты |
| REFM-35 | ✅ | proto | `docs/backlog.md` | Кирпичики боковой панели |
| REFM-36 | ✅ | proto | `docs/backlog.md` | Конвейер стройки |
| REFM-37 | ✅ | proto | `docs/backlog.md` | Сводка армии |
| REFM-38 | ✅ | proto | `docs/backlog.md` | Сводка мира |
| REFM-39 | ✅ | proto | `docs/backlog.md` | Выбор карточки панели |
| REFM-40 | ✅ | proto | `docs/backlog.md` | Карточка флота: пулы и порог хромоты из одного места |
| REFM-41 | ✅ | proto | `docs/backlog.md` | Вкладки карточки мира |
| REFM-42 | ✅ | proto | `docs/backlog.md` | Плитка каталога и замок повторного заказа |
| REFM-43 | ✅ | proto | `docs/backlog.md` | Память разведки |
| REFM-44 | ✅ | proto | `docs/backlog.md` | Раскладка мест сетапа |
| REFM-45 | ✅ | proto | `docs/backlog.md` | Мини-карта экрана сетапа |
| UI-BLD | ✅ | proto | `docs/backlog.md` | Плитки зданий и ряд скорости на телефоне |
| UI-BLD2 | ✅ | proto | `docs/backlog.md` | Построенные здания — снова списком в столбик |
| REFM-46 | ✅ | proto | `docs/backlog.md` | Хранение сессии |
| REFM-47 | ✅ | proto | `docs/backlog.md` | Правила учётных данных и разбор ответов auth |
| REFM-48 | ✅ | proto | `docs/backlog.md` | Обмен сессии на место в матче |
| REFM-49 | ✅ | proto | `docs/backlog.md` | Выбор дома при входе в матч |
| REFM-50 | ✅ | proto | `docs/backlog.md` | Строка обозревателя матчей |
| REFM-51 | ✅ | proto | `docs/backlog.md` | Отложенный вход в матч |
| REFM-52 | ✅ | proto | `docs/backlog.md` | Форма регистрации и подсказка позывного |
| REFM-53 | ✅ | proto | `docs/backlog.md` | Зеркало опыта командующего |
| REFM-54 | ✅ | proto | `docs/backlog.md` | Припуск камеры под открытой панелью |
| REFM-55 | ✅ | proto | `docs/backlog.md` | Разбор нажатия на карту |
| REFM-56 | ✅ | proto | `docs/backlog.md` | Стартовый вид карты |
| REFM-57 | ✅ | proto | `docs/backlog.md` | Сборка окна войны |
| REFM-58 | ✅ | proto | `docs/backlog.md` | Очередь «штурм по прилёте» |
| REFM-59 | ✅ | proto | `docs/backlog.md` | Порядок подтверждения войны и марш по лейну |
| REFM-60 | ✅ | proto | `docs/backlog.md` | Решение о перепечке статического слоя |
| REFM-61 | ✅ | proto | `docs/backlog.md` | Семена политической карты и её рамка |
| REFM-62 | ✅ | proto | `docs/backlog.md` | Уровень видимости узла под туманом |
| REFM-63 | ✅ | proto | `docs/backlog.md` | Источники радарного покрытия |
| REFM-64 | ✅ | proto | `docs/backlog.md` | Приоритет тапа по карте |
| REFM-65 | ✅ | proto | `docs/backlog.md` | Выбор под тапом и перебор стопки |
| REFM-66 | ✅ | proto | `docs/backlog.md` | Точка плана: прицел и вид точки |
| REFM-67 | ✅ | proto | `docs/backlog.md` | Время в пути с форс-маршем |
| REFM-68 | ✅ | proto | `docs/backlog.md` | Способности героя-флагмана |
| REFM-69 | ✅ | proto | `docs/backlog.md` | Якорь DOM над точкой карты |
| REFM-70 | ✅ | proto | `docs/backlog.md` | Жизнь экранной вспышки |
| REFM-71 | ✅ | proto | `docs/backlog.md` | Раскладка плана на карте |
| REFM-72 | ✅ | proto | `docs/backlog.md` | Пульс метки и сонарные кольца |
| REFM-73 | ✅ | proto | `docs/backlog.md` | Отбор и группировка планов (◎-бейджи) |
| REFM-74 | ✅ | proto | `docs/backlog.md` | Политика брифинга возвращения |
| REFM-75 | ✅ | proto | `docs/backlog.md` | Размещение подсказок и политика удержания |
| REFM-76 | ✅ | proto | `docs/backlog.md` | Арифметика деления флота |
| REFM-77 | ✅ | proto | `docs/backlog.md` | Живые числа панели — свести к одной формуле |
| REFM-78 | ✅ | proto | `docs/backlog.md` | Доступность командных кнопок |
| REFM-79 | ✅ | proto | `docs/backlog.md` | Состояние полоски режима «Приказ» |
| REFM-80 | ✅ | proto | `docs/backlog.md` | Жизнь долгого нажатия |
| REFM-81 | ✅ | proto | `docs/backlog.md` | Источники ⇅-меню десанта |
| REFM-82 | ✅ | proto | `docs/backlog.md` | Досье под указателем |
| REFM-83 | ✅ | proto | `docs/backlog.md` | Подъём камеры из-под нижнего листа |
| REFM-84 | ✅ | proto | `docs/backlog.md` | Время жизни всплывающих меню командного ряда |
| REFM-85 | ✅ | proto | `docs/backlog.md` | Быстрый заказ стройки правым кликом |
| REFM-86 | ✅ | proto | `docs/backlog.md` | Видимость событий в журнале |
| REFM-87 | ✅ | proto | `docs/backlog.md` | Часы кадра: когда мир идёт и на сколько |
| REFM-88 | ✅ | proto | `docs/backlog.md` | Судьба вооружённого приказа при тапе |
| REFM-89 | ✅ | proto | `docs/backlog.md` | Пометки о долгах владельца |
| REFM-90 | ✅ | proto | `docs/backlog.md` | Условия кнопок ремонта |
| REFM-91 | ✅ | proto | `docs/backlog.md` | Предложения панели мира: столица и точка удержания |
| REFM-92 | ✅ | proto | `docs/backlog.md` | Предложение шпионажа на панели мира |
| REFM-93 | ✅ | proto | `docs/backlog.md` | Семантический зум карты: что растворяется на схеме |
| REFM-94 | ✅ | proto | `docs/backlog.md` | Геометрия орбитального кольца |
| REFM-95 | ✅ | proto | `docs/backlog.md` | Пунктирный маршрут идущего флота |
| REFM-96 | ✅ | proto | `docs/backlog.md` | Кто может стать радарной отметкой |
| REFM-97 | ✅ | proto | `docs/backlog.md` | Очередь часовой погрузки десанта |
| REFM-98 | ✅ | proto | `docs/backlog.md` | Постановка стоек: авто-штурм и дежурный вылет |
| REFM-99 | ✅ | proto | `docs/backlog.md` | Чем меряется прогресс первых целей ONB-7 |
| REFM-100 | ✅ | proto | `docs/backlog.md` | Когда приказ поднимает обучающую вставку ONB-3 |
| REFM-101 | ✅ | proto | `docs/backlog.md` | Как сообщение попадает в журнал матча |
| REFM-102 | ✅ | proto | `docs/backlog.md` | Что теряет силу, когда состояние сменилось |
| REFM-103 | ✅ | proto | `docs/backlog.md` | Видимость ФЛОТА под туманом |
| REFM-104 | ✅ | proto | `docs/backlog.md` | Когда песочница возвращает ресурсы за стройку |
| REFM-105 | ✅ | proto | `docs/backlog.md` | Всплывающее уведомление над картой |
| REFM-106 | ✅ | proto | `docs/backlog.md` | Какие миры обводятся при взведённом ШТУРМЕ |
| REFM-107 | ✅ | proto | `docs/backlog.md` | Догоняющее слияние флотов |
| REFM-108 | ✅ | proto | `docs/backlog.md` | Переход камеры к точке карты |
| REFM-109 | ✅ | proto | `docs/backlog.md` | Дальномер выбранного мира |
| REFM-110 | ✅ | proto | `docs/backlog.md` | Координатная сетка фона |
| REFM-111 | ✅ | proto | `docs/backlog.md` | Расписание баллистического залпа |
| REFM-112 | ✅ | proto | `docs/backlog.md` | Два тира зенитного огня |
| REFM-113 | ✅ | proto | `docs/backlog.md` | Послесвечение радарной развёртки |
| REFM-114 | ✅ | proto | `docs/backlog.md` | У каких узлов есть орбитальное кольцо |
| REFM-115 | ✅ | proto | `docs/backlog.md` | Из чего складывается эмблема флота |
| REFM-116 | ✅ | proto | `docs/backlog.md` | Читаемая вместимость трюмов флота. |
| REFM-117 | ✅ | proto | `docs/backlog.md` | Подпись узла на карте |
| REFM-117.1 | ✅ | proto | `docs/backlog.md` | Ветка «нет телеметрии» у подписи узла — МЁРТВЫЙ КОД. |
| REFM-118 | ✅ | proto | `docs/backlog.md` | Отметка боя на карте |
| REFM-119 | ✅ | proto | `docs/backlog.md` | Лучи радарной развёртки |
| REFM-120 | ✅ | proto | `docs/backlog.md` | Сводная граница видимости |
| REFM-120.1 | ✅ | proto | `docs/backlog.md` | Гейты «прозрачность > 0» и «толщина > 0» внутри тира — |
| REFM-121 | ✅ | proto | `docs/backlog.md` | Голографический бейдж типа провинции |
| REFM-122 | ✅ | proto | `docs/backlog.md` | Ряд значков построек под узлом |
| REFM-123 | ✅ | proto | `docs/backlog.md` | Дальность артиллерии рисовалась ДВАЖДЫ |
| REFM-124 | ✅ | proto | `docs/backlog.md` | Вспышка захвата строила клетку СВОЕЙ копией формул мозаики |
| REFM-125 | ✅ | proto | `docs/backlog.md` | Прицельное превью ловило узел СВОЕЙ копией радиуса захвата |
| REFM-126 | ✅ | proto | `docs/backlog.md` | Тап по мини-карте расстановки |
| REFM-126.1 | ✅ | proto | `docs/backlog.md` | Окно выбора совета учёных перекрывает мини-карту |
| REFM-127 | ✅ | proto | `docs/backlog.md` | Сеть путей большой карты рисовалась своим циклом |
| REFM-128 | ✅ | proto | `docs/backlog.md` | Точка на трассе под пальцем считалась своей геометрией |
| REFM-129 | ✅ | proto | `docs/backlog.md` | Модификаторы постера считались дважды, разными числами |
| REFM-130 | ✅ | proto | `docs/backlog.md` | Форма дуги осадного залпа считалась в кадровом цикле |
| REFM-131 | ✅ | proto | `docs/backlog.md` | У карты была СВОЯ КОПИЯ долгого нажатия |
| REFM-132 | ✅ | proto | `docs/backlog.md` | Перевод «дальность карты → пиксели» существовал в ПЯТИ |
| REFM-133 | ✅ | proto | `docs/backlog.md` | Поправки посадки применяла только ОДНА из двух коробок над |
| REFM-134 | ✅ | proto | `docs/backlog.md` | Обратный перевод «страница → холст» жил двумя копиями в |
| REFM-135 | ✅ | proto | `docs/backlog.md` | Панель и обработчики по-разному понимали, что такое |
| REFM-136 | ✅ | proto | `docs/backlog.md` | Перевод игрового времени в часы стоял ЧЕТЫРЬМЯ выражениями |
| REFM-137 | ✅ | proto | `docs/backlog.md` | «Дыхание» живых слоёв фазировалось четырьмя способами, и |
| REFM-138 | ✅ | proto | `docs/backlog.md` | Право вкладки хаба ходить в сеть стояло ПЯТЬЮ байт-в-байт |
| REFM-139 | ✅ | proto | `docs/backlog.md` | Разбор дипломатического клика стоял ДВАЖДЫ |
| REFM-140 | ✅ | proto | `docs/backlog.md` | Развилка «пустить в матч или послать на вход» стояла тремя |
| REFM-141 | ✅ | proto | `docs/backlog.md` | Связка приказов штурма была выписана дважды |
| REFM-142 | ✅ | proto | `docs/backlog.md` | Адрес дозвона в матч собирался прямо в connect() |
| REFM-143 | ✅ | proto | `docs/backlog.md` | Жизнь сетевого сокета разбиралась прямо в обработчиках |
| REFM-144 | ✅ | proto | `docs/backlog.md` | Приветственный снимок разбирался внутри connect() |
| REFM-145 | ✅ | proto | `docs/backlog.md` | Политика цикла переподключения стояла внутри |
| REFM-146 | ✅ | proto | `docs/backlog.md` | Разбор входящего снимка стоял хвостом внутри onSnapshot |
| REFM-147 | ✅ | proto | `docs/backlog.md` | Маршрут исходящего приказа стоял тремя ветвями внутри |
| REFM-148 | ✅ | proto | `docs/backlog.md` | Разбор ретранслированной строки ленты стоял двумя копиями |
| REFM-149 | ✅ | proto | `docs/backlog.md` | Развилка «куда показать отказ сервера» стояла лесенкой if-ов |
| REFM-150 | ✅ | proto | `docs/backlog.md` | Адреса запросов к серверу матчей собирались строкой в четырёх |
| REFM-151 | ✅ | proto | `docs/backlog.md` | «Что показать вместо списка матчей» стояло тремя вложенными |
| REFM-152 | ✅ | proto | `docs/backlog.md` | Что значит выбор места и во что превращается «Играть» |
| REFM-153 | ✅ | proto | `docs/backlog.md` | Когда переопрашивать список матчей и что писать в строку |
| REFM-154 | ✅ | proto | `docs/backlog.md` | Как клиент узнаёт, чем на этом сервере является позывной |
| REFM-155 | ✅ | proto | `docs/backlog.md` | Что окно выбора места показывает вместо списка домов |
| REFM-156 | ✅ | proto | `docs/backlog.md` | Что клиент кладёт в запрос к /auth и какой ответ считает |
| REFM-157 | ✅ | proto | `docs/backlog.md` | Чем кончается «в архив» / «вернуть» и что игрок при этом |
| REFM-158 | ✅ | proto | `docs/backlog.md` | Режим огня артиллерии |
| REFM-159 | ✅ | proto | `docs/backlog.md` | Жизнь и разметка окна «Разделить» |
| REFM-160 | ✅ | proto | `docs/backlog.md` | выносы по карте REFM-1, один кирпич = одна секция = один |
| REFM-161 | ✅ | proto | `docs/backlog.md` | Просьба выслать ссылку для сброса пароля |
| REFM-162 | ✅ | proto | `docs/backlog.md` | Как из набранного игроком получается адрес сервера |
| REFM-163 | ✅ | proto | `docs/backlog.md` | Что значит выделить флот и как выделение меняется по |
| REFM-164 | ✅ | proto | `docs/backlog.md` | Какие флоты попадают под тап по карте и в каком порядке |
| REFM-165 | ✅ | proto | `docs/backlog.md` | Что значит приказ «слить флоты» |
| REFM-166 | ✅ | proto | `docs/backlog.md` | Что происходит с выделением, когда тап выбрал объект |
| REFM-167 | ✅ | proto | `docs/backlog.md` | Что значит «штурмовать» для каждого флота группы |
| REFM-168 | ✅ | proto | `docs/backlog.md` | Что написано в запросе «объявить войну?» и что на его |
| REFM-169 | ✅ | proto | `docs/backlog.md` | «тревога „враг у ваших рубежей“: когда звенит и что говорит» |
| REFM-170 | ✅ | proto | `docs/backlog.md` | «сколько шума даёт флот и как далеко слышит мир» |
| REFM-171 | ✅ | proto | `docs/backlog.md` | «с каким запасом крыло встаёт на дежурство и что от него |
| REFM-172 | ✅ | proto | `docs/backlog.md` | «когда очередь мира пускает следующий заказ и когда сборный |
| REFM-173 | ✅ | proto | `docs/backlog.md` | «когда меню десанта открывается и чьи числа в него попадают» |
| REFM-174 | ✅ | proto | `docs/backlog.md` | «что игрок узнаёт о дипломатии и куда это попадает» |
| REFM-175 | ✅ | proto | `docs/backlog.md` | «что стройка сообщает игроку» (prototype/src/buildLog.ts + |
| REFM-176 | ✅ | proto | `docs/backlog.md` | «что „Хранитель“ сообщает при постановке, снятии и возврате |
| REFM-177 | ✅ | proto | `docs/backlog.md` | «шпионаж: кому адресовано событие и что оно говорит» |
| REFM-178 | ✅ | proto | `docs/backlog.md` | «куда рисовать вспышку залпа и сколько вспышек держать» |
| REFM-179 | ✅ | proto | `docs/backlog.md` | «что игрок узнаёт о бое» (prototype/src/battleLog.ts + |
| REFM-180 | ✅ | proto | `docs/backlog.md` | «военный счёт и ведомость потерь» (prototype/src/warTally.ts |
| REFM-181 | ✅ | proto | `docs/backlog.md` | «кому есть дело до флотских новостей» |
| REFM-182 | ✅ | proto | `docs/backlog.md` | «кому адресована дипломатия в СОЛО» |
| REFM-183 | ✅ | proto | `docs/backlog.md` | «подача списка первых целей и награда за него» |
| REFM-184 | ✅ | proto | `docs/backlog.md` | «что игрок узнаёт о приобретениях: мир и открытие» |
| REFM-185 | ✅ | proto | `docs/backlog.md` | «какие команды появляются в ряду, а какие просто гаснут» |
| REFM-186 | ✅ | proto | `docs/backlog.md` | «какая кнопка ряда горит и почему» |
| REFM-187 | ✅ | proto | `docs/backlog.md` | «кого можно взять целью взведённого приказа» |
| REFM-188 | ✅ | proto | `docs/backlog.md` | «когда лист перестраивается и что при этом нельзя потерять» |
| REFM-189 | ✅ | proto | `docs/backlog.md` | «кого зовут значки внимания и куда ложится цифра» |
| REFM-190 | ✅ | proto | `docs/backlog.md` | «как число на фишке ресурса говорит правду» |
| REFM-191 | ✅ | proto | `docs/backlog.md` | «живое положение игрока в верхней строке» |
| REFM-192 | ✅ | proto | `docs/backlog.md` | «служебное наложение: FPS, задержка и десинк» |
| REFM-193 | ✅ | proto | `docs/backlog.md` | «чем кадр даёт выйти из матча и начать заново» |
| REFM-194 | ✅ | proto | `docs/backlog.md` | «как часто живёт открытое окно и почему сроки разные» |
| REFM-195 | ✅ | proto | `docs/backlog.md` | «что гаснет от СОСЕДНЕЙ команды ряда» |
| REFM-196 | ✅ | proto | `docs/backlog.md` | «превью взведённого „Хода“: куда идёт линия и что она обещает» |
| REFM-197 | ✅ | proto | `docs/backlog.md` | «что карточка флота признаёт о его состоянии» |
| REFM-198 | ✅ | proto | `docs/backlog.md` | «что ЗНАЧИТ нажатие „Назад“» |
| REFM-199 | ✅ | proto | `docs/backlog.md` | «что означает ЕДУЩИЙ палец» |
| REFM-200 | ✅ | proto | `docs/backlog.md` | «что карточка пришвартованного флота ПРЕДЛАГАЕТ сделать» |
| REFM-201 | ✅ | proto | `docs/backlog.md` | «чей сейчас ход в переговорах» |
| REFM-202 | ✅ | proto | `docs/backlog.md` | «как подписано место в списке» + починка того, что подпись |
| MIG-1 | ✅ | cli proto | `docs/backlog.md` | Вход в сетевой матч переехал в /decisions. |
| MIG-2 | ✅ | cli srv | `docs/backlog.md` | Клиент ПОТРЕБЛЯЕТ переехавшее: вход, обзор, место, отказы. |
| MIG-3 | ✅ | cli | `docs/backlog.md` | HUD-модели наконец РИСУЮТСЯ, и интентов стало три. |
| MIG-4 | ✅ | cli proto | `docs/backlog.md` | Цепочка «приказ выделенному флоту» переехала в /decisions. |
| MIG-5 | ✅ | cli proto | `docs/backlog.md` | ВСЕ строители приказов переехали в /decisions — и клиент бросил свои копии. |
| MIG-6 | ✅ | cli proto | `docs/backlog.md` | Словарь ЖЕСТОВ переехал в /decisions — третья, последняя недостающая половина. |
| MIG-7 | ✅ | cli | `docs/backlog.md` | КНОПКИ: панель состава наконец отдаёт приказы, интентов стало семь. |
| MIG-8 | ✅ | cli core | `docs/backlog.md` | ПАНЕЛЬ МИРА: тап по миру перестал уходить в пустоту, интентов девять. |
| MIG-9 | ✅ | cli | `docs/backlog.md` | ДЕЛЕНИЕ и СЛИЯНИЕ флотов: интентов одиннадцать. |
| MIG-10 | ✅ | cli proto | `docs/backlog.md` | Ворота стройки: зеркало заменено решением. |
| AUD-1 | ✅ | cli | `docs/backlog.md` | клиент собирал 11 фрагментов из 18. |
| AUD-2 | ✅ | srv core | `docs/backlog.md` | фог-роутинг событий не покрыт тестом. |
| AUD-11 | ✅ | core | `docs/backlog.md` | effect.applied всегда называет адресата. |
| AUD-15 | ✅ | srv | `docs/backlog.md` | сканер фог-контракта больше не слеп к комментариям. |
| AUD-3 | ✅ | data | `docs/backlog.md` | 28 непереводимых имён игровых данных вычищены. |
| AUD-4 | ✅ | proto | `docs/backlog.md` | гейт локализации увидел шипнутый контент. |
| AUD-14 | ✅ | proto | `docs/backlog.md` | имена домов доезжают до игрока переводом. |
| AUD-12 | ✅ | proto | `docs/backlog.md` | шапка досье героя больше не показывает игроку сам ключ. |
| AUD-13 | ✅ | core proto | `docs/backlog.md` | hero.name — отображаемый текст, вшитый в |
| AUD-5 | ✅ | core | `docs/backlog.md` | экспортирован runUntil(kernel, state, ctx, opts?). |
| AUD-6 | ✅ | core | `docs/backlog.md` | actionPayloadSchemas и CLIENTACTIONTYPES публичны. |
| AUD-7 | ✅ | proto | `docs/backlog.md` | SELFPLAYJSON отдаёт всё, что печатает человеку. |
| AUD-8 | 🗑 | proto | `docs/backlog.md` | сведён в CONV-12 |
| AUD-9 | ✅ | sec | `docs/backlog.md` | merge-queue выбрасывал PR с CIFAILURE при зелёном коде. |
| AUD-10 | ✅ | sec | `docs/backlog.md` | зелёный PR не вставал в очередь: у автомержа один шанс, и он |
| AUD-16 | ✅ | proto | `docs/backlog.md` | Герой больше не гибнет молча. |
| AUD-17 | ✅ | proto | `docs/backlog.md` | Корабельное ПВО стало видно. |
| AUD-18 | ✅ | core | `docs/backlog.md` | Сняты наследные hero.move и planet.annihilate — второй |
| AUD-19 | ✅ | docs | `docs/backlog.md` | Сводка решений ГДД (п. 8) описывала артиллерию, |
| AUD-20 | ⏳ | srv proto | `docs/backlog.md` | Адаптация Роя (AD-01) не подключена ни к одному живому |
| AUD-21 | ⏳ | docs proto | `docs/backlog.md` | Цвета редкости героя (HERO-12) расходятся с решением |
| AUD-22 | ⏳ | data | `docs/backlog.md` | Пустые покупки в дереве навыков. |
| AUD-23 | ✅ | proto cli | `docs/backlog.md` | Разрыв кадра выигрывал главу без боя. |
| AUD-24 | ✅ | proto cli | `docs/backlog.md` | «Продолжить» на втором устройстве стирало |
| AUD-25 | ✅ | proto | `docs/backlog.md` | Двойной тап на экране подготовки — два ролика. |
| AUD-26 | ✅ | cli | `docs/backlog.md` | Лут забега выбирался прокруткой попыток. |
| FSPLIT-1 | ✅ | core act proto | `docs/backlog.md` | Отбор при делении адресует СТЕК, а не тип корабля. |
| FSPLIT-2 | ✅ | core act proto | `docs/backlog.md` | Десант делится вместе с кораблями, по трюму обеих половин. |
| AIDIFF-1 | ✅ | proto | `docs/backlog.md` | Строка места переключается «выкл → слабый → сильный». |
| RESIL-1 | ✅ | proto | `docs/backlog.md` | Фоновые промисы браузерного клиента. |
| RESIL-2 | ✅ | proto | `docs/backlog.md` | Цикл подсветки обучающего тура. |
| RESIL-3 | ✅ | srv | `docs/backlog.md` | Именованный фатал процесса. |
| RESIL-4 | ✅ | srv | `docs/backlog.md` | Соак проверяет, что мир не встал. |
| RESIL-5 | ✅ | srv proto | `docs/backlog.md` | Генеральная репетиция: весь стек разом, и |
| RESIL-6 | ✅ | srv proto | `docs/backlog.md` | Достоверность генералки: настоящая база, |
| ADDR-7 | ✅ | sec proto | `docs/backlog.md` | Ссылка на партию не пускает по незнанию: |
| OPS-2 | ✅ | ops sec | `docs/backlog.md` | Обновление доносит до машины новые ключи |
| REL-6 | ✅ | srv | `docs/backlog.md` | Возврат на своё место мгновенный: перехват вместо |
| CMB-4 | ✅ | core | `docs/backlog.md` | Первый раунд боя — на самой встрече, а не через |
| BLD-1 | ✅ | core proto | `docs/backlog.md` | Очередь строительства: заказы встают в |
| UI-14 | ✅ | proto | `docs/backlog.md` | Осмотр чужого флота должен быть находимым. |
| CMB-5 | ✅ | core | `docs/backlog.md` | Вражда началась — стоящие рядом флоты сходятся |
| ATK-1 | ✅ | proto | `docs/backlog.md` | Кнопка «Атака» и честный гейт кнопки ШТУРМ. |
| SHIPART-1 | ✅ | proto cli | `docs/backlog.md` | Реалистичные портреты в постройке и описаниях, |
| SHIPART-2 | ✅ | cli proto | `docs/backlog.md` | Десантный корабль — в десантной семье |
| HEROART-1 | ✅ | proto cli | `docs/backlog.md` | Портреты, досье и читаемый счёт флота |
| YARD-1 | ✅ | data proto srv | `docs/backlog.md` | Корабли строит ВЕРФЬ, челноки — |
| YARD-2 | ✅ | data | `docs/backlog.md` | У верфи два яруса: дешёвый строит, дорогой |
| CMB-7 | ✅ | core | `docs/backlog.md` | Перемирие посреди боя не останавливало бой. |
| RLY-1 | ✅ | proto | `docs/backlog.md` | Сбор построенного: соло и сеть играли по РАЗНЫМ |
| CARGO-1 | ✅ | core proto | `docs/backlog.md` | Часовая погрузка десанта жила в |
| MRG-1 | ✅ | core proto | `docs/backlog.md` | «Слиться по прибытии» — вторая половина |
| ART-0 | ✅ | core data proto | `docs/backlog.md` | Артиллерия снята из игры целиком |
| ORB-1 | ✅ | core data proto | `docs/backlog.md` | Орбитальный слой объявлен в |
| ORB-4 | ✅ | core data proto | `docs/backlog.md` | в астероидном поле строилось всё, что угодно: |
| ORB-2 | ✅ | data proto | `docs/backlog.md` | «Изучается технология, строится здание» не |
| ORB-3 | ✅ | proto | `docs/backlog.md` | Звёздный форт выдавал орбитальное ПКО мимо |
| CMB-6 | ✅ | core | `docs/backlog.md` | После ничьей третий враждебный флот получает свой |
| ORD-2 | ✅ | proto | `docs/backlog.md` | Нацеленный ШТУРМ теперь переживает закрытую |
| FOG-10 | ✅ | proto core | `docs/backlog.md` | Память разведки перестала жить только |
| FOG-9 | ✅ | core | `docs/backlog.md` | Приостановленная стройка чужого мира была видна |
| TEST-4 | ✅ | srv | `docs/backlog.md` | topXp падал на живой базе разработчика. |
| PHONE-STRATEGY | ✅ |  | `docs/backlog.md` | Технологии, постройки, производство, рынок и дипломатия |
| MAP-PERF | ✅ |  | `docs/backlog.md` | Ускорение движения раскрытой голографической карты и подготовка |
| PERK-0.1 | ✅ | docs | `docs/backlog.md` | Резолюция владельца: два класса бонусов + третья группа |
| PERK-1.1 | ✅ | core | `docs/backlog.md` | Три группы вместо одной цепочки. |
| PERK-1.2 | ✅ | core | `docs/backlog.md` | Массовые перки переехали в параллельную корзину — |
| PERK-2.1 | ✅ | core | `docs/backlog.md` | Снижение урона: один пул, одна форма, один кап. |
| PERK-3.1 | ✅ | core data | `docs/backlog.md` | Последовательный множитель выдаётся за |
| PERK-3.3 | ✅ | core cli proto | `docs/backlog.md` | Надбавка ветерана стала видимой: |
| PERK-3.2 | ✅ | core | `docs/backlog.md` | Случайный промоушен: редкая партия выходит |
| OBJP-1 | ✅ | proto | `docs/backlog.md` | Значок боя наконец открывает окно, а окно даёт |
| OBJP-2 | ✅ | proto | `docs/backlog.md` | Подробности объекта встают РЯДОМ с карточкой, а не |
| OBJP-3 | ✅ | proto | `docs/backlog.md` | Каталог юнитов уехал в окно производства — туда же, |
| CMD-VIS-2 | ✅ | proto | `docs/backlog.md` | Кнопка штурма появляется только когда есть кем |
| EVT-1 | ✅ | core data proto | `docs/backlog.md` | Тёмные события наконец видны игроку, |
| EVT-2 | ✅ | core data proto | `docs/backlog.md` | Трофеи за бой: победитель |
| EVT-3 | ✅ | core data | `docs/backlog.md` | Пассивка героя «мародёр»: лестница из пяти |
| RETR-1 | ✅ | core | `docs/backlog.md` | Отступление получило ТОЧКУ: уводит, а не только |
| RETR-2 | ✅ | core srv proto | `docs/backlog.md` | Авто-отступление: порог по остатку |
| RETR-3 | ✅ | proto | `docs/backlog.md` | Авто-отход в интерфейсе, проверенный браузером. |
| TXT-0.1 | ✅ | docs | `docs/backlog.md` | Канон формулировок: записать правило и эталон, пока чистка не |
| TXT-1 | ⏳ | proto | `docs/backlog.md` | Досье зданий: 14 ключей, 2505 симв., проза вместо |
| TXT-2 | ⏳ | proto | `docs/backlog.md` | Досье юнитов: 10 ключей, 3046 симв. — самый раздутый домен |
| TXT-3 | ⏳ | proto | `docs/backlog.md` | Тавтологии и дубли в досье — чистая вырезка, самый дешёвый |
| TXT-4 | ⏳ | proto | `docs/backlog.md` | Герои: описание способности не называет величину — 10 из |
| TXT-5 | ⏳ | proto | `docs/backlog.md` | Онбординг: 36 ключей, 5019 симв. — учит законно, но |
| TXT-6 | ✅ | proto | `docs/backlog.md` | Кодекс: 7 статей, средн. 187 симв. — тренерский хвост в |
| TXT-7 | 🔒 | proto docs | `docs/backlog.md` | Сторож в гейте: чтобы вода не вернулась. |
| UX-SEL-1 | 🗑 | proto | `docs/backlog.md` | На ПК выделять рамкой обычным ЛКМ — снято решением |
| UX-KEYS-1 | ✅ | proto | `docs/backlog.md` | Раздел «Управление» в настройках: какие клавиши и жесты есть. |
| UX-SET-1 | ✅ | proto | `docs/backlog.md` | Окно настроек — вкладками: Звук · Графика · Карта · Управление. |
| ROS-SUP-1 | ✅ | proto data | `docs/backlog.md` | Корабли поддержки — своей вкладкой. |
| SIEGE-1 | ✅ | data proto | `docs/backlog.md` | Юнита siege в игре нет, урон по постройкам — модулем. |
| BRWH-1 | ✅ | proto docs | `docs/backlog.md` | Три рабочих харнеса получили команды, каталог |
| BRWH-2 | ✅ | proto | `docs/backlog.md` | Четыре сгнивших харнеса починены — и два из них ловили |
| BRWH-3 | ✅ | proto docs | `docs/backlog.md` | Общая база харнесов и снимок экрана одной |
| BRWH-4 | ✅ | proto | `docs/backlog.md` | Штурм через «Ещё» снова под браузерной проверкой. |
| AC-0.1 | ✅ | srv data | `docs/accounts-roadmap.md` | Сущность Account + связь с Player |
| AC-0.2 | ⏳ | srv | `docs/accounts-roadmap.md` | Сессии и refresh |
| AC-0.3 | 🔒 | srv data | `docs/accounts-roadmap.md` | Уровень/опыт аккаунта |
| AC-1.1 | ⏳ | srv sec | `docs/accounts-roadmap.md` | OAuth/OIDC-вход |
| AC-1.2 | ⏳ | srv sec | `docs/accounts-roadmap.md` | Email magic-link (без пароля) |
| AC-1.3 | 🔒 | srv sec | `docs/accounts-roadmap.md` | JWT для WS-рукопожатия |
| AC-2.1 | 🔒 | srv | `docs/accounts-roadmap.md` | Привязка нескольких identity к аккаунту |
| AC-2.2 | 🔒 | srv sec | `docs/accounts-roadmap.md` | Восстановление доступа и защита от захвата |
| AC-2.3 | ⏳ | srv docs | `docs/accounts-roadmap.md` | Приватность аккаунта (GDPR-база) |
| ARS-0 | ✅ | docs | `docs/arsenal-roadmap.md` | Развилки за владельцем — решено (2026-07-14) |
| ARS-1 | ✅ | data core | `docs/arsenal-roadmap.md` | Схема предмета/чертежа — реализовано |
| ARS-2 | ✅ | srv | `docs/arsenal-roadmap.md` | ArsenalStore + стартовый набор — реализовано |
| ARS-3 | ✅ | srv | `docs/arsenal-roadmap.md` | Снапшот в матч — реализовано |
| ARS-4 | ✅ | srv | `docs/arsenal-roadmap.md` | Источники: дроп по месту + сальваж — реализовано |
| ARS-5 | ✅ | proto srv | `docs/arsenal-roadmap.md` | UI: витрина + фильтр Верфи — реализовано |
| ARS-6 | ✅ | srv | `docs/arsenal-roadmap.md` | Корп-склад + аренда — реализовано |
| AVA-1 | ✅ | srv core | `docs/ava-lifecycle-roadmap.md` | Командная дипломатия на серверном пути [srv/core] — реализовано |
| AVA-2 | ✅ | srv | `docs/ava-lifecycle-roadmap.md` | Очки влияния корпорации |
| AVA-3 | ✅ | srv | `docs/ava-lifecycle-roadmap.md` | Флаги готовности к AvA |
| AVA-4 | ✅ | srv | `docs/ava-lifecycle-roadmap.md` | Вызов / принятие (S0→S2) |
| AVA-5 | ✅ | core data | `docs/ava-lifecycle-roadmap.md` | Пул AvA-карт + eligibility [core/data] — реализовано |
| AVA-6 | ✅ | srv | `docs/ava-lifecycle-roadmap.md` | Сбор ростера + лок (S3) — реализовано |
| AVA-7 | ✅ | srv | `docs/ava-lifecycle-roadmap.md` | Оркестратор: создание сессии (S4) ★ — реализовано |
| AVA-8 | ✅ | srv | `docs/ava-lifecycle-roadmap.md` | Мир → война → итог (S5–S7) ★ — реализовано |
| AVA-9 | ✅ | srv | `docs/ava-lifecycle-roadmap.md` | Публичная лента корпораций — реализовано |
| CC-0.1 | ✅ | core data | `docs/command-chains-roadmap.md` | Схема цепочки + каталог блоков (частично, прототип) |
| CC-0.2 | ✅ | docs core | `docs/command-chains-roadmap.md` | РЕШЕНИЕ: где исполняется |
| CC-1.1 | ✅ | core | `docs/command-chains-roadmap.md` | Завершение шага → следующий шаг (прототип) |
| CC-2.1 | ⏳ | core data | `docs/command-chains-roadmap.md` | Курируемые триггеры (сделаны: on-arrival, at-time, 🔁) |
| CC-3.1 | ⏳ | core data | `docs/command-chains-roadmap.md` | Ограниченные предикаты + повтор (повтор + стоячие приказы ) |
| CC-4.1 | ⏳ | srv cli | `docs/command-chains-roadmap.md` | Итог/инцидент цепочки → лента + push (минимум ) |
| CC-5.1 | ✅ | core srv | `docs/command-chains-roadmap.md` | Лимиты + конфликт-резолюция (базово) |
| CC-6 | ✅ | core srv cli | `docs/command-chains-roadmap.md` | Лимит по ПРИКАЗАМ игрока + подписка |
| CC-5.2 | ⏳ |  | `docs/command-chains-roadmap.md` | Конструктор цепочек (клиент) (список-версия ) |
| CR-0.1 | ⏳ | core data | `docs/core-roadmap.md` | Версия данных/правил per-match + миграции |
| CR-0.2 | ✅ | core | `docs/core-roadmap.md` | Детерминированный реплей-тулинг 🚧 (ядро 2026-07-21) |
| CR-1.1 | ✅ | core data | `docs/core-roadmap.md` | Расширить FactionDef + данные |
| CR-1.2 | ✅ | core | `docs/core-roadmap.md` | factionModule: пассивы через хуки |
| CR-1.3 | ✅ | core | `docs/core-roadmap.md` | Сборка старта матча по фракции |
| CR-2.1 | ✅ | core | `docs/core-roadmap.md` | Память «последнего увиденного» |
| CR-2.2 | ⏳ | core data | `docs/core-roadmap.md` | Сенсорная/радарная дальность от зданий (частично) |
| CR-2.3 | ✅ | core | `docs/core-roadmap.md` | Разведка флотом + хелпер видимости |
| CR-3.1 | ✅ | core data | `docs/core-roadmap.md` | Предматчевый выбор технологий + бусты |
| CR-3.2 | ✅ | core | `docs/core-roadmap.md` | Состояние дипломатии |
| CR-3.3 | ✅ | core | `docs/core-roadmap.md` | diplomacyModule |
| CR-4.1 | ⏳ | core data | `docs/core-roadmap.md` | Движок трейтов (универсальный триггер→эффект) |
| CP0.1 | ✅ | cli | `docs/cross-platform-roadmap.md` | Каркас веб-клиента |
| CP0.2 | ⏳ | cli proto | `docs/cross-platform-roadmap.md` | Вынести рендер-слой из прототипа |
| CP0.3 | ✅ | cli core | `docs/cross-platform-roadmap.md` | Общий загрузчик данных |
| CP1.1 | ✅ | cli | `docs/cross-platform-roadmap.md` | Реальный WS-транспорт |
| CP1.2 | ✅ | cli proto | `docs/cross-platform-roadmap.md` | Снять локальную авторитетность |
| CP1.3 | 🔶 | cli | `docs/cross-platform-roadmap.md` | Интенты из UI |
| CP1.4 | ✅ | cli | `docs/cross-platform-roadmap.md` | Реконнект и резюме |
| CP2.1 | ✅ | cli | `docs/cross-platform-roadmap.md` | Web App Manifest |
| CP2.2 | ✅ | cli | `docs/cross-platform-roadmap.md` | Service Worker + app-shell |
| CP2.3 | ✅ | cli | `docs/cross-platform-roadmap.md` | Кэш снапшота (IndexedDB) |
| CP2.4 | ⏳ | cli | `docs/cross-platform-roadmap.md` | Install UX и Lighthouse-бюджет |
| CP2.5 | 🔒 | cli srv | `docs/cross-platform-roadmap.md` | Авто-обновление + force-update handshake |
| CP3.1 | 🔒 | cli | `docs/cross-platform-roadmap.md` | Предпросмотр-прогон |
| CP3.2 | 🔒 | cli | `docs/cross-platform-roadmap.md` | Сверка предпросмотр ↔ сервер |
| CP3.3 | 🔒 | cli | `docs/cross-platform-roadmap.md` | «Что будет, если…» |
| CP4.1 | 🔒 | cli | `docs/cross-platform-roadmap.md` | Интеграция Pixi v8 (слой карты) |
| CP4.2 | 🔒 | cli | `docs/cross-platform-roadmap.md` | Камера, culling, DPI |
| CP4.3 | 🔒 | cli | `docs/cross-platform-roadmap.md` | Off-thread рендер/симуляция (опц.) |
| CP4.4 | 🔒 | cli | `docs/cross-platform-roadmap.md` | Перф-бюджет в CI |
| CP5.1 | 🔒 | cli | `docs/cross-platform-roadmap.md` | Pointer vs touch |
| CP5.2 | 🔒 | cli | `docs/cross-platform-roadmap.md` | Жесты и хаптика |
| CP5.3 | 🔒 | cli | `docs/cross-platform-roadmap.md` | Адаптивные раскладки |
| CP6.1 | 🔒 | cli sec | `docs/cross-platform-roadmap.md` | Android TWA |
| CP6.2 | 🔒 | cli | `docs/cross-platform-roadmap.md` | iOS (и альт-Android) через Capacitor |
| CP6.3 | 🔒 | sec | `docs/cross-platform-roadmap.md` | CI-артефакты сборок |
| CP7.1 | ⏳ | cli | `docs/cross-platform-roadmap.md` | Web Push (браузеры / Android PWA) |
| CP7.2 | 🔒 | cli | `docs/cross-platform-roadmap.md` | iOS native push через Capacitor |
| CP7.3 | ⏳ |  | `docs/cross-platform-roadmap.md` | Серверные триггеры пушей [→F3] |
| EC-0.1 | ✅ | docs | `docs/economy-roadmap.md` | Жанровое решение — решено (см. «Зафиксированные решения» выше) |
| EC-0.2 | ✅ | docs | `docs/economy-roadmap.md` | Денежная модель на бумаге — решено (2026-07-19) |
| EC-0.3 | ✅ | docs sec | `docs/economy-roadmap.md` | RMT/фрод threat-model — решено (2026-07-19) |
| EC-0.4 | ⏳ | docs sec | `docs/economy-roadmap.md` | Юридический/сторовый ревью |
| EC-0.5 | ✅ | docs | `docs/economy-roadmap.md` | Зависимость от платформенного стека — решено (см. «Жёсткий гейт» выше) |
| EC-1.1 | ⏳ | data core | `docs/economy-roadmap.md` | Data-driven модель предметов/модулей/чертежей |
| EC-1.2 | ⏳ | srv | `docs/economy-roadmap.md` | Две валюты: серверный кошелёк |
| EC-1.3 | 🔒 | srv | `docs/economy-roadmap.md` | Персистентный инвентарь финансового качества |
| EC-2.1 | 🔒 | srv core | `docs/economy-roadmap.md` | Заточка: гарант низа + серверный RNG выше |
| EC-2.2 | 🔒 | srv data | `docs/economy-roadmap.md` | Осколки → сборка soulbound-модуля |
| EC-2.3 | 🔒 | srv cli | `docs/economy-roadmap.md` | Раскрытие шансов |
| EC-3.1 | 🔒 | srv sec | `docs/economy-roadmap.md` | Леджер аукциона |
| EC-3.2 | 🔒 | srv | `docs/economy-roadmap.md` | Листинг/покупка за рыночную валюту + комиссия-бёрн |
| EC-3.3 | ⏳ | srv sec | `docs/economy-roadmap.md` | Анти-абьюз рынка |
| EC-4.1 | 🔒 | srv sec | `docs/economy-roadmap.md` | Платежи/биллинг сторов |
| EC-4.2 | 🔒 | srv | `docs/economy-roadmap.md` | Бонусные варранты с покупки — осознанно |
| EC-4.3 | 🔒 | srv cli | `docs/economy-roadmap.md` | Подписка + косметика + донат-предметы (soulbound) |
| EC-5.1 | 🔒 | srv | `docs/economy-roadmap.md` | Экономическая телеметрия |
| EC-5.2 | 🔒 | data | `docs/economy-roadmap.md` | Балансные рычаги через данные (live-ops) |
| EC-6.1 | 🔒 | srv sec | `docs/economy-roadmap.md` | Детекция RMT-паттернов |
| EC-6.2 | 🔒 | srv docs | `docs/economy-roadmap.md` | Модерация торговли и споры |
| FORT-0.1 | 🗑 | data | `docs/fortress-roadmap.md` | Узлы empty в картах канона — снято 2026-09-15 |
| FORT-0.2 | ✅ | core proto | `docs/fortress-roadmap.md` | Крепость в прототипе: модуль, правило, кнопка |
| FORT-1.1 | 🗑 |  | `docs/fortress-roadmap.md` | Технический юнит + технология — снято 2026-09-15 |
| FORT-1.2 | 🗑 |  | `docs/fortress-roadmap.md` | Конверсия расходует техюнит — снято 2026-09-15 |
| FORT-1.3 | 🗑 |  | `docs/fortress-roadmap.md` | Вкладка технических юнитов в «Верфи» — снято 2026-09-15 |
| FORT-1.4 | ✅ | proto | `docs/fortress-roadmap.md` | Недостающие ключи отказов |
| FORT-2.1 | ✅ | data | `docs/fortress-roadmap.md` | Юнит «Гарнизон» |
| FORT-2.2 | ✅ | core data | `docs/fortress-roadmap.md` | Форт выдаёт и забирает гарнизон |
| FORT-2.3 | ✅ | data core | `docs/fortress-roadmap.md` | Потолок гарнизона и фракционный модификатор |
| FORT-3.1 | ✅ | data | `docs/fortress-roadmap.md` | Уровни зенитных батарей |
| FORT-3.2 | ✅ |  | `docs/fortress-roadmap.md` | Выполнен ЧУЖОЙ работой; остаток снят как противоречащий более позднему решению |
| FORT-4.1 | ✅ | core data | `docs/fortress-roadmap.md` | Какие ещё узлы конвертируются |
| FORT-5.1 | ✅ | data core | `docs/fortress-roadmap.md` | Технологию крепости надо ИЗУЧИТЬ |
| FORT-5.2 | ✅ | data core | `docs/fortress-roadmap.md` | Ядро крепости: starfort дорос до пяти уровней |
| FORT-5.3 | ✅ | core data | `docs/fortress-roadmap.md` | Слоты построек |
| FORT-5.4 | ✅ | core data | `docs/fortress-roadmap.md` | Крепость ВСТУПАЕТ В БОЙ |
| FORT-5.12 | ✅ | core data | `docs/fortress-roadmap.md` | Крепость под ударом: не обстреливают, и бой глушит работу |
| FORT-5.5 | ✅ | data core | `docs/fortress-roadmap.md` | Класс корпуса у кораблей |
| FORT-5.6 | ✅ | data | `docs/fortress-roadmap.md` | Верфь крепости: три уровня |
| FORT-5.7 | ✅ | data core | `docs/fortress-roadmap.md` | Ангар крепости |
| FORT-5.8 | ✅ | core | `docs/fortress-roadmap.md` | Док чинит СОЮЗНИКУ |
| FORT-5.9 | ✅ | core data | `docs/fortress-roadmap.md` | Госпиталь лечит ТРЮМ |
| FORT-5.10 | ✅ | core data | `docs/fortress-roadmap.md` | Щиты крепости |
| FORT-5.11 | ✅ | data | `docs/fortress-roadmap.md` | Технологии открывают постройки крепости |
| FORT-5.13 | ✅ | core | `docs/fortress-roadmap.md` | Сбитая крепость уничтожается |
| GI-0.1 | ✅ | srv sec | `docs/game-integrity-roadmap.md` | Rate-limiting действий |
| GI-0.2 | ⏳ | srv | `docs/game-integrity-roadmap.md` | Per-player очередь (анти-double-spend) |
| GI-0.3 | ✅ | srv | `docs/game-integrity-roadmap.md` | Туман как граница (анти-maphack) (в основном) |
| GI-1.1 | 🔒 | srv sec | `docs/game-integrity-roadmap.md` | Сигналы и метрики честности |
| GI-1.2 | 🔒 | sec | `docs/game-integrity-roadmap.md` | Алерты на аномалии |
| GI-1.3 | 🔒 | srv | `docs/game-integrity-roadmap.md` | Аудит-реплей подозрительного матча |
| GI-2.1 | ⏳ | srv sec | `docs/game-integrity-roadmap.md` | Анти-мультиаккаунт / связи |
| GI-2.2 | 🔒 | srv | `docs/game-integrity-roadmap.md` | Поведенческая bot-detection |
| GI-2.3 | 🔒 | srv core | `docs/game-integrity-roadmap.md` | Защита экономики/обменов |
| GI-3.1 | 🔒 | srv docs | `docs/game-integrity-roadmap.md` | Санкции и апелляции |
| GM-0.1 | ✅ | core data | `docs/game-modes-roadmap.md` | config.mode + реестр режимов |
| GM-0.2 | ⏳ | core | `docs/game-modes-roadmap.md` | Мульти-исход и приоритет |
| GM-0.3 | ⏳ | srv | `docs/game-modes-roadmap.md` | Выбор режима в лобби [client] |
| GM-1.1 | ✅ | data | `docs/game-modes-roadmap.md` | Пресет standard (score/domination/timeout) |
| GM-1.2 | ✅ | core | `docs/game-modes-roadmap.md` | Коалиционный порог очков (SES-1: реализовано и покрыто тестами) |
| GM-2.1 | ⏳ | core data | `docs/game-modes-roadmap.md` | Сущность столицы |
| GM-2.2 | 🔒 | core | `docs/game-modes-roadmap.md` | capitalModule: поражение по потере штаба |
| GM-2.3 | 🔒 |  | `docs/game-modes-roadmap.md` | UX столицы [client] |
| GM-3.1 | ⏳ | core data | `docs/game-modes-roadmap.md` | Контрольные точки в данных |
| GM-3.2 | 🔒 | core | `docs/game-modes-roadmap.md` | holdPointsModule: таймеры удержания |
| GM-3.3 | 🔒 |  | `docs/game-modes-roadmap.md` | UX точек и прогресса [client] |
| GM-4.5 | 🔶 | core | `docs/game-modes-roadmap.md` | Командные варианты (2v2v2 / фракционные блоки) |
| GM-4.6 | ✅ |  | `docs/game-modes-roadmap.md` | Кооп против ИИ (PvE «волны») [core+data] |
| GM-4.7 | 🔒 | srv | `docs/game-modes-roadmap.md` | Связка с метой (AvA как режим) — Контур 2 |
| HC-0.1 | ✅ | docs | `docs/hero-collection-roadmap.md` | Откуда берутся слоты: архетип или редкость 2026-09-07 |
| HC-1.1 | 🗑 | core | `docs/hero-collection-roadmap.md` | Ядро применяет слоты по редкости — перенесено в HPR-1.1/HPR-1.2 |
| HC-1.2 | ⏳ | core data | `docs/hero-collection-roadmap.md` | Герой как пустая болванка |
| HC-1.3 | 🔒 | data core | `docs/hero-collection-roadmap.md` | Предрасположенность |
| HC-1.4 | ⏳ | core data | `docs/hero-collection-roadmap.md` | Губернатор и наземный герой |
| HC-2.1 | 🔒 | srv data | `docs/hero-collection-roadmap.md` | Способности как предметы инвентаря |
| HC-2.2 | 🔒 | srv | `docs/hero-collection-roadmap.md` | Герой как собственность аккаунта |
| HC-2.3 | 🔒 | srv data | `docs/hero-collection-roadmap.md` | Детальки → повышение редкости |
| HC-2.4 | 🔒 | srv | `docs/hero-collection-roadmap.md` | Герои и детальки на аукционе |
| HC-3.1 | ✅ | data | `docs/hero-collection-roadmap.md` | Пассив «скорость флота в радиусе» 2026-09-07 |
| HC-3.2 | ✅ | core data | `docs/hero-collection-roadmap.md` | Варп-прыжок: hero.effect.jump 2026-09-07 |
| HC-3.3 | ✅ | core data | `docs/hero-collection-roadmap.md` | Фантомный радарный сигнал 2026-09-07 |
| HC-3.4 | ⏳ | core data | `docs/hero-collection-roadmap.md` | «Опытный командир»: юниты союзника под управление |
| HPR-0.1 | ✅ | docs | `docs/hero-progression-roadmap.md` | Кому принадлежат звёзды: только главному или всем 2026-09-07 |
| HPR-0.2 | ✅ | docs | `docs/hero-progression-roadmap.md` | Ресурс прогрессии: что это, откуда берётся, куда уходит |
| HPR-0.3 | ⏳ | docs data | `docs/hero-progression-roadmap.md` | Лестница редкости скилла и её ЦВЕТА |
| HPR-0.4 | 🔒 | docs sec | `docs/hero-progression-roadmap.md` | Заточка скиллов включена в лутбокс-ревью |
| HPR-1.1 | ⏳ | core data | `docs/hero-progression-roadmap.md` | Четвёртая редкость, main вон из лестницы, слоты ОТ РЕДКОСТИ |
| HPR-1.2 | ✅ | core | `docs/hero-progression-roadmap.md` | Ядро применяет бюджет слотов скиллов 2026-09-07 |
| HPR-1.3 | 🔒 | core data | `docs/hero-progression-roadmap.md` | Звёзды: поле и слот |
| HPR-1.4 | 🔒 | proto | `docs/hero-progression-roadmap.md` | Витрина редкости и звёзд в штабе героев |
| HPR-1.5.1 | ✅ | data | `docs/hero-progression-roadmap.md` | Корабль героя берёт обычные модули 2026-09-08 |
| HPR-1.5.2 | ✅ | core | `docs/hero-progression-roadmap.md` | Лоадаут корабля живёт на герое 2026-09-08 |
| HPR-1.5.3 | ✅ | data | `docs/hero-progression-roadmap.md` | Два «скилла в обёртке» переезжают в скиллы 2026-09-08 |
| HPR-1.5.4 | ✅ | core proto | `docs/hero-progression-roadmap.md` | Снос hero.fit и вкладки фиттингов 2026-09-08 |
| HPR-1.6.1 | ⏳ | core data | `docs/hero-progression-roadmap.md` | Гейты переоснащения для скиллов И модулей |
| HPR-1.6.2 | 🔒 | proto | `docs/hero-progression-roadmap.md` | Экран переоснащения говорит, ГДЕ и ПОЧЁМ |
| HPR-2.1 | 🔒 | data core | `docs/hero-progression-roadmap.md` | Редкость у СКИЛЛА — поле и лестница |
| HPR-2.2 | 🔒 | srv data | `docs/hero-progression-roadmap.md` | heroskill как вид предмета арсенала |
| HPR-2.3 | 🔒 | srv | `docs/hero-progression-roadmap.md` | Дубликаты: инвентарь умеет считать количество |
| HPR-2.4 | 🔒 | data srv | `docs/hero-progression-roadmap.md` | Скиллы и дубликаты в пуле дропа |
| HPR-3.1 | 🔒 | data core | `docs/hero-progression-roadmap.md` | Уровень скилла: данные и кривая |
| HPR-3.2 | 🔒 | srv | `docs/hero-progression-roadmap.md` | Заточка скилла на движке EC-2.1 |
| HPR-3.3 | 🔒 | core srv | `docs/hero-progression-roadmap.md` | Уровень доезжает в матч через снапшот |
| HPR-3.4 | 🔒 | srv cli | `docs/hero-progression-roadmap.md` | Сток, раскрытие шансов и честный UI |
| HPR-4.1 | ⏳ | srv data | `docs/hero-progression-roadmap.md` | Ресурсы прогрессии: кран и сток |
| HPR-4.2 | 🔒 | srv cli | `docs/hero-progression-roadmap.md` | Ритуал повышения звезды |
| HTTPS-0.1 | ⏳ | docs | `docs/https-roadmap.md` | Зафиксировать «TLS терминирует прокси» как стандарт — S → SE-1.2 |
| HTTPS-1.1 | ✅ | srv sec | `docs/https-roadmap.md` | Доверие прокси: X-Forwarded-Proto/Host + Origin — M → SE-6.1, SE-1.2 |
| HTTPS-1.2 | ⏳ | srv | `docs/https-roadmap.md` | (Опц.) In-process TLS как запасной путь — S → SE-1.2 |
| HTTPS-2.1 | ✅ | ops sec | `docs/https-roadmap.md` | Caddy/Nginx-пример с ACME перед сервером (код; домен — deploy-time вход) — M → SE-1.2 |
| HTTPS-2.2 | ✅ | ops sec | `docs/https-roadmap.md` | Жизненный цикл сертификата (авто-продление + staging via Caddy) / (мониторинг истечения) — S → SE-1… |
| HTTPS-3.1 | ✅ | ops | `docs/https-roadmap.md` | Render: зафиксировать https-инвариант (работает) / (формализация) — S → SE-1.2 |
| HTTPS-3.2 | ✅ | ops sec | `docs/https-roadmap.md` | Cloudflare/туннель: TLS на крае + скрытие origin (туннель) / (Cloudflare-перед-origin) — M → SE-1.1… |
| HTTPS-4.1 | ✅ | cli sec | `docs/https-roadmap.md` | wss по умолчанию + блок mixed-content (частично) / — S → SE-7.1 |
| HTTPS-4.2 | ⏳ | cli docs | `docs/https-roadmap.md` | Сообщения о URL: печатать https/wss |
| HTTPS-5.1 | 🔒 | cli sec | `docs/https-roadmap.md` | Убрать cleartext в release, отделить debug-LAN профиль — M → SE-7.2 |
| HTTPS-6.1 | ⏳ | srv docs | `docs/https-roadmap.md` | localhost остаётся ws, опц. mkcert для https-dev |
| HTTPS-7.1 | ⏳ | sec | `docs/https-roadmap.md` | Проверка «нет plaintext, TLS корректен» — S → SE-1.2 |
| LARS-0 | ✅ | docs | `docs/live-arsenal-roadmap.md` | Решение: живой билд-каталог — решено (2026-07-14) |
| LARS-1 | ✅ | core srv | `docs/live-arsenal-roadmap.md` | Живая авторизация постройки [core/srv] — реализовано |
| LARS-2 | 🔒 | srv | `docs/live-arsenal-roadmap.md` | Цепочка валют → живой фронт end-to-end |
| LARS-3 | ✅ | srv data | `docs/live-arsenal-roadmap.md` | Баланс и гайки честности [srv/data] — реализовано (частично осознанно) |
| LARS-4 | ✅ | proto | `docs/live-arsenal-roadmap.md` | UI: живая Верфь в матче — реализовано |
| M0.1 | ✅ | docs | `docs/map-roadmap.md` | Зафиксировать модель в дизайн-доках — |
| M0.2 | ✅ | core | `docs/map-roadmap.md` | Развести sectorType → terrain — |
| M1.1 | ✅ | data | `docs/map-roadmap.md` | Схема карты data/maps/.json — |
| M1.3 | ✅ | core | `docs/map-roadmap.md` | Валидация путей: только к соседям — |
| M2.1 | ✅ | core data | `docs/map-roadmap.md` | Виды секторов (kind) в данные — |
| M2.2 | ✅ | core | `docs/map-roadmap.md` | «Захват заходом» как правило ядра — |
| M2.3 | ✅ | core cli | `docs/map-roadmap.md` | Масштаб / вес сектора (планета = меньше) — (интерактивный ресайз — в M3.1) |
| M2.4 | ✅ | core data | `docs/map-roadmap.md` | Связность — свойство местности, а не координат — |
| M2.5 | ✅ | core data | `docs/map-roadmap.md` | Параллельные пути через провинцию — |
| M2.6 | ✅ | core data | `docs/map-roadmap.md` | Непроходимость перестала быть декоративной — |
| M2.7 | ✅ | cli proto | `docs/map-roadmap.md` | Граница, через которую нет пути, видна как барьер — |
| M2.8 | ✅ | core data | `docs/map-roadmap.md` | Сродство к семейству местности — 2026-09-22 |
| M2.9 | ✅ | cli proto data | `docs/map-roadmap.md` | Космос без прямых углов: волнистые границы и неровные области — 2026-09-22 |
| M2.10 | ✅ | data | `docs/map-roadmap.md` | Развилка — не провинция: обе карты Сектора Зеро переложены — 2026-09-22 |
| M2.11 | ✅ | cli proto | `docs/map-roadmap.md` | Живая граница провинций — 2026-09-24 |
| M3.1 | 🔒 |  | `docs/map-roadmap.md` | Редактор карты [tools] |
| M3.2 | ⏳ |  | `docs/map-roadmap.md` | Процедурный пресет → формат карты [tools] |
| M4.1 | ✅ | cli | `docs/map-roadmap.md` | Рендер из данных сектора — /🚧 |
| M4.3 | ✅ | core data cli | `docs/map-roadmap.md` | Соседство выводится из мозаики — |
| M4.2 | ⏳ | docs | `docs/map-roadmap.md` | Сверка с метаигрой и отложенным регионом |
| MM-0.1 | ⏳ | srv | `docs/matchmaking-roadmap.md` | Состояния матча: lobby→active→ended→archived |
| MM-0.2 | ✅ | core proto srv | `docs/matchmaking-roadmap.md` | Подключить victoryModule + баннер |
| MM-1.1 | 🔒 | srv | `docs/matchmaking-roadmap.md` | Лобби (создание/присоединение) |
| MM-1.2 | 🔒 | cli srv | `docs/matchmaking-roadmap.md` | Предматчевый экран: фракция/технологии |
| MM-2.1 | 🔒 | srv | `docs/matchmaking-roadmap.md` | Базовый подбор |
| MM-2.2 | 🔒 | srv | `docs/matchmaking-roadmap.md` | Регион/латентность |
| MM-3.1 | ⏳ | srv | `docs/matchmaking-roadmap.md` | Подведение итогов и счёт |
| MM-3.2 | 🔒 | srv cli | `docs/matchmaking-roadmap.md` | История матчей и реплеи |
| M0 | ✅ | cli docs | `docs/metrics-roadmap.md` | Снятие данных с ручных тестов [server] — реализовано |
| M1 | ✅ | core | `docs/metrics-roadmap.md` | Инструментирование ядра (детерминизм-safe) [server] — реализовано |
| M2 | ✅ | cli | `docs/metrics-roadmap.md` | Клиентская перф-телеметрия + перф-гейт [tools] — реализовано |
| M3 | ✅ |  | `docs/metrics-roadmap.md` | Сборщик телеметрии + отчёт по матчу [server][tools] — реализовано |
| M4 | ✅ | core | `docs/metrics-roadmap.md` | Балансная аналитика + self-play [tools] — реализовано |
| M5 | 🔒 |  | `docs/metrics-roadmap.md` | Ops-дашборды и алерты [server] |
| M6 | ⏳ |  | `docs/metrics-roadmap.md` | Продуктовая аналитика (категория H) [server][tools] |
| MS-0.1 | 🔒 | data core | `docs/missiles-roadmap.md` | Тип missile + пусковой модуль |
| MS-1.1 | 🔒 | core | `docs/missiles-roadmap.md` | launchMissile(targetNode) |
| MS-1.2 | 🔒 | core | `docs/missiles-roadmap.md` | Полёт (неуправляемый) + детект |
| MS-2.1 | 🔒 | core | `docs/missiles-roadmap.md` | Перехват ближним ПВО (pointDefense) |
| MS-2.2 | 🔒 | core data | `docs/missiles-roadmap.md` | Детонация |
| MS-3.1 | 🔒 | core data | `docs/missiles-roadmap.md` | Пусковой/ракеты как предмет + P2W-guardrail |
| MS-4.1 | 🔒 | cli | `docs/missiles-roadmap.md` | Рендер полёта/перехвата/удара |
| MSB-0 | ✅ | docs | `docs/multiside-combat-roadmap.md` | Решение владельца: (а), (б) или (в) |
| MSB-1 | ✅ | core | `docs/multiside-combat-roadmap.md` | Battle стал СПИСКОМ сторон |
| MSB-2 | ✅ | core | `docs/multiside-combat-roadmap.md` | Правило деления урона |
| MSB-3 | ✅ | core | `docs/multiside-combat-roadmap.md` | Вступление в идущий бой |
| MSB-4 | ✅ | core | `docs/multiside-combat-roadmap.md` | Совместный штурм и чей мир |
| MSB-5 | ✅ | core | `docs/multiside-combat-roadmap.md` | Что делает бой при смене владельца стороны |
| MSB-6 | ✅ | proto cli | `docs/multiside-combat-roadmap.md` | Панель боя на N сторон |
| MSB-7 | ✅ | core | `docs/multiside-combat-roadmap.md` | Зенитки и обстрел при N сторонах |
| ONB-0 | ✅ | proto srv | `docs/onboarding-roadmap.md` | Состояние первого запуска + воронка [proto/srv] (proto) |
| ONB-1 | ✅ | proto | `docs/onboarding-roadmap.md` | Движок гайд-марок (spotlight) ★ |
| ONB-2 | ✅ | proto | `docs/onboarding-roadmap.md` | Гайдовый первый матч (скриптовая соло-песочница) ★ |
| ONB-3 | ✅ | proto | `docs/onboarding-roadmap.md` | Just-in-time интро механик (прогрессивное раскрытие) |
| ONB-4 | ✅ | proto | `docs/onboarding-roadmap.md` | Help/кодекс-хаб («?» везде) |
| ONB-7 | ✅ | proto | `docs/onboarding-roadmap.md` | Цели первой сессии / чек-лист успеха |
| ONB-8 | ✅ | proto | `docs/onboarding-roadmap.md` | Онбординг в соц/мета-слой |
| OPS-0.1 | ⏳ | srv sec | `docs/operations-roadmap.md` | Структурные логи + трейсинг |
| OPS-0.2 | 🔒 | srv sec | `docs/operations-roadmap.md` | Метрики и трекинг ошибок |
| OPS-0.3 | 🔒 | srv | `docs/operations-roadmap.md` | Игровая телеметрия/аналитика |
| OPS-1.1 | ⏳ | srv sec | `docs/operations-roadmap.md` | Деплой при долгих WS-соединениях |
| OPS-1.2 | 🔒 | sec | `docs/operations-roadmap.md` | Нагрузочное и хаос-тестирование |
| OPS-1.3 | 🔒 | docs sec | `docs/operations-roadmap.md` | Статус-страница и инцидент-комм |
| OPS-2.1 | ⏳ | srv | `docs/operations-roadmap.md` | Шардинг по матчу + горизонт |
| OPS-2.2 | 🔒 | srv sec | `docs/operations-roadmap.md` | Мульти-регион |
| OPS-2.3 | ⏳ | docs | `docs/operations-roadmap.md` | Стоимостная модель |
| OPS-3.1 | 🔒 | data sec | `docs/operations-roadmap.md` | Пайплайн публикации контента + версии |
| OPS-3.2 | ⏳ | srv | `docs/operations-roadmap.md` | Feature-flags и A/B |
| OPS-3.3 | 🔒 | docs core | `docs/operations-roadmap.md` | Тулинг баланса экономики |
| OPS-4.1 | ⏳ | srv sec | `docs/operations-roadmap.md` | Модерация и анти-абьюз |
| OPS-4.2 | ⏳ | srv sec | `docs/operations-roadmap.md` | Транзакционная почта/коммуникации |
| PA-0.1 | 🔒 | sec srv | `docs/persistence-accounts-roadmap.md` | Честная аутентификация (ник → JWT/сессии) |
| PA-0.3 | 🔒 | sec ops | `docs/persistence-accounts-roadmap.md` | (= SE-3) |
| PA-0.4 | 🔒 | sec ops | `docs/persistence-accounts-roadmap.md` | (= PE-3.1 / SE-9) |
| PA-1.1 | ✅ | data srv | `docs/persistence-accounts-roadmap.md` | Схема матчей + мест — реализовано |
| PA-1.2 | ✅ | srv data | `docs/persistence-accounts-roadmap.md` | (= PE-0.2 / E2) |
| PA-1.3 | 🔒 | data core | `docs/persistence-accounts-roadmap.md` | (= PE-1.2) |
| PA-2.1 | ✅ | srv | `docs/persistence-accounts-roadmap.md` | Store-слой + снапшоты — реализовано |
| PA-2.2 | ⏳ | srv core | `docs/persistence-accounts-roadmap.md` | (= PE-1.1 / CR-0.2) |
| PA-2.3 | ⏳ | srv | `docs/persistence-accounts-roadmap.md` | (= PE-0.3) |
| PA-3.1 | ✅ | srv cli | `docs/persistence-accounts-roadmap.md` | Ник-логин + возврат за свою сторону — реализовано |
| PA-3.2 | 🔒 | srv sec | `docs/persistence-accounts-roadmap.md` | (= accounts-roadmap) |
| PA-3.3 | ⏳ | srv core | `docs/persistence-accounts-roadmap.md` | Семантика возврата и offline |
| PA-4.1 | ✅ | srv | `docs/persistence-accounts-roadmap.md` | v1 (одно-процессная) |
| PA-4.2 | ⏳ | core srv | `docs/persistence-accounts-roadmap.md` | (= PE-2.2) |
| PA-5.1 | ✅ | ops | `docs/persistence-accounts-roadmap.md` | Self-hosted Postgres на VPS — реализовано |
| PA-5.2 | 🔒 | ops srv | `docs/persistence-accounts-roadmap.md` | (↔ metrics-roadmap) |
| PE-0.1 | ✅ | srv | `docs/persistence-roadmap.md` | Схема и load/save GameState |
| PE-0.2 | ✅ | srv act | `docs/persistence-roadmap.md` | Стор квитанций (идемпотентность) |
| PE-0.3 | ⏳ | srv | `docs/persistence-roadmap.md` | Hot/cold: Redis горячее, Postgres холодное |
| PE-1.1 | ⏳ | srv | `docs/persistence-roadmap.md` | Журнал действий + снапшоты |
| PE-1.2 | 🔒 | srv data | `docs/persistence-roadmap.md` | Миграция сейв-формата в хранилище |
| PE-2.1 | ✅ | srv | `docs/persistence-roadmap.md` | Будилка по scheduled-событиям — v1 (одно-процессная), v2 |
| PE-2.2 | ⏳ | srv core | `docs/persistence-roadmap.md` | Корректный offline-catch-up |
| PE-3.1 | ⏳ | srv sec | `docs/persistence-roadmap.md` | Зашифрованные бэкапы + PITR + учение restore |
| PE-3.2 | ⏳ | srv | `docs/persistence-roadmap.md` | Переживание рестарта посреди матча |
| PVE-0.1 | ✅ | core data | `docs/pve-team-modes-roadmap.md` | GameModeDef zod-схема + modes в GameData |
| PVE-0.2 | ✅ | core srv | `docs/pve-team-modes-roadmap.md` | modeId в MatchConfig + консервация |
| PVE-0.3 | ✅ | data | `docs/pve-team-modes-roadmap.md` | Пресет standard |
| PVE-1.1 | ✅ | proto | `docs/pve-team-modes-roadmap.md` | Командные форматы в NetworkMatchMode |
| PVE-1.2 | ✅ | data | `docs/pve-team-modes-roadmap.md` | Пресеты командных режимов |
| PVE-1.3 | ✅ | data | `docs/pve-team-modes-roadmap.md` | Локализация режимов |
| PVE-2.1 | ✅ | data | `docs/pve-team-modes-roadmap.md` | swarm в data/factions.json — уже в контенте |
| PVE-2.2 | ✅ | data | `docs/pve-team-modes-roadmap.md` | Локализация Роя — уже в обеих локалях |
| PVE-2.3 | ✅ | data | `docs/pve-team-modes-roadmap.md` | Bump data/manifest.json — сделано в PVE-0.1 |
| PVE-3.1 | ✅ | core | `docs/pve-team-modes-roadmap.md` | state.pve в GameState |
| PVE-3.2 | ✅ | core | `docs/pve-team-modes-roadmap.md` | pveModule — спавн волн |
| PVE-3.3 | ✅ | core srv | `docs/pve-team-modes-roadmap.md` | Регистрация в DEVMODULES + bump манифеста |
| PVE-3.4 | ✅ | core | `docs/pve-team-modes-roadmap.md` | Кооп-враждебность NPC — правок не потребовалось |
| PVE-4.1 | ✅ | core | `docs/pve-team-modes-roadmap.md` | MatchEndReason расширение |
| PVE-4.2 | ✅ | core | `docs/pve-team-modes-roadmap.md` | PvE-чек в victoryModule |
| PVE-4.3 | ✅ | data | `docs/pve-team-modes-roadmap.md` | Пресет pvewaves |
| PVE-5.1 | ✅ | srv | `docs/pve-team-modes-roadmap.md` | pveOrchestrator скелет |
| PVE-5.2 | ✅ | srv | `docs/pve-team-modes-roadmap.md` | Интеграция через serverOrders |
| PVE-6.1 | ✅ | docs | `docs/pve-team-modes-roadmap.md` | Обновить docs/game-modes-roadmap.md |
| PVE-6.2 | ✅ | docs | `docs/pve-team-modes-roadmap.md` | Обновить docs/state.md |
| PVE-6.3 | ✅ | docs | `docs/pve-team-modes-roadmap.md` | Обновить CODE-MAP.md |
| PVE-6.4 | ✅ | docs | `docs/pve-team-modes-roadmap.md` | ADR 05/06 → accepted |
| ROADS-0 | ✅ | docs | `docs/roads-roadmap.md` | Модель и решения владельца — 2026-09-23 |
| ROADS-1 | ✅ | core data | `docs/roads-roadmap.md` | Сеть дорог в ядре — 2026-09-23 |
| ROADS-2 | ✅ | core proto | `docs/roads-roadmap.md` | Движение по дорогам — 2026-09-23 |
| ROADS-3 | ✅ | core proto | `docs/roads-roadmap.md` | Встречи на дорогах и засада на развилке — 2026-09-23 |
| ROADS-4 | ✅ | proto cli | `docs/roads-roadmap.md` | Засада на рисунке — 2026-09-23 |
| ROADS-5 | ✅ | proto data | `docs/roads-roadmap.md` | Прогоны глав по дорогам — 2026-09-23 |
| ROADS-6 | ✅ | proto | `docs/roads-roadmap.md` | ИИ сторожит развилки — 2026-09-23 |
| ROADS-7 | ✅ | proto core | `docs/roads-roadmap.md` | Дороги на соло-картах прототипа — 2026-09-23 |
| ROS-0.1 | ✅ | data proto core | `docs/roster-roadmap.md` | ПКО и зональное ПВО: имя насквозь 2026-09-09 |
| ROS-0.2 | ✅ | proto | `docs/roster-roadmap.md` | «Верфь» → «Производство» 2026-09-09 |
| ROS-1.1 | ✅ | core data proto | `docs/roster-roadmap.md` | Пехота и техника: два рода наземных войск 2026-09-09 |
| ROS-1.2 | ✅ | data proto | `docs/roster-roadmap.md` | Фрегат: корабль поддержки под модули 2026-09-09 |
| ROS-1.3 | ✅ | core data | `docs/roster-roadmap.md` | Осадная платформа осаждает планету, а не флот 2026-09-09 |
| ROS-1.4 | ✅ | core data proto | `docs/roster-roadmap.md` | Бомбардировщик и профили урона челноков 2026-09-09 |
| ROS-1.5 | ✅ | core data proto | `docs/roster-roadmap.md` | Десантный челнок: высадка вместо удара 2026-09-09 |
| ROS-2.1 | ✅ | core data proto | `docs/roster-roadmap.md` | Три линии 50/30/20, артиллерия без ответного огня 2026-09-09 |
| ROS-2.1a | ✅ | proto | `docs/roster-roadmap.md` | Управление огнём показывается только тем, кто может стрелять 2026-09-09 |
| ROS-2.2 | ✅ | core data proto | `docs/roster-roadmap.md` | Челнок — сторона боя: ответный урон и зональное ПВО 2026-09-09 |
| ROS-3.1 | ✅ | proto | `docs/roster-roadmap.md` | Экран «Производство»: пять типов, модули, количество, планета 2026-09-09 |
| ROS-3.2 | ✅ | proto | `docs/roster-roadmap.md` | Шаттл — корабль во всём интерфейсе 2026-09-09 |
| SZE-0.1 | ✅ | docs | `docs/sector-zero-economy-roadmap.md` | Свести §4.5 с магазином |
| SZE-0.2 | ✅ | docs data | `docs/sector-zero-economy-roadmap.md` | Цена звезды и потолок |
| SZE-0.3 | ✅ | docs proto | `docs/sector-zero-economy-roadmap.md` | Детерминизм заточки без сервера |
| SZE-1.1 | ✅ | data core proto | `docs/sector-zero-economy-roadmap.md` | Звезда у модуля: поле и потолок |
| SZE-1.2 | ✅ | proto | `docs/sector-zero-economy-roadmap.md` | Экран Мастерской |
| SZE-1.3 | ✅ | data proto | `docs/sector-zero-economy-roadmap.md` | Осколки и pity |
| SZE-2.1 | 🔒 | proto | `docs/sector-zero-economy-roadmap.md` | Экран Академии на движке Мастерской |
| SZE-3.1 | ✅ | data proto | `docs/sector-zero-economy-roadmap.md` | Витрина и три способа оплаты |
| SZE-3.2 | ✅ | data proto | `docs/sector-zero-economy-roadmap.md` | Ассортимент |
| SZE-3.4 | ✅ | proto | `docs/sector-zero-economy-roadmap.md` | Обновление витрины за рекламу |
| SZE-3.5 | ✅ | proto data | `docs/sector-zero-economy-roadmap.md` | Суверены за рекламу |
| SZE-3.6 | ✅ | core proto data | `docs/sector-zero-economy-roadmap.md` | Пакет снабжения забега за Суверены |
| SZE-3.3 | ⏳ | docs sec | `docs/sector-zero-economy-roadmap.md` | Покупки в Sector Zero и площадка |
| SZE-4.1 | ✅ | data | `docs/sector-zero-economy-roadmap.md` | Уровень у модуля Роя |
| SZE-4.2 | ✅ | core | `docs/sector-zero-economy-roadmap.md` | Контригра против уровня |
| SZE-5.1 | ✅ | data core | `docs/sector-zero-economy-roadmap.md` | Редкость в данных и в бою |
| SZE-5.2 | ✅ | proto | `docs/sector-zero-economy-roadmap.md` | Повышение редкости в профиле |
| SZE-5.3 | ✅ | proto data | `docs/sector-zero-economy-roadmap.md` | Откуда дубли и чертежи |
| SZE-5.4 | ✅ | proto | `docs/sector-zero-economy-roadmap.md` | Экран редкости в Мастерской |
| PVR-0.1 | ✅ | data | `docs/sector-zero-roadmap.md` | Карта pve-1 снова строится |
| PVR-0.2 | ✅ | proto | `docs/sector-zero-roadmap.md` | pveModule в ядре прототипа |
| PVR-0.3 | ✅ | proto | `docs/sector-zero-roadmap.md` | Сохранение: сперва мета, потом забег |
| PVR-0.4 | ✅ | data | `docs/sector-zero-roadmap.md` | Карта — развилки из линий |
| PVR-1.1 | ✅ | proto core data cli | `docs/sector-zero-roadmap.md` | Соло-запуск задаёт modeId |
| PVR-1.2 | ✅ | proto | `docs/sector-zero-roadmap.md` | HUD забега: волна N из M и время до следующей |
| PVR-1.3 | ✅ | data | `docs/sector-zero-roadmap.md` | Состав волны перестаёт быть одним дроном |
| PVR-1.4 | 🗑 | proto core | `docs/sector-zero-roadmap.md` | Выбор между волнами |
| PVR-1.5 | ✅ | core | `docs/sector-zero-roadmap.md` | Волны Роя враждебны и доходят до боя |
| PVR-1.6 | ✅ | core data | `docs/sector-zero-roadmap.md` | Забег доходит до вердикта |
| PVR-1.7 | ✅ | core data proto | `docs/sector-zero-roadmap.md` | Пиратская база для первого боя |
| PVR-2.1 | ✅ | proto | `docs/sector-zero-roadmap.md` | Выбор сложности на запуске забега |
| PVR-2.2 | ✅ | proto | `docs/sector-zero-roadmap.md` | У забега свой темп и ускорение |
| PVR-2.3 | ✅ | core proto | `docs/sector-zero-roadmap.md` | Корабли забега впятеро быстрее |
| PVR-2.4 | ✅ | data | `docs/sector-zero-roadmap.md` | Крепкий старт игрока в главах |
| PVR-2.5 | ✅ | core data proto | `docs/sector-zero-roadmap.md` | Победа в главе — выстоять |
| PVR-3.1 | ✅ | docs | `docs/sector-zero-roadmap.md` | Резолюция: чем PvE-прокачка НЕ является |
| PVR-3.2 | ✅ | proto | `docs/sector-zero-roadmap.md` | Хранилище PvE-прогресса |
| PVR-3.3 | ✅ | proto | `docs/sector-zero-roadmap.md` | Награда за забег |
| PVR-4.1 | ✅ | docs | `docs/sector-zero-roadmap.md` | Резолюция: что из §3 входит в первую версию |
| PVR-4.2 | ✅ | core | `docs/sector-zero-roadmap.md` | Память Роя как состояние |
| PVR-4.3 | 🔶 | core data | `docs/sector-zero-roadmap.md` | Одна читаемая адаптация от сигнала до формы |
| PVR-4.4 | ✅ | data | `docs/sector-zero-roadmap.md` | Структуры первого набора |
| PVR-4.5 | ✅ | proto | `docs/sector-zero-roadmap.md` | Журнал адаптаций |
| PVR-4.6 | ✅ | core data proto | `docs/sector-zero-roadmap.md` | Органы Роя у захватчика: не работают, гарнизон их зачищает |
| PVR-5.1 | ✅ | data cli | `docs/sector-zero-roadmap.md` | Карта второй главы и дверь к ней |
| PVR-5.2 | ✅ | data cli | `docs/sector-zero-roadmap.md` | Задачи на карте и награда за них |
| PVR-5.3 | ✅ | data cli | `docs/sector-zero-roadmap.md` | Рост числа задач по главам |
| PVR-5.4 | ✅ | proto cli | `docs/sector-zero-roadmap.md` | Экран итогов забега |
| PVR-6.1 | ✅ | proto | `docs/sector-zero-roadmap.md` | Инструменты мультиплеера не едут в забег |
| PVR-6.2 | ✅ | proto | `docs/sector-zero-roadmap.md` | Список корпусов — только то, что игрок строит |
| PVR-6.3 | ✅ | proto | `docs/sector-zero-roadmap.md` | Валюты: цвет и «фишка» |
| PVR-6.4 | ✅ | data proto | `docs/sector-zero-roadmap.md` | Карточка предмета: рамка редкости и звёзды |
| PVR-6.5 | ✅ | proto | `docs/sector-zero-roadmap.md` | Сравнение «до/после» |
| PVR-6.6 | ✅ | proto | `docs/sector-zero-roadmap.md` | Академия и Мастерская для «взрослых детей» |
| PVR-6.7 | ✅ | proto | `docs/sector-zero-roadmap.md` | Магазин-витрина |
| PVR-6.8 | ✅ | proto | `docs/sector-zero-roadmap.md` | Живое главное меню |
| PVR-6.9 | ✅ | proto | `docs/sector-zero-roadmap.md` | Выбор главы — маршрут от края сектора к эпицентру |
| PVR-6.10 | ✅ | proto | `docs/sector-zero-roadmap.md` | Досье Роя — справа, сворачивается, читается вопросами |
| PVR-6.11 | ✅ | proto | `docs/sector-zero-roadmap.md` | Портреты героев в Академии |
| PVR-6.12 | ✅ | proto | `docs/sector-zero-roadmap.md` | Шапка забега: кошелёк профиля вместо счёта, места и дня |
| PVR-6.13 | ✅ | proto | `docs/sector-zero-roadmap.md` | Часы забега — реальные минуты вместо игровых часов |
| PVR-6.14 | ✅ | proto | `docs/sector-zero-roadmap.md` | Комиксы глав — основа под арт владельца |
| SE-0.1 | ✅ | srv sec | `docs/secure-environment-roadmap.md` | JWT в WebSocket-рукопожатии |
| SE-0.2 | ✅ | srv | `docs/secure-environment-roadmap.md` | Авторизация на соединении и на сообщении |
| SE-0.3 | ⏳ | sec | `docs/secure-environment-roadmap.md` | Сервисные идентичности и scoped-токены |
| SE-1.1 | ⏳ | sec | `docs/secure-environment-roadmap.md` | Cloudflare: DDoS / WAF / rate-limit на краю |
| SE-1.2 | ⏳ | srv sec | `docs/secure-environment-roadmap.md` | TLS 1.3 везде + приватная сеть [A02] |
| SE-1.3 | 🔒 | sec | `docs/secure-environment-roadmap.md` | Скрытие origin + egress-контроль |
| SE-2.1 | ⏳ | sec | `docs/secure-environment-roadmap.md` | Секрет-стор + инъекция в рантайме |
| SE-2.2 | 🔒 | sec | `docs/secure-environment-roadmap.md` | Ротация и аудит доступа к секретам |
| SE-3.1 | ⏳ | srv sec | `docs/secure-environment-roadmap.md` | Least-privilege роли БД |
| SE-3.2 | ⏳ | srv | `docs/secure-environment-roadmap.md` | Шифрование at-rest + in-transit [A02] |
| SE-3.3 | ⏳ | srv | `docs/secure-environment-roadmap.md` | RLS как defense-in-depth |
| SE-3.4 | 🔶 | srv sec | `docs/secure-environment-roadmap.md` | Бэкапы + PITR + проверенный restore |
| SE-4.1 | ⏳ | srv sec | `docs/secure-environment-roadmap.md` | ACL / TLS / приватный bind |
| SE-5.1 | ✅ | srv sec | `docs/secure-environment-roadmap.md` | Минимальный non-root read-only образ |
| SE-5.2 | ✅ | sec | `docs/secure-environment-roadmap.md` | Сканирование образа сервера |
| SE-6.1 | ⏳ | srv | `docs/secure-environment-roadmap.md` | Лимиты соединений и сообщений |
| SE-6.2 | ⏳ | srv sec | `docs/secure-environment-roadmap.md` | Rate-limiting действий |
| SE-6.3 | ⏳ | srv | `docs/secure-environment-roadmap.md` | Per-player очередь (анти-double-spend) |
| SE-6.4 | ✅ | srv | `docs/secure-environment-roadmap.md` | Фильтр видимости перед отправкой |
| SE-6.5 | ⏳ | srv | `docs/secure-environment-roadmap.md` | Масштаб WS без поломки auth/видимости |
| SE-7.1 | 🔶 | cli sec | `docs/secure-environment-roadmap.md` | CSP + Trusted Types + HSTS 2026-09-21 |
| SE-7.2 | ⏳ | cli sec | `docs/secure-environment-roadmap.md` | SRI и безопасные куки |
| SE-8.1 | ⏳ | srv sec | `docs/secure-environment-roadmap.md` | Структурное аудит-логирование |
| SE-8.2 | 🔒 | sec | `docs/secure-environment-roadmap.md` | Алерты на аномалии |
| SE-8.3 | ⏳ | srv sec | `docs/secure-environment-roadmap.md` | Метрики и трекинг ошибок |
| SE-9.1 | ⏳ | srv | `docs/secure-environment-roadmap.md` | Переживание рестарта посреди матча |
| SE-9.2 | 🔒 | docs sec | `docs/secure-environment-roadmap.md` | DR: RTO/RPO, runbooks, kill-switch |
| SE-10.1 | 🔒 | docs | `docs/secure-environment-roadmap.md` | Минимизация данных и GDPR-база |
| SD-0.1 | ⏳ | docs sec | `docs/secure-sdlc-roadmap.md` | Цель ASVS L2 + threat-model-кадэнс |
| SD-0.2 | ✅ | sec | `docs/secure-sdlc-roadmap.md` | SEC-1: триаж и baseline сканеров |
| SD-1.1 | ⏳ | core act srv | `docs/secure-sdlc-roadmap.md` | Валидация на каждой границе доверия |
| SD-1.2 | ⏳ | cli proto | `docs/secure-sdlc-roadmap.md` | Вывод/экранирование — XSS в клиенте |
| SD-1.3 | ✅ | srv | `docs/secure-sdlc-roadmap.md` | Инъекции — БД 2026-09-22 |
| SD-1.4 | ⏳ | core | `docs/secure-sdlc-roadmap.md` | Prototype pollution и безопасная десериализация |
| SD-1.5 | ⏳ | core act srv | `docs/secure-sdlc-roadmap.md` | ReDoS-гигиена |
| SD-2.1 | ✅ | sec | `docs/secure-sdlc-roadmap.md` | Кастомные Semgrep-правила под инварианты ядра |
| SD-2.2 | ⏳ | sec | `docs/secure-sdlc-roadmap.md` | ESLint security-плагины + типизованные правила |
| SD-2.3 | ⏳ | sec | `docs/secure-sdlc-roadmap.md` | CodeQL default setup |
| SD-2.4 | ⏳ | sec | `docs/secure-sdlc-roadmap.md` | Секреты: Gitleaks + GitHub push protection |
| SD-3.1 | ⏳ | sec | `docs/secure-sdlc-roadmap.md` | pnpm: блокировка lifecycle-скриптов + cooldown |
| SD-3.2 | ⏳ | sec | `docs/secure-sdlc-roadmap.md` | SCA-гейт + автообновления с политикой |
| SD-3.3 | ✅ | sec | `docs/secure-sdlc-roadmap.md` | Провенанс артефактов + проверка (SEC-5 ) |
| SD-3.4 | ✅ | sec | `docs/secure-sdlc-roadmap.md` | SBOM в IR-поток → |
| SD-4.1 | ⏳ | docs sec | `docs/secure-sdlc-roadmap.md` | Threat-model-as-code в репо |
| SD-4.2 | 🔒 | docs | `docs/secure-sdlc-roadmap.md` | Кадэнс per-feature |
| SD-5.1 | ⏳ | sec | `docs/secure-sdlc-roadmap.md` | CODEOWNERS + защита ветки |
| SD-5.2 | ⏳ | sec | `docs/secure-sdlc-roadmap.md` | Pre-commit хуки + подпись коммитов |
| SD-6.1 | ⏳ | sec | `docs/secure-sdlc-roadmap.md` | SHA-пин экшенов и образов + least-priv токены |
| SD-6.2 | ⏳ | sec | `docs/secure-sdlc-roadmap.md` | OIDC вместо долгоживущих секретов |
| SD-6.3 | ✅ | sec | `docs/secure-sdlc-roadmap.md` | Агрегация находок (SARIF) |
| SD-7.1 | ⏳ | act | `docs/secure-sdlc-roadmap.md` | Расширить abuse-тесты слоя действий |
| SD-7.2 | ⏳ | core srv | `docs/secure-sdlc-roadmap.md` | Фаззинг валидаторов и парсеров (частично ) |
| SD-7.3 | ✅ | core | `docs/secure-sdlc-roadmap.md` | Property-based тесты детерминизма |
| SD-8.1 | 🔒 | docs sec | `docs/secure-sdlc-roadmap.md` | ASVS L2 self-verification |
| SD-8.2 | ⏳ | sec | `docs/secure-sdlc-roadmap.md` | DAST против живого сервера |
| SD-8.3 | ⏳ | docs | `docs/secure-sdlc-roadmap.md` | Процесс реакции на уязвимости |
| SV-0.1 | ✅ | srv | `docs/server-roadmap.md` | Fastify-скелет + health/readiness |
| SV-0.2 | ✅ | srv | `docs/server-roadmap.md` | Match-actor модель |
| SV-1.1 | ✅ | srv act | `docs/server-roadmap.md` | Подключить @void/action-layer к WS-потоку |
| SV-1.2 | ✅ | act | `docs/server-roadmap.md` | zod-схемы на каждый тип действия |
| SV-2.1 | ✅ | srv | `docs/server-roadmap.md` | Прод-WS поверх Fastify |
| SV-2.2 | ✅ | srv | `docs/server-roadmap.md` | Монотонный seq + ресинк |
| SV-2.3 | ⏳ | srv | `docs/server-roadmap.md` | Per-player очередь (анти-double-spend) |
| SV-2.5 | ✅ | srv | `docs/server-roadmap.md` | Фабрика матчей + лента открытых |
| SV-3.1 | ✅ | srv | `docs/server-roadmap.md` | Фильтр видимости перед broadcast |
| SV-3.2 | ⏳ | srv | `docs/server-roadmap.md` | Interest management при масштабе |
| SV-4.1 | ⏳ | srv | `docs/server-roadmap.md` | Фан-аут между инстансами |
| SH-0.1 | ✅ | data core | `docs/shields-roadmap.md` | Стат shield + двойной пул в UnitStack |
| SH-0.2 | ✅ | core | `docs/shields-roadmap.md` | applyDamage двухслойно |
| SH-1.1 | ✅ | core | `docs/shields-roadmap.md` | Реген щита на time.advanced |
| SH-1.2 | ⏳ | core | `docs/shields-roadmap.md` | Щит восстанавливается В БОЮ |
| SH-2.1 | ✅ | core data | `docs/shields-roadmap.md` | Ремонт в порту |
| SH-2.2 | 🔒 | core | `docs/shields-roadmap.md` | Ремонтные дроны — единственный in-combat ремонт |
| SH-2.3 | 🔒 | core data | `docs/shields-roadmap.md` | Ремонтный модуль |
| SM-0.1 | 🔒 | data | `docs/ship-modules-roadmap.md` | Схема ModuleDef + каталог data/modules.json |
| SM-0.2 | 🔒 | data core | `docs/ship-modules-roadmap.md` | Стат moduleSlots + поле UnitStack.modules |
| SM-0.3 | 🔒 | core | `docs/ship-modules-roadmap.md` | Лоадаут-aware идентичность стека |
| SM-0.4 | 🔒 | core | `docs/ship-modules-roadmap.md` | Хелпер effectiveStats(def, stack, data) |
| SM-0.5 | 🔒 | core | `docs/ship-modules-roadmap.md` | Маршрутизация cargoCapacity через эффективный лукап |
| SM-0.6 | 🔒 | core | `docs/ship-modules-roadmap.md` | Действие loadout.equip / loadout.unequip |
| SM-0.7 | 🔒 | cli | `docs/ship-modules-roadmap.md` | CLI лоадаута |
| SM-1.1 | 🔒 | data | `docs/ship-modules-roadmap.md` | Модуль +N cargoCapacity (плоский, тиры) |
| SM-1.2 | 🔒 | data srv | `docs/ship-modules-roadmap.md` | Фейрнес расширителя (F2P + soulbound) |
| SM-2.1 | 🔒 | data | `docs/ship-modules-roadmap.md` | Семейство «дройды» (новый контент) |
| SM-2.2 | 🔒 | data | `docs/ship-modules-roadmap.md` | Трейт transport + модуль-фабрика |
| SM-2.3 | 🔒 | core | `docs/ship-modules-roadmap.md` | fleet.assembleDroids — fleet-scoped производство |
| SM-2.4 | 🔒 | core | `docs/ship-modules-roadmap.md` | Завершение + бой-фриз + ОГРАНИЧЕННЫЙ re-defer |
| SM-2.5 | 🔒 | cli | `docs/ship-modules-roadmap.md` | Рендер фабрики |
| SM-2.6 | 🔒 | data srv | `docs/ship-modules-roadmap.md` | Фейрнес/P2W-гард фабрики |
| SHU-0.1 | ✅ | core data proto | `docs/shuttles-roadmap.md` | Переименование: эскадрильи → челноки |
| SHU-1.1 | ✅ | core data | `docs/shuttles-roadmap.md` | Ангар космопорта |
| SHU-1.2 | ✅ | core proto | `docs/shuttles-roadmap.md` | Удар и возврат |
| SHU-1.3 | ✅ | core data | `docs/shuttles-roadmap.md` | Перехват |
| SHU-2.1 | ✅ | core data | `docs/shuttles-roadmap.md` | Носитель как мобильный космопорт |
| SHU-2.2 | ✅ | core srv proto | `docs/shuttles-roadmap.md` | Снос старой машинерии 2026-09-11 |
| SHU-2.3 | ✅ | core proto | `docs/shuttles-roadmap.md` | Вылет с ИДУЩЕГО носителя 2026-09-16 |
| SHU-3.1 | ✅ | proto | `docs/shuttles-roadmap.md` | Интерфейс 2026-09-10 |
| SHU-3.2 | ✅ | proto | `docs/shuttles-roadmap.md` | Бот умеет челноки 2026-09-09 |
| SHU-3.3 | ✅ | proto | `docs/shuttles-roadmap.md` | Носитель у бота 2026-09-15 |
| SHU-3.4 | ✅ | proto core data | `docs/shuttles-roadmap.md` | Наземная война бота: разведка, уверенность, высадка 2026-09-16 |
| SHU-3.5 | ✅ | proto data | `docs/shuttles-roadmap.md` | Гарнизон по развитости: подвоз и производство 2026-09-16 |
| SHU-4.1 | ✅ | proto | `docs/shuttles-roadmap.md` | Словарь: эскадра у мира, флот у кораблей 2026-09-10 |
| SHU-4.2 | ✅ | core data | `docs/shuttles-roadmap.md` | Эскадра как соединение ангара 2026-09-10 |
| SHU-4.3 | ✅ | proto | `docs/shuttles-roadmap.md` | Панель мира: эскадры как флоты 2026-09-10 |
| SHU-4.4 | ✅ | core | `docs/shuttles-roadmap.md` | Погоня: удар по движущейся цели 2026-09-13 |
| ST-3.1 | ✅ | core | `docs/steward-roadmap.md` | Ядро: доля потерь по прогнозу + трипваер «враг близко» |
| ST-3.2 | ✅ | srv proto | `docs/steward-roadmap.md` | Драйвер: эвакуация под угрозой (поза defend) |
| ST-3.3 | ✅ | core srv proto | `docs/steward-roadmap.md` | Поза «Активная оборона» — контрудар при приемлемых потерях |
| ST-2.1 | ✅ | core srv proto | `docs/steward-roadmap.md` | Guard-режим: точки удержания |
| ST-2.2 | ⏳ | srv core | `docs/steward-roadmap.md` | PvE-экспансия (платный тир) |
| ST-2.3 | ⏳ | srv | `docs/steward-roadmap.md` | Сим-гейт по порогу потерь |
| ST-3.4 | ✅ | srv proto | `docs/steward-roadmap.md` | Анти-шаттл гистерезис эвакуации |
| THREAT-HUD | ✅ | proto | `docs/steward-roadmap.md` | «Враг у ваших рубежей» — трипваер живому игроку |
| ST-2.4 | ✅ | core srv cli | `docs/steward-roadmap.md` | SITREP (журнал решений + утренний рапорт) |
| ST-2.5 | ⏳ | srv | `docs/steward-roadmap.md` | Мета-гейт тиров (free / paid) |
| TT-0.1 | ✅ | data core | `docs/tech-tree-roadmap.md` | Ветки branch |
| TT-0.2 | ✅ | data core | `docs/tech-tree-roadmap.md` | День-гейт dayGate |
| TT-0.3 | 🔒 | data core | `docs/tech-tree-roadmap.md` | Условия conditions[] |
| TT-1.1 | 🔒 | core | `docs/tech-tree-roadmap.md` | Правило доступности |
| TT-1.2 | 🔒 | core | `docs/tech-tree-roadmap.md` | Исследование → завершение (reuse) |
| TT-1.3 | 🔒 | core | `docs/tech-tree-roadmap.md` | Слоты исследований (РЕШЕНО: 2 → до 3) |
| TT-2.1 | 🔒 | srv core | `docs/tech-tree-roadmap.md` | Анлок узлов уровнем аккаунта |
| TT-3.1 | ✅ | cli | `docs/tech-tree-roadmap.md` | Вкладки веток + состояния узлов |
| TT-4.1 | ⏳ | data core | `docs/tech-tree-roadmap.md` | Слот учёного + выбор на старте |
| TT-4.2 | 🔒 | data core | `docs/tech-tree-roadmap.md` | Капстоун: супер-юнит / особое здание (лейт-гейм) |
| TT-4.3 | 🔒 | data core | `docs/tech-tree-roadmap.md` | Учёный «+слот» |
| VET-1 | ✅ | core | `docs/unit-medals-roadmap.md` | Вклад стека в залп перестаёт выбрасываться |
| VET-2 | ✅ | core | `docs/unit-medals-roadmap.md` | Счётчики ветерана на стеке |
| VET-3 | ✅ | core data | `docs/unit-medals-roadmap.md` | Грейды и пороги |
| VET-4 | ✅ | core data | `docs/unit-medals-roadmap.md` | Выплата, растущая со степенью |
| VET-5 | ✅ | proto cli | `docs/unit-medals-roadmap.md` | Медали в карточке юнита |
| YAG-0.1 | ✅ | docs | `docs/yandex-games-roadmap.md` | Сверить требования с первоисточником 2026-09-22 |
| YAG-0.2 | ✅ | docs | `docs/yandex-games-roadmap.md` | Сверить страницы SDK с первоисточником 2026-09-22 |
| YAG-1.1a | ✅ | proto | `docs/yandex-games-roadmap.md` | Контракты GamePlatform и WebPlatformAdapter |
| YAG-1.1b | ✅ | proto | `docs/yandex-games-roadmap.md` | Платформенная цель сборки и раскладка архива 2026-09-22 |
| YAG-1.1c | ✅ | proto | `docs/yandex-games-roadmap.md` | В архиве площадки — только Sector Zero 2026-09-23 |
| YAG-1.1d | ✅ | proto | `docs/yandex-games-roadmap.md` | В архиве — тексты одного языка 2026-09-24 |
| YAG-1.2 | ✅ | proto | `docs/yandex-games-roadmap.md` | YandexGamesAdapter: инициализация и жизненный цикл 2026-09-22 |
| YAG-1.2a | ✅ | proto | `docs/yandex-games-roadmap.md` | Разметка геймплея на забеге 2026-09-22 |
| YAG-1.3 | ✅ | proto | `docs/yandex-games-roadmap.md` | Язык от площадки |
| YAG-1.4 | 🔶 | proto | `docs/yandex-games-roadmap.md` | Гость и повышение до аккаунта площадки 2026-09-23 |
| YAG-2.1 | ✅ | proto | `docs/yandex-games-roadmap.md` | PortableMetaSave: компактный дескриптор забега 2026-09-23 |
| YAG-2.2 | ✅ | proto | `docs/yandex-games-roadmap.md` | PlatformSave в адаптере Яндекса 2026-09-24 |
| YAG-3.1 | ✅ | proto | `docs/yandex-games-roadmap.md` | PlatformAds в адаптере Яндекса |
| YAG-3.2 | ✅ | proto | `docs/yandex-games-roadmap.md` | Четыре добровольных placement'а |
| YAG-4.1 | ⏳ | srv | `docs/yandex-games-roadmap.md` | Эндпойнт проверки подписи |
| YAG-4.2 | 🔒 | proto | `docs/yandex-games-roadmap.md` | PlatformIAP в адаптере Яндекса |
| YAG-4.3 | ⏳ | srv proto | `docs/yandex-games-roadmap.md` | Где живёт кошелёк Суверенов — решение до покупок |
| YAG-5.1 | 🔶 | proto | `docs/yandex-games-roadmap.md` | PlatformAnalytics: словарь событий |
| YAG-5.2 | 🔶 | docs proto | `docs/yandex-games-roadmap.md` | Карточка игры и подача в модерацию 2026-09-24 |
| YAG-6.1 | ⏳ | proto | `docs/yandex-games-roadmap.md` | Серверное время для суток витрины и дневных лимитов |
| YAG-6.2 | ✅ | proto | `docs/yandex-games-roadmap.md` | Пауза площадки: что делает мир 2026-09-24 |
| YAG-6.3 | ⏳ | proto | `docs/yandex-games-roadmap.md` | Удалённый конфиг баланса |
| YAG-6.4 | ✅ | proto | `docs/yandex-games-roadmap.md` | Кнопка «назад» и выход 2026-09-24 |
