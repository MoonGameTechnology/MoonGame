/**
 * Ряд команд флота (REFM-226): разметка ряда, его поповеры (каст ✨, порог отхода ⮐, десант
 * ⇅), полоска режима «Приказ» на его месте и кэш разметки с дверью перерисовки.
 *
 * Ряд собирается каждый кадр, но DOM трогается, только когда строка разметки поменялась:
 * кэш `lastCmdHtml` живёт здесь, а чужие зоны сбивают его дверью `invalidateCmdBar()`, не
 * присваиванием. Нажатия по ряду и мобильный черновик приказа — следующий кирпич
 * (REFM-227); пока они в `main.ts`, ряд спрашивает их хуками.
 */
import type { Fleet, GameState } from '../../packages/shared-core/src/index';
import { isOrdnanceFleet, rocketMinelayer } from '../../packages/shared-core/src/state/ordnance';
import { t, tData } from '../../localization/runtime';
import {
  canAssaultAim,
  canAssaultFromOrbit,
  canMerge,
  splitBlock,
} from '../../decisions/cmdAvailability';
import { allOn } from '../../decisions/cmdHighlight';
import { cmdShown } from '../../decisions/cmdPresence';
import {
  castOptionsOf,
  chainAbilityHoldH,
  chainMenuAnchor,
  chainMode,
  chainStart,
  chainStepsOf,
  chainTravelH,
  dropChainMenu,
  exitChainMode,
  keepChainFleets,
  marchFlagged,
  nearestOwnWorld,
  positionChainMenu,
} from './chainComposer';
import { chainStripHtml, chainTimeline, draftFinish } from './chainPlanner';
import { stayingFleets, stripState } from './chainStripState';
import { selectedFleetIds } from './fleetGeometry';
import { fleetCallsign } from './fleetName';
import { displayUnit, esc, fmtEta, fmtHrs } from './format';
import { MAX_CHAIN_STEPS, RETREAT_THRESHOLDS, canOrder, data, stopFleet } from './game';
import { pcUi } from './graphicsPrefs';
import { autoRetreatAt, isAutoAssault, troopsInputFor } from './groupOrders';
import { heroAboard } from './heroCasts';
import { commandIcon } from './holographicIcons';
import { commandWindowHtml } from './holographicUi';
import { unitIconHtml } from './icons';
import {
  aiming,
  assaultAim,
  castMenu,
  cmdMore,
  disarm,
  drop,
  engageAim,
  heroAim,
  merging,
  mobileDraft,
  pickMode,
  retreatMenu,
  splitState,
  stageDraft,
  troopsPlan,
} from './interaction';
import { fleetNode } from './mapFog';
import { youColor } from './mapPalette';
import { mobileOrderBar } from './mobileHud';
import { mobileDraftMatches, type MobileOrderKind, type MobileOrderTarget } from './mobileOrders';
import { barStays, popoverLife } from './popoverLife';
import { troopsMenuHtml, troopsModel, type TroopsInput } from './troopsMenu';

/** Что ряду нужно от игры. Окно флота, тип сектора и мобильный черновик пока в `main.ts`. */
export interface CmdBarHost {
  /** Мир на экране. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Телефонная раскладка. */
  mobile(): boolean;
  /** Ряд живёт в окне выбора ПК (голографический интерфейс). */
  holo(): boolean;
  /** Флот, который окно показывает консолью (ПК, один свой флот), или `null`. */
  consoleFleet(): Fleet | null;
  /** Рисует ли окно флота колонку «Десант» — тогда ⇅ уходит туда. */
  fleetLandShown(f: Fleet): boolean;
  /** Берут ли сектор штурмом. */
  capturable(id: string): boolean;
  /** Имя места для шапки окна. */
  placeName(id: string): string;
  /** Какой приказ взведён на телефоне (REFM-227). */
  mobileOrderKind(): MobileOrderKind | null;
  /** Цель черновика ещё годится для приказа (REFM-227). */
  mobileTargetAvailable(target: MobileOrderTarget, order: MobileOrderKind): boolean;
  /** Подпись цели черновика (REFM-227). */
  mobileTargetLabel(target: MobileOrderTarget): string;
}

