/**
 * Композер цепочек «Приказ» (REFM-229): режим, в котором карта становится рабочей
 * поверхностью и тапы по точкам собирают план флота (CC-1 цепочка). Вход и выход
 * (`enterChainMode`, `exitChainMode`), тап карты в режиме (`chainMapTap`), меню действий
 * точки в плавающем боксе `#tgted` и его нажатия, а ещё запросы, на которых стоят план,
 * его таймлайн и полилиния: живой план флота, ближайший свой мир, способности героя на
 * борту, старт плана, оценка перелёта, маршрут с кэшем на матч и флаг форс-марша.
 *
 * Модуль — владелец черновика `chainMode`; снаружи его только читают. Полоска режима и
 * обработчик её кнопок живут в ряду команд (REFM-226, REFM-227) и правят черновик
 * дверями {@link setChainDraft}, {@link keepChainFleets} и {@link dropChainMenu};
 * смена матча забывает маршруты дверью {@link forgetChainRoutes}. Рисование цепочек на
 * карте и их бейджи уедут с картой (REFM-234).
 *
 * Мир, своё место, ленту, узлы карты, тип сектора, источник тапа, проекцию на экран и
 * перерисовку ряда и панели модуль получает хуками {@link initChainComposer} — импорт из
 * `main.ts` был бы циклом.
 */
import type { Fleet, GameState, Hero } from '../../packages/shared-core/src/index';
import type { MapNode } from './game';
import { ctx, data, FORCED_MARCH_MULT, HOUR, MAX_CHAIN_STEPS, type ChainStep } from './game';
import {
  estimateTravelHours,
  journeyDestination,
  planRoute,
} from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { nearestHit } from '../../decisions/pointerPick';
import { tapRadius } from '../../decisions/tapPriority';
import { chainTapTarget, nearestOwnWorld as ownWorldNearest } from './chainTarget';
import {
  applyMenuAction,
  chainMenuHtml,
  chainMenuItems,
  draftFrom,
  type ChainAbility,
  type ChainPointKind,
} from './chainPlanner';
import { fleetAnchor } from './fleetGeometry';
import { castOptions, heroAboard, wornAbilities, type CastOption } from './heroCasts';
import { HERO_CASTABLE, heroCdKey } from './heroStaff';
import { drop } from './interaction';
import { world } from './mapCamera';
import { fleetNode } from './mapFog';
import { stickToPoint } from './screenAnchor';
import { arrivalHours, marchHours, restRouteHours } from './travelEta';

/** Что композеру нужно от игры. Мир, лента, карта и ряд команд живут в `main.ts`. */
export interface ChainComposerHost {
  /** Мир на экране. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Строка в ленту. */
  note(text: string, at?: string): void;
  /** Узлы карты этой партии. */
  nodes(): readonly MapNode[];
  /** Можно ли захватить мир этого сектора. */
  capturable(id: string): boolean;
  /** Тап пришёл пальцем: радиусы попадания крупнее, чем у мыши. */
  touchTap(): boolean;
  /** Точка карты в экранных координатах страницы. */
  screenPoint(p: { x: number; y: number }): { x: number; y: number };
  /** Ряд команд собрать заново. */
  invalidateCmdBar(): void;
  /** Боковую панель собрать заново. */
  invalidatePanel(): void;
}

let game: ChainComposerHost;

/** Поднять композер: хуки игры и нажатия меню точки. Зовётся из `main.ts` один раз. */
export function initChainComposer(host: ChainComposerHost): void {
  game = host;
  document.getElementById('tgted')?.addEventListener('click', onMenuClick);
}

