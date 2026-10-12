/**
 * Прицелы и цели карты (REFM-233, часть 2): что кадр рисует, пока взведён приказ, — путь
 * к цели под указателем с часами хода, цели «Атаки» в уголках с прогнозом боя, миры под
 * «Штурм», круги дальности и области каста, круг патруля под указателем и базы, куда
 * перелетит эскадра.
 *
 * Своего состояния у модуля нет: взведённые режимы и выбор он читает у `interaction.ts`,
 * указатель — у `mapInput.ts`, черновик телефона — у `cmdActions.ts`, а КОГО и КУДА можно
 * — у чистых правил (`engageAim.ts`, `assaultRings.ts`, `relocateTargets.ts`,
 * `aimPreview.ts`). Те же правила спрашивает нажатие, поэтому прицел не обещает приказа,
 * которого отпускание не отправит. Круги и уголки берёт у `mapOverlays.ts`. Мир, своё
 * место, кадр, узлы карты, раскладку, штурмуемость секторов и эскадру взведённого прицела
 * модуль получает хуками {@link initMapAim}: они живут в `main.ts`, и импорт оттуда был бы
 * циклом. Рисовалки зовёт кадр `renderMap()`; список целей «Атаки» и базы перелёта нужны и
 * нажатию, `main.ts` отдаёт их `mapInput.ts`.
 */
import type { Fleet, GameState, ShuttleStrike, Squadron, StrikeBase } from '../../packages/shared-core/src/index';
import {
  abilityRange,
  estimateTravelHours,
  legEndT,
  planRoute,
  roadAhead,
  squadronPatrol,
  squadronReach,
} from '../../packages/shared-core/src/index';
import { isMissileFleet } from '../../packages/shared-core/src/state/ordnance';
import { rgba } from '../../packages/client/src/holoDraw';
import { t } from '../../localization/runtime';
import {
  aimPath,
  aimTip,
  etaShown,
  etaText,
  laneSought,
  routeNeeded,
  routeViaLane,
  targetPipRadius,
} from '../../decisions/aimPreview';
import { battleForecast, battleHostility } from '../../decisions/battleForecast';
import { engageFoeAt, type EngageCandidate } from '../../decisions/engageAim';
import { engageRoster } from '../../decisions/engageRoster';
import { nearestHit } from '../../decisions/pointerPick';
import { relocateTargets, type RelocateTarget } from '../../decisions/relocateTargets';
import { tapRadius } from '../../decisions/tapPriority';
import { ringed, ringsShown } from './assaultRings';
import { mobileDraftPoint } from './cmdActions';
import { fleetAnchor, fleetOriginPx, laneAim, nearestLanePoint, selectedFleetIds, strikeBasePos, strikeWorldPos } from './fleetGeometry';
import { fmtHrs } from './format';
import { ctx, data, type MapNode } from './game';
import { fxBlur } from './graphicsPrefs';
import { aiming, assaultAim, engageAim, heroAim, merging, mobileDraft, strikeAim } from './interaction';
import { unworld, world, worldDist } from './mapCamera';
import { fleetNode, fleetSeen } from './mapFog';
import { aimPointer, tapByTouch } from './mapInput';
import { drawAbilityCircle, drawPatrolCircle, targetBrackets, type AimedSquadron } from './mapOverlays';
import { CAST_FAR, CAST_REACH, HOSTILE, LOCK, R_ARTY, R_WING, TAU } from './mapPalette';

/** Что прицелам нужно от игры. */
export interface MapAimHost {
  /** Мир, который показывает кадр. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Контекст канваса карты. */
  ctx(): CanvasRenderingContext2D;
  /** Узлы карты. */
  nodes(): readonly MapNode[];
  /** Телефонная раскладка. */
  mobile(): boolean;
  /** Берут ли сектор штурмом. */
  capturable(id: string): boolean;
  /** Эскадра взведённого прицела удара; не взведён — `null`. */
  aimSquadron(): AimedSquadron | null;
}

let game: MapAimHost;

/** Подключить прицелы к игре. */
export function initMapAim(host: MapAimHost): void {
  game = host;
}

/** Total count across a stack of units (ships, garrison or landing troops). */
const sumUnits = (stacks: ReadonlyArray<{ count: number }>): number =>
  stacks.reduce((a, s) => a + s.count, 0);

/** Кого может ударить «Атака»: видимые флоты противника с кораблями — один список на
 *  прицел, превью и нажатие (`engageAim.ts`). */
