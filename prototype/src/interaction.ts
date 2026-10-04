/**
 * Что выбрано и что значит следующий тап: выбор (REFM-208) и прицелы, режимы и окна
 * командного ряда (REFM-207) — у одного владельца.
 *
 * Шестнадцать флагов жили `let`'ами в `main.ts`, и писали их ≈110 мест, каждое со своим
 * рукописным списком «что погасить заодно». Списки разошлись: смена матча в соло гасила
 * одно, в сети другое, прицел героя переживал Back. Теперь флаг меняют только функции
 * ниже, а что гаснет по какому поводу, решает таблица `decisions/armDisarm.ts`.
 *
 * Выбор — выделенные флоты или мир, осмотр чужого флота, цель мобильного приказа и список
 * «флот или мир» — писали ≈45 мест, а чистка после смены мира была написана дважды: для
 * хода локального мира и для снимка сервера, и сетевая копия не закрывала окно деления и
 * ⇅-меню погибшего флота. Теперь выбор меняют функции ниже, а забывают его поводы таблицы
 * (правило 16).
 *
 * `main.ts` читает всё это как прежде — это `export let`, живая привязка. Записать мимо
 * владельца не даст компилятор: присваивание импорту — ошибка TS. Содержимое открытого
 * окна (сколько кораблей отделить, план десанта) правится на месте: это данные окна, а не
 * то, открыто ли оно.
 */
import type { AllyOrderKind } from '../../decisions/allyPanel';
import {
  type Flag,
  type Reason,
  armDisarms,
  commandDisarms,
  disarmedBy,
  forgetsSelection,
} from '../../decisions/armDisarm';
import { selectFleets } from '../../decisions/fleetSelection';
import { pruneGroup, refSurvives } from '../../decisions/selectionPrune';
import type { TapPick } from '../../decisions/tapCycle';
import type { MobileOrderDraft } from './mobileOrders';

/** Что лежит во флаге, когда он взведён. Погашенный флаг — `false` или `null`. */
export interface Armed {
  aiming: true;
  assaultAim: true;
  engageAim: true;
  merging: true;
  pickMode: true;
  retreatAim: string;
  heroAim: { heroId: string; abilityId: string };
  heroSpawnAim: string;
  strikeAim: {
    from: { planetId: string } | { fleetId: string };
    squadronId: string;
    patrol?: true;
  };
  allyAim: AllyOrderKind;
  squadMerge: { from: string };
  cmdMore: true;
  castMenu: true;
  retreatMenu: true;
  troopsPlan: { fleetId: string; plan: Record<string, number> };
  splitState: { fleetId: string; take: Record<string, number> };
}

/** «Курс» взведён: следующий тап по миру — приказ на ход. */
export let aiming = false;
/** ШТУРМ взведён, как «Курс», но цель — чужой захватываемый мир: флот летит туда и
 *  штурмует по прибытии (разовый приказ, а не CC-2 авто-штурм). */
export let assaultAim = false;
/** Вооружена «Атака» (ATK-1): следующий тап по ЧУЖОМУ флоту — приказ его атаковать.
 *  Кнопка стоит в ряду команд ВСЕГДА, как «Курс»: атака — базовое действие флота, а не
 *  условная возможность, и прятать её значило бы заставлять игрока гадать, отчего она
 *  то есть, то нет. Что цель не годится, скажет ядро — одним понятным отказом. */
export let engageAim = false;
/** «Слить» взведено: следующий тап по своему флоту выбирает якорь слияния. */
export let merging = false;
/** SEL-1 «Выбрать+»: набор группы на тач. Пока он включён, лист сворачивается, тапы по
 *  карте только добавляют и убирают СВОИ флоты, а группа принимает любой общий приказ
 *  (Курс/Штурм/Цель…) — отданный приказ выводит из набора. */
