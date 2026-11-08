/**
 * Ввод на карте (REFM-236): тап и клик `selectAt`, пальцы и мышь на холсте, рамка выделения,
 * удержание, щипок, колесо, двойной клик и курсор над целью.
 *
 * Модуль только решает, ЧЕЙ это жест, и передаёт его владельцу: прицелы и выбор живут в
 * `interaction.ts`, приказы уходят конвейером (`orderPipeline.ts`) или группой
 * (`groupOrders.ts`), камера двигается дверями `mapCamera.ts`, тапы режима «Приказ» берёт
 * `chainComposer.ts`, мобильный черновик — `cmdActions.ts`. Правила жестов — чистые решения
 * из `decisions/` (`pressIntent`, `dragIntent`, `aimGesture`, `tapPriority`, `tapCycle`…).
 *
 * Своё состояние модуль держит сам и отдаёт только на чтение: пальцы на карте (`pointers`),
 * был ли тап пальцем (`tapByTouch`), щипок (`pinchStart`), точку прицела под мышью или
 * пальцем (`aimPointer`) и рамку выделения (`selectionBox`). Снаружи их сбрасывают
 * дверями `forgetAimPointer` и `forgetAdditive`.
 *
 * Мир, своё место, раскладку, узлы карты, ленту, панель, выбор флотов, метки планов и
 * пингов, окно боя, отход из боя, эскадры и слой карты модуль получает хуками
 * `initMapInput(host)`.
 */
import type {
  Fleet,
  GameState,
  ShuttleStrike,
  Squadron,
  StrikeBase,
} from '../../packages/shared-core/src/index';
import { isMissileFleet, isOrdnanceFleet } from '../../packages/shared-core/src/state/ordnance';
import { t } from '../../localization/runtime';
import {
  elasticCam as camElasticCam,
  elasticPull as camElasticPull,
  pinchAt as camPinchAt,
} from '../../packages/client/src/camera';
import {
  allyOrder,
  patrolShuttle,
  redirectSquadron,
  relocateAloft,
  relocateShuttle,
  retreatBattle,
  setRallyPoint,
} from '../../decisions/actions';
// AIM-PAN — «коммитит ли отпускание вооружённый приказ»: правило со сторожем.
import { releaseCommits } from '../../decisions/aimGesture';
import {
  assaultTargetOk,
  deployPick,
  hostileFleets,
  mergeAnchors,
  ownFleets,
} from '../../decisions/aimTargets';
import { linkedAlly } from '../../decisions/allyPanel';
import { armedTap } from '../../decisions/armedTap';
import { battleAtTap, battleBadgePoint } from '../../decisions/battleTap';
import { captiveAtRisk } from '../../decisions/captive';
// REFM-199: что означает ЕДУЩИЙ палец — брат `aimGesture.ts` (тот про отпускание).
import { cameraFollows, dragIntent, marksDragged } from '../../decisions/dragIntent';
import { isEmplacementFleet } from '../../decisions/emplacement';
import { engageFoeAt, type EngageCandidate } from '../../decisions/engageAim';
import {
  IDLE,
  MAP_HOLD_MS,
  consumeClick,
  mature,
  press,
  release,
  type HoldState,
} from '../../decisions/holdPress';
import { type LayerTransform } from '../../decisions/mapLayerView';
import { rallyPick } from '../../decisions/rallyPoint';
import {
  boxSelection,
  insideBox,
  movedBeyondSlop,
  nearestHit,
  pickRadius,
  pinchOf,
} from '../../decisions/pointerPick';
import { longPressAction, pressIntent } from '../../decisions/pressIntent';
import type { RelocateTarget } from '../../decisions/relocateTargets';
import { tapOwner, tapRadius } from '../../decisions/tapPriority';
import { rightClickAct } from '../../decisions/rightClick';
import { chainMapTap, chainMode, enterChainMode } from './chainComposer';
import { engageTarget, mobileOrderKind, stageMobileTarget } from './cmdActions';
import { battleAnchor, fleetAnchor, nearestLanePoint, selectedFleetIds } from './fleetGeometry';
import {
  castHeroAbility,
  data,
  retreatFleet,
  spawnHero,
  strikeShuttle,
  type MapNode,
} from './game';
import { pcUi } from './graphicsPrefs';
import { orderMerge, tryAssaultGroup, tryMoveEdgeGroup, tryMoveGroup } from './groupOrders';
import {
  aiming,
  allyAim,
  arm,
  assaultAim,
  deselectFleets,
  drop,
  engageAim,
  heroAim,
  heroSpawnAim,
  merging,
  pickMode,
  rallyAim,
  retreatAim,
  strikeAim,
} from './interaction';
import {
  cam,
  defaultView,
  dragBy,
  holdCam,
  insets,
  mapBounds,
  panelSlack,
  releaseCam,
  setView,
  unworld,
  world,
  zoomAt,
} from './mapCamera';
import { battleKnown, fleetSeen } from './mapFog';
import { playerOrder } from './orderPipeline';
import { plainTapSelect } from './mapTapSelect';
import { fromScreen } from './screenAnchor';

