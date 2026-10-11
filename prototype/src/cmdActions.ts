/**
 * Нажатия ряда команд и мобильный черновик приказа (REFM-227).
 *
 * Ряд рисует `cmdBar.ts`, а сюда приходят его нажатия: делегат `onCommandClick` слушает
 * `#cmdbar`, и окно флота на ПК зовёт его же для кнопок колонки «Десант». Каждая ветка
 * только взводит своё (`interaction.ts`) или отдаёт приказ конвейером (`orderPipeline.ts`);
 * что гаснет от соседней команды, решает `disarmForCommand`.
 *
 * Мобильный черновик — цель, которую палец поставил при взведённом приказе: на телефоне
 * приказ уходит не тапом, а кнопкой «Отправить» полоски. Сам черновик хранит
 * `interaction.ts` (`mobileDraft`), здесь — какой приказ взведён, годится ли цель, её
 * подпись и точка на экране, отправка и отмена. Ряд спрашивает это хуками
 * `initCmdBar` (прямой импорт замкнул бы круг `cmdBar` ↔ `cmdActions`).
 *
 * Мир, своё место, раскладку, ленту, имена, тип сектора, панель, окно деления, мины
 * заградителя и звук отправки модуль получает хуками `initCmdActions(host)`.
 */
import type { Fleet, GameState } from '../../packages/shared-core/src/index';
import { shipsEngaged } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { assaultTargetOk } from '../../decisions/aimTargets';
import { engageOrders } from '../../decisions/engageOrders';
import {
  chainMode,
  chainStart,
  enterChainMode,
  exitChainMode,
  marchFlagged,
  nearestOwnWorld,
  renderChainMenu,
  setChainDraft,
} from './chainComposer';
import { draftFinish, undoGesture } from './chainPlanner';
import { invalidateCmdBar, renderCmdBar } from './cmdBar';
import { fleetAnchor, selectedFleetIds } from './fleetGeometry';
import {
  MAX_CHAIN_STEPS,
  RETREAT_THRESHOLDS,
  assaultFleet,
  canOrder,
  capitalOf,
  castHeroAbility,
  data,
  engageFleet,
  forceMarchFleet,
  loadArmy,
  moveFleet,
  orderChain,
  orderRetreat,
  stopFleet,
  unloadArmy,
} from './game';
import { pcUi } from './graphicsPrefs';
import {
  isAutoAssault,
  mergeGroup,
  orderMerge,
  setAutoAssault,
  troopsInputFor,
  troopsLiftable,
  tryAssaultGroup,
  tryMoveEdgeGroup,
  tryMoveGroup,
} from './groupOrders';
import {
  aiming,
  arm,
  assaultAim,
  disarm,
  disarmForCommand,
  drop,
  engageAim,
  merging,
  mobileDraft,
  pickMode,
  selPlanet,
  splitState,
  stageDraft,
  toggle,
  troopsPlan,
} from './interaction';
import { world } from './mapCamera';
import { fleetSeen } from './mapFog';
import {
  mobileDraftMatches,
  mobileTargetPoint,
  type MobileOrderKind,
  type MobileOrderTarget,
} from './mobileOrders';
import { playerOrder } from './orderPipeline';
import { maxPlan, planOrders, stepPlan, troopsModel } from './troopsMenu';

/** Что нажатиям и черновику нужно от игры. */
export interface CmdActionsHost {
  /** Мир на экране. Конвейер подменяет его после каждого приказа — читать заново. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Телефонная раскладка. */
  mobile(): boolean;
  /** Строка в ленту. */
  note(text: string, at?: string): void;
  /** Имя места. */
  placeName(id: string): string;
  /** Подпись флота: позывной или «Крепость». */
  fleetTitleOf(id: string): string;
  /** Берут ли сектор штурмом. */
  capturable(id: string): boolean;
  /** Перерисовать панель сейчас. */
  renderPanel(): void;
  /** Сбросить кэш панели. */
  invalidatePanel(): void;
  /** Открыть, закрыть или перерисовать окно деления флота. */
  renderSplitDialog(): void;
  /** Открыть мины заградителя для флота. */
  openMineFleet(id: string): void;
  /** Звук ушедшего плана «Приказ». */
  sentSound(): void;
}