export let pickMode = false;
/** «Отступить» взведено: следующий тап по карте — точка, куда уйдёт этот флот (RETR-1
 *  `to`). Без точки отход только расцеплял бой и оставлял флот под огнём на том же узле —
 *  аудит механик 2026-09-25; решение владельца: точку выбирает игрок. */
export let retreatAim: string | null = null;
/** Каст героя из окна ждёт мир-цель. */
export let heroAim: Armed['heroAim'] | null = null;
/** Высадка героя ждёт точку, где поднимется его корабль: свой мир, а с перками-маркерами
 *  ещё свой флот (абордаж) или союзный мир. */
export let heroSpawnAim: string | null = null;
/** SHU-3.1 — «Удар» взведён: следующий тап по карте выбирает цель вылета (чужой флот —
 *  `shuttle.strike` по нему). Держим ОТКУДА (id мира-порта или флота-носителя): цель у
 *  вылета одна, а баз у игрока много, и без источника приказ пришлось бы угадывать по
 *  выделению. БАЗА хранится размеченной ({planetId} | {fleetId}), а не голой строкой:
 *  ядро ищет мир и носитель в разных картах, и плоский id разъезжался с полем payload
 *  молча. С `patrol` (SHU-6.3) тот же прицел ставит ПАТРУЛЬ: тап выбирает не цель, а
 *  точку, над которой эскадра повиснет. Флаг один, потому что у обоих приказов одна
 *  база, один круг дальности и одни правила взвода и сброса. */
export let strikeAim: Armed['strikeAim'] | null = null;
/** Глава IV (PVR-7.5): взведённый приказ союзнику — следующий тап по карте выбирает цель. */
export let allyAim: AllyOrderKind | null = null;
/** Взведённое СЛИЯНИЕ эскадр (SHU-4.3): первый тап называет источник, второй —
 *  приёмника. Два тапа, а не выпадающий список: приёмник это такая же карточка на
 *  экране, и выбирать его удобнее там же, где на него смотрят. */
export let squadMerge: Armed['squadMerge'] | null = null;
/** ☰ — второй ряд командной панели (там живут дополнительные команды). */
export let cmdMore = false;
/** ✨ — способности героя-флагмана: поповер-меню каста над рядом. */
export let castMenu = false;
/** ⮐ — окошко выбора порога авто-отхода (заказ владельца 2026-09-23). */
export let retreatMenu = false;
/** GRND-1 ⇅ «Десант»: поповер погрузки/выгрузки над рядом команд. `plan` — знаковая
 *  дельта на тип: >0 поднять из гарнизона, <0 высадить. */
export let troopsPlan: Armed['troopsPlan'] | null = null;
/** Окно деления флота: какой флот и сколько кораблей каждого типа от него отходит. */
export let splitState: Armed['splitState'] | null = null;

/** Одиночный СВОЙ флот: адрес приказа и карточка со всеми приказами. */
export let selFleet: string | null = null;
/** Выбранный мир. Флоты и мир друг друга исключают. */
export let selPlanet: string | null = null;
/** Выбранная РАЗВИЛКА дороги — место, где можно поставить крепость (FORT-6.1): провинция и
 *  номер её тропы. Исключает и мир, и флоты: у развилки своя карточка. Развилка, на которой
 *  крепость уже стоит, сюда не попадает — тап выбирает саму крепость, как мир. */
export let selFork: { province: string; trail: number } | null = null;
/** Группа своих флотов: рамка, Ctrl-клик, набор. */
export let selFleets: ReadonlySet<string> = new Set();
/** UI-14. ЧУЖОЙ флот, который игрок тапнул, чтобы посмотреть. Держится ОТДЕЛЬНО от
 *  `selFleet` намеренно: `selFleet` — адрес приказа, и чужой id в нём завёл бы приказы,
 *  которые ядро отклонит. Осмотр — состояние панели и только её. */