/** Что вводу на карте нужно от игры. */
export interface MapInputHost {
  /** Мир на экране. Конвейер подменяет его после каждого приказа — читать заново. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Телефонная раскладка. */
  mobile(): boolean;
  /** Ширина холста в CSS-пикселях. */
  vw(): number;
  /** Высота холста в CSS-пикселях. */
  vh(): number;
  /** Узлы карты матча. */
  nodes(): readonly MapNode[];
  /** Строка в ленту. */
  note(text: string): void;
  /** Сбросить кэш панели. */
  invalidatePanel(): void;
  /** Берут ли сектор штурмом. */
  capturable(id: string): boolean;
  /** ◎-бейджи отправленных планов, нарисованные в этом кадре. */
  chainHits(): ReadonlyArray<{ fleetIds: string[]; x: number; y: number }>;
  /** Метки пингов союзников, нарисованные в этом кадре. */
  pingHits(): ReadonlyArray<{ loc: string; x: number; y: number }>;
  /** Закрыть описание пинга. */
  closePingPop(): void;
  /** Открыть описание пинга у места. */
  openPingPop(loc: string): void;
  /** Открыть окно боя. */
  openBattle(id: string): void;
  /** Бой, из которого взведён отход всей стороной; `null` — отход одного флота. */
  battleRetreatAim(): string | null;
  /** Забыть бой отхода. */
  clearBattleRetreatAim(): void;
  /** Отметить начало выбора (вспышка выделенного). */
  markSelection(): void;
  /** Снять выбор и всё, что за него держится. */
  clearSelection(): void;
  /** Выделить флоты. */
  setFleetSelection(ids: string[]): void;
  /** Добавить флот в группу или убрать из неё. */
  toggleFleetInSelection(id: string): void;
  /** Чужие флоты, которые прицел «Атаки» может взять. */
  engageCandidates(): Array<EngageCandidate & { fleet: Fleet }>;
  /** Слой карты: перевод экранной точки в пространство выпечки. */
  mapLayer(): LayerTransform;
  /** Провинция в точке выпечки. */
  provinceAt(x: number, y: number): string | undefined;
  /** Свой вылет по id. */
  ownStrike(id: string): ShuttleStrike | null;
  /** Своя эскадра и её база. */
  squadronAt(id: string): { sq: Squadron; base: { planetId: string } | { fleetId: string } } | null;
  /** Базы, куда эскадра может перелететь. */
  squadronRelocateSpots(
    sq: Squadron,
    from: { planetId: string } | { fleetId: string },
    aloft?: ShuttleStrike | null,
  ): RelocateTarget[];
  /** Эскадра вылета. */
  strikeSquadron(st: ShuttleStrike): Squadron;
  /** База вылета. */
  strikeFrom(st: ShuttleStrike): { planetId: string } | { fleetId: string };
  /** Свои вылеты под тапом, ближайший первым. */
  strikesUnderTap(mx: number, my: number, r: number): string[];
  /** Точка базы перелёта на экране. */
  relocateSpotPx(base: StrikeBase): { x: number; y: number } | null;
}

let game: MapInputHost;
let canvas: HTMLCanvasElement;

/** Подключить ввод к холсту `#map`. Слушатели встают в прежнем порядке. */
export function initMapInput(host: MapInputHost): void {
  game = host;
  canvas = document.getElementById('map') as unknown as HTMLCanvasElement;
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', cancelPointer);
  canvas.addEventListener('lostpointercapture', cancelPointer);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('dblclick', () => defaultView());
  canvas.addEventListener('pointermove', hover);
  canvas.addEventListener('pointerleave', () => canvas.classList.remove('cur-hot'));
  canvas.addEventListener('contextmenu', rightClick);
}

/** Shift или Ctrl/⌘ на текущем тапе: добрать флот в группу, а не заменить. */
let additive = false;
/** Смена матча: модификатор старого жеста не переходит в новый. */
export function forgetAdditive(): void {
  additive = false;
}

/** Последняя точка указателя на холсте (для превью прицела). Снаружи только читают. */
export let aimPointer: { x: number; y: number } | null = null;
/** Прицел взведён с телефона: прежняя точка касания нарисовала бы круг не там. */
export function forgetAimPointer(): void {
  aimPointer = null;
}

/** Рамка выделения в пикселях холста; `null` — рамки нет. Снаружи только читают. */
export let selectionBox: { x1: number; y1: number; x2: number; y2: number } | null = null;

/** Убежище пленного главы V (PVR-9.5), по которому уже предупредили: удар, губящий мир,
 *  по нему проходит со второго тапа (`captiveAtRisk`). Любой другой тап прицела сбрасывает. */
let captiveWarned: string | null = null;

/**
 * Тап взведённого прицела ЭСКАДРЫ В ВОЗДУХЕ (SHU-6.14): цели те же, что у взлёта из ангара
 * (чужой видимый флот, иначе мир; точка патруля; подсвеченная база перелёта), но приказ
 * меняет курс вылета — `shuttle.redirect` или перелёт по id вылета. Годится ли цель,
 * решает ядро: отказ приходит объяснением (`errText`), промах снимает прицел.
 */
