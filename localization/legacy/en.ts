// ENGLISH locale: a flat map from the canonical Russian msgid to the English
// translation. A missing entry falls back to the Russian source (visible, honest).
// Game-DATA names (buildings/units/technologies/sectors/planet types — authored in
// English in game.ts) need no entry here; `tData()` shows them as-is on this locale.
// One language = one file.
export const en: Record<string, string> = {
  // --- STAFF-1 «Штаб героев» redesign -------------------------------------------
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
  Оборона: 'Defense',
  Обстрел: 'Barrage',
  ПВО: 'AA',
  Пассив: 'Passive',
  Скор: 'Spd',
  Скорость: 'Speed',
  Станд: 'Std',
  Удар: 'Strike',
  Флот: 'Fleet',
  // Авто-имена флотов (Bytro-стиль): тип соединения по размеру
  // Карточка статистики мира (тап по имени планеты)
  эскадрилий: 'squadrons',
  // 🔥 режим огня артиллерии — кнопка в командном ряду + пункты меню
  // H3 — setup faction picker (pure passive house bonuses)

  // --- market resource tabs (MARKET_RES) -----------------------------------------

  // --- diplomatic stance (STANCE_RU, via stanceRu()) ---------------------------
  Союз: 'Alliance',

  // --- kernel rejection codes (ERR_RU, via errText()) --------------------------
  'боты не вступают в коалиции': 'bots do not join coalitions',

  // --- corp mock panel (role/presence dictionaries, CORP_TABS) ------------------

  // --- corporation cabinet (AVA-C1/C2, live) ------------------------------------
  AvA: 'AvA',
  победа: 'victory',
  состав: 'roster',
  '—': '—',

  // --- preset hero names (HeroLoadout, non-main; heroName() via t()) -----------
  Разрушитель: 'Destroyer',
  Авангард: 'Vanguard',
  Страж: 'Sentinel',

  Танк: 'Tank',
  // formation doctrines (formationStats, game.ts) — organisational labels, no combat bonus (BF-23)
  // preset division template names (setupTemplates, game.ts)

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
  Поддержка: 'Support',
  Сообщество: 'Community',
  Уведомления: 'Notifications',
  Чат: 'Chat',
  'реальное время': 'real time',
  // --- meta-progression («Прокачка», hub tab) -----------------------------------
  '{got}/{need} XP': '{got}/{need} XP',
  // --- arsenal witryna («Арсенал», hub tab, ARS-5) --------------------------------
  модуль: 'module',
  // --- H4: ground-army designer (3 infantry lines + tank, officer premades) -------
  Ополчение: 'Militia',
  'Тяжёлая пехота': 'Heavy Infantry',
  Спецназ: 'Special Forces',
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
  трюм: 'cargo',
  радар: 'radar',
  // --- hero window / deploy flow (окно героя, развёртывание) --------------------
  // --- division / formation builder (конструктор дивизий) ----------------------
  // --- build ETA / misc --------------------------------------------------------
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
