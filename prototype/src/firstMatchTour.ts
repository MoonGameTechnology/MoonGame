/**
 * ONB-2 · Обучение основной игры — цепочка шагов (движок ONB-1) поверх живого HUD:
 *
 *   камера → экономика (улучшить добычу) → исследование (оборонная технология) →
 *   корабль → оборона (форт) → рейд соперника отбит → слежка (шпионаж его мира) →
 *   нападение (курс на его мир) → захват → победа (экран конца матча).
 *
 * Заказ владельца 2026-10-16: «игрок полностью изучил основы защиты, слежки, нападения,
 * навыки прокачки, постройки кораблей и зданий хотя бы на минимум всё»; «обучение ускорено
 * и не занимает много времени»; «при каждом новом действии здание или иконка, куда надо
 * нажать, подсвечивалась золотым свечением, и пока он не выбрал это, ничего больше сделать
 * нельзя»; «одинаково удобно в браузере и на телефоне».
 *
 * Правила цепочки:
 *
 * 1. **Каждый шаг, где есть что нажать, запирает экран на этой цели** (`gate`,
 *    `tourGate.ts`). Цель — кнопка HUD или точка КАРТЫ (`mapTarget`: мир, флот), над
 *    которой хост ставит якорь. Шаги без цели — ожидание (стройка, перелёт, бой): нажимать
 *    там нечего, и экран свободен, чтобы смотреть на карту.
 * 2. **Шаг закрывает дело, а не «Далее».** Приказ (`action`) или состояние мира (`state`);
 *    «Далее» — только у шагов-объяснений.
 * 3. **«Вернуть место» — шаг-страховка, которого игрок обычно не видит.** Окно исследований
 *    закрывает панель мира, на телефоне карточка сворачивается. Шаг «откройте свой мир»
 *    перед вкладкой заказа засчитывается в тот же кадр, если мир и так открыт, — движок
 *    проверяет `state` на входе (`spotlight.ts`).
 * 4. **Одна цель на ПК и телефоне.** Где кнопка живёт в разных узлах (наука — `#holo-tech`
 *    на ПК, вкладка нижней панели на телефоне), селектор перечисляет оба места, хост берёт
 *    видимое. Телефонный шаг «Сведения» есть только в раскладке карточкой.
 * 5. **Соперник подыгрывает** (`decisions/tutorialRival.ts`): пока строится корабль, он
 *    выходит в рейд одним кораблём — к его прилёту на орбите у игрока два, — а его мир
 *    пуст и берётся первым кораблём на орбите. Когда начинать рейд, говорит `raidStarted`.
 *
 * Технология и постройка обороны — ниже константами: тест держит их против данных, чтобы
 * правка `data/*.json` не оставила шаг указывать на кнопку, которой больше нет.
 */
import { mapGestures } from '../../decisions/mapGestures';
import { MAP_ANCHOR, type MapTarget, type SpotlightStep } from './spotlight';

/** Оборонная технология урока исследований: открывает форт. */
export const DEFENSE_TECH = 'field_fortification';
/** Ветка этой технологии — вкладка окна исследований. */
export const DEFENSE_BRANCH = 'ground';
/** Оборонная постройка урока обороны. */
export const DEFENSE_BUILDING = 'fort';

/** Шаг, с которого соперник выходит в рейд (правило 5): пока корабль строится. Перелёт
 *  рейда — несколько часов мира, и он идёт, пока игрок изучает форт и разведку, а не
 *  после них: обучение не стоит в ожидании. */
const RAID_STEP = 'fleet';

export interface FirstMatchDeps {
  /** ПК-раскладка: настоящая мышь и широкий экран (`pcUi`) — от неё зависят жесты карты
   *  на шаге `nav` (`decisions/mapGestures.ts`, правило 1). */
  mouse: () => boolean;
  /** Мир открывается карточкой (телефонная раскладка): постройки в ней спрятаны под
   *  «Сведения». Читается один раз, когда тур собирается. */
  cardLayout: () => boolean;
  /** Родной мир игрока. */
  home: () => string | null;
  /** Мир соперника. */
  rival: () => string | null;
  /** Свой флот у родного мира — его ведут в атаку. */
  strikeFleet: () => string | null;
  /** Летящий к игроку флот соперника (рейд); `null` — рейда нет или он разбит. */
  raidFleet: () => string | null;
  /** Открыта панель родного мира. */
  homeOpened: () => boolean;
  /** Карточка мира развёрнута «Сведениями». */
  panelOpen: () => boolean;
  /** Открыто окно исследований. */
  techOpen: () => boolean;
  /** Активная вкладка-ветка окна исследований. */
  techTab: () => string | null;
  /** Оборонная технология изучена. */
  techDone: () => boolean;
  /** True while the world panel shows its «Корабли» tab (where ships are ordered). */
  shipsTabOpen: () => boolean;
  /** Панель мира на вкладке построек. */
  buildingsTabOpen: () => boolean;
  /** Открыто окно каталога (здания или юниты мира). */
  buildWinOpen: () => boolean;
  /** True once the player has raised a mobile fleet (a built ship auto-rallies to orbit). */
  hasFleet: () => boolean;
  /** Рейд соперника отбит: у него не осталось кораблей. */
  raidBeaten: () => boolean;
  /** Открыта панель мира соперника. */
  rivalOpened: () => boolean;
  /** Выбран свой флот. */
  fleetSelected: () => boolean;
  /** Взведён прицел «Курс». */
  moveArmed: () => boolean;
  /** Телефон: цель курса выбрана, приказ ждёт «Отправить». */
  draftStaged: () => boolean;
  /** True once the player owns a world beyond their start (the rival's world was taken). */
  capturedWorld: () => boolean;
}