let game: CmdBarHost;
let cmdbar: HTMLElement;
/** Последняя разметка ряда — общая у ряда, мобильной полоски приказа и полоски «Приказ». */
let lastCmdHtml = '';

/** Поднять ряд команд: хуки игры и узел `#cmdbar`. Зовётся из `main.ts` один раз. */
export function initCmdBar(host: CmdBarHost): void {
  game = host;
  cmdbar = document.getElementById('cmdbar')!;
}

/** Total count across a stack of units (ships, garrison or landing troops). */
const sumUnits = (stacks: ReadonlyArray<{ count: number }>): number =>
  stacks.reduce((a, s) => a + s.count, 0);

// A fleet-command button. `desc` (optional) is the hover tooltip — a one-line
// description of what the command does; without it the tooltip is just the label.
// The visible caption stays the short label; aria-label carries label + desc so the
// screen-reader hears the same explanation a mouse user reads on hover.
function cmdBtn(
  cmd: string,
  icon: string,
  label: string,
  cls: string,
  disabled: boolean,
  desc?: string,
  why?: string | null,
): string {
  // Серая кнопка с причиной (`why`) остаётся нажимаемой: нажатие говорит, ПОЧЕМУ нельзя
  // (сообщение владельца 2026-09-24 про «Делить»). `disabled` проглотил бы нажатие, а на
  // телефоне подсказки мыши нет — кнопка выглядела бы просто сломанной.
  // Вид — один из трёх стилей (UIX-11.1): «Курс» — главная кнопка карточки флота, остальные
  // приказы — вторичные; `cls` добавляет состояние (`on` — режим включён, `danger`).
  const look = `${cmd === 'move' ? 'btn-main' : 'btn-second'}${cls ? ` ${cls}` : ''}`;
  if (disabled && why) {
    const reason = t(why);
    return `<button data-cmd="${cmd}" class="${look}" title="${esc(`${label} — ${reason}`)}" aria-label="${esc(`${label} — ${reason}`)}" aria-disabled="true" data-why="${esc(why)}"><span class="ci" aria-hidden="true">${commandIcon(cmd, icon)}</span><span class="cl">${esc(label)}</span></button>`;
  }
  const tip = desc ? `${label} — ${desc}` : label;
  return `<button data-cmd="${cmd}" class="${look}" title="${esc(tip)}" aria-label="${esc(tip)}" ${disabled ? 'disabled' : ''}><span class="ci" aria-hidden="true">${commandIcon(cmd, icon)}</span><span class="cl">${esc(label)}</span></button>`;
}

/** CHAIN-UX: полоска режима «Приказ» — живёт в ноде #cmdbar (все четыре
 *  медиа-раскладки позиционирования достаются бесплатно). Строится каждый кадр
 *  по кэшу lastCmdHtml; времена в HTML-сигнатуру НЕ входят — их патчит
 *  updateChainDom() через textContent, иначе тикающее «~T» перестраивало бы DOM
 *  под пальцем и съедало тапы. */
