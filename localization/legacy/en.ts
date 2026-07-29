// ENGLISH locale: a flat map from the canonical Russian msgid to the English
// translation. A missing entry falls back to the Russian source (visible, honest).
// Game-DATA names (buildings/units/technologies/sectors/planet types — authored in
// English in game.ts) need no entry here; `tData()` shows them as-is on this locale.
// One language = one file.
export const en: Record<string, string> = {
  // --- STAFF-1 «Штаб героев» redesign -------------------------------------------
  резерв: 'reserve',
  способностей: 'abilities',
  актив: 'active',
  Требует: 'Requires',
  // NB: `Изучить` is translated once, in the meta-progression block below ('Unlock')
  // — a second entry here would be silently shadowed by it.
  // --- TT-3.1 technology tree screen --------------------------------------------
  старт: 'start',
  день: 'day',
  Автоматизация: 'Automation',
  урон: 'damage',
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
  // TGT-1: target-order composer

  // --- fleet panel / command bar ------------------------------------------------
  Атака: 'Attack',
  Все: 'All',
  Вы: 'You',
  '{h}ч': '{h}h',
  ИИ: 'AI',
  Герои: 'Heroes',
  Командир: 'Commander',
  Крейсер: 'Cruiser',
  Назад: 'Back',
  'Управление скоростью': 'Speed control',
  'панель времени в матче — пауза и множители ускорения (1× — реальное время)':
    'the in-match time bar — pause and speed multipliers (1× is real time)',
  Оборона: 'Defense',
  Обстрел: 'Barrage',
  ПВО: 'AA',
  Пассив: 'Passive',
  Постройки: 'Structures',
  Скор: 'Spd',
  Скорость: 'Speed',
  Станд: 'Std',
  Удар: 'Strike',
  Флот: 'Fleet',
  // Авто-имена флотов (Bytro-стиль): тип соединения по размеру
  Звено: 'Wing',
  Эскадрилья: 'Flight',
  Эскадра: 'Squadron',
  Армада: 'Armada',
  // Карточка статистики мира (тап по имени планеты)
  эскадрилий: 'squadrons',
  // 🔥 режим огня артиллерии — кнопка в командном ряду + пункты меню
  // H3 — setup faction picker (pure passive house bonuses)
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
  'в матче': 'in a match',

  // --- corporation cabinet (AVA-C1/C2, live) ------------------------------------
  AvA: 'AvA',
  готов: 'ready',
  победа: 'victory',
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
  высадка: 'landing',
  гарнизон: 'garrison',
  десант: 'landing',
  казна: 'treasury',
  кораблей: 'ships',
  корабль: 'ship',
  'на орбите': 'in orbit',
  нет: 'none',
  оборона: 'defense',
  орбита: 'orbit',
  пусто: 'empty',
  секторов: 'sectors',
  скоро: 'soon',
  вы: 'you',
  флот: 'fleet',
  флоты: 'fleets',
  оз: 'hp',
  цена: 'price',
  // combat forecast (ONB-6, fleet panel strike section)
  Флоты: 'Fleets',
  'В меню': 'Menu',

  // --- static markup (build.mjs, data-i18n) -------------------------------------
  Аккаунт: 'Account',
  Верфь: 'Shipyard',
  Ещё: 'More',
  Поддержка: 'Support',
  Сообщество: 'Community',
  Уведомления: 'Notifications',
  Чат: 'Chat',
  'реальное время': 'real time',
  // --- meta-progression («Прокачка», hub tab) -----------------------------------
  '{got}/{need} XP': '{got}/{need} XP',
  Командование: 'Command',
  Экономика: 'Economy',
  Наука: 'Science',
  // --- arsenal witryna («Арсенал», hub tab, ARS-5) --------------------------------
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
  Гарнизон: 'Garrison',

  // --- command chains (order queue / plan builder, CC-*) -----------------------

  // --- bot favour meter / stolen intel readout ----------------------------------

  // --- province pings / connect screen status -----------------------------------

  // --- science council (pre-match scientist pick + tech-window header) -------------
  // --- tech-branch labels (tabs / chips / section heads) ---------------------------
  // --- rail icon labels + window headers -------------------------------------------
  Дипло: 'Diplo',
  Сон: 'Sleep',
  ДИПЛОМАТИЯ: 'DIPLOMACY',

  // --- steward window («Хранитель») + settings + end-of-match ---------------------
  интерфейс: 'interface',
  вкл: 'on',

  // --- suggested-callsign wordlist -----------------------------------------------
  // --- constructor («Верфь») — the unified loadout tab ------------------------
  Армия: 'Army',
  Система: 'System',
  // stat / resource words used by the module-effect chips and cost lines
  корпус: 'hull',
  щит: 'shield',
  скорость: 'speed',
  трюм: 'cargo',
  радар: 'radar',
  // --- hero window / deploy flow (окно героя, развёртывание) --------------------
  // --- division / formation builder (конструктор дивизий) ----------------------
  // --- build ETA / misc --------------------------------------------------------
  Стройка: 'Building',
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
  // --- REL-7 seat/faction picker ------------------------------------------------

  // --- sandbox panel (dev-only build, prototype/src/sandbox.ts) ----------------
};
