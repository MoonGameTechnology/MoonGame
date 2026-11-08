/**
 * ПРОСТОЙ ТАП ПО КАРТЕ — выбор (вынесено из `selectAt`, `mapInput.ts`, по правилу SLIM-6:
 * функция с потолка бюджета режется, когда её трогает фича). Сюда тап доходит, только если
 * его не забрал взведённый приказ, метка плана, пинг или значок боя.
 *
 * Порядок: значок ангара своей базы (концепт «Управление эскадрой», `hangarBadge.ts`) —
 * отдельная цель для пальца, раньше всего под ним; затем развилка, затем стопка «эскадра в
 * воздухе → флоты → мир» по правилам `tapCycle.ts`.
 */
import { isOrdnanceFleet } from '../../packages/shared-core/src/state/ordnance';
import { isEmplacementFleet } from '../../decisions/emplacement';
import { badgeAt, badgeTap } from '../../decisions/hangarBadge';
import { toBake } from '../../decisions/mapLayerView';
import { pickEffect } from '../../decisions/pickApply';
import { nearestHit } from '../../decisions/pointerPick';
import {
  decisivePick,
  nextPick,
  retapsSelectedWorld,
  tapCandidates,
  touchPick,
  type TapPick,
} from '../../decisions/tapCycle';
import { fleetsUnderTap } from '../../decisions/tapTargets';
import { openTab, pairOfChoices, tabPick } from '../../decisions/worldFleetTabs';
import { fleetAnchor, forkFortressAt, forkMarkAt, strikeWorldPos } from './fleetGeometry';
import { data } from './game';
import { pcUi } from './graphicsPrefs';
import {
  mobileChoices,
  offerChoices,
  pickFork,
  pickSquadron,
  pickStrike,
  pickWorld,
  selFleet,
  selPlanet,
  selSquadron,
  selStrike,
} from './interaction';
import { world } from './mapCamera';
import { fleetSeen } from './mapFog';
import { hangarHits } from './mapHangars';
import type { MapInputHost } from './mapInput';
import { lastCardTab, pairFacts } from './worldFleetCard';

/** Палец ловит значок ангара целью не меньше 44 px (половина — 22). */
const BADGE_TOUCH_HALF = 22;

/** Сколько px от пальца до точки кандидата (`tapCycle.ts`, правило 8). Мир, пойманный
 *  только площадью провинции, — `Infinity`; крепость на развилке — `NaN`: её точку
 *  спрашивать не у кого, и такой тап решает список, как прежде. */
function tapDistance(
  game: MapInputHost,
  pick: TapPick,
  mx: number,
  my: number,
  direct: { x: number; y: number } | null,
  fortress: boolean,
): number {
  const at =
    pick.kind === 'fleet'
      ? fleetAnchor(game.world().fleets[pick.id]!)
      : pick.kind === 'strike'
        ? ((p) => (p ? world(p) : null))(strikeWorldPos(pick.id))
        : direct
          ? world(direct)
          : null;
  if (at) return Math.hypot(mx - at.x, my - at.y);
  return pick.kind === 'planet' && !fortress ? Infinity : NaN;
}

/**
 * Тап по значку ангара: одна эскадра — она, несколько — на ПК следующая по кругу, на
 * телефоне короткий список. `false` — значка под тапом нет.
 */
function hangarBadgeTap(game: MapInputHost, mx: number, my: number, touch: boolean): boolean {
  const hits = hangarHits().map((h) =>
    touch
      ? {
          ...h,
          halfW: Math.max(h.halfW, BADGE_TOUCH_HALF),
          halfH: Math.max(h.halfH, BADGE_TOUCH_HALF),
        }
      : h,
  );
  const hit = badgeAt(hits, mx, my);
  if (!hit) return false;
  const tap = badgeTap(hit.squadronIds, selSquadron, game.mobile());
  if (!tap) return false;
  if ('pick' in tap) {
    offerChoices([]);
    pickSquadron(tap.pick);
  } else {
    offerChoices(tap.list.map((id): TapPick => ({ kind: 'squadron', id })));
  }
  game.invalidatePanel();
  return true;
}