function aloftAimTap(
  strikeId: string,
  patrol: boolean,
  relocate: boolean,
  mx: number,
  my: number,
  rFleet: number,
  rNode: number,
): void {
  const s = game.world();
  const ME = game.me();
  const st = game.ownStrike(strikeId);
  if (!st) {
    game.note(t('hint.aloft-gone')); // села или сбита между наводкой и тапом
    return;
  }
  if (patrol) {
    playerOrder(redirectSquadron(ME, strikeId, { at: unworld({ x: mx, y: my }) }));
    return;
  }
  if (relocate) {
    const spots = game.squadronRelocateSpots(game.strikeSquadron(st), game.strikeFrom(st), st);
    const hit = nearestHit(spots, (spot) => game.relocateSpotPx(spot.base), mx, my, rNode);
    if (!hit) game.note(t('hint.wing-relocate-cancelled'));
    else
      playerOrder(
        relocateAloft(
          ME,
          strikeId,
          hit.base.kind === 'planet' ? { toPlanetId: hit.base.id } : { toFleetId: hit.base.id },
        ),
      );
    return;
  }
  const foe = nearestHit(
    hostileFleets(Object.values(s.fleets).filter(fleetSeen), ME),
    fleetAnchor,
    mx,
    my,
    rFleet,
  );
  const node = foe ? null : nearestHit(game.nodes(), (nn) => world(nn), mx, my, rNode);
  if (foe) playerOrder(redirectSquadron(ME, strikeId, { targetFleetId: foe.id }));
  else if (node) playerOrder(redirectSquadron(ME, strikeId, { targetPlanetId: node.id }));
  else game.note(t('hint.wing-cancelled'));
}

/** Кому принадлежит клик по карте сейчас — по взведённым режимам (`tapPriority.ts`). */
function currentTapOwner(): ReturnType<typeof tapOwner> {
  return tapOwner({
    chainMode: !!chainMode,
    merging,
    heroAim: !!heroAim,
    heroSpawnAim: !!heroSpawnAim,
    retreatAim: !!retreatAim,
    assaultAim,
    engageAim,
    strikeAim: !!strikeAim,
    allyAim: !!allyAim,
    rallyAim: !!rallyAim,
    pickMode,
    aiming,
  });
}

/** Курс флотов `ids` в точку экрана: в мир под курсором, а мимо миров — в точку дороги. */
function courseAt(ids: string[], mx: number, my: number): void {
  const n = nearestHit(game.nodes(), (nn) => world(nn), mx, my, tapRadius('node', tapByTouch));
  if (n) tryMoveGroup(ids, n.id);
  else {
    const lane = nearestLanePoint(mx, my);
    if (lane) tryMoveEdgeGroup(ids, { from: lane.from, to: lane.to, t: lane.t });
  }
}

/** ПКМ по карте на ПК — «Курс сюда» для выбранных флотов (`rightClick.ts`, UIX-9.2). */
function rightClick(ev: MouseEvent): void {
  const act = rightClickAct({
    button: ev.button,
    touch: (ev as PointerEvent).pointerType === 'touch',
    pc: pcUi(),
    armed: currentTapOwner() !== 'select',
    movers: selectedFleetIds().length,
  });
  // Системное меню гасит слушатель документа (`main.ts`) — здесь только жест игры.
  if (act !== 'course') return;
  const p = ptXY(ev);
  tapByTouch = false;
  courseAt(selectedFleetIds(), p.x, p.y);
  game.invalidatePanel();
}