export function engageCandidates(): Array<EngageCandidate & { fleet: Fleet }> {
  const s = game.world();
  const ME = game.me();
  const out: Array<EngageCandidate & { fleet: Fleet }> = [];
  for (const g of Object.values(s.fleets)) {
    if (g.owner === ME || sumUnits(g.units) <= 0) continue;
    // Ракету корабли не бьют (решение владельца 2026-10-06): её сбивают ПРО и челноки.
    if (isMissileFleet(g, data)) continue;
    if (!fleetSeen(g)) continue;
    const at = fleetAnchor(g);
    if (!at) continue;
    out.push({ id: g.id, location: g.location ?? null, x: at.x, y: at.y, ships: sumUnits(g.units), fleet: g });
  }
  return out;
}

/** «Атака» взведена: каждая цель — в красных уголках, чтобы было видно, КОГО можно
 *  ударить (раньше прицел не рисовал ничего, и кнопка читалась как сломанная). */
export function drawEngageTargets(now: number) {
  if (!engageAim) return;
  for (const c of engageCandidates()) targetBrackets(c.x, c.y, 14, now, HOSTILE);
}

/** UIX-6.1: прогноз у цели «Атаки» — выделенные флоты против флота под прицелом. Слова и
 *  проценты решает `engageForecast.ts`; цвет только дублирует слово. Туман соблюдён тем,
 *  что цель берётся из `engageCandidates()`: там лишь флоты, чей состав игрок видит.
 *  UIX-6.3: каждый выделенный флот — своя сторона, как в бою: у каждого свой кап линии
 *  огня, и цель отвечает каждому полным залпом. Слитые в одну сторону, они считались бы
 *  один раз. ATK-3: в прогноз идёт весь бой, каким его заведёт ядро, — с идущим боем цели
 *  и с теми, кого бой втянет у её мира (`engageRoster.ts`). */
function drawEngageForecast(foe: Fleet, x: number, y: number): void {
  const cx = game.ctx();
  const s = game.world();
  const ME = game.me();
  const mine = selectedFleetIds().flatMap((id) => {
    const f = s.fleets[id];
    return f && sumUnits(f.units) > 0 ? [f] : [];
  });
  if (mine.length === 0 || sumUnits(foe.units) <= 0) return;
  const hostile = battleHostility(s);
  const card = battleForecast(engageRoster(s, ME, mine, foe, data, hostile), data, hostile);
  if (!card) return;
  const ink = card.tone === 'positive' ? LOCK : card.tone === 'negative' ? HOSTILE : R_ARTY;
  cx.save();
  cx.setLineDash([]);
  cx.textAlign = 'center';
  cx.lineWidth = 3;
  cx.strokeStyle = 'rgba(4,10,16,0.85)';
  const line = (text: string, dy: number, font: string): void => {
    cx.font = font;
    cx.strokeText(text, x, y + dy);
    cx.fillText(text, x, y + dy);
  };
  cx.fillStyle = ink;
  line(t(card.verdictKey), 28, '600 11px ui-monospace,Menlo,monospace');
  cx.fillStyle = rgba(ink, 0.85);
  line(
    t('engage.forecast.line', { h: fmtHrs(card.hours), own: card.ownLossPct, foe: card.foeLossPct }),
    42,
    '11px ui-monospace,Menlo,monospace',
  );
  cx.restore();
}

/** While ШТУРМ is armed (PC): ring every valid target — someone else's capturable
 *  world (enemy or friendly faction alike; the friendly path asks to declare war). */
export function drawAssaultTargets() {
  const cx = game.ctx();
  const s = game.world();
  const ME = game.me();
  // Кого обводим и почему — `assaultRings.ts` (REFM-106).
  if (!ringsShown(!!assaultAim)) return;
  cx.save();
  cx.strokeStyle = 'rgba(255,90,77,.85)';
  cx.lineWidth = 1.6;
  cx.setLineDash([4, 4]);
  cx.shadowColor = '#ff5a4d';
  cx.shadowBlur = fxBlur(8);
  for (const n of game.nodes()) {
    const p = s.planets[n.id];
    if (!p) continue;
    if (!ringed({ owner: p.owner, capturable: game.capturable(n.id) }, ME))
      continue;
    const c = world(n);
    cx.beginPath();
    cx.arc(c.x, c.y, 16, 0, TAU);
    cx.stroke();
  }
  cx.restore();
}