export let inspectFleet: string | null = null;
/** Телефон: цель приказа, которая ждёт подтверждения в полоске. */
export let mobileDraft: MobileOrderDraft | null = null;
/** Телефон: список «флот или мир», когда под тапом несколько объектов. */
export let mobileChoices: readonly TapPick[] = [];

/** Флаги, которые кнопка переключает: у них взведённое значение — просто `true`. */
export type Toggle = { [F in Flag]: Armed[F] extends true ? F : never }[Flag];

/** Единственное место, где флаги присваиваются: значение взводит, `null` гасит. */
const WRITE: { [F in Flag]: (value: Armed[F] | null) => void } = {
  aiming: (v) => void (aiming = v !== null),
  assaultAim: (v) => void (assaultAim = v !== null),
  engageAim: (v) => void (engageAim = v !== null),
  merging: (v) => void (merging = v !== null),
  pickMode: (v) => void (pickMode = v !== null),
  retreatAim: (v) => void (retreatAim = v),
  heroAim: (v) => void (heroAim = v),
  heroSpawnAim: (v) => void (heroSpawnAim = v),
  strikeAim: (v) => void (strikeAim = v),
  allyAim: (v) => void (allyAim = v),
  squadMerge: (v) => void (squadMerge = v),
  cmdMore: (v) => void (cmdMore = v !== null),
  castMenu: (v) => void (castMenu = v !== null),
  retreatMenu: (v) => void (retreatMenu = v !== null),
  troopsPlan: (v) => void (troopsPlan = v),
  splitState: (v) => void (splitState = v),
};

/** Чтение по имени. Таблица, а не объект-снимок: лестница Back спрашивает каждый кадр. */
const READ: Record<Flag, () => unknown> = {
  aiming: () => aiming,
  assaultAim: () => assaultAim,
  engageAim: () => engageAim,
  merging: () => merging,
  pickMode: () => pickMode,
  retreatAim: () => retreatAim,
  heroAim: () => heroAim,
  heroSpawnAim: () => heroSpawnAim,
  strikeAim: () => strikeAim,
  allyAim: () => allyAim,
  squadMerge: () => squadMerge,
  cmdMore: () => cmdMore,
  castMenu: () => castMenu,
  retreatMenu: () => retreatMenu,
  troopsPlan: () => troopsPlan,
  splitState: () => splitState,
};

/** Взведён ли флаг прямо сейчас. */
function isArmed(flag: Flag): boolean {
  const value = READ[flag]();
  return value !== false && value !== null;
}

/** Погасить один флаг: прицел исполнен или снят, окно закрыто. */
export function drop(flag: Flag): void {
  WRITE[flag](null);
}

/** Взвести флаг (правило 15 таблицы: взведённый прицел гасит остальные прицелы). */
export function arm<F extends Flag>(flag: F, value: Armed[F]): void {
  for (const other of armDisarms(flag)) drop(other);
  WRITE[flag](value);
}

/** Кнопка-переключатель: взведённый флаг гаснет, погашенный взводится. */
export function toggle(flag: Toggle): void {
  if (isArmed(flag)) drop(flag);
  else arm(flag, true);
}

/** Погасить всё, что гасит повод (правила 8–14 таблицы). Смена матча, пустое выделение и
 *  ✕ окна выбора забывают и сам выбор (правило 16). */
export function disarm(reason: Reason, phone: boolean): void {
  for (const flag of disarmedBy(reason, phone)) drop(flag);
  if (forgetsSelection(reason)) forget();
}

/** Взведено ли хоть что-то из того, что гасит повод: ступень Back открыта, пока да. */
export function anyArmed(reason: Reason, phone: boolean): boolean {
  return disarmedBy(reason, phone).some(isArmed);
}

/** Нажата кнопка ряда `cmd`: погасить то, что она гасит, до её собственного действия
 *  (правила 1–7 и 14 таблицы). */
export function disarmForCommand(cmd: string | undefined, phone: boolean): void {
  for (const flag of commandDisarms(cmd, phone)) drop(flag);
}