// Tap/click selection at a screen point (drag-aware — see the pointer handlers).
export function selectAt(mx: number, my: number) {
  const s = game.world();
  const ME = game.me();
  const MOBILE = game.mobile();
  const MAP = game.nodes();
  game.closePingPop(); // any map tap dismisses an open ping popup (a marker tap reopens below)
  // CHAIN-UX: в режиме «Приказ» карта — рабочая поверхность построения плана.
  // Ветка стоит ПЕРВОЙ: пока режим жив, ни выделение, ни прочие перехваты тапов
  // не работают — тап это всегда «точка плана или закрыть меню».
  if (chainMode) {
    chainMapTap(mx, my);
    return;
  }
  // Hit radii: widened for a finger (44px-target rule); nearest-in-radius wins, so
  // clustered objects resolve to what the player aimed at, not iteration order.
  // Числа и порядок ветвей ниже — `tapPriority.ts` (REFM-64).
  const rFleet = tapRadius('fleet', tapByTouch);
  const rPing = tapRadius('ping', tapByTouch);
  const rNode = tapRadius('node', tapByTouch);
  // Кто забирает этот тап — решает модуль, а не порядок `if`ов ниже: вооружённый
  // приказ важнее выделения, а набор группы уступает вооружённому ходу.
  const owner = currentTapOwner();
  // Merge armed: the next tap on a friendly fleet (not itself in the selection) is
  // the anchor — the selected fleet(s) fly to it and fuse. Any other tap cancels.
  if (owner === 'merge') {
    const movers = selectedFleetIds();
    // Якорь — свой флот НЕ из выделения (`aimTargets.ts`, REFM-187): иначе ближайшим
    // окажется сам выделенный, и приказ уйдёт «слить себя с собой». Крепость якорем не
    // бывает: ядро не сливает неподвижное (`E_EMPLACEMENT`, `emplacement.ts`, правило 4).
    const anchor = nearestHit(
      mergeAnchors(
        Object.values(s.fleets).filter((f) => !isEmplacementFleet(f, data)),
        ME,
        movers,
      ),
      fleetAnchor,
      mx,
      my,
      rFleet,
    );
    if (MOBILE) {
      stageMobileTarget('merge', anchor ? { kind: 'fleet', id: anchor.id } : null);
      return;
    }
    if (anchor) orderMerge(movers, anchor.id);
    drop('merging');
    game.invalidatePanel();
    return;
  }
  // ГЛАВА IV (PVR-7.5) — ПРИКАЗ СОЮЗНИКУ ВЗВЕДЁН: тап выбирает цель операции. «Охранять» ищет
  // сперва свой или союзный флот, «Атаковать» — вражеский, потом мир; «Разведать» — только мир.
  // Годится ли цель, решает ЯДРО (`ally.order`): отказ приходит объяснением (`errText`), а не
  // молчанием. Промах мимо всего снимает прицел.
  if (owner === 'ally-order' && allyAim) {
    const kind = allyAim;
    drop('allyAim');
    const ally = linkedAlly(s, ME);
    // Цель — только видимый флот, как у «Атаки» и удара челноков (ревью #1411). Ракета
    // (SM-3.7b) целью приказа не бывает (`ally.order`): тап по ней ищет мир под ней.
    const fleets = Object.values(s.fleets).filter((f) => fleetSeen(f) && !isMissileFleet(f, data));
    const pool =
      kind === 'guard'
        ? fleets.filter((f) => f.owner === ME || f.owner === ally)
        : kind === 'attack'
          ? hostileFleets(fleets, ME)
          : [];
    const hit = pool.length ? nearestHit(pool, fleetAnchor, mx, my, rFleet) : null;
    const node = hit ? null : nearestHit(MAP, (nn) => world(nn), mx, my, rNode);
    if (!ally || (!hit && !node)) game.note(t('ally.pick-missed'));
    else if (playerOrder(allyOrder(ME, ally, kind, hit ? { fleet: hit.id } : { planet: node!.id })))
      game.note(t('ally.ordered'));
    game.invalidatePanel();
    return;
  }
  // RALLY-1 — ТОЧКА СБОРА ВЗВЕДЕНА из панели мира: тап по другому своему миру ставит её.
  // Чужой мир и сам мир-верфь объясняются правилом, промах снимает прицел молча-с-нотой.
  if (owner === 'rally-point' && rallyAim) {
    const from = rallyAim;
    drop('rallyAim');
    const n = nearestHit(MAP, (nn) => world(nn), mx, my, rNode);
    const hit = n ? { id: n.id, owner: s.planets[n.id]?.owner ?? null } : null;
    const pick = rallyPick(from, hit, ME);
    if (pick === 'order') playerOrder(setRallyPoint(ME, from, hit!.id));
    else game.note(t(pick === 'not-own' ? 'hint.rally-own' : 'hint.rally-cancelled'));
    game.invalidatePanel();
    return;
  }
  // SHU-3.1 — УДАР ВЗВЕДЁН: следующий тап выбирает цель вылета. Сначала ищем чужой
  // ФЛОТ (по нему бьют `attack`), потом чужой МИР (по нему — здания). Тап по пустому
  // месту снимает прицел: взведённый режим обязан иметь выход без приказа.
  //
  // ЧТО поднять, решать уже не нужно: с SHU-4.3 прицел взводит КОНКРЕТНАЯ карточка и
  // несёт id своей эскадры. Дальность, топливо, враждебность цели и вместимость
  // проверяет ЯДРО: свою копию этих правил интерфейс не заводит, он показывает отказ
  // (`errText`).
  if (owner === 'shuttle-strike' && strikeAim) {
    const { from, squadronId, patrol, relocate, strikeId } = strikeAim;
    drop('strikeAim');
    // SHU-6.14 — прицел ЭСКАДРЫ В ВОЗДУХЕ: цели те же, но приказ — новый для вылета.
    if (strikeId) {
      aloftAimTap(strikeId, !!patrol, !!relocate, mx, my, rFleet, rNode);
      game.invalidatePanel();
      return;
    }
    // SHU-6.3 — ПАТРУЛЬ: тап и есть точка. Дальность ядро меряет от живой позиции базы
    // (`E_OUT_OF_RANGE`), поэтому тап мимо круга приходит отказом, а не тишиной.
    if (patrol) {
      if (!game.squadronAt(squadronId)) game.note(t('hint.wing-empty'));
      else playerOrder(patrolShuttle(ME, from, squadronId, unworld({ x: mx, y: my })));
      game.invalidatePanel();
      return;
    }
    // SHU-6.5 — ПЕРЕЛЁТ: тап ловится только по базе в уголках — по той, что примет ядро.
    // Мимо них — отмена, как у удара: взведённый режим обязан иметь выход без приказа.
    if (relocate) {
      const found = game.squadronAt(squadronId);
      const spots = found ? game.squadronRelocateSpots(found.sq, from) : [];
      const hit = nearestHit(spots, (spot) => game.relocateSpotPx(spot.base), mx, my, rNode);
      if (!found) game.note(t('hint.wing-empty'));
      else if (!hit) game.note(t('hint.wing-relocate-cancelled'));
      else
        playerOrder(
          relocateShuttle(
            ME,
            from,
            squadronId,
            hit.base.kind === 'planet' ? { toPlanetId: hit.base.id } : { toFleetId: hit.base.id },
          ),
        );
      game.invalidatePanel();
      return;
    }
    // Только то, что игрок видит: невидимую мину (SM-3.6) палец не находит (ревью #1411).
    const foe = nearestHit(
      hostileFleets(Object.values(s.fleets).filter(fleetSeen), ME),
      fleetAnchor,
      mx,
      my,
      rFleet,
    );
    const node = foe ? null : nearestHit(MAP, (nn) => world(nn), mx, my, rNode);
    if (!game.squadronAt(squadronId)) {
      game.note(t('hint.wing-empty')); // звено исчезло между наводкой и тапом
    } else if (foe) {
      playerOrder(strikeShuttle(ME, from, squadronId, { targetFleetId: foe.id }));
    } else if (node) {
      playerOrder(strikeShuttle(ME, from, squadronId, { targetPlanetId: node.id }));
    } else {
      game.note(t('hint.wing-cancelled'));
    }
    game.invalidatePanel();
    return;
  }
  // «Отступить» взведено: тап по миру — точка отхода. Дорогу, право прохода и то, что флот
  // всё ещё в бою, проверяет ЯДРО: недостижимая точка оставляет флот в бою и приходит
  // отказом (`errText`), а не молчаливым расцеплением. Промах мимо мира снимает прицел.
  if (owner === 'retreat' && retreatAim) {
    const fleetId = retreatAim;
    drop('retreatAim');
    const n = nearestHit(MAP, (nn) => world(nn), mx, my, rNode);
    const battleId = game.battleRetreatAim();
    if (n)
      playerOrder(battleId ? retreatBattle(ME, battleId, n.id) : retreatFleet(ME, fleetId, n.id));
    else game.note(t('hint.retreat-cancelled'));
    game.clearBattleRetreatAim();
    game.invalidatePanel();
    return;
  }
  // Hero cast armed: the next tap picks the target world. Range / cooldown / cost
  // are the core's gates — a mis-aim comes back as an honest rejection note.
  if (owner === 'cast' && heroAim) {
    const cast = heroAim;
    drop('heroAim');
    const n = nearestHit(MAP, (nn) => world(nn), mx, my, rNode);
    // Глава V: удар, уничтожающий мир, по убежищу с пленным — сперва предупреждение, и
    // прицел остаётся взведённым; повторный тап по тому же миру — удар («Предупреждение
    // показывается до опасного приказа, а не после удара», `docs/covenant-of-unity.md`).
    const kind = data.heroAbilities[cast.abilityId]?.type;
    const ruins = kind === 'annihilate' || kind === 'devour';
    if (n && ruins && captiveAtRisk(s, n.id) && captiveWarned !== n.id) {
      captiveWarned = n.id;
      arm('heroAim', cast);
      game.note(t('captive.warn-destroy'));
      return;
    }
    captiveWarned = null;
    if (n) playerOrder(castHeroAbility(ME, cast.heroId, cast.abilityId, n.id));
    else game.note(t('hint.cast-cancelled'));
    game.invalidatePanel();
    return;
  }
  // Hero deploy armed: the tap picks WHERE the ship rises — your own world; with the
  // marker perks also one of your fleets (boarding) / an allied world. Own-fleet hits
  // are only considered when the hero actually carries the boarding marker, so a tap
  // on a world under your fleet still means the world.
  if (owner === 'deploy' && heroSpawnAim) {
    const heroId = heroSpawnAim;
    drop('heroSpawnAim');
    const hero = s.heroes?.[heroId];
    const canBoard = (hero?.abilities ?? []).some(
      (a) => a !== null && data.heroAbilities[a]?.type === 'spawn_fleet',
    );
    const host = canBoard
      ? nearestHit(ownFleets(Object.values(s.fleets), ME), fleetAnchor, mx, my, rFleet)
      : null;
    const n = host ? null : nearestHit(MAP, (nn) => world(nn), mx, my, rNode);
    // Корабль важнее мира ТОЛЬКО с абордажным перком — `aimTargets.ts` (правило 3):
    // без него мир под своим флотом обязан остаться миром.
    const pick = deployPick(canBoard, !!host, !!n);
    if (pick === 'fleet') playerOrder(spawnHero(ME, heroId, host!.id));
    else if (pick === 'world') playerOrder(spawnHero(ME, heroId, n!.id));
    else game.note(t('hint.deploy-cancelled'));
    game.invalidatePanel();
    return;
  }
  // ШТУРМ armed (PC): the click picks the target world — any capturable world that is
  // not ours, a neutral one too. An enemy at war → fly + storm on arrival; a peaceful owner → the
  // "friendly faction — declare war?" dialog. Anything else keeps the aim armed.
  if (owner === 'assault') {
    const n = nearestHit(MAP, (nn) => world(nn), mx, my, rNode);
    const target = n ? s.planets[n.id] : undefined;
    const capturable = !!n && game.capturable(n.id);
    // Годится только НЕ СВОЙ ЗАХВАТЫВАЕМЫЙ мир (`aimTargets.ts`, правило 4): от этого
    // зависит судьба прицела, а не только отказ ядра.
    const ok = !!target && assaultTargetOk(target.owner, capturable, ME);
    if (MOBILE) {
      stageMobileTarget('assault', ok && n ? { kind: 'planet', id: n.id } : null);
      if (!ok) game.note(t('hint.assault-target'));
      return;
    }
    // Судьба прицела — `armedTap.ts` (REFM-88). ШТУРМ единственный ПРОЩАЕТ неподходящую
    // цель: промах по цели это не отказ от приказа, и переармировать после каждого
    // неточного тыка в скопление миров — наказание за меткость пальца.
    const fate = armedTap(!n ? 'none' : ok ? 'valid' : 'wrong', true);
    if (fate === 'keep') {
      game.note(t('hint.assault-target'));
      return;
    }
    if (fate === 'fire') tryAssaultGroup(selectedFleetIds(), n!.id);
    drop('assaultAim');
    game.invalidatePanel();
    return;
  }
  /**
   * ATK-1. «Атака» наведена: следующий тап по ЧУЖОМУ флоту — приказ его атаковать.
   *
   * Два случая, и оба выражаются уже существующими приказами ядра:
   *  · цель стоит на ТОМ ЖЕ узле — `fleet.engage` немедленно (первый залп на самом
   *    приказе, CMB-4);
   *  · цель в другом месте — марш к её узлу. Отдельного «атаковать издалека» заводить
   *    не нужно: ядро само сцепляет прибывший флот с враждебным на месте
   *    (`engageFleets` на `fleet.arrived`), то есть марш И ЕСТЬ атака на расстоянии.
   *
   * Промах (тап не по флоту) прицел СНИМАЕТ — в отличие от ШТУРМА, который промах
   * прощает: там цель это МИР, крупный и слипающийся в скоплениях, а здесь цель —
   * точка флота, и «не попал» почти всегда значит «передумал».
   */
  if (owner === 'engage') {
    // Та же цель, что рисует превью (`engageAim.ts`): флот рядом или флот противника на
    // мире под пальцем — тап по базе пиратов бьёт по пиратам, а не снимает прицел.
    const foe = engageFoeAt(
      game.engageCandidates(),
      { x: mx, y: my },
      rFleet,
      nearestHit(MAP, (n) => world(n), mx, my, rNode)?.id ?? null,
    );
    if (MOBILE) {
      stageMobileTarget('engage', foe ? { kind: 'fleet', id: foe.id } : null);
      return;
    }
    drop('engageAim');
    game.invalidatePanel();
    if (!foe) {
      game.note(t('hint.engage-enemy-only'));
      return;
    }
    engageTarget(s.fleets[foe.id]!);
    return;
  }
  // SEL-1 «Выбрать+»: while picking, taps only toggle OWN fleets in/out of the
  // group — nothing deselects, worlds don't grab the tap, the map is a picking
  // surface until the mode is left (⊕ again, or any common order).
  if (owner === 'pick-group') {
    const mine = nearestHit(ownFleets(Object.values(s.fleets), ME), fleetAnchor, mx, my, rFleet);
    if (mine) game.toggleFleetInSelection(mine.id);
    return;
  }
  // CHAIN-UX: тап по ◎-бейджу отправленного плана открывает режим «Приказ» с этим
  // планом в черновике (редактирование; работает и без выделения).
  if (!aiming) {
    const tm = nearestHit(game.chainHits(), (h) => h, mx, my, rPing);
    if (tm) {
      enterChainMode(tm.fleetIds);
      return;
    }
  }
  // Plain tap = selection. Movement happens only when "Move" is armed (aiming), so a
  // fleet selection never blocks picking a planet (and vice versa).
  // A tap on an ally ping marker opens its description popup (takes priority over
  // selection, since markers float above the node they mark).
  if (!aiming) {
    const ping = nearestHit(game.pingHits(), (h) => h, mx, my, rPing);
    if (ping) {
      game.openPingPop(ping.loc);
      return;
    }
  }
  // ЗНАЧОК БОЯ (`decisions/battleTap.ts`) — у него своя цель над точкой схватки, и тап
  // он берёт РАНЬШЕ выбора объекта. Прежде он стоял последним, «под ним ничего нет», —
  // и не срабатывал никогда: запасной выбор по площади провинции накрывает почти всю
  // карту, поэтому «под пальцем пусто» не случалось. Вооружённый приказ по-прежнему
  // важнее: разбор боя не стоит потерянного хода.
  const battleHit = battleAtTap(
    Object.values(s.battles).map((b) => {
      const anchor = battleAnchor(b);
      return {
        id: b.id,
        at: anchor ? battleBadgePoint(world(anchor)) : null,
        identified: battleKnown(b),
      };
    }),
    { x: mx, y: my },
    tapByTouch,
    owner === 'move',
  );
  if (battleHit) {
    game.openBattle(battleHit);
    return;
  }
  // Move armed → send the selected fleet(s) to the tapped world (or the nearest lane
  // point if no world is hit). A route crossing a player you're at peace with stages a
  // war prompt instead of dispatching.
  if (owner === 'move') {
    const n = nearestHit(MAP, (nn) => world(nn), mx, my, rNode);
    if (MOBILE) {
      const lane = n ? null : nearestLanePoint(mx, my);
      stageMobileTarget(
        'move',
        n
          ? { kind: 'planet', id: n.id }
          : lane
            ? { kind: 'lane', from: lane.from, to: lane.to, t: lane.t }
            : null,
      );
      return;
    }
    courseAt(selectedFleetIds(), mx, my);
    drop('aiming');
    game.invalidatePanel();
    return;
  }
  plainTapSelect(game, mx, my, { rFleet, rNode, additive, touch: tapByTouch });
}