/** Обычный тап — выбор того, что под ним. */
export function plainTapSelect(
  game: MapInputHost,
  mx: number,
  my: number,
  opts: { rFleet: number; rNode: number; additive: boolean; touch: boolean },
): void {
  const s = game.world();
  const ME = game.me();
  const MOBILE = game.mobile();
  const MAP = game.nodes();
  const { rFleet, rNode, additive } = opts;
  if (!additive && hangarBadgeTap(game, mx, my, opts.touch)) return;
  // Plain tap = selection. Правила выбора и перебора стопки — `tapCycle.ts` (REFM-65).
  // Контур берём из уже нарисованных ячеек. Этот запасной выбор касается только
  // обычного тапа: приказы выше сохраняют свои прежние цели, флоты — приоритет ниже.
  const bakeAt = toBake(game.mapLayer(), mx, my); // ячейки живут в пространстве выпечки
  const provinceId = game.provinceAt(bakeAt.x, bakeAt.y);
  // FORT-6.1: крепость на развилке не узел карты, но выбирается тапом как мир — прямым
  // попаданием, раньше запасного выбора по площади провинции (развилка лежит внутри неё).
  const direct = nearestHit(MAP, (nn) => world(nn), mx, my, rNode);
  const fortress = direct ? null : forkFortressAt(mx, my, rNode);
  const n =
    direct ??
    (fortress ? { id: fortress } : undefined) ??
    MAP.find((node) => node.id === provinceId);
  // Свои флоты под тапом, ближайший первым: и мобильной ветке (ей нужен только
  // первый), и перебору на ПК (ему нужны все).
  // Также — ВИДИМЫЕ чужие флоты (опознанные или радарные): их можно выделить
  // и просмотреть состав в панели (без кнопок управления — только информация).
  // Кто вообще может попасть под тап — `tapTargets.ts` (REFM-164): свои и ВИДИМЫЕ
  // чужие (чужого выделяют для осмотра, но невидимый выдал бы туман войны), флот без
  // рисуемой точки не претендент, радиус — «в пределах», а порядок — ближайший первым
  // (иначе он зависел бы от порядка создания флотов, а не от прицела).
  const fleetIds = fleetsUnderTap(
    Object.values(s.fleets).map((f) => ({
      id: f.id,
      // Своя мина (SM-3.6), ракета (SM-3.7b) и крепость (`emplacement.ts`, правило 4) —
      // осмотр, а не выбор под приказ: у них нет приказов.
      mine: f.owner === ME && !isOrdnanceFleet(f, data) && !isEmplacementFleet(f, data),
      visible: fleetSeen(f),
      anchor: fleetAnchor(f),
    })),
    mx,
    my,
    rFleet,
  );
  // Свои эскадры в воздухе (SHU-6.14) — верх стопки (`tapCycle.ts`, правило 7).
  const strikeIds = game.strikesUnderTap(mx, my, rFleet);
  // Что следует из выбора — `pickApply.ts` (REFM-166): пустой тап это «отменить», и он
  // гасит НЕ только выделение, но и незавершённые намерения (слияние, деление, десант) —
  // иначе они применились бы к следующему выбранному флоту, молча. Выбор мира гасит
  // флоты, но намерения оставляет: записано как есть, вопрос владельцу в карточке.
  const applyPick = (pick: TapPick | null): void => {
    const effect = pickEffect(pick);
    if (effect.kind === 'clear-all') {
      game.clearSelection();
      return;
    }
    if (effect.kind === 'fleet') {
      game.setFleetSelection([effect.id]); // (clears any selected planet)
      return;
    }
    if (effect.kind === 'strike' || effect.kind === 'squadron') {
      (effect.kind === 'strike' ? pickStrike : pickSquadron)(effect.id);
      game.invalidatePanel();
      return;
    }
    pickWorld(effect.id);
    game.markSelection();
    game.invalidatePanel();
  };
  // FORT-6.1: пустая развилка — МЕСТО, где можно поставить крепость (ромб на дороге). Флот
  // на развилке (засада) и мир под пальцем важнее: их выбирают как прежде. Иначе тап по
  // ромбу открывает карточку развилки, а не провинцию вокруг неё.
  if (fleetIds.length === 0 && strikeIds.length === 0 && !direct && !fortress && !additive) {
    const mark = forkMarkAt(mx, my, Math.max(12, rNode * 0.6));
    if (mark) {
      pickFork({ province: mark.province, trail: mark.trail });
      game.markSelection();
      game.invalidatePanel();
      return;
    }
  }
  if (!pcUi()) {
    // Phone: choose explicitly from overlapping objects. The legacy tablet keeps
    // the nearest tappable fleet, else the world, else clear. No invisible cycling.
    // «Ближайший» — не обязательно свой: с UI-14 чужой видимый флот тоже отвечает на
    // тап, только осмотром (правило 6 в `fleetSelection.ts`), поэтому имя переменной
    // здесь `hit`, а не `mine` — фильтр «своё» стоит дальше, в `setFleetSelection`.
    const hit = fleetIds[0] ?? null;
    // Shift / Ctrl / ⌘ → extend the group instead of replacing it.
    if (additive && hit) {
      game.toggleFleetInSelection(hit);
      return;
    }
    if (MOBILE) {
      // Второй тап по выбранной провинции снимает выбор и тогда, когда на её орбите флоты:
      // иначе он снова открывал бы список «флот или мир» (`tapCycle.ts`, правило 6).
      if (
        retapsSelectedWorld(n?.id ?? null, selPlanet ? { kind: 'planet', id: selPlanet } : null)
      ) {
        applyPick(null);
        return;
      }
      const choices = tapCandidates(fleetIds, n?.id ?? null, strikeIds);
      // Явное попадание выбирает сразу, список — только спорному тапу (`tapCycle.ts`,
      // правило 8): иначе он открывался на каждый тап по флоту и по миру с флотом.
      const sure = decisivePick(
        choices.map((pick) => ({ pick, d: tapDistance(game, pick, mx, my, direct, !!fortress) })),
      );
      if (sure && choices.length > 1) {
        offerChoices([]);
        applyPick(sure);
        return;
      }
      // Свой мир со своим единственным флотом — не список, а одна карточка с вкладками
      // «Флот» и «Мир», открытая на вкладке прошлого раза (`worldFleetTabs.ts`, UIX-7.1).
      const pair = pairOfChoices(choices, pairFacts(game.world(), game.me()));
      if (pair) {
        offerChoices([]);
        applyPick(tabPick(pair, openTab(lastCardTab())));
        return;
      }
      offerChoices(choices.length > 1 ? choices : []);
      if (mobileChoices.length) return;
    }
    // Второй тап по выбранной провинции снимает выбор (`tapCycle.ts`, правило 6).
    applyPick(
      touchPick(
        hit,
        n?.id ?? null,
        selPlanet ? { kind: 'planet', id: selPlanet } : null,
        strikeIds[0] ?? null,
      ),
    );
    return;
  }
  // PC — RimWorld-style cycling: gather EVERY selectable object under the tap — your
  // fleets (nearest first), then the world beneath them — and each repeat tap on the
  // same spot advances to the next. So a fleet parked on its home world (or a stack of
  // fleets on one orbit) no longer permanently masks the world / the fleets below it.
  if (additive) {
    // Ctrl/⌘ → extend the fleet group with the nearest fleet under the tap (no cycling).
    if (fleetIds[0]) game.toggleFleetInSelection(fleetIds[0]);
    return;
  }
  const cands = tapCandidates(fleetIds, n?.id ?? null, strikeIds);
  const current: TapPick | null = selStrike
    ? { kind: 'strike', id: selStrike }
    : selFleet
      ? { kind: 'fleet', id: selFleet }
      : selPlanet
        ? { kind: 'planet', id: selPlanet }
        : null;
  applyPick(nextPick(cands, current));
}
