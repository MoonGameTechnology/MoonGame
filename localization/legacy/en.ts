// ENGLISH locale: a flat map from the canonical Russian msgid to the English
// translation. A missing entry falls back to the Russian source (visible, honest).
// Game-DATA names (buildings/units/technologies/sectors/planet types — authored in
// English in game.ts) need no entry here; `tData()` shows them as-is on this locale.
// One language = one file.
export const en: Record<string, string> = {
  // --- STAFF-1 «Штаб героев» redesign -------------------------------------------
  резерв: 'reserve',
  Общие: 'Common',
  способностей: 'abilities',
  актив: 'active',
  Требует: 'Requires',
  // NB: `Изучить` is translated once, in the meta-progression block below ('Unlock')
  // — a second entry here would be silently shadowed by it.
  'цель на карте': 'target on map',
  // --- TT-3.1 technology tree screen --------------------------------------------
  старт: 'start',
  день: 'day',
  Индустрия: 'Industry',
  Сенсоры: 'Sensors',
  Доктрины: 'Doctrines',
  Укрепления: 'Fortifications',
  Авиакрыло: 'Air wing',
  Арсенал: 'Arsenal',
  Связь: 'Signals',
  Автоматизация: 'Automation',
  производство: 'production',
  'скорость флотов': 'fleet speed',
  урон: 'damage',
  'радиус радаров': 'radar range',
  Хранитель: 'Steward',
  // --- SPY-UX intel tab in diplomacy --------------------------------------------
  Шпионаж: 'Espionage',
  // --- ONB-7 first-session goals checklist -------------------------------------
  // --- ONB-5 async intro + return digest ---------------------------------------
  // --- ONB-3 just-in-time mechanic intros --------------------------------------
  // --- ONB-8 social/meta-layer intros (corp cabinet + AvA wars tab) ------------
  // --- ONB-4 codex/help hub (chrome + glossary) --------------------------------
  'Туман войны': 'Fog of war',
  // --- ONB-0 first-run offer (hub) + «Ещё → Обучение» --------------------------
  Пропустить: 'Skip',
  // --- ONB-2 guided first match (firstMatchTour) -------------------------------
  // --- ONB-1 guide-marks (spotlight) — chrome + HUD orientation tour -----------
  Далее: 'Next',
  Понятно: 'Got it',
  // --- placeholders / small fragments ------------------------------------------
  '{b} — улучшение': '{b} — upgrade',
  // TGT-1: target-order composer
  '◎ тапните цель на карте — соберём приказ': '◎ tap a target on the map — compose the order',
  '◎ цель не выбрана': '◎ no target picked',
  ПРИКАЗ: 'ORDER',
  'убрать шаг': 'remove step',
  'план пуст — добавь шаги': 'plan is empty — add steps',
  '⏱{n}ч': '⏱{n}h',
  '⏱ +1ч': '⏱ +1h',
  '🎯{n}ч': '🎯{n}h',
  '⚔ авто-штурм включён — флот сам штурмует вражеский мир по прибытии':
    '⚔ auto-storm on — the fleet storms the hostile world it arrives at by itself',
  '⚡ форс-марш: +50% скорости, −5% прочности за час хода':
    '⚡ forced march: +50% speed, −5% hull per hour underway',
  '⊕ тапайте свои флоты — соберите группу и отдайте общий приказ':
    '⊕ tap your fleets — build the group, then give a common order',
  Сюда: 'Go here',
  Огонь: 'Fire',
  'снять приказ': 'clear the order',
  '{n} флотов': '{n} fleets',
  '◎ приказ поставлен — флот исполнит план сам': '◎ order set — the fleet will run the plan itself',
  '{n}м': '{n}m',
  '{n}ч': '{n}h',
  '{d}д {h}ч': '{d}d {h}h',
  '{what} — не вышло: {err}': '{what} — failed: {err}',
  '{what} — скоро': '{what} — coming soon',

  // --- fleet panel / command bar ------------------------------------------------
  Атака: 'Attack',
  ВЫ: 'YOU',
  ВЫКЛ: 'OFF',
  Все: 'All',
  'Вход через Apple — скоро · ты вошёл гостем':
    'Sign in with Apple — coming soon · you entered as a guest',
  'Вход через Google — скоро · ты вошёл гостем':
    'Sign in with Google — coming soon · you entered as a guest',
  Вы: 'You',
  День: 'Day',
  'День {n}': 'Day {n}',
  '{h}ч': '{h}h',
  Пароль: 'Password',
  'Введите пароль (мин. 8 символов)': 'Enter a password (min 8 chars)',
  'все места заняты': 'all seats taken',
  Дивизии: 'Divisions',
  'Дивизии ⇄ трюм (своб. {n})': 'Divisions ⇄ hold (free {n})',
  'Ещё раз «Назад» — выход': 'Press Back again to exit',
  'Ждём, пока хост начнёт…': 'Waiting for the host to start…',
  ЗАКРЫТЬ: 'CLOSE',
  ЗАПУСК: 'LAUNCH',
  'ЗАПУСК В ОДИНОЧКУ': 'LAUNCH SOLO',
  'Загрузка погружает дивизию в трюм. Выгрузка высаживает её на этот мир.':
    'Loading takes a division into the hold. Unloading lands it on this world.',
  'Задача: ✦ {n} (мир — 50, сектор — 10) или уничтожение соперников.':
    'Goal: ✦ {n} (a world — 50, a province — 10) or eliminate your rivals.',
  Закрыть: 'Close',
  ИИ: 'AI',
  Герои: 'Heroes',
  'Командный бой: ВКЛ': 'Team battle: ON',
  'Командный бой: выкл': 'Team battle: off',
  'одна сторона — союзники': 'one side = allies',
  Командир: 'Commander',
  Корпус: 'Hull',
  Крейсер: 'Cruiser',
  'Нет дивизий.': 'No divisions.',
  Модули: 'Modules',
  Назад: 'Back',
  'Нет дивизий — мобилизуй по шаблону ниже.': 'No divisions — mobilize from a template below.',
  ДА: 'YES',
  '⚔ выберите чужой мир для штурма': "⚔ pick someone else's world to storm",
  'Управление скоростью': 'Speed control',
  'панель времени в матче — пауза и множители ускорения (1× — реальное время)':
    'the in-match time bar — pause and speed multipliers (1× is real time)',
  '⚔ штурмовать можно только чужой мир': "⚔ only someone else's world can be stormed",
  Оборона: 'Defense',
  Обстрел: 'Barrage',
  'Отделите корабли в новый флот — он останется в том же секторе. Хотя бы один корабль остаётся; десант в трюме остаётся с исходным флотом.':
    'Peel ships into a new fleet — it stays in the same sector. At least one ship stays behind; carried troops stay with the original.',
  Отмена: 'Cancel',
  Отправить: 'Send',
  ПВО: 'AA',
  ПОБЕДА: 'WIN',
  Пассив: 'Passive',
  Подтвердить: 'Confirm',
  'Наведи на объект слева — здесь появится его досье.':
    'Hover an object on the left — its dossier appears here.',
  Постройки: 'Structures',
  'Суверены — донат-валюта': 'Sovereigns — the donate currency',
  'РАЗДЕЛЕНИЕ ФЛОТА': 'SPLIT FLEET',
  Скор: 'Spd',
  Скорость: 'Speed',
  Сообщения: 'Messages',
  'Сообщения — скоро': 'Messages — coming soon',
  Станд: 'Std',
  Удар: 'Strike',
  ФЛОТ: 'FLEET',
  Флот: 'Fleet',
  // Авто-имена флотов (Bytro-стиль): тип соединения по размеру
  Звено: 'Wing',
  Эскадрилья: 'Flight',
  Эскадра: 'Squadron',
  Армада: 'Armada',
  // Карточка статистики мира (тап по имени планеты)
  эскадрилий: 'squadrons',
  // 🔥 режим огня артиллерии — кнопка в командном ряду + пункты меню
  Фракция: 'Faction',
  // H3 — setup faction picker (pure passive house bonuses)
  'Фракция — пассивный бонус дома': 'Faction — the house passive bonus',
  '+{n}% экономика': '+{n}% economy',
  '+{n}% урон': '+{n}% damage',
  '+{n}% скорость флотов': '+{n}% fleet speed',
  '+{n}% радар': '+{n}% radar',
  Штурм: 'Assault',

  // --- market resource tabs (MARKET_RES) -----------------------------------------
  Металл: 'Metal',
  Пища: 'Food',
  Энергия: 'Energy',
  Микро: 'Micro',

  // --- diplomatic stance (STANCE_RU, via stanceRu()) ---------------------------
  Союз: 'Alliance',

  // --- kernel rejection codes (ERR_RU, via errText()) --------------------------
  'боты не вступают в коалиции': 'bots do not join coalitions',

  // --- corp mock panel (role/presence dictionaries, CORP_TABS) ------------------
  Глава: 'Leader',
  Офицер: 'Officer',
  Участник: 'Member',
  'в матче': 'in a match',
  Обзор: 'Overview',
  Участники: 'Members',
  Казна: 'Treasury',
  Владения: 'Holdings',
  Войны: 'Wars',
  Заявка: 'Applicant',

  // --- corporation cabinet (AVA-C1/C2, live) ------------------------------------
  'создала корпорацию': 'created the corporation',
  'приняла заявку': 'accepted the application',
  'отклонила заявку': 'declined the application',
  исключила: 'kicked',
  'сменила роль': 'changed a role',
  'передала главенство': 'transferred headship',
  'покинула корпорацию': 'left the corporation',
  'расформировала корпорацию': 'disbanded the corporation',
  'движение влияния': 'influence movement',
  'флаг готовности': 'readiness flag',
  'выдала медаль': 'granted a medal',
  'выдала предмет в аренду': 'rented out an item',
  'вернула арендованный предмет': 'returned a rented item',
  AvA: 'AvA',
  готов: 'ready',
  назначен: 'scheduled',
  отменён: 'cancelled',
  победа: 'victory',
  снять: 'clear',
  состав: 'roster',
  '—': '—',

  // --- preset hero names (HeroLoadout, non-main; heroName() via t()) -----------
  Разрушитель: 'Destroyer',
  Авангард: 'Vanguard',
  Страж: 'Sentinel',

  Пехота: 'Infantry',
  Танк: 'Tank',
  // formation doctrines (formationStats, game.ts) — organisational labels, no combat bonus (BF-23)
  'Комбинированные войска': 'Combined arms',
  'Пехота и танки в одном строю': 'Infantry and tanks in one line',
  Окопались: 'Entrenched',
  '≥3 тяжёлой пехоты держат рубеж': '≥3 heavy infantry hold the line',
  'Танковый кулак': 'Armored fist',
  '≥3 танков — ударный клин': '≥3 tanks — a breakthrough wedge',
  // preset division template names (setupTemplates, game.ts)
  Линия: 'Line',
  Кулак: 'Fist',

  // --- hero grades (HERO_GRADES, heroes.ts) --------------------------------------
  Главный: 'Main',

  // --- hero abilities (HERO_ABILITIES, heroes.ts) --------------------------------
  Коридор: 'Corridor',
  Аннигиляция: 'Annihilate',
  Сбор: 'Rally',
  Разведка: 'Scan',
  'Раскрывает зону вокруг цели сквозь туман на время.':
    'Reveals an area around the target through the fog for a while.',
  Отзыв: 'Recall',
  'Мгновенно отзывает корабль-героя в столицу.': 'Instantly recalls the hero ship to the capital.',
  Бастион: 'Bulwark',

  // --- ship modules (SHIP_MODULES, ships.ts) -------------------------------------

  // --- ship hull names (SHIP_HULLS, ships.ts) -------------------------------------

  // --- lowercase fragments -------------------------------------------------------
  атака: 'attack',
  'в очередь: {what} на {at}': 'queued: {what} at {at}',
  высадка: 'landing',
  гарнизон: 'garrison',
  десант: 'landing',
  'доминированием в галактике': 'by galactic domination',
  'достижением лимита очков': 'by score limit',
  завершён: 'ended',
  идёт: 'active',
  'истечением времени': 'on the clock',
  казна: 'treasury',
  кораблей: 'ships',
  корабль: 'ship',
  'матч завершён': 'the match has ended',
  'на орбите': 'in orbit',
  'неизвестный заказ': 'unknown order',
  'в гарнизоне не осталось': 'none left in the garrison',
  нет: 'none',
  'трюм полон': 'the hold is full',
  'новый флот: {a} кораблей · у исходного останется {b}':
    'new fleet: {a} ships · original keeps {b}',
  'обновления доступны только в APK': 'updates are only available in the APK',
  оборона: 'defense',
  орбита: 'orbit',
  'прицеливание отменено': 'aiming cancelled',
  'проверка: {msg}': 'check: {msg}',
  пусто: 'empty',
  роль: 'role',
  'сборка {b}': 'build {b}',
  секторов: 'sectors',
  скоро: 'soon',
  убрать: 'remove',
  'уничтожением соперников': 'by eliminating rivals',
  вы: 'you',
  флот: 'fleet',
  флоты: 'fleets',
  оз: 'hp',
  цена: 'price',
  '◆ новый радарный контакт ({size}) у {at}': '◆ new radar contact ({size}) at {at}',
  '● отключён от сервера': '● disconnected from server',
  '● подключён как {who}': '● connected as {who}',
  '● связь потеряна — переподключение…': '● connection lost — reconnecting…',
  // combat forecast (ONB-6, fleet panel strike section)
  '⚠ Враг идёт к {node}: прибытие через {dur}':
    '⚠ An enemy is heading for {node}: arrival in {dur}',
  '⚠ Враг у {node}!': '⚠ An enemy at {node}!',
  '⚔ штурм': '⚔ assault',
  '⛬ выберите флот для объединения': '⛬ pick a fleet to merge with',
  '✓ актуально · локально {l} · сервер {r}': '✓ up to date · local {l} · server {r}',
  '✗ GitHub ответил {s}': '✗ GitHub answered {s}',
  '✗ нет связи с GitHub (сеть / VPN?)': "✗ can't reach GitHub (network / VPN?)",
  '✗ ответ получен, но версия не распознана': "✗ got a response, but couldn't parse the version",
  '✦ {score}/{limit}: мир — 50, прочий сектор — 10, здания добавляют по уровню (у вас {w} миров, {s} секторов). Победа: ✦ {limit}, уничтожение соперников или доминирование.':
    '✦ {score}/{limit}: a world — 50, any other province — 10, buildings add per level (you hold {w} worlds, {s} provinces). Win at ✦ {limit}, by eliminating rivals, or by domination.',
  '⬇ есть обновление → сборка {v}': '⬇ update available → build {v}',
  '🎯 автоприцел': '🎯 auto-target',
  '🎯 сосредоточенный огонь назначен': '🎯 focus fire set',
  '🎯 тапните вражеский флот для сосредоточенного огня · пустота = авто':
    '🎯 tap an enemy fleet to focus fire · empty space = auto',
  Флоты: 'Fleets',
  'В меню': 'Menu',
  '🛩 дежурный вылет включён — эскадрилья бьёт врага в радиусе':
    '🛩 standing patrol on — the wing strikes any enemy in range',
  '🛩 дежурный вылет — только со стоянки в узле': '🛩 standing patrol — only from a parked node',
  '🛩 дежурный вылет — только когда флот свободен':
    '🛩 standing patrol — only when the fleet is free',
  '🛩 эскадрилья запущена — ведите её на цель': '🛩 squadron launched — steer it onto the target',

  // --- static markup (build.mjs, data-i18n) -------------------------------------
  Аккаунт: 'Account',
  Верфь: 'Shipyard',
  Домой: 'Home',
  Ещё: 'More',
  'Введи имя командира': 'Enter a commander name',
  'Пароли не совпадают': 'Passwords do not match',
  'Введите почту': 'Enter an email',
  'Если такая почта есть — прислали ссылку для сброса':
    'If that email exists, a reset link is on its way',
  'Ссылка недействительна или устарела': 'The link is invalid or expired',
  'Пароль изменён': 'Password changed',
  'переподключение — приказ не отправлен, повторите позже':
    'reconnecting — order not sent, try again shortly',
  'матч заполнен — все места заняты': 'match is full — every seat is taken',
  'вход в этот матч закрыт (окно приёма новых игроков истекло)':
    'this match is closed to new players (the entry window has elapsed)',
  Поддержка: 'Support',
  Сообщество: 'Community',
  Уведомления: 'Notifications',
  Чат: 'Chat',
  позывной: 'callsign',
  'реальное время': 'real time',
  '{ic} {name}: {stock} в казне · {flow}/ч (производство минус содержание войск и зданий)':
    '{ic} {name}: {stock} in the treasury · {flow}/h (production minus army and building upkeep)',
  '⚠ ДЕФИЦИТ — здания-потребители работают на 50%': '⚠ SHORTAGE — consuming buildings run at 50%',
  'состав {n}/{s} · {rest}': 'composition {n}/{s} · {rest}',
  'Мобилизовать «{name}»': 'Mobilize "{name}"',
  // --- meta-progression («Прокачка», hub tab) -----------------------------------
  Прокачка: 'Progression',
  'Уровень {n}': 'Level {n}',
  '{got}/{need} XP': '{got}/{need} XP',
  'Очков: {n}': 'Points: {n}',
  '{n} очк.': '{n} pt.',
  Изучить: 'Unlock',
  Закрыто: 'Locked',
  'Опыт даётся за завершённые матчи: участие + счёт + победа. Прокачка не продаётся — только игра.':
    'XP comes from finished matches: participation + score + victory. Progression is never sold — play only.',
  Командование: 'Command',
  Экономика: 'Economy',
  Наука: 'Science',
  // --- arsenal witryna («Арсенал», hub tab, ARS-5) --------------------------------
  'Арсенал пуст': 'Arsenal empty',
  'войдите под аккаунтом на сервере с накоплением, чтобы увидеть коллекцию':
    'sign in with an account on a server with persistence to see your collection',
  Всё: 'All',
  Корпуса: 'Hulls',
  Фитинги: 'Fittings',
  стартовый: 'starter',
  дроп: 'drop',
  крафт: 'craft',
  аукцион: 'auction',
  лутбокс: 'lootbox',
  аренда: 'rent',
  модуль: 'module',
  'Ходовые школы': 'Helm Schools',
  '+5% к скорости всех флотов с первой секунды матча.':
    '+5% fleet speed from the first second of a match.',
  'Слаженные экипажи': 'Drilled Crews',
  '+5% к урону флотов и гарнизонов.': '+5% damage for fleets and garrisons.',
  'Дальняя разведка': 'Deep Recon',
  '+15% к радиусу всех радаров.': '+15% to every radar radius.',
  'Ветеран кампаний': 'Campaign Veteran',
  'Ещё +5% к скорости и урону — рефлексы старой гвардии.':
    "Another +5% speed and damage — the old guard's reflexes.",
  Хозяйственник: 'Quartermaster',
  '+10% к стартовой казне каждого матча.': '+10% starting treasury every match.',
  Индустриализация: 'Industrialization',
  '+5% к производству всех миров.': '+5% production on all worlds.',
  Госрезерв: 'State Reserve',
  'Ещё +20% к стартовой казне.': 'Another +20% starting treasury.',
  Магнат: 'Magnate',
  'Ещё +5% к производству — империя работает на вас.':
    'Another +5% production — the empire works for you.',
  Аспирантура: 'Postgraduate School',
  'Учёные совета начинают матч на +1 уровень.': 'Council scientists start the match +1 level.',
  'Открытый архив': 'Open Archive',
  '«Промышленная автоматизация» изучена с первой секунды.':
    '"Industrial Automation" is researched from the first second.',
  'Сеть институтов': 'Institute Network',
  'Учёные совета — ещё +1 уровень.': 'Council scientists — another +1 level.',
  'Орбитальная кафедра': 'Orbital Faculty',
  '«Орбитальная логистика» изучена с первой секунды.':
    '"Orbital Logistics" is researched from the first second.',
  // --- H4: ground-army designer (3 infantry lines + tank, officer premades) -------
  Мобилизация: 'Mobilization',
  '⚙ Конструктор': '⚙ Designer',
  Переименовать: 'Rename',
  'Урон по:': 'Damage vs:',
  живучесть: 'toughness',
  Ополчение: 'Militia',
  'Тяжёлая пехота': 'Heavy Infantry',
  Спецназ: 'Special Forces',
  Рейд: 'Raid',
  'Гвардия прорыва': 'Breakthrough Guard',
  'Железный рубеж': 'Iron Line',
  'Колонна снабжения': 'Supply Column',
  Штурмовик: 'Assault Leader',
  'Командир обороны': 'Defense Commander',
  Снабженец: 'Quartermaster',
  'Рейдовая доктрина': 'Raid Doctrine',
  '≥2 спецназа без ополчения': '≥2 special forces, no militia',
  'Людская волна': 'Human Wave',
  '≥4 ополчения — берут числом': '≥4 militia — winning by numbers',
  'Именной шаблон офицера: состав закреплён, редактировать нельзя.':
    "An officer's named template: composition locked, no editing.",
  'Дивизия — снапшот шаблона: правка шаблона в конструкторе не меняет уже собранные. На своём мире +1 HP/юнит/день.':
    'A division is a snapshot of its template: editing a design never touches armies already fielded. On your own world it heals +1 HP/unit/day.',
  Дивизия: 'Division',
  Гарнизон: 'Garrison',
  'Тап по слоту меняет род войск: ополчение → тяжёлая пехота → спецназ → танк. Танки бьют любую пехоту; спецназ — единственная пехота, опасная танкам; тяжёлая пехота держит оборону.':
    'Tap a slot to cycle the unit type: militia → heavy infantry → special forces → tank. Tanks shred any infantry; special forces are the one infantry that threatens armour; heavy infantry holds the line.',

  // --- command chains (order queue / plan builder, CC-*) -----------------------
  '⚒ десант': '⚒ ground',
  '⚔ орбита': '⚔ orbital',

  // --- bot favour meter / stolen intel readout ----------------------------------

  // --- province pings / connect screen status -----------------------------------
  'метка {node}': 'marker {node}',
  'Подключение: {nick}…': 'Connecting: {nick}…',
  'Укажи адрес сервера': 'Enter the server address',
  'Неверный адрес сервера': 'Invalid server address',
  'Введи позывной': 'Enter a callsign',

  // --- science council (pre-match scientist pick + tech-window header) -------------
  'Выбрать учёного': 'Pick a scientist',
  '⚠ Совет закрепляется на весь матч. Рекомендованная пара уже выбрана — замените по вкусу.':
    '⚠ The council locks in for the whole match. A recommended pair is pre-selected — swap to taste.',
  'Кандидаты · нажмите, чтобы занять слот': 'Candidates · tap to fill a slot',
  'Закрепить и продолжить к выбору места →': 'Lock in and continue to start pick →',
  'Выберите двух учёных': 'Pick two scientists',
  '+1 слот исследования (генералист, без фокуса ветки)':
    '+1 research slot (a generalist, no branch focus)',
  'Открывает ветку «{br}»: {list}': 'Opens the {br} branch: {list}',
  'Фокус ветки «{br}»': '{br} branch focus',
  // --- tech-branch labels (tabs / chips / section heads) ---------------------------
  Эскадрильи: 'Squadrons',
  'Дом: {home} — одиночная песочница, без соперников · тапните светящийся мир, чтобы сменить':
    'Home: {home} — a solo sandbox, no rivals · tap another glowing world to change',
  'Дом: {home} — тапните другой светящийся мир, чтобы сменить':
    'Home: {home} — tap another glowing world to change',
  // --- rail icon labels + window headers -------------------------------------------
  Дипло: 'Diplo',
  Сон: 'Sleep',
  Корп: 'Corp',
  ДИПЛОМАТИЯ: 'DIPLOMACY',

  // --- steward window («Хранитель») + settings + end-of-match ---------------------
  '🏃 Эвакуация с {node} → {to}: прогноз потерь {pct}%, крыльев уведено: {n}':
    '🏃 Evacuation from {node} → {to}: loss forecast {pct}%, wings withdrawn: {n}',
  '🚚 Паром выслан к {node} за гарнизоном': '🚚 A ferry dispatched to {node} for the garrison',
  '⚠ Гарнизон {node} не эвакуировать: транспорт не успевает (прогноз потерь {pct}%)':
    '⚠ The {node} garrison cannot be evacuated: no transport arrives in time (loss forecast {pct}%)',
  интерфейс: 'interface',
  вкл: 'on',
  выкл: 'off',
  '⟳ К выбору ботов': '⟳ Back to setup',

  // --- suggested-callsign wordlist -----------------------------------------------
  Носорог: 'Rhino',
  Комета: 'Comet',
  Гадюка: 'Viper',
  Орион: 'Orion',
  Вектор: 'Vector',
  Сокол: 'Falcon',
  Титан: 'Titan',
  Квазар: 'Quasar',
  // --- constructor («Верфь») — the unified loadout tab ------------------------
  Корабли: 'Ships',
  Армия: 'Army',
  Оружие: 'Weapon',
  Защита: 'Defense',
  Система: 'System',
  // stat / resource words used by the module-effect chips and cost lines
  корпус: 'hull',
  щит: 'shield',
  скорость: 'speed',
  трюм: 'cargo',
  радар: 'radar',
  металла: 'metal',
  кредитов: 'credits',
  энергии: 'energy',
  еды: 'food',
  микроэлектроники: 'microelectronics',
  // --- hero window / deploy flow (окно героя, развёртывание) --------------------
  'КД {h}': 'CD {h}',
  '✨ выберите мир-цель на карте': '✨ pick a target world on the map',
  '✖ каст отменён': '✖ cast cancelled',
  '✖ развёртывание отменено': '✖ deploy cancelled',
  // --- division / formation builder (конструктор дивизий) ----------------------
  // --- build ETA / misc --------------------------------------------------------
  Стройка: 'Building',
  'Ещё раз «Назад» — выход из матча': 'Press Back again to leave the match',
  // --- static H4 headers / steward toggle (build.mjs [data-i18n]) --------------
  // --- Bytro-карточка армии: ХП-бар, сводка, платный ремонт, кап линии огня ----
  флагман: 'flagship',
  рой: 'swarm',
  'форс-марш': 'forced march',
  Радар: 'Radar',
  // --- настройки: цвета сторон -------------------------------------------------
  // --- ECON-3: экспресс-ремонт за металл ---------------------------------------
  // --- ECON-4: рыночная комиссия ------------------------------------------------
  // --- fleet-command hover tooltips (what each command button does) -------------
  'флот сам штурмует вражеский мир по прибытии':
    'the fleet storms an enemy world by itself on arrival',
  // --- REL-7 seat/faction picker ------------------------------------------------

  // --- sandbox panel (dev-only build, prototype/src/sandbox.ts) ----------------
  ПЕСОЧНИЦА: 'SANDBOX',
  Переключатели: 'Toggles',
  Команды: 'Commands',
  'Прекратить войну со всеми фракциями': 'End the war with every faction',
  'Войны прекращены: {n} — отношения нейтральные': 'Wars ended: {n} — relations are neutral',
  'Вы ни с кем не воюете': 'You are not at war with anyone',
  'нет игрока': 'no player',
};