// Camera control: drag-pan, pinch-zoom, wheel-zoom, tap-select.

/** Set per tap: hit radii in selectAt widen for a finger (44px-target rule). */
export let tapByTouch = false;

/** Пальцы и мышь, прижатые к карте сейчас. Снаружи только читают. */
export const pointers = new Map<number, { x: number; y: number }>();
let dragStart: { x: number; y: number } | null = null;
let dragged = false;
// Long-press (touch): a still finger = additive fleet pick on a fleet, or a box-select
// anywhere else — the touch stand-ins for Ctrl-click and Shift-drag. Фазы удержания
// (взвод → созревание → съеденный тап) — общие с плиткой каталога, `holdPress.ts`
// (REFM-131): своя копия этой жизни расходилась бы с панельной.
let longPressTimer: number | null = null;
let mapHold: HoldState = IDLE;
function cancelLongPress(): void {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  mapHold = release(mapHold); // право съесть отпускание переживает снятие ожидания
}
// One stable baseline for the entire gesture. Per-pointer incremental zoom loses
// its anchor when one finger reaches a clamp before the other finger is updated.
export let pinchStart: { cam: typeof cam; at: ReturnType<typeof pinchOf> } | null = null;
let pinchPending = false;
function rebasePinch(): void {
  const [a, b] = [...pointers.values()];
  // Щипок, начатый на растянутой за край камере, ведёт её от того места, куда её тянули, —
  // иначе упругий край сжал бы растяжку ещё раз, и карта прыгнула бы при втором пальце.
  pinchStart =
    a && b
      ? { cam: camElasticPull(cam, insets(), mapBounds(), panelSlack()), at: pinchOf(a, b) }
      : null;
  pinchPending = false;
}
export function flushPinch(): void {
  if (!pinchPending || !pinchStart) return;
  pinchPending = false;
  const [a, b] = [...pointers.values()];
  if (a && b)
    setView(
      camPinchAt(
        pinchStart.cam,
        pinchStart.at,
        pinchOf(a, b),
        insets(),
        mapBounds(),
        panelSlack(),
        camElasticCam,
      ),
    );
}
// Был ли в этом жесте второй палец. После щипка нельзя ни выбирать объект,
// ни ставить цель, ни отправлять приказ в точке отрыва последнего пальца.
let multiTouched = false;
let boxSelecting = false;
// Пиксели страницы → координаты холста. Перевод один на палец и на колесо
// (`screenAnchor.ts`, REFM-134, правила 6–7): две копии одной формулы — это два зума,
// которые начнут целиться в разные места, стоит поправить одну.
const ptXY = (ev: { clientX: number; clientY: number }) =>
  fromScreen(
    { x: ev.clientX, y: ev.clientY },
    canvas.getBoundingClientRect(),
    game.vw(),
    game.vh(),
  );