// TGT-1: target-order composer over CC-1 chains. «Цель» arms targeting; the next
// CHAIN-UX «Приказ» (перерос TGT-1): персистентный режим построения плана тапами по
// карте. Пока он жив, карта — рабочая поверхность: тап по точке открывает меню
// действий ПО ТИПУ точки, выбор дописывает жест в черновик, полоска вместо cmdbar
// держит ⟲/⌂/✓/✕. Черновик привязан к fleetIds, НЕ к выделению (как старый композер).
export let chainMode: {
  fleetIds: string[];
  steps: ChainStep[];
  gestures: number[];
  menu: { id: string; kind: ChainPointKind } | null;
} | null = null;
// Кэш маршрутов для отрисовки цепочек: граф лейнов статичен всю партию.
const chainRouteCache = new Map<string, string[] | null>();

/** Смена матча: маршруты принадлежат карте старой партии. */
export function forgetChainRoutes(): void {
  chainRouteCache.clear();
}
/** Заменить черновик режима (⟲ снимает жест, ⌂ дописывает дорогу домой). */
export function setChainDraft(next: { steps: ChainStep[]; gestures: number[] }): void {
  if (!chainMode) return;
  chainMode.steps = next.steps;
  chainMode.gestures = next.gestures;
}
/** Оставить в режиме только эти флоты (погибшие и отданные выпадают сами). */
export function keepChainFleets(fleetIds: string[]): void {
  if (chainMode) chainMode.fleetIds = fleetIds;
}
/** Закрыть меню точки, не выходя из режима. */
export function dropChainMenu(): void {
  if (chainMode) chainMode.menu = null;
}

// --- TGT-1: target-order composer (CC-1 chains rendered target-side) ---------
/** BOOST-1: is this fleet on форс-марш? (authoritative map, both modes). */
export function marchFlagged(fid: string): boolean {
  return (game.world() as { forcedMarch?: Record<string, true> }).forcedMarch?.[fid] === true;
}
/** CC-1 plan of an OWN fleet — authoritative in both modes (the module runs in MODULES). */
export function chainStepsOf(fid: string): ChainStep[] | null {
  const ch = (game.world() as { orders?: Record<string, { steps: ChainStep[] }> }).orders?.[fid];
  return ch ? ch.steps : null;
}
/** The closest OWN world to `fromId` — the «Домой» leg of a composed plan (REFM-66). */
export function nearestOwnWorld(fromId: string): string | null {
  return ownWorldNearest(
    fromId,
    Object.values(game.world().planets).map((p) => ({
      id: p.id,
      owner: p.owner ?? null,
      x: p.position.x,
      y: p.position.y,
    })),
    game.me(),
  );
}
/** Способности героя на борту — данные для пунктов меню (CC-1 × HERO-4; та же
 *  фильтрация, что у старого композера: только кастуемые типы). */
export function chainAbilitiesFor(fleetIds: string[]): ChainAbility[] {
  const hero = heroAboard(Object.values(game.world().heroes ?? {}), fleetIds);
  if (!hero) return [];
  return castOptionsOf(hero).map((opt) => {
    const ad = data.heroAbilities[opt.id]!;
    return {
      id: opt.id,
      name: tData(ad.name),
      cdH: opt.cdH,
      ranged: opt.ranged,
      ...(ad.description ? { desc: t(ad.description) } : {}),
    };
  });
}
/** Слоты героя, разрешённые по игровым данным → пункты каста (`heroCasts.ts`, REFM-68).
 *  Одна точка разрешения на все три места, которые спрашивают «что можно применить»:
 *  кнопка ✨ командной полосы, её поповер и меню точки режима «Приказ». */
export function castOptionsOf(hero: Hero): CastOption[] {
  // Только надетое (правило 6 `heroCasts.ts`): ненадетую ядро не применит.
  const specs = wornAbilities(hero).map((ab) => {
    const ad = data.heroAbilities[ab];
    if (!ad) return null;
    return {
      id: ab,
      type: ad.type,
      range: ad.range,
      readyAt: hero.cooldowns?.[heroCdKey(ad.type)],
    };
  });
  return castOptions(specs, HERO_CASTABLE, game.world().time, HOUR);
}
/** Остаток кулдауна способности — единственный реальный холд драйвера цепочек. */
export function chainAbilityHoldH(fleetIds: string[]): (abilityId: string) => number {
  const abs = chainAbilitiesFor(fleetIds);
  return (id) => abs.find((a) => a.id === id)?.cdH ?? 0;
}
/** Старт плана флота: летящий начнёт исполнять цепочку в пункте назначения —
 *  от него и считаем (голова авторитетна по arrivesAt, хвост — оценка). */