/** Точка карты по id, если он есть. */
const at = (kind: MapTarget['kind'], id: () => string | null) => (): MapTarget | null => {
  const found = id();
  return found ? { kind, id: found } : null;
};

/**
 * Шаг «нажмите эту точку карты» — запертый на якоре над ней. Тап по месту, где стоят мир
 * и его флоты, на телефоне открывает выбор «что именно» (`mobileHud.ts`): тогда цель —
 * строка нужного вида в этом выборе. Выбор стоит в документе раньше якоря, поэтому
 * видимый выбор и выигрывает (хост берёт первое видимое из списка).
 */
function onMap(
  id: string,
  copy: string,
  kind: MapTarget['kind'],
  of: () => string | null,
  advance: SpotlightStep['advance'],
): SpotlightStep {
  return {
    id,
    target: `#mobile-sheet .mobile-choices [data-kind="${kind}"], ${MAP_ANCHOR}`,
    mapTarget: at(kind, of),
    copy,
    advance,
    gate: true,
  };
}

/** Шаг «нажмите эту кнопку» — запертый на ней. */
function press(
  id: string,
  target: string,
  copy: string,
  advance: SpotlightStep['advance'],
): SpotlightStep {
  return { id, target, copy, advance, placement: 'auto', gate: true };
}