let game: CmdActionsHost;

/** Подключить модуль к игре и повесить делегат на ряд команд. */
export function initCmdActions(host: CmdActionsHost): void {
  game = host;
  document.getElementById('cmdbar')!.addEventListener('click', onCommandClick);
}

const sumUnits = (stacks: { count: number }[]): number => stacks.reduce((a, s) => a + s.count, 0);

/** Взведённый на телефоне приказ: слияние, штурм, бой или курс; на ПК всегда `null`. */
export function mobileOrderKind(): MobileOrderKind | null {
  if (!game.mobile()) return null;
  if (merging) return 'merge';
  if (assaultAim) return 'assault';
  if (engageAim) return 'engage';
  return aiming ? 'move' : null;
}

/** Поставить цель черновика для текущего выбора (`null` — снять черновик). */
export function stageMobileTarget(order: MobileOrderKind, target: MobileOrderTarget | null): void {
  stageDraft(target ? { order, fleetIds: [...selectedFleetIds()], target } : null);
  invalidateCmdBar();
}

/** Годится ли цель для приказа в мире на экране. */
export function mobileTargetAvailable(target: MobileOrderTarget, order: MobileOrderKind): boolean {
  const s = game.world();
  const ME = game.me();
  if (target.kind === 'lane')
    return order === 'move' && !!s.planets[target.from]?.links?.includes(target.to);
  if (target.kind === 'planet') {
    const p = s.planets[target.id];
    return (
      !!p &&
      (order === 'move' ||
        (order === 'assault' && assaultTargetOk(p.owner, game.capturable(p.id), ME)))
    );
  }
  const f = s.fleets[target.id];
  if (!f) return false;
  if (order === 'merge') return f.owner === ME && !selectedFleetIds().includes(f.id);
  return order === 'engage' && f.owner !== ME && sumUnits(f.units) > 0 && fleetSeen(f);
}

/** Точка цели черновика на экране — туда тянется линия прицела. */
export function mobileDraftPoint(): { x: number; y: number } | null {
  if (!mobileDraft) return null;
  const s = game.world();
  return mobileTargetPoint(
    mobileDraft.target,
    (id) => (s.planets[id] ? world(s.planets[id]!.position) : null),
    (id) => (s.fleets[id] ? fleetAnchor(s.fleets[id]!) : null),
  );
}

/** Подпись цели черновика в полоске приказа. */
export function mobileTargetLabel(target: MobileOrderTarget): string {
  if (target.kind === 'planet') return game.placeName(target.id);
  if (target.kind === 'fleet') return game.fleetTitleOf(target.id);
  return t('hud.mobile.lane', { from: game.placeName(target.from), to: game.placeName(target.to) });
}

/** Same existing engage/march actions for mouse and confirmed phone targeting. Кому какой
 *  приказ — `engageOrders.ts` (ATK-3): у цели приказ получает один флот, остальных втянет бой. */
export function engageTarget(target: Fleet): void {
  const s = game.world();
  const ME = game.me();
  const fleets = selectedFleetIds().flatMap((id) => {
    const f = s.fleets[id];
    return f ? [{ id, location: f.location ?? null, engaged: shipsEngaged(s, f) }] : [];
  });
  const plan = engageOrders(fleets, target.location ?? null);
  for (const id of plan.engage) if (playerOrder(engageFleet(ME, id, target.id))) break;
  for (const id of plan.march) playerOrder(moveFleet(ME, id, target.location!));
  if (plan.adrift) game.note(t('hint.engage-in-flight'));
}

/** Снять черновик и взведённый приказ. */
export function cancelMobileOrder(): void {
  stageDraft(null);
  disarm('mobile-cancel', game.mobile());
  invalidateCmdBar();
  game.invalidatePanel();
}