/**
 * CAST-UX — что видно, пока целишься способностью героя: КРУГ ДАЛЬНОСТИ вокруг
 * кастующего (`def.range`, те же мировые единицы, что у ядра) и, если способность
 * площадная, КРУГ ОБЛАСТИ под прицелом (`params.radius`).
 *
 * Оба радиуса берутся из каталога, а не из констант интерфейса: правило «докуда
 * достаёт» живёт в данных, и картинка обязана показывать ровно его, иначе игрок
 * целится по одной границе, а ядро считает по другой.
 *
 * Цель за пределами дальности красится отказом — это подсказка, а не запрет: финальный
 * вердикт всё равно за ядром (`E_OUT_OF_RANGE`).
 */
export function drawCastAim(): void {
  const cx = game.ctx();
  const s = game.world();
  if (!heroAim || !aimPointer) return;
  const hero = (s.heroes ?? {})[heroAim.heroId];
  const def = data.heroAbilities[heroAim.abilityId];
  if (!hero || !def) return;
  const fleet = hero.fleetId ? s.fleets[hero.fleetId] : undefined;
  // Круг досягаемости — от ТОЧКИ ОТСЧЁТА, а не от кружащей модельки: ядро меряет
  // `E_OUT_OF_RANGE` от позиции узла, и граница обязана совпадать с той, по которой
  // придёт отказ (иначе прицел врёт на радиус орбитального кольца, и каждый кадр иначе).
  const origin = fleet ? fleetOriginPx(fleet) : null;
  if (!origin) return;
  const reach = abilityRange(def);
  const aoe = Number(def.params?.radius ?? 0);
  const far = reach > 0 && Math.hypot(aimPointer.x - origin.x, aimPointer.y - origin.y) > worldDist(reach);
  cx.save();
  if (reach > 0) {
    cx.strokeStyle = rgba(far ? CAST_FAR : CAST_REACH, 0.5);
    cx.lineWidth = 1.2;
    cx.setLineDash([6, 6]);
    cx.beginPath();
    cx.arc(origin.x, origin.y, worldDist(reach), 0, TAU);
    cx.stroke();
  }
  if (aoe > 0) drawAbilityCircle(aimPointer.x, aimPointer.y, worldDist(aoe), 0.14);
  cx.restore();
}

/**
 * ПРИЦЕЛ ПАТРУЛЯ (SHU-6.3): под указателем — круг, в котором эскадра будет бить, если
 * поставить точку здесь. Круг дальности вокруг базы рисует `drawCombatRanges` — тот же,
 * что у удара: дальность у обоих приказов одна (`squadronReach`). Точка за дальностью
 * красит круг отказом — подсказка, а не запрет, вердикт за ядром (`E_OUT_OF_RANGE`), как
 * у каста (`drawCastAim`).
 */
export function drawPatrolAim(): void {
  if (!strikeAim?.patrol || !aimPointer) return;
  const found = game.aimSquadron();
  if (!found) return;
  const home = strikeBasePos(
    'planetId' in found.base
      ? { kind: 'planet', id: found.base.planetId }
      : { kind: 'fleet', id: found.base.fleetId },
  );
  if (!home) return;
  const at = unworld(aimPointer);
  const far = Math.hypot(at.x - home.x, at.y - home.y) > squadronReach(found.sq, data);
  // Перенесённый патруль держит круг, снятый на вылете (SHU-6.13) — его и рисуем.
  const rPx = worldDist(found.aloft?.patrol?.radius ?? squadronPatrol(found.sq, data).radius);
  drawPatrolCircle(aimPointer, rPx, 'aim', far ? CAST_FAR : R_WING);
}

/**
 * ПЕРЕЛЁТ ВЗВЕДЁН (SHU-6.5): каждая база, куда эскадра перелетит, — в уголках цвета
 * крыла, как цель «Атаки» в красных. Какие базы — решает `relocateTargets.ts` тем же
 * условием, по которому ядро примет приказ, поэтому база без уголков — та, куда эскадра
 * не долетит или где ей не хватит мест. Круг дальности перелёта вокруг базы рисует
 * `drawCombatRanges`.
 */
export function drawRelocateTargets(now: number): void {
  for (const spot of relocateSpots()) {
    const at = relocateSpotPx(spot.base);
    if (at) targetBrackets(at.x, at.y, 16, now, R_WING);
  }
}