function renderChainBar(): void {
  if (!chainMode) return;
  const s = game.world();
  const ME = game.me();
  // Самогашение: флоты умерли/перешли к другому — режим не висит над пустотой.
  // Самогашение и состояние кнопок — `chainStripState.ts` (REFM-79).
  keepChainFleets(stayingFleets(chainMode.fleetIds, (id) => s.fleets[id]?.owner, ME));
  if (!chainMode.fleetIds.length) {
    exitChainMode();
    renderCmdBar();
    return;
  }
  document.body.classList.add('chain-mode');
  const plans = chainMode.fleetIds.map((id) => JSON.stringify(chainStepsOf(id) ?? []));
  const f0 = s.fleets[chainMode.fleetIds[0]!]!;
  const finish = draftFinish(chainMode.steps, chainStart(f0).fromId);
  const st = stripState({
    steps: chainMode.steps.length,
    gestures: chainMode.gestures.length,
    cap: MAX_CHAIN_STEPS,
    plans,
    hasHome: !!finish && !!nearestOwnWorld(finish),
  });
  const html = chainStripHtml({
    fleets: chainMode.fleetIds.length,
    count: chainMode.steps.length,
    cap: MAX_CHAIN_STEPS,
    ...st,
  });
  if (html !== lastCmdHtml) {
    cmdbar.innerHTML = html;
    lastCmdHtml = html;
  }
  // CAST-UX. Пока каст ПРИЦЕЛИВАЕТСЯ, нижний хаб уходит: он занимает ту самую полосу
  // экрана, по которой целятся на телефоне, и перекрывает круг дальности. Прицел
  // снимается любым приказом и самим кастом (`drop('heroAim')`), так что хаб вернётся.
  if (heroAim) {
    cmdbar.classList.remove('show');
    return;
  }
  cmdbar.classList.add('show');
  updateChainDom();
}
/** Покадровые НЕструктурные обновления режима: итоговое «~T» полоски и позиция
 *  меню точки (оно едет с камерой и с движущимся флотом-целью). */
function updateChainDom(): void {
  if (!chainMode) return;
  const s = game.world();
  const eta = cmdbar.querySelector('.ch-eta') as HTMLElement | null;
  const f0 = s.fleets[chainMode.fleetIds[0]!];
  if (eta && f0) {
    const st = chainStart(f0);
    const tl = chainTimeline(
      chainMode.steps,
      st.fromId,
      st.baseH,
      chainTravelH(f0),
      chainAbilityHoldH(chainMode.fleetIds),
    );
    const tail = tl[tl.length - 1];
    eta.textContent = tail && tail.endH !== null ? `~${fmtEta(tail.endH)}` : '~ —';
  }
  if (chainMode.menu) {
    const el = document.getElementById('tgted');
    if (!chainMenuAnchor()) {
      // цель меню исчезла (флот сбит) — меню гаснет само, режим живёт
      dropChainMenu();
      el?.classList.remove('show');
    } else if (el?.classList.contains('show')) {
      positionChainMenu(el);
    }
  }
}

/** Дверь перерисовки ряда команд (REFM-206): «состояние ряда поменялось, собери заново».
 *  Кэш общий у ряда, мобильной полоски приказа и полоски «Приказ» и уедет вместе с их
 *  разметкой (REFM-226), а чужим зонам нужна эта функция, а не доступ к переменной. */
export function invalidateCmdBar(): void {
  lastCmdHtml = '';
}

/** Horizontal fleet command bar — Move (arm) / Stop / Attack / orbit change —
 *  acting on the current fleet selection, buttons enabled by context. */