/** «Отправить»: черновик, всё ещё годный для выбора, уходит приказом; устаревший — в ленту. */
function sendMobileOrder(): void {
  const s = game.world();
  const order = mobileOrderKind();
  const ids = selectedFleetIds();
  if (
    !mobileDraftMatches(mobileDraft, order, ids) ||
    !mobileTargetAvailable(mobileDraft.target, mobileDraft.order)
  ) {
    stageDraft(null);
    game.note(t('hud.mobile.target-stale'));
    return;
  }
  const target = mobileDraft.target;
  cancelMobileOrder();
  if (order === 'move' && target.kind === 'planet') tryMoveGroup(ids, target.id);
  else if (order === 'move' && target.kind === 'lane') tryMoveEdgeGroup(ids, target);
  else if (order === 'assault' && target.kind === 'planet') tryAssaultGroup(ids, target.id);
  else if (order === 'engage' && target.kind === 'fleet') engageTarget(s.fleets[target.id]!);
  else if (order === 'merge' && target.kind === 'fleet') orderMerge(ids, target.id);
}

/** Нажатие командной кнопки (`data-cmd`). Слушает ряд команд, а окно флота на ПК
 *  зовёт сюда же кнопки своей колонки «Десант» — ⇅-меню живёт в ней, а не в ряду. */