/** Куда может перелететь эскадра взведённого перелёта; не взведён — никуда. База — та,
 *  с которой взведён прицел: с неё же уйдёт приказ. */
export function relocateSpots(): RelocateTarget[] {
  if (!strikeAim?.relocate) return [];
  const found = game.aimSquadron();
  return found ? squadronRelocateSpots(found.sq, found.base, found.aloft) : [];
}

/** Свои базы, куда эскадра перелетит с базы `from` (`relocateTargets.ts`). Позиции — та
 *  же `strikeBasePos`, что у трассы: идущий корабль стоит там, где его рисует карта. У
 *  эскадры в воздухе (`aloft`, SHU-6.14) дальность — от её значка на трассе. */
export function squadronRelocateSpots(
  sq: Squadron,
  from: { planetId: string } | { fleetId: string },
  aloft: ShuttleStrike | null = null,
): RelocateTarget[] {
  const s = game.world();
  const ME = game.me();
  const base: StrikeBase =
    'planetId' in from ? { kind: 'planet', id: from.planetId } : { kind: 'fleet', id: from.fleetId };
  const at = aloft ? strikeWorldPos(aloft.id) : null;
  if (aloft && !at) return [];
  return relocateTargets(s, {
    me: ME,
    from: base,
    squadron: sq,
    data,
    pos: strikeBasePos,
    ...(aloft && at ? { aloft: { at, returning: aloft.leg === 'back' } } : {}),
  });
}

/** Где база на ЭКРАНЕ — там, куда тапают: мир в своей точке, корабль у шеврона. */
export function relocateSpotPx(base: StrikeBase): { x: number; y: number } | null {
  const s = game.world();
  if (base.kind === 'planet') {
    const p = s.planets[base.id];
    return p ? world(p.position) : null;
  }
  const f = s.fleets[base.id];
  return f ? fleetAnchor(f) : null;
}

/** While "Move" is armed: a dashed line from each selected fleet to the world under
 *  the pointer (snaps to the nearest blip) — preview before committing. */