function pointerDown(ev: PointerEvent): void {
  // Правая кнопка мыши — не выбор и не рамка: её жест «Курс сюда» берёт `rightClick`.
  if (ev.pointerType === 'mouse' && ev.button === 2) return;
  const s = game.world();
  const ME = game.me();
  const MOBILE = game.mobile();
  flushPinch();
  holdCam(); // карта под пальцем: возврат от края встаёт, жест ведёт камеру дальше
  canvas.setPointerCapture?.(ev.pointerId);
  const p = ptXY(ev);
  pointers.set(ev.pointerId, p);
  if (pointers.size === 1) {
    dragStart = p;
    tapByTouch = ev.pointerType === 'touch'; // preview + commit share the snap radius
    mapHold = IDLE; // новый жест начинается с чистой жизни удержания
    multiTouched = false; // новый жест — пока однопальцевый
    // Кто из троих претендентов забирает этот жест — решает `pressIntent.ts`
    // (REFM-55): там же правило «Shift над своим флотом — добор, а не рамка».
    const overOwnFleet = !!nearestHit(
      Object.values(s.fleets).filter((f) => f.owner === ME && !isOrdnanceFleet(f, data)),
      fleetAnchor,
      p.x,
      p.y,
      pickRadius(ev.pointerType === 'touch'),
    );
    const intent = pressIntent({
      touch: ev.pointerType === 'touch',
      shift: ev.shiftKey,
      ctrl: ev.ctrlKey,
      meta: ev.metaKey,
      overOwnFleet,
      orderArmed: !!(aiming || merging || chainMode || (MOBILE && mobileOrderKind())),
    });
    additive = intent.additive;
    boxSelecting = intent.boxSelect;
    selectionBox = boxSelecting ? { x1: p.x, y1: p.y, x2: p.x, y2: p.y } : null;
    dragged = false;
    if (aiming || assaultAim || strikeAim?.patrol) aimPointer = p; // the aim preview starts under the finger at once
    // Touch long-press: a still finger for ~350ms picks a fleet ADDITIVELY (the
    // Ctrl-click of phones) or opens a BOX-SELECT from empty space (the Shift-drag).
    if (intent.longPress) {
      cancelLongPress();
      mapHold = press(p);
      longPressTimer = window.setTimeout(() => {
        longPressTimer = null;
        // Условия перепроверяются В МОМЕНТ СОЗРЕВАНИЯ (правило 6): за это время палец
        // мог поехать, а на карте — прийти второй.
        if (pointers.size !== 1 || dragged) return;
        mapHold = mature(mapHold);
        if (!mapHold.matured) return;
        navigator.vibrate?.(25);
        // Мир и место — на момент созревания, а не нажатия: за это время мир мог смениться.
        const mine = nearestHit(
          Object.values(game.world().fleets).filter(
            (f) => f.owner === game.me() && !isOrdnanceFleet(f, data),
          ),
          fleetAnchor,
          p.x,
          p.y,
          24,
        );
        if (longPressAction(!!mine) === 'toggle-fleet') {
          game.toggleFleetInSelection(mine!.id); // add / drop from the group
        } else {
          boxSelecting = true; // drag now stretches the selection box
          selectionBox = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
        }
      }, MAP_HOLD_MS);
    }
  } else if (pointers.size >= 2) {
    cancelLongPress();
    multiTouched = true;
    // Второй палец ВЕЗЁТ КАМЕРУ (и масштабирует), а не отменяет вооружённый приказ.
    // Раньше он отменял — и это запирало игрока: одним пальцем целятся, значит камеру
    // при вооружённом «Курсе» было не сдвинуть вовсе, а цель за краем экрана
    // становилась недостижимой. Отменить приказ по-прежнему можно кнопкой (повторный
    // тап по «Курс») и Back/Escape — обе дороги живы.
    boxSelecting = false;
    selectionBox = null;
    rebasePinch();
  }
}
function pointerMove(ev: PointerEvent): void {
  const prev = pointers.get(ev.pointerId);
  if (!prev) return;
  const p = ptXY(ev);
  pointers.set(ev.pointerId, p);
  const moved = movedBeyondSlop(dragStart, p, ev.pointerType === 'touch');
  if (moved) cancelLongPress(); // a moving finger is a drag, not a long-press
  // `dragIntent.ts`: два пальца — щипок. На телефоне один палец двигает карту
  // даже при выборе цели; приказы подтверждает кнопка. Планшет сохраняет drag-aim,
  // PC — прицел наведением и панораму перетаскиванием.
  const intent = dragIntent({
    pointers: pointers.size,
    armed: aiming || assaultAim,
    pc: pcUi(),
    boxing: boxSelecting,
    hasStart: !!dragStart,
    confirmRequired: game.mobile(),
  });
  if (intent === 'pinch') {
    // Pointer events arrive separately. Apply their latest pair together at the
    // next frame, never present the half-updated midpoint between two fingers.
    pinchPending = true;
  } else if (intent === 'box' && dragStart) {
    selectionBox = { x1: dragStart.x, y1: dragStart.y, x2: p.x, y2: p.y };
  } else if (cameraFollows(intent)) {
    dragBy(p.x - prev.x, p.y - prev.y); // past the edge the map gives, not stops dead
  }
  if (marksDragged(intent, moved)) dragged = true;
}
function endPointer(ev: PointerEvent) {
  const s = game.world();
  const ME = game.me();
  const MOBILE = game.mobile();
  if (pointers.has(ev.pointerId) && pinchStart) {
    pointers.set(ev.pointerId, ptXY(ev));
    pinchPending = true;
    flushPinch(); // include the final movement before dropping either finger
  }
  const single = pointers.size === 1;
  const p = pointers.get(ev.pointerId);
  if (single && boxSelecting && selectionBox) {
    const picked: string[] = [];
    for (const f of Object.values(s.fleets)) {
      if (f.owner !== ME || isOrdnanceFleet(f, data) || isEmplacementFleet(f, data)) continue;
      const a = fleetAnchor(f);
      if (a && insideBox(selectionBox, a)) picked.push(f.id);
    }
    // Правило «добрать или заменить» (и «пустая рамка с модификатором не трогает
    // группу») живёт в `pointerPick.ts`.
    const next = boxSelection(selectedFleetIds(), picked, additive);
    if (next.length) game.setFleetSelection(next);
    else if (!additive) {
      deselectFleets();
      game.invalidatePanel();
    }
    selectionBox = null;
    boxSelecting = false;
  }
  pointers.delete(ev.pointerId);
  rebasePinch();
  if (!pointers.size) releaseCam(); // растянутая за край камера плывёт обратно
  cancelLongPress();
  // Созревшее удержание СЪЕДАЕТ это отпускание (правила 4–5): оно уже сделало своё дело,
  // и пропусти мы его дальше — за один жест игрок получил бы ещё и выбор/приказ.
  const spent = consumeClick(mapHold);
  mapHold = spent.next;
  if (spent.eat) return;
  // Коммитит ли это отпускание вооружённый приказ — правило целиком в `aimGesture.ts`
  // (там же его сторож): на нём ввод ломался дважды и оба раза молча.
  const commits = releaseCommits({
    armed: aiming || assaultAim,
    pc: pcUi(),
    multiTouched,
    dragged,
    confirmRequired: MOBILE,
  });
  if (single && p && commits) {
    tapByTouch = ev.pointerType === 'touch';
    selectAt(p.x, p.y);
  }
}
function cancelPointer(ev: PointerEvent): void {
  if (!pointers.has(ev.pointerId)) return;
  cancelLongPress();
  mapHold = IDLE; // жест отменён системой — отпускания не будет, и съедать нечего
  pointers.delete(ev.pointerId);
  rebasePinch();
  if (!pointers.size) releaseCam();
  dragged = true;
  selectionBox = null;
  boxSelecting = false;
}
function wheel(ev: WheelEvent): void {
  ev.preventDefault();
  const at = ptXY(ev); // тот же перевод, что у пальца (правило 7)
  zoomAt(at.x, at.y, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
}
/** Track the pointer for the "Move" preview line (desktop only). */
function hover(ev: PointerEvent): void {
  if (!game.mobile() || !mobileOrderKind()) aimPointer = ptXY(ev);
  // Курсор нагревается над миром или видимым флотом (`prototype/cursors.mjs`) — теми же
  // радиусами, что берёт клик мышью; пустота карты остаётся холодной.
  if (ev.pointerType === 'mouse') canvas.classList.toggle('cur-hot', mapHotAt(ptXY(ev)));
}
function mapHotAt(p: { x: number; y: number }): boolean {
  return (
    !!nearestHit(game.nodes(), (nn) => world(nn), p.x, p.y, tapRadius('node', false)) ||
    !!nearestHit(
      Object.values(game.world().fleets).filter(fleetSeen),
      fleetAnchor,
      p.x,
      p.y,
      tapRadius('fleet', false),
    )
  );
}