export function onCommandClick(ev: MouseEvent): void {
  const ME = game.me();
  const MOBILE = game.mobile();
  const bEl = (ev.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!bEl || bEl.disabled) return;
  // Серая кнопка с причиной (`cmdBtn`, `why`): приказа нет — есть объяснение.
  if (bEl.getAttribute('aria-disabled') === 'true') {
    if (bEl.dataset.why) game.note(t(bEl.dataset.why));
    return;
  }
  const cmd = bEl.dataset.cmd;
  const ids = selectedFleetIds();
  if (MOBILE && (cmd === 'mobile-send' || cmd === 'mobile-cancel')) {
    if (cmd === 'mobile-send') sendMobileOrder();
    else cancelMobileOrder();
    game.renderPanel();
    renderCmdBar();
    return;
  }
  if (MOBILE && cmd !== 'more') stageDraft(null);
  // Что гаснет от СОСЕДНЕЙ команды — `armDisarm.ts` (REFM-195, REFM-207): у каждого
  // взводимого состояния свой список «своих» команд, и в нём же подкоманды поповера (иначе
  // ⇅-меню закрывалось бы от собственной кнопки «+1»); кнопка без команды гасит ВСЁ;
  // прицелы из окон гаснут от любой; «Курс» — от нового намерения; ☰ на телефоне
  // сворачивается выбором приказа. `chainMode` в таблицу не входит намеренно — в режиме
  // цепочки полоска ЗАМЕНЯЕТ ряд, других команд там физически нет, и выход только своими
  // кнопками (chexit/chsend), Back и Escape. Ниже ветки только взводят и переключают своё.
  disarmForCommand(cmd, MOBILE);
  if (cmd === 'rocket-mine' && ids.length === 1) {
    game.openMineFleet(ids[0]!);
  } else if (cmd === 'engage') {
    toggle('engageAim'); // arm / disarm the attack order
    if (engageAim && !MOBILE) game.note(t('hint.pick-engage'));
  } else if (cmd === 'move') {
    toggle('aiming'); // arm / disarm the move order
    // Подсказка только на тач: там один палец занят прицелом, и жест камеры надо
    // назвать вслух. На PC мышь и так возит камеру перетаскиванием.
    if (aiming && !pcUi() && !MOBILE) game.note(t('hint.aim-armed'));
  } else if (cmd === 'merge') {
    if (ids.length >= 2) mergeGroup(ids);
    else {
      toggle('merging'); // lone fleet → arm: next friendly-fleet tap is the anchor
      if (merging && !MOBILE) game.note(t('hint.pick-merge'));
    }
  } else if (cmd === 'stop') {
    // Без тостов: в группе стоп уходит только тем, кому ядро его РАЗРЕШАЕТ (та же
    // проба, что показала кнопку) — флот в коридоре просто доезжает, отказа не видно.
    for (const id of ids)
      if (canOrder(game.world(), stopFleet(ME, id)) === null) playerOrder(stopFleet(ME, id));
  } else if (cmd === 'attack') {
    if (pcUi() || MOBILE) {
      // PC: ШТУРМ aims like «Курс» — the next click on someone else's world sends
      // the fleet there and it storms on arrival (valid targets ring up on the map).
      toggle('assaultAim');
      if (assaultAim && !MOBILE) game.note(t('hint.pick-assault'));
    } else {
      for (const id of ids)
        if (game.world().fleets[id]?.orbit === 'near') playerOrder(assaultFleet(ME, id));
    }
  } else if (cmd === 'split') {
    const id = ids[0];
    if (id) {
      // toggle the dialog
      if (splitState) drop('splitState');
      else arm('splitState', { fleetId: id, take: {} });
      game.renderSplitDialog();
    }
  } else if (cmd === 'troops') {
    const id = ids[0];
    if (id) {
      // toggle the popover
      if (troopsPlan) drop('troopsPlan');
      else arm('troopsPlan', { fleetId: id, plan: {} });
    }
  } else if (cmd === 'tstep' || cmd === 'tmax') {
    // Набор количества. Шаг КЛАМПИТСЯ моделью, а не блокируется — как «+10» в
    // диалоге разделения флота: «+5» при трёх доступных даст +3, а не откажет.
    const inp = troopsPlan ? troopsInputFor(troopsPlan.fleetId) : null;
    if (troopsPlan && inp) {
      const unit = bEl.dataset.unit ?? '';
      troopsPlan.plan =
        cmd === 'tmax'
          ? maxPlan(inp, unit, Number(bEl.dataset.dir) > 0 ? 1 : -1)
          : stepPlan(inp, unit, Number(bEl.dataset.n));
    }
  } else if (cmd === 'tok') {
    const st = troopsPlan;
    const inp = st ? troopsInputFor(st.fleetId) : null;
    const at = st ? game.world().fleets[st.fleetId]?.location : undefined;
    if (st && inp && at) {
      const { load, unload } = planOrders(troopsModel(inp));
      // Выгрузка мгновенна и уходит в ядро ОДНИМ действием на тип (count оно
      // принимает атомарно). Погрузка ложится в часовую очередь БЕЗ повторной
      // проверки места: модель уже посчитала её ровно на тот трюм, который
      // освободит эта выгрузка, а реальный `army.load` уйдёт лишь через игровой
      // час — к тому времени выгрузка применена и в соло, и по сети.
      for (const o of unload) playerOrder(unloadArmy(ME, st.fleetId, o.unit, o.count));
      // ALLY-LAND. Идущий наземный бой запирает ТОЛЬКО погрузку (ядро: `E_UNDER_ASSAULT`
      // на `army.load` — иначе защитник уплыл бы небитым). Высадку он не запирает, и
      // раньше один общий гейт резал обе половины: подкрепить осаждённый мир было
      // нельзя — ровно то, ради чего союзная высадка и нужна.
      if (load.length && troopsLiftable(at)) {
        for (const o of load) playerOrder(loadArmy(ME, st.fleetId, o.unit, o.count));
      }
    }
    drop('troopsPlan');
  } else if (cmd === 'target') {
    // CHAIN-UX: вход в режим «Приказ» — карта становится рабочей поверхностью,
    // тапы по точкам собирают план (CC-1 цепочка), полоска заменяет ряд команд.
    enterChainMode(ids);
  } else if (cmd === 'chundo') {
    if (chainMode) {
      const d = undoGesture({ steps: chainMode.steps, gestures: chainMode.gestures });
      setChainDraft(d);
      invalidateCmdBar();
      if (chainMode.menu) renderChainMenu(); // серость пунктов могла измениться
    }
  } else if (cmd === 'chhome') {
    if (chainMode) {
      const f0 = game.world().fleets[chainMode.fleetIds[0]!];
      const finish = f0 ? draftFinish(chainMode.steps, chainStart(f0).fromId) : null;
      const home = finish ? nearestOwnWorld(finish) : null;
      if (home && chainMode.steps.length < MAX_CHAIN_STEPS) {
        setChainDraft({
          steps: [...chainMode.steps, { kind: 'move', to: home }],
          gestures: [...chainMode.gestures, 1],
        });
        invalidateCmdBar();
      }
    }
  } else if (cmd === 'chsend') {
    if (chainMode) {
      // Пустой черновик при живых планах — это «снять приказ»: order.chain []
      // атомарно удаляет план каждого флота.
      for (const id of chainMode.fleetIds) playerOrder(orderChain(ME, id, chainMode.steps));
      game.sentSound(); // квинты-арпеджио: план ушёл — маленький оперный жест
      game.note(t('tgt.placed'));
      exitChainMode();
    }
  } else if (cmd === 'chexit') {
    exitChainMode(); // выход без отправки — живые планы не тронуты
  } else if (cmd === 'more') {
    toggle('cmdMore'); // ☰ — show/hide the extras row
  } else if (cmd === 'cast') {
    toggle('castMenu'); // ✨ — открыть/закрыть меню способностей героя-флагмана
  } else if (cmd === 'castdo') {
    // Cast a hero ability from the row: ranged → arm the map (next world tap = target,
    // via the shared heroAim flow); self/aura → fire in place immediately.
    const heroId = bEl.dataset.hero ?? '';
    const abilityId = bEl.dataset.ab ?? '';
    drop('castMenu');
    if ((data.heroAbilities[abilityId]?.range ?? 0) > 0) {
      arm('heroAim', { heroId, abilityId });
      game.note(t('yard.pick.target'));
    } else {
      playerOrder(castHeroAbility(ME, heroId, abilityId));
    }
  } else if (cmd === 'boost') {
    // BOOST-1 форс-марш: toggle for the whole selection — ON unless everyone
    // already marches. Wear only bites while actually flying.
    const on = !ids.every((id) => marchFlagged(id));
    for (const id of ids) if (marchFlagged(id) !== on) playerOrder(forceMarchFleet(ME, id, on));
    if (on) game.note(t('hint.forced-march'));
  } else if (cmd === 'qauto') {
    // SO-UI: the CC-2 auto-storm stance, group-uniform (moved off the bottom sheet).
    const on = !ids.every((id) => isAutoAssault(id));
    setAutoAssault(ids, on);
    if (on) game.note(t('hint.auto-assault'));
  } else if (cmd === 'qretr') {
    // RETR-2: авто-отход. Кнопка открывает окошко с порогами (заказ владельца 2026-09-23;
    // раньше она обходила ступени по кругу, и нужный порог приходилось «прощёлкивать»).
    toggle('retreatMenu');
  } else if (cmd === 'retrset') {
    // Группой единообразно: вся группа снимается с места на одной отметке.
    //
    // Точка отхода: ВЫБРАННЫЙ свой мир, иначе столица. Выбор игроку оставлен (владелец
    // просил именно его), но без выбора приказ всё равно осмыслен — столица есть всегда,
    // пока она назначена. Нет ни того, ни другого — приказ не ставится, и игроку
    // говорят, чего не хватает, а не молчат.
    const raw = Number(bEl.dataset.at);
    const at = RETREAT_THRESHOLDS.find((x) => Math.abs(x - raw) < 1e-9) ?? null;
    if (at === null) {
      for (const id of ids) playerOrder(orderRetreat(ME, id, false));
      game.note(t('hint.auto-retreat.off'));
    } else {
      const picked = selPlanet && game.world().planets[selPlanet]?.owner === ME ? selPlanet : null;
      const to = picked ?? capitalOf(game.world(), ME) ?? null;
      if (to === null) game.note(t('hint.auto-retreat.nowhere'));
      else {
        for (const id of ids) playerOrder(orderRetreat(ME, id, true, at, to));
        game.note(t('hint.auto-retreat', { n: Math.round(at * 100), at: game.placeName(to) }));
      }
    }
    drop('retreatMenu');
  } else if (cmd === 'pick') {
    // SEL-1: touch multi-select — the sheet collapses, taps toggle own fleets.
    toggle('pickMode');
    if (pickMode && !MOBILE) game.note(t('hint.multiselect'));
  }
  invalidateCmdBar();
  game.invalidatePanel();
  renderCmdBar();
  game.renderPanel();
}