export function chainStart(f: Fleet): { fromId: string | null; baseH: number } {
  const s = game.world();
  if (f.movement) {
    const mv = f.movement;
    const dest = journeyDestination(mv);
    const rawRestH = dest !== mv.to ? estimateTravelHours(s, ctx(s.time), mv.to, dest, f) : 0;
    const restH = restRouteHours(rawRestH, marchFlagged(f.id), FORCED_MARCH_MULT);
    return { fromId: dest, baseH: arrivalHours(mv.arrivesAt, s.time, HOUR, restH) };
  }
  return { fromId: fleetNode(f), baseH: 0 };
}
/** Оценка перелёта для таймлайна (форс-марш ускоряет, как в pn-eta панели: REFM-67). */
export function chainTravelH(f: Fleet): (from: string, to: string) => number | null {
  const boosted = marchFlagged(f.id);
  return (from, to) => {
    const s = game.world();
    return marchHours(estimateTravelHours(s, ctx(s.time), from, to, f), boosted, FORCED_MARCH_MULT);
  };
}
/** Маршрут для полилинии цепочки. Граф лейнов статичен всю партию — кэш на матч
 *  (Дейкстра на каждый кадр для каждого шага была бы расточительна). */
export function chainRoute(from: string, to: string): string[] | null {
  const key = `${from}>${to}`;
  let hops = chainRouteCache.get(key);
  if (hops === undefined) {
    hops = planRoute(game.world(), from, to);
    chainRouteCache.set(key, hops);
  }
  return hops;
}
/** Вход в режим «Приказ»: черновик — живой план ПЕРВОГО флота (весь префилл — один
 *  жест, ⟲ снимает его целиком). Режим держит свои fleetIds и живёт без выделения. */
export function enterChainMode(fleetIds: string[]): void {
  const s = game.world();
  const mine = fleetIds.filter((id) => s.fleets[id]?.owner === game.me());
  if (!mine.length) return;
  const pre = draftFrom(chainStepsOf(mine[0]!) ?? []);
  chainMode = { fleetIds: mine, steps: pre.steps, gestures: pre.gestures, menu: null };
  drop('aiming');
  game.note(t('hint.pick-order'));
  game.invalidateCmdBar();
  game.invalidatePanel();
}
export function exitChainMode(): void {
  chainMode = null;
  document.getElementById('tgted')?.classList.remove('show');
  document.body.classList.remove('chain-mode');
  game.invalidateCmdBar();
  game.invalidatePanel();
}
/** Тап карты в режиме: точка → меню действий по её типу, пустота → закрыть меню.
 *  Радиусы хитов берутся из того же `tapPriority.ts`, что и у selectAt: вторая копия
 *  чисел рассинхронилась бы и рисовала одно, а слала другое.
 *  Приоритет цели («мир важнее флота» — наоборот к обычному выделению) — `chainTarget.ts`. */
export function chainMapTap(mx: number, my: number): void {
  if (!chainMode) return;
  const s = game.world();
  const ME = game.me();
  const touch = game.touchTap();
  const n = nearestHit(game.nodes(), (nn) => world(nn), mx, my, tapRadius('node', touch));
  const foe = n
    ? null
    : nearestHit(
        Object.values(s.fleets).filter((f) => f.owner !== ME),
        fleetAnchor,
        mx,
        my,
        tapRadius('fleet', touch),
      );
  const target = chainTapTarget(
    n ? { id: n.id, owner: s.planets[n.id]?.owner ?? null } : null,
    foe?.id ?? null,
    ME,
  );
  chainMode.menu = target;
  if (target) {
    renderChainMenu();
    return;
  }
  document.getElementById('tgted')?.classList.remove('show');
}
/** Экранная позиция точки открытого меню (флот движется — зовётся покадрово). */
export function chainMenuAnchor(): { x: number; y: number } | null {
  const m = chainMode?.menu;
  if (!m) return null;
  const s = game.world();
  if (m.kind === 'fleet') {
    const f = s.fleets[m.id];
    return f ? fleetAnchor(f) : null;
  }
  const pl = s.planets[m.id];
  return pl ? world(pl.position) : null;
}
/** Меню точки — в том же плавающем боксе #tgted, что жил у старого композера.
 *  Позицию каждый кадр обновляет updateChainDom (меню едет с камерой и флотом). */