export function drawAimPreview(now: number) {
  const cx = game.ctx();
  const s = game.world();
  const MAP = game.nodes();
  const MOBILE = game.mobile();
  const pointer = MOBILE ? mobileDraftPoint() : aimPointer;
  if (!pointer) return;
  if (MOBILE && mobileDraft && (engageAim || merging)) {
    targetBrackets(pointer.x, pointer.y, 22, now, engageAim ? HOSTILE : LOCK);
    const staged = mobileDraft.target;
    const foe = engageAim && staged.kind === 'fleet' ? s.fleets[staged.id] : undefined;
    if (foe) drawEngageForecast(foe, pointer.x, pointer.y);
    return;
  }
  if (!(aiming || assaultAim || engageAim)) return;
  const ids = selectedFleetIds();
  if (!ids.length) return;
  // «Атака»: путь — к флоту противника под указателем (или на мире под ним), красным
  // пунктиром; нет цели — пути нет, уголки на целях показывают, куда вести.
  const foeAim = engageAim
    ? engageFoeAt(
        engageCandidates(),
        pointer,
        tapRadius('fleet', tapByTouch),
        nearestHit(MAP, (n) => world(n), pointer.x, pointer.y, tapRadius('node', tapByTouch))?.id ?? null,
      )
    : null;
  if (engageAim && !foeAim) return;
  // Prefer a node target; if none is near, aim at the closest point ON a lane —
  // the army will route to that road and park there (Bytro continuous order).
  // Радиус захвата узла — `tapPriority.ts` (REFM-125, правило 5), поиск ближайшего —
  // `pointerPick.ts` (REFM-33). Прицел и коммит ОБЯЗАНЫ смотреть одним радиусом: здесь
  // стояла своя копия тех же чисел (30 пальцем, 24 мышью), и разъедься она с тапом —
  // превью рисовало бы путь, которого отпускание не отправит, причём молча.
  const rAim = tapRadius('node', tapByTouch);
  const staged = mobileDraft?.target;
  const hit = foeAim
    ? (foeAim.location ? MAP.find((n) => n.id === foeAim.location) ?? null : null)
    : MOBILE
      ? (staged?.kind === 'planet' ? MAP.find((n) => n.id === staged.id) : null)
      : nearestHit(MAP, (n) => world(n), pointer.x, pointer.y, rAim);
  let target: { x: number; y: number } | null = foeAim ? { x: foeAim.x, y: foeAim.y } : hit ? world(hit) : null;
  const targetId: string | null = hit?.id ?? null;
  // Из чего складывается линия и что она обещает — `aimPreview.ts` (REFM-196): мир важнее
  // дороги (дорога ищется, только если узла рядом НЕТ), остриё падает на сам палец, путь
  // идёт по МАРШРУТУ через центры провинций, а не прямой, и без маршрута всё равно
  // дотягивается до острия — иначе не рисуется ничего, и игрок читает это как «не взведено».
  const laneTarget = foeAim
    ? null
    : MOBILE
      ? (mobileDraft?.target.kind === 'lane' ? { ...mobileDraft.target, ...pointer } : null)
      : laneSought(targetId) ? nearestLanePoint(pointer.x, pointer.y) : null;
  if (laneTarget) target = { x: laneTarget.x, y: laneTarget.y };
  const tip = foeAim ? { x: foeAim.x, y: foeAim.y } : aimTip(target, pointer);
  const ink = foeAim ? HOSTILE : LOCK;
  cx.save();
  cx.strokeStyle = rgba(ink, foeAim ? 0.85 : 0.6);
  cx.lineWidth = foeAim ? 1.8 : 1.4;
  cx.setLineDash(foeAim ? [6, 5] : [3, 5]);
  cx.shadowColor = ink;
  cx.shadowBlur = fxBlur(6);
  for (const id of ids) {
    const f = s.fleets[id];
    if (!f) continue;
    const anchor = fleetOriginPx(f);
    if (!anchor) continue;
    // draw the ROUTED march path through province centres (Bytro-style), so you
    // see the actual road the army will take — not a straight line to the target.
    const from = fleetNode(f);
    const a: { x: number; y: number } = anchor;
    // For a lane target, route to the endpoint the army enters through, then a
    // final segment to the point on the road.
    const routeEndId = routeViaLane(!!laneTarget, from)
      ? laneAim(f, from!, laneTarget!).endId
      : targetId;
    // The march along ROADS (ROADS-2), with the kernel's fork rule (`roadAhead`): through a
    // fork past a world where the fleet will go round it, and on a lane target the last
    // stretch along that lane's road to the point — not straight hops between centres.
    let route: string[] = [];
    if (routeNeeded(from, routeEndId)) route = planRoute(s, from!, routeEndId!) ?? [];
    const park =
      laneTarget && routeEndId
        ? routeEndId === laneTarget.from
          ? { to: laneTarget.to, t: laneTarget.t }
          : { to: laneTarget.from, t: 1 - laneTarget.t }
        : null;
    const marchHops = park ? [...route, park.to] : route;
    const hops =
      from && marchHops.length > 0
        ? roadAhead(
            s,
            {
              from,
              to: marchHops[0]!,
              path: marchHops.slice(1),
              endT: legEndT(s, from, marchHops[0]!, marchHops[1], 0, park ? park.t : 1),
              ...(park ? { parkT: park.t } : {}),
            },
            0,
          )
            .slice(1)
            .map((p) => world(p))
        : [];
    const pts = aimPath(a, hops, null, tip);
    cx.beginPath();
    cx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) cx.lineTo(pts[i]!.x, pts[i]!.y);
    cx.stroke();
  }
  if (target) {
    cx.setLineDash([]);
    cx.beginPath();
    cx.arc(tip.x, tip.y, targetPipRadius(!!laneTarget), 0, TAU);
    cx.stroke();
    // travel-time estimate to this target for the first selected fleet (longer
    // route → more hours; the authoritative time is computed by the server).
    const f0 = s.fleets[ids[0]!];
    const from = f0 ? fleetNode(f0) : null;
    let hrs: number | null = null;
    if (f0 && from) {
      if (laneTarget) hrs = laneAim(f0, from, laneTarget).hrs;
      else if (targetId) hrs = estimateTravelHours(s, ctx(s.time), from, targetId, f0);
    }
    if (etaShown(hrs)) {
      cx.font = '11px ui-monospace,Menlo,monospace';
      cx.textAlign = 'center';
      cx.fillStyle = rgba(ink, 0.95);
      cx.fillText(etaText(hrs!), tip.x, tip.y - 22);
    }
  }
  cx.restore();
  // Поверх пути, чтобы пунктир не перечёркивал цифры прогноза.
  if (foeAim) drawEngageForecast(foeAim.fleet, foeAim.x, foeAim.y);
}