/** Цепочка обучения основной игры. */
export function buildFirstMatchTour(deps: FirstMatchDeps): SpotlightStep[] {
  const state = (when: () => boolean): SpotlightStep['advance'] => ({ on: 'state', when });
  const rival = at('planet', deps.rival);
  // На телефоне постройки и заказы мира лежат под «Сведениями» карточки (правило 4).
  const details = (id: string): SpotlightStep[] =>
    deps.cardLayout()
      ? [
          press(
            id,
            '#mobile-sheet .mobile-quick [data-mobile="details"]',
            'onb.tour.first.details',
            state(deps.panelOpen),
          ),
        ]
      : [];
  return [
    { id: 'welcome', target: null, copy: 'onb.tour.first.welcome', advance: { on: 'tap' } },
    {
      // Как вообще смотреть на мир (ONB-11) — шаг стоит ПЕРВЫМ, до всех дел. Жесты
      // показаны анимацией (UIX-8.1). Экран не заперт — жесты пробуют, пока подсказка на
      // виду (`tourGate.ts`, правило 5).
      id: 'nav',
      target: null,
      copy: 'onb.tour.first.nav',
      advance: { on: 'tap' },
      hands: true,
      gestures: mapGestures(deps.mouse()),
    },
    // --- экономика ---
    onMap('home', 'onb.tour.first.home', 'planet', deps.home, state(deps.homeOpened)),
    ...details('details'),
    // Стартовый мир уже несёт Металлодобычу L1 (matchSetup.ts), поэтому урок экономики —
    // её улучшение. Улучшение живёт в карточке постройки (BUILD-1): строка открывает
    // карточку с «Улучшить». Уровень входит в значение (`b:mine:1`) — цель по префиксу.
    press('mine', '[data-codex^="b:mine:"]', 'onb.tour.first.mine', {
      on: 'action',
      type: 'building.upgrade',
    }),
    // --- исследования ---
    press(
      'tech-open',
      '#holo-tech, #phone-nav [data-phone-tab="science"], #rail-tech',
      'onb.tour.first.tech-open',
      state(deps.techOpen),
    ),
    press(
      'tech-branch',
      `#tech [data-ttab="${DEFENSE_BRANCH}"]`,
      'onb.tour.first.tech-branch',
      state(() => deps.techTab() === DEFENSE_BRANCH),
    ),
    // Окно закрывает хост, как только шаг ушёл из него (`followTutorStep`, main.ts):
    // отдельный шаг «закройте окно» только удлинял бы обучение.
    press('tech-research', `#tech [data-go="${DEFENSE_TECH}"]`, 'onb.tour.first.tech-research', {
      on: 'action',
      type: 'technology.research',
    }),
    // --- корабль ---
    onMap('home-ships', 'onb.tour.first.home', 'planet', deps.home, state(deps.homeOpened)),
    ...details('details-ships'),
    // «Постройте корабль» само по себе НЕ инструкция (живой отзыв: «там построй корабль —
    // какой, у нас же их нет»). Три места по порядку: вкладка «Флот» панели мира, кнопка
    // каталога на ней, строка заказа в окне каталога — первая доступная, какой бы корабль
    // ни стоял первым: ростер собирается из данных (`buildRoster`).
    press(
      'ships-tab',
      '[data-act="tab"][data-arg="ships"]',
      'onb.tour.first.ships-tab',
      state(deps.shipsTabOpen),
    ),
    press(
      'units-open',
      '[data-act="openunits"][data-arg="ships"]',
      'onb.tour.first.units-open',
      state(deps.buildWinOpen),
    ),
    press('ship', '#buildwin [data-unit-go]:not([disabled])', 'onb.tour.first.ship', {
      on: 'action',
      type: 'unit.build',
    }),
    // Ждём, пока корабль достроится и сам выйдет на орбиту: нажимать нечего.
    { id: RAID_STEP, target: null, copy: 'onb.tour.first.fleet', advance: state(deps.hasFleet) },
    // --- оборона ---
    // Исследование идёт часами мира; на ускоренном времени оно почти всегда готово к этому
    // шагу, и шаг засчитывается сразу (правило 3).
    {
      id: 'tech-wait',
      target: null,
      copy: 'onb.tour.first.tech-wait',
      advance: state(deps.techDone),
    },
    onMap('home-build', 'onb.tour.first.home', 'planet', deps.home, state(deps.homeOpened)),
    ...details('details-build'),
    press(
      'build-tab',
      '[data-act="tab"][data-arg="buildings"]',
      'onb.tour.first.build-tab',
      state(deps.buildingsTabOpen),
    ),
    press(
      'build-open',
      '[data-act="openbuild"]',
      'onb.tour.first.build-open',
      state(deps.buildWinOpen),
    ),
    press('fort', `#buildwin [data-bw-go="${DEFENSE_BUILDING}"]`, 'onb.tour.first.fort', {
      on: 'action',
      type: 'building.construct',
    }),
    // --- слежка: пока рейд летит, смотрим, кто напал ---
    onMap('spy-open', 'onb.tour.first.spy-open', 'planet', deps.rival, state(deps.rivalOpened)),
    ...details('details-spy'),
    press('spy', '[data-act="spyplanet"]', 'onb.tour.first.spy', {
      on: 'action',
      type: 'espionage.spy',
    }),
    {
      // Бой идёт сам: корабли на орбите и форт встречают рейд. Кольцо держит летящий
      // флот соперника, но экран свободен — нажимать нечего, а смотреть на бой можно.
      id: 'raid',
      target: MAP_ANCHOR,
      mapTarget: at('fleet', deps.raidFleet),
      copy: 'onb.tour.first.raid',
      advance: state(deps.raidBeaten),
    },
    // --- нападение ---
    { id: 'troops', target: null, copy: 'onb.tour.first.troops', advance: { on: 'tap' } },
    onMap(
      'pick-fleet',
      'onb.tour.first.pick-fleet',
      'fleet',
      deps.strikeFleet,
      state(deps.fleetSelected),
    ),
    // Курс — два нажатия: «Курс» в карточке флота взводит прицел, мир соперника его
    // принимает. На телефоне прицел ставит черновик, и приказ уходит кнопкой «Отправить».
    press('move-btn', '[data-cmd="move"]', 'onb.tour.first.move-btn', state(deps.moveArmed)),
    ...(deps.cardLayout()
      ? [
          onMap('course', 'onb.tour.first.course', 'planet', deps.rival, state(deps.draftStaged)),
          press('send', '[data-cmd="mobile-send"]:not([disabled])', 'onb.tour.first.send', {
            on: 'action',
            type: 'fleet.move',
          }),
        ]
      : [
          onMap('course', 'onb.tour.first.course', 'planet', deps.rival, {
            on: 'action',
            type: 'fleet.move',
          }),
        ]),
    // Последний шаг: взятый мир — последний мир соперника, партия кончается победой, и
    // итог показывает экран конца матча. Шаг «Понятно» после него стоял бы ПОД этим
    // экраном (найдено прогоном: подсказка ниже окна итогов, и нажать её нельзя).
    {
      id: 'capture',
      target: MAP_ANCHOR,
      mapTarget: rival,
      copy: 'onb.tour.first.capture',
      advance: state(deps.capturedWorld),
    },
  ];
}

/** Шаги, которые САМИ выбирают точку карты (мир, флот). Перед ними хост снимает выбор:
 *  открытая панель прошлого шага лежит поверх карты и закрывала бы точку. Шаг курса сюда
 *  не входит — ему нужен флот, выбранный шагом раньше. */
export const PICK_STEPS: ReadonlySet<string> = new Set([
  'home',
  'home-ships',
  'home-build',
  'spy-open',
  'pick-fleet',
]);

/** Пора ли сопернику в рейд (правило 5): обучение дошло до урока обороны или дальше. */
export function raidStarted(steps: readonly SpotlightStep[], stepId: string | null): boolean {
  if (stepId === null) return false;
  const now = steps.findIndex((s) => s.id === stepId);
  const raid = steps.findIndex((s) => s.id === RAID_STEP);
  return now >= 0 && raid >= 0 && now >= raid;
}