export function renderChainMenu(): void {
  const el = document.getElementById('tgted');
  if (!el || !chainMode) return;
  const m = chainMode.menu;
  if (!m) {
    el.classList.remove('show');
    return;
  }
  const f0 = game.world().fleets[chainMode.fleetIds[0]!];
  const startId = f0 ? chainStart(f0).fromId : null;
  const items = chainMenuItems(
    { steps: chainMode.steps, gestures: chainMode.gestures },
    m,
    startId,
    {
      capturable: m.kind !== 'fleet' && game.capturable(m.id),
      abilities: chainAbilitiesFor(chainMode.fleetIds),
    },
  );
  el.innerHTML = chainMenuHtml(
    t('tgt.title'),
    `${m.id} · ${chainMode.steps.length}/${MAX_CHAIN_STEPS}`,
    items,
  );
  el.classList.add('show');
  positionChainMenu(el);
}
/** Приклеить бокс меню к точке карты (кламп в вьюпорт — как у старого композера). */
export function positionChainMenu(el: HTMLElement): void {
  const a = chainMenuAnchor();
  if (!a) return;
  const at = game.screenPoint(a);
  // Ставим округлённое и от НЕГО же считаем поправки: коробка измерена уже при этом
  // css-top, поэтому смешивать её с неокруглённой проекцией нельзя — разъедется на пиксель.
  const left0 = Math.round(at.x);
  const top0 = Math.round(at.y);
  el.style.left = `${left0}px`;
  el.style.top = `${top0}px`;
  // Поставили в округлённое → измерили → поправили: зажатие по экрану и подъём из-под
  // хрома считает `screenAnchor.ts` (правило 5, REFM-133), общий с всплывашкой метки.
  const b = el.getBoundingClientRect();
  const at2 = stickToPoint(
    { x: left0, y: top0 },
    { width: b.width, top: b.top },
    window.innerWidth,
  );
  el.style.left = `${at2.x}px`;
  el.style.top = `${at2.y}px`;
}
function onMenuClick(ev: Event): void {
  const btn = (ev.target as HTMLElement).closest('button');
  if (!btn || btn.disabled || !chainMode || !chainMode.menu) return;
  const act = btn.dataset.ch as 'move' | 'wait' | 'wait6' | 'assault' | 'ability' | undefined;
  if (!act) return;
  const f0 = game.world().fleets[chainMode.fleetIds[0]!];
  const startId = f0 ? chainStart(f0).fromId : null;
  const ab = btn.dataset.chab
    ? chainAbilitiesFor(chainMode.fleetIds).find((a) => a.id === btn.dataset.chab)
    : undefined;
  const next = applyMenuAction(
    { steps: chainMode.steps, gestures: chainMode.gestures },
    act,
    chainMode.menu,
    startId,
    ab,
  );
  if (!next) {
    game.note('✖ ' + t('chain.full'));
    return;
  }
  chainMode.steps = next.steps;
  chainMode.gestures = next.gestures;
  game.invalidateCmdBar(); // полоска пересоберётся (счётчик шагов/кнопки)
  // ⏱/🎯 наращивают часы повторными тапами — меню живёт; остальное закрывает его.
  if (btn.dataset.keep) renderChainMenu();
  else {
    chainMode.menu = null;
    document.getElementById('tgted')?.classList.remove('show');
  }
}