export function renderCmdBar(): void {
  // CHAIN-UX: в режиме «Приказ» вместо ряда команд — полоска плана. Она живёт и
  // без выделения (режим держит свои fleetIds), поэтому ветка стоит ДО раннего
  // выхода на пустом выделении.
  if (chainMode) {
    renderChainBar();
    return;
  }
  document.body.classList.remove('chain-mode');
  const s = game.world();
  const ME = game.me();
  const MOBILE = game.mobile();
  const ids = selectedFleetIds();
  // Время жизни ряда и поповеров — `popoverLife.ts` (REFM-84). Набор группы держит ряд
  // живым и на нуле выделенных: ⊕ обязана остаться достижимой, иначе опустевшая группа
  // запирает игрока в режиме без выхода.
  if (!barStays(ids.length, pickMode)) {
    // Прицелы и меню ряда гаснут вместе с ним (`armDisarm.ts`, правило 13): иначе ⇵ или ✨
    // всплыли бы над СЛЕДУЮЩИМ выбранным флотом, а повторный выбор открывал бы их сам.
    disarm('bar-hidden', MOBILE);
    cmdbar.classList.remove('show');
    invalidateCmdBar();
    return;
  }
  if (MOBILE && (game.mobileOrderKind() || pickMode)) {
    const order = game.mobileOrderKind();
    if (
      !mobileDraftMatches(mobileDraft, order, ids) ||
      (mobileDraft && !game.mobileTargetAvailable(mobileDraft.target, mobileDraft.order))
    )
      stageDraft(null);
    const label = pickMode
      ? t('cmd.multiselect')
      : order === 'assault'
        ? t('cmd.assault')
        : order === 'engage'
          ? t('cmd.engage')
          : order === 'merge'
            ? t('cmd.merge.pick')
            : t('cmd.move');
    const selection =
      ids.length === 1 ? fleetCallsign(ids[0]!) : t('cmd.selection.many', { n: ids.length });
    const html = mobileOrderBar(
      `${label} · ${selection}`,
      mobileDraft ? game.mobileTargetLabel(mobileDraft.target) : null,
      pickMode,
    );
    if (html !== lastCmdHtml) {
      cmdbar.innerHTML = html;
      lastCmdHtml = html;
    }
    cmdbar.classList.add('show');
    return;
  }
  const fleets = ids.map((id) => s.fleets[id]).filter((f): f is Fleet => !!f);
  // CMD-VIS: доступность приказа СПРАШИВАЕТСЯ у ядра (canOrder, RULES-1), а кнопка
  // рисуется от ответа — недоступный приказ не серый, его просто НЕТ. Одна проба
  // покрывает все причины разом: стоит на месте (E_FLEET_BUSY), в коридоре
  // (E_NOT_A_LANE — у прыжка нет середины), в бою. Правило переиспользуемое: любую
  // командную кнопку можно вешать на ту же пробу её настоящего приказа.
  const anyStoppable = fleets.some((f) => canOrder(s, stopFleet(ME, f.id)) === null);
  // Доступность слияния/деления/штурма — `cmdAvailability.ts` (REFM-78).
  const docked = fleets.filter((f) => f.location && !f.movement && !f.battleId);
  // PC and phone target a world (fly there + storm on arrival). The phone confirms
  // before dispatch; the legacy tablet button remains in-orbit-only.
  // Гасить прицельную кнопку НЕЧЕМ: цель выбирается после нажатия, и про её оборону в
  // этот момент не известно ничего. Есть ли вообще кем штурмовать — вопрос СОСТАВА, и
  // он решает ПОКАЗ кнопки (`shown.assault`), а не её серость. Орбитальная ветка бьёт
  // по миру под флотом, там цель уже известна — она кнопку и гасит.
  const canAssault =
    pcUi() || MOBILE
      ? true
      : docked.some((f) =>
          canAssaultFromOrbit(
            {
              orbit: f.orbit,
              location: f.location,
              worldOwner: (f.location ? s.planets[f.location]?.owner : null) ?? null,
              capturable: !!(f.location && game.capturable(f.location)),
            },
            f.owner,
          ),
        );
  // Merge: a group fuses in one tap; a lone fleet arms target-pick (needs a partner).
  const myFleetTotal = Object.values(s.fleets).filter(
    (f) => f.owner === ME && !isOrdnanceFleet(f, data),
  ).length;
  const mergeOk = canMerge(ids.length, myFleetTotal);
  // Split: only a single docked fleet with ≥2 ships can shed some into a new fleet.
  const lone = ids.length === 1 && fleets[0] ? fleets[0] : null;
  const splitWhy = splitBlock(
    lone
      ? {
          location: lone.location,
          movement: lone.movement,
          battleId: lone.battleId,
          ships: sumUnits(lone.units),
        }
      : null,
  );
  const splitOk = splitWhy === null;
  // GRND-1 ⇅ «Десант»: как и split, команда строго ОДНОФЛОТОВАЯ — гарнизон и трюм у
  // каждого свои, один клик на группу разослал бы приказы с разной арифметикой.
  const troopsIn = lone ? troopsInputFor(lone.id) : null;
  // Окно флота консолью (ПК, один свой флот): ⇅ переезжает в колонку «Десант» листа
  // кнопкой «Погрузка и выгрузка», и его меню встаёт поверх той же колонки. Пустой трюм
  // колонку не рисует — тогда ⇅ остаётся в ряду, а меню встаёт поверх «Состава».
  const consoleOn = !!lone && game.consoleFleet() === lone;
  const landShown = consoleOn && game.fleetLandShown(lone);
  // Hero-flagship aboard a selected fleet → its castable abilities become a ✨ popover
  // (the map-tap targeting reuses the same heroAim flow as the hero window).
  // Флагман группы и его кастуемые способности — правила в `heroCasts.ts` (REFM-68).
  const castHero = Object.values(s.heroes ?? {}).find(
    (hh) => heroAboard([hh], ids) !== null && castOptionsOf(hh).length > 0,
  );
  // Каждый поповер живёт ровно пока живо его основание — `popoverLife.ts` (REFM-84).
  // Три проверки стояли порознь и только на вид были одинаковы: ⇅ привязан к КОНКРЕТНОМУ
  // флоту, а не к «какому-нибудь одиночному», иначе он отправит чужой гарнизон.
  const life = popoverLife(
    {
      selected: ids.length,
      picking: pickMode,
      castHero: !!castHero,
      troopsInput: !!troopsIn,
      loneId: lone?.id ?? null,
    },
    { cast: castMenu, troopsFleetId: troopsPlan?.fleetId ?? null },
  );
  if (!life.cast) drop('castMenu');
  if (!life.troops) drop('troopsPlan');
  // Состав ряда — `cmdPresence.ts` (REFM-185): серая кнопка и ОТСУТСТВУЮЩАЯ значат
  // разное. Отсутствием показывается то, чего у выделения нет по природе (нечего
  // останавливать, нет флагмана, нет артиллерии), гашением — то, что есть, но сейчас
  // не складывается. Кнопка набора видна и при свёрнутом ☰, пока набор включён:
  // иначе из режима нечем выйти.
  const shown = cmdShown({
    stoppable: anyStoppable,
    castHero: !!castHero,
    // ШТУРМ спрашивает ДЕСАНТ, а не корабли (`cmdAvailability.ts`, правило 6): без него
    // штурмовать некем, и кнопки не бывает вовсе. Пригодность ЦЕЛИ её по-прежнему гасит.
    troops: canAssaultAim(fleets.map((f) => sumUnits(f.landing ?? []))),
    assaultArmed: assaultAim,
    // «Слить» и «Десант» — по составу (правило 3б): нет напарника или некого грузить —
    // нет и кнопки.
    mergeable: mergeOk,
    merging,
    troopsMenu: !!troopsIn,
    troopsOpen: !!troopsPlan,
    troopsInSheet: landShown,
    more: cmdMore,
    picking: pickMode,
  });
  const castBtn = shown.cast
    ? cmdBtn('cast', '✨', t('cmd.cast'), castMenu ? 'on' : '', false, t('cmd.cast.hint'))
    : '';
  let html =
    `<span class="cmdlabel">${ids.length > 1 ? t('cmd.selection.many', { n: ids.length }) : t('cmd.selection.one')}</span>` +
    cmdBtn('move', '⤳', t('cmd.move'), aiming ? 'on' : '', false, t('cmd.move.hint')) +
    // ATK-1: «Атака» — всегда, как «Курс». Цель у неё ФЛОТ, а не мир (в отличие от
    // ШТУРМА ниже), поэтому и кнопка отдельная, и прицел отдельный. Значок — прицел ✛, как
    // на ПК (`crosshair`): молния ⚡ — это скорость и «Ускорить» (UIX-5.3).
    cmdBtn('engage', '✛', t('cmd.engage'), engageAim ? 'on' : '', false, t('cmd.engage.hint')) +
    // В консоли «Способность» — третья в первом ряду, как на макете владельца.
    (consoleOn ? castBtn : '') +
    (shown.stop ? cmdBtn('stop', '■', t('cmd.stop'), 'danger', false, t('cmd.stop.hint')) : '') +
    (shown.assault
      ? cmdBtn(
          'attack',
          '⚔',
          t('cmd.assault'),
          assaultAim ? 'on' : '',
          !canAssault,
          t('cmd.assault.hint'),
        )
      : '') +
    cmdBtn('target', '◎', t('cmd.target'), '', false, t('cmd.target.hint')) +
    (lone && rocketMinelayer(lone, data)
      ? cmdBtn('rocket-mine', '✺', t('cmd.rocket-mine'), '', false, t('cmd.rocket-mine.hint'))
      : '') +
    (consoleOn ? '' : castBtn) +
    (shown.merge
      ? cmdBtn(
          'merge',
          '⛬',
          ids.length > 1 ? t('cmd.merge') : t('cmd.merge.pick'),
          merging ? 'on' : '',
          !mergeOk,
          t('cmd.merge.hint'),
        )
      : '') +
    cmdBtn(
      'split',
      '⊟',
      t('cmd.split'),
      splitState ? 'on' : '',
      !splitOk,
      t('cmd.split.hint'),
      splitWhy,
    ) +
    (shown.troops
      ? cmdBtn(
          'troops',
          '⇅',
          t('cmd.troops'),
          troopsPlan ? 'on' : '',
          !troopsIn,
          t('cmd.troops.hint'),
        )
      : '') +
    // ☰ — the extras row (hamburger, NOT «...» — референс не копируем дословно; окно
    // ПК рисует «•••» — так на макете владельца 2026-09-27, `holographicIcons.ts`):
    // «Выбрать+» и будущие Ускорить/Задержка живут здесь, базовый ряд не пухнет.
    cmdBtn('more', '☰', t('cmd.more'), cmdMore ? 'on' : '', false, t('cmd.more.hint')) +
    (shown.pick
      ? cmdBtn(
          'pick',
          '⊕',
          t('cmd.multiselect'),
          pickMode ? 'on' : '',
          false,
          t('cmd.multiselect.hint'),
        )
      : '') +
    (shown.extras
      ? cmdBtn(
          'boost',
          '⚡',
          t('cmd.forced-march'),
          // Единогласие, а не «хоть у кого-то» — `cmdHighlight.ts` (REFM-186): один
          // разогнанный из десяти покрасил бы кнопку, и игрок прочёл бы «вся группа».
          allOn(ids, (id) => marchFlagged(id)) ? 'on' : '',
          ids.length === 0,
          t('cmd.forced-march.hint'),
        ) +
        // SO-UI: standing orders live here now — the bottom sheet keeps only info.
        cmdBtn(
          'qauto',
          '⚔',
          t('cmd.auto-assault'),
          allOn(ids, (id) => isAutoAssault(id)) ? 'on' : '',
          ids.length === 0,
          t('cmd.auto-assault.hint'),
        ) +
        // RETR-2: авто-отход — соседний стоячий приказ, и живёт он там же.
        cmdBtn(
          'qretr',
          '⮐',
          t('cmd.auto-retreat'),
          allOn(ids, (id) => autoRetreatAt(id) !== null) ? 'on' : '',
          ids.length === 0,
          t('cmd.auto-retreat.hint'),
        ) +
        ''
      : '') +
    // ✨ поповер: способности героя-флагмана — каст прямо с ряда (дальняя → цель на карте).
    (castMenu && castHero
      ? `<div class="cmdpop">` +
        castOptionsOf(castHero)
          .map((opt) => {
            const ad = data.heroAbilities[opt.id]!;
            const sub =
              opt.cdH > 0
                ? t('cmd.cast.cooldown', { h: fmtHrs(opt.cdH) })
                : opt.ranged
                  ? t('cmd.cast.needs-target')
                  : t('cmd.cast.self');
            // Описание навыка: удержание на телефоне открывает сводку `ab:` (как у плиток и
            // строк), наведение на ПК — подсказку (заказ владельца 2026-09-25).
            const hint = ad.description ? ` title="${esc(t(ad.description))}"` : '';
            return `<button data-cmd="castdo" class="btn-second" data-ab="${opt.id}" data-hero="${castHero.id}" data-desc="ab:${opt.id}"${hint}${opt.cdH > 0 ? ' disabled' : ''}><b>${esc(tData(ad.name))}</b><span>${sub}</span></button>`;
          })
          .join('') +
        `</div>`
      : '') +
    // ⮐ окошко авто-отхода: выбор порога корпуса одним тапом, текущий подсвечен.
    (retreatMenu && ids.length > 0
      ? `<div class="cmdpop cmdpop-retr"><p>${t('cmd.retreat.title')}</p><div class="retr-row">` +
        [0, ...RETREAT_THRESHOLDS]
          .map((at) => {
            const cur = autoRetreatAt(ids[0] ?? '') ?? 0;
            const on = Math.abs(cur - at) < 1e-9;
            return `<button data-cmd="retrset" data-at="${at}" class="btn-second${on ? ' on' : ''}"><b>${at === 0 ? t('cmd.retreat.off') : `${Math.round(at * 100)}%`}</b></button>`;
          })
          .join('') +
        `</div><span class="retr-hint">${t('cmd.retreat.hint')}</span></div>`
      : '') +
    // ⇅ поповер десанта: строка на тип, знаковый счётчик «сколько», одно подтверждение.
    (troopsPlan && troopsIn && !consoleOn ? troopsPopHtml(troopsIn) : '');
  if (game.holo()) {
    // Пустой набор группы — это режим, а не «0 флотов».
    const title = lone
      ? fleetCallsign(lone.id)
      : ids.length === 0 && pickMode
        ? t('cmd.multiselect')
        : t('cmd.selection.many', { n: ids.length });
    // Имя места — то же, что на листе (`placeName`): в прицеле «Курса» лист спрятан, и
    // шапка окна показывала id узла («home_a»), плейтест 2026-10-09, PT-04.
    const loneNode = lone ? fleetNode(lone) : null;
    const sub = lone
      ? [
          loneNode ? game.placeName(loneNode) : '',
          t('side.fleet.sub.pc', { s: sumUnits(lone.units), tr: sumUnits(lone.landing ?? []) }),
        ]
          .filter(Boolean)
          .join(' · ')
      : '';
    html = commandWindowHtml(
      (consoleOn
        ? `<div class="fc-title fc-orders"><b>${esc(t('fleet.console.orders'))}</b></div>`
        : '') + html,
      title,
      sub,
      !!lone && !aiming && !merging && !pickMode,
      consoleOn && troopsPlan && troopsIn ? troopsPopHtml(troopsIn) : '',
    );
  }
  if (html !== lastCmdHtml) {
    const hadPop = cmdbar.querySelector('.cmdpop') !== null;
    cmdbar.innerHTML = html;
    lastCmdHtml = html;
    // На ПК ряд — боковая панель с прокруткой, и окошко встаёт в поток ПОД кнопкой: у
    // нижнего края оно открывалось за краем панели (видны были только верхушки порогов).
    // Только что открытое окошко докручиваем в вид; дальше прокрутка — за игроком.
    const pop = cmdbar.querySelector('.cmdpop');
    if (!hadPop && pop && game.holo()) pop.scrollIntoView({ block: 'nearest' });
  }
  cmdbar.classList.add('show');
}

/** ⇅-меню десанта: строка на тип, знаковый счётчик «сколько», одно подтверждение. */
function troopsPopHtml(input: TroopsInput): string {
  const s = game.world();
  const ME = game.me();
  return troopsMenuHtml(troopsModel(input), {
    icon: (u) => unitIconHtml(u, data, youColor, 18, s.players[ME]?.faction),
    name: displayUnit,
  });
}