/** Забыть выбор целиком. */
function forget(): void {
  selFleet = null;
  selPlanet = null;
  selFork = null;
  selFleets = new Set();
  inspectFleet = null;
  mobileDraft = null;
  mobileChoices = [];
}

/**
 * Выделить флоты. Что значит выделение — `fleetSelection.ts` (REFM-163): выделяется только
 * СВОЁ (чужой флот в наборе — приказ, который ядро всё равно отклонит), «ровно один» и
 * «несколько» — разные состояния (у одиночного своя карточка со всеми приказами), а
 * одинокий чужой уходит на осмотр (UI-14). Мир с флотами не выбирается, а мобильная цель и
 * список «флот или мир» относились к прежнему выбору.
 */
export function pickFleets(ids: readonly string[], mine: (id: string) => boolean): void {
  const sel = selectFleets(ids, mine);
  selFleets = new Set(sel.picked);
  selFleet = sel.single;
  inspectFleet = sel.inspect;
  selPlanet = null;
  selFork = null;
  mobileDraft = null;
  mobileChoices = [];
}

/**
 * Выбрать мир: флоты гаснут, а намерения остаются (`pickApply.ts`). Осмотр чужого флота
 * не трогается — пока выбран мир, панель его не показывает.
 */
export function pickWorld(id: string): void {
  selPlanet = id;
  selFork = null;
  selFleet = null;
  selFleets = new Set();
}

/** Выбрать развилку (FORT-6.1): мир и флоты гаснут, как при выборе мира. */
export function pickFork(fork: { province: string; trail: number }): void {
  selFork = fork;
  selPlanet = null;
  selFleet = null;
  selFleets = new Set();
}

/**
 * Выбрано ли хоть что-то, о чём рассказывает лист: флот, группа, осмотр чужого флота, мир
 * или развилка. Один ответ на «открыт ли лист» и «закрывает ли его Escape»: каждый держал
 * свою копию списка, и в обеих развилки не было — её выбор не открывал лист с кнопкой
 * крепости (сообщение владельца 2026-10-03: «развилка выделилась, а кнопки нет»).
 */
export function hasSelection(): boolean {
  return (
    selFleet !== null ||
    selFleets.size > 0 ||
    inspectFleet !== null ||
    selPlanet !== null ||
    selFork !== null
  );
}

/** Снять выделение флотов, не трогая мир и прицелы: «Снять» в карточке группы и пустая
 *  рамка без модификатора. */
export function deselectFleets(): void {
  selFleet = null;
  selFleets = new Set();
}

/**
 * Что теряет силу, когда сменился мир: одна чистка для хода локального мира и для снимка
 * сервера. Правила — `selectionPrune.ts`: одиночные ссылки (выбранный флот, осмотр, окно
 * деления, ⇅-меню) держатся, пока флот существует, а группа — пока флот жив и свой.
 */
export function pruneSelection(
  fleets: Readonly<Record<string, { readonly owner: string } | undefined>>,
  me: string,
): void {
  const exists = (id: string): boolean => !!fleets[id];
  if (!refSurvives(selFleet, exists)) selFleet = null;
  if (!refSurvives(inspectFleet, exists)) inspectFleet = null;
  if (splitState && !refSurvives(splitState.fleetId, exists)) drop('splitState');
  if (troopsPlan && !refSurvives(troopsPlan.fleetId, exists)) drop('troopsPlan');
  selFleets = pruneGroup(selFleets, (id) => fleets[id]?.owner, me);
}

/** Телефон: поставить цель приказа на подтверждение, `null` — снять. */
export function stageDraft(draft: MobileOrderDraft | null): void {
  mobileDraft = draft;
}

/** Телефон: показать список «флот или мир», пустой — закрыть. */
export function offerChoices(choices: readonly TapPick[]): void {
  mobileChoices = choices;
}
