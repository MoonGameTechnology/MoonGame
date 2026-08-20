/**
 * Void Dominion — playable prototype, browser UI.
 *
 * Renders the live map and drives the REAL shared-core kernel in real time:
 * every frame advances the world clock, player clicks become kernel actions, a
 * light Red AI issues its own, and the canvas reflects the resulting state.
 */
import {
  newGame,
  advance,
  order,
  canOrder,
  canOrderAll,
  ctx,
  data,
  MAP,
  SECTOR_TYPES,
  SCORE_LIMIT,
  HOUR,
  DAY,
  hpOfLevel,
  moveFleet,
  moveFleetEdge,
  spyOn,
  stopFleet,
  orbitFleet,
  assaultFleet,
  bombardFleet,
  barrageFleet,
  barrageModeFleet,
  loadArmy,
  unloadArmy,
  mergeFleet,
  splitFleet,
  buildBuilding,
  upgradeBuilding,
  buildUnit,
  cancelConstruction,
  resumeConstruction,
  declareWar,
  shareMap,
  netIncome,
  retreatFleet,
  STANCE_RANK,
  hasMapShare,
  hasMapShareOffer,
  canTraverse,
  START_CANDIDATES,
  designateCapital,
  capitalOf,
  isInhabited,
  type SetupConfig,
  type SeatConfig,
  type StepOut,
  orderAuto,
  orderScramble,
  fleetIdle,
  squadronTake,
  squadronStrikeRange,
  fleetHasSquadron,
  isWing,
  wingCanAct,
  wingCanReturn,
  sortieSpec,
  freshSortie,
  botFavour,
  FAVOUR_BASE,
  FAVOUR_EMBARGO,
  FAVOUR_WAR,
  setHoldPoint,
  MAX_STEWARD_HOLD_POINTS,
  castHeroAbility,
  spawnHero,
  orderChain,
  forceMarchFleet,
  FORCED_MARCH_MULT,
  instantRepairFleet,
  instantRepairCost,
  repairFleet,
  dockRepairCost,
  fleetAtOwnDock,
  MAX_CHAIN_STEPS,
  type ChainStep,
  type Patrol,
} from './game';
import { act as makeAction } from './actions';
import {
  dominantUnit,
  glyphHalo,
  glyphScale,
  unitArchetype,
  unitGlyphSvg,
  unitSizeClass,
} from './unitGlyphs';
import { fleetCallsign, fleetKindKey } from './fleetName';
import { planetName } from './planetName';
// GRND-1: гарнизон, запертый живым боем, не отпускает войска (ядро: E_UNDER_ASSAULT).
import { garrisonUnderAssault } from '../../packages/shared-core/src/util/fleet';
import { DEFAULT_HEROES, type HeroLoadout } from './heroes';
import { DEFAULT_SHIP_LOADOUTS, type ShipLoadout } from './ships';
// «Верфь» — вкладка оснащения (REFM-13): окно целиком живёт в `shipyard.ts`, здесь
// только проводка (host-хуки) и панель героев, которая переедет своим кирпичом.
import { initShipyard } from './shipyard';
import { initHeroStaff, HERO_CASTABLE, heroCdKey, heroDisplayName } from './heroStaff';
import {
  initConversations,
  COALITION,
  CH_SESSION,
  CH_GLOBAL,
  GROUP_CHANNELS,
  type SessionMsg,
  type StampOpts,
} from './conversations';
// HUD-DOCK: видимость листа и «нижний хаб уезжает» — одна чистая модель на все
// прицельные режимы; она же держит замер высоты листа для привязки ряда команд.
import { mapIsWorkspace, panelOpen, sheetHeightVar, type DockState } from './hudDock';
// Хвост маркера флота (пипсы трюма, «×N») — чистая геометрия с тестом на разворот
// наружу у стоящего флота (пипсы не должны ложиться на диск планеты).
import {
  CARGO_CELL,
  cargoRowLayout,
  cargoRows,
  loadFill,
  squareRowY,
  tailAt as tailPoint,
  tailTheta,
  tallyY,
} from './markerTail';
// BACK-1: лестница слоёв Android-Back/Escape — чистая модель + опись, которую держит тест.
import {
  closeTopLayer as closeTop,
  topLayerOpen as layersOpen,
  type BackLayer,
} from './backLayers';
import {
  buildingLevel,
  buildingMaxLevel,
  COMBAT_UNIT_CAP,
  effectiveStats,
  estimateTravelHours,
  journeyDestination,
  findHealthyStack,
  fleetBaseSpeed,
  sumUnitStat,
  getStance,
  getOffer,
  hashState,
  planRoute,
  previewBattle,
  previewLossCount,
  scanNodeThreats,
  identifiedNodes,
  sensorCoverage,
  fleetRadarRange,
  abilityRange,
  type PausedConstructionSite,
} from '../../packages/shared-core/src/index';
import {
  MultiplayerClient,
  type MultiplayerPing,
  type MultiplayerChatMessage,
  createBattleModel,
  type BattleSideView,
} from '../../packages/client/src/index';
import {
  worldToScreen as camWorldToScreen,
  zoomAt as camZoomAt,
  clampCam as camClampCam,
  centerOn as camCenterOn,
  fitTransform as camFitTransform,
} from '../../packages/client/src/camera';
import {
  rgba,
  blitGlow as hdBlitGlow,
  blitSphere as hdBlitSphere,
} from '../../packages/client/src/holoDraw';
import {
  drawTerritory,
  computePowerCell,
  type TerritorySeed,
} from '../../packages/client/src/territory';
import { buildLabel, currentBuild } from './updater';
import { initApkUpdater } from './apkUpdate';
import { measureViewport, STARS, NEBULAE } from './viewport';
import { initPingUi } from './pingUi';
import { initSoloDrivers } from './soloDrivers';
import { initMatchEnd } from './matchEnd';
import { STANCES, diffDiplomacy } from './diploEvents';
import { asteroidsFor, bracketStrokes, polyPoints } from './mapShapes';
import { conveyorHtml as kitConveyorHtml } from './conveyorView';
import { LIMP_PCT, fleetSummary, hullPct, stackHullPct } from './fleetSummary';
import { isGroundUnit, isWingUnit, planetSummary } from './planetSummary';
import { fleetWhere, groupTotals, pickPanel } from './panelSelect';
import { buildRoster, garrisonByTab, tabCounts } from './planetTabs';
import {
  builtTileHtml,
  catalogRowHtml,
  catalogTileHtml,
  tileLock,
  type CatalogShape,
  type TileLock,
} from './catalogTile';
import {
  anyToken,
  clearSession,
  readSession,
  saveSession,
  tokenFor,
  type SessionRec,
} from './sessionStore';
import {
  authOutcome,
  shouldRegister,
  validLogin,
  validPassword,
  type AuthOutcome,
} from './authRules';
import {
  dropsSession,
  joinOutcome,
  joinQuery,
  parseJoinPass,
  type JoinOutcome,
} from './joinRules';
import { houseBonusKey, houseChoice, houseColor, houseName, houseRows } from './seatPicker';
import { createPendingJoin } from './pendingJoin';
import { syncCommanderXp } from './commanderSync';
import { panelSlackFor } from './panelSlack';
import { longPressAction, pressIntent } from './pressIntent';
import { assaultMovers, assaultTargetBlocker, collectBlockers, moveMovers } from './warPrompt';
import { assaultOrderState, dropsOrder } from './assaultQueue';
import { laneEnds, warConfirmPlan } from './warOrders';
import { bakeSignature, needsRebake, ownersSignature } from './staticLayerCache';
import { clipPolygon, clipRect, provinceSeeds } from './provinceMap';
import { fleetVisible, nodeView, seesDetails as fogSeesDetails } from './fogView';
import {
  hasCoverage,
  identifyRadius,
  mergeArms,
  radarSources,
  rangeRings,
  sweepChromeShown,
} from './radarSources';
import {
  frontierLook,
  frontierShown,
  ownRingLook,
  ownRingShown,
  unionArcs,
  type SightTier,
} from './sightFrontier';
import { BADGE_R, badgeBob, badgeCenterY, badgeLook, badgeShown, badgeTether } from './kindBadge';
import { chipFontPx, chipGlyph, chipMetrics, chipXs, chipY, chipsShown } from './buildChips';
import { tapOwner, tapRadius } from './tapPriority';
import { nextPick, tapCandidates, touchPick, type TapPick } from './tapCycle';
import { chainTapTarget, nearestOwnWorld as ownWorldNearest } from './chainTarget';
import { arrivalHours, marchHours, restRouteHours } from './travelEta';
import { castOptions, heroAboard, type CastOption } from './heroCasts';
import { fromScreen, stickToPoint, toScreen } from './screenAnchor';
import { fadeOf, flashDone, flashProgress, growRadius, waveRadius } from './flashFx';
import { capsuleAt, chainPathNodes, lastStepAtPoint, stackIndexes } from './chainPathLayout';
import {
  BADGE_DY,
  badgeCount,
  badgePulse,
  groupByAnchor,
  shownOrders,
  type AnchoredOrder,
} from './chainBadges';
import {
  RING_OFFSETS,
  dropInAlpha,
  pinPulse,
  pingPhase,
  ringAlpha,
  ringProgress,
  ringRadius,
  ringWidth,
} from './pingPulse';
import { openingView, pickHome } from './openingView';
import { callsignFor, checkRegister, nextCallsignNumber, registerPayload } from './registerForm';
import {
  fmtJoinWindow,
  joinWindow,
  rowAction,
  ruleSummary,
  type MatchRules,
  type MatchTab,
} from './matchRow';

/** Причина отказа во входе в матч → ключ подписи. Текст живёт в /localization. */
const JOIN_REASON: Record<Exclude<JoinOutcome, 'ok'>, string> = {
  'session-expired': 'acc.session-expired',
  'entry-closed': 'acc.join-closed',
  'seats-full': 'acc.seats-full',
  failed: 'acc.join-failed',
};

/** Причина отказа → ключ подписи в статусной строке. Текст живёт в /localization. */
const AUTH_REASON: Record<AuthOutcome, string> = {
  ok: 'acc.created',
  created: 'acc.created',
  'wrong-password': 'acc.bad-pass',
  'mail-taken': 'acc.mail-taken',
  'rate-limited': 'acc.rate-limited',
  'register-refused': 'acc.register-refused',
  'login-refused': 'acc.login-refused',
};
import { createScanMemory, type Snapshot } from './scanMemory';
import {
  factionBonuses,
  houseDisplayName,
  houseNameFor,
  rivalCount,
  seatFactionIds as seatSeatFactionIds,
} from './setupSeats';
import { SNAP_REACH, drawOrder, lanes, mapViewBox, viewBoxPoint } from './setupMap';
import {
  actionButton,
  cardHeader as kitCardHeader,
  pcols,
  tabButton as kitTabButton,
  unitRows as kitUnitRows,
} from './panelKit';
import {
  boxSelection,
  insideBox,
  movedBeyondSlop,
  nearestHit,
  nearestSegment,
  pickRadius,
  pinchOf,
  pinchStep,
} from './pointerPick';
import {
  afford as coreAfford,
  emptyQueue,
  laneOf,
  queuedAction as coreQueuedAction,
  queuedCost,
  waitsForMoney,
} from './buildOrders';
import {
  activeConstruction as coreActiveConstruction,
  barPct,
  buildDurationHours as coreBuildDurationHours,
  hoursLeft,
  progressPct as coreProgressPct,
} from './buildProgress';
import {
  contactAlpha,
  contactLost,
  episodeKey,
  forgetEnded,
  freshEpisodes,
  hourBucket,
  paintedThisFrame,
} from './alerts';
import {
  SPY_COST,
  grantLeftMs,
  grantVision,
  liveGrants,
  pushSpyEntry,
  targetsOf,
  type SpyEntry,
} from './intel';
// Localization: one locale = one file (src/locale/*). Msgid = the canonical
// Russian source string; `t()` wraps every user-visible literal, `tData()` maps
// English data/*.json names, the static HTML is localized by a boot pass.
import {
  t,
  tData,
  hasKey,
  LOCALE,
  LOCALE_LABEL,
  setLocale,
  localizeStaticDom,
} from '../../localization/runtime';
// REFM-2: the pure presentation formatters live in `format.ts` now (no state, no DOM)
import {
  esc,
  kfmt,
  hl,
  TECH_CUR,
  resLine,
  cost,
  costText,
  displayUnit,
  buildingName,
  fmtEta,
  fmtHrs,
  gameDay,
  dayHour,
  clockHM,
  countdownHMS,
} from './format';
// REFM-3: the icon vocabulary (glyph tables + menu renderers) lives in `icons.ts`
import {
  BUILD_ICON,
  KIND_ICON,
  SOV_SVG,
  unitIcon,
  unitIconHtml,
  archPath2d,
  RES_SVG,
} from './icons';
// REFM-4: the object dossiers + the codex card live in `dossiers.ts`; the renderers
// that read live match state come out of `createDossiers(hooks)` further down.
import { buildingDossier, createDossiers, unitTitle, type Dossier } from './dossiers';
// The client-side build-queue vocabulary, shared with `dossiers.ts`.
import type {
  ActiveBuild,
  BuildKind,
  BuildLane,
  ConstructionPayload,
  PlanetBuildQueue,
  QueuedBuild,
} from './buildQueue';
import {
  META_TREE,
  META_BRANCH_RU,
  metaLevel,
  metaLevelProgress,
  metaPoints,
  canUnlock,
  unlockNode,
  matchXp,
  metaGrant,
  parseMetaState,
  type MetaState,
  type MetaBranch,
} from './meta';
// ARS-5 — arsenal witryna: the hub tab itself (`arsenalScreen.ts`, REFM-5 —
// `initArsenal(hooks)` owns its cache and markup); the pure model is `arsenal.ts`.
// H4 — конструктор шаблонов дивизий: модель в `formations.ts`, редактор — REFM-8.
// TT-3.1 — экран дерева технологий (REFM-9); `branchLabel` берёт ещё совет учёных.
import { initTechTree, branchLabel } from './techTree';
import { initBuildScreen } from './buildScreen';
import { initSciPick, sciCouncilRowHtml } from './sciPick';
import { initPasswordReset } from './passwordReset';
import { initEndScreen, type MatchEnd } from './endScreen';
import {
  fxBlur,
  pcUi,
  glowOn,
  setGlowFx,
  starfieldOn,
  setStarfield,
  showFpsOn,
  setShowFps,
} from './graphicsPrefs';
import { initSettings } from './settingsOverlay';
// «Профиль командира» — карьерное досье (REFM-10).
import { initProfile } from './profileScreen';
// AVA-C1/C2 — корпоративный кабинет (REFM-11).
import { abilityRings } from './abilityRings';
import { initCorp } from './corpScreen';
// ECON-4 — session market: the model + orders live next door; the WINDOW is REFM-6.
import { initMarket } from './marketScreen';
// Плавающее окно чата (REFM-12) — своя геометрия, свои настройки, свой кэш.
import { initChat } from './chatWindow';
import { initResourceCard } from './resourceCard';
// GRND-1 — меню десанта: чистая модель «кого и сколько» + разметка поповера.
import {
  maxPlan,
  planOrders,
  stepPlan,
  troopsMenuHtml,
  troopsModel,
  type TroopsInput,
  type TroopsUnitInput,
} from './troopsMenu';
// SND-1 — синтезированные звуки интерфейса (тёмный космос + космическая опера).
import { initSound } from './sound';
// REFM-16 — клиентские настройки: одно правило чтения/записи на весь клиент вместо
// восьми рукописных копий «нет ключа ⇒ умолчание» + try/catch вокруг setItem.
import { prefStore, readBool, readNum, readRaw, writeBool, writeRaw } from './prefs';
// AIM-PAN — «коммитит ли отпускание вооружённый приказ»: правило со сторожем.
import { releaseCommits } from './aimGesture';
// REFM-17 — палитра и правило «цвет = отношение»: одна таблица на карту и на экран
// дипломатии (раньше их было две, и настройку палитры знала только карта).
import {
  COLOR,
  VOID_COLOR,
  isPaletteId,
  paletteOf,
  relationColor,
  safeHexColor,
  stanceColor,
} from './sideColors';
// CHAIN-UX — режим «Приказ»: модель черновика, меню точки, таймлайн, разметка.
import {
  applyMenuAction,
  chainMenuItems,
  chainMenuHtml,
  chainStripHtml,
  chainTimeline,
  draftFinish,
  draftFrom,
  stepGlyph,
  stepHours,
  undoGesture,
  type ChainAbility,
  type ChainPointKind,
} from './chainPlanner';
// ST-2/ST-3 — «Хранитель»: the window is REFM-7; the read-only helpers below are shared
// with the threat alert (`stewFmtDur`), the side panel (`stewardTechDone`) and the
// morning report (`stewMetrics`).
import {
  initSteward,
  stewFmtDur,
  stewMetrics,
  stewardTechDone,
  type StewardMetrics,
} from './stewardScreen';
import { initArsenal } from './arsenalScreen';
// DEV TEST MODE — self-contained dev-only scenarios; remove this import + the
// initTestMode(...) call below + the #testmode HTML/CSS to cut it cleanly.
// (The player build already does: the only uses sit under `!__PLAYER_BUILD__`, so
// esbuild tree-shakes the whole module out of that bundle.)
import { initTestMode, openTestMode } from './testmode';
// SANDBOX — self-contained dev-only single-player "practice tools"; remove this
// import + the fenced hooks below (setup checkbox, frame enforce/fog, free-build
// snapshot, initSandbox call) + the #sandbox HTML/CSS to cut it cleanly.
import {
  sandboxConfig,
  resetSandboxConfig,
  resetSandboxRuntime,
  enforceSandbox,
  isBuildAction,
  initSandbox,
  setSandboxButton,
} from './sandbox';
// ONB-1 — the reusable guide-mark (spotlight) engine + its browser adapter.
// `playerOrder` feeds it real actions so `action` steps advance; ONB-2 builds
// the full guided first match on the same `startTour` primitive.
import { startTour, type RunningTour } from './spotlightDom';
import type { TourResult } from './spotlight';
import { HUD_ORIENTATION_TOUR } from './onboardingTour';
// ONB-2 — the guided first match (a data chain over this same engine).
import { buildFirstMatchTour } from './firstMatchTour';
// ONB-4 — searchable codex/help index (pure) over the existing article corpus.
import {
  buildCodexIndex,
  searchCodex,
  GLOSSARY,
  type CodexEntry,
  type CodexCategory,
} from './codexIndex';
// ONB-3 — just-in-time mechanic intros (per-nick seen-set, shown once on first contact).
import { resolveIntro, parseSeenIntros, type IntroCard } from './intros';
// ONB-5 — return digest ("пока тебя не было"): aggregate the away-window event log.
import { buildRecap, type RecapEvent } from './recap';
import { briefSince, marksAway, splitByAttention, worthShowing } from './awayBrief';
import { HOLD_TIP_MS, cursorTipPos, holdTipPos, movedTooFar } from './tipPlacement';
import { canConfirm, normalizeTake, shipCounts, splitTotals, stepTake } from './splitPlan';
import { canAssaultFromOrbit, canMerge, canSplit, uniformMode } from './cmdAvailability';
import { stayingFleets, stripState } from './chainStripState';
import {
  IDLE,
  MAP_HOLD_MS,
  consumeClick,
  mature,
  moveAway,
  press,
  release,
  type HoldState,
} from './holdPress';
import { groundTypes, hasTroops, totalOf, troopSources } from './troopsSources';
import { dossierLevel, nextHover, showsBody } from './dossierHover';
import { liftBy, opensNow } from './sheetLift';
import { barStays, popoverLife } from './popoverLife';
import { parseBuildAnchor, quickBuildOrder } from './quickBuild';
import { isMine, seen, seenArc, seenTail } from './eventVisibility';
import { advanceTarget, fpsNext, saneGap, simRuns, spinRuns } from './simClock';
import { armedTap } from './armedTap';
import { showsBlackout, showsStarving } from './arrearsWarnings';
import { canDockRepair, canRepair } from './repairOffer';
import { capitalOffer, holdOffer } from './worldOrders';
import { spyOffer, windowLeftH } from './spyOffer';
import { artScale, calloutAlpha, chevronAlpha, detailAt, sphereBloom } from './semanticZoom';
import { calloutInk, calloutLine, calloutTier } from './nodeCallout';
import {
  BATTLE_RINGS,
  battleMark,
  clashPoint,
  phaseLook,
  ringPhase,
  ringRadiusAt,
} from './battleMark';
import {
  chevronAngle,
  orbitBloom,
  orbitRadius,
  orbitsLive as ringsLive,
  ringShown,
  slotAngle,
} from './orbitRing';
import { routeShown, routeStops, routeStroke } from './fleetRoute';
import { netContacts, soloContacts } from './radarContacts';
import { autoStance, scrambleStance } from './stanceToggle';
import { fleetCount, goalBaseline, grew, mineLevels } from './goalTally';
import { introFor } from './introTrigger';
import { EVENT_LOG_MAX, LOG_LINES, isRepeat, pushBounded, stamp } from './noteLog';
import { pruneGroup, refSurvives } from './selectionPrune';
import { restoresWallet, snapshotWallet } from './freeBuild';
import { TOAST_FADE_MS, TOAST_LIFE_MS, toastClass, toastOverflow, toastText } from './toastView';
import { ringed, ringsShown } from './assaultRings';
import { mergeStep } from './mergeChase';
import { gridGap, gridLines, gridOffset } from './backdropGrid';
import { mapScale, screenRadius } from './mapRadius';
import { breath, phaseAt, phaseOfId } from './pulseFx';
import { authorizedBase } from './hubAuth';
import { diploIntent } from './diploClick';
import { afterTokenRefused, joinStep } from './joinGate';
import { assaultSteps } from './assaultOrder';
import { dialIdentity, dialUrl, seatTicketKey } from './netDial';
import { closeAction, isCurrentSocket } from './socketFate';
import { welcomePlan } from './netWelcome';
import { orderPlan } from './orderRoute';
import { errorTarget, refusalKey } from './errorRoute';
import { clearStatusLine, fallbackFor, showServerRow } from './browserFallback';
import { joinHref, startEnabled } from './seatJoin';
import { archiveUrl, httpBase, matchesUrl, queryOutcome, seatsUrl } from './matchQuery';
import { pingRoute, relayIntake } from './relayIntake';
import {
  WAIT_MARK,
  desyncVerdict,
  keepFocus,
  keepGroup,
  radarContacts,
  waitingBanner,
} from './snapshotIngest';
import {
  arcLift,
  arcPoint,
  arcPolyline,
  burstK,
  shellT,
  sparkAngle,
  volleyLife,
  type VolleySpec,
} from './volleyFx';
import { FLAK_LIFE_MS, flakBurstRadius, flakDashOffset, flakLook, flakTier } from './flakTiers';
import { sweepGlow as armsGlow, sweepPaint, sweepShows } from './sweepFx';
import { emblemTally } from './fleetTally';
import { jumpStep, type JumpKind } from './mapJump';
import {
  loadStep,
  makeLoads,
  queuedCargo,
  queuedFromWorld,
  queuedOf,
  type PendingLoad,
} from './loadQueue';
// FRIENDS-1 — вкладка «Друзья»: список и заявки живут на аккаунте (сервер решает).
import { initFriends } from './friendsScreen';
import { initRank } from './rankScreen';
import { combatRanges, ringLook } from './combatRanges';
import { corridorLines } from './corridorView';
import { recapAdmits } from './recapGate';
// ONB-7 — first-session goals checklist (mine/fleet/capture/score, ticked from state).
import { FIRST_GOALS, metGoals, mergeDone, goalsComplete, type GoalSignals } from './firstGoals';
import { nextCycleStep, redialPlan } from './reconnectCycle';
// ONB-0 — first-run onboarding state + funnel (per-callsign localStorage). Pure
// model; main.ts persists it and drives the hub offer / «Ещё → Обучение» replay.
import {
  applyTourOutcome,
  markSkipped,
  markStarted,
  parseOnboardState,
  welcomeMode,
  type OnboardState,
} from './onboarding';
import type {
  GameState,
  Fleet,
  Hero,
  Battle,
  Planet,
  Action,
  DiplomaticStance,
  DomainEvent,
  IntelGrant,
  UnitStack,
} from '../../packages/shared-core/src/index';

// --- constants ---------------------------------------------------------------

// --- side-colour SCHEMES (client-only, localStorage) --------------------------
// Палитра и само правило «цвет = отношение» живут в `sideColors.ts` — одной таблицей на
// оба представления (карта и экран дипломатии). Здесь остаётся только клиентская
// НАСТРОЙКА: свой цвет, ничейное пространство и выбранная палитра.
let youColor = safeHexColor(readRaw('void.colorYou'), COLOR.p1!);
let neutralColor = safeHexColor(readRaw('void.colorNeutral'), COLOR.null!);
let rivalPaletteId = readRaw('void.rivalPalette') ?? 'classic';
if (!isPaletteId(rivalPaletteId)) rivalPaletteId = 'classic';
function setSideColors(you: string, neutral: string, palette: string): void {
  youColor = safeHexColor(you, COLOR.p1!);
  neutralColor = safeHexColor(neutral, COLOR.null!);
  rivalPaletteId = isPaletteId(palette) ? palette : 'classic';
  writeRaw('void.colorYou', youColor);
  writeRaw('void.colorNeutral', neutralColor);
  writeRaw('void.rivalPalette', rivalPaletteId);
}
// Political colour is relative to the local commander: YOU are your configured hue,
// unowned space grey, and every other commander is coloured by your STANCE toward them
// (enemy red / friendly blue / neutral grey — see relationColor). Works for solo
// (you = p1) and net (you may be any seat). Stance is public (never fogged), so the
// client always has the true value.
function ownerColor(owner: string | null | undefined): string {
  if (!owner) return neutralColor; // unowned territory (void / no-man's land)
  if (owner === ME) return youColor; // you
  return relationColor(getStance(s, ME, owner), paletteOf(rivalPaletteId));
}
/** Цвет чипа стойки на экране дипломатии — из той же палитры, что и карта. */
function stanceCol(st: DiplomaticStance): string {
  return stanceColor(st, paletteOf(rivalPaletteId));
}
// Build profile. `__PLAYER_BUILD__` is an esbuild define — REQUIRED by every bundler
// of this file (build.mjs sets it for both artifacts, uitest.mjs pins `false`); a
// missing define fails loudly at boot with this exact name. `true` bakes the PLAYER
// artifact (void-dominion-player.html): the dev affordances gated on it below (test
// mode, single-player skirmish, time acceleration) are compiled OUT of the bundle
// (the literal define is what lets esbuild dead-code-eliminate the branches — a
// `const` alias would fold but not propagate), and build.mjs strips their markup.
// `false` = the full dev client, today's behavior unchanged.
declare const __PLAYER_BUILD__: boolean;
// Runtime dev chrome (FPS overlay, the welcome-screen «Тесты» button): hidden from
// players, flipped on with `?dev` in the URL or localStorage 'vd.dev'='1' (persists
// per device). A live DESYNC still surfaces the overlay to everyone — that's a bug
// players must see and report, not diagnostics. Independent of __PLAYER_BUILD__: `?dev`
// on a player build only re-reveals diagnostics (FPS), never the compiled-out tools.
const DEV_UI = ((): boolean => {
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev'))
      return true;
    return readBool('vd.dev', false);
  } catch {
    return false;
  }
})();
// The ten possible commanders, in stable seat order. Seat 1 is always you (human);
// seats 2-10 are AI or off in the setup screen. Four faction passives cycle across seats.
const SEAT_META: ReadonlyArray<{ id: string; name: string; faction: string; color: string }> = [
  { id: 'p1', name: 'Azure Compact', faction: 'azure', color: COLOR.p1! },
  { id: 'p2', name: 'Crimson Hegemony', faction: 'crimson', color: COLOR.p2! },
  { id: 'p3', name: 'Amber Concord', faction: 'amber', color: COLOR.p3! },
  { id: 'p4', name: 'Violet Ascendancy', faction: 'violet', color: COLOR.p4! },
  { id: 'p5', name: 'Azure Compact II', faction: 'azure', color: COLOR.p5! },
  { id: 'p6', name: 'Crimson Hegemony II', faction: 'crimson', color: COLOR.p6! },
  { id: 'p7', name: 'Amber Concord II', faction: 'amber', color: COLOR.p7! },
  { id: 'p8', name: 'Violet Ascendancy II', faction: 'violet', color: COLOR.p8! },
  { id: 'p9', name: 'Azure Compact III', faction: 'azure', color: COLOR.p9! },
  { id: 'p10', name: 'Crimson Hegemony III', faction: 'crimson', color: COLOR.p10! },
];
const GRID = 'rgba(46,150,160,0.07)';
const LOCK = '#7df0d0'; // selection / targeting reticle accent
// RANGE-UX: три вида оружия — три РАЗНЫХ цвета, чтобы круги не сливались в кашу, когда
// в выделении и артиллерия, и носитель. Линия огня — того же цвета, что круг стрелка.
const R_ARTY = '#ffb43a'; // артиллерия: янтарный (как и весь огневой контур в HUD)
const R_WING = '#9ad7ff'; // эскадрилья: холодный голубой
const R_AA = '#c07dff'; // ПВО: сиреневый — это ОТМЕТКА на мире, а не область
// HERO-CORRIDOR: одноразовый коридор — КРАСНЫЙ мигающий пунктир (он исчезнет с первым
// же проходом, это не дорога); временный и общий — спокойная бирюза с таймером.
const CORR_ONCE = '#ff5c5c';
const CORR_LIVE = '#5ce1d6';
// CAST-UX: круги прицела каста. Отдельные имена, а не переиспользование LOCK, потому
// что дальность и область — РАЗНЫЕ сущности, и игрок должен различать их с одного
// взгляда: тонкий пунктир «докуда достану» против залитого пятна «что накроет».
const CAST_REACH = '#7df0d0'; // круг дальности способности
const CAST_FAR = '#ff6b6b'; // цель вне дальности — подсказка, вердикт всё равно за ядром
// Радиус способности — всегда этот фиолетовый, и всегда пунктиром: на карте уже есть
// кольца дальности огня и радара, и способность обязана читаться как ДРУГАЯ сущность.
const ABILITY_RING = '#b78cff';
const TAU = Math.PI * 2;
const TOP = 50; // top-bar height
const RAIL = 50; // left-rail width
const BUILDABLE = [
  'mine',
  'refinery',
  'farm',
  'power_plant',
  'fabricator',
  'tax_office',
  'barracks',
  'radar',
  'fort',
  'orbital_aa',
];
// `orbital_aa` (orbital ПВО — anti-ship near-orbit emplacement) is a defensive BUILDING:
// the player builds it like a fort. It fires on hostile fleets over the world (core
// `aaStrengthAt` sums building AA) but does NOT block ground capture — only ground troops
// do that. A space fortress also comes with one pre-installed (installFortressAA).
// H4-REVERT: наземные юниты вернулись в общий конвейер. Пока их поднимала мобилизация
// дивизии, этот массив был чисто космическим — и снос дивизий без этой строки оставил
// бы игрока вовсе без сухопутных войск, то есть без второй фазы захвата мира.
// Панель уже раскладывает их по своим полкам (`groundBuilds` / `shipBuilds` /
// `wingBuilds` фильтруют этот же список), так что достаточно их сюда вписать.
const BUILD_UNITS = [
  'cruiser',
  'scout',
  'siege',
  'strike_carrier',
  'fighter_squadron',
  'militia',
  'heavy_infantry',
  'special_forces',
  'tank',
];
// A small glyph per province KIND, drawn above each province so its type reads at a
// glance (planet / asteroid / nebula / wreck-field / storm / …). Text glyphs only.
let ME = 'p1';
// Суверены — the donate/premium currency (docs/economy-roadmap.md). It's a meta-layer
// account balance, NOT match state, so the prototype shows a placeholder here; the real
// balance comes from the account once monetization is wired.
const SOVEREIGNS = 500;
type PlanetTab = 'ground' | 'ships' | 'squadron' | 'buildings';

// Holographic draw primitives (rgba tint, cached glow/sphere sprites) now live in the
// shared render kit (@void/client · holoDraw.ts, CP0.2 — one render implementation). The
// prototype keeps thin same-named delegators so every call site is unchanged; it passes its
// canvas ctx (`cx`) + current DPR, and the module owns the dpr-keyed sprite caches. `rgba`
// is imported directly (a pure colour helper).
function blitGlow(color: string, x: number, y: number, r: number, a: number): void {
  if (!glowOn()) return; // graphics pref: glow & haloes off → skip the bloom discs entirely
  hdBlitGlow(cx, DPR, color, x, y, r, a);
}
function blitSphere(color: string, x: number, y: number, r: number, a = 1): void {
  hdBlitSphere(cx, DPR, color, x, y, r, a);
}

/** Total count across a stack of units (ships, garrison or landing troops). */
const sumUnits = (stacks: ReadonlyArray<{ count: number }>): number =>
  stacks.reduce((a, s) => a + s.count, 0);

// Map-marker geometry / palette, shared so every blip reads the same way.
const CARDINAL: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];
const ORBIT_COLOR = '#7df0d0'; // the single orbit ring (GDD §7.4 — no near/far split)

// --- state -------------------------------------------------------------------

let s: GameState = newGame();
let speed = 1 / 3600; // game-hours per real second (0 = paused); ×1 = wall-clock, overwritten at launch
let banner: string | null = null;
// Terminal end screen (the match-over overlay): outcome + reason + XP award, filled
// once by checkEnd from the authoritative `match` state. `dismissed` lets the player
// hide it to look at the final board (the match stays frozen). Reset on a fresh match
// / reconnect so a new game never opens straight into the old result.
let endScreen: MatchEnd | null = null;
let selFleet: string | null = null;
let selPlanet: string | null = null;
let selFleets = new Set<string>();
let aiming = false; // "Move" command armed → next world tap orders the move
// PC ШТУРМ: armed like "Move", but the target must be someone else's capturable
// world — the fleet flies there and assaults on arrival (one-shot, not the CC-2
// standing auto-storm). Keyed by fleet id → destination world.
let assaultAim = false;
const assaultOnArrival = new Map<string, string>();
let barrageAim = false; // "Обстрел" armed → next tap picks the artillery's focus target
// Hero window armed modes: a cast waits for its target world; a deploy waits for the
// point the hero's ship rises at (own world / own fleet / allied world by markers).
let heroAim: { heroId: string; abilityId: string } | null = null;
let heroSpawnAim: string | null = null;
// Squadron free-space strike armed → next tap on an enemy fleet sends squadron.strike
let squadronStrikeAim: string | null = null;
// CC-2 standing order: fleets whose owner opted into AUTO-STORM — they descend and assault
// a hostile world on arrival by themselves (the AI's autoEngage capture loop, opted-in).
const autoAssault = new Set<string>();
// CC-4 reactive auto-scramble: squadron fleets on "дежурный вылет" — they auto-sortie at
// any identified, at-war contact that enters their strike radius (SQ-4.1 patrol core),
// burning fuel and rearming on a game-hour cadence (SQ-2.1). Client-side plan, like the
// order queue; single-player only (the server owns fleets in net play).
const patrols = new Map<string, Patrol>();
// Fuel/rearm stashed when a SOLO patrol is toggled OFF, so OFF→ON resumes the wing's
// sortie instead of handing back a full tank — BF-26 parity with the server's
// order.scramble path (st.wingSorties in game.ts); without it, toggling free-refuels a
// dry wing. (NET arms via order.scramble, which does its own stash server-side.)
const wingSorties = new Map<string, Patrol['sortie']>();
// A staged move that would cross territory of a player you're at PEACE with: held
// until you confirm in the war-prompt (declaring war opens the route) or cancel.
let warPrompt: {
  fleetIds: string[];
  destId: string;
  edge?: { from: string; to: string; t: number };
  blockers: string[];
  /** PC ШТУРМ command: confirm → the moved fleets also assault on arrival; the
   *  prompt reads as "this is a friendly faction's world — declare war?". */
  assault?: boolean;
} | null = null;
// TGT-1: target-order composer over CC-1 chains. «Цель» arms targeting; the next
// CHAIN-UX «Приказ» (перерос TGT-1): персистентный режим построения плана тапами по
// карте. Пока он жив, карта — рабочая поверхность: тап по точке открывает меню
// действий ПО ТИПУ точки, выбор дописывает жест в черновик, полоска вместо cmdbar
// держит ⟲/⌂/✓/✕. Черновик привязан к fleetIds, НЕ к выделению (как старый композер).
let chainMode: {
  fleetIds: string[];
  steps: ChainStep[];
  gestures: number[];
  menu: { id: string; kind: ChainPointKind } | null;
} | null = null;
// Хитбоксы ◎-бейджей отправленных планов (тап вне режима = редактирование плана).
let chainHits: Array<{ target: string; fleetIds: string[]; x: number; y: number }> = [];
// Кэш маршрутов для отрисовки цепочек: граф лейнов статичен всю партию.
const chainRouteCache = new Map<string, string[] | null>();
// SEL-1 «Выбрать+»: touch multi-select. While ON the bottom sheet collapses, map
// taps only toggle OWN fleets in/out of the group, and the group takes any common
// order (Курс/Штурм/Цель…) — issuing one drops back out of the mode.
let pickMode = false;
let cmdMore = false; // ☰ — the second row of the command bar (extras live there)
let fireMenu = false; // 🔥 — режим огня артиллерии: поповер-меню над командным рядом
let castMenu = false; // ✨ — способности героя-флагмана: поповер-меню каста над рядом
let merging = false; // "Merge" armed → next tap on a friendly fleet picks the anchor
// Fleets ordered to merge but not yet co-located: each flies to its anchor and the
// fusion fires once they share a docked sector (see resolvePendingMerges()).
let pendingMerges: Array<{ mover: string; into: string }> = [];
let additive = false; // Shift or Ctrl/⌘ held on the current tap → add to the fleet selection
// Split-fleet dialog: which fleet, and how many of each ship type peel off.
let splitState: { fleetId: string; take: Record<string, number> } | null = null;
// GRND-1 ⇅ «Десант»: поповер погрузки/выгрузки над рядом команд. `plan` — знаковая
// дельта на тип: >0 поднять из гарнизона, <0 высадить. null = меню закрыто.
let troopsPlan: { fleetId: string; plan: Record<string, number> } | null = null;

// --- session diplomacy & comms menu state ------------------------------------
// Messages are a prototype-local session log — they don't touch the deterministic
// core (they don't affect the sim, so they stay out of GameState). Stances DO live
// in the core (state.diplomacy); the menu drives them through diplomacy.declare.
// `to` is a conversation key: a seat id (a 1:1 DM) or COALITION (the allies' group
// chat). `ping` (coalition only) carries a province id → a clickable map marker.
// `pingId` (net only) is the server-assigned id, so a `ping.removed` can find its line.
let sessionMessages: SessionMsg[] = [];
// --- floating chat window (desktop only) -------------------------------------
// REFM-12: окно уехало в `chatWindow.ts` целиком — состояние, разметка, геометрия и
// кэш настроек живут там. Здесь только сборка, и она стоит ИМЕННО ЗДЕСЬ, а не рядом
// с остальным UI внизу файла: `resize()` (строкой ниже по файлу, вызывается
// синхронно при загрузке) спрашивает у окна `onViewportResize`, поэтому привязка
// обязана существовать раньше. Внизу она попала бы в temporal dead zone и уронила
// бы загрузку целиком. Все зависимости взяты ленивo — стрелками, поэтому объявленные
// ниже `NAME`/`VW`/`MOBILE` читаются в момент вызова, а не сейчас.
// пользуются рейл, реестр слоёв Back/Escape и приход нового сообщения.
const chatWin = initChat(
  {
    root: () => document.getElementById('chatwin'),
    viewport: () => ({ w: VW, h: VH }),
    isMobile: () => MOBILE,
    groupTabs: () => [
      { key: CH_SESSION, label: t('chat.tab.session'), icon: '△' },
      { key: CH_GLOBAL, label: t('chat.tab.global'), icon: '🌐' },
      { key: COALITION, label: t('chat.tab.coalition'), icon: '⬡' },
    ],
    isGroup: (key) => GROUP_CHANNELS.has(key),
    messages: () => sessionMessages,
    me: () => ME,
    seatExists: (id) => !!s.players[id],
    seatLabel: (id) => NAME[id] ?? id,
    seatIcon: (id) => seatBadge(id).icon,
    convoMessages: (key) => conversations.messagesOf(key),
    lineHtml: (m, stamp) => conversations.lineHtml(m as SessionMsg, stamp),
    dispatch: dispatchChat,
    openSeatCard,
    jumpToPing,
  },
  CH_SESSION,
);
document.getElementById('rail-chat')?.addEventListener('click', () => chatWin.toggle());

let diploOpen = false;
let diploTab: 'diplo' | 'msgs' | 'intel' = 'diplo';
let diploSort: 'name' | 'worlds' | 'stance' = 'stance';
let diploExpanded: string | null = null; // participant row showing its action buttons
// Roster filters (alongside sort): show only seats matching the picked stance(s) and
// type(s). Empty set = no constraint from that category. They AND across categories,
// OR within one. A stance filter excludes your own seat (you have no self-stance).
const diploStanceFilter = new Set<DiplomaticStance>();
const diploTypeFilter = new Set<'human' | 'ai'>();
// Screen hit-boxes for the on-map ping markers, rebuilt every frame by drawPings().
let pingHits: Array<{ loc: string; x: number; y: number }> = [];

// --- multiplayer (net mode) --------------------------------------------------
// When connected, the server is authoritative: snapshots replace `s`, orders are
// sent (not applied locally), and the local sim/AI is suspended (see frame()).
let NET = false;
// BF-30: true once the server's welcome snapshot has been received and ME is set to
// the correct playerId. Until then, the map must NOT render — the default `ME = 'p1'`
// would paint a spawn at p1's start before the server assigns the real seat.
let netAdmitted = false;
/** The match this client is in / will (re)connect to. Set when joining from the menu;
 *  `connect()` (and auto-reconnect) dial `/matches/<currentMatchId>`. */
let currentMatchId = 'proto';
let netClient: MultiplayerClient | null = null;
let netSock: WebSocket | null = null;
// M0 net telemetry (dev overlay): smoothed round-trip ms, and a desync check that
// compares our reconstructed view to the server's hash on every snapshot.
let rttEma: number | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
// M2 perf telemetry: a light fps/rtt/mem sample every 30s while in a network match —
// lands in the server's metrics stream (observe → JSONL/сводка), never answered.
let perfTimer: ReturnType<typeof setInterval> | null = null;
const PERF_SAMPLE_MS = 30_000;
let netDesync = false; // last snapshot's hash mismatched (server vs our rebuild)
let netDesyncCount = 0; // how many snapshots have mismatched this session
// Auto-reconnect: on an UNEXPECTED drop (not a user action), rejoin our seat with
// backoff — the server keeps the match running and the nick maps us back.
let userClosed = false;
let reconnecting = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let aimPointer: { x: number; y: number } | null = null; // last canvas pointer (for the move preview)
let hoverObj: string | null = null; // side-panel object under the pointer (data-desc key)
let planetTab: PlanetTab = 'buildings';
// Bytro-карточка: тап по имени флота открывает сводку армии — какой флот сейчас
// в режиме сводки (другой флот в панели → обычная карточка сама собой).
let fleetInfoFor: string | null = null;
// Тап по имени МИРА открывает карточку статистики планеты (какой мир сейчас в
// режиме сводки; другой мир в панели → обычная карточка сама собой).
let planetInfoFor: string | null = null;
const buildQueues: Record<string, PlanetBuildQueue> = {};
const logLines: string[] = [];
// Player ids the local sim drives as AI (empty seats become AI). Default solo = p2.
let AI_PLAYERS = new Set<string>(['p2']);
// Session war record (from `unit.died` events): enemy units you destroyed vs your own
// units lost. Cumulative since the match started; reset on a new match. Only battles
// YOU take part in are counted (tracked by location via battle.started/resolved), so
// the AI's fights elsewhere don't inflate your tally.
let killStats = { destroyed: 0, lost: 0 };
const myBattleLocs = new Set<string>();
// Orbital-AA volleys to visualize (H2): map-space endpoints captured at event time
// (the target may die in that very volley), drawn as a fading flak burst ~0.7s.
const aaShots: Array<{
  from: { x: number; y: number };
  to: { x: number; y: number };
  at: number;
  close: boolean; // ближняя ПВО (гарнизон, залп раз в 15 мин) — рисуется легче
}> = [];
// Siege (artillery) volleys to visualize: map-space endpoints captured at event
// time, drawn as a ballistic ARC with a stagger of shell particles and an impact
// burst — so a standoff bombardment visibly points at WHO is being hit.
const siegeShots: Array<{
  from: { x: number; y: number };
  to: { x: number; y: number };
  at: number; // performance.now() at event time
  seed: number; // stable per-volley variation (spark angles, shell jitter)
}> = [];
let siegeSeed = 0;
// Capture flashes: a province that changed hands lights up in its NEW owner's colour —
// a wave sweeps across its cell and the frontier ignites, fading over ~1.5s, so a
// silent capture (previously only a toast) reads on the map at a glance. Fog-gated at
// push time (a hidden flip never flashes). Keyed by node so a re-capture restarts it.
const captureFlashes = new Map<string, { owner: string; at: number }>();
// Casualties per contested location (owner → unit → count), accumulated from
// unit.died while a battle runs and paid out as a result note on battle.resolved.
const battleLosses = new Map<string, Record<string, Record<string, number>>>();
// Single-player setup screen state: per-seat role (seat 0 is always you) + your
// chosen homeworld. Seats 2-10 toggle 'ai'/'off'; an 'ai' seat spawns a rival.
const freshSetupSlots = (): Array<'human' | 'ai' | 'off'> =>
  SEAT_META.map((_, i) => (i === 0 ? 'human' : i === 1 ? 'ai' : 'off'));
let setupSlots: Array<'human' | 'ai' | 'off'> = freshSetupSlots();
// Team battle (2v2 etc.): when on, seats fight in sides — same side ALLIED (win
// together, no friendly fire), across sides at WAR from the first hour. Seat 0 (you)
// is always side A; the default when enabling pairs you with seat 1 vs seats 2-3.
// Off ⇒ classic free-for-all. See newGame's team-aware diplomacy seeding.
let setupTeams = false;
const DEFAULT_TEAM_SIDES: ReadonlyArray<'A' | 'B'> = [
  'A',
  'A',
  'B',
  'B',
  'A',
  'A',
  'B',
  'B',
  'A',
  'B',
];
let setupSeatTeam: Array<'A' | 'B'> = [...DEFAULT_TEAM_SIDES];
let setupStart: string = START_CANDIDATES[0] ?? MAP[0]!.id;
let setupScientists: string[] = []; // the human's chosen research-leader council (≤2), picked at setup
let setupFaction = 'azure'; // H3: the house the HUMAN plays; AI seats take the remaining ones
// SANDBOX — the home world of the local player (immortal-home target), captured at
// launch. `sandboxConfig.enabled`/toggles live in ./sandbox; this is the only host var.
let sandboxHomeId: string | null = null;
// Chosen time-flow multiplier for the launched match (×1/×2/×5/×10/×50/×100). ×1 = today's
// normal play pace; the launch maps it onto the speedbar (applyTimeSpeed). ×100 is a
// single-player-only sandbox pace — in net mode the server owns the clock, so this list
// (and the in-match pace chips) only ever affect the local sim (see `frame()`'s `!NET` guard).
const SETUP_SPEEDS = [1, 2, 5, 10, 50, 100];
let setupSpeed = 10;
let lastPanelHtml = '';
let lastCmdHtml = '';
let lastSplitHtml = '';
let lastHudHtml = '';
let lastClockText = '';
let lastTopText = ''; // row-1 dirty check (nick / standing / score / day / countdown)
let lastObjDescHtml = '';
let lastLogHtml = '';
let lastAlertText = '';
let lastRailAlert = '';
// --- fog of war (renderer projection; always on) -----------------------------
// Client-side projection just for the renderer — NOT the real security boundary
// (that is `visibleState` in shared-core). Fog is always on: ships are near-blind,
// sight comes from owned worlds + radar (see `computeVision`).
let vision: Vision | null = null; // identify + radar sets for this frame

// --- dom ---------------------------------------------------------------------

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const canvas = $('map') as unknown as HTMLCanvasElement;
const cx = canvas.getContext('2d') as CanvasRenderingContext2D;
const side = $('side');
// HUD-DOCK: ряд команд (и регулятор скорости) стоят НА листе, поэтому его РЕАЛЬНАЯ
// высота уезжает в `--sheeth`. Наблюдатель, а не замер в кадре: `offsetHeight` каждый
// кадр — принудительный layout на 60 Гц ради величины, которая меняется раз в
// несколько секунд. Нулевую высоту (лист спрятан через display:none) пропускаем: она
// не нужна — правило висит на `body.sheet-open` — а записать её значило бы на один кадр
// уронить ряд в самый низ при каждом открытии листа.
if (typeof ResizeObserver !== 'undefined')
  new ResizeObserver((entries) => {
    const e = entries[entries.length - 1];
    if (!e) return;
    // borderBoxSize — высота С рамкой и padding'ом (у листа там сидит safe-area
    // телефона); contentRect их не считает, и ряд наехал бы на лист снизу.
    const h = e.borderBoxSize?.[0]?.blockSize ?? (e.target as HTMLElement).offsetHeight;
    if (h > 0) document.body.style.setProperty('--sheeth', sheetHeightVar(h));
  }).observe(side);
const logEl = $('log');
const devlineEl = $('devline'); // status strip below the top bar: clock + donate currency
const purse = $('purse');
// top-bar row 1: nick + live standing (left), victory chip (gap), day card (right)
const topEl = $('top');
const tbName = $('tbname');
const tbPlace = $('tbplace');
const tbScore = $('tbscore');
const tbDay = $('tbday');
const tbEta = $('tbeta');
const bannerEl = $('banner');
let lastBannerHtml = ''; // dirty-check so the banner's restart button isn't recreated each frame
const restartBtn = $('restart'); // speedbar restart (shown in the no-bots solo sandbox)
const restartSep = $('restart-sep');
const spdCtl = $('spd-ctl'); // speedbar time-control group
const speedbarEl = $('speedbar');
const alertBadge = $('alertbadge');
const cmdbar = $('cmdbar');
const splitdlg = $('splitdlg');
// top-bar right cluster + collapsible rail
const railEl = $('rail');
const railToggle = $('railtoggle');
const railGlyph = $('railglyph');
const railAlert = $('railalert');
const crestMark = $('crestmark');

// Player emblem — a cosmetic console crest the player picks in the main menu (hub) and
// wears in the in-match top-bar corner. Client-side only (localStorage) — never match
// state, never sent to the server. Falls back to the first glyph if unset/unknown.
const EMBLEMS = ['◆', '◇', '⬡', '⬢', '✦', '✧', '★', '⚛', '◉', '⌖', '❖', '⟡'];
function playerEmblem(): string {
  const e = readRaw('void.emblem') ?? '';
  return EMBLEMS.includes(e) ? e : EMBLEMS[0]!;
}
function applyEmblem(): void {
  const g = playerEmblem();
  const hubAv = document.getElementById('hubav');
  if (hubAv) hubAv.textContent = g;
  crestMark.textContent = g;
}
function setPlayerEmblem(g: string): void {
  if (!EMBLEMS.includes(g)) return;
  writeRaw('void.emblem', g);
  applyEmblem();
}

// --- viewport, galaxy backdrop & map projection ------------------------------

let VW = 1280; // viewport size in CSS pixels (drives layout + projection)
let VH = 720;
let DPR = 1;
let MOBILE = false;
function resize() {
  // The two decisions under this — the DPR cap and what counts as a phone — live in
  // `viewport.ts` (REFM-24), where they are covered by tests.
  const v = measureViewport();
  VW = v.w;
  VH = v.h;
  DPR = v.dpr;
  MOBILE = v.mobile;
  canvas.width = Math.round(VW * DPR);
  canvas.height = Math.round(VH * DPR);
  canvas.style.width = VW + 'px';
  canvas.style.height = VH + 'px';
  chatWin.onViewportResize(); // the half-screen cap follows the new viewport
}
if (typeof window !== 'undefined') window.addEventListener('resize', resize);
resize();

// The backdrop (deep-space + nebulae + radar grid + star ticks) is baked into the
// cached static layer (see buildStaticLayer). This is the only live backdrop bit:
// a slow radar sweep across the plotting table — console chrome that follows the
// HARDWARE: one rotating arm per OWN radar source (planet array / radar ship),
// pivoted on the source and clipped to ITS reach; co-located sources collapse into
// one arm showing only the farthest radius. All arms share one rotation phase; map
// blips light up as an arm crosses them (radar "ping" afterglow). sweepOn guards
// engines without conic gradients (no visible sweep → no ping).
type SweepArm = { x: number; y: number; r: number }; // screen-space pivot + reach
let sweepArms: SweepArm[] = [];
let sweepAng = 0;
let sweepOn = false;
let sweepPrevAng = -1; // previous frame's arm angle, for "did the arm cross X" tests
// Player display preference (client-only, localStorage): the sweep's VISUAL opacity 0..1.
// 0 hides the wedge + arm entirely; any value only dims the CHROME — the radar MECHANIC
// (contact snapshots + blip afterglow) is computed before the visual gate, so it is
// unaffected at every setting. Absent key ⇒ full (1); a stored 0 must NOT be read as absent.
let sweepOpacity = readNum('void.sweepOpacity', 1, 0, 1);
function setSweepOpacity(v: number): void {
  sweepOpacity = Math.min(1, Math.max(0, v));
  writeRaw('void.sweepOpacity', String(sweepOpacity));
}
// Player display preference (client-only, localStorage): show YOUR OWN ping markers
// on the map. Purely visual — the ping itself (chat line, allies' view, the server
// relay) is untouched; allies' pins are always drawn. Default on.
let showOwnPings = readBool('void.showOwnPings', true);
function setShowOwnPings(v: boolean): void {
  showOwnPings = v;
  writeBool('void.showOwnPings', v);
}
// --- graphics preferences (client-only, localStorage) ------------------------
// Тумблеры косметики и режима вёрстки живут в `graphicsPrefs.ts` (REFM-21): свечение,
// звёздное поле, счётчик кадров и ПК-гейт. Здесь остаётся только то, что завязано на
// сборку и на панель времени.
// SND-1 — звуки интерфейса: синтезатор целиком в sound.ts, здесь только фабрика.
// AudioContext создаётся лениво при первом play() (всегда внутри клика — autoplay
// доволен); среда без WebAudio/localStorage — молча беззвучна, UI живёт как жил.
const snd = initSound(prefStore());
// Developer setting (PC): show the speedbar time controls (pause + speed multipliers).
// Off for a normal player — the world runs at its launch pace, real-time-async; a dev
// flips it on to pause / accelerate for testing. Defaults on in the dev client so its
// long-standing speedbar stays; off in the player build. Client-only (localStorage).
let devSpeedControl = readBool('void.devSpeed', !__PLAYER_BUILD__);
function setDevSpeedControl(v: boolean): void {
  devSpeedControl = v;
  writeBool('void.devSpeed', v);
}
const SWEEP_DIV = 1600; // sweep angular rate: ang = now / SWEEP_DIV
const SWEEP_PERIOD = TAU * SWEEP_DIV; // ms for a full rotation (~10s) — the radar refresh tick
/** Radar contacts as PAINTED BY THE SWEEP: a signature is refreshed only as the arm
 *  crosses it, then lingers at that last-swept spot (a dim ghost) until the next
 *  pass repaints it — so radar gives periodic snapshots, never a live feed. */
const radarMemory = new Map<string, { node: string; size: 'S' | 'M' | 'L'; at: number }>();
/** NET radar picture (BF-18): the server's per-frame contact list. In a network
 *  match the fogged state carries NO radar-only enemy fleets, so the sweep paints
 *  these server-sent contacts instead of scanning `s.fleets`. */
let netSignatures: Array<{ location: string; size: 'S' | 'M' | 'L' }> = [];

/** How brightly a contact at screen-point `c` is lit by the sweep: 1 the instant
 *  the arm crosses it, fading linearly back to 0 just before the next pass (so the
 *  imprint lingers a whole rotation). 0 when the sweep is inactive. */
function sweepGlow(c: { x: number; y: number }): number {
  // Сама засветка (угол отставания, приведение знака, кривая, максимум по лучам) —
  // `sweepFx.ts` (REFM-113). Здесь остаётся только «есть ли развёртка вообще».
  return sweepOn ? armsGlow(sweepArms, c, sweepAng, TAU) : 0;
}

function drawScanSweep(now: number) {
  sweepArms = [];
  sweepOn = false;
  if (!cx.createConicGradient) return; // graceful: skip on engines without it
  // One arm per OWN radar source, pivoted on the array / the ship itself (a moving
  // ship carries its arm along). Sources sharing a pivot (a radar world with a
  // radar ship docked) merge — only the farthest radius is shown.
  const raw: SweepArm[] = [];
  const add = (at: { x: number; y: number }, reach: number): void => {
    const c = world(at);
    const r = worldDist(reach); // uniform projection ⇒ true circle (`mapRadius.ts`)
    raw.push({ x: c.x, y: c.y, r });
  };
  for (const p of Object.values(s.planets)) {
    if (p.owner !== ME) continue;
    const r = planetRadar(p);
    if (r > 0) add(p.position, r);
  }
  for (const f of Object.values(s.fleets)) {
    if (f.owner !== ME) continue;
    const r = fleetRadar(f);
    const pos = r > 0 ? fleetPos(f) : null;
    if (pos) add(pos, r);
  }
  // Слияние совпавших по месту источников (остаётся ДАЛЬНИЙ) — `radarSources.ts`
  // (REFM-119): радарный корабль у радарного мира иначе дал бы два луча из одной точки.
  sweepArms = mergeArms(raw);
  sweepAng = (now / SWEEP_DIV) % TAU;
  sweepOn = sweepArms.length > 0;
  if (!sweepOn) return;
  // Visual gate (player preference). Everything above — arms, angle, sweepOn — is the
  // MECHANIC and always runs; only the chrome below is skipped/dimmed. At 0 the sweep is
  // invisible yet still snapshots contacts and lights blips exactly as before.
  // Механика (лучи, угол, `sweepOn`) уже посчитана выше и от настройки не зависит —
  // прозрачность гасит только ХРОМ (`radarSources.ts`, правило 10).
  const op = sweepOpacity;
  if (!sweepChromeShown(op)) return;
  cx.save();
  cx.globalCompositeOperation = 'lighter';
  for (const a of sweepArms) {
    if (!visible(a, a.r + 40)) continue; // draw-cull; the arm still paints contacts
    // subtle trailing wedge, clipped to this source's reach — reads as a slow
    // rotating radar sweep (fades over ~0.4 turn behind the leading edge). Alpha is
    // scaled by the player's opacity preference so it can be dimmed toward invisible.
    const grd = cx.createConicGradient(sweepAng, a.x, a.y);
    grd.addColorStop(0, `rgba(53,214,230,${0.05 * op})`);
    grd.addColorStop(0.16, `rgba(53,214,230,${0.012 * op})`);
    grd.addColorStop(0.4, 'rgba(53,214,230,0)');
    grd.addColorStop(1, 'rgba(53,214,230,0)');
    cx.save();
    cx.beginPath();
    cx.arc(a.x, a.y, a.r, 0, TAU);
    cx.clip();
    cx.fillStyle = grd;
    cx.fillRect(a.x - a.r, a.y - a.r, a.r * 2, a.r * 2);
    cx.restore();
    // the leading edge — the visible radar arm itself
    cx.strokeStyle = `rgba(53,214,230,${0.26 * op})`;
    cx.lineWidth = 1;
    cx.beginPath();
    cx.moveTo(a.x, a.y);
    cx.lineTo(a.x + Math.cos(sweepAng) * a.r, a.y + Math.sin(sweepAng) * a.r);
    cx.stroke();
  }
  cx.restore();
}

// --- threat alert (THREAT-HUD): «враг у ваших рубежей» ------------------------
// The same fog-honest node-threat tripwire the Steward keys off (ST-3.1,
// scanNodeThreats), surfaced to the LIVE player: one note per (node, fleet)
// EPISODE — a camping fleet doesn't re-toast every step, a fresh approach after
// the episode ended alerts again (the radarMemory pattern). Throttled to once
// per GAME-HOUR bucket: solo advances s.time every frame, so a raw s.time guard
// would be a no-op and the coverage flood would run per frame; threats move on
// multi-hour ETAs, so an hourly sweep loses nothing. NET is naturally
// fog-clean — the fogged state only ever holds fleets the player may see.
const threatMemory = new Set<string>();
let threatScanAt = -1;
function updateThreatAlerts(): void {
  const bucket = hourBucket(s.time, HOUR);
  if (bucket === threatScanAt) return;
  threatScanAt = bucket;
  if (s.players[ME]?.status !== 'active') return;
  const c = ctx(s.time);
  const identified = identifiedNodes(s, ME, data);
  const live = new Set<string>();
  for (const p of Object.values(s.planets)) {
    if (p.owner !== ME) continue;
    for (const th of scanNodeThreats(s, p.id, ME, c, identified)) {
      const key = episodeKey(p.id, th.fleetId);
      live.add(key);
      if (freshEpisodes(threatMemory, [key]).length === 0) continue; // эпизод уже объявлен
      note(
        th.kind === 'inbound' && th.eta > s.time
          ? t('threat.incoming', {
              node: p.id,
              dur: stewFmtDur(th.eta - s.time),
            })
          : t('threat.here', { node: p.id }),
        p.id,
      );
    }
  }
  forgetEnded(threatMemory, live); // эпизод кончился → новый подход снова прозвенит
}

/** Refresh radar contacts the arm crossed this frame: snapshot each radar-only enemy
 *  fleet's spot + coarse size when the sweep paints it. Runs every frame. */
function updateRadarContacts(now: number): void {
  if (!sweepOn) return;
  if (vision) {
    // What the sweep may paint. Solo scans the full state for radar-only enemy
    // fleets; in NET those fleets are physically ABSENT from the fogged state —
    // the server ships them as coarse contacts (snapshot.signatures, BF-18).
    // Кто может стать отметкой — `radarContacts.ts` (REFM-96): в соло тот же отбор
    // делается вручную, иначе одиночная игра покажет больше сетевой.
    const contacts = NET
      ? netContacts(netSignatures, known)
      : soloContacts(
          Object.values(s.fleets),
          ME,
          (f) => fleetNode(f),
          known,
          radarHas,
          (f) => sigClass(fleetSignature(f)),
        );
    let hit = false; // засекла ли рука хоть кого-то в ЭТОМ кадре
    for (const c of contacts) {
      const node = s.planets[c.node];
      if (!node) continue;
      const pos = world(node.position);
      // painted only by an arm whose radar disc actually covers the blip
      // Красит только рука, чей радарный диск реально накрывает отметку (`alerts.ts`).
      if (paintedThisFrame(sweepArms, pos, sweepPrevAng, sweepAng)) {
        hit = true;
        if (!radarMemory.has(c.key))
          note(t('threat.contact', { size: c.size, at: c.node }), c.node);
        radarMemory.set(c.key, { node: c.node, size: c.size, at: now });
      }
    }
    // Пинг гидролокатора в момент засечки. ОДИН на кадр, а не на контакт: рука
    // пересекает несколько целей разом, и «пачка» звучала бы как сбой, а не как радар
    // (анти-трель зазор в `SOUND_MIN_GAP` прореживает и сами кадры).
    //
    // Звук намеренно НЕ смотрит на `sweepOpacity`: тот гасит только хром развёртки, а
    // засечка — событие механики, у него своя ручка (общий выключатель звука).
    if (hit) snd.play('radar');
  }
  sweepPrevAng = sweepAng;
}

/** Draw the remembered radar contacts: a bright flash when freshly swept, settling
 *  to a dim last-known ghost held until the next pass repaints it; dropped once a full
 *  rotation passes with no repaint (the contact has moved on / is gone). */
function drawRadarContacts(now: number): void {
  for (const [id, m] of radarMemory) {
    const age = now - m.at;
    if (contactLost(age, SWEEP_PERIOD)) {
      radarMemory.delete(id); // a whole turn with no repaint → contact lost
      continue;
    }
    const node = s.planets[m.node];
    if (!node) {
      radarMemory.delete(id);
      continue;
    }
    const pos = world(node.position);
    if (!visible(pos, 120)) continue;
    drawSignatureAt(pos, m.size, contactAlpha(age), now);
  }
}

// Project a map-space point into the on-screen play area (inside the HUD insets).
let MINX = Infinity;
let MAXX = -Infinity;
let MINY = Infinity;
let MAXY = -Infinity;
for (const n of MAP) {
  MINX = Math.min(MINX, n.x);
  MAXX = Math.max(MAXX, n.x);
  MINY = Math.min(MINY, n.y);
  MAXY = Math.max(MAXY, n.y);
}
// The play area: the screen rectangle the map lives in, inside the HUD insets. Mobile
// no longer reserves the left rail (it folds into the drawer) → the map claims that
// space; desktop keeps the rail + label gutter and the right panel column.
function insets(): { left: number; right: number; top: number; bottom: number } {
  if (MOBILE) {
    return { left: 14, right: VW - 24, top: TOP + 54, bottom: VH - 96 };
  }
  // Wide screens (tablets + landscape): frame the board with reserves that SCALE to the
  // viewport rather than fixed desktop constants. The old fixed 372px right column and
  // 80/150 top/bottom bars wasted most of a tablet's width and squeezed a short landscape
  // screen to a sliver — so the whole-map fit rendered tiny. Clamped so it stays sane
  // across a 9" tablet up to a desktop window.
  const rightPad = Math.min(360, Math.max(120, VW * 0.16));
  const topPad = Math.min(80, Math.max(44, VH * 0.09));
  const botPad = Math.min(150, Math.max(78, VH * 0.16));
  return { left: RAIL + 80, right: VW - rightPad, top: TOP + topPad, bottom: VH - botPad };
}
// The view transform (fit / zoom / pan / projection) lives in the shared camera module
// (@void/client · camera.ts, CP0.2 — one render implementation for the prototype and the
// Stage-4 client). MINX..MAXY (set once from MAP above) are the map bounds it projects.
const mapBounds = () => ({ minX: MINX, minY: MINY, maxX: MAXX, maxY: MAXY });

// Camera: pan offset + zoom over the base fit (scale range MIN_SCALE..MAX_SCALE lives in
// the module: 1 = whole-map fit, 6 = one province + neighbours). Node/label sizes stay
// constant in screen px; only positions transform (node-graph style zoom). On a phone the
// opening view zooms onto the home region; double-tap resets, pinch out to the overview.
const cam = { scale: 1, x: 0, y: 0 };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
// node sector type by id — drives asteroid-junction rendering + capture-by-arrival
const SECTOR_OF: Record<string, string> = Object.fromEntries(MAP.map((n) => [n.id, n.sector]));
/** Sector-type def of a node. SECTOR_OF is total for the generated MAP, but the type
 *  can't promise that for an arbitrary id — fail-soft to undefined (callers `?.`). */
function sectorTypeOf(id: string) {
  const kind = SECTOR_OF[id];
  return kind === undefined ? undefined : SECTOR_TYPES[kind];
}
function world(p: { x: number; y: number }): { x: number; y: number } {
  return camWorldToScreen(p, cam, insets(), mapBounds());
}
/** Дальность карты в пикселях — ЕДИНСТВЕННЫЙ перевод на весь рендер (`mapRadius.ts`,
 *  REFM-132). Там же причина, почему множитель — подгон карты под экран × зум камеры:
 *  взять один зум (как когда-то) значит рисовать круг меньше настоящей дальности. */
function worldDist(d: number): number {
  return screenRadius(d, mapScale(camFitTransform(insets(), mapBounds()).scale, cam.scale));
}
function visible(c: { x: number; y: number }, pad = 80): boolean {
  return c.x >= -pad && c.x <= VW + pad && c.y >= -pad && c.y <= VH + pad;
}
/** Extra pan slack while the selection panel (#side) covers the play area: let the
 *  camera overshoot the map border by the covered strip, so worlds hidden behind the
 *  open panel can be dragged into the clear part of the screen. The panel is a
 *  full-width bottom sheet on phones (→ slack below) and a right-hand column on wide
 *  screens (→ slack on the right); measure its live rect so both layouts just work. */
function panelSlack(): { right?: number; bottom?: number } {
  const el = typeof document !== 'undefined' ? document.getElementById('side') : null;
  const open = el && getComputedStyle(el).display !== 'none';
  // The arithmetic (which side is covered, and by how much) is `panelSlack.ts`
  // (REFM-54); measuring the live element stays here.
  return panelSlackFor(open ? el.getBoundingClientRect() : null, VW, VH);
}

function zoomAt(fx: number, fy: number, factor: number) {
  // Zoom anchored on the focal point (cursor / pinch centre) — camera.ts clamps scale + pan.
  const n = camZoomAt(cam, fx, fy, factor, insets(), mapBounds(), panelSlack());
  cam.scale = n.scale;
  cam.x = n.x;
  cam.y = n.y;
}

/** Keep the map filling the play area with SLACK at the edges (module: PAN_SLACK) so the
 *  outermost provinces don't jam against the border. Delegates to the shared camera;
 *  an open panel widens the range (panelSlack) so it never traps the view. */
function clampCam(): void {
  const n = camClampCam(cam, insets(), mapBounds(), panelSlack());
  cam.x = n.x;
  cam.y = n.y;
}

/** Put map-point `p` at the centre of the play area at `scale` (clamped + bounded). */
function centerOn(p: { x: number; y: number }, scale: number): void {
  const n = camCenterOn(cam, p, scale, insets(), mapBounds(), panelSlack());
  cam.scale = n.scale;
  cam.x = n.x;
  cam.y = n.y;
}
/** The opening / reset view. On a phone the wide map is too dense to read whole, so
 *  zoom onto your home region and pan to explore; on a wide screen the whole-map fit
 *  reads fine. The zoom is RELATIVE to the screen-fit, so it autoscales across screens. */
function defaultView(): void {
  // Кого считать домом и когда приближаться к нему — `openingView.ts` (REFM-56).
  const view = openingView(MOBILE, pickHome(Object.values(s.planets), ME));
  if (view.kind === 'home') {
    centerOn(view.at, view.scale);
    return;
  }
  cam.scale = 1;
  cam.x = 0;
  cam.y = 0;
  clampCam();
}
// Re-validate the camera after a real resize (orientation / window). Attached after
// `cam` exists so the initial in-module resize() call never touches it (TDZ-safe).
if (typeof window !== 'undefined') window.addEventListener('resize', () => clampCam());

// --- helpers -----------------------------------------------------------------

const planet = (id: string | null | undefined): Planet | undefined =>
  id ? s.planets[id] : undefined;
// Squadrons/carriers are their own build category (air wing): a carrier (◈) ferries the
// fighter squadrons (△) it launches, so both live under the Wings tab — apart from line
// spacecraft (which stay under Ships).
// Само правило деления по домену живёт в `planetSummary.ts` (REFM-38) — одно место,
// где «крыло» отделено от корабля линии, иначе авианосец считается дважды.
const isSquadron = (u: string) => isWingUnit(u, data);
const isGround = (u: string) => isGroundUnit(u, data);
const floor = Math.floor;
/** Compact number like Iron Order's bar: 15.7k, 728, … */

// Returns HTML (resource-tinted tokens) — callers feed innerHTML, don't esc() this.
/** Та же цена ПЛОСКИМ текстом — для мест, где подпись уходит через `esc()`
 *  (`btn()`, `codexTile()`): там HTML из `cost()` показался бы игроку как разметка. */
/** Казна текущего игрока — то самое `have`, которым cost() красит нехватку. */
function myRes(): Record<string, number> {
  return s.players[ME]?.resources ?? {};
}
function afford(bag: Record<string, number> | undefined): boolean {
  return coreAfford(myRes(), bag);
}
/** Локальная (офлайновая) очередь стройки этого мира — ядру она неизвестна: в сети
 *  стройку таймит сервер. Создаётся по первому обращению. */
function queueOf(planetId: string): PlanetBuildQueue {
  return (buildQueues[planetId] ??= emptyQueue());
}
/** Цена головы очереди — ДЛЯ ПОКАЗА (строка «⏳ ждём: …»); правила масштаба и смещения
 *  уровней живут в `buildOrders.ts` (REFM-32). */
function buildCost(planetId: string, q: QueuedBuild): Record<string, number> | undefined {
  return queuedCost(s, data, planetId, q);
}
/** Приказ, которым голова очереди уедет в ядро. */
function queuedAction(planetId: string, q: QueuedBuild): Action {
  return coreQueuedAction(ME, planetId, q);
}
/**
 * RULES-4. Пора ли пускать голову очереди — ВЕРДИКТ ЯДРА, а не свой прайс-лист.
 *
 * Очередь умеет ждать ровно одно — деньги, поэтому единственный код, на котором она
 * держит голову, это `E_INSUFFICIENT`. Любой другой отказ ожиданием не лечится (или
 * лечится не очередью), и голова уезжает в ядро, где игрок получает НАСТОЯЩУЮ причину
 * (`queue.failed` печатает `errText(код)`) вместо молчаливого зависания.
 *
 * Что это чинит. Прежний `afford(buildCost(...))` был FAIL-OPEN против инварианта #4:
 * `buildCost` возвращал `undefined` для неизвестного id и для уже максимального
 * уровня, а `afford(undefined)` — `true`, то есть очередь считала голову «готовой» и
 * дёргала ядро. Плюс он переписывал прайс ядра целиком и мимо него проходили и
 * масштаб на `count`, и все неденежные ворота (`E_BOMBARDED`, `E_WRONG_SECTOR`,
 * `E_NO_SHIPYARD`, `E_MAX_LEVEL`) — очередь считала «можно», ядро отбивало.
 */
function canStartQueued(planetId: string, q: QueuedBuild): boolean {
  return !waitsForMoney(canOrder(s, queuedAction(planetId, q)));
}
/** Стройка, идущая на мире прямо сейчас (голову по `(at, seq)` выбирает
 *  `buildProgress.ts`, REFM-31 — там же и правило порядка). */
function activeConstruction(planetId: string, lane: BuildLane): ActiveBuild | null {
  return coreActiveConstruction(s, planetId, lane);
}
function constructionLabel(p: ConstructionPayload): string {
  if (p.kind === 'unit' && p.unit) {
    return `${p.count ?? 1}× ${unitIcon(p.unit, data)} ${displayUnit(p.unit)}`;
  }
  if (p.kind === 'upgrade' && p.building) {
    return `${BUILD_ICON[p.building] ?? '▣'} ${tData(data.buildings[p.building]?.name ?? p.building)} → L${p.level ?? '?'}`;
  }
  if (p.building) {
    return `${BUILD_ICON[p.building] ?? '▣'} ${tData(data.buildings[p.building]?.name ?? p.building)}`;
  }
  return t('queue.unknown');
}
function buildDurationHours(p: ConstructionPayload): number {
  return coreBuildDurationHours(p, data);
}
function timeLeft(at: number): string {
  return fmtEta(hoursLeft(at, s.time, HOUR));
}
/** Format a travel-time-remaining in hours as `1.4ч` / `35м` (localized suffixes). */
function progressPct(active: ActiveBuild): number {
  return coreProgressPct(active, s.time, data, HOUR);
}
function queuedLabel(q: QueuedBuild): string {
  if (q.kind === 'unit') {
    // PC: icon·count chips (like the garrison tiles) — the hover dossier names the
    // unit. Mobile keeps the full name.
    if (pcUi()) return `${unitIcon(q.id, data)} ${q.count}`;
    return `${q.count}× ${unitIcon(q.id, data)} ${displayUnit(q.id)}`;
  }
  if (q.kind === 'upgrade') {
    return t('queue.upgrade', {
      b: `${BUILD_ICON[q.id] ?? '▣'} ${tData(data.buildings[q.id]?.name ?? q.id)}`,
    });
  }
  return `${BUILD_ICON[q.id] ?? '▣'} ${tData(data.buildings[q.id]?.name ?? q.id)}`;
}
function enqueueBuild(planetId: string, order: QueuedBuild): void {
  // Одна точка опоры против дубля одноэкземплярного здания: плитка, кодекс и любой
  // будущий вход проходят здесь, и серые плитки остаются чистой косметикой.
  if (order.kind === 'building' && buildingLocked(planetId, order.id)) {
    note('✖ ' + errText(buildingLocked(planetId, order.id) === 'built' ? 'E_ALREADY_BUILT' : 'E_ALREADY_QUEUED'));
    return;
  }
  if (NET) {
    // No local build queue in net mode — the server times construction. Send the
    // order straight away (one tap = one build queued server-side).
    const action =
      order.kind === 'unit'
        ? buildUnit(ME, planetId, order.id, order.count)
        : order.kind === 'upgrade'
          ? upgradeBuilding(ME, planetId, order.id)
          : buildBuilding(ME, planetId, order.id);
    playerOrder(action);
    return;
  }
  queueOf(planetId)[laneOf(order.kind)].push(order);
  note(t('queue.added', { what: queuedLabel(order), at: planetId }));
  pumpBuildQueues();
}
function submitQueued(planetId: string, queued: QueuedBuild): StepOut {
  const action = queuedAction(planetId, queued);
  const before = sandboxBuildSnapshot(action.type);
  const out = order(s, action, s.time);
  apply(out);
  sandboxBuildRestore(before, !out.error);
  if (!out.error) activeTour?.notifyAction(action.type); // local build queue bypasses playerOrder
  return out;
}
// A rally fleet keeps swallowing freshly-built ships only while its world still has
// a ship in the pipeline (one building, or one queued). The moment the queue drains,
// the fleet is "closed" (loses its 'rally' tag) so the NEXT order opens a fresh fleet
// — ships only pool together if you queue the next batch before the current one finishes.
// Single-player only: in net mode the server owns the fleets and their tags.
function closeIdleRallies(): void {
  for (const f of Object.values(s.fleets)) {
    if (f.owner !== ME || !f.location || f.movement || !f.traits?.includes('rally')) continue;
    const pending =
      !!activeConstruction(f.location, 'units') || (buildQueues[f.location]?.units.length ?? 0) > 0;
    if (!pending) f.traits = f.traits.filter((t) => t !== 'rally');
  }
}
function pumpBuildQueues(): void {
  for (const planetId of Object.keys(buildQueues)) {
    const q = buildQueues[planetId];
    const p = s.planets[planetId];
    if (!q || !p || p.owner !== ME) {
      continue;
    }
    for (const lane of ['buildings', 'units'] as const) {
      const next = q[lane][0];
      if (!next || activeConstruction(planetId, lane) || !canStartQueued(planetId, next)) {
        continue;
      }
      q[lane].shift();
      const r = submitQueued(planetId, next);
      if (r.error) {
        note(t('queue.failed', { what: queuedLabel(next), err: errText(r.error) }));
      }
    }
  }
}
function fleetPos(f: Fleet): { x: number; y: number } | null {
  // Free-space movement (squadrons / missiles): position is interpolated from
  // freePosition toward (targetX, targetY) — a straight line in space, not a lane.
  if (f.freeMovement) {
    const from = f.freePosition;
    if (!from) return null;
    const fm = f.freeMovement;
    const prog = Math.min(1, Math.max(0, (s.time - fm.departedAt) / (fm.arrivesAt - fm.departedAt)));
    return {
      x: from.x + (fm.targetX - from.x) * prog,
      y: from.y + (fm.targetY - from.y) * prog,
    };
  }
  if (f.freePosition) return f.freePosition;
  if (f.location) return s.planets[f.location]?.position ?? null;
  // Parked at a continuous point ON a lane (stopped mid-march / marched to a point).
  if (f.edge) {
    const a = s.planets[f.edge.from]?.position;
    const b = s.planets[f.edge.to]?.position;
    if (!a || !b) return null;
    return { x: a.x + (b.x - a.x) * f.edge.t, y: a.y + (b.y - a.y) * f.edge.t };
  }
  const m = f.movement;
  if (!m) return null;
  const a = s.planets[m.from]?.position;
  const b = s.planets[m.to]?.position;
  if (!a || !b) return null;
  // The leg only covers the sub-segment [startT, endT] of the lane (a partial leg
  // out of / into a parked position), so interpolate within those bounds.
  const s0 = m.startT ?? 0;
  const e0 = m.endT ?? 1;
  const prog = Math.min(1, Math.max(0, (s.time - m.departedAt) / (m.arrivesAt - m.departedAt)));
  const t = s0 + (e0 - s0) * prog;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
/** Where to draw a battle: the position of a fleet engaged in it (so a mid-lane
 *  intercept renders at the crossing point, not the nearest node), falling back to
 *  the battle's node when no participant is in view. */
function battleAnchor(b: Battle): { x: number; y: number } | null {
  // Точка схватки — у ВОЮЮЩЕГО флота, и только если её нет — узел (`battleMark.ts`,
  // REFM-118): перехват идёт там, где корабли встретились, а не в ближайшем мире.
  const fighting = Object.values(s.fleets)
    .filter((f) => f.battleId === b.id)
    .map((f) => fleetPos(f));
  return clashPoint(fighting, s.planets[b.location]?.position ?? null);
}

/** The fleets the command bar / move order currently act on (mine only). */
function selectedFleetIds(): string[] {
  if (selFleets.size) return [...selFleets].filter((id) => s.fleets[id]?.owner === ME);
  return selFleet && s.fleets[selFleet]?.owner === ME ? [selFleet] : [];
}

/** Does this fleet carry artillery (units that fire at range — the `fleet.barrage`
 *  / standoff-fire mechanic applies)? */
function fleetHasArtillery(f: Fleet | undefined): boolean {
  return (
    !!f &&
    f.units.some((u) => u.count > 0 && (data.units[u.unit]?.traits.includes('artillery') ?? false))
  );
}

/** Can the fleet launch its squadrons right now? `fleet.split` refuses to take the whole
 *  stack (E_SPLIT_ALL) and only works on a stationary fleet (E_IN_TRANSIT / E_IN_BATTLE),
 *  so the launch is offered only when a non-squadron ship stays behind and the carrier is
 *  parked and out of combat (squadrons-roadmap SQ-1.1). */
function fleetCanLaunchSquadron(f: Fleet | undefined): boolean {
  if (!fleetHasSquadron(f) || f!.movement || !f!.location || f!.battleId) return false;
  const total = f!.units.reduce((n, u) => n + u.count, 0);
  const wing = squadronTake(f!).reduce((n, u) => n + u.count, 0);
  return wing > 0 && total > wing;
}

/** Division ⇄ hold transport for a docked fleet `f` over world `here`: load the
 *  player's garrisoning divisions (if they fit the free hold) and unload the ones it
 *  carries (onto an enemy world = a landing). Empty string when there's nothing to do. */

// Порог открытия слоя, раздутие радиуса, потолок по соседу и веер слотов — правила
// `orbitRing.ts` (REFM-94); здесь остаётся только замер зазора на экране.
let orbitPhase = 0; // accumulated sim-time ms (frozen on pause) — drives the orbit spin
/** Ring/animation are gated on the same close-zoom threshold. */
function orbitsLive(): boolean {
  return ringsLive(cam.scale);
}
/** Orbit-ring radius for a planet at the current zoom, in screen px. The ring blooms with
 *  zoom but is capped to a fraction of the on-screen gap to the nearest LINKED neighbour,
 *  so it never spills onto the adjacent sectors. Fleets sit on this same radius (so a
 *  chevron never floats off the ring). */
function orbitRingRadius(pl: { position: { x: number; y: number }; links?: string[] }): number {
  const pc = world(pl.position);
  let nearest = Infinity;
  for (const nb of pl.links ?? []) {
    const np = s.planets[nb];
    if (!np) continue;
    const npc = world(np.position);
    nearest = Math.min(nearest, Math.hypot(npc.x - pc.x, npc.y - pc.y));
  }
  return orbitRadius(orbitBloom(cam.scale), nearest);
}
/** Angular position (radians) of a stationed fleet's orbit slot at index `idx` of
 *  `nPeers` sharing the ring — fanned out, and spinning when zoomed in close. */
function orbitAngle(idx: number, nPeers: number): number {
  return slotAngle(idx, nPeers, orbitPhase, orbitsLive());
}

/** Screen anchor (+ heading) for a fleet's chevron: the interpolated lane
 *  position while moving, or a slot on the orbit ring while stationed
 *  (fleets sharing the ring are fanned out so they don't overlap). */
function fleetAnchor(f: Fleet): { x: number; y: number; ang: number } | null {
  if (f.movement || !f.location) {
    const mp = fleetPos(f);
    if (!mp) return null;
    const c = world(mp);
    let ang = -Math.PI / 2;
    const lane = f.movement ?? f.edge; // heading = along the lane it is on
    if (lane) {
      const a = s.planets[lane.from]?.position;
      const b = s.planets[lane.to]?.position;
      if (a && b) {
        const wa = world(a);
        const wb = world(b);
        ang = Math.atan2(wb.y - wa.y, wb.x - wa.x);
      }
    }
    return { x: c.x, y: c.y, ang };
  }
  const pl = s.planets[f.location];
  if (!pl) return null;
  const pc = world(pl.position);
  // a single orbit: every stationed (non-transit) fleet here shares the one ring
  const peers = Object.values(s.fleets).filter((g) => g.location === f.location && !g.movement);
  const idx = Math.max(
    0,
    peers.findIndex((g) => g.id === f.id),
  );
  const a0 = orbitAngle(idx, peers.length);
  const r = orbitRingRadius(pl);
  // when circling, the chevron faces along its travel (tangent); static = radial as before
  const ang = chevronAngle(a0, orbitsLive());
  return { x: pc.x + Math.cos(a0) * r, y: pc.y + Math.sin(a0) * r, ang };
}
// ONB-5: a structured, bounded mirror of the event log — feeds the return digest.
const eventLog: RecapEvent[] = [];
let lastNoteMsg = '';
let lastNoteAtMs = 0;
/** Append a line to the session log (bounded). Patches the feed if it's on screen. */
function note(msg: string, at?: string) {
  // Защита от повторов, метка времени и пределы лент — `noteLog.ts` (REFM-101):
  // повтор глушится по РЕАЛЬНОМУ времени, а метка ставится ИГРОВОЕ.
  const nowMs = Date.now();
  if (isRepeat(msg, lastNoteMsg, nowMs, lastNoteAtMs)) return;
  lastNoteMsg = msg;
  lastNoteAtMs = nowMs;
  pushBounded(logLines, `${stamp(s.time, DAY, HOUR)} · ${msg}`, LOG_LINES);
  pushBounded(eventLog, { at: s.time, text: msg, anchor: at }, EVENT_LOG_MAX);
  toast(msg, at);
}

/** Transient event toast over the map — feedback must not live only in a hidden
 *  log window. Tap dismisses; with a map anchor the tap also flies the camera
 *  there (the jumpToPing path). At most 3 stacked, ~5s life each. */
function toast(msg: string, at?: string): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  // Вид, предел стопки и время жизни — `toastView.ts` (REFM-105).
  const el = document.createElement('div');
  el.className = toastClass(!!at);
  el.textContent = toastText(msg, !!at);
  el.addEventListener('click', () => {
    if (at) jumpToPing(at);
    el.remove();
  });
  host.appendChild(el);
  for (let extra = toastOverflow(host.children.length); extra > 0; extra--)
    host.firstElementChild?.remove();
  window.setTimeout(() => {
    el.classList.add('out');
    window.setTimeout(() => el.remove(), TOAST_FADE_MS);
  }, TOAST_LIFE_MS);
}

/** The map node a fleet occupies / is travelling over / is parked nearest to. */
function fleetNode(f: Fleet): string | null {
  if (f.location) return f.location;
  if (f.movement) {
    // The node the ship is NEAREST to right now — tracks it along the leg, not the
    // destination (so its radar/identify anchor follows the fleet).
    const m = f.movement;
    const span = m.arrivesAt - m.departedAt;
    const prog = span > 0 ? Math.min(1, Math.max(0, (s.time - m.departedAt) / span)) : 1;
    const s0 = m.startT ?? 0;
    const t = s0 + ((m.endT ?? 1) - s0) * prog;
    return t <= 0.5 ? m.from : m.to;
  }
  if (f.edge) return f.edge.t <= 0.5 ? f.edge.from : f.edge.to;
  return null;
}

/** The closest point ON a lane to a screen point: which lane (`from`,`to`), the
 *  fraction `t` along it and its screen position — or null if none within `maxPx`.
 *  Lets the player march an army to any point on a road (Bytro continuous order). */
function nearestLanePoint(
  mx: number,
  my: number,
  maxPx = 14,
): { from: string; to: string; t: number; x: number; y: number } | null {
  // Перечень трасс — `lanes()` (`setupMap.ts`, правило 7): «каждая трасса ровно один
  // раз» здесь стояло СВОЕЙ копией сравнения идентификаторов, третьей в файле после
  // мини-карты и печати статического слоя. Разъедься копии — и игрок целился бы в
  // дорогу, которой в списке заказа нет: нарисована, а марш на неё не встаёт.
  // Узлы сразу в ЭКРАННЫХ координатах: попадание пальца считается там же, где палец.
  const nodes = Object.values(s.planets).map((p) => ({
    id: p.id,
    ...world(p.position),
    links: p.links ?? [],
  }));
  // Прижатие к отрезку и выбор ближайшей трассы — `pointerPick.ts` (REFM-128).
  const hit = nearestSegment(lanes(nodes), (l) => ({ a: l.from, b: l.to }), mx, my, maxPx);
  if (!hit) return null;
  return { from: hit.seg.from.id, to: hit.seg.to.id, t: hit.at.t, x: hit.at.x, y: hit.at.y };
}

/** For a march to a lane point: which endpoint the fleet routes through and the
 *  total ETA (node route + the partial leg into the lane), mirroring the kernel's
 *  cheaper-end choice. Used only for the move preview. */
function laneAim(
  f: Fleet,
  from: string,
  lane: { from: string; to: string; t: number },
): { endId: string; hrs: number } {
  const speed = fleetBaseSpeed(f, data) || 1;
  const a = s.planets[lane.from]?.position;
  const b = s.planets[lane.to]?.position;
  const len = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  const toNode = (to: string): number =>
    from === to ? 0 : (estimateTravelHours(s, data, from, to, f) ?? Infinity);
  const hFrom = toNode(lane.from) + (len * lane.t) / speed; // reach `from`, then advance t
  const hTo = toNode(lane.to) + (len * (1 - lane.t)) / speed; // reach `to`, then back (1-t)
  return hFrom <= hTo ? { endId: lane.from, hrs: hFrom } : { endId: lane.to, hrs: hTo };
}

// --- radar / signatures ------------------------------------------------------
// Radar reach + per-unit "loudness" are DATA, read straight from the content
// (`data.buildings[t].radarRange`, `data.units[u].radarRange`/`signature`) — the
// SAME source the core fog (`visibility.ts`) reads, so single-player and the
// networked view agree by construction, with no mirrored constants to drift. The
// reach values themselves (and why a radar must clear your border to the next ring
// of worlds to yield any signature) are tuned in the content, next to the data.
// A radar projects two concentric ranges: signatures out to its full reach, and
// full identification within the inner half (mirrors shared-core visibility).
const IDENTIFY_REACH_FRACTION = 0.5;

/** Total radar signature of a fleet = Σ count × per-unit signature (from content). */
function fleetSignature(f: Fleet): number {
  let sig = 0;
  for (const st of f.units) sig += st.count * (data.units[st.unit]?.signature ?? 1);
  return sig;
}
/** Coarse size bucket shown for a radar contact (reuses the count-label idea). */
function sigClass(sig: number): 'S' | 'M' | 'L' {
  return sig >= 13 ? 'L' : sig >= 5 ? 'M' : 'S';
}
/** Radar reach (distance) a fleet projects, from its loudest radar-ship (0 = none).
 *  Тонкая обёртка над ЯДРОВЫМ `fleetRadarRange` — не своя копия правила: когда копия
 *  тут читала только `data.units[u].radarRange`, установленный радар-модуль на карте
 *  не считался, хотя игрок за него платил. */
function fleetRadar(f: Fleet): number {
  return fleetRadarRange(f, data);
}
/** Radar reach (distance) a world projects, from its best radar array (grows with
 *  level). Reads `buildingLevel(def, level).radarRange` — same field the core fog uses. */
function planetRadar(p: Planet): number {
  let r = 0;
  for (const b of p.buildings) {
    const def = data.buildings[b.type];
    if (def) r = Math.max(r, buildingLevel(def, b.level).radarRange);
  }
  return r;
}
interface Vision {
  identify: Set<string>;
  radar: Set<string>;
}

// --- espionage (SPY-1 in the prototype) ---------------------------------------
// The core `espionageModule` grants time-boxed intel windows (`state.intel[ME]`);
// here the client fog honours them: a `planet` grant identifies that node, a
// `fleets` grant shows the target's fleets through the fog, a `treasury` grant is
// read by the diplomacy roster. Mirrors what `visibleState` does server-side.
// Окна краденой разведки и журнал шпионажа живут в `intel.ts` (REFM-28) — там же
// правила «истёкшее окно не видно» и «опознание влечёт радар».
/** Мои ЖИВЫЕ окна разведки на текущий час мира. */
function myIntel(): IntelGrant[] {
  return liveGrants(s.intel?.[ME], s.time);
}
// Владельцы, чьи флоты этот кадр показаны живым окном `fleets` — набор пересобирается
// вместе с `vision`, чтобы отрисовка проверяла Set, а не список грантов.
let intelFleetOwners = new Set<string>();
// SPY-UX: сессионный журнал исходов шпионажа (моих и контрразведки по мне) — питает
// вкладку «Шпионаж» в дипломатии. Хранит уже локализованную строку.
const spyLog: SpyEntry[] = [];
function pushSpyLog(text: string): void {
  pushSpyEntry(spyLog, { at: s.time, text });
  if (diploOpen && diploTab === 'intel') renderDiplo();
}

/** Variant-B visibility: an identify range (full detail, feeds memory) plus a
 *  wider radar range (enemy fleets seen only as coarse signatures). The radar
 *  reach scales with radar-array level and radar-ships. null vision = fog off. */
/**
 * RULES-5 — туман карты СПРАШИВАЕТСЯ у ядра, а не выводится заново.
 *
 * Здесь стояла рукописная копия `sensorCoverage`: те же обходы своих миров и флотов,
 * те же два кольца (сигнатуры снаружи, опознание внутри). Копия была БЕДНЕЕ оригинала
 * ровно на три правила, и каждое — живое:
 *
 *  · множитель радара от технологий и пассивки фракции (`radarRangeBonus`) копия не
 *    знала вовсе — исследованная дальность расширяла тревоги, но не карту, на которую
 *    игрок смотрит;
 *  · блок зрения (союз + договор об обмене картами) не сводился — разведка союзника
 *    приходила в состояние, но рисовалась туманом;
 *  · активные «сканы» героя (`activeReveals`) карту не подсвечивали.
 *
 * Расхождение было доказуемо на одном экране: ЭТОТ ЖЕ файл уже звал ядро за туманом для
 * тревог (`identifiedNodes` в `updateThreatAlerts`), то есть тревога могла сообщить об
 * угрозе в мире, который карта рядом рисовала неопознанным.
 *
 * Клиентского здесь осталось только то, чего у ядра в этой точке и нет: окна краденой
 * разведки. У ядра они живут в ПРОЕКЦИИ (`visibleState`), которую соло-режим не гоняет —
 * он считает туман сам, по полному состоянию.
 */
function computeVision(): Vision {
  const { identify, radar } = sensorCoverage(s, ME, data);
  // Stolen `planet` windows identify their node (feeds memory too, so the scan
  // is remembered after the window closes); `fleets` windows fill the owner set
  // that fleet rendering consults.
  const grants = myIntel();
  grantVision({ identify, radar }, targetsOf(grants, 'planet'), (id) => !!s.planets[id]);
  intelFleetOwners = targetsOf(grants, 'fleets');
  return { identify, radar };
}

/** Is this fleet visible? Own always; enemy — when its node is identified OR a
 *  live `fleets` intel window covers its owner. */
function fleetSeen(f: Fleet): boolean {
  // Правила 5–7 «видимости под туманом» — `fogView.ts` (REFM-103), там же, где мир.
  return fleetVisible(f.owner === ME, known(fleetNode(f)), intelFleetOwners.has(f.owner));
}

// Per-viewer MEMORY of the last identified state of a node (variant B): once you
// have seen a system, you remember its last-known state (greyed) when sight lifts.
// Само хранилище и правила снимка — в `scanMemory.ts` (REFM-43): пишутся только
// ОПОЗНАННЫЕ узлы (радар состава не выдаёт), снимок — копия, а не ссылка на живой
// мир, и память принадлежит матчу.
const memory = createScanMemory();
function updateMemory(identify: Set<string>): void {
  memory.remember(identify, s.planets);
}

/** True if node `id` is identified (full detail); fog off ⇒ always true. */
function known(id: string | null | undefined): boolean {
  return !vision || (id != null && vision.identify.has(id));
}
/** RECAP-FOG: пускать ли событие в журнал (а значит, и в сводку). Правило живёт
 *  чистой функцией в `recapGate.ts` — это правило безопасности, и гейт проверяет
 *  именно его, а не рукописный `if` внутри свитча. */
function admits(type: string, p: Record<string, unknown>): boolean {
  return recapAdmits(type, p.owner as string | undefined, ME, known(p.planetId as string));
}
/** True if node `id` is inside radar reach (signature-level detection). */
function radarHas(id: string | null | undefined): boolean {
  return !!vision && id != null && vision.radar.has(id);
}
/** Fog gate: «этот мир игроку вообще видно в деталях?» — опознан или свой.
 *  Правило живёт ОДНОЙ функцией в `fogView.ts` (REFM-62): оно нужно и панели, и
 *  отрисовке радиусов, а когда было выписано дважды, второе место про него забыло —
 *  тап по неисследованной системе рисовал её радарные окружности с подписями, выдавая
 *  и владельца, и наличие радара, и его радиус, пока панель писала «нет телеметрии». */
function seesDetails(p: Planet): boolean {
  return fogSeesDetails({ identified: known(p.id), mine: p.owner === ME });
}

/** Draw a fogged system: a greyed last-known blip from memory, or an unexplored
 *  marker if it has never been identified. */
function drawFogMarker(c: { x: number; y: number }, id: string, mem: Snapshot | undefined): void {
  cx.save();
  if (mem) {
    const col = ownerColor(mem.owner);
    cx.setLineDash([2, 4]);
    cx.strokeStyle = rgba(col, 0.34);
    cx.lineWidth = 1;
    cx.beginPath();
    cx.arc(c.x, c.y, 9, 0, TAU);
    cx.stroke();
    cx.setLineDash([]);
    cx.fillStyle = rgba(col, 0.4);
    cx.beginPath();
    cx.arc(c.x, c.y, 1.6, 0, TAU);
    cx.fill();
    cx.textAlign = 'left';
    cx.fillStyle = rgba(col, 0.5);
    cx.font = '700 11px ui-monospace,Menlo,monospace';
    cx.fillText(id, c.x + 13, c.y - 1);
    cx.fillStyle = 'rgba(120,140,150,0.45)';
    cx.font = '9px ui-monospace,Menlo,monospace';
    const icons = mem.buildings.map((b) => BUILD_ICON[b.type] ?? '▪').join('');
    cx.fillText(`G:${mem.garrison} ${icons} ✦last`, c.x + 13, c.y + 10);
  } else {
    cx.strokeStyle = 'rgba(90,110,120,0.3)';
    cx.lineWidth = 1;
    cx.beginPath();
    cx.arc(c.x, c.y, 6, 0, TAU);
    cx.stroke();
    cx.fillStyle = 'rgba(90,110,120,0.4)';
    cx.font = '9px ui-monospace,Menlo,monospace';
    cx.textAlign = 'center';
    cx.fillText('?', c.x, c.y + 3);
  }
  cx.restore();
}

/** Draw a coarse amber signature blip (size bucket S/M/L) at a screen point, no
 *  identity. `fade` (0..1) dims it — radar contacts are painted by the sweep and
 *  fade between passes (see drawRadarContacts). */
function drawSignatureAt(
  pos: { x: number; y: number },
  cls: 'S' | 'M' | 'L',
  fade: number,
  now: number,
): void {
  const r = cls === 'L' ? 9 : cls === 'M' ? 7 : 5;
  // Дыхание слоя — `pulseFx.ts` (REFM-137): фаза от места контакта, иначе все метки
  // мигают в такт и читаются как один щёлкающий слой.
  const pulse = breath(now, { period: 200, base: 0.5, amp: 0.5, phase: pos.x * 0.05 });
  cx.save();
  cx.translate(pos.x, pos.y);
  cx.strokeStyle = rgba('#ffb43a', (0.5 + 0.3 * pulse) * fade); // amber = unidentified contact
  cx.fillStyle = rgba('#ffb43a', (0.1 + 0.08 * pulse) * fade);
  cx.lineWidth = 1.3;
  cx.beginPath(); // diamond
  cx.moveTo(0, -r);
  cx.lineTo(r, 0);
  cx.lineTo(0, r);
  cx.lineTo(-r, 0);
  cx.closePath();
  cx.fill();
  cx.stroke();
  cx.fillStyle = rgba('#ffd98a', 0.92 * fade);
  cx.font = '700 9px ui-monospace,Menlo,monospace';
  cx.textAlign = 'center';
  cx.fillText('◆' + cls, 0, r + 12);
  cx.restore();
}
// SANDBOX — fenced hook. In a sandboxed solo match with "free build" on, a build
// order's resource spend is refunded. `order()` advances to `s.time` first (a no-op,
// so no production/upkeep runs), leaving the paid cost as the only resource change —
// snapshotting the treasury before and restoring it after makes the build free.
// Leading `__PLAYER_BUILD__` guard keeps the sandbox tree-shaken from the player bundle.
function sandboxBuildSnapshot(type: string): Record<string, number> | null {
  // Когда песочница возвращает ресурсы — `freeBuild.ts` (REFM-104).
  const armed = snapshotWallet(
    __PLAYER_BUILD__,
    sandboxConfig.enabled,
    sandboxConfig.freeBuild,
    isBuildAction(type),
  );
  return armed ? { ...(s.players[ME]?.resources ?? {}) } : null;
}
function sandboxBuildRestore(snap: Record<string, number> | null, ok: boolean): void {
  const me = s.players[ME];
  if (me && restoresWallet(!!snap, ok)) me.resources = snap!;
}

function apply(out: StepOut) {
  s = out.state;
  // Что теряет силу вместе с флотом — `selectionPrune.ts` (REFM-102): одиночная ссылка
  // спрашивает только «существует ли», а группа чистится дважды — живые И свои.
  const alive = (id: string): boolean => !!s.fleets[id];
  if (!refSurvives(selFleet, alive)) selFleet = null;
  if (splitState && !refSurvives(splitState.fleetId, alive)) splitState = null;
  if (troopsPlan && !refSurvives(troopsPlan.fleetId, alive)) troopsPlan = null; // ⇅-меню тоже
  // Режим «Приказ»: пропавшие флоты выбрасываются покадрово в renderChainBar; здесь
  // достаточно ничего не делать — режим сам гаснет, когда fleetIds опустеет.
  selFleets = pruneGroup(selFleets, (id) => s.fleets[id]?.owner, ME);
  handleEvents(out.events);
}

// A space fortress comes with a fixed orbital-AA emplacement (prototype scenario rule).
// It's a building now: its AA fires on near-orbit attackers, but it does NOT make the
// junction "defended" against a walk-in — only ground troops block ground capture.
function installFortressAA(planetId: string) {
  const pl = s.planets[planetId];
  if (!pl) return;
  if (pl.buildings.some((b) => b.type === 'orbital_aa')) return; // already emplaced
  pl.buildings.push({ type: 'orbital_aa', level: 1, hp: data.buildings.orbital_aa?.hp ?? 30 });
}

/** Apply a player-issued order and surface a rejection in the log (so a denied
 *  click — wrong orbit, no capacity, can't afford — isn't silently swallowed). */
// Kernel rejection codes → a human phrase. The key is DERIVED from the code
// (E_NO_CAPACITY → err.no-capacity), so a new code needs only an entry in
// /localization — there is no table here to forget to update. An unlisted code
// degrades to the de-mangled code itself rather than showing a raw key.
function errText(code: string): string {
  const bare = code.replace(/^E_/, '').toLowerCase();
  const key = `err.${bare.replace(/_/g, '-')}`;
  return hasKey(key) ? t(key) : bare.replace(/_/g, ' ');
}
function playerOrder(action: Action): boolean {
  // Возврат — «приказ не ОТВЕРГНУТ сейчас»: в соло это честный исход редьюсера,
  // в сети и при реконнекте — true (исход асинхронный). Нужен покадровым циклам
  // (resolvePendingMerges), чтобы выбрасывать отвергнутый приказ, а не пережимать
  // его каждый кадр — бесконечные тосты отказа (живой плейтест).
  // Куда уходит приказ — `orderRoute.ts` (REFM-147): в сети клиент шлёт НАМЕРЕНИЕ и не
  // трогает локальный редьюсер (иначе следующий снимок сотрёт «принятый» приказ), при
  // оборванной связи приказ честно отвергается (сервер о нём не узнает), а обучение
  // учится в сети на намерении, в соло — только на принятом приказе.
  const plan = orderPlan({ net: NET, hasClient: !!netClient, reconnecting });
  if (plan.route === 'send') {
    netClient?.sendAction(action); // server is authoritative — await its broadcast
    if (plan.tour === 'now') activeTour?.notifyAction(action.type); // ответ сервера асинхронен
    return true;
  }
  if (plan.route === 'refuse') {
    note('⟳ ' + t('net.reconnecting-order'));
    return true;
  }
  const before = sandboxBuildSnapshot(action.type);
  const out = order(s, action, s.time);
  apply(out);
  sandboxBuildRestore(before, !out.error);
  if (out.error) {
    snd.play('error'); // тёмный сбой — отказ слышен, не только виден
    note('✖ ' + errText(out.error));
    return false;
  }
  else {
    // an accepted intent advances `action` steps
    if (plan.tour === 'on-accept') activeTour?.notifyAction(action.type);
    // Какой ПРИНЯТЫЙ приказ какую вставку поднимает и почему во время тура молчат все —
    // `introTrigger.ts` (REFM-100).
    const intro = introFor(action.type, !!activeTour?.active);
    if (intro) maybeIntro(intro);
  }
  return true;
}

// --- ONB-1 guide-mark launcher ------------------------------------------------
// One tour at a time; `playerOrder` above notifies it of accepted actions so a
// step's `advance: { on: 'action' }` fires on the real order. Exposed on `window`
// as the reusable seam ONB-0/ONB-2 (auto-offer, «Ещё → Обучение») and headless
// e2e drive — starting a HUD tour needs an active match, which those own.
let activeTour: RunningTour | null = null;
// Player build: the 'clock' step points at the pause/acceleration controls, which are
// stripped there (the server owns the clock in a net match) — drop it so the tour
// never narrates a control that doesn't exist. Dev client keeps the full chain.
const ORIENTATION_TOUR = __PLAYER_BUILD__
  ? HUD_ORIENTATION_TOUR.filter((step) => step.id !== 'clock')
  : HUD_ORIENTATION_TOUR;
function launchTour(steps = ORIENTATION_TOUR, onEnd?: (r: TourResult) => void): void {
  activeTour = startTour(steps, (r) => {
    activeTour = null;
    onEnd?.(r);
  });
}
interface TourWindow {
  __vdTour?: {
    start: (steps?: typeof HUD_ORIENTATION_TOUR) => void;
    stop: () => void;
    readonly active: boolean;
  };
}
(window as unknown as TourWindow).__vdTour = {
  start: (steps) => launchTour(steps),
  stop: () => activeTour?.stop(),
  get active() {
    return activeTour?.active ?? false;
  },
};

// --- ONB-0/ONB-2 first-run onboarding: flag + funnel + guided first match -----
// The "passed onboarding" signal lives per-nick in localStorage (separate from the
// saved callsign — a returning device can still be new to the guide). A brand-new
// commander gets a one-time hub offer; accepting (or «Ещё → Обучение») launches the
// ONB-2 guided first match: a bot-free solo sandbox with the data-described guide
// (firstMatchTour) walking produce→build→move→capture→score over the live HUD.
function onboardKey(): string {
  return 'vd.onboard.' + (nickInput.value.trim() || 'guest');
}
function loadOnboard(): OnboardState {
  return parseOnboardState(localStorage.getItem(onboardKey()));
}
function saveOnboard(st: OnboardState): void {
  localStorage.setItem(onboardKey(), JSON.stringify(st));
}
// A guide queued to launch once the next match's HUD is live (from installMatch).
let pendingGuide: (() => void) | null = null;
function maybeStartPendingTour(): void {
  if (!pendingGuide || NET) return;
  const run = pendingGuide;
  pendingGuide = null;
  requestAnimationFrame(run); // let the fresh HUD paint a frame so selectors resolve
}
const myScore = (): number => Math.round(s.match?.scores?.[ME]?.total ?? 0);
const myWorldCount = (): number => Object.values(s.planets).filter((p) => p.owner === ME).length;
// ONB-2: start a bot-free solo sandbox and arm the guided first match over its HUD.
function startGuidedMatch(): void {
  setupSlots = ['human', 'off', 'off', 'off']; // no rivals — a safe, calm sandbox
  setupStart = START_CANDIDATES[0] ?? MAP[0]!.id; // a deterministic homeworld
  pendingGuide = () => {
    const startScore = myScore();
    const startWorlds = myWorldCount(); // baseline: home only
    const startFleets = myFleetCount(); // baseline: none yet
    startFirstGoals(); // ONB-7: the first-session checklist rides alongside the guide
    launchTour(
      buildFirstMatchTour({
        mouse: pcUi,
        homeOpened: () => selPlanet !== null && s.planets[selPlanet]?.owner === ME,
        shipsTabOpen: () => planetTab === 'ships',
        hasFleet: () => myFleetCount() > startFleets,
        capturedWorld: () => myWorldCount() > startWorlds,
        scoreRose: () => myScore() > startScore + 1,
      }),
      onGuidedTourEnded,
    );
  };
  showHub(false);
  showConnect(false);
  startMatch(buildSetupConfig()); // installMatch → maybeStartPendingTour runs the guide
  // ONB-2: a brand-new commander shouldn't sit through the Mine's real build-time
  // (hours of game time) on the default ×10 wall-clock-ish preset — that's real
  // MINUTES of nothing happening on the very first beat. No rivals/fairness stakes
  // in this bot-free sandbox, so just run it fast: ×300 clears the two real waits
  // (build the Cruiser the tour points at, 3h; fly it to the nearest neutral world,
  // ~2.8h) in well under a minute each, instead of ~110s / ~100s at the player's own
  // ×100 ceiling. Timed/measured empirically — see the ONB-2 roadmap entry.
  applyTimeSpeed(300);
  note(t('onb.tour.speed'));
}
// Fold the finished guide into the flag (+funnel); first completion earns XP + a nudge.
function onGuidedTourEnded(r: TourResult): void {
  const { state, rewarded } = applyTourOutcome(loadOnboard(), r);
  saveOnboard(state);
  if (rewarded) {
    const cur = loadMeta();
    const xp = matchXp({ won: false, score: 100 }); // a modest onboarding packet
    saveMeta({ ...cur, xp: cur.xp + xp });
    note(t('onb.tour.done', { n: xp }));
  }
  stopFirstGoals(); // ONB-7: the checklist belongs to the onboarding session only
  if (DEV_UI)
    console.debug(
      `[onboard] ${r.completed ? 'completed' : r.skipped ? 'skipped' : 'stopped'} @ step ${r.reachedStep + 1}`,
    );
}

// --- ONB-7 first-session goals checklist -------------------------------------
// A light "am I playing right?" list, shown only in the onboarding match: four
// goals tick from live state (mine built, fleet raised, world taken, 100 score),
// and finishing all four praises the player + nudges them to a real match.
let goalsActive = false;
let goalsCollapsed = false;
let goalsRewarded = false;
let goalsDone: string[] = [];
let goalBase = { worlds: 0, mineLevel: 0, fleets: 0 };
// Чем меряется прогресс — `goalTally.ts` (REFM-99): от базы на момент запуска списка,
// а шахты суммой УРОВНЕЙ, потому что домашняя шахта уже стоит.
const myMineLevel = (): number => mineLevels(Object.values(s.planets), ME);
const myFleetCount = (): number => fleetCount(Object.values(s.fleets), ME);
function goalSignals(): GoalSignals {
  return {
    builtMine: grew(myMineLevel(), goalBase.mineLevel),
    launchedFleet: grew(myFleetCount(), goalBase.fleets),
    capturedWorld: grew(myWorldCount(), goalBase.worlds),
    score: myScore(),
  };
}
function startFirstGoals(): void {
  goalBase = goalBaseline(Object.values(s.planets), Object.values(s.fleets), ME);
  goalsDone = [];
  goalsRewarded = false;
  goalsCollapsed = false;
  goalsActive = true;
  renderGoals();
}
function stopFirstGoals(): void {
  goalsActive = false;
  document.getElementById('goals')?.classList.remove('show');
}
// Called each frame while active: tick newly-met goals; all-done → praise + XP once.
function updateGoals(): void {
  if (!goalsActive) return;
  const next = mergeDone(goalsDone, metGoals(goalSignals()));
  if (next.length === goalsDone.length) return; // nothing new
  goalsDone = next;
  renderGoals();
  if (goalsComplete(goalsDone) && !goalsRewarded) {
    goalsRewarded = true;
    const cur = loadMeta();
    const bonus = 40;
    saveMeta({ ...cur, xp: cur.xp + bonus });
    note(
      t('onb.goals.all-done', {
        n: bonus,
      }),
    );
  }
}
function renderGoals(): void {
  const el = document.getElementById('goals');
  if (!el) return;
  // Collapsed = a small tappable tray badge (icon + count), not just the list hidden
  // under a still-full-width header — the whole point is to give the map its room
  // back, not just the four rows.
  if (goalsCollapsed) {
    el.innerHTML = `<button class="gl-tray" id="gl-tray" type="button" title="${esc(t('onb.goal.tray.title'))}">◎ <span class="gl-count">${goalsDone.length}/${FIRST_GOALS.length}</span></button>`;
    el.classList.add('show');
    return;
  }
  const items = FIRST_GOALS.map((g) => {
    const done = goalsDone.includes(g.id);
    return `<div class="gl-item${done ? ' done' : ''}"><span class="gl-ck">${done ? '✓' : '○'}</span><span>${esc(t(g.labelKey))}</span></div>`;
  }).join('');
  el.innerHTML =
    `<div class="gl-box"><div class="gl-head"><b>${t('onb.goals.title')}</b>` +
    `<span class="gl-count">${goalsDone.length}/${FIRST_GOALS.length}</span>` +
    `<button class="gl-tg" id="gl-tg" type="button" title="${esc(t('onb.goal.collapse.title'))}">▾</button></div>` +
    `<div class="gl-list">${items}</div>`;
  el.classList.add('show');
}
document.getElementById('goals')?.addEventListener('click', (ev) => {
  const tgt = ev.target as HTMLElement;
  if (tgt.closest('#gl-tg') || tgt.closest('#gl-tray')) {
    goalsCollapsed = !goalsCollapsed;
    renderGoals();
  }
});
// Show the first-run offer to a not-yet-onboarded commander (idempotent per visit).
function refreshOnboardOffer(): void {
  const nudge = document.getElementById('onboard-nudge');
  if (nudge) nudge.style.display = welcomeMode(loadOnboard()) === 'new' ? 'flex' : 'none';
}
// «Начать обучение» / «Ещё → Обучение»: launch the guided first match.
function beginOnboarding(): void {
  saveOnboard(markStarted(loadOnboard()));
  const nudge = document.getElementById('onboard-nudge');
  if (nudge) nudge.style.display = 'none';
  startGuidedMatch();
}
document.getElementById('ob-start')?.addEventListener('click', beginOnboarding);
document.getElementById('ob-skip')?.addEventListener('click', () => {
  saveOnboard(markSkipped(loadOnboard())); // respected forever — never nagged again
  refreshOnboardOffer();
});
document.getElementById('hub-tutorial')?.addEventListener('click', beginOnboarding);

// --- timed cargo loading (prototype UX: "погрузка занимает час") --------------
// A ground-army load doesn't snap into the hold — it takes ~1 game-hour. The order
// is queued here and the real `army.load` only fires once the world clock has
// advanced LOAD_TIME, while the fleet marker animates the hold filling up. This is
// prototype-only client state; the deterministic core is untouched.
const LOAD_TIME = HOUR; // ~1 game-hour to lift one ground unit into the hold
// Правила очереди — `loadQueue.ts` (REFM-97): поштучные записи, резерв трюма заранее,
// резерв гарнизона по МИРУ и отмена вслед за носителем.
let pendingLoads: PendingLoad[] = [];

/** Hold footprint (cargoSize) already reserved by this fleet's in-progress loads. */
function pendingLoadCargo(fleetId: string): number {
  return queuedCargo(pendingLoads, fleetId, (u) => data.units[u]?.stats.cargoSize ?? 1);
}

/** How many of `unit` are already promised to in-progress loads lifting from the
 *  SAME garrison (planet), so a queued load never over-draws a world's stock. */
function pendingLoadUnits(planetId: string, unit: string): number {
  return queuedFromWorld(pendingLoads, planetId, unit, (id) => s.fleets[id]?.location);
}

/** Положить в очередь `count` часовых погрузок БЕЗ проверок — вызывающий уже
 *  посчитал и место, и запас гарнизона (меню десанта делает это своей моделью). */
function pushLoads(fleetId: string, unit: string, count: number): void {
  pendingLoads.push(...makeLoads(fleetId, unit, count, s.time, LOAD_TIME));
}

/** Fail-secure: ядро не выпускает войска из гарнизона, запертого живым боем
 *  (`E_UNDER_ASSAULT`). Без этой проверки заказ висел бы час и молча отскочил. */
function troopsLiftable(planetId: string): boolean {
  if (!garrisonUnderAssault(s, planetId)) return true;
  note('✖ ' + t('cargo.under-assault'));
  return false;
}

/** Drive queued loads each frame: drop any whose carrier moved / fights / vanished
 *  (load cancelled), and fire the real `army.load` once a load's hour has elapsed. */
function pumpPendingLoads(): void {
  if (!pendingLoads.length) return;
  const { fire, keep } = loadStep(pendingLoads, s.time, (id) => s.fleets[id]);
  pendingLoads = keep;
  for (const p of fire) playerOrder(loadArmy(ME, p.fleetId, p.unit, 1)); // garrison → hold
}

/** GRND-1: собрать вход меню десанта для флота. `null` — показывать нечего: флот не
 *  пришвартован у СВОЕГО мира, или наземных частей нет ни в гарнизоне, ни в трюме.
 *  Здесь и только здесь живая сцена превращается в числа — дальше меню чистое. */
function troopsInputFor(fleetId: string): TroopsInput | null {
  const f = s.fleets[fleetId];
  if (!f || f.movement || f.battleId || !f.location) return null;
  const here = s.planets[f.location];
  if (!here) return null;
  const landing = f.landing ?? [];
  const mine = here.owner === ME;
  // ALLY-LAND. Над ЧУЖИМ миром меню открывается только на ВЫСАДКУ и только если ядро
  // её примет. Правило («свой мир или мир союзника») здесь не переписывается — задаётся
  // вопрос про настоящий приказ, поэтому если ядро когда-нибудь расширит круг (скажем,
  // на пакт), клиент поедет за ним сам, без правки этой строки.
  const carried = landing.filter((st) => isGround(st.unit) && st.count > 0);
  const guestLanding =
    !mine && carried.length > 0 && canOrder(s, unloadArmy(ME, fleetId, carried[0]!.unit, 1)) === null;
  if (!mine && !guestLanding) return null;
  // Источники, типы и суммы — `troopsSources.ts` (REFM-81): на союзном мире поднимать
  // нечего, поэтому счётчик выходит односторонним сам собой, без отдельного режима меню.
  const types = groundTypes(troopSources(mine, here.garrison, landing), isGround);
  if (!hasTroops(types)) return null;
  const units: TroopsUnitInput[] = types.map((unit) => ({
    unit,
    // «Всего» складывает и побитые стопки, а поднять/высадить ядро даст только здоровую.
    garrison: mine ? (findHealthyStack(here.garrison, unit)?.count ?? 0) : 0,
    garrisonAll: mine ? totalOf(here.garrison, unit) : 0,
    hold: findHealthyStack(landing, unit)?.count ?? 0,
    holdAll: totalOf(landing, unit),
    queued: queuedOf(pendingLoads, fleetId, unit),
    reserved: pendingLoadUnits(here.id, unit),
    cargoSize: data.units[unit]?.stats.cargoSize ?? 1,
  }));
  return {
    units,
    capacity: sumUnitStat(f.units, data, 'cargoCapacity'),
    used: sumUnitStat(landing, data, 'cargoSize'),
    reservedCargo: pendingLoadCargo(fleetId),
    plan: troopsPlan?.fleetId === fleetId ? troopsPlan.plan : {},
  };
}

// --- diplomacy gate (client order layer) -------------------------------------
// A move that would cross or end on territory of a player you're at PEACE with is
// blocked: you must declare war first. Such a move opens a confirmation ("this
// declares war on …") instead of dispatching. The AI honours the same rule (see
// aiOrders); the kernel only fights once a `war` stance exists (combat.isHostile).
function blockerName(id: string): string {
  return s.players[id]?.name ?? NAME[id] ?? id;
}
/** Distinct PEACE owners that make the move IMPOSSIBLE without a war — mirrors the
 *  kernel's D2 gate, including its detour: since the right-of-way fix the kernel
 *  reroutes AROUND peace-locked territory, so a blocker on the shortest path is not
 *  a blocker if a peaceful detour exists. Prompting war for it anyway (the pre-fix
 *  behaviour) pushed players into wars the move never needed. Empty ⇒ move is free. */
/**
 * RULES-4. ЗАПЕРТ ЛИ ход миром — вердикт ядра по тому самому приказу, который сайт и
 * издаст. Решение принимает ядро; `peaceBlockers` ниже только НАЗЫВАЕТ виновников для
 * окна войны (в вердикте имён нет, там код — это «подача», а не правило).
 *
 * Что это чинит. `peaceBlockers` строит маршрут из ОДНОГО ближайшего узла
 * (`fleetNode`: t≤0.5 ? from : to), а ядро — из ОБОИХ концов ребра, на котором
 * припаркован флот (`originsOf`), выбирая самую дешёвую пару. Для припаркованного на
 * ребре флота это расходилось в обе стороны: клиент говорил «путь свободен» и приказ
 * ловил `E_NO_RIGHT_OF_WAY`, либо клиент требовал объявления войны там, где ядро
 * спокойно проехало бы другим концом.
 */
function peaceBlocked(action: Action): boolean {
  return canOrder(s, action) === 'E_NO_RIGHT_OF_WAY';
}
/** Кого назвать в окне войны, когда ядро уже сказало «заперто». Список — объяснение,
 *  а не решение: вердикт выше принят ядром. */
function peaceBlockers(from: string | null, toId: string): string[] {
  if (!from || from === toId) return [];
  const peaceLocked = (id: string): boolean => {
    const owner = s.planets[id]?.owner ?? null;
    return owner != null && !canTraverse(s, ME, owner);
  };
  // The same veto predicate the kernel replans with; planRoute exempts the
  // destination, so a reachable-by-detour move reports at most the DESTINATION's
  // owner (landing on their world genuinely needs the war declaration).
  const route = planRoute(s, from, toId, peaceLocked) ?? planRoute(s, from, toId) ?? [toId];
  const set = new Set<string>();
  for (const hop of route) {
    const owner = s.planets[hop]?.owner ?? null;
    if (owner != null && !canTraverse(s, ME, owner)) set.add(owner);
  }
  return [...set];
}
/** Живые флоты из выбора: ссылка могла пережить сам флот (погиб, слился, доставлен). */
function livingFleets(fleetIds: readonly string[]): Fleet[] {
  return fleetIds.map((id) => s.fleets[id]).filter((f): f is Fleet => !!f);
}
/** Order every selected fleet to a world. If the route crosses PEACE territory, stage
 *  a war-declaration prompt instead of dispatching (confirm → declare war + advance). */
function tryMoveGroup(fleetIds: string[], destId: string): void {
  // Отсев участников и сбор виновников — `warPrompt.ts` (REFM-57).
  const movers = moveMovers(livingFleets(fleetIds), destId);
  if (!movers.length) return;
  const blockers = collectBlockers(movers, (id) =>
    // ядро пропускает — объезд есть, виновников по этому флоту нет
    peaceBlocked(moveFleet(ME, id, destId)) ? peaceBlockers(fleetNode(s.fleets[id]!), destId) : [],
  );
  if (blockers.length) {
    warPrompt = { fleetIds: movers, destId, blockers };
    renderWarPrompt();
    return;
  }
  for (const id of movers) playerOrder(moveFleet(ME, id, destId));
}
/** PC ШТУРМ: send every selected fleet at `destId` (someone else's capturable world)
 *  and assault on arrival. A peaceful target/route stages the war prompt first —
 *  worded as "this is a friendly faction's world". */
function tryAssaultGroup(fleetIds: string[], destId: string): void {
  // Штурмуют ВСЕ выбранные: стоящий у цели штурмует с места (`warPrompt.ts`, REFM-57).
  const movers = assaultMovers(livingFleets(fleetIds));
  if (!movers.length) return;
  const blockers = collectBlockers(movers, (id) =>
    peaceBlocked(moveFleet(ME, id, destId)) ? peaceBlockers(fleetNode(s.fleets[id]!), destId) : [],
  );
  // Штурм — не просто ход: даже по свободному маршруту нельзя высадиться на мир
  // НЕвраждебного игрока (ядро: `E_FORBIDDEN`). Спросить об этом ядро нельзя — флот
  // ещё не там, — поэтому владелец цели проверяется здесь и ТОЛЬКО здесь.
  const target = assaultTargetBlocker(s.planets[destId]?.owner, ME, (owner) =>
    canTraverse(s, ME, owner),
  );
  const all = target && !blockers.includes(target) ? [...blockers, target] : blockers;
  if (all.length) {
    warPrompt = { fleetIds: movers, destId, blockers: all, assault: true };
    renderWarPrompt();
    return;
  }
  dispatchAssault(movers, destId);
}
/**
 * ПРОГНОЗ (не гейт): похоже ли, что к прилёту штурмовать будет нечем. Нужен ровно там,
 * где приказ издаётся НЕ сейчас, — флот ещё летит, спросить ядро про штурм нельзя
 * (оно ответит про мир, в котором флот в другом месте). Поэтому здесь остаётся ручная
 * прикидка, и она честно предупреждает, а не отменяет: десант могут догрузить в пути.
 *
 * RULES-4: там, где приказ издаётся СЕЙЧАС, этой прикидки больше нет — решает
 * `assaultVerdict` ниже.
 */
function assaultNeedsTroops(f: Fleet, planetId: string): boolean {
  const defended = (s.planets[planetId]?.garrison ?? []).some((u) => u.count > 0);
  return defended && !(f.landing ?? []).some((u) => u.count > 0);
}
/**
 * RULES-4. «Пройдёт ли штурм ПРЯМО СЕЙЧАС» — код отказа или `null`, от ядра.
 *
 * Спрашивается вся связка «встать на низкую орбиту → штурм» (`canOrderAll`, RULES-3):
 * штурм нелегален с дальней орбиты, поэтому вопрос об одном лишь штурме вернул бы
 * `E_WRONG_ORBIT`, а вопрос об одной орбите пропустил бы обречённую пару — и её первая
 * половина применилась бы.
 *
 * Раньше здесь стоял `assaultNeedsTroops`, то есть ОДИН отказ из шести. Остальные пять
 * (`E_OWN_PLANET`, `E_FORBIDDEN` по миру союзника, `E_UNDER_ASSAULT`,
 * `E_ORBIT_CONTESTED`, `E_NOT_CAPTURABLE`) клиент не знал и честно доезжал до отказа —
 * то есть обещанного «одно понятное сообщение вместо потока E_*» предикат не давал.
 */
function assaultVerdict(fleetId: string, f: Fleet): string | null {
  return canOrderAll(
    s,
    f.orbit === 'near'
      ? [assaultFleet(ME, fleetId)]
      : [orbitFleet(ME, fleetId, 'near'), assaultFleet(ME, fleetId)],
  );
}
/**
 * Издать связку приказов штурма для флота, стоящего у цели (`assaultOrder.ts`, REFM-141):
 * штурмуют с БЛИЖНЕЙ орбиты, поэтому перевод на неё идёт в паре со штурмом и только если
 * флот не там. Годность самого штурма к этому моменту уже подтвердило ядро (правило 1).
 */
function issueAssault(id: string, orbit: string | undefined): void {
  for (const step of assaultSteps(orbit))
    playerOrder(step === 'orbit-near' ? orbitFleet(ME, id, 'near') : assaultFleet(ME, id));
}

function dispatchAssault(fleetIds: string[], destId: string): void {
  let warnedNoTroops = false;
  for (const id of fleetIds) {
    const f = s.fleets[id];
    if (!f) continue;
    if (f.location === destId && !f.movement) {
      // RULES-4: приказ издаётся СЕЙЧАС — спрашиваем ядро про всю связку, а не
      // проверяем один десант руками.
      const code = assaultVerdict(id, f);
      if (code !== null) {
        if (!warnedNoTroops) {
          warnedNoTroops = true;
          note(code === 'E_NO_TROOPS' ? t('log.assault.no-troops') : '✖ ' + errText(code), destId);
        }
        continue;
      }
      // already parked at the target — storm right away (orbit first if needed)
      issueAssault(id, f.orbit);
    } else {
      if (!warnedNoTroops && assaultNeedsTroops(f, destId)) {
        warnedNoTroops = true;
        note(t('log.assault.warn-no-troops'), destId);
      }
      playerOrder(moveFleet(ME, id, destId));
      assaultOnArrival.set(id, destId);
    }
  }
}
/** Fire the one-shot assault orders of fleets that reached their ШТУРМ target
 *  (runs each frame beside autoEngage). Redirected fleets drop the order. */
function pumpAssaultOrders(): void {
  if (!assaultOnArrival.size) return;
  for (const [id, destId] of [...assaultOnArrival]) {
    const f = s.fleets[id];
    // Что стало с отложенным приказом — `assaultQueue.ts` (REFM-58): перенаправленный
    // снимается, бой по прилёте ждут, вставший не в цели протухает.
    const state = assaultOrderState(f, destId);
    if (dropsOrder(state)) {
      assaultOnArrival.delete(id);
      continue;
    }
    if (state !== 'ready' || !f) continue;
    // RULES-4. Флот на месте — приказ издаётся СЕЙЧАС, поэтому решает ядро, а не
    // три рукописных условия («захвачен своими / опустел» + отдельно десант). Оно
    // же покрывает и `E_OWN_PLANET`, и `E_NOT_CAPTURABLE`, и чужой идущий штурм.
    const code = assaultVerdict(id, f);
    if (code !== null) {
      // одно понятное сообщение вместо цикла отказов; приказ снимается в любом случае
      note(code === 'E_NO_TROOPS' ? t('log.assault.no-troops') : '✖ ' + errText(code), destId);
      assaultOnArrival.delete(id);
      continue;
    }
    issueAssault(id, f.orbit);
    assaultOnArrival.delete(id);
  }
}
/** As tryMoveGroup, but the target is a point on a lane (continuous order). Either lane
 *  endpoint sitting on PEACE territory blocks the march until war is declared. */
function tryMoveEdgeGroup(fleetIds: string[], edge: { from: string; to: string; t: number }): void {
  // Марш упирается в ОБА конца лейна (`warOrders.ts`, REFM-59), а не только в «куда».
  const blockers = collectBlockers(fleetIds, (id) => {
    if (!peaceBlocked(moveFleetEdge(ME, id, edge))) return [];
    const node = fleetNode(s.fleets[id]!);
    return laneEnds(edge).flatMap((end) => peaceBlockers(node, end));
  });
  if (blockers.length) {
    warPrompt = { fleetIds: [...fleetIds], destId: edge.to, edge, blockers };
    renderWarPrompt();
    return;
  }
  for (const id of fleetIds) playerOrder(moveFleetEdge(ME, id, edge));
}
/** Confirm the staged move: declare war on each blocker (opens the lanes), then issue
 *  the held move for every fleet. War-first ordering means the routes are clear when
 *  the moves apply (solo: sequential; net: server applies in send order). */
function confirmWarPrompt(): void {
  if (!warPrompt) return;
  const wp = warPrompt;
  warPrompt = null;
  hideWarPrompt();
  // Порядок шагов держит `warOrders.ts` (REFM-59): все объявления войны идут ПЕРВЫМИ,
  // иначе приказ упрётся в те же запертые лейны и будет отвергнут ядром.
  for (const step of warConfirmPlan(wp)) {
    if (step.kind === 'declare-war') playerOrder(declareWar(ME, step.on));
    else if (step.kind === 'assault') dispatchAssault([...step.fleetIds], step.destId);
    else if (step.kind === 'move-edge')
      for (const id of step.fleetIds) playerOrder(moveFleetEdge(ME, id, step.edge));
    else for (const id of step.fleetIds) playerOrder(moveFleet(ME, id, step.destId));
  }
  note(t('log.war.declared'));
}
function cancelWarPrompt(): void {
  warPrompt = null;
  hideWarPrompt();
}
function renderWarPrompt(): void {
  const el = document.getElementById('warprompt');
  if (!el || !warPrompt) return;
  const names = warPrompt.blockers.map((b) => esc(blockerName(b))).join(', ');
  const body = warPrompt.assault
    ? t('war.confirm.friendly', { names })
    : t('war.confirm.transit', { names });
  el.innerHTML =
    `<div class="wpbox">` +
    `<div class="wp-head">⚔ ${t('war.confirm.title')}</div>` +
    `<div class="wp-body">${body}</div>` +
    `<div class="wp-actions"><button class="wp-no">${warPrompt.assault ? t('war.confirm.no') : t('war.confirm.cancel')}</button>` +
    `<button class="wp-yes">${warPrompt.assault ? t('war.confirm.yes') : t('war.confirm.go')}</button></div>` +
    `</div>`;
  el.classList.add('show');
}
function hideWarPrompt(): void {
  document.getElementById('warprompt')?.classList.remove('show');
}

/** Как места НАЗЫВАЮТСЯ на экране. Единственная воронка показа: в состоянии имя места —
 *  это имя дома из данных (английское, одно на всех игроков), а перевод у каждого свой,
 *  поэтому локализация происходит здесь, при переносе в карту показа (AUD-14). Всё, что
 *  читает `NAME[id]`, получает уже готовый к показу текст; ник живого игрока проходит
 *  насквозь — `houseDisplayName` переводит только известное имя дома. */
const NAME: Record<string, string> = Object.fromEntries(
  SEAT_META.map((m) => [m.id, houseDisplayName(m.name)]),
);
function syncPlayerNames(state: GameState): void {
  for (const [id, player] of Object.entries(state.players))
    NAME[id] = houseDisplayName(player.name);
}
function setFleetSelection(ids: string[]) {
  const picked = ids.filter((id) => s.fleets[id]?.owner === ME);
  selFleets = new Set(picked);
  selFleet = picked.length === 1 ? (picked[0] ?? null) : null;
  selPlanet = null; // a fleet selection never co-selects a planet (mutually exclusive)
  lastPanelHtml = '';
}
function clearSelection() {
  selFleet = null;
  selPlanet = null;
  selFleets = new Set();
  merging = false;
  splitState = null;
  troopsPlan = null;
  lastPanelHtml = '';
}

/** Ctrl/⌘-click toggle: fold the current selection into a group and add/remove one. */
function toggleFleetInSelection(id: string) {
  if (s.fleets[id]?.owner !== ME) return;
  const next = new Set(selFleets);
  if (selFleet) next.add(selFleet);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setFleetSelection([...next]);
}

/** Order `movers` to merge into `anchorId`. Co-located & idle fleets fuse at once;
 *  distant ones are sent to the anchor's sector and finish on arrival (pending). */
function orderMerge(movers: string[], anchorId: string) {
  const anchor = s.fleets[anchorId];
  if (!anchor || anchor.owner !== ME) return;
  const dest = anchor.location ?? anchor.movement?.to ?? null;
  let queued = 0;
  for (const moverId of movers) {
    if (moverId === anchorId) continue;
    const m = s.fleets[moverId];
    if (!m || m.owner !== ME) continue;
    const coLocated =
      !!m.location && m.location === anchor.location && !m.movement && !anchor.movement;
    if (coLocated) {
      playerOrder(mergeFleet(ME, moverId, anchorId));
    } else {
      pendingMerges = pendingMerges.filter((pm) => pm.mover !== moverId);
      pendingMerges.push({ mover: moverId, into: anchorId });
      if (dest && m.location !== dest) playerOrder(moveFleet(ME, moverId, dest));
      queued++;
    }
  }
  setFleetSelection([anchorId]); // keep the surviving fleet selected for follow-up
  note(queued ? `⛬ ${queued} fleet(s) en route to merge` : '⛬ fleets merged');
}

/** Merge button on a multi-selection: pick a docked anchor, fold the rest into it. */
function mergeGroup(ids: string[]) {
  const fleets = ids.map((id) => s.fleets[id]).filter((f): f is Fleet => !!f);
  if (fleets.length < 2) return;
  const anchor = fleets.find((f) => f.location && !f.movement) ?? fleets[0]!;
  orderMerge(
    ids.filter((id) => id !== anchor.id),
    anchor.id,
  );
}

/** Drive in-flight merge orders: fuse on arrival, re-chase if the anchor moved. */
function resolvePendingMerges() {
  if (!pendingMerges.length) return;
  pendingMerges = pendingMerges.filter(({ mover, into }) => {
    // Судьба приказа в этом кадре — `mergeChase.ts` (REFM-107).
    const step = mergeStep(s.fleets[mover], s.fleets[into]);
    if (step.do === 'drop') return false;
    if (step.do === 'fuse') {
      playerOrder(mergeFleet(ME, mover, into));
      return false; // слились — приказ исполнен
    }
    if (step.do === 'chase') {
      // Consume-on-reject (правило 5): отвергнутый догоняющий ход выбрасывает слияние,
      // иначе idle-флот пережимал бы его каждый кадр — бесконечные «✖ …».
      if (!playerOrder(moveFleet(ME, mover, step.to))) return false;
    }
    return true;
  });
}
function handleEvents(events: DomainEvent[]) {
  for (const e of events) {
    const p = e.payload as Record<string, unknown>;
    switch (e.type) {
      case 'battle.started':
        // Видимость события — `eventVisibility.ts` (REFM-86): своё всегда, чужое только
        // на опознанном узле. Сеть фогует события на сервере, и местная симуляция обязана
        // повторять тот же фильтр — иначе соло показывает больше, чем сеть.
        if (
          seen(
            isMine([p.attacker as string, p.defender as string], ME),
            known(p.location as string),
          )
        )
          note(
            t('log.battle.start', {
              at: p.location as string,
              phase:
                p.phase === 'ground' ? t('log.battle.phase.ground') : t('log.battle.phase.orbit'),
            }),
            p.location as string,
          );
        // Свой бой запоминается: его исход обязан доехать до журнала, даже если узел
        // уйдёт под туман по ходу схватки (правило 3).
        if (isMine([p.attacker as string, p.defender as string], ME))
          myBattleLocs.add(p.location as string);
        break;
      case 'battle.resolved': {
        const loc = p.location as string;
        if (seenTail(myBattleLocs.has(loc), known(loc))) {
          const losses = battleLosses.get(loc);
          const tally = losses
            ? Object.entries(losses)
                .map(([who, units]) => {
                  const total = Object.values(units).reduce((a, b) => a + b, 0);
                  return `${NAME[who] ?? who} −${total}`;
                })
                .join(', ')
            : '';
          note(
            t('log.battle.end', {
              at: loc,
              res: p.winner
                ? t('log.battle.win', { who: NAME[p.winner as string] ?? (p.winner as string) })
                : t('log.battle.draw'),
            }) + (tally ? t('log.battle.losses', { tally }) : ''),
            loc,
          );
        }
        battleLosses.delete(loc);
        myBattleLocs.delete(loc);
        break;
      }
      case 'technology.researched':
        if (p.playerId === ME)
          note(
            t('log.tech.done', {
              tech: tData(
                data.technologies[p.technology as string]?.name ?? (p.technology as string),
              ),
            }),
          );
        if (techTree.isOpen()) techTree.repaint();
        break;
      // «Хранитель» lifecycle: snapshot at delegation, diff on expiry (the morning report).
      case 'steward.delegated':
        if (p.playerId === ME) {
          stewSnapshot = stewMetrics(s, ME);
          note(
            (p as { posture?: string }).posture === 'active_defend'
              ? t('log.steward.on.active')
              : t('log.steward.on.defense'),
          );
          if (steward.isOpen()) steward.repaint();
        }
        break;
      case 'steward.recalled':
        if (p.playerId === ME) {
          stewSnapshot = null;
          note(t('log.steward.off'));
          if (steward.isOpen()) steward.repaint();
        }
        break;
      case 'steward.expired':
        if (p.playerId === ME) {
          const now = stewMetrics(s, ME);
          const base = stewSnapshot;
          stewSnapshot = null;
          const sign = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
          // Тост печатается textContent (XSS-безопасность: в ленту попадает и чужой
          // текст) — HTML-чипа тут быть не может, поэтому ресурс несёт свой ГЛИФ
          // (TECH_CUR), тот же, что стоит на капсулах бара. И русская проза уехала в
          // локаль: до этого англоязычный игрок читал утренний отчёт по-русски.
          const diff = base
            ? ' ' +
              t('log.steward.diff', {
                p0: String(base.planets),
                p1: String(now.planets),
                bag: `${TECH_CUR.metal}${sign(now.metal - base.metal)} ${TECH_CUR.credits}${sign(now.credits - base.credits)}`,
              })
            : '';
          const logged = s.players[ME]?.stewardLog?.length ?? 0;
          const sitrep = logged > 0 ? ' ' + t('log.steward.decisions', { n: String(logged) }) : '';
          note(
            ((p as { posture?: string }).posture === 'active_defend'
              ? t('log.steward.handback.active')
              : t('log.steward.handback.defense')) +
              diff +
              sitrep,
          );
          if (steward.isOpen()) steward.repaint();
        }
        break;
      // Both espionage events are addressed to the ACTOR (`owner`); in NET play the
      // server's fog filter already withholds them from the victim — mirror it here.
      case 'intel.stolen': {
        if (p.owner !== ME) break;
        const whoT = NAME[p.target as string] ?? (p.target as string);
        const what =
          p.kind === 'treasury'
            ? t('log.spy.what.treasury', { who: whoT })
            : p.kind === 'fleets'
              ? t('log.spy.what.fleets', { who: whoT })
              : t('log.spy.what.world', { at: String(p.intelPlanet ?? p.target) });
        note(t('log.spy.success', { what }));
        pushSpyLog(t('log.spy.success.short', { what }));
        if (diploOpen && diploTab === 'diplo') renderDiplo(); // the intel row appeared
        break;
      }
      case 'espionage.failed':
        if (p.owner === ME) {
          const whoF = NAME[p.target as string] ?? (p.target as string);
          note(t('log.spy.fail', { who: whoF }));
          pushSpyLog(t('log.spy.fail.short', { who: whoF }));
        }
        break;
      // Counter-intel (SPY-2): addressed to the VICTIM. A failed attempt names the
      // spy (caught red-handed); a noticed clean theft only says WHAT leaked.
      case 'espionage.detected': {
        // A caught spy shifts the victim-bot's favour meter — repaint the roster.
        if (diploOpen && diploTab === 'diplo') renderDiplo();
        if (p.owner !== ME) break;
        const what =
          p.kind === 'treasury'
            ? t('log.spy.kind.treasury')
            : p.kind === 'fleets'
              ? t('log.spy.kind.fleets')
              : t('log.spy.kind.world');
        {
          const line = p.spy
            ? t('log.spy.caught', {
                who: NAME[p.spy as string] ?? (p.spy as string),
                what,
              })
            : t('log.spy.leak', { what });
          note(line);
          pushSpyLog(line);
        }
        break;
      }
      case 'planet.captured':
        if (seen(isMine([p.owner as string], ME), known(p.planetId as string))) {
          note(
            t('log.capture', {
              who: NAME[p.owner as string] ?? (p.owner as string),
              at: p.planetId as string,
            }),
            p.planetId as string,
          );
          // light the flipped province up in its new owner's colour (fog-gated: only
          // a capture we may see flashes) — re-capture restarts the wave.
          captureFlashes.set(p.planetId as string, {
            owner: p.owner as string,
            at: performance.now(),
          });
        }
        if (diploOpen && diploTab === 'diplo') renderDiplo(); // province counts shifted
        break;
      case 'diplomacy.changed': {
        const a = p.a as string;
        const b = p.b as string;
        const st = p.stance as DiplomaticStance;
        const na = NAME[a] ?? a;
        const nb = NAME[b] ?? b;
        // Only events that involve YOU land in a conversation (your DM with the other
        // party); two AIs re-stancing each other isn't part of any of your chats.
        if (a === ME || b === ME) {
          pushMsg(
            b,
            st === 'war'
              ? t('log.diplo.war', { a: na, b: nb })
              : t('log.diplo.stance', { a: na, b: nb, stance: stanceRu(st).toLowerCase() }),
            true,
            a,
          );
          note(`${na} → ${nb}: ${stanceRu(st)}`);
        }
        if (diploOpen && diploTab === 'diplo') renderDiplo();
        break;
      }
      case 'diplomacy.offered': {
        const from = p.from as string;
        const to = p.to as string;
        const st = p.stance as DiplomaticStance;
        if (to === ME) {
          note(
            t('log.diplo.offer', {
              who: NAME[from] ?? from,
              stance: stanceRu(st),
            }),
          );
          pushMsg(from, t('log.diplo.offer.short', { stance: stanceRu(st) }), true, from);
          unreadMsgs++;
        } else if (from === ME && !isAiSeat(to)) {
          // A bot answers inside the same order (accept/decline follows in this very
          // batch) — the "sent" line is only worth showing when a human must reply.
          note(
            t('log.diplo.sent', {
              who: NAME[to] ?? to,
              stance: stanceRu(st),
            }),
          );
        }
        if (diploOpen && diploTab === 'diplo') renderDiplo();
        break;
      }
      case 'diplomacy.declined': {
        const from = p.from as string;
        const to = p.to as string;
        const st = p.stance as DiplomaticStance;
        if (from === ME) {
          pushMsg(
            to,
            t('log.diplo.rejected', {
              who: NAME[to] ?? to,
              stance: stanceRu(st),
            }),
            true,
            to,
          );
          note(t('log.diplo.rejected.short', { who: NAME[to] ?? to, stance: stanceRu(st) }));
        }
        if (diploOpen && diploTab === 'diplo') renderDiplo();
        break;
      }
      // RECAP-FOG. Стройка и производство ДРУГОГО игрока в мой журнал не попадают —
      // а журнал и есть источник сводки возвращения (`buildRecap`), так что чужая
      // экономика утекала и в дайджест, и в пуш. Сводка — про МОЮ империю; чужое
      // строительство я узнаю разведкой, а не уведомлением.
      case 'building.constructed':
        if (!admits('building.constructed', p)) break;
        note(
          t('log.build.done', {
            b: buildingName(data.buildings[p.building as string]?.name, p.building as string),
            at: p.planetId as string,
          }),
        );
        if (p.building === 'starfort') installFortressAA(p.planetId as string);
        break;
      case 'building.upgraded':
        if (!admits('building.upgraded', p)) break;
        note(
          t('log.build.upgraded', {
            b: buildingName(data.buildings[p.building as string]?.name, p.building as string),
            lvl: String(p.level),
            at: p.planetId as string,
          }),
        );
        break;
      case 'building.destroyed':
        // Разрушение — исключение: своё узнаю всегда, чужое лишь там, где ВИЖУ
        // (тот же фог-гейт, что у `aa.fired`). Взрыв на наблюдаемом мире — это
        // наблюдение, а не раскрытие.
        if (!admits('building.destroyed', p)) break;
        note(
          t('log.build.destroyed', {
            b: buildingName(data.buildings[p.building as string]?.name, p.building as string),
            at: p.planetId as string,
          }),
          p.planetId as string,
        );
        break;
      case 'unit.built':
        if (!admits('unit.built', p)) break;
        note(`🛠️ ${p.count}× ${displayUnit(p.unit as string)} · ${p.planetId}`);
        break;
      case 'fleet.launched':
        // Вылет — событие КАРТЫ: чужой флот, поднявшийся на мире, который я вижу,
        // это наблюдение. Но за туманом его быть не должно (как у `aa.fired`).
        if (!admits('fleet.launched', p)) break;
        note(
          t('log.fleet.launched', {
            who: NAME[p.owner as string] ?? (p.owner as string),
            at: p.planetId as string,
          }),
        );
        break;
      case 'aa.fired': {
        const planet = s.planets[p.planetId as string];
        if (!planet || !known(p.planetId as string)) break; // fogged flak stays unseen
        const target = s.fleets[p.fleetId as string];
        const to = (target && fleetPos(target)) ?? {
          x: planet.position.x + 6,
          y: planet.position.y - 14, // the victim died this volley — burst over the orbit
        };
        aaShots.push({
          from: { ...planet.position },
          to,
          at: performance.now(),
          close: p.tier === 'close',
        });
        while (aaShots.length > 40) aaShots.shift();
        break;
      }
      case 'artillery.fired': {
        // Standoff bombardment: arc from the shooter to its victim. Endpoints are
        // captured NOW — the victim may already be wiped from the state (the core
        // emits after damage), so fall back to the `near` node anchor it sent.
        const shooter = s.fleets[p.fleetId as string];
        const from = shooter && fleetPos(shooter);
        if (!from) break;
        const anchorNode = (id: string | null | undefined) =>
          id ? (s.planets[id]?.position ?? null) : null;
        const victim = s.fleets[p.target as string];
        const to = (victim && fleetPos(victim)) ?? anchorNode(p.near as string);
        if (!to) break;
        // Fog: show the exchange only if either end sits on a node we can see.
        const shooterNode = shooter.location ?? shooter.edge?.from;
        const nearNode = (p.near as string) ?? '';
        // Хватит опознанного конца — любого: залп по видимой цели замечаешь, даже не
        // зная, откуда бьют (`eventVisibility.ts`, правило 4).
        if (!seenArc(!!shooterNode && known(shooterNode), known(nearNode))) break;
        siegeShots.push({
          from: { ...from },
          to: { x: to.x, y: to.y },
          at: performance.now(),
          seed: siegeSeed++,
        });
        while (siegeShots.length > 24) siegeShots.shift();
        break;
      }
      case 'market.bought':
        if (p.seller === ME || p.buyer === ME)
          note(
            t('log.market.trade', {
              n: String(p.amount),
              res: TECH_CUR[p.resource as string] ?? tData(p.resource as string),
              paid: String(p.paid ?? '?'),
              side: p.buyer === ME ? t('log.market.buy') : t('log.market.sell'),
            }),
          );
        break;
      case 'fleet.merged':
        if (p.owner === ME) note(t('log.fleet.merged', { at: p.at as string }));
        break;
      case 'fleet.split':
        if (p.owner === ME) note(t('log.fleet.split', { at: p.at as string }));
        break;
      case 'fleet.destroyed':
        note(t('log.fleet.destroyed', { who: NAME[p.owner as string] ?? (p.owner as string) }));
        break;
      case 'unit.died': {
        // War record — only count casualties in battles you're part of, so the AI's
        // fights elsewhere don't pad your numbers. Your dead = lost; the rest = destroyed.
        if (myBattleLocs.has(p.at as string)) {
          const n = (p.count as number) ?? 0;
          if (p.owner === ME) killStats.lost += n;
          else killStats.destroyed += n;
        }
        // Ledger for the battle-result card (visible fights only).
        if (seenTail(myBattleLocs.has(p.at as string), known(p.at as string))) {
          const at = p.at as string;
          const owner = (p.owner as string) ?? '?';
          const perOwner = battleLosses.get(at) ?? {};
          const perUnit = (perOwner[owner] ??= {});
          perUnit[p.unit as string] = (perUnit[p.unit as string] ?? 0) + ((p.count as number) ?? 0);
          battleLosses.set(at, perOwner);
        }
        break;
      }
    }
  }
}

// Walk-in capture (undefended, uncontested, capturable sector) is now a kernel
// rule — `captureOnArrivalModule` — so it applies on the authoritative server and
// in single-player alike; the resulting `planet.captured` event is noted above.

// --- red AI ------------------------------------------------------------------
// Ходы ИИ, авто-штурм, столкновения флотов, дежурные вылеты и цепочки приказов живут в
// `soloDrivers.ts` (REFM-26): в сетевом матче всё это делает сервер, в одиночном —
// подталкивает кадр. Здесь только хуки: состояние, два пути приказов (свой идёт через
// `playerOrder`, чужой применяется локально) и опт-ин авто-штурма.
const solo = initSoloDrivers({
  state: () => s,
  me: () => ME,
  aiSeats: () => AI_PLAYERS,
  applyLocal: (a) => apply(order(s, a, s.time)),
  playerOrder: (a) => void playerOrder(a),
  autoAssault: (id) => autoAssault.has(id),
  patrols: () => patrols,
  known,
});

/** The CC-2 auto-storm stance of a fleet — authoritative state in NET, local Set solo. */
function isAutoAssault(fleetId: string): boolean {
  return NET
    ? ((s as { autoAssault?: Record<string, true> }).autoAssault?.[fleetId] ?? false)
    : autoAssault.has(fleetId);
}
/** The CC-4 standing patrol of a fleet — authoritative state in NET, local Map solo. */
function patrolOf(fleetId: string): Patrol | undefined {
  return NET
    ? (s as { patrols?: Record<string, Patrol> }).patrols?.[fleetId]
    : patrols.get(fleetId);
}
/** CC-2: set the auto-storm stance UNIFORMLY on the given own fleets (☰-row toggle —
 *  a mixed group snaps to one state instead of flipping each). Authoritative in NET
 *  (order.auto — the server presses the storm while you're offline), local Set solo. */
function setAutoAssault(ids: string[], on: boolean): void {
  for (const id of ids) {
    // Кому стойка положена — `stanceToggle.ts` (REFM-98).
    if (autoStance(s.fleets[id]?.owner === ME, isAutoAssault(id), on) === 'skip') continue;
    if (NET) playerOrder(orderAuto(ME, id, on));
    else if (on) autoAssault.add(id);
    else autoAssault.delete(id);
  }
}
/** CC-4: stand (or stand down) «дежурный вылет» UNIFORMLY on the given fleets' wings.
 *  Authoritative in NET (order.scramble — the server computes the patrol and flies it
 *  while you're offline); the local Map + frame-loop driver in solo. */
function setScramble(ids: string[], on: boolean): void {
  for (const id of ids) {
    const f = s.fleets[id];
    const pos0 = f?.location ? s.planets[f.location]?.position : undefined;
    // Кому дежурство положено и почему отказ — `stanceToggle.ts` (REFM-98).
    const want = scrambleStance(
      !!f && f.owner === ME,
      !!f && fleetHasSquadron(f),
      !!patrolOf(id),
      on,
      !!pos0,
      !!f && fleetIdle(f),
    );
    if (want === 'skip' || !f) continue;
    if (want === 'need-dock') {
      note(t('ai.sortie.docked-only'));
      continue;
    }
    if (want === 'need-idle') {
      note(t('ai.sortie.idle-only'));
      continue;
    }
    if (want === 'clear') {
      if (NET) playerOrder(orderScramble(ME, id, false));
      else {
        // Stash the wing's sortie so OFF→ON resumes it (BF-26) instead of a free full tank.
        const pt = patrols.get(id);
        if (pt) wingSorties.set(id, pt.sortie);
        patrols.delete(id);
      }
      continue;
    }
    const pos = pos0!;
    if (NET) {
      playerOrder(orderScramble(ME, id, true));
    } else {
      if (patrols.size === 0) solo.startPatrolCadence(); // счёт перезарядки — с этого мига
      const spec = sortieSpec(f);
      const stashed = wingSorties.get(id);
      patrols.set(id, {
        center: { x: pos.x, y: pos.y },
        radius: squadronStrikeRange(f),
        // Resume the stashed sortie (clamped to the current wing spec), like the server;
        // only a never-flown wing starts on a fresh full tank.
        sortie: stashed
          ? {
              fuel: Math.min(stashed.fuel, spec.maxFuel),
              rearming: Math.min(stashed.rearming, spec.rearmRounds),
            }
          : freshSortie(spec.maxFuel),
      });
      wingSorties.delete(id);
    }
  }
}

// Итог матча и награда за него живут в `matchEnd.ts` (REFM-27): исход берётся из
// авторитетного `match` (его считает модуль победы в ядре), а награда выдаётся РОВНО
// один раз за матч — долговечная метка не даёт фармить опыт перезаходом.
const matchEnd = initMatchEnd({
  state: () => s,
  me: () => ME,
  nick: () => nickInput.value,
  endShown: () => endScreen !== null,
  readMarker: (k) => localStorage.getItem(k),
  writeMarker: (k, v) => localStorage.setItem(k, v),
  loadMeta,
  saveMeta,
});

// --- rendering ---------------------------------------------------------------

/** A regular polygon path centred at (x,y) — fort/station containment marker.
 *  Точки считает `mapShapes.ts` (REFM-34); здесь только обводка. */
function poly(x: number, y: number, r: number, sides: number, rot = 0) {
  cx.beginPath();
  polyPoints(x, y, r, sides, rot).forEach((p, i) => {
    if (i) cx.lineTo(p.x, p.y);
    else cx.moveTo(p.x, p.y);
  });
  cx.closePath();
}

/** Four slowly-rotating corner brackets — the "locked target" selection reticle. */
function targetBrackets(x: number, y: number, r: number, t: number) {
  cx.save();
  cx.translate(x, y);
  cx.rotate(t / 1600);
  cx.strokeStyle = LOCK;
  cx.lineWidth = 1.6;
  cx.shadowColor = LOCK;
  cx.shadowBlur = fxBlur(8);
  // Четыре уголка «захваченной цели» — их геометрию считает `mapShapes.ts`.
  for (const b of bracketStrokes(r, 6)) {
    cx.beginPath();
    cx.moveTo(b.from.x, b.from.y);
    cx.lineTo(b.corner.x, b.corner.y);
    cx.lineTo(b.to.x, b.to.y);
    cx.stroke();
  }
  cx.restore();
}

function drawBattlePulse(
  x: number,
  y: number,
  pulse: number,
  phase: 'orbital' | 'ground' = 'orbital',
) {
  // Two DIFFERENT pictures for the two battle phases (the audit found them
  // indistinguishable): orbital = the familiar red expanding rings (a dogfight in
  // space); ground = an amber pulse hugging the surface + a flat "front line" bar.
  // Вид фазы и волна колец — `battleMark.ts` (REFM-118): фазы обязаны быть НЕПОХОЖИМИ,
  // а три кольца со сдвигом на треть читаются как расходящаяся волна, а не как мигание.
  const look = phaseLook(phase);
  const col = look.color;
  cx.save();
  cx.shadowColor = col;
  cx.shadowBlur = fxBlur(12);
  for (let i = 0; i < BATTLE_RINGS; i++) {
    const k = ringPhase(pulse, i);
    cx.strokeStyle = rgba(col, 0.55 * (1 - k));
    cx.lineWidth = 1.2 + i * 0.25;
    cx.beginPath();
    if (look.dash) cx.setLineDash([...look.dash]);
    cx.arc(x, y, ringRadiusAt(look, k), 0, TAU);
    cx.stroke();
  }
  if (look.frontLine) {
    cx.setLineDash([]);
    cx.strokeStyle = rgba(col, 0.85);
    cx.lineWidth = 2;
    cx.beginPath();
    cx.moveTo(x - 10, y + 16);
    cx.lineTo(x + 10, y + 16); // the front line under the world
    cx.stroke();
  }
  cx.restore();
}

/**
 * Rings for my own radar reach (planet arrays + radar-ships). Each radar projects
 * TWO concentric ranges (matching shared-core visibility): an OUTER signature ring
 * (full reach — enemy fleets show as coarse blips in fog) and an INNER full-reveal
 * ring (half the reach — contacts fully identified). The reach is a Euclidean
 * distance in MAP units; the projection is uniform so they read as true circles.
 * Only meaningful with fog on.
 */
// Offscreen layer for compositing the UNION of radar circles into one clean
// frontier (so overlapping ranges read as a single border, not a tangle of rings).
let unionCv: HTMLCanvasElement | null = null;
function unionCtx(): CanvasRenderingContext2D {
  if (!unionCv) unionCv = document.createElement('canvas');
  if (unionCv.width !== canvas.width || unionCv.height !== canvas.height) {
    unionCv.width = canvas.width;
    unionCv.height = canvas.height;
  }
  const g = unionCv.getContext('2d') as CanvasRenderingContext2D;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, unionCv.width, unionCv.height);
  g.setTransform(DPR, 0, 0, DPR, 0, 0); // draw in CSS px, matching the main canvas
  return g;
}

/** Paint a set of screen circles as ONE merged region: a faint union fill plus a
 *  crisp union outline. A circle fully inside another contributes nothing; an
 *  outlier extends the frontier — exactly one "border of visibility". */
function drawUnionTier(circles: Array<{ x: number; y: number; r: number }>, tier: SightTier): void {
  // Вид тира и отбор дуг — `sightFrontier.ts` (REFM-120): внутренний тир обязан читаться
  // сильнее внешнего, а сжатая копия не может съесть круг целиком (иначе вывернутая дуга
  // выест дыру в уже собранной заливке).
  // Проверок «прозрачность > 0» / «толщина > 0» здесь НЕТ намеренно (REFM-120.1, правило 8):
  // числа приходят только из `frontierLook`, где положительны, и это заперто тестом по
  // `SIGHT_TIERS`. А вот пустой набор кругов ниже проверяется по-настоящему — правило 4.
  const { lineWidth: lineW, fillAlpha: fillA, strokeAlpha: strokeA } = frontierLook(tier);
  if (!frontierShown(circles)) return;
  const arcs = (g: CanvasRenderingContext2D, inset: number): void => {
    g.beginPath();
    for (const c of unionArcs(circles, inset)) {
      g.moveTo(c.x + c.r, c.y); // moveTo each ⇒ separate subpaths, no joining lines
      g.arc(c.x, c.y, c.r, 0, TAU);
    }
  };
  // Filled union, drawn as ONE path straight onto the map — overlaps merge under
  // nonzero winding, so there are no internal seams.
  cx.fillStyle = rgba(LOCK, fillA);
  arcs(cx, 0);
  cx.fill();
  // Crisp outline: fill the union white, erode an inset copy with destination-out
  // → a ring tracing only the outer frontier; tint it, then blit 1:1 onto the map.
  const g = unionCtx();
  g.fillStyle = '#fff';
  arcs(g, 0);
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  arcs(g, lineW);
  g.fill();
  g.globalCompositeOperation = 'source-in';
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = rgba(LOCK, strokeA);
  g.fillRect(0, 0, unionCv!.width, unionCv!.height);
  g.globalCompositeOperation = 'source-over';
  cx.save();
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.drawImage(unionCv as HTMLCanvasElement, 0, 0);
  cx.restore();
}

function drawRadarCoverage() {
  // My radar sources (planet arrays + radar-ships), tagged so a SELECTED entity can
  // also show its own precise range on top of the merged frontier.
  // Отбор источников — `radarSources.ts` (REFM-63): только свои, только с
  // положительным радиусом, кольцо флота — в его ФАКТИЧЕСКОМ месте, а не в узле
  // назначения (иначе покрытие прыгает вперёд флота).
  const selFleetSet = new Set(selectedFleetIds());
  const sources = radarSources([
    ...Object.values(s.planets).map((p) => ({
      mine: p.owner === ME,
      radius: planetRadar(p),
      at: p.position,
      selected: selPlanet === p.id,
    })),
    ...Object.values(s.fleets).map((f) => {
      const r = f.owner === ME ? fleetRadar(f) : 0;
      return {
        mine: f.owner === ME,
        radius: r,
        at: r > 0 ? fleetPos(f) : null,
        selected: selFleetSet.has(f.id),
      };
    }),
  ]);
  if (!hasCoverage(sources)) return;
  // Project map circles to screen circles (uniform projection ⇒ true circles) — радиус
  // считает `worldDist`, а не проекция смещённой точки: это тот же множитель окольным
  // путём (`mapRadius.ts`, правило 3).
  const screen = (x: number, y: number, rr: number): { x: number; y: number; r: number } => {
    const c = world({ x, y });
    return { x: c.x, y: c.y, r: worldDist(rr) };
  };
  const outer = sources.map((v) => screen(v.x, v.y, v.r));
  const inner = sources.map((v) => screen(v.x, v.y, identifyRadius(v.r, IDENTIFY_REACH_FRACTION)));
  cx.save();
  // The unified visibility frontier: outer (signatures) then inner (full reveal).
  drawUnionTier(outer, 'signature');
  drawUnionTier(inner, 'reveal');
  // A selected planet/fleet additionally shows ITS OWN two rings — crisp + dashed —
  // so you can read one entity's exact reach out of the merged whole.
  for (const v of sources) {
    if (!v.selected) continue;
    const c = world({ x: v.x, y: v.y });
    // Пунктир внешнего и сплошная внутреннего — `sightFrontier.ts` (REFM-120, правило 6).
    const ring = (rr: number, tier: SightTier): void => {
      const r = worldDist(rr);
      if (!ownRingShown(r)) return;
      const look = ownRingLook(tier);
      cx.beginPath();
      cx.arc(c.x, c.y, r, 0, TAU);
      cx.setLineDash([...look.dash]);
      cx.lineWidth = 1.3;
      cx.strokeStyle = rgba(LOCK, look.alpha);
      cx.stroke();
    };
    ring(v.r, 'signature'); // outer — signatures
    ring(identifyRadius(v.r, IDENTIFY_REACH_FRACTION), 'reveal'); // inner — full reveal
  }
  cx.setLineDash([]);
  cx.restore();
}

/** The planned route of every moving fleet of mine — dashed, brighter if selected. */
function drawFleetRoutes() {
  for (const f of Object.values(s.fleets)) {
    // Чей маршрут виден, где он кончается и как выглядит — `fleetRoute.ts` (REFM-95);
    // здесь остаётся проекция мировых точек на экран.
    if (!routeShown(f.owner, ME, !!f.movement) || !f.movement) continue;
    const start = fleetAnchor(f);
    if (!start) continue;
    const sel = selFleet === f.id || selFleets.has(f.id);
    const stops = routeStops(f.movement, (id) => s.planets[id]?.position);
    const pts = [{ x: start.x, y: start.y }, ...stops.map((p) => world(p))];
    if (pts.length < 2) continue;
    const stroke = routeStroke(sel);
    cx.save();
    cx.setLineDash([4, 6]);
    cx.strokeStyle = rgba(LOCK, stroke.alpha);
    cx.lineWidth = stroke.width;
    cx.shadowColor = LOCK;
    cx.shadowBlur = fxBlur(stroke.blur);
    cx.beginPath();
    cx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) cx.lineTo(pts[i]!.x, pts[i]!.y);
    cx.stroke();
    const d = pts[pts.length - 1]!;
    cx.setLineDash([]);
    cx.beginPath();
    cx.arc(d.x, d.y, 4, 0, TAU);
    cx.stroke();
    cx.restore();
  }
}

/** While ШТУРМ is armed (PC): ring every valid target — someone else's capturable
 *  world (enemy or friendly faction alike; the friendly path asks to declare war). */
function drawAssaultTargets() {
  // Кого обводим и почему — `assaultRings.ts` (REFM-106).
  if (!ringsShown(!!assaultAim)) return;
  cx.save();
  cx.strokeStyle = 'rgba(255,90,77,.85)';
  cx.lineWidth = 1.6;
  cx.setLineDash([4, 4]);
  cx.shadowColor = '#ff5a4d';
  cx.shadowBlur = fxBlur(8);
  for (const n of MAP) {
    const p = s.planets[n.id];
    if (!p) continue;
    if (!ringed({ owner: p.owner, capturable: sectorTypeOf(n.id)?.capturable ?? false }, ME))
      continue;
    const c = world(n);
    cx.beginPath();
    cx.arc(c.x, c.y, 16, 0, TAU);
    cx.stroke();
  }
  cx.restore();
}

/**
 * HERO-CORRIDOR — временные коридоры героев на карте.
 *
 * До этого их не рисовали ВООБЩЕ: статический слой лейн строится из `MAP`, а коридор
 * живёт в состоянии, поэтому игрок не видел ни что коридор открыт, ни куда он ведёт.
 *
 * Что и почему различается — решает чистая модель `corridorView.ts`; здесь только
 * канва. Одноразовый мигает красным и БЕЗ таймера (он закрывается прибытием армии, а
 * не по часам — цифра «осталось» была бы враньём); временный и общий идут спокойной
 * линией с оставшимся сроком.
 */
function drawCorridors(now: number): void {
  const lines = corridorLines(s, ME, s.time, known);
  if (!lines.length) return;
  cx.save();
  for (const line of lines) {
    const a = s.planets[line.from]?.position;
    const b = s.planets[line.to]?.position;
    if (!a || !b) continue;
    const p1 = world(a);
    const p2 = world(b);
    const col = line.blink ? CORR_ONCE : CORR_LIVE;
    // Мигание — только у одноразового: он вот-вот исчезнет, и это надо чувствовать.
    const pulse = line.blink ? 0.35 + 0.45 * Math.abs(Math.sin(now / 320)) : 0.6;
    cx.strokeStyle = rgba(col, line.mine ? pulse : pulse * 0.6);
    cx.lineWidth = line.mine ? 2 : 1.4;
    cx.setLineDash(line.blink ? [7, 6] : [10, 6]);
    cx.shadowColor = col;
    cx.shadowBlur = fxBlur(line.blink ? 8 : 4);
    cx.beginPath();
    cx.moveTo(p1.x, p1.y);
    cx.lineTo(p2.x, p2.y);
    cx.stroke();
    cx.shadowBlur = 0;
    if (line.msLeft !== null) {
      cx.setLineDash([]);
      cx.fillStyle = rgba(col, 0.9);
      cx.font = '600 11px ui-monospace,monospace';
      cx.textAlign = 'center';
      cx.fillText(fmtHrs(line.msLeft / HOUR), (p1.x + p2.x) / 2, (p1.y + p2.y) / 2 - 6);
    }
  }
  cx.setLineDash([]);
  cx.restore();
}

/**
 * RANGE-UX — круги досягаемости выделенных флотов и отметки ПВО.
 *
 * Вся арифметика — в `combatRanges.ts` (чистая, покрыта гейтом); здесь только канва.
 * Радиусы приходят ИЗ ЯДРА — рисуется ровно тот круг, по которому ядро стреляет.
 */
function drawCombatRanges(): void {
  const ids = selectedFleetIds();
  const { rings, lines } = combatRanges(
    s,
    data,
    ids,
    ME,
    (id: string) => {
      const f = s.fleets[id];
      if (f) return fleetPos(f);
      const p = s.planets[id];
      return p ? { ...p.position } : null;
    },
    known,
  );
  if (!rings.length && !lines.length) return;
  const tint: Record<string, string> = { artillery: R_ARTY, squadron: R_WING, aa: R_AA };
  cx.save();
  for (const ring of rings) {
    const c = world({ x: ring.x, y: ring.y } as never);
    // Заметность кольца — `combatRanges.ts` (REFM-123): при взведённом обстреле граница
    // дострела выходит на первый план, а ПВО заметнее радиусов, потому что это отметка.
    const look = ringLook(ring.kind, !!barrageAim);
    cx.strokeStyle = rgba(tint[ring.kind] ?? R_ARTY, look.alpha);
    cx.lineWidth = look.width;
    cx.setLineDash([...look.dash]);
    cx.beginPath();
    if (ring.radius > 0) cx.arc(c.x, c.y, worldDist(ring.radius), 0, TAU);
    // ПВО: у него нет области — только «у этого мира есть зубы».
    else cx.arc(c.x, c.y, 13, 0, TAU);
    cx.stroke();
  }
  cx.setLineDash([]);
  for (const line of lines) {
    const a = world({ x: line.from.x, y: line.from.y } as never);
    const b = world({ x: line.to.x, y: line.to.y } as never);
    cx.strokeStyle = rgba(R_ARTY, 0.85);
    cx.lineWidth = 1.6;
    cx.shadowColor = R_ARTY;
    cx.shadowBlur = fxBlur(6);
    cx.beginPath();
    cx.moveTo(a.x, a.y);
    cx.lineTo(b.x, b.y);
    cx.stroke();
    cx.shadowBlur = 0;
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
function drawCastAim(): void {
  if (!heroAim || !aimPointer) return;
  const hero = (s.heroes ?? {})[heroAim.heroId];
  const def = data.heroAbilities[heroAim.abilityId];
  if (!hero || !def) return;
  const fleet = hero.fleetId ? s.fleets[hero.fleetId] : undefined;
  const origin = fleet ? fleetAnchor(fleet) : null;
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
 * ОДИН вид у радиуса способности: фиолетовый пунктир (заказ владельца). Он нарочно не
 * похож ни на дальность огня (`R_ARTY`/`R_WING`), ни на радар — иначе на карте, где
 * колец и так много, игрок не отличит «докуда бьёт пушка» от «докуда достаёт аура».
 * Рисуется и под прицелом, и у уже наложенных эффектов — потому и вынесено сюда, а не
 * скопировано дважды.
 */
function drawAbilityCircle(x: number, y: number, rPx: number, fill = 0): void {
  if (rPx <= 0) return;
  cx.save();
  cx.setLineDash([7, 6]);
  cx.lineWidth = 1.5;
  cx.strokeStyle = rgba(ABILITY_RING, 0.85);
  cx.beginPath();
  cx.arc(x, y, rPx, 0, TAU);
  if (fill > 0) {
    cx.fillStyle = rgba(ABILITY_RING, fill);
    cx.fill();
  }
  cx.stroke();
  cx.setLineDash([]);
  cx.restore();
}

/** Уже РАБОТАЮЩИЕ способности: аура следует за героем, скан прибит к своему узлу.
 *  Модель — `abilityRings.ts`; здесь только холст. Просроченный круг гаснет в тот же
 *  кадр: срок проверяется по игровому времени, а не по таймеру интерфейса. */
function drawAbilityRings(): void {
  const rings = abilityRings(s, ME, s.time, {
    hero: (heroId) => {
      const hero = (s.heroes ?? {})[heroId];
      const f = hero?.fleetId ? s.fleets[hero.fleetId] : undefined;
      const p = f ? fleetPos(f) : null;
      return p ? world(p) : null;
    },
    node: (planetId) => {
      const p = s.planets[planetId]?.position;
      return p ? world(p) : null;
    },
  });
  for (const r of rings) drawAbilityCircle(r.x, r.y, worldDist(r.radius));
}

/** While "Move" is armed: a dashed line from each selected fleet to the world under
 *  the pointer (snaps to the nearest blip) — preview before committing. */
function drawAimPreview() {
  if (!(aiming || assaultAim) || !aimPointer) return;
  const ids = selectedFleetIds();
  if (!ids.length) return;
  // Prefer a node target; if none is near, aim at the closest point ON a lane —
  // the army will route to that road and park there (Bytro continuous order).
  // Радиус захвата узла — `tapPriority.ts` (REFM-125, правило 5), поиск ближайшего —
  // `pointerPick.ts` (REFM-33). Прицел и коммит ОБЯЗАНЫ смотреть одним радиусом: здесь
  // стояла своя копия тех же чисел (30 пальцем, 24 мышью), и разъедься она с тапом —
  // превью рисовало бы путь, которого отпускание не отправит, причём молча.
  const rAim = tapRadius('node', tapByTouch);
  const hit = nearestHit(MAP, (n) => world(n), aimPointer.x, aimPointer.y, rAim);
  let target: { x: number; y: number } | null = hit ? world(hit) : null;
  const targetId: string | null = hit?.id ?? null;
  const laneTarget = targetId ? null : nearestLanePoint(aimPointer.x, aimPointer.y);
  if (laneTarget) target = { x: laneTarget.x, y: laneTarget.y };
  const tip = target ?? aimPointer;
  cx.save();
  cx.strokeStyle = rgba(LOCK, 0.6);
  cx.lineWidth = 1.4;
  cx.setLineDash([3, 5]);
  cx.shadowColor = LOCK;
  cx.shadowBlur = fxBlur(6);
  for (const id of ids) {
    const f = s.fleets[id];
    if (!f) continue;
    const anchor = fleetAnchor(f);
    if (!anchor) continue;
    // draw the ROUTED march path through province centres (Bytro-style), so you
    // see the actual road the army will take — not a straight line to the target.
    const from = fleetNode(f);
    const a: { x: number; y: number } = anchor;
    // For a lane target, route to the endpoint the army enters through, then a
    // final segment to the point on the road.
    const routeEndId = laneTarget && from ? laneAim(f, from, laneTarget).endId : targetId;
    const pts: Array<{ x: number; y: number }> = [a];
    if (from && routeEndId && routeEndId !== from) {
      const route = planRoute(s, from, routeEndId);
      if (route)
        for (const hop of route) {
          const pl = s.planets[hop];
          if (pl) pts.push(world(pl.position));
        }
    }
    if (laneTarget) pts.push({ x: laneTarget.x, y: laneTarget.y });
    if (pts.length === 1) pts.push(tip);
    cx.beginPath();
    cx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) cx.lineTo(pts[i]!.x, pts[i]!.y);
    cx.stroke();
  }
  if (target) {
    cx.setLineDash([]);
    cx.beginPath();
    cx.arc(tip.x, tip.y, laneTarget ? 9 : 16, 0, TAU); // smaller pip for a road point
    cx.stroke();
    // travel-time estimate to this target for the first selected fleet (longer
    // route → more hours; the authoritative time is computed by the server).
    const f0 = s.fleets[ids[0]!];
    const from = f0 ? fleetNode(f0) : null;
    let hrs: number | null = null;
    if (f0 && from) {
      if (laneTarget) hrs = laneAim(f0, from, laneTarget).hrs;
      else if (targetId) hrs = estimateTravelHours(s, data, from, targetId, f0);
    }
    if (hrs != null && Number.isFinite(hrs)) {
      cx.font = '11px ui-monospace,Menlo,monospace';
      cx.textAlign = 'center';
      cx.fillStyle = rgba(LOCK, 0.95);
      cx.fillText(hrs >= 1 ? `~${hrs.toFixed(1)}h` : `~${Math.ceil(hrs * 60)}m`, tip.x, tip.y - 22);
    }
  }
  cx.restore();
}

let selectionBox: { x1: number; y1: number; x2: number; y2: number } | null = null;

/**
 * Province field — the whole map is a tiling of provinces (Bytro/Paradox-style):
 * every point belongs to the nearest seed (planets = capturable territory tinted
 * in the owner's colour; empty-space voids = uncapturable, neutral). The tiling is
 * computed as vector Voronoi cells (half-plane clipping) in base space and filled
 * under the camera each frame — so it covers the whole map, scales without
 * stretching, and never shimmers. Rebuilt only on viewport / ownership change.
 */
// --- holographic static layer (territory + hyperlanes), camera-baked & cached --
// The expensive world-space art — influence glows + the hyperlane network — is
// rendered once into an offscreen canvas and re-blitted every frame; it rebuilds
// only when the camera, ownership or viewport changes. Idle frames cost a single
// drawImage, so the map holds 60fps instead of re-tracing the whole graph + a
// Voronoi tiling every frame.
const bg = document.createElement('canvas');
const bgx = bg.getContext('2d') as CanvasRenderingContext2D;
let bgContent = ''; // viewport + ownership signature (camera-independent)
let bgCam = { x: 0, y: 0, scale: 1 }; // camera the static layer was last baked at

/** The owner of node `id` AS THE VIEWER MAY KNOW IT: live when identified (or fog
 *  off), last-known from memory when only remembered, unknown otherwise. The
 *  political fill and its cache signature both read THIS, never the raw truth —
 *  the map must not repaint a hidden capture (an intel leak the fog exists to stop). */
function knownOwner(id: string): string | null {
  if (known(id)) return s.planets[id]?.owner ?? null;
  return memory.ownerOf(id);
}
function ownersSig(): string {
  // Подпись читает ЗНАНИЕ игрока (`knownOwner`), а не правду — см. `staticLayerCache.ts`
  // (REFM-60): иначе скрытый захват выдал бы себя самим фактом перерисовки.
  return ownersSignature(
    MAP.map((n) => n.id),
    knownOwner,
  );
}

/** Rebuild the cached province map when the camera/ownership/viewport moves. */
function buildStaticLayer(): void {
  // Rebuild only when the content/size changes, or when the camera has SETTLED at a
  // new spot. During an active pan/zoom we skip the O(n²) re-tessellation entirely
  // and let blitStaticLayer follow the camera with the last bake (transformed).
  // Re-bake whenever the camera moved. The bake is viewport-sized, so following a pan
  // with a transformed STALE bake left the newly-revealed area uncovered — a smear / a
  // map squeezed into a corner on the wide map. A 52-seed power diagram is cheap enough
  // to re-tile per moved frame; idle frames (camera at rest) still cost one cached blit.
  // Само решение — в `staticLayerCache.ts` (REFM-60).
  const content = bakeSignature({
    vw: VW,
    vh: VH,
    dpr: DPR,
    me: ME,
    owners: ownersSig(),
    starfield: starfieldOn(),
  });
  const width = Math.round(VW * DPR);
  const baked = bgContent ? { signature: bgContent, cam: bgCam, width: bg.width } : null;
  if (!needsRebake(baked, { signature: content, cam, width })) return;
  bgContent = content;
  bgCam = { x: cam.x, y: cam.y, scale: cam.scale };
  bg.width = Math.round(VW * DPR);
  bg.height = Math.round(VH * DPR);
  const g = bgx;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, VW, VH);

  // 0) backdrop — deep-space fill + slow nebula clouds + a radar plotting grid +
  //    faint star ticks. Baked here (not per-frame) so idle frames stay cheap; the
  //    "alive" motion comes from the live layers (lane packets, scan sweep, fleets).
  g.fillStyle = '#02060c';
  g.fillRect(0, 0, VW, VH);
  // Graphics pref: `starfield` off leaves the flat fill + grid (nebulae/stars skipped).
  if (starfieldOn())
    for (const neb of NEBULAE) {
      const r = neb.r * (MOBILE ? 0.7 : 1);
      const grd = g.createRadialGradient(neb.x * VW, neb.y * VH, 0, neb.x * VW, neb.y * VH, r);
      grd.addColorStop(0, rgba(neb.color, 0.06));
      grd.addColorStop(0.45, rgba(neb.color, 0.024));
      grd.addColorStop(1, 'rgba(2,6,12,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, VW, VH);
    }
  // Шаг, смещение под камерой и куда лечь линиям — `backdropGrid.ts` (REFM-110).
  const gap = gridGap(cam.scale);
  g.lineWidth = 1;
  g.strokeStyle = GRID;
  g.beginPath();
  for (const x of gridLines(gridOffset(cam.x, gap), VW, gap)) {
    g.moveTo(x, 0);
    g.lineTo(x, VH);
  }
  for (const y of gridLines(gridOffset(cam.y, gap), VH, gap)) {
    g.moveTo(0, y);
    g.lineTo(VW, y);
  }
  g.stroke();
  if (starfieldOn())
    for (const st of STARS) {
      g.fillStyle = rgba('#9fe6e0', st.b);
      g.fillRect(st.x * VW, st.y * VH, 1, 1);
    }

  // PROVINCES — political map (Bytro-style). Every sector is a filled CELL of a
  // weighted Voronoi (power diagram) over the sector centres: the cells tile the
  // map and share borders, so a bigger `size` claims more territory and resizing
  // one shifts the shared borders with its neighbours evenly. Adjacency IS the
  // shared border — no lanes. (Empty void waypoints aren't real provinces → skipped.)
  // Отбор узлов и вес семени — `provinceMap.ts` (REFM-61): пустой узел не провинция,
  // вес растёт квадратично по масштабу, иначе карта перекраивается при зуме.
  const seeds = provinceSeeds(MAP, cam.scale, (n) => {
    const p = s.planets[n.id];
    return p ? { size: p.size ?? 1, at: world(n), owner: knownOwner(n.id) } : null;
  });
  // Clip cells to the MAP boundary (province bounding box + padding), not the
  // viewport — otherwise the outermost provinces stretch to the screen edge. This
  // gives the map a defined edge that pans/zooms with the camera.
  const frame = clipRect({ minX: MINX, maxX: MAXX, minY: MINY, maxY: MAXY });
  const tl = world(frame.topLeft);
  const br = world(frame.bottomRight);
  const clip = clipPolygon(tl, br);
  // Weighted-Voronoi political fill + classified borders — the shared @void/client
  // territory renderer clamps the weights (so no cell is swallowed), tessellates the
  // power diagram, fills each province in its owner's colour, and draws same-owner
  // inner hairlines vs glowing owner frontiers. Fog is honoured upstream: each seed
  // carries the owner AS THE VIEWER KNOWS IT (knownOwner), so a hidden capture never
  // repaints the map. Owned land is painted strongly (who-holds-what at a glance);
  // neutral stays a faint wash; a faint terrain tint reads through per sector kind.
  drawTerritory(g, seeds, clip, {
    ownerColor,
    neutralFill: COLOR.null!,
    kindAccent: (kind) => SECTOR_TYPES[kind]?.color,
  });

  // PATH NETWORK — thin roads between adjacent provinces (the visible "пути").
  // Movement runs along these; an army marches province-to-adjacent-province and
  // its route (drawAimPreview / drawFleetRoutes) traces them.
  g.strokeStyle = 'rgba(150,185,195,0.34)';
  g.lineWidth = 1.1;
  // Каждая дорога рисуется ОДИН раз — `setupMap.ts` (правило 1, REFM-127), та же
  // функция, что раскладывает трассы мини-карты сетапа. Здесь стоял свой цикл с тем же
  // сравнением идентификаторов: штрих полупрозрачный, и дважды нарисованная дорога
  // просто светлее соседних — «магистраль», которой в данных нет. Узлы без мира
  // отсеиваются до вызова, поэтому ссылка в никуда не даёт дороги.
  for (const road of lanes(MAP.filter((n) => !!s.planets[n.id]))) {
    const a = world(road.from);
    const b = world(road.to);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }

  // map boundary — a faint frame so the edge of the sector reads as intentional
  g.strokeStyle = 'rgba(90,130,140,0.35)';
  g.lineWidth = 1.5;
  g.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
}

/** Blit the cached static layer (device-pixel 1:1) beneath the live dynamic art. */
function blitStaticLayer(): void {
  buildStaticLayer(); // re-bakes at the live camera whenever it moved (else returns the cache)
  cx.save();
  cx.setTransform(1, 0, 0, 1, 0, 0); // backing pixels — the bake is always at the live camera, 1:1
  cx.drawImage(bg, 0, 0);
  cx.restore();
}

/** Draw the radar ranges of the selected sector: the OUTER signature radius (full
 *  reach, animated dashed) and the INNER full-reveal radius (half the reach, solid)
 *  — the two concentric ranges from shared-core visibility. The reach is a physical
 *  distance in map units; the projection is uniform so they read as true circles.
 *  Nothing is drawn for a sector with no radar. (Complements `drawRadarCoverage` —
 *  that shows ALL my sources persistently; this labels the selected one on tap.) */
function drawRadarRange(now: number): void {
  // Слой крепится к ВЫБРАННОМУ миру — нет выбора, нет и дальномера (REFM-109, правило 5).
  const p = selPlanet ? s.planets[selPlanet] : undefined;
  if (!p) return;
  // Рисовать ли слой и с какими радиусами — `radarSources.ts`, там же причина гейта
  // тумана: `planetRadar` читает ПОСТРОЙКИ мира, и без гейта тап по чужой
  // неисследованной системе был бы мгновенной разведкой одним касанием.
  const rings = rangeRings(
    { detailed: seesDetails(p), reach: planetRadar(p) },
    IDENTIFY_REACH_FRACTION,
  );
  if (rings.do !== 'draw') return;
  const reach = rings.signature;
  const c = world(p.position);
  const pulse = 0.5 + 0.5 * Math.sin(now / 600);
  // Радиус — ОДНО число, а не пара полуосей: проекция равномерна по осям, это обещание
  // камеры (`mapRadius.ts`, правило 2). Эллипс здесь обещал неравномерность, которой нет.
  const radiusPx = (rr: number): number => worldDist(rr);
  cx.save();
  cx.shadowColor = '#5ff0c0';
  cx.textAlign = 'left';
  cx.font = '700 10px ui-monospace,Menlo,monospace';

  // outer — signature reach (coarse blips in fog)
  const o = radiusPx(reach);
  cx.fillStyle = rgba('#5ff0c0', 0.04);
  cx.beginPath();
  cx.arc(c.x, c.y, o, 0, TAU);
  cx.fill();
  cx.setLineDash([6, 7]);
  cx.lineDashOffset = -now / 60;
  cx.strokeStyle = rgba('#5ff0c0', 0.34 + 0.18 * pulse);
  cx.lineWidth = 1.3;
  cx.shadowBlur = fxBlur(6);
  cx.stroke();
  cx.fillStyle = rgba('#aef6e6', 0.85);
  cx.fillText(`◌ SIGNATURE ${reach}`, c.x + o + 7, c.y + 3);

  // inner — full-reveal reach (contacts fully identified)
  const inner = rings.reveal; // та же доля, что у сводного покрытия (REFM-63, правило 4)
  const i = radiusPx(inner);
  cx.fillStyle = rgba('#5ff0c0', 0.06);
  cx.beginPath();
  cx.arc(c.x, c.y, i, 0, TAU);
  cx.fill();
  cx.setLineDash([]);
  cx.strokeStyle = rgba('#7df0d0', 0.6 + 0.2 * pulse);
  cx.lineWidth = 1.4;
  cx.shadowBlur = fxBlur(7);
  cx.stroke();
  cx.fillStyle = rgba('#aef6e6', 0.9);
  cx.fillText(`● REVEAL ${Math.round(inner)}`, c.x + i + 7, c.y - 7);
  cx.restore();
}

function render(now: number) {
  cx.setTransform(DPR, 0, 0, DPR, 0, 0); // draw in CSS pixels, crisp on hi-DPI
  // Semantic zoom (LOD): zoomed far out the map turns SCHEMATIC — holo type
  // badges, callout text, fleet pyramids/cargo/counts, orbit rings and battle
  // timers dissolve away (a globalAlpha cross-fade over scale 1.2→1.45, fully
  // schematic below), leaving territories, node art, fleet chevrons, battle
  // pulses and pings. Skipping those draws over the widest views — where the
  // most nodes are on screen at once — is also the frame-time win.
  // Сам закон и его следствия — `semanticZoom.ts` (REFM-93).
  const detail = detailAt(cam.scale);
  blitStaticLayer(); // backdrop + province political map (re-baked on camera move, else cached)
  drawCaptureFlashes(now); // wave over a just-flipped province, over the political fill
  drawScanSweep(now); // slow radar sweep — pure console chrome
  updateRadarContacts(now); // the arm paints enemy signatures as it crosses them
  updateThreatAlerts(); // «враг у ваших рубежей» — once per game step
  drawRadarCoverage(); // my sensor reach (radar arrays + ships)

  drawFleetRoutes();
  drawGoFlash(now); // brief ring on a world reached via a plan row's target link

  // battles — pulsing red contact ring at the actual clash point (an engaged
  // fleet's position, so a mid-lane intercept shows where it really happens) with a
  // live countdown to the next hourly damage round (the battle timer).
  const wave = (now / 900) % 1;
  for (const b of Object.values(s.battles)) {
    const anchor = battleAnchor(b);
    // Показывать ли бой и его таймер — `battleMark.ts` (REFM-118): под туманом отметки
    // нет вовсе, а отсчёт живёт только по назначенному ядром раунду.
    const roundAt = typeof b.nextRoundAt === 'number' ? b.nextRoundAt : undefined;
    const mark = battleMark({
      identified: known(b.location),
      hasPoint: !!anchor,
      detail,
      nextRoundAt: roundAt,
    });
    if (mark.do !== 'draw' || !anchor) continue;
    const c = world(anchor);
    if (!visible(c, 120)) continue;
    drawBattlePulse(c.x, c.y, wave, b.phase);
    if (mark.timer) {
      // `mark.timer` истинно только при назначенном раунде — отсюда и `!` ниже.
      cx.save();
      cx.globalAlpha = detail; // LOD: the timer text dissolves on the schematic view
      cx.font = '700 10px ui-monospace,Menlo,monospace';
      cx.textAlign = 'center';
      cx.fillStyle = b.phase === 'ground' ? '#f5cf6b' : '#ff8a7d';
      cx.fillText(
        `${b.phase === 'ground' ? t('map.badge.landing') : t('map.badge.orbit')} · ${timeLeft(roundAt!)}`,
        c.x,
        c.y - 28,
      );
      cx.restore();
    }
  }

  // orbital-AA flak (H2): a dashed ground-to-orbit tracer with a burst at the
  // target end, fading out — a fleet under AA fire no longer melts silently.
  if (aaShots.length) {
    const nowMs = performance.now();
    cx.save();
    for (let i = aaShots.length - 1; i >= 0; i--) {
      const shot = aaShots[i]!;
      // Жизнь и затухание трассы — `flashFx.ts` (REFM-70): своей шкалы у неё нет.
      if (flashDone(nowMs, shot.at, FLAK_LIFE_MS)) {
        aaShots.splice(i, 1);
        continue;
      }
      const a = world(shot.from);
      const b = world(shot.to);
      if (!visible(a, 160) && !visible(b, 160)) continue;
      const k = flashProgress(nowMs, shot.at, FLAK_LIFE_MS);
      const fade = fadeOf(k);
      // Два тира, два вида — таблицей в `flakTiers.ts` (REFM-112): часовой ОРБИТАЛЬНЫЙ
      // залп тяжелее и заметнее, чем 15-минутная БЛИЖНЯЯ зенитка, по всем осям сразу.
      const look = flakLook(flakTier(shot.close));
      cx.strokeStyle = rgba(look.color, look.alpha * fade);
      cx.lineWidth = look.width;
      cx.setLineDash([...look.dash]);
      cx.lineDashOffset = flakDashOffset(nowMs - shot.at); // трасса ползёт от поверхности
      cx.shadowColor = look.color;
      cx.shadowBlur = fxBlur(look.blur);
      cx.beginPath();
      cx.moveTo(a.x, a.y);
      cx.lineTo(b.x, b.y);
      cx.stroke();
      cx.setLineDash([]);
      cx.fillStyle = rgba(look.burstColor, 0.8 * fade);
      cx.beginPath();
      cx.arc(b.x, b.y, flakBurstRadius(look, k), 0, TAU);
      cx.fill();
    }
    cx.restore();
  }

  // Siege bombardment (artillery.fired): a ballistic ARC from the shooter to its
  // victim with a stagger of shell particles and impact bursts — the map answers
  // «who is shelling whom» at a glance. Endpoints are map-space; projected each
  // frame so the volley tracks pan/zoom.
  if (siegeShots.length) {
    const nowMs = performance.now();
    // Расписание залпа (жизнь, окно полёта каждого снаряда, окно его разрыва, углы
    // искр) — `volleyFx.ts` (REFM-111): фазы сцеплены, и врозь они разъезжаются.
    const VOLLEY: VolleySpec = { shells: 3, flightMs: 780, staggerMs: 130, burstMs: 520 };
    const { shells: SHELLS, flightMs: FLIGHT } = VOLLEY;
    const LIFE = volleyLife(VOLLEY);
    // LOD: the volley stays visible on the schematic view (a battle is a signal),
    // but compact — arcs/bursts shrink with the node art so they can't swallow a
    // zoomed-out province.
    const sk = artScale(detail);
    cx.save();
    for (let i = siegeShots.length - 1; i >= 0; i--) {
      const shot = siegeShots[i]!;
      const age = nowMs - shot.at;
      if (age > LIFE) {
        siegeShots.splice(i, 1);
        continue;
      }
      const a = world(shot.from);
      const b = world(shot.to);
      if (!visible(a, 200) && !visible(b, 200)) continue;
      // Форма дуги — `volleyFx.ts` (REFM-130, правила 6–8) там же, где её расписание:
      // навесной огонь читается только пока лоб дуги зажат полом и потолком, а сам
      // подъём ужимается вместе с артом узла.
      const lift = arcLift(Math.hypot(b.x - a.x, b.y - a.y), sk);
      const q = (t: number) => arcPoint(a, b, lift, t);
      // 1) the traced arc — a faint amber dashed path up to the lead shell.
      const lead = Math.min(1, age / FLIGHT);
      const pathFade = Math.max(0, 1 - age / LIFE);
      cx.strokeStyle = rgba('#ffb066', 0.34 * pathFade);
      cx.lineWidth = 1;
      cx.setLineDash([4, 5]);
      cx.lineDashOffset = -age / 16;
      cx.beginPath();
      cx.moveTo(a.x, a.y);
      // След идёт только ДО головного снаряда (правило 8): дорисованный до цели, он
      // читался бы как линия связи, обещающая ещё не случившееся попадание.
      for (const pt of arcPolyline(a, b, lift, lead)) cx.lineTo(pt.x, pt.y);
      cx.stroke();
      cx.setLineDash([]);
      // 2) the shells — bright tracer dots with a short glowing tail.
      cx.shadowColor = '#ffb066';
      for (let sh = 0; sh < SHELLS; sh++) {
        const t = shellT(age, sh, VOLLEY);
        if (t === null) continue;
        const pt = q(t);
        const tail = q(Math.max(0, t - 0.06));
        cx.strokeStyle = rgba('#ffd29b', 0.85);
        cx.lineWidth = 1.6;
        cx.shadowBlur = fxBlur(7);
        cx.beginPath();
        cx.moveTo(tail.x, tail.y);
        cx.lineTo(pt.x, pt.y);
        cx.stroke();
        cx.fillStyle = rgba('#fff1dc', 0.95);
        cx.beginPath();
        cx.arc(pt.x, pt.y, 1.7, 0, TAU);
        cx.fill();
      }
      cx.shadowBlur = 0;
      // 3) impacts — each landed shell pops an expanding ring + sparks on stable
      // per-volley angles (seeded — no per-frame randomness, replays stay clean).
      for (let sh = 0; sh < SHELLS; sh++) {
        const k = burstK(age, sh, VOLLEY);
        if (k === null) continue;
        const burstFade = 1 - k;
        // Hot core flash first — the «попал!» read — then the expanding ring.
        if (k < 0.45) {
          cx.fillStyle = rgba('#fff1dc', 0.9 * (1 - k / 0.45));
          cx.shadowColor = '#ff8a3d';
          cx.shadowBlur = fxBlur(10);
          cx.beginPath();
          cx.arc(b.x, b.y, (3.2 - k * 3) * sk, 0, TAU);
          cx.fill();
          cx.shadowBlur = 0;
        }
        cx.strokeStyle = rgba('#ff8a3d', 0.75 * burstFade);
        cx.lineWidth = 1.6;
        cx.beginPath();
        cx.arc(b.x, b.y, (2 + k * 14) * sk, 0, TAU);
        cx.stroke();
        cx.fillStyle = rgba('#ffd29b', 0.85 * burstFade);
        for (let spk = 0; spk < 5; spk++) {
          const ang = sparkAngle(shot.seed, sh, spk, 12);
          const r = (4 + k * 14) * sk;
          cx.beginPath();
          cx.arc(
            b.x + Math.cos(ang) * r,
            b.y + Math.sin(ang) * r * 0.8,
            Math.max(0.8, 1.3 * sk),
            0,
            TAU,
          );
          cx.fill();
        }
      }
    }
    cx.restore();
  }

  // selected sector: its radar detection radius (a physical circle in map space →
  // an axis-aligned ellipse on screen because the fit projection is non-uniform).
  drawRadarRange(now);

  // radar ping afterglow: as the sweep arm crosses a contact it flares, then the
  // imprint lingers (fading) until the arm comes back round — drawn behind the
  // blips so it reads as the contact glowing, not an overlay. Skips void nodes and
  // anything still fully unexplored.
  if (sweepOn) {
    cx.save();
    cx.globalCompositeOperation = 'lighter';
    for (const n of MAP) {
      const p = s.planets[n.id];
      if (!p) continue;
      const c = world(n);
      if (!visible(c, 60)) continue;
      // Кого подсвечивать и каким цветом — `sweepFx.ts` (REFM-113) поверх вида узла из
      // `fogView.ts`: помнимый горит НЕЙТРАЛЬНО, потому что владелец в памяти может быть
      // устаревшим, а никогда не виденный не выдаёт себя засветкой вовсе.
      const paint = sweepPaint(
        nodeView({ sector: n.sector, identified: known(n.id), remembered: memory.has(n.id) }),
      );
      if (paint.do !== 'paint') continue;
      const g = sweepGlow(c);
      if (!sweepShows(g)) continue;
      const col = paint.ownerColored ? ownerColor(p.owner) : '#6f8a93';
      blitGlow(col, c.x, c.y, 24, 0.42 * g); // cached glow disc (no per-node gradient)
    }
    cx.restore();
  }

  // planets — wireframe blips with sensor rings + monospace callouts.
  // LOD: the blip and every screen-space satellite around it (aura, sensor ring,
  // badges, sphere, ticks) draw at R×ns — 45% on the schematic view, so far-out
  // provinces aren't swallowed by their own markers (owner-reported APK pile-up
  // at min zoom: node art + badges + fx stacked on top of each other).
  cx.textAlign = 'left';
  const ns = artScale(detail); // node scale: schematic → detail (тот же закон, что у залпа)
  const R = 13 * ns;
  for (const n of MAP) {
    const p = s.planets[n.id];
    if (!p) continue;
    const c = world(n);
    if (!visible(c, 110)) continue;
    // Variant B: fog hides capturable systems (void cells stay as pure geometry).
    // Какой вид у узла — `fogView.ts` (REFM-62): пустой всегда виден, неопознанный
    // показывается ПАМЯТЬЮ, никогда не виденный — знаком вопроса.
    const kn = known(n.id);
    const mem = memory.get(n.id);
    const view = nodeView({ sector: n.sector, identified: kn, remembered: !!mem });
    if (view === 'remembered' || view === 'unexplored') {
      drawFogMarker(c, n.id, mem);
      continue;
    }
    const showOwner = p.owner;
    const col = ownerColor(p.owner);
    const ownerPulse = breath(now, {
      period: 620,
      base: 0.64,
      amp: 0.36,
      phase: phaseAt(n.x, n.y),
    });

    // empty-space sector: just a faint survey marker at its centre (no city, no
    // capture) — it is only a node you travel through.
    if (n.sector === 'empty') {
      cx.save();
      cx.strokeStyle = rgba(VOID_COLOR, 0.5);
      cx.lineWidth = 1;
      cx.beginPath();
      for (const [dx, dy] of CARDINAL) {
        cx.moveTo(c.x + dx * 1.5, c.y + dy * 1.5);
        cx.lineTo(c.x + dx * 3.5, c.y + dy * 3.5);
      }
      cx.stroke();
      cx.fillStyle = rgba(VOID_COLOR, 0.6);
      cx.beginPath();
      cx.arc(c.x, c.y, 1, 0, TAU);
      cx.fill();
      cx.restore();
      continue;
    }

    // province-type badge — a holographic type icon that HOVERS above the province:
    // a projected hologram (soft glow halo + holo capsule ring + a faint projector
    // tether down to the node), gently bobbing in the sector-type colour so the type
    // reads at a glance regardless of the bespoke art below (planet / asteroid / …).
    // Висит ли бейдж, где именно и как выглядит — `kindBadge.ts` (REFM-121): он оторван
    // от узла, чтобы не слиться с искусством сектора, и потому обязан тянуть к нему луч
    // проектора; покачивание фазируется координатами узла, иначе вся карта дрожит в такт.
    if (badgeShown(!!KIND_ICON[n.sector], detail)) {
      const kc = sectorTypeOf(n.id)?.color ?? '#9fb6bd';
      const look = badgeLook();
      const nodeTop = c.y - R;
      const bx = c.x;
      const by = badgeCenterY(nodeTop, badgeBob(now, n.x, n.y));
      const tether = badgeTether(nodeTop, by);
      cx.save();
      cx.globalAlpha = detail; // LOD: the hologram dissolves on the schematic view
      blitGlow(kc, bx, by, look.glowRadius, look.glowAlpha); // holographic bloom (cached disc)
      // projector tether — a faint dashed beam from the node up to the badge
      cx.strokeStyle = rgba(kc, look.tetherAlpha);
      cx.setLineDash([...look.tetherDash]);
      cx.lineWidth = 1;
      cx.beginPath();
      cx.moveTo(bx, tether.from);
      cx.lineTo(bx, tether.to);
      cx.stroke();
      cx.setLineDash([]);
      // holo capsule: translucent disc + bright rim + inner scanline ring
      cx.fillStyle = rgba(kc, look.fillAlpha);
      cx.beginPath();
      cx.arc(bx, by, BADGE_R, 0, TAU);
      cx.fill();
      cx.strokeStyle = rgba(kc, look.rimAlpha);
      cx.lineWidth = look.rimWidth;
      cx.beginPath();
      cx.arc(bx, by, BADGE_R, 0, TAU);
      cx.stroke();
      cx.strokeStyle = rgba(kc, look.scanAlpha);
      cx.beginPath();
      cx.arc(bx, by, BADGE_R - look.scanInset, 0, TAU);
      cx.stroke();
      // the type glyph, glowing in the sector colour
      cx.font = '700 15px ui-monospace,Menlo,monospace';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.shadowColor = kc;
      cx.shadowBlur = fxBlur(look.glyphBlur);
      cx.fillStyle = rgba(kc, look.glyphAlpha);
      cx.fillText(KIND_ICON[n.sector]!, bx, by + 0.5);
      cx.restore();
    }

    // asteroid-field sector: a lane junction, not a city — scattered rocks + a
    // fat hub where the lanes meet, no orbits. Captured by simply arriving — unless
    // a space fortress is raised here, which fortifies it (orbit + AA, must storm).
    if (n.sector === 'asteroid') {
      const fort = p.buildings.find((b) => b.type === 'starfort');
      blitGlow(col, c.x, c.y, 30, p.owner ? 0.16 : 0.06); // cached glow disc
      cx.save();
      cx.strokeStyle = 'rgba(186,170,140,0.7)';
      cx.fillStyle = 'rgba(42,40,33,0.72)';
      cx.lineWidth = 1;
      for (const rk of asteroidsFor(n.id, n.x, n.y)) {
        cx.save();
        cx.translate(c.x + rk.dx, c.y + rk.dy);
        cx.rotate(rk.rot + now / 9000);
        cx.beginPath();
        for (let k = 0; k < rk.sides; k++) {
          const a = (k / rk.sides) * TAU;
          const rr = rk.r * (0.72 + 0.28 * Math.sin(a * 2 + rk.rot));
          const px = Math.cos(a) * rr;
          const py = Math.sin(a) * rr;
          if (k) cx.lineTo(px, py);
          else cx.moveTo(px, py);
        }
        cx.closePath();
        cx.fill();
        cx.stroke();
        cx.restore();
      }
      cx.restore();
      // fat junction hub (the lanes converge here), owner-coloured
      blitGlow(col, c.x, c.y, 13, p.owner ? 0.5 : 0.3); // cached bloom, not shadowBlur
      cx.fillStyle = rgba(col, 0.92);
      cx.beginPath();
      cx.arc(c.x, c.y, 4.2, 0, TAU);
      cx.fill();
      cx.strokeStyle = rgba(col, 0.75);
      cx.lineWidth = 1.3;
      cx.beginPath();
      cx.arc(c.x, c.y, 7.5 + 0.6 * ownerPulse, 0, TAU);
      cx.stroke();
      // space fortress: a hexagonal bastion ring around the hub (with HP bar)
      if (fort) {
        cx.save();
        cx.strokeStyle = col;
        cx.lineWidth = 1.6;
        cx.shadowColor = col;
        cx.shadowBlur = fxBlur(8);
        poly(c.x, c.y, 12, 6, Math.PI / 6);
        cx.stroke();
        poly(c.x, c.y, 7, 6, Math.PI / 6);
        cx.stroke();
        cx.restore();
        const frac = Math.max(0, Math.min(1, fort.hp / hpOfLevel('starfort', fort.level)));
        cx.fillStyle = 'rgba(2,9,13,.7)';
        cx.fillRect(c.x - 12, c.y - 22, 24, 3);
        cx.fillStyle = rgba(frac > 0.35 ? col : '#ff5a4d', 0.9);
        cx.fillRect(c.x - 12, c.y - 22, 24 * frac, 3);
      }
      if (selPlanet === n.id) targetBrackets(c.x, c.y, fort ? 18 : 15, now);
      cx.save();
      cx.shadowColor = 'rgba(0,0,0,0.85)';
      cx.shadowBlur = fxBlur(3);
      if (fort) {
        // a fortress stays a prominent, special designation (unchanged)
        cx.fillStyle = p.owner ? col : '#9fc9c4';
        cx.font = '700 11px ui-monospace,Menlo,monospace';
        cx.fillText(n.id, c.x + 16, c.y - 1);
        cx.fillStyle = 'rgba(150,210,205,0.55)';
        cx.font = '9px ui-monospace,Menlo,monospace';
        cx.fillText('void fortress ✦', c.x + 16, c.y + 11);
      } else {
        // a plain asteroid field is a minor sector — de-emphasised (dim, smaller)
        cx.fillStyle = p.owner ? rgba(col, 0.72) : 'rgba(150,190,196,0.5)';
        cx.font = '600 10px ui-monospace,Menlo,monospace';
        cx.fillText(n.id, c.x + 16, c.y - 1);
        cx.fillStyle = 'rgba(150,210,205,0.38)';
        cx.font = '9px ui-monospace,Menlo,monospace';
        cx.fillText('asteroid field', c.x + 16, c.y + 11);
      }
      cx.restore();
      continue;
    }

    // territory aura — cached glow disc (no per-node gradient)
    blitGlow(col, c.x, c.y, R + 34 * ns, showOwner ? 0.3 : 0.1);

    // sensor-range ring (dashed, faint)
    cx.save();
    cx.setLineDash([3, 5]);
    cx.lineDashOffset = -now / 180;
    cx.strokeStyle = rgba(col, 0.18 + 0.13 * ownerPulse);
    cx.lineWidth = 1;
    cx.beginPath();
    cx.arc(c.x, c.y, R + (14 + 2 * ownerPulse) * ns, 0, TAU);
    cx.stroke();
    cx.restore();

    // fort = hex containment ring
    if (kn && p.buildings.some((b) => b.type === 'fort')) {
      cx.strokeStyle = rgba(col, 0.5);
      cx.lineWidth = 1;
      poly(c.x, c.y, R + 6 * ns, 6, Math.PI / 6);
      cx.stroke();
    }

    // building badges are detail-only: on the schematic view the province colour
    // and score already tell the story — a row of 10px chips just piles onto the
    // shrunken blip (the APK min-zoom overlap).
    // Раскладку ряда считает `buildChips.ts` (REFM-122): ряд ЦЕНТРИРОВАН под узлом (иначе
    // мир будто съезжает вбок при каждой достройке), сжимается вместе с маркером, а у
    // кегля есть пол — буква мельче семи пикселей читается как сор, а не как значок.
    if (chipsShown(kn, p.buildings.length, detail)) {
      cx.save();
      cx.globalAlpha = detail;
      cx.font = `${chipFontPx(ns)}px ui-monospace,Menlo,monospace`;
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      const { half } = chipMetrics(ns);
      const xs = chipXs(p.buildings.length, c.x, ns);
      const by = chipY(c.y, R, ns);
      for (let i = 0; i < p.buildings.length; i++) {
        const b = p.buildings[i];
        if (!b) continue;
        const bx = xs[i]!;
        cx.fillStyle = 'rgba(2,9,13,.78)';
        cx.strokeStyle = rgba(col, 0.55);
        cx.lineWidth = 1;
        cx.beginPath();
        cx.rect(bx - half, by - half, half * 2, half * 2);
        cx.fill();
        cx.stroke();
        cx.fillStyle = rgba(col, 0.9);
        cx.fillText(chipGlyph(BUILD_ICON[b.type]), bx, by + 0.5);
      }
      cx.restore();
    }

    if (n.sector === 'planet') {
      // Planet: holographic volume — a lit sphere inside the ring, subtle at far view,
      // blooming to full once you zoom into a region
      blitSphere(col, c.x, c.y, R, sphereBloom(cam.scale));

      // wireframe body + bright core (glow comes from the cached aura/bloom discs,
      // not shadowBlur — shadowBlur per node per frame is a major CPU cost)
      blitGlow(col, c.x, c.y, R + 7, showOwner ? 0.22 : 0.12);
      cx.strokeStyle = col;
      cx.lineWidth = 2;
      cx.beginPath();
      cx.arc(c.x, c.y, R, 0, TAU);
      cx.stroke();
      cx.fillStyle = rgba(col, 0.72 + 0.28 * ownerPulse);
      cx.beginPath();
      cx.arc(c.x, c.y, 2.6 + 1.2 * ownerPulse, 0, TAU);
      cx.fill();

      // N/E/S/W crosshair ticks
      cx.strokeStyle = rgba(col, 0.7);
      cx.lineWidth = 1.2;
      cx.beginPath();
      for (const [dx, dy] of CARDINAL) {
        cx.moveTo(c.x + dx * (R - 3), c.y + dy * (R - 3));
        cx.lineTo(c.x + dx * (R + 5), c.y + dy * (R + 5));
      }
      cx.stroke();
    } else if (n.sector === 'nebula' || n.sector === 'dense_nebula') {
      // Nebula: soft diamond (rotated square) with diffuse glow
      const kc = sectorTypeOf(n.id)?.color ?? col;
      const dr = R * 0.85;
      blitGlow(kc, c.x, c.y, R + 7, showOwner ? 0.2 : 0.1);
      cx.save();
      cx.strokeStyle = rgba(kc, 0.7);
      cx.fillStyle = rgba(kc, 0.12 + 0.08 * ownerPulse);
      cx.lineWidth = 1.6;
      cx.beginPath();
      cx.moveTo(c.x, c.y - dr);
      cx.lineTo(c.x + dr, c.y);
      cx.lineTo(c.x, c.y + dr);
      cx.lineTo(c.x - dr, c.y);
      cx.closePath();
      cx.fill();
      cx.stroke();
      // inner diamond (scanline effect)
      cx.strokeStyle = rgba(kc, 0.3);
      cx.lineWidth = 1;
      const ir = dr * 0.55;
      cx.beginPath();
      cx.moveTo(c.x, c.y - ir);
      cx.lineTo(c.x + ir, c.y);
      cx.lineTo(c.x, c.y + ir);
      cx.lineTo(c.x - ir, c.y);
      cx.closePath();
      cx.stroke();
      // core dot
      cx.fillStyle = rgba(kc, 0.7 + 0.3 * ownerPulse);
      cx.beginPath();
      cx.arc(c.x, c.y, 2, 0, TAU);
      cx.fill();
      cx.restore();
    } else if (n.sector === 'ion_storm' || n.sector === 'solar_flare') {
      // Storm: spiky burst (6-pointed star)
      const kc = sectorTypeOf(n.id)?.color ?? col;
      const outerR = R * 0.9;
      const innerR = R * 0.4;
      const spikes = n.sector === 'ion_storm' ? 5 : 8;
      blitGlow(kc, c.x, c.y, R + 7, showOwner ? 0.22 : 0.1);
      cx.save();
      cx.strokeStyle = rgba(kc, 0.75);
      cx.fillStyle = rgba(kc, 0.1 + 0.06 * ownerPulse);
      cx.lineWidth = 1.4;
      cx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i / (spikes * 2)) * TAU - Math.PI / 2;
        const rr = i % 2 === 0 ? outerR : innerR;
        if (i === 0) cx.moveTo(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr);
        else cx.lineTo(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr);
      }
      cx.closePath();
      cx.fill();
      cx.stroke();
      // core dot
      cx.fillStyle = rgba(kc, 0.7 + 0.3 * ownerPulse);
      cx.beginPath();
      cx.arc(c.x, c.y, 2, 0, TAU);
      cx.fill();
      cx.restore();
    } else if (n.sector === 'graveyard') {
      // Derelict Graveyard: scattered debris fragments around a dim hub
      const kc = sectorTypeOf(n.id)?.color ?? col;
      blitGlow(kc, c.x, c.y, R + 5, showOwner ? 0.16 : 0.06);
      cx.save();
      cx.strokeStyle = rgba(kc, 0.5);
      cx.lineWidth = 1.2;
      // scattered wreck fragments — short dashes at fixed angles
      const frags = [0, 0.7, 1.5, 2.3, 3.1, 4.0, 4.9, 5.6];
      for (const a of frags) {
        const r0 = 5 + 2 * Math.sin(a * 3.7);
        const r1 = 9 + 3 * Math.sin(a * 2.1 + 1);
        cx.beginPath();
        cx.moveTo(c.x + Math.cos(a) * r0, c.y + Math.sin(a) * r0);
        cx.lineTo(c.x + Math.cos(a) * r1, c.y + Math.sin(a) * r1);
        cx.stroke();
      }
      // dim centre hub
      cx.fillStyle = rgba(kc, 0.5 + 0.2 * ownerPulse);
      cx.beginPath();
      cx.arc(c.x, c.y, 3, 0, TAU);
      cx.fill();
      cx.strokeStyle = rgba(kc, 0.4);
      cx.beginPath();
      cx.arc(c.x, c.y, 7, 0, TAU);
      cx.stroke();
      cx.restore();
    } else if (n.sector === 'dead_world') {
      // Dead World: broken/dashed circle with an X through it
      const kc = sectorTypeOf(n.id)?.color ?? col;
      blitGlow(kc, c.x, c.y, R + 5, showOwner ? 0.16 : 0.08);
      cx.save();
      cx.setLineDash([4, 4]);
      cx.strokeStyle = rgba(kc, 0.6);
      cx.lineWidth = 1.6;
      cx.beginPath();
      cx.arc(c.x, c.y, R * 0.8, 0, TAU);
      cx.stroke();
      cx.setLineDash([]);
      // cross through the centre (the "dead" mark)
      const xr = R * 0.45;
      cx.strokeStyle = rgba(kc, 0.45);
      cx.lineWidth = 1.3;
      cx.beginPath();
      cx.moveTo(c.x - xr, c.y - xr);
      cx.lineTo(c.x + xr, c.y + xr);
      cx.moveTo(c.x + xr, c.y - xr);
      cx.lineTo(c.x - xr, c.y + xr);
      cx.stroke();
      // dim core dot
      cx.fillStyle = rgba(kc, 0.5 + 0.2 * ownerPulse);
      cx.beginPath();
      cx.arc(c.x, c.y, 2, 0, TAU);
      cx.fill();
      cx.restore();
    } else {
      // Fallback for any other non-planet type: small hexagon marker
      const kc = sectorTypeOf(n.id)?.color ?? col;
      blitGlow(kc, c.x, c.y, R + 5, showOwner ? 0.14 : 0.06);
      cx.save();
      cx.strokeStyle = rgba(kc, 0.55);
      cx.fillStyle = rgba(kc, 0.08);
      cx.lineWidth = 1.4;
      poly(c.x, c.y, R * 0.7, 6, Math.PI / 6);
      cx.fill();
      cx.stroke();
      cx.fillStyle = rgba(kc, 0.5 + 0.2 * ownerPulse);
      cx.beginPath();
      cx.arc(c.x, c.y, 2, 0, TAU);
      cx.fill();
      cx.restore();
    }

    if (selPlanet === n.id) targetBrackets(c.x, c.y, R + 10, now);

    // callout: id + garrison/buildings, monospace. Worlds (planets — the capturable
    // prize) get a BRIGHT designation; every other sector is de-emphasised to a dim,
    // smaller coordinate so the map reads "worlds first" (fogged → no telemetry).
    // LOD: callout text dissolves on the schematic view — except YOUR OWN worlds,
    // which stay labelled like city names on a globe (your anchor at any zoom).
    // Тир подписи, её чернила и судьба второй строки — `nodeCallout.ts` (REFM-117):
    // мир подписан ярче транзитного сектора, цвет владельца несёт РАЗВЕДДАННЫЕ, а
    // пустой тихий сектор молчит, чтобы не сорить «G:0 B:—» вдоль всего маршрута.
    const tier = calloutTier(n.sector);
    const isWorld = tier === 'world';
    const mineWorld = isWorld && p.owner === ME;
    const callout = calloutAlpha(detail, mineWorld);
    if (callout === 0) continue;
    const g = p.garrison.reduce((a, st) => a + st.count, 0);
    const line = calloutLine({
      identified: kn,
      detail,
      tier,
      garrison: g,
      buildings: p.buildings.length,
    });
    const ink = calloutInk(kn, !!p.owner);
    cx.save();
    cx.globalAlpha = callout;
    cx.shadowColor = 'rgba(0,0,0,0.85)';
    cx.shadowBlur = fxBlur(3);
    if (isWorld) {
      cx.fillStyle =
        ink === 'owner' ? col : ink === 'neutral' ? '#9fc9c4' : 'rgba(120,140,150,0.55)';
      cx.font = '700 12px ui-monospace,Menlo,monospace';
    } else {
      cx.fillStyle =
        ink === 'owner'
          ? rgba(col, 0.72)
          : ink === 'neutral'
            ? 'rgba(150,190,196,0.5)'
            : 'rgba(120,140,150,0.4)';
      cx.font = '600 10px ui-monospace,Menlo,monospace';
    }
    cx.fillText(n.id, c.x + R + 12, c.y - 1);
    if (line.do === 'stats') {
      const icons = p.buildings.map((b) => BUILD_ICON[b.type] ?? '▪').join('');
      cx.fillStyle = rgba('#96d2cd', isWorld ? 0.6 : 0.42);
      cx.font = isWorld ? '10px ui-monospace,Menlo,monospace' : '9px ui-monospace,Menlo,monospace';
      cx.fillText(`G:${g}  B:${icons || '—'}`, c.x + R + 12, c.y + (isWorld ? 12 : 11));
    } else if (line.do === 'unknown') {
      cx.fillStyle = 'rgba(110,130,140,0.5)';
      cx.font = '10px ui-monospace,Menlo,monospace';
      cx.fillText('· no telemetry', c.x + R + 12, c.y + 12);
    }
    cx.restore();
  }

  // the orbit ring around any CITY that holds a stationed fleet (a single orbit).
  // Asteroid-field junctions have no orbits, so they are skipped.
  const stationed: Record<string, Fleet[]> = {};
  for (const f of Object.values(s.fleets))
    if (f.location && !f.movement) {
      if (!fleetSeen(f)) continue; // hidden enemy orbit (no identify, no intel window)
      (stationed[f.location] ??= []).push(f);
    }
  for (const pid of Object.keys(stationed)) {
    const pl = s.planets[pid];
    if (!pl) continue;
    // У кого кольцо ЕСТЬ — `orbitRing.ts` (REFM-114), там же и его геометрия: город имеет
    // орбиту по типу, а узел-развязка получает её только УКРЕПЛЁННЫМ (крепость или живой
    // гарнизон) — такой узел приходится штурмовать, а штурм идёт с орбиты.
    const shown = ringShown(
      {
        typeHasOrbit: !!sectorTypeOf(pid)?.orbit,
        starfort: pl.buildings.some((b) => b.type === 'starfort'),
        garrison: pl.garrison ?? [],
        parked: stationed[pid]?.length ?? 0,
      },
      detail,
    );
    if (!shown) continue;
    const pc = world(pl.position);
    if (!visible(pc, 80)) continue;
    // A single orbit ring (GDD §7.4) — one orbit, so no N/F labels cluttering the map.
    const rr = orbitRingRadius(pl);
    cx.save();
    cx.globalAlpha = detail;
    cx.setLineDash([2, 5]);
    cx.lineDashOffset = now / 200;
    cx.strokeStyle = rgba(ORBIT_COLOR, 0.4);
    cx.lineWidth = 1.3;
    cx.beginPath();
    cx.arc(pc.x, pc.y, rr, 0, TAU);
    cx.stroke();
    cx.restore();
  }

  // fleets — glowing chevrons on their orbit ring (stationed) or along the lane
  cx.textAlign = 'center';
  for (const f of Object.values(s.fleets)) {
    if (!fleetSeen(f)) {
      // not identified and no intel window: a radar contact is shown only as a
      // swept signature (drawRadarContacts), painted by the arm — never live here.
      continue;
    }
    const A = fleetAnchor(f);
    if (!A || !visible(A, 120)) continue;
    const col = ownerColor(f.owner);
    // Squadrons ABOARD a carrier live in the hold, not in the battle line: with any
    // non-squadron hull present they leave the triangle pyramid and ride the cargo
    // tail as diamonds. A pure strike wing in flight IS its squadrons — triangles.
    // Три числа эмблемы — `fleetTally.ts` (REFM-115). Развилка там же: пока есть хоть
    // один КОРПУС, крыло едет грузом; корпусов нет — крыло и есть флот.
    const { ships, wingPips, troops } = emblemTally(f.units, f.landing ?? [], isSquadron);
    // Фаза от ХЭША идентификатора, а не от его длины (`pulseFx.ts`, правило 2): у
    // «p1-1» и «p2-3» длина одна, и все флоты матча заводили двигатели в такт.
    const engine = breath(now, { period: 120, base: 0.55, amp: 0.45, phase: phaseOfId(f.id) });

    // bombardment beam down to the planet
    if (f.bombarding && f.location) {
      const target = s.planets[f.location];
      if (target) {
        const pc = world(target.position);
        const spark = breath(now, { period: 90, base: 0.45, amp: 0.55, phase: phaseOfId(f.id) });
        cx.save();
        cx.strokeStyle = rgba('#ffb15f', 0.3 + 0.3 * spark);
        cx.lineWidth = 1.2 + spark;
        cx.shadowColor = '#ffb15f';
        cx.shadowBlur = fxBlur(12);
        cx.beginPath();
        cx.moveTo(A.x, A.y);
        cx.lineTo(pc.x, pc.y);
        cx.stroke();
        cx.restore();
      }
    }

    // contact trail while moving
    if (f.movement) {
      for (let i = 1; i <= 4; i++) {
        cx.fillStyle = rgba(col, 0.33 - 0.055 * i);
        cx.beginPath();
        cx.arc(
          A.x - Math.cos(A.ang) * i * (8 + engine * 2),
          A.y - Math.sin(A.ang) * i * (8 + engine * 2),
          2.8 - 0.35 * i,
          0,
          TAU,
        );
        cx.fill();
      }
    }

    // LOD: far out a fleet is ONE glowing chevron, nose on course — the pyramid,
    // cargo pips and ship count cross-fade away (schematic view keeps who/where).
    if (detail < 1) {
      cx.save();
      cx.globalAlpha = chevronAlpha(detail);
      cx.translate(A.x, A.y);
      cx.rotate(A.ang + Math.PI / 2);
      cx.shadowColor = col;
      cx.shadowBlur = fxBlur(5 + 4 * engine);
      cx.fillStyle = rgba(col, 0.92);
      cx.strokeStyle = 'rgba(4,10,12,.8)';
      cx.lineWidth = 1;
      cx.beginPath();
      cx.moveTo(0, -7);
      cx.lineTo(5.5, 5);
      cx.lineTo(-5.5, 5);
      cx.closePath();
      cx.fill();
      cx.stroke();
      cx.restore();
    }
    if (detail === 0) {
      // selection still reads on the schematic view; the rest of the kit is gone
      if (selFleet === f.id || selFleets.has(f.id)) targetBrackets(A.x, A.y, 12, now);
      continue;
    }
    cx.globalAlpha = detail; // full detail fades back in toward 1.45

    // Fleet emblem (постер «Типы кораблей»): ОДИН силуэт ДОМИНАНТА — сильнейшего
    // корабля флота — вместо пирамиды треугольников; количество несёт счётчик
    // «×N» за хвостом («флот на карте = доминант + счёт», полный состав — в
    // панели выделения). Размер S/M/L по hp доминанта, гало-кольцо при щите
    // (у флагмана — всегда), нос по курсу — heading от fleetAnchor, как раньше;
    // карго-хвост и счётчик едут по тому же курсу.
    const dom = dominantUnit(f.units, data);
    const arch = dom ? unitArchetype(dom.def) : 'combat';
    // Размер — из ЕДИНОЙ таблицы постера (`unitGlyphs.ts`, правило 1). Здесь стояла
    // своя (S 0.62 · M 0.8), и один и тот же разведчик был в панели заметно крупнее,
    // чем на карте: «размер = hp» переставал быть шкалой ровно там, где ею пользуются.
    const domK = glyphScale(dom ? unitSizeClass(dom.def.stats.hp ?? 0) : 'S');
    const domStack = dom ? f.units.find((st) => st.unit === dom.unit && st.count > 0) : undefined;
    const domShield =
      dom && domStack ? (effectiveStats(dom.def, domStack, data).shield ?? 0) > 0 : false;
    cx.save();
    cx.translate(A.x, A.y);
    cx.rotate(A.ang + Math.PI / 2);
    cx.shadowColor = col;
    cx.shadowBlur = fxBlur(6 + 6 * engine);
    if (glyphHalo(arch, domShield)) {
      // Модификатор «есть щит» (у флагмана — всегда): пунктирная орбита вокруг силуэта.
      // Само правило — в `unitGlyphs.ts` (правило 2); РАДИУС здесь свой и намеренно:
      // на карте бокса нет, кольцо обязано ехать за силуэтом (правило 3).
      cx.strokeStyle = rgba(col, 0.7);
      cx.lineWidth = 1.1;
      cx.setLineDash([2.6, 2.8]);
      cx.beginPath();
      cx.arc(0, 0, 12.5 * domK + 2, 0, TAU);
      cx.stroke();
      cx.setLineDash([]);
    }
    cx.scale(domK, domK);
    cx.translate(-12, -12);
    cx.fillStyle = rgba(col, 0.92);
    cx.strokeStyle = 'rgba(4,10,12,.8)';
    cx.lineWidth = 1;
    const p2d = archPath2d(arch);
    cx.fill(p2d, 'evenodd');
    cx.stroke(p2d);
    cx.restore();

    // cargo glued to the tail (behind the base, following the heading), SPLIT by
    // shape so counts read at a glance: row 1 — only diamonds (carried divisions,
    // hold squadrons — «ромбик размером с квадратик»), row 2 — only squares (ground
    // troops). A loading pip (~1h) fills up in place inside its shape's row. Cell
    // centres ride the rotated baseline, the pips themselves stay upright.
    const loads = pendingLoads.filter((p) => p.fleetId === f.id); // empty for enemy/idle fleets
    // Кто в каком ряду — `markerTail.ts` (REFM-116): ряды делятся по ФОРМЕ, и
    // грузящаяся единица встаёт в ряд своей формы, а не отдельным рядом «в пути».
    const { diamonds: diaRow, squares: sqRow } = cargoRows(wingPips, troops, loads, isSquadron);
    type CargoPip = (typeof diaRow)[number];
    // The same rotation the pyramid uses; local +y = the tail. Pips and the ship
    // count are placed through this, drawn upright at their rotated spots.
    // Стоящий у мира флот ниже ORBIT_ZOOM_IN стоит РАДИАЛЬНО, и его хвост смотрел
    // внутрь орбиты — после ужатия кольца пипсы ложились на диск планеты; для этой
    // позы хвост разворачивается наружу (геометрия и причина — markerTail.ts).
    const staticDock = !f.movement && f.location !== null && !orbitsLive();
    const th = tailTheta(A.ang, staticDock);
    const tailAt = (lx: number, ly: number): { x: number; y: number } =>
      tailPoint(A.x, A.y, th, lx, ly);
    const CELL = CARGO_CELL,
      SQ = 5,
      DS = 3.1; // squadron pip: a diamond with the footprint of the square
    const diamond = (cxr: number, cyr: number, r: number, fill: boolean): void => {
      cx.beginPath();
      cx.moveTo(cxr, cyr - r);
      cx.lineTo(cxr + r, cyr);
      cx.lineTo(cxr, cyr + r);
      cx.lineTo(cxr - r, cyr);
      cx.closePath();
      if (fill) cx.fill();
      cx.stroke();
    };
    const drawCargoRow = (row: CargoPip[], ly: number): void => {
      if (!row.length) return;
      // Обрезка по пределу и центровка (с учётом «+N») — `markerTail.ts`.
      const { shown: n, over, firstX } = cargoRowLayout(row.length);
      let lx = firstX;
      cx.save();
      cx.shadowColor = col;
      cx.shadowBlur = fxBlur(3);
      cx.lineWidth = 1;
      for (let i = 0; i < n; i++) {
        const pip = row[i]!;
        const c0 = tailAt(lx, ly);
        if (pip.kind === 'wing') {
          // hold squadron → a solid diamond ("ромбик")
          cx.fillStyle = rgba(col, 0.85);
          cx.strokeStyle = rgba(col, 0.95);
          diamond(c0.x, c0.y, DS, true);
        } else if (pip.kind === 'troop') {
          // loaded troop → solid square
          const x = c0.x - SQ / 2,
            y = c0.y - SQ / 2;
          cx.fillStyle = rgba(col, 0.85);
          cx.fillRect(x, y, SQ, SQ);
          cx.strokeStyle = rgba(col, 0.95);
          cx.strokeRect(x + 0.5, y + 0.5, SQ - 1, SQ - 1);
        } else {
          // loading pip → fills in place over ~1h (squadron = growing diamond,
          // ground troop = empty square filling bottom-up)
          const p = pip.load!;
          const prog = loadFill(s.time, p.startAt, p.doneAt); // зажат — `markerTail.ts`
          if (isSquadron(p.unit)) {
            cx.strokeStyle = rgba(col, 0.85);
            diamond(c0.x, c0.y, DS, false);
            if (prog > 0) {
              cx.fillStyle = rgba(col, 0.8);
              cx.strokeStyle = rgba(col, 0);
              diamond(c0.x, c0.y, DS * prog, true);
            }
          } else {
            const x = c0.x - SQ / 2,
              y = c0.y - SQ / 2;
            cx.strokeStyle = rgba(col, 0.85);
            cx.strokeRect(x + 0.5, y + 0.5, SQ - 1, SQ - 1);
            if (prog > 0) {
              const fh = (SQ - 1) * prog;
              cx.fillStyle = rgba(col, 0.8);
              cx.fillRect(x + 0.5, y + 0.5 + (SQ - 1 - fh), SQ - 1, fh);
            }
          }
        }
        lx += CELL;
      }
      cx.restore();
      if (over > 0) {
        const o = tailAt(lx, ly);
        cx.fillStyle = rgba(col, 0.92);
        cx.font = '700 8px ui-monospace,Menlo,monospace';
        cx.fillText(`+${over}`, o.x, o.y + SQ / 2);
      }
    };
    drawCargoRow(diaRow, 5); // ромбы — ближний к базе ряд
    drawCargoRow(sqRow, squareRowY(5, diaRow.length)); // квадраты — ниже, если ромбы есть

    if (f.owner === ME && chainStepsOf(f.id)) {
      // TGT-1: an army carrying a standing plan breathes a dashed accent ring —
      // one glance tells which fleets are already "spoken for".
      const pu = breath(now, { period: 300, base: 0.5, amp: 0.5, phase: phaseOfId(f.id) });
      cx.save();
      cx.strokeStyle = rgba(ownerColor(ME), 0.3 + 0.4 * pu);
      cx.lineWidth = 1.3;
      cx.setLineDash([4, 4]);
      cx.beginPath();
      cx.arc(A.x, A.y, 12.5, 0, TAU);
      cx.stroke();
      cx.restore();
    }
    // Радиус артиллерии и линию огня рисует слой RANGE-UX (`drawCombatRanges` поверх
    // `combatRanges.ts`) — ровно для тех же выбранных флотов. Здесь стояла ВТОРАЯ копия
    // того же кольца, другим цветом и пунктиром: два кольца одного радиуса каждый кадр
    // (REFM-123). Осталась только рамка выбора.
    if (selFleet === f.id || selFleets.has(f.id)) targetBrackets(A.x, A.y, 15, now);

    // ship count («×N» — счёт при доминанте, как на постере), small, past the
    // cargo tail — placed along the heading like the pips, glyph upright.
    const cnt = tailAt(0, tallyY(21, diaRow.length, sqRow.length));
    cx.fillStyle = rgba(col, 0.95);
    cx.font = '700 10px ui-monospace,Menlo,monospace';
    cx.fillText(`×${ships}`, cnt.x, cnt.y);

    cx.globalAlpha = 1; // end of the per-fleet LOD cross-fade
  }

  drawRadarContacts(now); // swept enemy signatures — last-known ghosts until repainted

  if (selectionBox) {
    const x = Math.min(selectionBox.x1, selectionBox.x2);
    const y = Math.min(selectionBox.y1, selectionBox.y2);
    const w = Math.abs(selectionBox.x2 - selectionBox.x1);
    const h = Math.abs(selectionBox.y2 - selectionBox.y1);
    cx.save();
    cx.fillStyle = 'rgba(53,214,230,.08)';
    cx.strokeStyle = LOCK;
    cx.setLineDash([5, 4]);
    cx.lineWidth = 1.2;
    cx.fillRect(x, y, w, h);
    cx.strokeRect(x, y, w, h);
    cx.restore();
  }
  drawPings(now); // ally ping markers (coalition), with screen hit-boxes for taps
  drawChainOverlay(now); // CHAIN-UX: цепочки планов + черновик режима «Приказ»
  drawAssaultTargets();
  drawCorridors(now); // HERO-CORRIDOR: временные коридоры героев
  drawCombatRanges(); // RANGE-UX: артиллерия / эскадрилья / ПВО — до прицельных линий
  drawAbilityRings(); // ABIL-RING: уже работающие ауры и сканы — фиолетовым пунктиром
  drawAimPreview();
  drawCastAim(); // CAST-UX: дальность каста + область действия
}

// --- side panel --------------------------------------------------------------

// Кирпичики панели (кнопка, шапка, вкладка, колонки, строки состава) живут в
// `panelKit.ts` (REFM-35) — там же правила экранирования и «disabled, а не спрятать».
const btn = actionButton;
function cardHeader(color: string, title: string, sub: string, titleAct?: string): string {
  return kitCardHeader(color, title, sub, {
    compact: pcUi(),
    ...(titleAct ? { titleAct } : {}),
  });
}
function tabButton(tab: PlanetTab, label: string, count: number, desc?: string): string {
  return kitTabButton(tab, label, count, planetTab === tab, desc);
}
function unitRows(stacks: Array<{ unit: string; count: number }>): string {
  return kitUnitRows(
    stacks,
    (unit) => ({
      icon: unitIconHtml(unit, data, youColor, 18),
      name: displayUnit(unit),
      domain: isGround(unit) ? t('side.unit.ground') : t('side.unit.space'),
    }),
    t('side.none'),
  );
}
/** Localized one-line label for a paused site (shares `ConstructionPayload`'s field
 *  names, so `constructionLabel` reads it directly — the extra `id`/`progress`/
 *  `remainingHours`/`remainingCost` fields are simply ignored). */
function pausedLabel(site: PausedConstructionSite): string {
  return constructionLabel(site);
}
function conveyorHtml(planetId: string, lane: BuildLane): string {
  // Разметку собирает `conveyorView.ts` (REFM-36) — там же правило «живые числа не
  // входят в подпись панели» и «очередь без денег называет цену».
  const active = activeConstruction(planetId, lane);
  const queued = queueOf(planetId)[lane];
  const head = queued[0];
  return kitConveyorHtml(
    planetId,
    lane,
    {
      active: active
        ? {
            label: constructionLabel(active.payload),
            at: active.at,
            durationMs: buildDurationHours(active.payload) * HOUR,
            seq: active.seq,
          }
        : null,
      queued: queued.map((q) => ({ label: queuedLabel(q) })),
      paused: (s.planets[planetId]?.pausedConstruction ?? [])
        .filter((p) => laneOf(p.kind) === lane)
        .map((p) => ({ id: p.id, label: pausedLabel(p), progress: p.progress })),
      // Строку «ждём цену» показываем только на ПК: на телефоне место дороже.
      waitingCost:
        !active && pcUi() && head && !canStartQueued(planetId, head)
          ? cost(buildCost(planetId, head), myRes())
          : null,
      compact: pcUi(),
    },
    {
      now: t('side.conveyor.now'),
      cancel: t('side.conveyor.cancel.title'),
      waiting: (c) => t('side.conveyor.waiting', { c }),
      idle: t('side.conveyor.idle'),
      idleTag: t('side.conveyor.idle.tag'),
      idleSub: t('side.conveyor.idle.sub'),
      dequeue: t('side.conveyor.dequeue.title'),
      queueEmpty: t('side.conveyor.queue-empty'),
      paused: (n) => t('side.conveyor.paused', { n }),
      resume: t('side.conveyor.resume.title'),
    },
  );
}
// Buildable options as codex tiles (icon + cost). Tapping a tile opens the full-info
// panel, which carries a "Build here" button for the selected province — so browsing
// specs and committing the build share one control (no separate text button row).
function buildButtons(
  _planetId: string,
  ids: string[],
  kind: 'building' | 'unit',
  as: CatalogShape = 'tile',
): string {
  const k = kind === 'unit' ? 'u' : 'b';
  const tiles = ids
    .map((id) =>
      codexTile(
        k,
        id,
        costText(kind === 'unit' ? data.units[id]?.cost : data.buildings[id]?.cost),
        true,
        // Buildings are one-per-planet by default (`maxPerPlanet`, RULES-2) — grey out a
        // committed (queued/building/paused)
        // one so a second order can't be placed. On EVERY layout and in net play too:
        // условие `pcUi() && !NET` оставляло плитку кликабельной на телефоне и на
        // сервере, и налоговую управу можно было заказать дважды (живой плейтест).
        // buildingLocked читает p.buildings + scheduled + pausedConstruction — всё это
        // есть и в сетевых снапшотах. Units stack freely so they're never locked.
        kind === 'building' ? (buildingLocked(_planetId, id) ?? undefined) : undefined,
        as,
      ),
    )
    .join('');
  if (!tiles) return '';
  // Столбик строк живёт в том же `blist`, что и список построенного: на телефоне у
  // каталога и у состава одна ширина колонки, и разъехаться им нечем.
  return as === 'row' ? `<div class="blist">${tiles}</div>` : `<div class="ptiles">${tiles}</div>`;
}

/** Side-panel: the multi-fleet TASK-GROUP card (Shift-frame selection). */
function taskGroupPanelHtml(group: Fleet[]): string {
  const totals = groupTotals(group);
  let h = cardHeader(
    ownerColor(ME),
    t('side.group.title'),
    t('side.group.sub', { f: totals.fleets, s: totals.ships, tr: totals.troops }),
  );
  h += `<div class="hint">${t('side.group.hint')}</div>`;
  for (const f of group) {
    const where = fleetWhere(f);
    const loc =
      where.kind === 'orbit'
        ? where.at
        : where.kind === 'transit'
          ? `${where.from}→${where.to}`
          : where.kind === 'lane'
            ? `⟜ ${where.from}–${where.to}`
            : '—';
    const nShips = sumUnits(f.units);
    const nTr = sumUnits(f.landing ?? []);
    h += `<div class="row" style="color:${ownerColor(f.owner)}">▲ ${f.id} <span class="dim">${loc}</span> · ${nShips}${nTr ? '+' + nTr : ''}</div>`;
  }
  h += btn('cancel', '', t('side.group.clear'), true);
  return h;
}

/** Тайлы состава флота Bytro-стиля: силуэт-архетип в цвете стороны (наземные —
 *  прежние текст-глифы), счётчик и мини-бар корпуса стека; тап — досье юнита. */
function fleetTilesHtml(f: Fleet, stacks: UnitStack[]): string {
  const tiles = stacks
    .filter((u) => u.count > 0)
    .map((u) => {
      const def = data.units[u.unit];
      if (!def) return '';
      const name = unitTitle(u.unit);
      const eff = effectiveStats(def, u, data);
      const pct = stackHullPct(u, data); // тот же зажим остатка, что в сводке (REFM-37)
      const icon =
        def.domain === 'ground'
          ? `<span class="pt-ic">${unitIcon(u.unit, data)}</span>`
          : `<span class="pt-ic">${unitGlyphSvg(def, { color: ownerColor(f.owner), shield: (eff.shield ?? 0) > 0 })}</span>`;
      // Show installed modules as small tags under the count (RULES-2.1 / SM-0.3):
      // two cruisers with different modules are separate stacks — the tags make
      // the difference visible at a glance, without opening the codex.
      const modTags = u.modules && u.modules.length > 0
        ? `<span class="pt-mods">${u.modules.map((m) => {
            const mdef = data.modules[m];
            const mname = mdef ? tData(mdef.name) : m;
            return `<span class="pt-mod" title="${esc(mname)}">${esc(mname)}</span>`;
          }).join('')}</span>`
        : '';
      return `<button class="ptile" data-codex="u:${esc(u.unit)}" data-desc="u:${esc(u.unit)}" data-name="${esc(name)}" title="${esc(name)} — ${t('side.fleet.tile.hint')}">${icon}<span class="pt-c">×${u.count}</span>${modTags}<span class="pt-hp${pct < 30 ? ' low' : ''}"><i style="width:${pct}%"></i></span></button>`;
    })
    .join('');
  return tiles ? `<div class="ptiles">${tiles}</div>` : '';
}

/** Сводка армии (тап по имени в шапке карточки): состав по архетипам, боевой вес
 *  с капом, пулы корпуса/щита, скорость с активными множителями, трюм, радар,
 *  содержание. Обратно — тем же тапом по имени или кнопкой «назад». */
function fleetSummaryHtml(f: Fleet): string {
  // Всю арифметику считает `fleetSummary.ts` (REFM-37) — там же правила «огонь
  // ограничен линией боя», «радар — максимум, а не сумма» и зажим пулов.
  const sm = fleetSummary(f, data, s.time);
  const rows: string[] = [];
  const ARCH_LABEL: Record<string, string> = {
    scout: t('side.arch.scout'),
    combat: t('side.arch.combat'),
    artillery: t('side.arch.artillery'),
    transport: t('side.arch.transport'),
    flagship: t('side.arch.flagship'),
    swarm: t('side.arch.swarm'),
  };
  const comp = sm.composition
    .map(({ archetype, count }) => `${ARCH_LABEL[archetype] ?? archetype} ×${count}`)
    .join(' · ');
  rows.push(
    `<div class="row">${t('side.summary.composition')}: <b>${comp || t('side.none')}</b>${sm.troops ? ` · ${t('side.summary.troops')} ×${sm.troops}` : ''}</div>`,
  );
  // боевой вес: кап против полной суммы — видно, сколько стволов «за линией»
  rows.push(
    `<div class="row">⚔ ${t('side.summary.attack')}: <b>${sm.attack.capped}</b>${sm.attack.total > sm.attack.capped ? ` <span class="dim">(${t('side.summary.total')} ${sm.attack.total} — ${t('side.summary.firing-cap', { n: COMBAT_UNIT_CAP })})</span>` : ''}</div>`,
  );
  rows.push(`<div class="row">🛡 ${t('side.summary.defense')}: <b>${sm.defense}</b></div>`);
  rows.push(
    `<div class="row">♥ ${t('side.summary.hull')}: <b>${kfmt(sm.hull.cur)}/${kfmt(sm.hull.max)}</b>${sm.shield.max > 0 ? ` · ◈ ${t('side.summary.shield')}: <b>${kfmt(sm.shield.cur)}/${kfmt(sm.shield.max)}</b>` : ''}</div>`,
  );
  // скорость: база (мин по корпусам, лимп учтён) + активные множители
  const mults: string[] = [];
  if (marchFlagged(f.id)) mults.push(`⚡ ${t('side.summary.forced-march')} ×${FORCED_MARCH_MULT}`);
  if (sm.retreatHaste) mults.push(`⤺ ${t('side.summary.retreat-haste')} ×1.5`);
  rows.push(
    `<div class="row">⚡ ${t('side.summary.speed')}: <b>${sm.speed > 0 ? Math.round(sm.speed) : '—'}</b>${mults.length ? ` <span class="dim">${mults.join(' · ')}</span>` : ''} <span class="dim">· ${t('side.summary.speed.note')}</span></div>`,
  );
  if (sm.cargo)
    rows.push(
      `<div class="row">📦 ${t('side.summary.cargo')}: <b>${sm.cargo.used}/${sm.cargo.cap}</b></div>`,
    );
  if (sm.radar > 0)
    rows.push(`<div class="row">📡 ${t('side.summary.radar')}: <b>${sm.radar}</b></div>`);
  // UI-RES2: содержание флота — теми же чипами, что цена и выработка; суффикс «/д»
  // несёт сам чип, поэтому хвост «/день» из строки ушёл.
  const up = resLine(sm.upkeep, { per: 'd' });
  if (up) rows.push(`<div class="row dim">${t('side.summary.upkeep')}: ${up}</div>`);
  return (
    `<div class="sec">${t('side.summary.title')}</div>` +
    rows.join('') +
    `<div class="row">${btn('fleetinfo', '', t('side.summary.back'), true)}</div>`
  );
}

/** Side-panel: a single selected fleet — combat stats, orders, docking. */
function fleetPanelHtml(f: Fleet): string {
  const nShips = sumUnits(f.units);
  const nTr = sumUnits(f.landing ?? []);
  const inOrbit = f.orbit === 'near';
  // Пулы, залп и ход считает `fleetSummary.ts` — та же арифметика, что в сводке
  // армии (REFM-37/40): корпус и щит по ЭФФЕКТИВНОМУ hp (фитинг учтён), корабли и
  // десант вместе, остаток зажат по максимуму. Порог хромоты `LIMP_PCT` — то же
  // число, по которому ядро режет скорость, поэтому метка ⚠ зажигается ровно тогда,
  // когда флот действительно замедлился.
  const sm = fleetSummary(f, data, s.time);
  const hull = sm.hull;
  const pct = hullPct(hull);
  const hullTag = pct < LIMP_PCT ? ` · ⚠ ${t('side.fleet.hull-tag', { p: pct })}` : '';
  // ECON-1: голодный десант — владелец в food-arrears бьёт на земле на −25%.
  // Правила пометок о долгах — `arrearsWarnings.ts` (REFM-89): только своё и только
  // там, где есть кому голодать.
  const hungry = showsStarving(f.owner === ME, nTr, s.players[ME]?.arrears)
    ? ` · 🍽 ${t('side.fleet.hunger')}`
    : '';
  // Bytro-стиль: авто-имя соединения (тип по размеру + позывной), тап → сводка.
  const fleetTitle = `${t(fleetKindKey(nShips))} «${fleetCallsign(f.id)}»`;
  let h = cardHeader(
    ownerColor(f.owner),
    fleetTitle,
    (pcUi()
      ? t('side.fleet.sub.pc', { s: nShips, tr: nTr })
      : t('side.fleet.sub', { s: nShips, tr: nTr })) +
      hullTag +
      hungry +
      (inOrbit ? ' · ' + t('side.fleet.in-orbit') : '') +
      (f.bombarding ? ' · ⊗ ' + t('side.fleet.bombarding') : ''),
    'fleetinfo',
  );
  // Тап по имени открыл сводку армии — карточка целиком уступает ей место.
  if (fleetInfoFor === f.id) return h + fleetSummaryHtml(f);
  // ХП-бар Bytro-стиля + два ремонта: ECON-3а — экспресс за METAL у своего дока
  // (дешёвый, основной), и ненавязчивый платный за кредиты — где угодно вне боя
  // (цены — те же формулы, что в гейте).
  // Условия обеих кнопок — `repairOffer.ts` (REFM-90): общая часть «свой, вне боя, есть
  // что чинить» одна на два ремонта, а привязка к доку — только у экспресса за металл.
  const repairCost = instantRepairCost(f, data);
  const repairable = canRepair(f.owner === ME, !!f.battleId, repairCost);
  const atDock = canDockRepair(repairable, fleetAtOwnDock(f, s, data));
  if (hull.max > 0) {
    h += `<div class="row hullrow" data-desc="stat:hull"><span class="hico">♥</span><span class="hbar${pct < LIMP_PCT ? ' low' : ''}"><i style="width:${pct}%"></i></span><b>${kfmt(hull.cur)}/${kfmt(hull.max)}</b>${
      atDock
        ? `<button class="chip-metal" data-act="dockrepair" data-arg="${f.id}" title="${t('side.fleet.repair.dock.title')}">🔧 <span class="rc-metal">${dockRepairCost(f, data)}❒</span></button>`
        : ''
    }${
      repairable
        ? `<button class="chip-gold" data-act="instantrepair" data-arg="${f.id}" title="${t('side.fleet.repair.instant.title')}">🔧 ${repairCost}💰</button>`
        : ''
    }</div>`;
    if (sm.shield.max > 0)
      h += `<div class="row hullrow" data-desc="stat:shield"><span class="hico">◈</span><span class="hbar sh"><i style="width:${hullPct(sm.shield)}%"></i></span><b>${kfmt(sm.shield.cur)}/${kfmt(sm.shield.max)}</b></div>`;
  }
  // Aggregate combat weight — БОЕВОЙ вес, как его считает ядро: effectiveStats +
  // кап линии огня (топ-10 стволов). Скорость — базовая скорость флота (мин по
  // корпусам, лимп <30% учтён), с меткой форс-марша. The hero aura (+5%, noted
  // below) is not folded into these totals.
  const atk = sm.attack.capped;
  const def = sm.defense;
  const spd = sm.speed;
  const boosted = marchFlagged(f.id);
  const spdTxt =
    spd > 0
      ? boosted
        ? `${Math.round(spd)} ⚡×${FORCED_MARCH_MULT}`
        : String(Math.round(spd))
      : '—';
  // Fleet-card blurb removed (feedback: compact panel) — the header + stat chips carry it.
  h += `<div class="pstats"><span data-desc="stat:atk">⚔ ${t('side.stat.atk')} ${atk}</span><span data-desc="stat:def">🛡 ${t('side.stat.def')} ${def}</span><span data-desc="stat:cap">Ⅹ ${Math.min(nShips, COMBAT_UNIT_CAP)}/${COMBAT_UNIT_CAP}</span><span data-desc="stat:spd">⚡ ${t('side.stat.spd')} ${spdTxt}</span></div>`;

  // Active effects (RPG-style buffs/debuffs) — a compact row of tags showing
  // what's currently affecting this fleet: combat, forced march, patrol, flak,
  // blackout, hunger, bombardment, point defense, free flight, barrage focus.
  const effects: string[] = [];
  if (f.battleId) effects.push(`⚔️ ${t('effect.in-battle')}`);
  if (boosted) effects.push(`⚡ ${t('effect.forced-march')}`);
  if (f.bombarding) effects.push(`⊗ ${t('effect.bombarding')}`);
  if (f.barrageTarget) effects.push(`🎯 ${t('effect.barrage-focus')}`);
  if (f.freeMovement) effects.push(`🛬 ${t('effect.free-flight')}`);
  const pt = patrolOf(f.id);
  if (pt) {
    const fuel = pt.sortie.rearming > 0
      ? t('effect.rearming', { n: pt.sortie.rearming })
      : t('effect.fuel', { n: pt.sortie.fuel });
    effects.push(`🛩 ${t('effect.patrol')} · ${fuel}`);
  }
  if (f.owner === ME) {
    const arrears = s.players[ME]?.arrears ?? [];
    if (arrears.includes('energy')) effects.push(`🌫 ${t('effect.blackout')}`);
    if (arrears.includes('food') && nTr > 0) effects.push(`🍽 ${t('effect.hunger')}`);
  }
  // Point defense (from modules) — show if any ship has it
  const pd = f.units.reduce((sum, st) => {
    const def = data.units[st.unit];
    if (!def || st.count <= 0) return sum;
    const eff = effectiveStats(def, st, data);
    return sum + (eff.pointDefense ?? 0) * st.count;
  }, 0);
  if (pd > 0) effects.push(`🛡 ${t('effect.point-defense', { n: pd })}`);
  if (effects.length > 0) {
    h += `<div class="sec">${t('effect.title')}</div><div class="row effects">`;
    for (const e of effects) h += `<span class="effect-tag">${e}</span>`;
    h += `</div>`;
  }

  // Enemy fleet: show composition only if identified (known node). An
  // unidentified radar contact shows just the signature (ship count), not
  // the exact unit breakdown — fog of war hides the details.
  const enemyKnown = f.owner === ME || known(fleetNode(f));
  if (enemyKnown) {
    h += nShips ? `<div class="sec">${t('side.fleet.ships')}</div>` + fleetTilesHtml(f, f.units) : '';
    if (nTr > 0)
      h += `<div class="sec">${t('side.fleet.troops')}</div>` + fleetTilesHtml(f, f.landing ?? []);
  } else if (nShips > 0) {
    // Radar contact: show only the signature (coarse size), not the composition
    h += `<div class="sec">${t('side.fleet.ships')}</div><div class="row dim">${t('side.fleet.signature', { n: nShips })}</div>`;
  }

  // Artillery rules of engagement moved to the ☰ command bar («🔥 Режим огня»
  // button + popover menu) — the bottom sheet keeps information, not controls.

  // Carrier air wing (squadrons-roadmap SQ-1.1) — launch the squadron ships as a
  // separate fast strike fleet. Needs a non-squadron ship left behind (fleet.split
  // refuses to take the whole stack), so an all-fighter fleet just flies itself.
  if (f.owner === ME && fleetHasSquadron(f)) {
    const wing = squadronTake(f).reduce((n, u) => n + u.count, 0);
    h += `<div class="sec">${t('side.wing.title')}</div><div class="row">`;
    h += btn('launchsquad', '', t('side.wing.launch', { n: wing }), fleetCanLaunchSquadron(f));
    h += `</div>`;
    h += `<div class="hint">${t('side.wing.hint')}</div>`;

    // CC-4 status only — the «🛩 Деж. вылет» TOGGLE moved to the ☰ command row
    // (SO-UI: the panel keeps information, the bar keeps controls).
    const pt = patrolOf(f.id);
    if (pt) {
      const status =
        pt.sortie.rearming > 0
          ? t('side.wing.rearming', { n: pt.sortie.rearming })
          : t('side.wing.fuel', { n: pt.sortie.fuel });
      h += `<div class="row dim">${t('side.wing.patrol-on')} · ${t('side.wing.radius', { r: Math.round(pt.radius) })} · ${status}</div>`;
    }
  }

  // Squadron strike wing (a fleet split off from a carrier with homeBase) — free-space
  // movement: strike an enemy in range, return to base, or toggle patrol (CC-4).
  // Что такое действующее крыло — `squadron.ts` (REFM-135): панель и обработчики
  // приказов обязаны отвечать на это одинаково, иначе кнопка обещает то, чего нет.
  if (isWing(f, ME)) {
    const isPatrol = !!patrolOf(f.id);
    const canAct = wingCanAct(f);
    h += `<div class="sec">${t('side.wing.title')}</div><div class="row">`;
    h += btn('squadronstrike', '', t('side.wing.strike'), canAct);
    h += btn('squadronreturn', '', t('side.wing.return'), wingCanReturn(f));
    h += btn('squadronpatrol', '', isPatrol ? t('side.wing.patrol-on') : t('side.wing.patrol'), canAct);
    h += `</div>`;
  }

  // The player's projection hero rides here → name it and flag its fleet aura.
  if (f.units.some((u) => u.count > 0 && data.units[u.unit]?.traits.includes('hero'))) {
    const hero = Object.values(s.heroes ?? {}).find((x) => x.owner === f.owner);
    const heroName = hero ? heroDisplayName(hero) : (NAME[f.owner] ?? f.owner);
    h += `<div class="row"><b>♔ ${esc(heroName)}</b> <span class="dim">${t('side.fleet.hero-aura')}</span></div>`;
  }

  // CC-2 auto-storm: the whole «Дежурный режим» section moved to the ☰ command
  // row («⚔ Авто-штурм» toggle) — SO-UI unloads the bottom sheet.

  if (f.movement) {
    // total travel-time estimate to the final destination (next-hop ETA from the
    // authoritative schedule + the remaining route at base speed). The ETA ticks
    // every frame, so it's a placeholder here (stable signature → no rebuild) and
    // patched in place by updatePanelLive() — keeps the panel's buttons put.
    const dest = f.movement.destination ?? f.movement.to;
    // Гибкое время в пути: остаток маршрута за текущим лейном пересчитывается с
    // учётом форс-марша (×1.5 с СЛЕДУЮЩЕГО лейна — текущий уже расписан
    // авторитетно в arrivesAt, его не трогаем). Выключил буст — оценка удлиняется.
    const rawRestH =
      dest !== f.movement.to ? estimateTravelHours(s, data, f.movement.to, dest, f) : 0;
    const restH = restRouteHours(rawRestH, boosted, FORCED_MARCH_MULT);
    h += `<div class="row">${t('side.fleet.enroute', { dest: `<b>${esc(dest)}</b>` })} <b class="pn-eta" data-arrive="${f.movement.arrivesAt}" data-rest="${restH}">…</b>${boosted ? ' <span class="dim">⚡</span>' : ''}</div>`;
  } else if (f.edge) {
    const pct = Math.round(f.edge.t * 100);
    h += `<div class="row">${t('side.fleet.on-lane', { lane: `<b>${esc(f.edge.from)}–${esc(f.edge.to)}</b>`, p: pct })}</div>`;
  }

  const here = planet(f.location);
  const docked = !!here && !f.movement && !f.battleId;
  if (f.battleId) {
    // The battle card (framework-agnostic view-model from @void/client): both
    // sides, hull bars, phase, live round countdown — and the one action, retreat.
    const bm = createBattleModel(s, f.battleId, ME, data);
    if (bm.ok) {
      const bar = (v: { current: number; max: number } | undefined, glyph: string): string =>
        v && v.max > 0 ? ` · ${glyph} ${kfmt(v.current)}/${kfmt(v.max)}` : '';
      const sideRow = (sv: BattleSideView, tag: string): string => {
        const troops = sv.units.map((u) => `${u.count}× ${u.unit}`).join(', ') || '—';
        return `<div class="row${sv.mine ? '' : ' dim'}">${sv.mine ? '▶' : '·'} <b>${esc(sv.ownerName)}</b> (${tag}, ${
          sv.kind === 'garrison'
            ? t('side.battle.side.garrison')
            : sv.kind === 'landing'
              ? t('side.battle.side.landing')
              : t('side.battle.side.fleet')
        }): ${esc(troops)}${bar(sv.hull, '♥')}${bar(sv.shield, '◈')}</div>`;
      };
      h += `<div class="sec">${t('side.battle.title', { phase: bm.phase === 'ground' ? t('side.battle.phase.ground') : t('side.battle.phase.orbit'), r: bm.round })}</div>`;
      h +=
        sideRow(bm.attacker, t('side.battle.attacker')) +
        sideRow(bm.defender, t('side.battle.defender'));
      if (bm.nextRoundAt != null)
        h += `<div class="row">${t('side.battle.next-round')} <span class="pn-timer" data-at="${bm.nextRoundAt}">…</span></div>`;
      h += `<div class="row">${btn('retreat', '', t('side.battle.retreat'), bm.retreatFleetId === f.id)}</div>`;
      h += `<div class="hint">${t('side.battle.retreat.hint')}</div>`;
    }
  }
  if (docked) {
    // enemy/neutral world you can act on — empty space is pass-through only
    const hostile =
      here!.owner !== f.owner && (sectorTypeOf(here!.id)?.capturable ?? false);
    const cols: string[] = [];
    if (hostile) {
      let at = `<div class="sec">${t('side.strike.title')}</div><div class="row">`;
      at += btn(
        'bombard',
        f.bombarding ? 'off' : 'on',
        f.bombarding ? t('side.strike.bombard.stop') : t('side.strike.bombard'),
        inOrbit && nShips > 0,
      );
      at += btn('assault', '', t('side.strike.assault'), inOrbit);
      at += `</div>`;
      at += `<div class="hint">${t('side.strike.hint')}</div>`;
      // Combat forecast (ONB-6): «если атакую — что будет?» — the pure base-model
      // sim over the landing force vs the garrison the viewer SEES (the fleet is
      // docked here, so the world is identified — no fog leak). A forecast, not an
      // oracle: terrain/fortification/tech bonuses of the live fight are not folded
      // in — the hedge in the copy says so.
      const landing = f.landing ?? [];
      const garrison = here!.garrison;
      if (landing.some((u) => u.count > 0) && garrison.some((u) => u.count > 0)) {
        const pv = previewBattle(landing, garrison, data);
        const verdict =
          pv.outcome === 'attacker'
            ? t('side.strike.forecast.attacker')
            : pv.outcome === 'defender'
              ? t('side.strike.forecast.defender')
              : t('side.strike.forecast.draw');
        at += `<div class="row dim">${t('side.strike.forecast', {
          v: `<b>${verdict}</b>`,
          r: pv.roundsEst,
          a: previewLossCount(pv.attacker),
          pa: Math.round(pv.attacker.damageFraction * 100),
          d: previewLossCount(pv.defender),
          pd: Math.round(pv.defender.damageFraction * 100),
        })}</div>`;
        at += `<div class="hint">${t('side.strike.forecast.hint')}</div>`;
      }
      cols.push(at);
    }
    // Ground army at your own world — СВОДКА, без кнопок: сама погрузка/выгрузка
    // переехала в ⇅-меню ряда команд (GRND-1), где есть выбор «кого и сколько».
    // Панель осталась информационной ровно как у стоячих приказов (SO-UI ниже).
    if (here!.owner === ME) {
      let ga = `<div class="sec">${t('side.ground.title')}</div>`;
      const groundHere = here!.garrison.filter((st) => isGround(st.unit));
      const carried = f.landing ?? [];
      const loadingN = pendingLoads.filter((p) => p.fleetId === f.id).length;
      const types: string[] = [];
      for (const st of [...groundHere, ...carried])
        if (isGround(st.unit) && !types.includes(st.unit)) types.push(st.unit);
      if (types.length) {
        ga += `<div class="row dim">${t('side.ground.legend')}</div>`;
        const cnt = (stacks: Array<{ unit: string; count: number }>, u: string): number =>
          stacks.reduce((n, st) => (st.unit === u ? n + st.count : n), 0);
        for (const u of types)
          ga += `<div class="row"><span class="bicon">${unitIconHtml(u, data, youColor, 16)}</span>${esc(displayUnit(u))} <b>${cnt(groundHere, u)} ▸ ${cnt(carried, u)}</b></div>`;
      }
      if (loadingN) ga += `<div class="hint">${t('side.ground.loading', { n: loadingN })}</div>`;
      if (!types.length && !loadingN)
        ga += `<div class="row dim">${t('side.ground.empty')}</div>`;
      ga += `<div class="hint">${t('side.ground.via-cmd')}</div>`;
      cols.push(ga);
    }
    h += pcols(cols);
  }
  return h;
}

/** Side-panel: a world outside sensor coverage — last-scan memory, or no telemetry. */
function unknownPlanetHtml(p: Planet): string {
  const mem = memory.get(p.id);
  if (mem) {
    const icons =
      mem.buildings
        .map((b) => `${BUILD_ICON[b.type] ?? '▪'} ${buildingName(data.buildings[b.type]?.name, b.type)} L${b.level}`)
        .join(', ') || t('side.scan.no-buildings');
    // Espionage from memory: you know WHOSE world this was — an agent can reveal
    // its live contents without flying there. Wrong/stale owner → the kernel
    // rejects the attempt (bad target), which is honest: intel decays.
    const spyRow =
      mem.owner && mem.owner !== ME
        ? `<div class="row">${btn('spyplanet', mem.owner, t('side.scan.spy', { c: SPY_COST }), afford({ credits: SPY_COST }))}</div>`
        : '';
    return (
      cardHeader(ownerColor(mem.owner), p.id, t('side.scan.title')) +
      `<div class="row dim">${t('side.scan.stale')}</div>` +
      `<div class="row">${t('side.scan.owner')}: <b>${mem.owner ? NAME[mem.owner] : t('side.neutral')}</b></div>` +
      `<div class="row">${t('side.scan.garrison')}: <b>${mem.garrison}</b></div>` +
      `<div class="row">${t('side.scan.buildings')}: ${icons}</div>` +
      spyRow +
      `<div class="hint">${t('side.scan.hint')}</div>`
    );
  }
  // No «Снять выделение» on planet cards: it only clears FLEET selection (selPlanet
  // stays, the card would not even close) — the ✕ in the corner is the real close.
  return (
    cardHeader('#5f8f8c', p.id, t('side.notelemetry.title')) +
    `<div class="row dim">${t('side.notelemetry.sub')}</div>` +
    `<div class="hint">${t('side.notelemetry.hint')}</div>`
  );
}

/** Карточка статистики мира (тап по имени планеты) — полная сводка: обозначение,
 *  владелец, вид/тип/местность, пассивный выход по ресурсам (ECON-7 перекос),
 *  бонусы типа, гарнизон, постройки, очки победы, флоты на орбите. */
function planetSummaryHtml(p: Planet): string {
  // Числа и разбор гарнизона считает `planetSummary.ts` (REFM-38) — там же правила
  // «крыло не корабль», «выход перечисляет и нули» и «очки победы из ядра».
  const sm = planetSummary(p, data, Object.values(s.fleets));
  const rows: string[] = [];
  const pt = p.planetType ? data.planetTypes[p.planetType] : undefined;
  const ptName = tData(pt?.name ?? p.planetType ?? '—');
  const kindName = tData(sectorTypeOf(p.id)?.name ?? SECTOR_OF[p.id] ?? '—');
  const sec = tData(data.sectors[p.terrain ?? '']?.name ?? p.terrain ?? '—');
  rows.push(`<div class="row">${t('side.world.designation')}: <b>${esc(p.id)}</b></div>`);
  rows.push(
    `<div class="row">${t('side.world.owner')}: <b style="color:${ownerColor(p.owner)}">${p.owner ? esc(NAME[p.owner] ?? p.owner) : t('side.neutral')}</b></div>`,
  );
  rows.push(
    `<div class="row">${t('side.world.kind')}: <b>${esc(kindName)}</b> · ${esc(ptName)} · ${esc(sec)}</div>`,
  );
  // ECON-7: пассивный базовый выход мира по ресурсам — перекос типа планеты.
  // UI-RES2: одно правило показа ресурса. Прежняя форма падала на СЛОВО для
  // ресурса без глифа в TECH_CUR — то есть ровно там, где игроку опереться не на что.
  const baseStr = resLine(sm.baseOutput, { per: 'h' });
  if (baseStr)
    rows.push(
      `<div class="row">${t('side.world.output')}: <b>${baseStr}</b> <span class="dim">${t('side.world.output.note')}</span></div>`,
    );
  const pctf = (n: number) => (n >= 0 ? '+' : '') + Math.round(n * 100) + '%';
  const bonus: string[] = [];
  if (sm.bonuses.production !== undefined)
    bonus.push(`${t('side.world.bonus.production')} ${pctf(sm.bonuses.production)}`);
  if (sm.bonuses.defense !== undefined)
    bonus.push(`${t('side.world.bonus.defense')} ${pctf(sm.bonuses.defense)}`);
  if (bonus.length)
    rows.push(
      `<div class="row">${t('side.world.type-bonuses')}: <b>${bonus.join(' · ')}</b></div>`,
    );
  rows.push(
    `<div class="row">⚔ ${t('side.world.garrison')}: <b>${sm.garrison.ground}</b> ${t('side.world.count.ground')} · <b>${sm.garrison.ships}</b> ${t('side.world.count.ships')}${sm.garrison.wings ? ` · <b>${sm.garrison.wings}</b> ${t('side.world.count.squadrons')}` : ''}</div>`,
  );
  const blist =
    sm.buildings
      .map(
        (b) =>
          `${BUILD_ICON[b.type] ?? '▣'} ${buildingName(data.buildings[b.type]?.name, b.type)}${b.level > 1 ? ' L' + b.level : ''}`,
      )
      .join(', ') || t('side.none');
  rows.push(
    `<div class="row">▣ ${t('side.world.buildings')} (${sm.buildings.length}): <b>${blist}</b></div>`,
  );
  rows.push(`<div class="row">✦ ${t('side.world.vp')}: <b>${sm.victoryPoints}</b></div>`);
  if (sm.orbit.fleets) {
    rows.push(
      `<div class="row">▲ ${t('side.world.fleets')}: <b>${sm.orbit.fleets}</b> <span class="dim">(${t('side.world.fleet-ships', { n: sm.orbit.ships })})</span></div>`,
    );
  }
  if (p.owner === ME && capitalOf(s, ME) === p.id)
    rows.push(
      `<div class="row"><b style="color:var(--grn)">★ ${t('side.world.capital')}</b></div>`,
    );
  return (
    `<div class="sec">${t('side.world.summary')}</div>` +
    rows.join('') +
    `<div class="row">${btn('planetinfo', '', t('side.summary.back'), true)}</div>`
  );
}

/** Side-panel: a known world — ownership header + ground/ships/squadron/buildings tabs. */
function planetPanelHtml(p: Planet): string {
  const mine = p.owner === ME;
  const sec = tData(data.sectors[p.terrain ?? '']?.name ?? p.terrain ?? '—');
  const pt = p.planetType ? data.planetTypes[p.planetType] : undefined;
  const ptName = tData(pt?.name ?? p.planetType ?? '—');
  // Province type (the structural kind) — shown so the map's provinces read clearly.
  const kindName = tData(sectorTypeOf(p.id)?.name ?? SECTOR_OF[p.id] ?? '—');
  // Разбор гарнизона по вкладкам и их счётчики — в `planetTabs.ts` (REFM-41), там же
  // правило «вкладка флота считает и орбиту»: построенное само уходит в космос.
  const { ground, ships, wings: wing } = garrisonByTab(p.garrison, data);
  const gcount = sumUnits(p.garrison);
  const here = Object.values(s.fleets).filter((f) => f.location === p.id);
  const counts = tabCounts(p, data, here);
  // Bytro-стиль: у мира авто-имя (тап → карточка статистики); координата (grid id)
  // остаётся отдельным обозначением в подзаголовке.
  const header = cardHeader(
    ownerColor(p.owner),
    planetName(p.id),
    `${esc(p.id)} · ${p.owner ? NAME[p.owner] : t('side.neutral')} · ${kindName} · ${ptName} · ${sec}`,
    'planetinfo',
  );
  // Тап по имени открыл сводку мира — панель целиком уступает ей место.
  if (planetInfoFor === p.id) return header + planetSummaryHtml(p);
  let h =
    header +
    `<div class="pstats"><span data-desc="stat:garrison">⚔ ${gcount} <span class="pl">${t('side.world.stat.garrison')}</span></span><span data-desc="stat:ground">${unitIcon('heavy_infantry', data)} ${sumUnits(ground)} <span class="pl">${t('side.world.count.ground')}</span></span><span data-desc="stat:gships">${unitIcon('cruiser', data)} ${sumUnits(ships)} <span class="pl">${t('side.world.count.ships')}</span></span><span data-desc="stat:pbuild">▣ ${p.buildings.length} <span class="pl">${t('side.world.count.buildings')}</span></span></div>`;
  // ECON-2: блэкаут — неоплаченная энергия глушит радары и ПВО этого владельца вдвое.
  // Блэкаут — свойство ВЛАДЕЛЬЦА, а не этого мира (`arrearsWarnings.ts`, REFM-89).
  if (showsBlackout(mine, s.players[ME]?.arrears)) {
    h += `<div class="row" style="color:var(--red)">⚡ ${t('side.world.blackout')}</div>`;
  }
  if (pt && (pt.productionBonus !== 0 || pt.defenseBonus !== 0)) {
    const pct = (n: number) => (n >= 0 ? '+' : '') + Math.round(n * 100) + '%';
    const parts: string[] = [];
    if (pt.productionBonus !== 0)
      parts.push(t('side.world.production', { p: pct(pt.productionBonus) }));
    if (pt.defenseBonus !== 0) parts.push(t('side.world.defense', { p: pct(pt.defenseBonus) }));
    h += `<div class="row dim">${pcUi() ? t('side.world.type', { pt: esc(ptName), mods: parts.join(' · ') }) : t('side.world.type.long', { pt: esc(ptName), mods: parts.join(' · ') })}</div>`;
  }

  // Capital marker / designate — heroes respawn here (and re-fit modules, Phase C).
  // Что панель предлагает сделать с миром — `worldOrders.ts` (REFM-91).
  {
    const cap = capitalOffer(mine, capitalOf(s, ME) === p.id, isInhabited(p));
    if (cap === 'marked') {
      h += `<div class="row"><b style="color:var(--grn)">★ ${t('side.world.capital')}</b>${pcUi() ? '' : ` <span class="dim">${t('side.world.capital.note')}</span>`}</div>`;
    } else if (cap === 'designate') {
      h += `<div class="row">${btn('capital', '', t('side.world.make-capital'), true)}</div>`;
    }
    // Hold point (ST-2.1): a standing order for the Steward — the anchor is never
    // auto-evacuated and gets reinforced under threat. Same tech gate as delegation.
    const points = s.players[ME]?.stewardHoldPoints ?? [];
    // Лимит ГАСИТ кнопку, но не прячет её, а снять точку можно всегда — иначе игрок,
    // исчерпавший лимит, запрётся: ни поставить новую, ни убрать старую (правило 6).
    const hold = holdOffer(
      mine,
      stewardTechDone(s, ME),
      points.includes(p.id),
      points.length,
      MAX_STEWARD_HOLD_POINTS,
    );
    if (hold === 'clear') {
      h += `<div class="row"><b style="color:var(--cyan)">🚩 ${t('side.world.hold.title')}</b> ${btn('holdpoint', 'off', t('side.world.hold.clear'), true)}</div>`;
    } else if (hold !== 'none') {
      h += `<div class="row">${btn('holdpoint', 'on', pcUi() ? t('side.world.hold') : t('side.world.hold.set'), hold === 'set')}</div>`;
    }
  }

  // Tactical ping — mark this province and share it (coalition chat, or a player's DM).
  h += `<div class="row">${btn('ping', '', pcUi() ? t('side.world.ping') : t('side.world.ping.long'), true)}</div>`;

  // Espionage: steal a 24h intel window on this enemy world (SPY-1). While a
  // window lives its countdown replaces the button — the node stays identified.
  {
    const live = myIntel().find((g) => g.kind === 'planet' && g.target === p.id);
    // Кому и что предлагаем — `spyOffer.ts` (REFM-92): свой и ничейный мир не шпионят,
    // живое окно показывает отсчёт вместо кнопки, а нехватка кредитов кнопку гасит, но
    // не прячет — цена должна остаться на виду.
    const spy = spyOffer(mine, !!p.owner, !!live, afford({ credits: SPY_COST }));
    if (spy === 'window' && live) {
      h += `<div class="row"><b style="color:var(--cyan)">${t('side.world.spy-window')}</b> <span class="dim">${t('side.world.spy-window.left', { left: fmtEta(windowLeftH(live.until, s.time, HOUR)) })}</span></div>`;
    } else if (spy !== 'none') {
      h += `<div class="row">${btn('spyplanet', p.owner ?? '', t('side.scan.spy', { c: SPY_COST }), spy === 'buy')}</div>`;
    }
  }

  h += `<div class="ptabs">${tabButton('ground', t('side.tab.ground'), counts.ground, 'tab:ground')}${tabButton(
    'ships',
    t('side.tab.fleet'),
    counts.ships,
    'tab:ships',
  )}${tabButton('squadron', t('side.tab.wings'), counts.squadron, 'tab:squadron')}${tabButton('buildings', t('side.tab.buildings'), counts.buildings, 'tab:buildings')}</div>`;

  // Tab content is split into self-contained blocks; on desktop they flow into
  // side-by-side columns (filling the wide panel), on phones they stack vertically.
  const cols: string[] = [];
  if (planetTab === 'ground') {
    // Состав ЗЕМЛИ показывается списком на ВСЕХ раскладках — тем же столбиком строк, что
    // и здания. Плитки на ПК давали только иконку и число: имя приходилось угадывать, и
    // одна и та же группа читалась на телефоне и на ПК по-разному.
    // ECON-1: голодный гарнизон — владелец мира в food-arrears теряет 25% на земле.
    const starving = showsStarving(p.owner === ME, ground.length, s.players[ME]?.arrears)
      ? `<div class="row" style="color:var(--red)">🍽 ${t('side.fleet.hunger')}</div>`
      : '';
    cols.push(
      `<div class="sec">${t('side.ground.units')}</div>` +
        starving +
        unitRows(ground),
    );
    if (mine) {
      const groundBuilds = buildRoster('ground', BUILD_UNITS, data);
      cols.push(
        `<div class="sec">${t('side.ground.conveyor')}</div>` +
          conveyorHtml(p.id, 'units') +
          buildButtons(p.id, groundBuilds, 'unit'),
      );
    }
    if (!pcUi()) {
      cols.push(`<div class="hint">${t('side.ground.hint')}</div>`);
    }
  } else if (planetTab === 'ships') {
    // Built ships now auto-rally to orbit (see fleetLaunchModule), so the garrison
    // normally holds no spacecraft — only surface the section if some linger.
    // Состав показывается ВСЕГДА, даже пустой, — как у земли и зданий. Скрытая секция
    // читается как поломка панели: игрок не понимает, пуст гарнизон или вкладка не
    // прогрузилась. Пустой список говорит об этом словами (`unitRows`).
    cols.push(`<div class="sec">${t('side.garrison.ships')}</div>` + unitRows(ships));
    if (here.length) {
      let orbit = `<div class="sec">${t('side.world.fleets')}</div>`;
      for (const f of here) {
        const fShips = sumUnits(f.units);
        const tr = sumUnits(f.landing ?? []);
        const sel = f.owner === ME ? btn('selfleet', f.id, t('side.garrison.select'), true) : '';
        orbit += `<div class="asset-row" data-desc="fleet" style="color:${ownerColor(f.owner)}"><span class="bicon">▲</span><b>${t('side.world.fleet-ships', { n: fShips })}${tr ? ' ' + t('side.garrison.plus-troops', { n: tr }) : ''}</b>${sel}</div>`;
      }
      cols.push(orbit);
    }
    if (mine) {
      const shipBuilds = buildRoster('ships', BUILD_UNITS, data);
      // Каталог заказа — СТРОКАМИ, как состав над ним и как список зданий (заказ
      // владельца). Сетка плиток давала одну иконку и цену: что за корабль под глифом,
      // игрок узнавал только тапнув, а состав рядом уже называл те же корабли по имени —
      // одна вкладка говорила о своём ростере на двух языках.
      cols.push(
        `<div class="sec">${t('side.shipyard.conveyor')}</div>` +
          conveyorHtml(p.id, 'units') +
          buildButtons(p.id, shipBuilds, 'unit', 'row'),
      );
    }
    if (!pcUi()) {
      // PC carries this in the ФЛОТ tab's hover dossier ('tab:ships')
      cols.push(`<div class="hint">${t('side.shipyard.hint')}</div>`);
    }
  } else if (planetTab === 'squadron') {
    cols.push(`<div class="sec">${t('side.garrison.wing')}</div>` + unitRows(wing)); // всегда, см. выше
    if (mine) {
      const wingBuilds = buildRoster('squadron', BUILD_UNITS, data);
      cols.push(
        `<div class="sec">${t('side.wing.conveyor')}</div>` +
          conveyorHtml(p.id, 'units') +
          buildButtons(p.id, wingBuilds, 'unit', 'row'), // строками — см. вкладку ФЛОТ
      );
    }
    if (!pcUi()) {
      // PC carries this in the КРЫЛЬЯ tab's hover dossier ('tab:squadron')
      cols.push(`<div class="hint">${t('side.wing.garrison.hint')}</div>`);
    }
  } else {
    cols.push(
      `<div class="sec">${t('side.build.conveyor')}</div>` +
        (mine
          ? conveyorHtml(p.id, 'buildings')
          : `<div class="row dim">${t('side.build.enemy-hidden')}</div>`),
    );
    let blds = `<div class="sec">${t('side.tab.buildings')}</div>`;
    if (p.buildings.length === 0) blds += `<div class="row dim">${t('side.none')}</div>`;
    // BUILD-1 (макет владельца): построенное — ИКОНКАМИ со значком уровня. Тап
    // открывает карточку кодекса с листалкой уровней и кнопкой «Улучшить» —
    // описание, апгрейд и «что даст следующий уровень» переехали туда из строк.
    if (p.buildings.length) {
      // Разметку строки собирает `catalogTile.ts` — там же решения подачи: список идёт
      // СТОЛБИКОМ (строка на здание), имя подписано (иконка одна на вопрос «что это» не
      // отвечает) и уровень показан ВСЕГДА, коротким `L1`, а не галочкой.
      const tiles = p.buildings
        .map((b) =>
          builtTileHtml({
            type: b.type,
            level: b.level,
            icon: BUILD_ICON[b.type] ?? '▪',
            name: buildingName(data.buildings[b.type]?.name, b.type),
            // Доход ТЕКУЩЕГО уровня — тем же `resLine`, что и в кодексе: игрок решает,
            // что строить дальше, по цифре дохода, и раньше шёл за ней в карточку по
            // одной постройке за тап (`catalogTile.ts`, правило 4).
            income: incomeOf(b.type, b.level),
          }),
        )
        .join('');
      blds += `<div class="blist">${tiles}</div>`;
    }
    // Каталог непостроенного больше не живёт плитками в панели — его показывает
    // полноэкранное окно построек. Кнопка есть только там, где строить можно
    // (свой мир И ростер сектора непуст — CMD-VIS: нет приказа — нет кнопки).
    if (mine && (sectorTypeOf(p.id)?.allowedBuildings ?? BUILDABLE).length > 0) {
      blds += `<button class="bw-open" data-act="openbuild">▣ ${t('side.build.open')}</button>`;
    }
    cols.push(blds);
  }
  return h + pcols(cols);
}

/** The side-panel dispatcher: task group → single fleet → unknown world → known world. */
function panelHtml(): string {
  // Приоритет претендентов и отсев мёртвых ссылок — в `panelSelect.ts` (REFM-39):
  // устаревший выбор флота проваливается на мир, а не запирает панель пустотой.
  const pick = pickPanel({ fleets: selFleets, fleet: selFleet, planet: selPlanet }, s, seesDetails);
  if (pick.kind === 'group') return taskGroupPanelHtml(pick.fleets);
  if (pick.kind === 'fleet') return fleetPanelHtml(pick.fleet);
  if (pick.kind === 'empty') return `<div class="hint">${t('side.empty')}</div>`;
  return pick.known ? planetPanelHtml(pick.planet) : unknownPlanetHtml(pick.planet);
}

// --- object dossiers + codex (REFM-4) ----------------------------------------
// The hover/tap blurbs and the full-info codex card live in `dossiers.ts` now; here
// they only get their live-state hooks. The pure parts (`buildingDossier`,
// `resLine`, the `Dossier` type) are imported at the top of the file.
const { objDossier, codexHtml } = createDossiers({
  state: () => s,
  me: () => ME,
  pcUi,
  youColor: () => youColor,
  queueOf,
  activeConstruction,
  progressPct,
});

// --- player card (tap the top-left crest) ------------------------------------
/** Your dossier in this session: faction, worlds, fleets, score, and the treasury.
 *  Opened by tapping the crest in the top-left corner. */
function playerCardHtml(): string {
  const pl = s.players[ME];
  const name = NAME[ME] ?? houseDisplayName(pl?.name ?? ME);
  // H3: the LIVE faction (chosen at setup, stamped on the player) — name + its passive.
  const fid = pl?.faction ?? SEAT_META.find((m) => m.id === ME)?.faction ?? '';
  const fdef = data.factions[fid];
  const bonus = factionBonusLine(fid);
  const faction = fdef ? `${tData(fdef.name)}${bonus ? ` · ${bonus}` : ''}` : fid || '—';
  const worlds = Object.values(s.planets).filter((p) => p.owner === ME).length;
  // Total units you command: ships + carried troops across your fleets, plus every
  // garrison on your worlds.
  let units = 0;
  for (const f of Object.values(s.fleets))
    if (f.owner === ME) units += sumUnits(f.units) + sumUnits(f.landing ?? []);
  for (const pp of Object.values(s.planets)) if (pp.owner === ME) units += sumUnits(pp.garrison);
  const score = Math.round(s.match?.scores?.[ME]?.total ?? 0);
  const need = Math.max(0, SCORE_LIMIT - score);
  const col = ownerColor(ME);
  const row = (k: string, v: string) =>
    `<div class="pc-row"><span class="pc-k">${k}</span><span class="pc-v">${v}</span></div>`;
  return (
    `<div class="pc-head"><span class="pc-dia" style="background:${col};box-shadow:0 0 10px ${col}"></span>` +
    `<b>${esc(name)}</b><span class="pc-tag">${t('card.commander')}</span></div>` +
    `<div class="pc-stats">` +
    row(t('card.faction'), esc(faction)) +
    row(t('card.worlds'), String(worlds)) +
    row(t('card.units'), String(units)) +
    row(
      t('card.score'),
      `${score} / ${SCORE_LIMIT}${need === 0 ? ' · ★ ' + t('card.score.goal') : ''}`,
    ) +
    `</div><div class="pc-sec">${t('card.combat')}</div><div class="pc-stats">` +
    row(t('card.kills'), kfmt(killStats.destroyed)) +
    row(t('card.losses'), kfmt(killStats.lost)) +
    // This card is the MATCH dossier (it dies with the session); the career one
    // lives in the account. One tap between them instead of two similar screens.
    `</div><button class="pc-dossier">${t('card.dossier')}</button>` +
    `<button class="pc-close">${t('card.close')}</button>`
  );
}
function openPlayerCard(): void {
  const el = document.getElementById('playercard');
  if (!el) return;
  delete el.dataset.seat; // your own dossier — the seat-card handler must stay dormant
  el.innerHTML = `<div class="pcbox">${playerCardHtml()}</div>`;
  el.classList.add('show');
}
/** Another player's card, opened by tapping their name in a chat line: their stance,
 *  worlds, a bot's favour meter, and the same diplomacy actions as the roster row.
 *  Reuses the #playercard overlay; `dataset.seat` tells its click handler which seat
 *  the stance/spy/message buttons target. */
function seatCardHtml(id: string): string {
  const bdg = seatBadge(id);
  const col = ownerColor(id);
  const st = getStance(s, ME, id);
  const favBar = isAiSeat(id) ? favourBarHtml(id) : '';
  const row = (k: string, v: string) =>
    `<div class="pc-row"><span class="pc-k">${k}</span><span class="pc-v">${v}</span></div>`;
  return (
    `<div class="pc-head"><span class="pc-dia" style="background:${col};box-shadow:0 0 10px ${col}"></span>` +
    `<b>${esc(NAME[id] ?? id)}</b><span class="pc-tag">${esc(bdg.tag)}</span></div>` +
    `<div class="pc-stats">` +
    row(
      t('card.stances'),
      `<span class="dp-stance" style="color:${stanceCol(st)};border-color:${stanceCol(st)}">${stanceRu(st)}</span>`,
    ) +
    row(t('card.worlds'), String(worldsOf(id))) +
    `</div>` +
    (favBar ? `<div class="pc-stats">${favBar}</div>` : '') +
    `<div class="pc-sec">${t('card.diplomacy')}</div>` +
    seatDiploActionsHtml(id) +
    `<button class="pc-close">${t('card.close')}</button>`
  );
}
function openSeatCard(id: string): void {
  if (id === ME || !s.players[id]) return void openPlayerCard();
  const el = document.getElementById('playercard');
  if (!el) return;
  el.dataset.seat = id;
  el.innerHTML = `<div class="pcbox">${seatCardHtml(id)}</div>`;
  el.classList.add('show');
}
/** Repaint the open seat card after a diplomacy action, plus any other surface that
 *  shows the same stance (the roster / the floating chat feed). */
function refreshSeatCard(id: string): void {
  const el = document.getElementById('playercard');
  if (el && el.dataset.seat === id) el.innerHTML = `<div class="pcbox">${seatCardHtml(id)}</div>`;
  if (diploOpen) renderDiplo();
  chatWin.refreshIfVisible();
}

// --- session diplomacy & comms menu ------------------------------------------
// Opened from the left rail (Diplomacy / Dispatches). Two tabs: the participant
// roster (icon = human vs AI, sortable by name / provinces / stance, with stance
// actions) and the session message log. Stances run through the core's
// `diplomacy.declare`; messages are a client-side session log (SessionMsg).
const STANCE_RU: Record<DiplomaticStance, string> = {
  war: 'diplo.stance.war',
  peace: 'diplo.stance.peace',
  pact: 'diplo.stance.pact',
  alliance: 'diplo.stance.alliance',
};
/** Localized stance label (canonical Russian msgid → the locale translates). */
function stanceRu(st: DiplomaticStance): string {
  return t(STANCE_RU[st]);
}


function worldsOf(id: string): number {
  let n = 0;
  for (const p of Object.values(s.planets)) if (p.owner === id) n++;
  return n;
}
/** A seat the AI drives. Everyone else (ME, or another human in net play) is human —
 *  this drives the roster's human/AI icon and whether a proposal is auto-decided. */
function isAiSeat(id: string): boolean {
  // The authoritative flag lives in state (Player.ai, seeded by newGame). The local
  // AI_PLAYERS set stays only as a local-mode fallback for installed scenarios; in
  // NET play the server state is the single source — a human-claimed seat is human.
  return s.players[id]?.ai === true || (!NET && AI_PLAYERS.has(id));
}
/** Seats taking part in the match, in the fixed seat order. */
function diploSeats(): string[] {
  return SEAT_META.map((m) => m.id).filter((id) => !!s.players[id]);
}
/** Message stamp. Defaults to `Day N · HH:MM` (game day + game time, mirrors the status
 *  strip); the chat passes toggles to add/drop fields and append the real wall-clock. */
function fmtStamp(at: number, opts?: StampOpts): string {
  const o = opts ?? { day: true, time: true };
  const p2 = (n: number) => String(n).padStart(2, '0');
  const parts: string[] = [];
  // День и время суток — `format.ts` (REFM-136): счёт дней с единицы и остатки суток/часа
  // одинаковы во всех четырёх местах, где игрок читает игровое время.
  if (o.day) parts.push(`D${gameDay(at)}`);
  if (o.time) parts.push(clockHM(at));
  if (o.real && o.realAt != null) {
    const dt = new Date(o.realAt);
    parts.push(`⌚${p2(dt.getHours())}:${p2(dt.getMinutes())}`);
  }
  return parts.join(' ');
}

/** Unread social events (war declarations, stance shifts) — badge on the ✉ rail. */
let unreadMsgs = 0;
/** Diplomacy events don't pass the server's fog filter (their payload names no
 *  location a client owns), so a NET client would never hear a war being declared
 *  on it or a peace being offered. Diff the stance map AND the offer ledger of
 *  consecutive snapshots for pairs with ME and surface changes through the normal
 *  note/DM path. (The offer ledger rides the delta already fogged to the pair.)
 *  Returns true when something shifted — the CALLER re-renders the roster after
 *  it assigns the new state (rendering here would paint from the old `s`). */
function diffNetDiplomacy(prev: GameState, next: GameState): boolean {
  const events = diffDiplomacy(prev, next, ME);
  for (const ev of events) {
    const who = NAME[ev.other] ?? ev.other;
    const stance = stanceRu(ev.stance);
    if (ev.kind === 'stance') {
      note(
        ev.stance === 'war'
          ? t('comms.war-declared', { who })
          : t('comms.stance-changed', { who, stance }),
      );
      pushMsg(ev.other, t('comms.stance-changed.short', { stance }), true, ev.other);
      unreadMsgs++;
    } else if (ev.kind === 'offer-in') {
      note(t('log.diplo.offer', { who, stance }));
      pushMsg(ev.other, t('log.diplo.offer.short', { stance }), true, ev.other);
      unreadMsgs++;
    } else {
      note(t('log.diplo.sent', { who, stance })); // своё исходящее — только уведомление
    }
  }
  return events.length > 0;
}

function pushMsg(to: string, text: string, sys: boolean, from = ME, ping?: string): void {
  sessionMessages.push({ at: s.time, from, to, text, sys, ping, realAt: Date.now() });
  if (sessionMessages.length > 300) sessionMessages.shift();
  if (diploOpen && diploTab === 'msgs') renderDiploFeed();
  chatWin.refreshIfVisible();
}

/** Route an outgoing chat line for conversation key `key` (a group channel const or
 *  a seat id = DM). NET: the server relays it and echoes a `chat.msg` back — the echo
 *  is what appends the line (see onChatMessage), so everyone renders the same
 *  server-stamped message. Solo: append locally. */
function dispatchChat(key: string, text: string): void {
  if (NET && netClient) {
    if (key === CH_GLOBAL) {
      note(t('comms.global.soon'));
      return;
    }
    if (key === CH_SESSION) netClient.sendChat('session', text);
    else if (key === COALITION) netClient.sendChat('coalition', text);
    else netClient.sendChat('dm', text, key);
    return;
  }
  pushMsg(key, text, false);
}

/** Player-driven stance change toward `target`. Escalation (toward war) is
 *  unilateral; warming the relation up files an OFFER the target must answer with
 *  the same declaration (consent — game.ts diplomacyModule). A bot answers on the
 *  spot by its favour meter; a human sees the offer in their roster (NET: the offer
 *  ledger rides the fogged delta) and taps the highlighted stance to accept. */
function proposeStance(target: string, to: DiplomaticStance): void {
  if (target === ME || !s.players[target]) return;
  if (getStance(s, ME, target) === to) return;
  if (to === 'alliance' && isAiSeat(target)) {
    note(t('comms.bots-no-coalition'));
    return;
  }
  // diplomacy.declare escalates / files the offer / commits a matching counter-offer;
  // feedback comes back uniformly via handleEvents (solo) or the snapshot diff (NET).
  playerOrder(declareWar(ME, target, to));
}

/** MAPSHARE-1: один тап — предложить, принять или расторгнуть. Что именно, решает
 *  ядро по текущему состоянию договора; клиент лишь называет сторону и «включить/нет». */
function toggleMapShare(target: string): void {
  if (target === ME || !s.players[target]) return;
  playerOrder(shareMap(ME, target, !hasMapShare(s, ME, target)));
}

function openDiplo(tab: 'diplo' | 'msgs' | 'intel'): void {
  diploOpen = true;
  diploTab = tab;
  renderDiplo();
  document.getElementById('diplo')?.classList.add('show');
}
function closeDiplo(): void {
  diploOpen = false;
  document.getElementById('diplo')?.classList.remove('show');
}

/** Roster icon + tag for a seat: a human commander vs a synthetic (AI) one. */
function seatBadge(id: string): { icon: string; tag: string } {
  if (id === ME) return { icon: '☻', tag: 'comms.you' };
  if (isAiSeat(id)) return { icon: '⌬', tag: 'diplo.filter.ai' };
  return { icon: '☻', tag: 'comms.tag.player' };
}

/** Does a seat pass the active roster filters? Stance filter never matches ME (no
 *  self-stance); an empty category imposes no constraint. */
function diploPasses(id: string): boolean {
  if (diploStanceFilter.size) {
    if (id === ME || !diploStanceFilter.has(getStance(s, ME, id))) return false;
  }
  if (diploTypeFilter.size && !diploTypeFilter.has(isAiSeat(id) ? 'ai' : 'human')) return false;
  return true;
}
/** A bot's approval-of-you meter (game.ts botDiplomacyModule). A bot only ever sits at
 *  ≤ FAVOUR_BASE, so a full bar = its passive-friendly baseline; your aggression drains it
 *  past the embargo tick (won't trade on the market) and then the war tick (declares war).
 *  Only shown for AI seats — humans have no favour meter. */
function favourBarHtml(bot: string): string {
  const f = botFavour(s, bot, ME);
  const pct = clamp(f / FAVOUR_BASE, 0, 1) * 100;
  const embPct = (FAVOUR_EMBARGO / FAVOUR_BASE) * 100;
  const warPct = (FAVOUR_WAR / FAVOUR_BASE) * 100;
  const tier = f < FAVOUR_WAR ? 'war' : f < FAVOUR_EMBARGO ? 'embargo' : 'ok';
  const label =
    tier === 'war'
      ? t('comms.favour.brink')
      : tier === 'embargo'
        ? t('comms.favour.embargo')
        : t('comms.favour.friendly');
  const title = t('comms.favour.note', {
    f: Math.round(f),
    base: FAVOUR_BASE,
    label,
    emb: FAVOUR_EMBARGO,
    war: FAVOUR_WAR,
  });
  return (
    `<div class="dp-fav ${tier}" title="${esc(title)}">` +
    `<span class="dp-fav-cap">☺</span>` +
    `<div class="dp-fav-track"><div class="dp-fav-fill" style="width:${pct.toFixed(1)}%"></div>` +
    `<span class="dp-fav-tick emb" style="left:${embPct.toFixed(1)}%"></span>` +
    `<span class="dp-fav-tick war" style="left:${warPct.toFixed(1)}%"></span></div>` +
    `<span class="dp-fav-lbl">${label}</span></div>`
  );
}
/** Live stolen-intel readout for one seat (under its expanded actions): the
 *  treasury window prints the victim's actual resources, a fleets window says the
 *  map shows them, planet windows list the scanned worlds. Empty when nothing lives. */
function intelRowHtml(target: string): string {
  const bits: string[] = [];
  for (const g of myIntel()) {
    const left = fmtEta(grantLeftMs(g, s.time) / HOUR);
    if (g.kind === 'treasury' && g.target === target) {
      const r = s.players[target]?.resources ?? {};
      const bag = resLine(
        Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.floor(v as number)])),
      );
      bits.push(t('comms.intel.treasury', { bag: bag || '—', left }));
    } else if (g.kind === 'fleets' && g.target === target) {
      bits.push(t('comms.intel.fleets', { left }));
    } else if (g.kind === 'planet' && s.planets[g.target]?.owner === target) {
      bits.push(t('comms.intel.world', { id: esc(g.target), left }));
    }
  }
  if (!bits.length) return '';
  return `<div class="dp-intel">🕵 ${bits.join(' · ')}</div>`;
}
/** The diplomacy affordances for one other seat `id`: stance proposals (with the
 *  consent state — их предложение ✓ / наше ⏳), the two spy buttons, and the DM
 *  button, followed by the live intel row. Shared by the roster's expanded row and
 *  the player card opened from a chat nick, so both stay in lockstep. */
/**
 * MAPSHARE-1 — кнопка договора об обмене картами. Отдельная от лестницы стоек, потому
 * что и сам договор отдельный: его заключают и при мире, и при пакте, и он не делает
 * союзником. Те же аффордансы согласия, что у смягчения стойки: их предложение — «✓»
 * (тап принимает), моё — «⏳» (ждём их), действующий договор — активная кнопка (тап
 * расторгает). При войне заключить нельзя — ядро отобьёт, поэтому и кнопка заперта.
 */
function mapShareBtnHtml(id: string): string {
  const live = hasMapShare(s, ME, id);
  const theirs = !live && hasMapShareOffer(s, id, ME);
  const mine = !live && !theirs && hasMapShareOffer(s, ME, id);
  const atWar = !live && getStance(s, ME, id) === 'war';
  const label = theirs ? `✓ ${t('comms.mapshare')}` : mine ? `⏳ ${t('comms.mapshare')}` : t('comms.mapshare');
  const title = atWar
    ? t('comms.mapshare.war')
    : live
      ? t('comms.mapshare.drop')
      : theirs
        ? t('comms.offer.incoming', { who: NAME[id] ?? id })
        : mine
          ? t('comms.offer.sent')
          : t('comms.mapshare.hint');
  const cls = `dp-map${live ? ' on' : ''}${theirs ? ' offer' : ''}${mine ? ' pend' : ''}`;
  return `<button class="${cls}" data-mapseat="${id}"${atWar || mine ? ' disabled' : ''} title="${esc(title)}">🗺 ${label}</button>`;
}
function seatDiploActionsHtml(id: string): string {
  const st = getStance(s, ME, id);
  return (
    `<div class="dp-actions">` +
    STANCES.map((sk) => {
      const barred = sk === 'alliance' && isAiSeat(id); // боты не вступают в коалиции
      // Consent affordances: THEIR pending offer of this stance → tapping accepts
      // (✓, pulsing); MY pending offer → sent, waiting on them (⏳, disabled).
      const theirs = !barred && getOffer(s, id, ME) === sk;
      const mine = !barred && !theirs && getOffer(s, ME, id) === sk;
      const cls = `dp-act${sk === st ? ' on' : ''}${theirs ? ' offer' : ''}${mine ? ' pend' : ''}`;
      const label = theirs ? `✓ ${stanceRu(sk)}` : mine ? `⏳ ${stanceRu(sk)}` : stanceRu(sk);
      const title = barred
        ? t('comms.bots-no-coalition')
        : theirs
          ? t('comms.offer.incoming', { who: NAME[id] ?? id })
          : mine
            ? t('comms.offer.sent')
            : '';
      return `<button class="${cls}" data-stance="${sk}" data-seat="${id}" style="--sc:${stanceCol(sk)}"${barred || mine ? ' disabled' : ''}${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    }).join('') +
    mapShareBtnHtml(id) +
    `<button class="dp-spy" data-spy="treasury" data-seat="${id}" title="${t('comms.spy.treasury', { c: SPY_COST })}">🕵 ${t('log.spy.kind.treasury')}</button>` +
    `<button class="dp-spy" data-spy="fleets" data-seat="${id}" title="${t('comms.spy.fleets', { c: SPY_COST })}">🕵 ${t('spy.op.fleets')}</button>` +
    `<button class="dp-msg" data-msgseat="${id}">✉</button></div>` +
    intelRowHtml(id)
  );
}
function diploRowsHtml(): string {
  const others = diploSeats().filter((id) => id !== ME);
  const byName = (a: string, b: string) => (NAME[a] ?? a).localeCompare(NAME[b] ?? b);
  if (diploSort === 'name') others.sort(byName);
  else if (diploSort === 'worlds') others.sort((a, b) => worldsOf(b) - worldsOf(a) || byName(a, b));
  else
    others.sort(
      (a, b) => STANCE_RANK[getStance(s, ME, a)] - STANCE_RANK[getStance(s, ME, b)] || byName(a, b),
    );
  const ordered = [ME, ...others].filter(diploPasses);
  // Keep the expansion in sync with visibility: if a filter (or a stance/capture change
  // that re-renders) hides the expanded seat, drop the expansion — otherwise the row
  // re-opens itself when that seat later re-enters the list.
  if (diploExpanded && !ordered.includes(diploExpanded)) diploExpanded = null;
  if (!ordered.length) return `<div class="dp-empty">${t('comms.filter.empty')}</div>`;
  return ordered
    .map((id) => {
      const bdg = seatBadge(id);
      const col = ownerColor(id);
      const w = worldsOf(id);
      const isMe = id === ME;
      const st = isMe ? null : getStance(s, ME, id);
      const stanceTag = isMe
        ? `<span class="dp-tag">${t('comms.you')}</span>`
        : `<span class="dp-stance" style="color:${stanceCol(st!)};border-color:${stanceCol(st!)}">${stanceRu(st!)}</span>`;
      // Bots (AI seats) carry a favour meter toward you; humans/you don't.
      const favBar = !isMe && isAiSeat(id) ? favourBarHtml(id) : '';
      const expanded = diploExpanded === id && !isMe;
      const actions = expanded ? seatDiploActionsHtml(id) : '';
      return (
        `<div class="dp-row${expanded ? ' open' : ''}${isMe ? ' me' : ''}"${isMe ? '' : ` data-seat="${id}"`}>` +
        `<span class="dp-ic" style="color:${col}">${bdg.icon}</span>` +
        `<span class="dp-name">${esc(NAME[id] ?? id)} <em>${bdg.tag}</em></span>` +
        `<span class="dp-w" title="${t('comms.provinces')}">⬣ ${w}</span>` +
        stanceTag +
        favBar +
        `</div>` +
        actions
      );
    })
    .join('');
}

// --- conversations (messages tab: list of chats + the open thread) -----------
// The tab lives in `conversations.ts` (REFM-15); here it only gets the host state it
// cannot reach on its own. The message log itself STAYS here — the net writes it and
// the floating chat window reads it, so the module borrows it through `messages()`.
const conversations = initConversations({
  state: () => s,
  me: () => ME,
  messages: () => sessionMessages,
  nameOf: (id) => NAME[id] ?? id,
  seats: diploSeats,
  seatBadge,
  fmtStamp,
  ownerColor,
});

/** SPY-UX (плейтест, вариант 1): весь шпионаж в одном месте — активные окна интела
 *  с таймерами, операции по каждому противнику (те же .dp-spy обработчики, что и в
 *  ростере) и сессионный журнал попыток. Разведка мира остаётся на карточке планеты
 *  (нужна цель) — вкладка ведёт к ней подсказкой. */
function intelTabHtml(): string {
  const grantLabel = (g: IntelGrant): string =>
    g.kind === 'treasury'
      ? t('log.spy.what.treasury', { who: NAME[g.target] ?? g.target })
      : g.kind === 'fleets'
        ? t('log.spy.what.fleets', { who: NAME[g.target] ?? g.target })
        : t('log.spy.what.world', { at: g.target });
  const rows = myIntel()
    .sort((a, b) => a.until - b.until)
    .map((g) => {
      const left = Math.max(0, Math.ceil((g.until - s.time) / HOUR));
      const jump = g.kind === 'planet' ? ` data-iw="${esc(g.target)}"` : '';
      return (
        `<div class="in-row"${jump}><span class="in-k">🗝</span><b>${esc(grantLabel(g))}</b>` +
        `<span class="in-t">⏳ ${t('fmt.hours', { n: left })}</span>${g.kind === 'planet' ? '<span class="in-go">↪</span>' : ''}</div>`
      );
    })
    .join('');
  const ops = Object.keys(s.players)
    .filter((id) => id !== ME)
    .map(
      (id) =>
        `<div class="in-row"><b>${esc(NAME[id] ?? id)}</b>` +
        `<button class="dp-spy" data-spy="treasury" data-seat="${id}">🕵 ${t('log.spy.kind.treasury')}</button>` +
        `<button class="dp-spy" data-spy="fleets" data-seat="${id}">🕵 ${t('spy.op.fleets')}</button></div>`,
    )
    .join('');
  const log = [...spyLog]
    .reverse()
    .map((e) => {
      const d = gameDay(e.at);
      const h = dayHour(e.at);
      return `<div class="in-log">D${d} ${String(h).padStart(2, '0')}ч · ${esc(e.text)}</div>`;
    })
    .join('');
  return (
    `<div class="dp-list in-list">` +
    `<div class="in-hint">${t('spy.note', { c: SPY_COST })}</div>` +
    `<div class="in-sec">${t('spy.windows.title')}</div>` +
    (rows || `<div class="in-empty">${t('spy.windows.empty')}</div>`) +
    `<div class="in-sec">${t('spy.ops.title')}</div>` +
    (ops || `<div class="in-empty">${t('spy.ops.empty')}</div>`) +
    `<div class="in-sec">${t('spy.log.title')}</div>` +
    (log || `<div class="in-empty">${t('spy.log.empty')}</div>`) +
    `</div>`
  );
}
function renderDiplo(): void {
  const el = document.getElementById('diplo');
  if (!el) return;
  const tabBtn = (k: 'diplo' | 'msgs' | 'intel', label: string) =>
    `<button class="dp-tab${diploTab === k ? ' on' : ''}" data-tab="${k}">${label}</button>`;
  const sortBtn = (k: typeof diploSort, label: string) =>
    `<button class="dp-sortb${diploSort === k ? ' on' : ''}" data-sort="${k}">${label}</button>`;
  const stChip = (k: DiplomaticStance) =>
    `<button class="dp-fchip${diploStanceFilter.has(k) ? ' on' : ''}" data-fstance="${k}" style="--sc:${stanceCol(k)}">${stanceRu(k)}</button>`;
  const tyChip = (k: 'human' | 'ai', label: string) =>
    `<button class="dp-fchip ty${diploTypeFilter.has(k) ? ' on' : ''}" data-ftype="${k}">${label}</button>`;
  const anyFilter = diploStanceFilter.size || diploTypeFilter.size;
  const filterRow =
    `<div class="dp-filters"><span>${t('diplo.filter')}:</span>` +
    STANCES.map(stChip).join('') +
    `<span class="dp-fsep"></span>${tyChip('human', '☻ ' + t('diplo.filter.human'))}${tyChip('ai', '⌬ ' + t('diplo.filter.ai'))}` +
    (anyFilter
      ? `<button class="dp-fclear" data-fclear="1">${t('diplo.filter.reset')}</button>`
      : '') +
    `</div>`;
  const body =
    diploTab === 'diplo'
      ? `<div class="dp-sorts"><span>${t('diplo.sort')}:</span>${sortBtn('name', t('diplo.sort.name'))}${sortBtn('worlds', t('diplo.sort.provinces'))}${sortBtn('stance', t('diplo.sort.stance'))}</div>` +
        filterRow +
        `<div class="dp-list">${diploRowsHtml()}</div>`
      : diploTab === 'intel'
        ? intelTabHtml()
        : `<div class="dp-convo">${conversations.listHtml()}${conversations.threadHtml()}</div>`;
  el.innerHTML =
    `<div class="dpbox">` +
    `<div class="dp-head"><b>${t('diplo.win.title')}</b>${tabBtn('diplo', t('diplo.tab.diplomacy'))}${tabBtn('msgs', t('diplo.tab.messages'))}${tabBtn('intel', t('diplo.tab.espionage'))}<button class="dp-close">✕</button></div>` +
    body +
    `</div>`;
  if (diploTab === 'msgs') scrollFeedToEnd();
}
/** Patch just the open thread's feed (so a new line doesn't wipe a half-typed reply). */
function renderDiploFeed(): void {
  const feed = document.getElementById('dp-feed');
  if (!feed) return;
  feed.innerHTML = conversations.feedInnerHtml();
  feed.scrollTop = feed.scrollHeight;
}
function scrollFeedToEnd(): void {
  const feed = document.getElementById('dp-feed');
  if (feed) feed.scrollTop = feed.scrollHeight;
}

/** A compact codex tile (icon + a one-line label) that opens the full info panel on
 *  tap. `label` is the build cost for buildables, or ×count for a fleet's ships. The
 *  tiles live in context — building tiles in the build menu, ship tiles in the fleet
 *  panel — not in a global HUD strip. Identification is the game tooltip only: the
 *  PC cursor dossier (#objtip, via data-desc) and the mobile long-press bubble
 *  (data-name). No native `title` — it duplicated #objtip as a second, uglier popup. */
/** A building is one-per-planet BY DEFAULT — since RULES-2 the number is the catalogue's
 *  `maxPerPlanet`, and the core (not this helper) enforces it; the whole shipped catalogue
 *  is still on the default 1.
 *  Returns why a fresh build order would be refused — so the build tile can grey out
 *  the moment it's committed (built / building / queued / paused), instead of taking
 *  the order and only rejecting it when the queue reaches it. `null` = orderable. */
function buildingLocked(planetId: string, id: string): TileLock {
  const p = s.planets[planetId];
  if (!p) return null;
  // RULES-1: правило «одно здание такого типа на мир» больше НЕ переписано здесь —
  // его называет ядро тем же кодом отказа, каким отбило бы сам приказ. Раньше клиент
  // держал свою копию (буквально `p.buildings.some(...)` + скан scheduled + paused),
  // и копия разъезжалась: кодекс проверял только «уже стоит» и всю стройку первого
  // экземпляра предлагал заказать второй.
  // Какие коды означают повтор, а какие плитку НЕ гасят — в `catalogTile.ts`
  // (REFM-42). Локальная очередь прототипа ядру неизвестна по определению (в сети
  // её нет — там стройку таймит сервер), поэтому она приходит отдельным флагом.
  return tileLock(
    canOrder(s, buildBuilding(ME, planetId, id)),
    queueOf(planetId).buildings.some((q) => q.kind === 'building' && q.id === id),
  );
}
/** Доход ПОСТРОЕННОГО здания за час — готовой разметкой; у недоходного пусто. Цифра
 *  считается тем же `buildingLevel`, что и строка «производит» в карточке кодекса:
 *  список и карточка обязаны называть одно число, иначе список врёт про доход. */
function incomeOf(type: string, level: number): string {
  const def = data.buildings[type];
  return def ? resLine(buildingLevel(def, level).produces, { per: 'h' }) : '';
}
function codexTile(
  kind: 'b' | 'u',
  id: string,
  label: string,
  orderable = false,
  lockedFor?: TileLock,
  as: CatalogShape = 'tile',
): string {
  if (!(kind === 'b' ? data.buildings[id] : data.units[id])) return '';
  // Разметку плитки собирает `catalogTile.ts` (REFM-42) — там же правило «запертая
  // теряет ОБА якоря заказа, оставляя досье» и обе подачи одного каталога.
  const v = {
    kind,
    id,
    icon: kind === 'b' ? (BUILD_ICON[id] ?? '▣') : unitIconHtml(id, data, youColor),
    name: kind === 'b' ? buildingName(data.buildings[id]?.name, id) : unitTitle(id),
    label,
    orderable,
    lock: lockedFor ?? null,
  };
  return as === 'row' ? catalogRowHtml(v) : catalogTileHtml(v);
}
/** Ground-garrison tiles (the ЗЕМЛЯ tab): one flowing row of icon·count chips — no
 *  names; the hover dossier (PC) / tap dossier (touch) carries the identification. */
function openCodex(key: string): void {
  const [kind, id, lvl] = key.split(':');
  const el = document.getElementById('codex');
  if (!el || !kind || !id) return;
  // BUILD-1: карточка здания листает уровни (`b:id:уровень`). Без уровня в ключе
  // показывается ТЕКУЩИЙ построенный на выбранном мире (если есть) — владелец
  // открывает свою постройку и видит её, а не абстрактный первый уровень.
  const builtLvl =
    kind === 'b' && selPlanet
      ? s.planets[selPlanet]?.buildings.find((b) => b.type === id)?.level
      : undefined;
  const level = Number(lvl) || builtLvl || 1;
  el.innerHTML = `<div class="cxbox">${codexHtml(kind, id, level)}${codexBuildBtn(kind, id, level)}<button class="cx-close">${t('codex.close')}</button></div>`;
  el.classList.add('show');
}
/** A "Build here" action inside the codex when the selected province can raise this
 *  thing — so the codex doubles as the build menu (tap a build tile → specs → build). */
function codexBuildBtn(kind: string, id: string, level = 1): string {
  const p = selPlanet ? s.planets[selPlanet] : null;
  if (!p || p.owner !== ME) return ''; // only when you're looking at one of your worlds
  if (kind === 'b') {
    // BUILD-1: у ПОСТРОЕННОГО здания карточка предлагает «Улучшить» — той же пробой
    // ядра, которой решается сам приказ (RULES-1): очередь, казна и потолок уровня
    // покрыты одним вопросом. Недоступный по любой причине, кроме казны, — без кнопки.
    const inst = p.buildings.find((b) => b.type === id);
    if (inst) {
      const def = data.buildings[id];
      const max = def ? buildingMaxLevel(def) : 1;
      if (inst.level >= max) return '';
      const code = canOrder(s, upgradeBuilding(ME, p.id, id));
      if (code !== null && code !== 'E_INSUFFICIENT') return '';
      const c = def ? buildingLevel(def, inst.level + 1).cost : undefined;
      return `<button class="cx-build" data-cx-upg="${id}"${code ? ' disabled' : ''}>${t('side.build.upgrade', { c: '' })}${cost(c, myRes())}</button>`;
    }
    const buildable = (sectorTypeOf(p.id)?.allowedBuildings ?? BUILDABLE).includes(id);
    // buildingLocked, а не только «уже стоит»: СТРОЯЩЕЕСЯ здание ещё не в p.buildings
    // (оно попадает туда на construction.complete), и кодекс предлагал «Построить
    // здесь» второй экземпляр одноэкземплярного здания всю стройку первого.
    if (!buildable || buildingLocked(p.id, id)) return '';
    if (level > 1) return ''; // листаешь будущие уровни — строится всё равно первый
    return `<button class="cx-build" data-build="building:${id}">▣ ${t('codex.build-here')} · ${cost(data.buildings[id]?.cost, myRes())}</button>`;
  }
  if (kind === 'u' && data.units[id]) {
    return `<button class="cx-build" data-build="unit:${id}">${unitIconHtml(id, data, youColor, 16)} ${t('codex.build-here')} · ${cost(data.units[id]?.cost, myRes())}</button>`;
  }
  return '';
}

// --- ONB-4 codex/help hub: searchable index over the article corpus ----------
// The pure index (src/codexIndex.ts) flattens every unit/building + a glossary of
// tricky terms; here we localise labels and render a searchable «?» surface. A tap
// on a result deep-links into the single-article codex (openCodex), so any
// term/unit/mechanic is two taps away. Entry points: hub «Ещё → Справочник» + the
// in-match rail «?».
const CODEX_INDEX = buildCodexIndex(data, GLOSSARY);
const CODEX_SECTIONS: Array<[CodexCategory, string]> = [
  ['unit', 'codex.hub.sec.unit'],
  ['building', 'codex.hub.sec.building'],
  ['mechanic', 'codex.hub.sec.mechanic'],
];
function codexEntryLabel(e: CodexEntry): string {
  const id = e.key.slice(2);
  if (e.category === 'unit') return unitTitle(id);
  if (e.category === 'building') return buildingName(data.buildings[id]?.name, id);
  return t(e.titleKey ?? e.title); // mechanic: the heading lives in the locale
}
function codexEntryIcon(e: CodexEntry): string {
  const id = e.key.slice(2);
  if (e.category === 'unit') return unitIconHtml(id, data, youColor, 20);
  if (e.category === 'building') return BUILD_ICON[id] ?? '▣';
  return '?';
}
function codexItemHtml(e: CodexEntry): string {
  return `<button class="ch-item" data-codex="${esc(e.key)}"><span class="ch-ic">${codexEntryIcon(e)}</span><span>${esc(codexEntryLabel(e))}</span></button>`;
}
// Search folds the LOCALISED label into the haystack so RU and EN queries both hit.
function renderCodexResults(query: string): void {
  const host = document.getElementById('ch-results');
  if (!host) return;
  const hits = searchCodex(CODEX_INDEX, query, (e) =>
    (codexEntryLabel(e) + ' ' + e.title + ' ' + e.tags.join(' ')).toLowerCase(),
  );
  if (!query.trim()) {
    // Empty query → browse by category.
    host.innerHTML = CODEX_SECTIONS.map(([cat, label]) => {
      const items = hits.filter((e) => e.category === cat);
      return items.length
        ? `<div class="ch-sec">${t(label)}</div><div class="ch-grid">${items.map(codexItemHtml).join('')}</div>`
        : '';
    }).join('');
    return;
  }
  host.innerHTML = hits.length
    ? `<div class="ch-grid">${hits.map(codexItemHtml).join('')}</div>`
    : `<div class="ch-empty">${t('codex.hub.empty')}</div>`;
}
function openCodexHub(): void {
  const box = document.getElementById('codexhub');
  if (!box) return;
  box.innerHTML =
    `<div class="chbox"><div class="ch-head"><span class="cx-ic">?</span><b>${t('codex.hub.title')}</b></div>` +
    `<input id="ch-search" class="ch-search" type="text" placeholder="${t('codex.hub.search.ph')}" aria-label="${t('codex.hub.search.aria')}">` +
    `<div class="ch-body" id="ch-results"></div>` +
    `<button class="cx-close" id="ch-close">${t('codex.hub.close')}</button></div>`;
  const input = document.getElementById('ch-search') as HTMLInputElement | null;
  if (input) input.oninput = () => renderCodexResults(input.value);
  renderCodexResults('');
  box.classList.add('show');
  input?.focus();
}
// One delegated handler for the hub (rebuilt each open, so wire the container once).
document.getElementById('codexhub')?.addEventListener('click', (ev) => {
  const box = document.getElementById('codexhub')!;
  const tg = ev.target as HTMLElement;
  if (tg === box || tg.closest('#ch-close')) {
    box.classList.remove('show'); // backdrop / CLOSE
    return;
  }
  const item = tg.closest('.ch-item') as HTMLElement | null;
  if (item?.dataset.codex) openCodex(item.dataset.codex); // deep-link → single article (layers on top)
});
document.getElementById('hub-help')?.addEventListener('click', openCodexHub);
document.getElementById('rail-help')?.addEventListener('click', openCodexHub);

// --- ONB-3 just-in-time mechanic intros --------------------------------------
// The first time a player opens an advanced panel, a one-screen card explains it,
// then never again (per-callsign seen-set). A veteran (has finished a match →
// meta XP > 0) is marked seen silently, so they are never nagged.
function seenIntrosKey(): string {
  return 'vd.seenIntros.' + (nickInput.value.trim() || 'guest');
}
function showIntro(card: IntroCard): void {
  const el = document.getElementById('intro');
  if (!el) return;
  el.innerHTML =
    `<div class="inbox"><div class="in-head"><span class="in-ic">✦</span><b>${esc(t(card.titleKey))}</b>` +
    `<span class="in-tag">${t('onb.intro.badge')}</span></div>` +
    `<div class="in-body">${esc(t(card.bodyKey))}</div>` +
    `<button class="in-ok">${t('onb.intro.ok')}</button></div>`;
  el.classList.add('show');
}
// Panel-open hook: show the intro for `id` once (unless already seen / a veteran).
function maybeIntro(id: string): void {
  const seen = parseSeenIntros(localStorage.getItem(seenIntrosKey()));
  const veteran = loadMeta().xp > 0; // finished at least one match → knows the ropes
  const { card, seen: next } = resolveIntro(seen, id, { veteran });
  localStorage.setItem(seenIntrosKey(), JSON.stringify(next));
  if (card) showIntro(card);
}
document.getElementById('intro')?.addEventListener('click', (ev) => {
  const el = document.getElementById('intro')!;
  const tg = ev.target as HTMLElement;
  if (tg === el || tg.closest('.in-ok')) el.classList.remove('show'); // backdrop / «Понятно»
});

// --- ONB-5 return digest ("пока тебя не было") -------------------------------
// The world runs while you're away (a backgrounded tab catches up on return, and
// on the server it runs 24/7). Rather than a silently-changed map, brief the player
// on what happened since they left — attention items first, tap to jump to the spot.
let awayFromGameTime: number | null = null;
function recapItemHtml(i: { text: string; anchor?: string; high: boolean }): string {
  const jump = i.anchor ? ` data-jump="${esc(i.anchor)}"` : '';
  return `<button class="rc-item${i.high ? ' hi' : ''}"${jump}><span class="rc-dot"></span><span>${esc(i.text)}</span></button>`;
}
/** Render the digest of events at/after `since`. No-op when nothing happened. */
function openRecap(since: number): void {
  const el = document.getElementById('recap');
  if (!el) return;
  const r = buildRecap(eventLog, since);
  // Политика показа — `awayBrief.ts` (REFM-74): пустой брифинг не нагружает, важное выше.
  if (!worthShowing(r.count)) return;
  const { hi, lo } = splitByAttention(r.items);
  let body = '';
  if (hi.length)
    body +=
      `<div class="rc-sec hi">${t('onb.recap.attention', { n: r.attention })}</div>` +
      hi.map(recapItemHtml).join('');
  if (lo.length)
    body += `<div class="rc-sec">${t('onb.recap.rest')}</div>` + lo.map(recapItemHtml).join('');
  el.innerHTML =
    `<div class="rcbox"><div class="rc-head"><span class="cx-ic">🛰</span><b>${t('onb.recap.title')}</b></div>` +
    `<div class="rc-body">${body}</div><button class="cx-close" id="rc-close">${t('onb.recap.close')}</button></div>`;
  el.classList.add('show');
}
document.getElementById('recap')?.addEventListener('click', (ev) => {
  const el = document.getElementById('recap')!;
  const tg = ev.target as HTMLElement;
  if (tg === el || tg.closest('#rc-close')) {
    el.classList.remove('show');
    return;
  }
  const jump = tg.closest('.rc-item') as HTMLElement | null;
  if (jump?.dataset.jump) {
    el.classList.remove('show');
    jumpToPing(jump.dataset.jump); // fly the camera to the event's world
  }
});
// The «🛰» button in the log window → the whole-session briefing on demand.
document.getElementById('lw-recap')?.addEventListener('click', () => openRecap(0));
// Auto-briefing: mark where we left when the tab hides; on return (after the sim has
// caught up the elapsed time) summarise what happened — only for a real absence.
let awayAtRealMs = 0;
document.addEventListener?.('visibilitychange', () => {
  if (document.hidden) {
    if (marksAway(true, inMatch())) {
      awayFromGameTime = s.time;
      awayAtRealMs = Date.now();
    }
    return;
  }
  const since = briefSince({
    awayFromGameTime,
    inMatch: inMatch(),
    awayAtRealMs,
    nowRealMs: Date.now(),
  });
  awayFromGameTime = null; // метка одноразовая: иначе второй возврат покажет то же ещё раз
  if (since === null) return;
  // Give the frame loop a beat to catch the world up before we summarise it.
  window.setTimeout(() => {
    if (inMatch()) openRecap(since);
  }, 500);
});

/** A `b:<id>:<lvl>` key embeds its building level in the title (as `hl(lvl)`) — shared
 *  by the desktop hover pane and the mobile tap modal so both read identically. */
function dossierTitleHtml(key: string, d: Dossier): string {
  const lvl = dossierLevel(key); // разбор ключа — `dossierHover.ts` (REFM-82)
  return lvl ? `${esc(d.name)} ${hl(lvl)}` : esc(d.name);
}

/** Right-docked description pane HTML for the currently hovered menu object. */
function objDescHtml(): string {
  const d = hoverObj ? objDossier(hoverObj) : null;
  if (!d) {
    return `<div class="pd-empty">${t('dossier.hint')}</div>`;
  }
  return `<div class="pd-title">${dossierTitleHtml(hoverObj!, d)}</div><div class="pd-body">${d.body}</div>`;
}

/** Touch has no hover — a tap on a `[data-desc]` object opens the SAME dossier in the
 *  codex overlay instead (reuses its box/close chrome; no "Build here" button here). */
function openDossier(key: string): boolean {
  const d = objDossier(key);
  const el = document.getElementById('codex');
  if (!el || !d) return false;
  el.innerHTML = `<div class="cxbox"><div class="cx-head"><b>${dossierTitleHtml(key, d)}</b></div><div class="cx-desc">${d.body}</div><button class="cx-close">${t('codex.close')}</button></div>`;
  el.classList.add('show');
  return true;
}

function renderObjDesc(): void {
  const pane = document.getElementById('pdesc');
  if (!pane) return;
  const html = objDescHtml();
  if (html === lastObjDescHtml) return;
  lastObjDescHtml = html;
  pane.innerHTML = html;
}

let sheetWasOpen = false;
function renderPanel() {
  // Кто прячет лист — решает hudDock.panelOpen: признак один на все режимы прицела
  // («ждём тап по карте»), и «Курс» в нём теперь наравне со слиянием, набором группы
  // и режимом «Приказ». Раньше движение было исключением: игрок жал ⤳ и тапал в лист,
  // который закрывал пол-карты (заказ владельца — убирать нижний хаб и на движении).
  const dock: DockState = {
    aiming,
    merging,
    picking: pickMode,
    chaining: chainMode !== null,
    hasSelection: selFleet !== null || selPlanet !== null || selFleets.size > 0,
  };
  const open = panelOpen(dock);
  side.style.display = open ? 'flex' : 'none';
  document.body.classList.toggle('sheet-open', open); // mobile: hide log/comms under the sheet
  // Нижний хаб (рейл/скорость/цели) уезжает на телефоне, пока карта — рабочая
  // поверхность. Класс ставится здесь, а не в обработчиках: renderPanel гоняется
  // каждый кадр, поэтому класс физически не может разъехаться с состоянием — а
  // взводится и гасится прицел из полутора десятков мест.
  document.body.classList.toggle('aim-mode', mapIsWorkspace(dock));
  // Phone: the bottom sheet covers ~50vh — when it OPENS, pan the camera so the
  // selected object is not the one thing the panel talks about yet hides.
  // Момент открытия и величина подъёма — `sheetLift.ts` (REFM-83).
  if (opensNow(open, sheetWasOpen, MOBILE)) {
    // Выбран флот — якорь только его: лист говорит про флот, и уезжать к миру под ним
    // неправильно. Негде нарисовать флот — камера остаётся на месте.
    const anchor = selFleet
      ? (s.fleets[selFleet] && fleetAnchor(s.fleets[selFleet]!)) || null
      : selPlanet && s.planets[selPlanet]
        ? world(s.planets[selPlanet]!.position)
        : null;
    const dy = liftBy(anchor ? anchor.y : null, VH);
    if (dy) {
      cam.y -= dy;
      clampCam();
    }
  }
  sheetWasOpen = open;
  if (!open) {
    lastPanelHtml = '';
    lastObjDescHtml = '';
    hoverObj = null;
    return;
  }
  const html = panelHtml();
  if (html !== lastPanelHtml) {
    // Scrollable content on the left, a fixed dossier pane glued to the right edge
    // (filling the panel's empty space — see #side / .pdesc CSS). Re-rendering the
    // content rebuilds #pdesc, so force the dossier to repaint against the new DOM.
    // Preserve the scroll offset across the rebuild — the build conveyor's countdown
    // changes the HTML every frame, which would otherwise snap the list back to top
    // and make the panel impossible to scroll while anything is under construction.
    const prevScroll = (side.querySelector('.pscroll') as HTMLElement | null)?.scrollTop ?? 0;
    side.innerHTML = `<div class="pscroll">${html}</div><aside class="pdesc" id="pdesc"></aside>`;
    const ps = side.querySelector('.pscroll') as HTMLElement | null;
    if (ps && prevScroll > 0) ps.scrollTop = prevScroll;
    lastPanelHtml = html;
    lastObjDescHtml = '';
  }
  renderObjDesc();
  updatePanelLive(); // patch live countdowns in place — never rebuild the panel for them
}

/** Patch the panel's per-frame text (build progress, travel ETA, battle round) in
 *  place each frame. These tick every frame, so they're kept OUT of the panel's HTML
 *  signature — the panel (and its buttons) only rebuilds on real structural changes,
 *  so a click whose down/up straddle a frame is never dropped. */
function updatePanelLive(): void {
  const root = side.querySelector('.pscroll');
  if (!root) return;
  for (const el of Array.from(root.querySelectorAll('.conv-fill')) as HTMLElement[]) {
    // Зажим полосы — `buildProgress.ts` (REFM-77): кадр может прийти позже срока работы.
    const pct = barPct(Number(el.dataset.at), Number(el.dataset.dur), s.time);
    el.style.width = `${pct.toFixed(0)}%`;
  }
  for (const el of Array.from(root.querySelectorAll('.conv-time')) as HTMLElement[]) {
    el.textContent = timeLeft(Number(el.dataset.at));
  }
  for (const el of Array.from(root.querySelectorAll('.pn-eta')) as HTMLElement[]) {
    // То же правило, что и в карточке флота: `travelEta.ts` (REFM-67), без второй копии.
    const totalH = arrivalHours(Number(el.dataset.arrive), s.time, HOUR, Number(el.dataset.rest));
    el.textContent = fmtEta(totalH);
  }
  for (const el of Array.from(root.querySelectorAll('.pn-timer')) as HTMLElement[]) {
    el.textContent = timeLeft(Number(el.dataset.at));
  }
}

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
): string {
  const tip = desc ? `${label} — ${desc}` : label;
  return `<button data-cmd="${cmd}" class="${cls}" title="${esc(tip)}" aria-label="${esc(tip)}" ${disabled ? 'disabled' : ''}><span class="ci">${icon}</span><span class="cl">${esc(label)}</span></button>`;
}

/** CHAIN-UX: полоска режима «Приказ» — живёт в ноде #cmdbar (все четыре
 *  медиа-раскладки позиционирования достаются бесплатно). Строится каждый кадр
 *  по кэшу lastCmdHtml; времена в HTML-сигнатуру НЕ входят — их патчит
 *  updateChainDom() через textContent, иначе тикающее «~T» перестраивало бы DOM
 *  под пальцем и съедало тапы. */
function renderChainBar(): void {
  if (!chainMode) return;
  // Самогашение: флоты умерли/перешли к другому — режим не висит над пустотой.
  // Самогашение и состояние кнопок — `chainStripState.ts` (REFM-79).
  chainMode.fleetIds = stayingFleets(chainMode.fleetIds, (id) => s.fleets[id]?.owner, ME);
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
  // снимается любым приказом и самим кастом (`heroAim = null`), так что хаб вернётся.
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
      chainMode.menu = null;
      el?.classList.remove('show');
    } else if (el?.classList.contains('show')) {
      positionChainMenu(el);
    }
  }
}

/** Horizontal fleet command bar — Move (arm) / Stop / Attack / orbit change —
 *  acting on the current fleet selection, buttons enabled by context. */
function renderCmdBar() {
  // CHAIN-UX: в режиме «Приказ» вместо ряда команд — полоска плана. Она живёт и
  // без выделения (режим держит свои fleetIds), поэтому ветка стоит ДО раннего
  // выхода на пустом выделении.
  if (chainMode) {
    renderChainBar();
    return;
  }
  document.body.classList.remove('chain-mode');
  const ids = selectedFleetIds();
  // Время жизни ряда и поповеров — `popoverLife.ts` (REFM-84). Набор группы держит ряд
  // живым и на нуле выделенных: ⊕ обязана остаться достижимой, иначе опустевшая группа
  // запирает игрока в режиме без выхода.
  if (!barStays(ids.length, pickMode)) {
    if (aiming) aiming = false;
    if (assaultAim) assaultAim = false;
    if (merging) merging = false;
    squadronStrikeAim = null;
    fireMenu = false; // пустое выделение — 🔥-меню не должно всплыть при новом выборе
    troopsPlan = null; // ⇵-меню тоже: иначе всплывёт над СЛЕДУЮЩИМ выбранным флотом
    castMenu = false; // и ✨: оно тут забывалось, и повторный выбор открывал его сам
    cmdbar.classList.remove('show');
    lastCmdHtml = '';
    return;
  }
  const fleets = ids.map((id) => s.fleets[id]).filter((f): f is Fleet => !!f);
  // CMD-VIS: доступность приказа СПРАШИВАЕТСЯ у ядра (canOrder, RULES-1), а кнопка
  // рисуется от ответа — недоступный приказ не серый, его просто НЕТ. Одна проба
  // покрывает все причины разом: стоит на месте (E_FLEET_BUSY), в коридоре
  // (E_NOT_A_LANE — у прыжка нет середины), в бою. Правило переиспользуемое: любую
  // командную кнопку можно вешать на ту же пробу её настоящего приказа.
  const anyStoppable = fleets.some((f) => canOrder(s, stopFleet(ME, f.id)) === null);
  // Режим огня артиллерии (одна кнопка + меню): на кнопке — общий режим арт-флотов
  // выделения, при разнобое — нейтральная подпись.
  const artFleets = fleets.filter((f) => f.owner === ME && fleetHasArtillery(f));
  const FIRE_MODES: Array<{ m: string; lbl: string; sub: string }> = [
    { m: 'passive', lbl: t('cmd.fire.passive'), sub: t('cmd.fire.passive.hint') },
    { m: 'return', lbl: t('cmd.fire.return'), sub: t('cmd.fire.return.hint') },
    { m: 'standard', lbl: t('cmd.fire.standard'), sub: t('cmd.fire.standard.hint') },
    { m: 'aggressive', lbl: t('cmd.fire.aggressive'), sub: t('cmd.fire.aggressive.hint') },
  ];
  // Единогласие режима, доступность слияния/деления/штурма — `cmdAvailability.ts` (REFM-78).
  const uniMode = uniformMode(artFleets.map((f) => f.barrageMode ?? 'standard'));
  const fmLabel = uniMode
    ? (FIRE_MODES.find((x) => x.m === uniMode)?.lbl ?? t('cmd.fire.title'))
    : t('cmd.fire.title');
  const docked = fleets.filter((f) => f.location && !f.movement && !f.battleId);
  // PC: ШТУРМ is a targeting command (fly there + storm on arrival) — armable
  // whenever the selection has ships. Mobile keeps the in-orbit-only button.
  const canAssault = pcUi()
    ? fleets.some((f) => sumUnits(f.units) > 0)
    : docked.some((f) =>
        canAssaultFromOrbit(
          {
            orbit: f.orbit,
            location: f.location,
            worldOwner: (f.location ? s.planets[f.location]?.owner : null) ?? null,
            capturable: !!(f.location && sectorTypeOf(f.location)?.capturable),
          },
          f.owner,
        ),
      );
  // Merge: a group fuses in one tap; a lone fleet arms target-pick (needs a partner).
  const myFleetTotal = Object.values(s.fleets).filter((f) => f.owner === ME).length;
  const mergeOk = canMerge(ids.length, myFleetTotal);
  // Split: only a single docked fleet with ≥2 ships can shed some into a new fleet.
  const lone = ids.length === 1 && fleets[0] ? fleets[0] : null;
  const splitOk = canSplit(
    lone
      ? {
          location: lone.location,
          movement: lone.movement,
          battleId: lone.battleId,
          ships: sumUnits(lone.units),
        }
      : null,
  );
  // GRND-1 ⇅ «Десант»: как и split, команда строго ОДНОФЛОТОВАЯ — гарнизон и трюм у
  // каждого свои, один клик на группу разослал бы приказы с разной арифметикой.
  const troopsIn = lone ? troopsInputFor(lone.id) : null;
  // Artillery in the selection → offer the standoff-fire focus order.
  const anyArtillery = fleets.some(fleetHasArtillery);
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
      artillery: artFleets.length,
      castHero: !!castHero,
      troopsInput: !!troopsIn,
      loneId: lone?.id ?? null,
    },
    { fire: fireMenu, cast: castMenu, troopsFleetId: troopsPlan?.fleetId ?? null },
  );
  fireMenu = life.fire;
  castMenu = life.cast;
  if (!life.troops) troopsPlan = null;
  const html =
    `<span class="cmdlabel">${ids.length > 1 ? t('cmd.selection.many', { n: ids.length }) : t('cmd.selection.one')}</span>` +
    cmdBtn('move', '⤳', t('cmd.move'), aiming ? 'on' : '', false, t('cmd.move.hint')) +
    (anyStoppable ? cmdBtn('stop', '■', t('cmd.stop'), 'danger', false, t('cmd.stop.hint')) : '') +
    cmdBtn(
      'attack',
      '⚔',
      t('cmd.assault'),
      assaultAim ? 'on' : '',
      !canAssault,
      t('cmd.assault.hint'),
    ) +
    cmdBtn('target', '◎', t('cmd.target'), '', false, t('cmd.target.hint')) +
    (castHero
      ? cmdBtn('cast', '✨', t('cmd.cast'), castMenu ? 'on' : '', false, t('cmd.cast.hint'))
      : '') +
    (anyArtillery
      ? cmdBtn(
          'barrage',
          '🎯',
          t('cmd.barrage'),
          barrageAim ? 'on' : '',
          false,
          t('cmd.barrage.hint'),
        )
      : '') +
    (artFleets.length > 0
      ? cmdBtn('firemode', '🔥', fmLabel, fireMenu ? 'on' : '', false, t('cmd.fire.hint'))
      : '') +
    cmdBtn(
      'merge',
      '⛬',
      ids.length > 1 ? t('cmd.merge') : t('cmd.merge.pick'),
      merging ? 'on' : '',
      !mergeOk,
      t('cmd.merge.hint'),
    ) +
    cmdBtn('split', '⊟', t('cmd.split'), splitState ? 'on' : '', !splitOk, t('cmd.split.hint')) +
    cmdBtn(
      'troops',
      '⇅',
      t('cmd.troops'),
      troopsPlan ? 'on' : '',
      !troopsIn,
      t('cmd.troops.hint'),
    ) +
    // ☰ — the extras row (hamburger, NOT «...» — референс не копируем дословно):
    // «Выбрать+» и будущие Ускорить/Задержка живут здесь, базовый ряд не пухнет.
    cmdBtn('more', '☰', t('cmd.more'), cmdMore ? 'on' : '', false, t('cmd.more.hint')) +
    (cmdMore || pickMode
      ? cmdBtn(
          'pick',
          '⊕',
          t('cmd.multiselect'),
          pickMode ? 'on' : '',
          false,
          t('cmd.multiselect.hint'),
        )
      : '') +
    (cmdMore
      ? cmdBtn(
          'boost',
          '⚡',
          t('cmd.forced-march'),
          ids.length > 0 && ids.every((id) => marchFlagged(id)) ? 'on' : '',
          ids.length === 0,
          t('cmd.forced-march.hint'),
        ) +
        // SO-UI: standing orders live here now — the bottom sheet keeps only info.
        cmdBtn(
          'qauto',
          '⚔',
          t('cmd.auto-assault'),
          ids.length > 0 && ids.every((id) => isAutoAssault(id)) ? 'on' : '',
          ids.length === 0,
          t('cmd.auto-assault.hint'),
        ) +
        (fleets.some(fleetHasSquadron)
          ? cmdBtn(
              'qscramble',
              '🛩',
              t('cmd.standing-sortie'),
              fleets.filter(fleetHasSquadron).every((fl) => patrolOf(fl.id)) ? 'on' : '',
              false,
              t('cmd.standing-sortie.hint'),
            )
          : '')
      : '') +
    // 🔥 поповер над баром: четыре режима с подписью-правилом; ● — текущий.
    (fireMenu && artFleets.length > 0
      ? `<div class="cmdpop">` +
        FIRE_MODES.map(
          (x) =>
            `<button data-cmd="fmset" data-mode="${x.m}"${uniMode === x.m ? ' class="on"' : ''}><b>${uniMode === x.m ? '● ' : ''}${x.lbl}</b><span>${x.sub}</span></button>`,
        ).join('') +
        `</div>`
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
            return `<button data-cmd="castdo" data-ab="${opt.id}" data-hero="${castHero.id}"${opt.cdH > 0 ? ' disabled' : ''}><b>${esc(t(ad.name))}</b><span>${sub}</span></button>`;
          })
          .join('') +
        `</div>`
      : '') +
    // ⇅ поповер десанта: строка на тип, знаковый счётчик «сколько», одно подтверждение.
    (troopsPlan && troopsIn
      ? troopsMenuHtml(troopsModel(troopsIn), {
          icon: (u) => unitIconHtml(u, data, youColor, 18),
          name: displayUnit,
        })
      : '');
  if (html !== lastCmdHtml) {
    cmdbar.innerHTML = html;
    lastCmdHtml = html;
  }
  cmdbar.classList.add('show');
}

/** Ship counts (by type) of a fleet — the rows of the split dialog. */
function fleetShipCounts(f: Fleet): Record<string, number> {
  return shipCounts(f.units); // арифметика деления — `splitPlan.ts` (REFM-76)
}

/** The "Split fleet" modal: per ship type, +1 / +10 / All (and −1) move ships into
 *  a new fleet; Confirm peels them off into the same sector. Closes itself if the
 *  fleet is deselected, vanishes, or starts moving. */
function renderSplitDialog() {
  if (splitState && splitState.fleetId !== selFleet) splitState = null; // selection moved on
  const f = splitState ? s.fleets[splitState.fleetId] : undefined;
  if (!splitState || !f || f.movement || f.battleId) {
    splitState = null;
    if (splitdlg.style.display !== 'none') splitdlg.style.display = 'none';
    lastSplitHtml = '';
    return;
  }
  const counts = fleetShipCounts(f);
  // Состав живой: отбор пересчитывается под него на каждой перерисовке (`splitPlan.ts`).
  splitState.take = normalizeTake(splitState.take, counts);
  const { takeTotal, total } = splitTotals(counts, splitState.take);
  let rows = '';
  for (const unit of Object.keys(counts)) {
    const have = counts[unit] ?? 0;
    const tk = splitState.take[unit] ?? 0;
    rows += `<div class="srow">
      <span class="sname"><span class="bicon">${unitIconHtml(unit, data, youColor, 18)}</span>${esc(displayUnit(unit))}</span>
      <b class="scur">${have - tk}</b>
      <span class="sbtns">
        <button data-sx="dec" data-unit="${esc(unit)}" data-n="1" ${tk <= 0 ? 'disabled' : ''}>−1</button>
        <button data-sx="inc" data-unit="${esc(unit)}" data-n="1" ${tk >= have ? 'disabled' : ''}>+1</button>
        <button data-sx="inc" data-unit="${esc(unit)}" data-n="10" ${tk >= have ? 'disabled' : ''}>+10</button>
        <button data-sx="all" data-unit="${esc(unit)}" ${tk >= have ? 'disabled' : ''}>${t('split.all')}</button>
      </span>
      <b class="snew">→ ${tk}</b>
    </div>`;
  }
  const valid = canConfirm(takeTotal, total);
  const html = `<div class="sbox">
    <div class="shead">${t('split.title')} <b>${esc(splitState.fleetId)}</b></div>
    <div class="ssub">${t('split.note')}</div>
    <div class="srows">${rows}</div>
    <div class="sfoot">${t('split.preview', { a: `<b>${takeTotal}</b>`, b: `<b>${total - takeTotal}</b>` })}</div>
    <div class="sactions">
      <button data-sx="confirm" class="cbtn" ${valid ? '' : 'disabled'}>${t('split.confirm')}</button>
      <button data-sx="cancel" class="cbtn ghost">${t('ping.cancel')}</button>
    </div>
  </div>`;
  if (html !== lastSplitHtml) {
    splitdlg.innerHTML = html;
    lastSplitHtml = html;
  }
  splitdlg.style.display = 'flex';
}

splitdlg.addEventListener('click', (ev) => {
  if (ev.target === splitdlg && splitState) {
    // click on the dimmed backdrop (outside the box) cancels
    splitState = null;
    renderSplitDialog();
    lastCmdHtml = '';
    renderCmdBar();
    return;
  }
  const bEl = (ev.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!bEl || bEl.disabled || !splitState) return;
  const sx = bEl.dataset.sx;
  if (sx === 'cancel') {
    splitState = null;
    renderSplitDialog();
    lastCmdHtml = '';
    renderCmdBar();
    return;
  }
  if (sx === 'confirm') {
    const take = Object.entries(splitState.take)
      .filter(([, n]) => n > 0)
      .map(([unit, count]) => ({ unit, count }));
    if (take.length) playerOrder(splitFleet(ME, splitState.fleetId, take));
    splitState = null;
    renderSplitDialog();
    lastCmdHtml = '';
    lastPanelHtml = '';
    renderCmdBar();
    renderPanel();
    return;
  }
  const unit = bEl.dataset.unit ?? '';
  const f = s.fleets[splitState.fleetId];
  if (!f) return;
  const have = fleetShipCounts(f)[unit] ?? 0;
  const cur = splitState.take[unit] ?? 0;
  if (sx === 'inc' || sx === 'dec' || sx === 'all') {
    splitState.take[unit] = stepTake(cur, have, sx, Number(bEl.dataset.n));
  }
  renderSplitDialog();
});

side.addEventListener('click', (ev) => {
  // A queued order's target is a link: pan the map to that world (briefly ringed)
  // WITHOUT touching the selection — the plan panel must stay open under your finger.
  const go = (ev.target as HTMLElement).closest('[data-goto]') as HTMLElement | null;
  if (go?.dataset.goto) {
    focusWorld(go.dataset.goto);
    return;
  }
  const bEl = (ev.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!bEl || bEl.disabled) {
    // Touch has no hover: a tap that lands on a dossier-able row (not one of its own
    // action buttons, handled below) opens the same summary the desktop pane shows
    // on hover — building/task name, current vs full output, ETA.
    if (MOBILE) {
      const key = (ev.target as HTMLElement).closest<HTMLElement>('[data-desc]')?.dataset.desc ?? null;
      // stat:/tab: dossiers exist for the PC hover tooltip only — the mobile tap
      // behaviour stays exactly as it was before they were added.
      if (key !== null && !key.startsWith('stat:') && !key.startsWith('tab:')) {
        openDossier(key);
      }
    }
    return;
  }
  if (bEl.dataset.codex) {
    openCodex(bEl.dataset.codex); // a build/ship tile → full specs (+ Build here)
    return;
  }
  const act = bEl.dataset.act;
  const arg = bEl.dataset.arg ?? '';
  if (act === 'close') {
    clearSelection();
  } else if (act === 'cancel') {
    selFleet = null;
    selFleets = new Set();
  } else if (act === 'selfleet') {
    setFleetSelection([arg]);
  } else if (act === 'tab') {
    if (arg === 'ground' || arg === 'ships' || arg === 'squadron' || arg === 'buildings') {
      planetTab = arg;
    }
  } else if (act === 'openbuild') {
    buildWin.open(selPlanet!);
  } else if (act === 'build') {
    enqueueBuild(selPlanet!, { kind: 'building', id: arg, count: 1 });
  } else if (act === 'unit') {
    enqueueBuild(selPlanet!, { kind: 'unit', id: arg, count: 1 });
  } else if (act === 'cancelbuild') {
    // The active order only — refunds the unbuilt share and pauses it (resumable).
    playerOrder(cancelConstruction(ME, selPlanet!, Number(arg)));
  } else if (act === 'resumebuild') {
    playerOrder(resumeConstruction(ME, selPlanet!, Number(arg)));
  } else if (act === 'dequeue') {
    // Nothing was ever paid for a not-yet-dispatched queued order (single-player
    // local buffer only — net mode sends immediately, so there's nothing to dequeue
    // there) — a plain local removal, no action needed.
    const [qLane, qIdx] = arg.split(':');
    queueOf(selPlanet!)[qLane as BuildLane].splice(Number(qIdx), 1);
  } else if (act === 'spyplanet') {
    playerOrder(spyOn(ME, arg, 'planet', selPlanet!)); // arg = the world's (last known) owner
  } else if (act === 'capital') {
    playerOrder(designateCapital(ME, selPlanet!));
  } else if (act === 'holdpoint') {
    playerOrder(setHoldPoint(ME, selPlanet!, arg === 'on'));
  } else if (act === 'ping') {
    pings.openMenu();
  } else if (act === 'bombard') {
    playerOrder(bombardFleet(ME, selFleet!, arg === 'on'));
  } else if (act === 'assault') {
    playerOrder(assaultFleet(ME, selFleet!));
  } else if (act === 'retreat') {
    playerOrder(retreatFleet(ME, selFleet!));
  } else if (act === 'instantrepair') {
    // Платный мгновенный ремонт: цена и отказы — на сервере; панель перерисуется
    // по факту (полный бар = получилось), нотификаций-обещаний не даём.
    playerOrder(instantRepairFleet(ME, arg || selFleet!));
  } else if (act === 'dockrepair') {
    // ECON-3а: экспресс-ремонт за metal — кнопка видна только у своего дока.
    playerOrder(repairFleet(ME, arg || selFleet!));
  } else if (act === 'fleetinfo') {
    // Тап по имени армии: карточка ⇄ сводка (для текущего выбранного флота).
    if (selFleet) fleetInfoFor = fleetInfoFor === selFleet ? null : selFleet;
  } else if (act === 'planetinfo') {
    // Тап по имени мира: карточка ⇄ сводка статистики (для выбранной планеты).
    if (selPlanet) planetInfoFor = planetInfoFor === selPlanet ? null : selPlanet;
  } else if (act === 'launchsquad') {
    // Split the squadron stack off into its own fast strike fleet (SQ-1.1).
    const f = selFleet ? s.fleets[selFleet] : undefined;
    if (fleetCanLaunchSquadron(f)) {
      playerOrder(splitFleet(ME, f!.id, squadronTake(f!)));
      note(t('hint.squadron-launched'));
    }
  } else if (act === 'squadronstrike') {
    // Squadron free-space strike: arm the aim mode to pick an enemy fleet in range.
    const f = selFleet ? s.fleets[selFleet] : undefined;
    if (isWing(f, ME) && wingCanAct(f)) {
      squadronStrikeAim = selFleet;
      note(t('hint.squadron-strike-aim'));
    }
  } else if (act === 'squadronreturn') {
    // Squadron return to base: fly back to the carrier in free space.
    const f = selFleet ? s.fleets[selFleet] : undefined;
    if (isWing(f, ME) && wingCanReturn(f)) {
      playerOrder(makeAction(ME, 'squadron.return', { fleetId: f!.id }));
      note(t('hint.squadron-returning'));
    }
  } else if (act === 'squadronpatrol') {
    // Toggle CC-4 standing patrol for this squadron fleet.
    const f = selFleet ? s.fleets[selFleet] : undefined;
    if (isWing(f, ME) && wingCanAct(f)) {
      setScramble([f!.id], !patrolOf(f!.id));
    }
  }
  lastPanelHtml = '';
  renderPanel();
});

// Side-panel object hover → dossier. On PC the docked pane is hidden (it ate a slab
// of the panel) — the dossier follows the cursor as a translucent tooltip (#objtip)
// that sizes to its text. Below the PC breakpoint the old right-docked pane behaviour
// stays. Touch has no hover — phones keep the tap-to-open modal.
const objTipEl = document.getElementById('objtip');
function placeObjTip(ev: PointerEvent): void {
  if (!objTipEl) return;
  // Отступ, переворот у края и поле — `tipPlacement.ts` (REFM-75).
  const at = cursorTipPos(
    { x: ev.clientX, y: ev.clientY },
    { width: objTipEl.offsetWidth, height: objTipEl.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight },
  );
  objTipEl.style.left = `${at.x}px`;
  objTipEl.style.top = `${at.y}px`;
}
side.addEventListener('pointermove', (ev) => {
  if (MOBILE) return;
  const t = ev.target as HTMLElement;
  if (t.closest('#pdesc')) return; // over the docked pane itself — keep what's shown
  const key = (t.closest('[data-desc]') as HTMLElement | null)?.dataset.desc ?? null;
  if (pcUi() && objTipEl) {
    // Cursor tooltip: shown only while an object is actually under the pointer.
    const step = nextHover('cursor', key, hoverObj);
    if (step.changed) {
      hoverObj = step.hover;
      const d = key ? objDossier(key) : null;
      if (d) {
        // A body-less dossier (bare names — resources, plain units) shows just the title.
        objTipEl.innerHTML =
          `<div class="pd-title">${dossierTitleHtml(key!, d)}</div>` +
          (showsBody(d.body) ? `<div class="pd-body">${d.body}</div>` : '');
        objTipEl.style.display = 'block';
      } else {
        objTipEl.style.display = 'none';
      }
    }
    if (objTipEl.style.display === 'block') placeObjTip(ev);
    return;
  }
  // Docked-pane path (narrow desktop windows): переход наведения — `dossierHover.ts`
  // (REFM-82). Здесь промежуток показанное НЕ гасит: курсор идёт между строками через
  // пустоту, и панель мигала бы пустой на каждом переходе. pointerleave clears it.
  const step = nextHover('docked', key, hoverObj);
  if (step.changed) {
    hoverObj = step.hover;
    renderObjDesc();
  }
});
side.addEventListener('pointerleave', () => {
  if (objTipEl) objTipEl.style.display = 'none';
  if (hoverObj !== null) {
    hoverObj = null;
    renderObjDesc();
  }
});

// PC: the browser context menu is suppressed across the whole game surface (the
// map, the HUD, every overlay) — right-click is a game input now. Text fields keep
// their native menu (paste!).
document.addEventListener('contextmenu', (ev) => {
  if (!pcUi()) return;
  if ((ev.target as HTMLElement).closest('input,textarea')) return;
  ev.preventDefault();
});

// PC: right-click on a build tile orders it immediately — same enqueue path as the
// codex «Построить здесь» button, minus the confirmation window (left-click keeps
// opening the full dossier). The browser context menu is suppressed on these tiles.
side.addEventListener('contextmenu', (ev) => {
  if (!pcUi()) return;
  const tile = (ev.target as HTMLElement).closest('[data-buildorder]') as HTMLElement | null;
  if (!tile) return;
  ev.preventDefault();
  // Гейты быстрого заказа — `quickBuild.ts` (REFM-85). Они зеркалят те же проверки, что
  // делает кнопка «Построить здесь»: правый клик обходит окно подтверждения, но не их.
  const p = selPlanet ? s.planets[selPlanet] : undefined;
  const anchorId = parseBuildAnchor(tile.dataset.buildorder)?.id;
  const order = quickBuildOrder(tile.dataset.buildorder, {
    worldOwner: p?.owner ?? null,
    me: ME,
    sectorAllows:
      !!p && !!anchorId && (sectorTypeOf(p.id)?.allowedBuildings ?? BUILDABLE).includes(anchorId),
    locked: !!p && !!anchorId && !!buildingLocked(p.id, anchorId),
  });
  if (!order || !selPlanet) return;
  enqueueBuild(selPlanet, { kind: order.kind as BuildKind, id: order.id, count: 1 });
  lastPanelHtml = '';
  renderPanel();
});

// Mobile long-press on a codex tile (.ptile): touch has no hover, so the desktop
// `title` tooltip is unreachable — press-and-HOLD shows a small bubble with the
// tile's localized name (from `data-name`) instead. While held it stays; releasing
// hides it AND swallows the click, so a long-press never falls through into the
// tap action (opening the full codex). A plain tap keeps opening the codex as
// before. Listeners are optional-called: the headless harness DOM has no
// document.addEventListener.
/** Что принимает удержание. Один селектор на оба слушателя: взводит удержание и
 *  съедает хвостовой клик ровно один и тот же набор кнопок — разъедься они, и на
 *  «забытой» кнопке удержание срабатывало бы, а её тап проходил бы следом. */
const HOLD_TARGETS = '.ptile, .ptab, .asset-row';
let holdTipEl: HTMLElement | null = null;
let holdTimer: number | null = null;
// Жизненный цикл удержания (взвод → созревание → съеденный клик) — `holdPress.ts` (REFM-80).
let hold: HoldState = IDLE;
function showHoldTip(btn: HTMLElement): void {
  const name = btn.dataset.name;
  if (!name) return;
  if (!holdTipEl) {
    holdTipEl = document.createElement('div');
    holdTipEl.id = 'holdtip';
    document.body.appendChild(holdTipEl);
  }
  holdTipEl.textContent = name;
  holdTipEl.style.display = 'block';
  // По центру над плиткой, зажато по экрану — `tipPlacement.ts`.
  const r = btn.getBoundingClientRect();
  const at = holdTipPos(
    { left: r.left, top: r.top, width: r.width },
    { width: holdTipEl.offsetWidth, height: holdTipEl.offsetHeight },
    window.innerWidth,
  );
  holdTipEl.style.left = `${at.x}px`;
  holdTipEl.style.top = `${at.y}px`;
}
function cancelHoldTip(): void {
  if (holdTimer !== null) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
  hold = release(hold); // право съесть хвостовой клик переживает отпускание
  if (holdTipEl) holdTipEl.style.display = 'none';
}
document.addEventListener?.('pointerdown', (ev) => {
  if (!MOBILE) return;
  // Удержание работает на ПЛИТКЕ каталога, на ВКЛАДКЕ карточки мира и на СТРОКЕ списка.
  // Исход решает то, что на кнопке уже написано: у плитки видна одна иконка, поэтому она
  // показывает подпись с именем; у вкладки и у строки имя уже подписано, и подсказка с
  // тем же именем была бы пустым ходом — они дают КРАТКУЮ СВОДКУ по `data-desc` (заказ
  // владельца: «по нажатию и удержанию открывалась краткая сводка»). На ПК та же сводка
  // приходит наведением — тапу она была недоступна вовсе, хотя текст давно написан.
  const btn = (ev.target as HTMLElement).closest?.(HOLD_TARGETS) as HTMLElement | null;
  if (!btn) return;
  hold = press({ x: ev.clientX, y: ev.clientY });
  if (holdTimer !== null) clearTimeout(holdTimer);
  holdTimer = window.setTimeout(() => {
    holdTimer = null;
    hold = mature(hold);
    // Сводки может не быть (у строки чужого флота её текст не написан) — тогда удержание
    // всё равно обязано ответить хоть чем-то, иначе читается как мёртвая кнопка.
    const key = btn.classList.contains('ptile') ? null : btn.dataset.desc;
    if (!key || !openDossier(key)) showHoldTip(btn);
  }, HOLD_TIP_MS);
});
document.addEventListener?.('pointermove', (ev) => {
  if (holdTimer === null || !hold.from) return;
  if (movedTooFar(hold.from, { x: ev.clientX, y: ev.clientY })) {
    hold = moveAway(hold);
    cancelHoldTip(); // the finger is scrolling the panel, not holding the tile
  }
});
document.addEventListener?.('pointerup', () => cancelHoldTip());
document.addEventListener?.('pointercancel', () => cancelHoldTip());
document.addEventListener?.(
  'click',
  (ev) => {
    // Право съесть клик одноразовое: следующий честный тап обязан пройти.
    const { eat, next } = consumeClick(hold);
    hold = next;
    if (!eat) return;
    // Хвостовой клик созревшего удержания не должен ни открыть кодекс плитки, ни
    // ПЕРЕКЛЮЧИТЬ вкладку: игрок держал её ради описания, а не чтобы уйти с текущей.
    // Строка списка — там же: её тап заказывает постройку, и «сводка + заказ» одним
    // движением была бы покупкой, которую игрок не собирался делать.
    if ((ev.target as HTMLElement).closest?.(HOLD_TARGETS)) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  },
  true, // capture — ahead of the side panel's click handler
);
// SND-1: консольный блип на ЛЮБУЮ живую кнопку — один bubble-слушатель вместо
// правки десятков делегированных обработчиков. isTrusted отсекает синтетические
// .click() (rail-exit, tomenu при Back) — программный переход не «тапает»; bubble
// (не capture), чтобы stopPropagation созревшего long-press глушил и звук.
document.addEventListener?.('click', (ev) => {
  if (!ev.isTrusted) return;
  const b = (ev.target as HTMLElement).closest?.('button');
  if (b && !(b as HTMLButtonElement).disabled) snd.play('tap');
});

cmdbar.addEventListener('click', (ev) => {
  const bEl = (ev.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!bEl || bEl.disabled) return;
  const cmd = bEl.dataset.cmd;
  const ids = selectedFleetIds();
  if (cmd !== 'merge') merging = false; // any other command disarms merge-targeting
  if (cmd !== 'barrage') barrageAim = false; // any other command disarms barrage-targeting
  if (cmd !== 'firemode' && cmd !== 'fmset') fireMenu = false; // другой приказ закрывает 🔥-меню
  if (cmd !== 'cast' && cmd !== 'castdo') castMenu = false; // другой приказ закрывает ✨-меню
  // другой приказ закрывает ⇅-меню (иначе два absolute-поповера легли бы друг на друга)
  if (cmd !== 'troops' && cmd !== 'tstep' && cmd !== 'tmax' && cmd !== 'tok') troopsPlan = null;
  if (cmd !== 'attack') assaultAim = false; // any other command disarms assault-targeting
  // chainMode не в этой преамбуле: в режиме полоска ЗАМЕНЯЕТ ряд — других команд
  // физически нет; выход только своими кнопками (chexit/chsend), Back/Escape.
  // A real order leaves «Выбрать+» (the group stays selected and takes it);
  // ☰ and the ⊕ toggle itself keep the picking session alive.
  if (cmd !== 'pick' && cmd !== 'more') pickMode = false;
  heroAim = null; // any command disarms a pending hero cast / deploy
  heroSpawnAim = null;
  squadronStrikeAim = null; // any command disarms a pending squadron strike
  if (cmd === 'move') {
    aiming = !aiming; // arm / disarm the move order
    assaultAim = false;
    // Подсказка только на тач: там один палец занят прицелом, и жест камеры надо
    // назвать вслух. На PC мышь и так возит камеру перетаскиванием.
    if (aiming && !pcUi()) note(t('hint.aim-armed'));
  } else if (cmd === 'merge') {
    if (ids.length >= 2) mergeGroup(ids);
    else {
      merging = !merging; // lone fleet → arm: next friendly-fleet tap is the anchor
      aiming = false;
      if (merging) note(t('hint.pick-merge'));
    }
  } else if (cmd === 'stop') {
    // Без тостов: в группе стоп уходит только тем, кому ядро его РАЗРЕШАЕТ (та же
    // проба, что показала кнопку) — флот в коридоре просто доезжает, отказа не видно.
    for (const id of ids) if (canOrder(s, stopFleet(ME, id)) === null) playerOrder(stopFleet(ME, id));
  } else if (cmd === 'attack') {
    if (pcUi()) {
      // PC: ШТУРМ aims like «Курс» — the next click on someone else's world sends
      // the fleet there and it storms on arrival (valid targets ring up on the map).
      assaultAim = !assaultAim;
      aiming = false;
      if (assaultAim) note(t('hint.pick-assault'));
    } else {
      for (const id of ids) if (s.fleets[id]?.orbit === 'near') playerOrder(assaultFleet(ME, id));
      aiming = false;
    }
  } else if (cmd === 'split') {
    const id = ids[0];
    if (id) {
      splitState = splitState ? null : { fleetId: id, take: {} }; // toggle the dialog
      aiming = false;
      renderSplitDialog();
    }
  } else if (cmd === 'troops') {
    const id = ids[0];
    if (id) {
      troopsPlan = troopsPlan ? null : { fleetId: id, plan: {} }; // toggle the popover
      aiming = false;
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
    const at = st ? s.fleets[st.fleetId]?.location : undefined;
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
      if (load.length && troopsLiftable(at)) for (const o of load) pushLoads(st.fleetId, o.unit, o.count);
    }
    troopsPlan = null;
  } else if (cmd === 'barrage') {
    // Arm focus-fire: the next tap on an enemy fleet aims the selected artillery
    // at it; a tap on empty space clears back to auto-targeting the nearest.
    barrageAim = !barrageAim;
    aiming = false;
    if (barrageAim) note(t('hint.pick-barrage'));
  } else if (cmd === 'target') {
    // CHAIN-UX: вход в режим «Приказ» — карта становится рабочей поверхностью,
    // тапы по точкам собирают план (CC-1 цепочка), полоска заменяет ряд команд.
    enterChainMode(ids);
  } else if (cmd === 'chundo') {
    if (chainMode) {
      const d = undoGesture({ steps: chainMode.steps, gestures: chainMode.gestures });
      chainMode.steps = d.steps;
      chainMode.gestures = d.gestures;
      lastCmdHtml = '';
      if (chainMode.menu) renderChainMenu(); // серость пунктов могла измениться
    }
  } else if (cmd === 'chhome') {
    if (chainMode) {
      const f0 = s.fleets[chainMode.fleetIds[0]!];
      const finish = f0 ? draftFinish(chainMode.steps, chainStart(f0).fromId) : null;
      const home = finish ? nearestOwnWorld(finish) : null;
      if (home && chainMode.steps.length < MAX_CHAIN_STEPS) {
        chainMode.steps = [...chainMode.steps, { kind: 'move', to: home }];
        chainMode.gestures = [...chainMode.gestures, 1];
        lastCmdHtml = '';
      }
    }
  } else if (cmd === 'chsend') {
    if (chainMode) {
      // Пустой черновик при живых планах — это «снять приказ»: order.chain []
      // атомарно удаляет план каждого флота.
      for (const id of chainMode.fleetIds) playerOrder(orderChain(ME, id, chainMode.steps));
      snd.play('send'); // квинты-арпеджио: план ушёл — маленький оперный жест
      note(t('tgt.placed'));
      exitChainMode();
    }
  } else if (cmd === 'chexit') {
    exitChainMode(); // выход без отправки — живые планы не тронуты
  } else if (cmd === 'more') {
    cmdMore = !cmdMore; // ☰ — show/hide the extras row
  } else if (cmd === 'cast') {
    castMenu = !castMenu; // ✨ — открыть/закрыть меню способностей героя-флагмана
    fireMenu = false;
    aiming = false;
  } else if (cmd === 'castdo') {
    // Cast a hero ability from the row: ranged → arm the map (next world tap = target,
    // via the shared heroAim flow); self/aura → fire in place immediately.
    const heroId = bEl.dataset.hero ?? '';
    const abilityId = bEl.dataset.ab ?? '';
    castMenu = false;
    if ((data.heroAbilities[abilityId]?.range ?? 0) > 0) {
      heroAim = { heroId, abilityId };
      note(t('yard.pick.target'));
    } else {
      playerOrder(castHeroAbility(ME, heroId, abilityId));
    }
  } else if (cmd === 'firemode') {
    fireMenu = !fireMenu; // 🔥 — открыть/закрыть меню выбора режима огня
    aiming = false;
  } else if (cmd === 'fmset') {
    // Выбор в 🔥-меню: единый режим всем выделенным флотам с артиллерией.
    const mode = bEl.dataset.mode ?? 'standard';
    for (const id of ids) {
      const f = s.fleets[id];
      if (f && f.owner === ME && fleetHasArtillery(f) && (f.barrageMode ?? 'standard') !== mode) {
        playerOrder(barrageModeFleet(ME, id, mode));
      }
    }
    fireMenu = false;
  } else if (cmd === 'boost') {
    // BOOST-1 форс-марш: toggle for the whole selection — ON unless everyone
    // already marches. Wear only bites while actually flying.
    const on = !ids.every((id) => marchFlagged(id));
    for (const id of ids) if (marchFlagged(id) !== on) playerOrder(forceMarchFleet(ME, id, on));
    if (on) note(t('hint.forced-march'));
  } else if (cmd === 'qauto') {
    // SO-UI: the CC-2 auto-storm stance, group-uniform (moved off the bottom sheet).
    const on = !ids.every((id) => isAutoAssault(id));
    setAutoAssault(ids, on);
    if (on) note(t('hint.auto-assault'));
  } else if (cmd === 'qscramble') {
    // SO-UI: the CC-4 «дежурный вылет», group-uniform over the squadron fleets.
    const wings = ids.filter((id) => fleetHasSquadron(s.fleets[id]));
    const on = !wings.every((id) => patrolOf(id));
    setScramble(wings, on);
    if (on) note(t('hint.standing-sortie'));
  } else if (cmd === 'pick') {
    // SEL-1: touch multi-select — the sheet collapses, taps toggle own fleets.
    pickMode = !pickMode;
    aiming = false;
    if (pickMode) note(t('hint.multiselect'));
  }
  lastCmdHtml = '';
  lastPanelHtml = '';
  renderCmdBar();
  renderPanel();
});

// --- canvas input ------------------------------------------------------------

// Tap/click selection at a screen point (drag-aware — see the pointer handlers).
function selectAt(mx: number, my: number) {
  pings.closePop(); // any map tap dismisses an open ping popup (a marker tap reopens below)
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
  const owner = tapOwner({
    chainMode: !!chainMode,
    merging,
    barrageAim,
    heroAim: !!heroAim,
    heroSpawnAim: !!heroSpawnAim,
    assaultAim,
    pickMode,
    aiming,
    squadronStrikeAim: !!squadronStrikeAim,
  });
  // Merge armed: the next tap on a friendly fleet (not itself in the selection) is
  // the anchor — the selected fleet(s) fly to it and fuse. Any other tap cancels.
  if (owner === 'merge') {
    const movers = selectedFleetIds();
    const anchor = nearestHit(
      Object.values(s.fleets).filter((f) => f.owner === ME && !movers.includes(f.id)),
      fleetAnchor,
      mx,
      my,
      rFleet,
    );
    if (anchor) orderMerge(movers, anchor.id);
    merging = false;
    lastPanelHtml = '';
    return;
  }
  // Barrage armed: the next tap on an enemy fleet focuses the selected artillery's
  // standoff fire on it; a tap on empty space (no enemy fleet) clears back to
  // auto-targeting the nearest hostile in range. A mis-aimed/peace target is
  // rejected server-side (surfaced as a log note).
  if (owner === 'barrage') {
    const target = nearestHit(
      Object.values(s.fleets).filter((f) => f.owner !== ME),
      fleetAnchor,
      mx,
      my,
      rFleet,
    );
    const targetId: string | null = target?.id ?? null;
    for (const id of selectedFleetIds()) {
      if (fleetHasArtillery(s.fleets[id])) playerOrder(barrageFleet(ME, id, targetId));
    }
    if (targetId) note(t('hint.barrage-set'));
    else note(t('hint.barrage-auto'));
    barrageAim = false;
    lastPanelHtml = '';
    return;
  }
  // Squadron strike armed: the next tap on an enemy fleet sends squadron.strike
  // (free-space flight to the target). A tap on empty space disarms.
  if (owner === 'squadron-strike' && squadronStrikeAim) {
    const target = nearestHit(
      Object.values(s.fleets).filter((f) => f.owner !== ME),
      fleetAnchor,
      mx,
      my,
      rFleet,
    );
    if (target) {
      playerOrder(makeAction(ME, 'squadron.strike', { fleetId: squadronStrikeAim, targetFleetId: target.id }));
      note(t('hint.squadron-strike-sent'));
    } else {
      note(t('hint.squadron-strike-cancel'));
    }
    squadronStrikeAim = null;
    lastPanelHtml = '';
    return;
  }
  // Hero cast armed: the next tap picks the target world. Range / cooldown / cost
  // are the core's gates — a mis-aim comes back as an honest rejection note.
  if (owner === 'cast' && heroAim) {
    const cast = heroAim;
    heroAim = null;
    const n = nearestHit(MAP, (nn) => world(nn), mx, my, rNode);
    if (n) playerOrder(castHeroAbility(ME, cast.heroId, cast.abilityId, n.id));
    else note(t('hint.cast-cancelled'));
    lastPanelHtml = '';
    return;
  }
  // Hero deploy armed: the tap picks WHERE the ship rises — your own world; with the
  // marker perks also one of your fleets (boarding) / an allied world. Own-fleet hits
  // are only considered when the hero actually carries the boarding marker, so a tap
  // on a world under your fleet still means the world.
  if (owner === 'deploy' && heroSpawnAim) {
    const heroId = heroSpawnAim;
    heroSpawnAim = null;
    const hero = s.heroes?.[heroId];
    const canBoard = (hero?.abilities ?? []).some(
      (a) => a !== null && data.heroAbilities[a]?.type === 'spawn_fleet',
    );
    const host = canBoard
      ? nearestHit(
          Object.values(s.fleets).filter((f) => f.owner === ME),
          fleetAnchor,
          mx,
          my,
          rFleet,
        )
      : null;
    const n = host ? null : nearestHit(MAP, (nn) => world(nn), mx, my, rNode);
    if (host) playerOrder(spawnHero(ME, heroId, host.id));
    else if (n) playerOrder(spawnHero(ME, heroId, n.id));
    else note(t('hint.deploy-cancelled'));
    lastPanelHtml = '';
    return;
  }
  // ШТУРМ armed (PC): the click picks the target world — someone else's capturable
  // world only. An enemy at war → fly + storm on arrival; a peaceful owner → the
  // "friendly faction — declare war?" dialog. Anything else keeps the aim armed.
  if (owner === 'assault') {
    const n = nearestHit(MAP, (nn) => world(nn), mx, my, rNode);
    const target = n ? s.planets[n.id] : undefined;
    const capturable = !!n && (sectorTypeOf(n.id)?.capturable ?? false);
    const ok = !!target && capturable && target.owner != null && target.owner !== ME;
    // Судьба прицела — `armedTap.ts` (REFM-88). ШТУРМ единственный ПРОЩАЕТ неподходящую
    // цель: промах по цели это не отказ от приказа, и переармировать после каждого
    // неточного тыка в скопление миров — наказание за меткость пальца.
    const fate = armedTap(!n ? 'none' : ok ? 'valid' : 'wrong', true);
    if (fate === 'keep') {
      note(t('hint.assault-enemy-only'));
      return;
    }
    if (fate === 'fire') tryAssaultGroup(selectedFleetIds(), n!.id);
    assaultAim = false;
    lastPanelHtml = '';
    return;
  }
  // SEL-1 «Выбрать+»: while picking, taps only toggle OWN fleets in/out of the
  // group — nothing deselects, worlds don't grab the tap, the map is a picking
  // surface until the mode is left (⊕ again, or any common order).
  if (owner === 'pick-group') {
    const mine = nearestHit(
      Object.values(s.fleets).filter((f) => f.owner === ME),
      fleetAnchor,
      mx,
      my,
      rFleet,
    );
    if (mine) toggleFleetInSelection(mine.id);
    return;
  }
  // CHAIN-UX: тап по ◎-бейджу отправленного плана открывает режим «Приказ» с этим
  // планом в черновике (редактирование; работает и без выделения).
  if (!aiming) {
    const tm = nearestHit(chainHits, (h) => h, mx, my, rPing);
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
    const ping = nearestHit(pingHits, (h) => h, mx, my, rPing);
    if (ping) {
      pings.openPop(ping.loc);
      return;
    }
  }
  // Move armed → send the selected fleet(s) to the tapped world (or the nearest lane
  // point if no world is hit). A route crossing a player you're at peace with stages a
  // war prompt instead of dispatching.
  if (owner === 'move') {
    const n = nearestHit(MAP, (nn) => world(nn), mx, my, rNode);
    if (n) tryMoveGroup(selectedFleetIds(), n.id);
    else {
      const lane = nearestLanePoint(mx, my);
      if (lane) tryMoveEdgeGroup(selectedFleetIds(), { from: lane.from, to: lane.to, t: lane.t });
    }
    aiming = false;
    lastPanelHtml = '';
    return;
  }
  // Plain tap = selection. Правила выбора и перебора стопки — `tapCycle.ts` (REFM-65).
  const n = nearestHit(MAP, (nn) => world(nn), mx, my, rNode);
  // Свои флоты под тапом, ближайший первым: и мобильной ветке (ей нужен только
  // первый), и перебору на ПК (ему нужны все).
  // Также — ВИДИМЫЕ чужие флоты (опознанные или радарные): их можно выделить
  // и просмотреть состав в панели (без кнопок управления — только информация).
  const fleetHits = Object.values(s.fleets)
    .filter((f) => f.owner === ME || fleetVisible(f.owner === ME, known(fleetNode(f)), intelFleetOwners.has(f.owner)))
    .map((f) => {
      const a = fleetAnchor(f);
      return a ? { id: f.id, d: Math.hypot(mx - a.x, my - a.y) } : null;
    })
    .filter((h): h is { id: string; d: number } => !!h && h.d < rFleet)
    .sort((a, b) => a.d - b.d);
  const applyPick = (pick: TapPick | null): void => {
    if (!pick) {
      clearSelection();
      return;
    }
    if (pick.kind === 'fleet') {
      setFleetSelection([pick.id]); // (clears any selected planet)
      return;
    }
    selPlanet = pick.id;
    selFleet = null;
    selFleets = new Set();
    lastPanelHtml = '';
  };
  if (!pcUi()) {
    // Mobile (frozen in this chat): the original fleet-first behaviour — nearest own
    // fleet under the tap, else the world, else clear. Перебора нет.
    const mine = fleetHits[0]?.id ?? null;
    // Shift / Ctrl / ⌘ → extend the group instead of replacing it.
    if (additive && mine) {
      toggleFleetInSelection(mine);
      return;
    }
    applyPick(touchPick(mine, n?.id ?? null));
    return;
  }
  // PC — RimWorld-style cycling: gather EVERY selectable object under the tap — your
  // fleets (nearest first), then the world beneath them — and each repeat tap on the
  // same spot advances to the next. So a fleet parked on its home world (or a stack of
  // fleets on one orbit) no longer permanently masks the world / the fleets below it.
  if (additive) {
    // Ctrl/⌘ → extend the fleet group with the nearest fleet under the tap (no cycling).
    if (fleetHits[0]) toggleFleetInSelection(fleetHits[0].id);
    return;
  }
  const cands = tapCandidates(
    fleetHits.map((h) => h.id),
    n?.id ?? null,
  );
  const current: TapPick | null = selFleet
    ? { kind: 'fleet', id: selFleet }
    : selPlanet
      ? { kind: 'planet', id: selPlanet }
      : null;
  applyPick(nextPick(cands, current));
}

// --- camera control: drag-pan, pinch-zoom, wheel-zoom, tap-select ------------

/** Set per tap: hit radii in selectAt widen for a finger (44px-target rule). */
let tapByTouch = false;

const pointers = new Map<number, { x: number; y: number }>();
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
let pinchDist = 0;
// Середина щипка: два пальца не только МАСШТАБИРУЮТ, но и ВЕЗУТ камеру. Нужно это
// прежде всего вооружённому приказу: одним пальцем там целятся, и без второго жеста
// камера оказывалась заперта — цель за краем экрана была недостижима.
let pinchMid: { x: number; y: number } | null = null;
// Был ли в этом жесте второй палец. Одиночный тап при вооружённом приказе КОММИТИТ его
// даже после протяжки (так целятся на телефоне), поэтому отпускание последнего пальца
// после щипка обязано быть исключением: иначе панорама заканчивалась бы случайным
// приказом в точке, где палец просто оторвался.
let multiTouched = false;
let boxSelecting = false;
// Пиксели страницы → координаты холста. Перевод один на палец и на колесо
// (`screenAnchor.ts`, REFM-134, правила 6–7): две копии одной формулы — это два зума,
// которые начнут целиться в разные места, стоит поправить одну.
const ptXY = (ev: { clientX: number; clientY: number }) =>
  fromScreen({ x: ev.clientX, y: ev.clientY }, canvas.getBoundingClientRect(), VW, VH);
canvas.addEventListener('pointerdown', (ev) => {
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
      Object.values(s.fleets).filter((f) => f.owner === ME),
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
      orderArmed: !!(aiming || merging || barrageAim || chainMode),
    });
    additive = intent.additive;
    boxSelecting = intent.boxSelect;
    selectionBox = boxSelecting ? { x1: p.x, y1: p.y, x2: p.x, y2: p.y } : null;
    dragged = false;
    if (aiming || assaultAim) aimPointer = p; // the aim preview starts under the finger at once
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
        const mine = nearestHit(
          Object.values(s.fleets).filter((f) => f.owner === ME),
          fleetAnchor,
          p.x,
          p.y,
          24,
        );
        if (longPressAction(!!mine) === 'toggle-fleet') {
          toggleFleetInSelection(mine!.id); // add / drop from the group
        } else {
          boxSelecting = true; // drag now stretches the selection box
          selectionBox = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
        }
      }, MAP_HOLD_MS);
    }
  } else if (pointers.size === 2) {
    cancelLongPress();
    multiTouched = true;
    // Второй палец ВЕЗЁТ КАМЕРУ (и масштабирует), а не отменяет вооружённый приказ.
    // Раньше он отменял — и это запирало игрока: одним пальцем целятся, значит камеру
    // при вооружённом «Курсе» было не сдвинуть вовсе, а цель за краем экрана
    // становилась недостижимой. Отменить приказ по-прежнему можно кнопкой (повторный
    // тап по «Курс») и Back/Escape — обе дороги живы.
    const [a, b] = [...pointers.values()];
    if (a && b) {
      const pinch = pinchOf(a, b);
      pinchDist = pinch.dist;
      pinchMid = pinch.mid;
    }
  }
});
canvas.addEventListener('pointermove', (ev) => {
  const prev = pointers.get(ev.pointerId);
  if (!prev) return;
  const p = ptXY(ev);
  pointers.set(ev.pointerId, p);
  const moved = movedBeyondSlop(dragStart, p, ev.pointerType === 'touch');
  if (moved) cancelLongPress(); // a moving finger is a drag, not a long-press
  if (pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    if (a && b) {
      const cur = pinchOf(a, b);
      // Масштаб и перенос середины считает `pointerPick.ts` (REFM-33): щипок и
      // масштабирует, и ВЕЗЁТ камеру — одно другому не мешает.
      const step = pinchStep(pinchMid ? { dist: pinchDist, mid: pinchMid } : null, cur);
      if (step.scale !== 1) zoomAt(cur.mid.x, cur.mid.y, step.scale);
      if (step.dx || step.dy) {
        cam.x += step.dx;
        cam.y += step.dy;
        clampCam();
      }
      pinchDist = cur.dist;
      pinchMid = cur.mid;
    }
    dragged = true;
  } else if ((aiming || assaultAim) && !pcUi()) {
    // TOUCH with Move/ШТУРМ armed: the finger DRAGS THE AIM (live preview via
    // aimPointer), the camera stays put — releasing commits. Panning used to hijack
    // this drag and silently swallow the order (the audit's blind-order finding).
    // On PC the mouse hovers to aim, so an LMB drag stays a normal camera pan and
    // the armed order survives it (commit is a clean click).
    void 0;
  } else if (boxSelecting && dragStart) {
    selectionBox = { x1: dragStart.x, y1: dragStart.y, x2: p.x, y2: p.y };
    if (moved) dragged = true;
  } else {
    cam.x += p.x - prev.x;
    cam.y += p.y - prev.y;
    clampCam(); // keep the map from being dragged entirely off-screen
    if (moved) dragged = true;
  }
});
function endPointer(ev: PointerEvent) {
  const single = pointers.size === 1;
  const p = pointers.get(ev.pointerId);
  if (single && boxSelecting && selectionBox) {
    const picked: string[] = [];
    for (const f of Object.values(s.fleets)) {
      if (f.owner !== ME) continue;
      const a = fleetAnchor(f);
      if (a && insideBox(selectionBox, a)) picked.push(f.id);
    }
    // Правило «добрать или заменить» (и «пустая рамка с модификатором не трогает
    // группу») живёт в `pointerPick.ts`.
    const next = boxSelection(selectedFleetIds(), picked, additive);
    if (next.length) setFleetSelection(next);
    else if (!additive) {
      selFleets = new Set();
      selFleet = null;
      lastPanelHtml = '';
    }
    selectionBox = null;
    boxSelecting = false;
  }
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) {
    pinchDist = 0;
    pinchMid = null;
  }
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
  });
  if (single && p && commits) {
    tapByTouch = ev.pointerType === 'touch';
    selectAt(p.x, p.y);
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', (ev) => {
  cancelLongPress();
  mapHold = IDLE; // жест отменён системой — отпускания не будет, и съедать нечего
  pointers.delete(ev.pointerId);
  pinchDist = 0;
  selectionBox = null;
  boxSelecting = false;
});
canvas.addEventListener(
  'wheel',
  (ev) => {
    ev.preventDefault();
    const at = ptXY(ev); // тот же перевод, что у пальца (правило 7)
    zoomAt(at.x, at.y, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
  },
  { passive: false },
);
canvas.addEventListener('dblclick', () => defaultView());
// track the pointer for the "Move" preview line (desktop only)
canvas.addEventListener('pointermove', (ev) => {
  aimPointer = ptXY(ev);
});

// --- top bar / speed ---------------------------------------------------------

for (const b of Array.from(document.querySelectorAll('[data-speed]'))) {
  b.addEventListener('click', () => {
    speed = Number((b as HTMLElement).dataset.speed);
    for (const x of Array.from(document.querySelectorAll('[data-speed]')))
      x.classList.toggle('on', Number((x as HTMLElement).dataset.speed) === speed);
  });
}
// Pace chips (×1/×10/×50): retune the play/fast pair mid-match and start running at
// the new multiplier — the same mapping the setup screen launches with.
for (const b of Array.from(document.querySelectorAll('[data-mult]'))) {
  b.addEventListener('click', () => applyTimeSpeed(Number((b as HTMLElement).dataset.mult)));
}

// Map a setup time-flow multiplier (×1/×2/×5/×10) onto the speedbar and start running at
// it. ×1 is true wall-clock — 1 game-hour per real hour — matching the real-time MMO
// design; each higher multiplier accelerates from there (×5 = 5 game-hours per real hour,
// …), and fast-forward (▶▶) runs at 3× the chosen play. The play/fast buttons carry the
// live values so pause→resume returns to the chosen pace, not the default.
const PLAY_BASE = 1 / 3600; // game-hours per real second; 1/3600 ⇒ 1 game-hour per real hour (×1 = wall-clock)
function applyTimeSpeed(mult: number): void {
  const play = PLAY_BASE * mult;
  const playBtn = $('spd-play');
  const fastBtn = $('spd-fast');
  if (playBtn) playBtn.dataset.speed = String(play);
  if (fastBtn) fastBtn.dataset.speed = String(play * 3);
  speed = play;
  for (const x of Array.from(document.querySelectorAll('[data-speed]')))
    x.classList.toggle('on', Number((x as HTMLElement).dataset.speed) === speed);
  for (const x of Array.from(document.querySelectorAll('[data-mult]')))
    x.classList.toggle('on', Number((x as HTMLElement).dataset.mult) === mult);
}

// Restart → back to the skirmish setup (bot selection). The speedbar button serves the
// no-bots sandbox; the end-banner button (delegated) serves a finished bot match.
// Player build: the button is stripped with the rest of the time controls (no skirmish).
if (!__PLAYER_BUILD__) restartBtn.addEventListener('click', () => openSetup());
bannerEl.addEventListener('click', (ev) => {
  if ((ev.target as Element).closest('[data-restart]')) openSetup();
});

// --- end screen (match over): outcome + stats + rematch ----------------------
// Панель живёт в `endScreen.ts` (REFM-20); здесь проводка. Уход из матча остаётся тут:
// сеть, гайд-тур и хаб — хозяйство экрана матча, модуль лишь говорит, что выбрал игрок.
const endscreenEl = $('endscreen');
const endScreenPanel = initEndScreen({
  root: () => endscreenEl,
  state: () => s,
  me: () => ME,
  end: () => endScreen,
  dismiss: () => {
    if (endScreen) endScreen.dismissed = true;
  },
  clearEnd: () => {
    endScreen = null;
  },
  hubVisible: () => !!hubEl && hubEl.style.display !== 'none',
  net: () => NET,
  worldsFallback: () => worldsOf(ME),
  fmtStamp,
  onLeave: (which, wasNet) => {
    // Уход из сетевого матча — намеренный дисконнект (без авто-реконнекта).
    if (wasNet) {
      userClosed = true;
      NET = false;
      netAdmitted = false;
      if (netSock) netSock.close();
    }
    // ONB-2: матч мог закончиться посреди гайда — незакрытый тур продолжил бы рисовать
    // свой #spotlight поверх хаба и следующего матча.
    activeTour?.stop();
    if (which === 'again') {
      // Соло — сразу в настройку схватки; сеть — в браузер матчей (пересадить тот же
      // стол клиент не может, это отдельный серверный кирпич).
      if (wasNet) {
        openHub();
        hubTab('games');
      } else {
        openSetup('hub');
      }
    } else {
      openHub(); // «В меню»
    }
  },
});
const renderEndScreen = (): void => endScreenPanel.render();

// Speedbar "⌂ В меню": leave the current match back to the hub from anywhere in-game.
// In net mode this is an intentional disconnect (userClosed → no auto-reconnect). The
// sim keeps ticking underneath as the menu's live backdrop, same as the other overlays.
// BF-29: in solo, STOP the sim on exit — otherwise the world keeps ticking, the AI
// loses, elimination fires, and "Victory!" paints over the hub. In net the server is
// authoritative (it keeps ticking regardless), but the end-screen overlay is suppressed
// while the hub is visible (see renderEndScreen guard).
$('tomenu').addEventListener('click', () => {
  if (NET) {
    userClosed = true;
    NET = false;
    netAdmitted = false;
    netAdmitted = false; // BF-30: no longer in a server-assigned seat
    if (netSock) netSock.close();
  } else {
    speed = 0; // BF-29: freeze the solo sim so the AI can't "win" while you're in the hub
  }
  stopFirstGoals(); // ONB-7: leaving the match ends the onboarding checklist
  // ONB-2 (found live): a mid-tutorial exit via ⌂/Back used to leave the guide's
  // rAF loop running — its own `stop()` never fired, so #spotlight (a document.body
  // singleton) kept painting the LAST step's overlay over the hub, and over whatever
  // match got installed next (its dim/ring/bubble sit at z-50, above everything).
  // Any exit from a live match must kill the tour, not just the ones that walk off
  // its own end (`done`) or its own «Пропустить обучение».
  activeTour?.stop();
  openHub();
});
// Rail: «Покинуть сессию» — same exit as the speedbar ⌂, reachable from the rail too.
document.getElementById('rail-exit')?.addEventListener('click', () => $('tomenu').click());

// Event-log window: the rail's ≡ opens it; ✕ or the backdrop closes it. The feed
// (#log) updates in place each frame whether the window is open or not.
const logWin = document.getElementById('logwin');
document.getElementById('rail-log')?.addEventListener('click', () => logWin?.classList.add('show'));
logWin?.addEventListener('click', (e) => {
  const tg = e.target as HTMLElement;
  if (tg.id === 'logwin' || tg.classList.contains('lw-close')) logWin.classList.remove('show');
});

// --- technologies window -----------------------------------------------------
// Session research (technologyModule): pick a tech to research (one at a time). Techs are
// grouped by branch, show cost + status, and gate on prerequisites / day / affordability.
const techWin = $('tech');

// Капсулы бара рисуют общий словарь RES_SVG (icons.ts) — те же линии и тот же
// цвет несут ценники, стакан рынка и дерево технологий: один взгляд на бар учит
// читать все остальные поверхности.

// --- TT-3.1: экран-дерево технологий ------------------------------------------
// Само окно живёт в `techTree.ts` (REFM-9); здесь только его хуки. Ручка `#tech`
// остаётся: её держат реестр слоёв Android-Back и троттлинг живой перерисовки в
// кадровом цикле, а «Хранитель» открывает окно через `techTree.open()`.
const techTree = initTechTree({
  root: () => techWin,
  body: () => $('techbody'),
  state: () => s,
  me: () => ME,
  order: playerOrder,
  onOpen: () => maybeIntro('tech'),
});
// PING-PANEL: кнопка рельсы (окна ведёт `pingUi.ts`).
document.getElementById('rail-pings')?.addEventListener('click', () => pings.togglePanel());
document.getElementById('rail-tech')?.addEventListener('click', () => techTree.open());

// --- BUILD-1: окно построек мира ---------------------------------------------
// Само окно живёт в `buildScreen.ts`; здесь только его хуки. Ручка `#buildwin`
// остаётся: её держат реестр слоёв Android-Back и живая перерисовка кадра.
const buildWinEl = $('buildwin');
const buildWin = initBuildScreen({
  root: () => buildWinEl,
  body: () => $('buildwinbody'),
  state: () => s,
  me: () => ME,
  probe: (a) => canOrder(s, a),
  // Локальная соло-очередь: ядро о ней не знает, buildingLocked — знает.
  localQueued: (pid, id) =>
    queueOf(pid).buildings.some((q) => q.kind === 'building' && q.id === id),
  build: (pid, id) => enqueueBuild(pid, { kind: 'building', id, count: 1 }),
  openInfo: (id) => openCodex(`b:${id}`),
  lockText: errText,
  dossierBody: (id, level) => buildingDossier(id, level)?.body ?? '',
});


// --- steward («Хранитель»): hand the seat to the AI while you sleep ----------
// The window lives in `stewardScreen.ts` (REFM-7); here it gets its hooks, the rail
// button that opens it, and the two module-level `let`s the frame loop owns.
// `#steward` itself stays a handle: the Android-Back layer stack and the loop's
// repaint throttle both hold it.
const stewWin = $('steward');
let lastStewAt = 0;
let lastBuildAt = 0;
let lastIntelAt = 0; // throttle for the live intel-window timers (диплом. вкладка «Шпионаж»)
const steward = initSteward({
  root: () => stewWin,
  body: () => $('stewardbody'),
  state: () => s,
  me: () => ME,
  order: playerOrder,
  onOpen: () => maybeIntro('steward'),
  openTech: () => techTree.open(),
});
document.getElementById('rail-steward')?.addEventListener('click', () => steward.open());
// Snapshot of my standing at delegation time, diffed on expiry for the morning report.
let stewSnapshot: StewardMetrics | null = null;


// --- heroes («штаб героев») ---------------------------------------------------
// The hero pane of the Верфь: roster, skill tree, abilities, fittings. The pane
// itself lives in `heroStaff.ts` (REFM-14); here it only gets the host state it
// cannot reach on its own. Ranged casts and deploys resolve on the MAP, so the pane
// arms `heroAim`/`heroSpawnAim` through these two hooks and the world tap fires them.
const heroStaff = initHeroStaff({
  state: () => s,
  me: () => ME,
  order: playerOrder,
  note: (msg) => note(msg),
  armCast: (heroId, abilityId) => {
    heroAim = { heroId, abilityId };
  },
  armSpawn: (heroId) => {
    heroSpawnAim = heroId;
  },
});

// --- session market: a two-sided order book, one tab per tradeable good -------
// The window itself lives in `marketScreen.ts` (REFM-6); here it gets its hooks and
// the rail button that opens it.
// The Android-Back / Escape layer stack still needs the node itself (it is a registry
// of «layer → how to close it», see the REFM-1 note) — one handle, shared.
const marketWin = $('market');
const market = initMarket({
  root: () => marketWin,
  state: () => s,
  me: () => ME,
  order: playerOrder,
  onOpen: () => maybeIntro('market'),
});
document.getElementById('rail-market')?.addEventListener('click', () => market.open());

// --- resource card (RC-1): tap a resource chip → popup with stats + market button -
const resCardEl = $('rescard');
const resourceCard = initResourceCard({
  root: () => resCardEl,
  state: () => s,
  me: () => ME,
  icons: RES_SVG,
  onOpenMarket: (res) => market.open(res),
});


// --- constructor («Верфь»): the unified loadout tab --------------------------
// One in-match screen that switches between the loadout constructors (ships and
// squadrons now; the «Герои» pane is still the hero штаб below — it folds in with
// its own brick). The window itself lives in `shipyard.ts` (REFM-13); here it only
// gets the host state it cannot reach on its own, plus the hero pane's markup and
// its clicks.
const constructorWin = $('constructor');
const shipyard = initShipyard({
  root: () => constructorWin,
  state: () => s,
  me: () => ME,
  youColor: () => youColor,
  order: playerOrder,
  note: (msg) => note(msg),
  errText,
  arsenalItems: () => arsenal.items(),
  onOpen: () => maybeIntro('constructor'),
  // The «Герои» pane: the hero roster/штаб lives in `heroStaff.ts` (REFM-14) — the
  // yard only asks it for markup and hands its clicks over.
  heroPaneHtml: heroStaff.paneHtml,
  onHeroTab: () => maybeIntro('hero'),
  heroClick: heroStaff.click,
});
document.getElementById('rail-constructor')?.addEventListener('click', () => shipyard.open());

// --- connect overlay (single-player vs join a live session) ------------------
// Entry screen: pick a faction, then run a local skirmish or connect to a server
// (`pnpm dev:proto-server`, or a tunnel URL a friend shared). The last-used URL
// is remembered so the APK reconnects with one tap.
const connectEl = $('connect');
const srvInput = $('csrv') as HTMLInputElement;
const nickInput = $('cnick') as HTMLInputElement;
const statusEl = $('cstatus');
const showConnect = (show: boolean): void => {
  connectEl.style.display = show ? 'flex' : 'none';
};
srvInput.value =
  localStorage.getItem('void.server') ??
  // Default to the SAME ORIGIN so a served page needs no typing: deployed https →
  // wss://<host>; the game served from the proto-server (http on its port) →
  // ws://<host>:<port>; a file:// page or the APK (no port) → ws://<host>:8788.
  (location.protocol === 'https:'
    ? `wss://${location.host}`
    : location.port
      ? `ws://${location.host}`
      : `ws://${location.hostname || '127.0.0.1'}:8788`);
// Remember the side you last commanded, so reopening the link drops you back onto
// your own seat — the server maps nick→side, so a returning name resumes its own
// faction (nick-login; full accounts in docs/persistence-accounts-roadmap.md).
nickInput.value = localStorage.getItem('void.nick') ?? '';

// The dev test mode is a DEV-CLIENT feature: the player build compiles it out (and
// build.mjs strips its button/markup), so a regular player's client has no test overlay
// at all. The welcome card carries NO single-player entry in either build — starting a
// match is behind the login, so an unauthenticated visitor cannot spin up sessions.
if (!__PLAYER_BUILD__) {
  // DEV TEST MODE — fenced hook. The "Тесты" button opens the dev test overlay;
  // initTestMode wires it to the host with two tiny callbacks. Cut this whole block
  // (and the import + #testmode HTML/CSS) to remove the feature without a trace.
  // The dev client hides the button behind `?dev` / vd.dev (dev chrome).
  if (!DEV_UI) $('ctest').style.display = 'none';
  $('ctest')?.addEventListener('click', () => {
    userClosed = true;
    NET = false;
    netAdmitted = false;
    showConnect(false);
    openTestMode();
  });
  // SANDBOX — fenced hook. Wire the single-player practice-tools panel; the floating
  // opener stays hidden until a match launches with the setup checkbox ticked.
  initSandbox({
    getState: () => s,
    me: () => ME,
    homeId: () => sandboxHomeId,
    note: (msg) => note(msg),
    getSpeedControl: () => devSpeedControl,
    setSpeedControl: (on) => setDevSpeedControl(on),
  });
  initTestMode({
    startScenario: (state, resumeSpeed) => {
      installMatch(state, new Set()); // scenarios drive themselves — no AI
      speed = 0; // start paused at t=0
      // prime the fast-forward (▶▶) control to the chosen multiplier and show paused
      const spd = Array.from(document.querySelectorAll('[data-speed]')) as HTMLElement[];
      const fast = spd[spd.length - 1];
      if (fast) {
        fast.dataset.speed = String(resumeSpeed);
        fast.textContent = `${resumeSpeed}×`;
      }
      for (const x of spd) x.classList.toggle('on', Number(x.dataset.speed) === 0);
      connectEl.style.display = 'none';
    },
    back: () => showConnect(true),
  });
}

// --- welcome stage: first-launch identity screen → match browser ------------
// The entry overlay opens on a clean welcome (new commander / sign-in / single-
// player); "Новый командир" and "Вход" reveal the match browser (stage 2). Social
// sign-in is a styled stub until accounts land (docs/accounts-roadmap.md AC-1.1):
// it drops you straight into guest play by callsign, with a "скоро" notice.
const welcomeStageEl = $('cwelcome');
const registerStageEl = $('cregister');
const recoverStageEl = $('crecover');
const resetStageEl = $('creset');
const browseStageEl = $('cbrowse');
function showStage(stage: 'welcome' | 'register' | 'recover' | 'reset' | 'browse'): void {
  welcomeStageEl.style.display = stage === 'welcome' ? '' : 'none';
  registerStageEl.style.display = stage === 'register' ? '' : 'none';
  recoverStageEl.style.display = stage === 'recover' ? '' : 'none';
  resetStageEl.style.display = stage === 'reset' ? '' : 'none';
  browseStageEl.style.display = stage === 'browse' ? '' : 'none';
}

// A fresh callsign for a brand-new commander. Deterministic on purpose (no random/
// time even in UI glue) — the wordlist and the counter arithmetic live in
// `registerForm.ts` (REFM-52); only the storage read/write stays here.
function suggestCallsign(): string {
  const n = nextCallsignNumber(localStorage.getItem('void.newcount'));
  localStorage.setItem('void.newcount', String(n));
  const pick = callsignFor(n);
  return `${t(pick.key)}-${pick.suffix}`;
}
function enterBrowse(): void {
  if (!nickInput.value.trim()) nickInput.value = suggestCallsign();
  showStage('browse');
  void refreshMatches();
}
// --- meta-shell hub: post-login home + bottom nav (docs/main-menu.md) -------
// After identity you land on the hub (home + PLAY + bottom nav), not the raw match
// list. The nav routes into the existing flow: "Игры"/"ИГРАТЬ" → the match browser
// (стадия 2 of #connect, untouched), Рейтинг/Альянсы → заглушки до мета-слоя, Ещё →
// настройки. Social sign-in is a guest stub (accounts AC-1.1) with a "скоро" note.
const hubEl = $('hub');
const hubNote = $('hub-note');
function showHub(show: boolean): void {
  hubEl.style.display = show ? 'flex' : 'none';
}
const HUB_PANELS: Record<string, string> = {
  home: 'hp-home',
  rank: 'hp-rank',
  meta: 'hp-meta',
  friends: 'hp-friends',
  arsenal: 'hp-arsenal',
  ally: 'hp-ally',
  more: 'hp-more',
};
let currentHubTab = 'home'; // the visible hub panel, so an async XP sync can repaint it
function hubTab(tab: string): void {
  hubNote.textContent = '';
  if (tab === 'games') {
    showHub(false);
    showConnect(true);
    enterBrowse(); // hand off to the existing match browser
    return;
  }
  currentHubTab = tab;
  if (tab === 'meta') renderMetaPanel(); // live numbers every visit (XP may have grown)
  if (tab === 'friends') void friends.refresh(); // roster + presence are server truth
  if (tab === 'rank') void rank.refresh(); // places are computed server-side (RANK-1)
  if (tab === 'arsenal') void arsenal.refresh(); // cache paints now, server refresh trails
  for (const [k, pid] of Object.entries(HUB_PANELS))
    $(pid).style.display = k === tab ? 'flex' : 'none';
  for (const b of Array.from(document.querySelectorAll('.hub-tab')))
    b.classList.toggle('active', (b as HTMLElement).dataset.hub === tab);
}

// --- «Прокачка» — the commander's meta-progression trees (hub tab) -----------------
// Three straight tracks (командование/экономика/наука); XP comes ONLY from finished
// matches, a node costs its tier in points. Effects are session-start snapshots
// (hidden techs / council level / starting treasury) — see prototype/src/meta.ts.
function renderMetaPanel(): void {
  const el = $('hp-meta');
  const st = loadMeta();
  const lvl = metaLevel(st.xp);
  const [got, need] = metaLevelProgress(st.xp);
  const pts = metaPoints(st);
  let h =
    `<div class="mp-head"><b>${t('meta.level', { n: lvl })}</b>` +
    `<span class="mp-xp">${t('meta.xp', { got, need })}</span>` +
    `<span class="mp-pts">${t('meta.points', { n: pts })}</span></div>`;
  h += `<div class="mp-track"><div class="mp-fill" style="width:${Math.round((got / need) * 100)}%"></div></div>`;
  for (const branch of ['command', 'economy', 'science'] as MetaBranch[]) {
    h += `<div class="mp-branch"><div class="mp-bt">${t(META_BRANCH_RU[branch])}</div>`;
    for (const node of META_TREE.filter((x) => x.branch === branch)) {
      const owned = st.spent.includes(node.id);
      const can = canUnlock(st, node.id);
      h +=
        `<div class="mp-node ${owned ? 'own' : can ? 'can' : 'lock'}">` +
        `<div class="mp-nm">${owned ? '✓ ' : ''}${esc(t(node.name))} <em>· ${t('meta.cost', { n: node.tier })}</em></div>` +
        `<div class="mp-ds">${esc(t(node.desc))}</div>` +
        (owned
          ? ''
          : `<button class="mp-buy" data-meta="${node.id}" ${can ? '' : 'disabled'}>${can ? t('hero.tree.unlock') : t('meta.locked')}</button>`) +
        `</div>`;
    }
    h += `</div>`;
  }
  h += `<p class="mp-note">${t('meta.note')}</p>`;
  el.innerHTML = h;
}
$('hp-meta').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest('[data-meta]') as HTMLElement | null;
  if (!b || (b as HTMLButtonElement).disabled) return;
  const next = unlockNode(loadMeta(), b.dataset.meta!);
  if (next) {
    saveMeta(next);
    renderMetaPanel();
  }
});

// --- «Друзья» — the account's roster (hub tab, FRIENDS-1) --------------------
// Экран живёт в `friendsScreen.ts`; здесь только доступ к серверу. Политика та же,
// что у «Арсенала»: вкладка ПЕРЕИСПОЛЬЗУЕТ сессию, которую уже добыл вход, но никогда
// не спрашивает пароль ради того, чтобы просто посмотреть — нет сервера, нет режима
// аккаунтов или нет сохранённой сессии читаются одинаково (гостевое состояние).
/**
 * Авторизованный адрес для вкладок хаба — ОДИН на все пять (`hubAuth.ts`, REFM-138).
 * Там же причины: три условия обязательны, режим аккаунтов пробуется у сервера, а ради
 * просмотра пароль не спрашивают — любой отказ это гостевое состояние.
 */
async function hubAuthorizedBase(): Promise<{ base: string; token: string } | null> {
  const srv = resolveServer();
  if (srv) await probeAuthMode(srv.base); // проба режима — только когда есть у кого
  return authorizedBase(
    { server: srv, accountsMode: authMode, token: srv ? sessionToken(srv.base) : null },
    httpBase,
  );
}

const friends = initFriends({
  root: () => $('hp-friends'),
  authorizedBase: hubAuthorizedBase,
});

// --- «Рейтинги» — commander + corporation boards (hub tab, RANK-1) ----------
// Доски считает сервер (`leaderboardApi.ts`): своё место — по ВСЕЙ популяции, а не по
// присланной странице, поэтому клиент его вывести и не смог бы. Доступ — та же
// политика, что у «Друзей»: переиспользуем добытую входом сессию, пароль ради
// просмотра не спрашиваем; нет сессии — гостевое состояние с причиной.
const rank = initRank({
  root: () => $('hp-rank'),
  authorizedBase: hubAuthorizedBase,
});

// --- «Арсенал» — the account's persistent collection (hub tab, ARS-5) --------
// The витрина itself lives in `arsenalScreen.ts` (REFM-5); here it gets its hooks.
// Cache key is per callsign, like the meta store. `authorizedBase` encodes the tab's
// policy: it may reuse a session token a prior join already stashed, but must never
// prompt for a password just to LOOK at the collection — no server, no accounts or
// no stashed session all read the same way (null ⇒ keep the cached paint).
const arsenal = initArsenal({
  root: () => $('hp-arsenal'),
  readCache: () => {
    try {
      return JSON.parse(localStorage.getItem(arsenalKey()) ?? 'null');
    } catch {
      return null;
    }
  },
  writeCache: (items) => localStorage.setItem(arsenalKey(), JSON.stringify(items)),
  openCodex,
  authorizedBase: hubAuthorizedBase,
});
function arsenalKey(): string {
  return 'vd.arsenal.' + (nickInput.value.trim() || 'guest');
}


// --- Профиль командира — the career dossier (docs/main-menu.md §4.2) ------------
// Само досье живёт в `profileScreen.ts` (REFM-10); здесь только его хуки. Ключ кэша
// медалей — по позывному, рядом с остальными ключами. `authorizedBase` кодирует ту же
// политику, что у «Арсенала»: за паролем ради ПОСМОТРЕТЬ витрину не ходим.
const profile = initProfile({
  root: () => $('profile'),
  view: () => {
    const st = loadMeta();
    return {
      nick: nickInput.value,
      xp: st.xp,
      stats: st.stats,
      corp: (() => {
        const c = corp.mine().corp;
        return c ? { name: c.name, influence: c.influence } : null;
      })(),
      sovereigns: SOVEREIGNS,
    };
  },
  readCache: () => {
    try {
      return JSON.parse(localStorage.getItem(medalsKey()) ?? 'null');
    } catch {
      return null;
    }
  },
  writeCache: (value) => localStorage.setItem(medalsKey(), JSON.stringify(value)),
  authorizedBase: hubAuthorizedBase,
});
const medalsKey = (): string => 'vd.medals.' + (nickInput.value.trim() || 'guest');

// --- вход в хаб и зеркало аккаунтного XP ---------------------------------------

/** Accounts mode (EC-*): pull the DURABLE account XP into the local meta mirror, so
 *  the commander level/progress a player sees is account-backed and follows them to a
 *  new device — not the per-callsign localStorage that only lived in one browser. The
 *  server total is authoritative (it sums every credited match across devices); the
 *  per-match award still lands optimistically at checkEnd (same formula as the core's
 *  `data.rewards`, so they agree). Guest/nick mode has no account → keeps localStorage. */
async function syncCommanderFromServer(): Promise<void> {
  const srv = resolveServer();
  if (!srv) return;
  await probeAuthMode(srv.base);
  if (!authMode) return;
  const session = sessionToken(srv.base);
  if (!session) return;
  try {
    const res = await fetch(`${httpBase(srv.base)}/commander/me`, {
      headers: { authorization: `Bearer ${session}` },
    });
    if (!res.ok) return;
    const cur = loadMeta();
    // Merging the two totals is `commanderSync.ts` (REFM-53): XP only ever grows, an
    // unreadable answer leaves the local figure alone, and only a real change repaints.
    const sync = syncCommanderXp(cur.xp, await res.json().catch(() => null));
    if (sync.changed) {
      saveMeta({ ...cur, xp: sync.xp }); // local `spent` tree is kept
      // repaint the open hub panel so the new level/points show without a manual switch
      if (hubEl.style.display !== 'none' && (currentHubTab === 'home' || currentHubTab === 'meta'))
        hubTab(currentHubTab);
    }
  } catch {
    // offline — the last mirrored total stays; a later login reconciles
  }
}
function openHub(note = ''): void {
  if (!nickInput.value.trim()) nickInput.value = suggestCallsign();
  const nick = nickInput.value.trim();
  $('hub-name').textContent = nick || t('auth.commander');
  showConnect(false);
  showHub(true);
  hubTab('home');
  hubNote.textContent = note;
  refreshOnboardOffer(); // ONB-0: first-run offer/nudge for a not-yet-onboarded commander
  void syncCommanderFromServer(); // account-backed XP → local mirror (accounts mode only)
}

$('cnew').addEventListener('click', () => {
  // «Новый командир» → the dedicated registration PAGE (its own stage of #connect, no live
  // game behind it): callsign + password + repeat. Awaiting the probe closes the race — a
  // tap before /auth/status answers must not take the guest branch on an accounts server.
  // With accounts OFF (nick-only server) there is no password to set, so a new commander
  // just gets a suggested callsign and drops into the hub.
  void authProbe.then(() => {
    if (authMode) {
      openRegister();
      return;
    }
    openHub();
  });
});
// «Вход по позывному»: reveal an inline field and enter under a callsign YOU type (vs
// «Новый командир», which auto-suggests one). The chosen callsign is remembered
// (`void.nick`) so the next visit auto-recognises you (the first-run gate above).
// With accounts on the server (authMode) the same form carries a password and the
// welcome card itself registers/logs in (registration IS the first login).
const wLoginEl = $('cwlogin');
const wNickInput = $('cwnick') as HTMLInputElement;
const wPassRowEl = $('cwpassrow');
const wPassInput = $('cwpass') as HTMLInputElement;
function signInByCallsign(): void {
  const nick = wNickInput.value.trim();
  if (!nick) {
    wNickInput.focus(); // the empty field IS the message — no status line for it
    return;
  }
  // Same race guard as «Новый командир»: never pick the guest branch while the
  // /auth/status probe is still in flight.
  void authProbe.then(() => {
    if (authMode) {
      void welcomeSignIn(nick);
      return;
    }
    nickInput.value = nick;
    localStorage.setItem('void.nick', nick); // remembered — next visit skips the welcome card
    openHub();
  });
}
let signingIn = false; // in-flight guard: Enter + click must not double-register
/** Bytro-style welcome sign-in: register-or-login right on the greeting card, then
 *  land on the hub. Reuses ensureSession (login → 401 → register), so a fresh
 *  callsign creates the account and a known one just logs in. */
async function welcomeSignIn(nick: string): Promise<void> {
  if (signingIn) return; // a second Enter/click while the first runs would double-POST
  signingIn = true;
  try {
    wPassRowEl.style.display = 'flex'; // make sure the password is visible before we demand it
    nickInput.value = nick;
    const srv = resolveServer();
    if (!srv) return;
    const session = await ensureSession(srv.base, nick);
    if (!session) {
      wPassInput.focus(); // ensureSession already explained why in the status line
      return;
    }
    localStorage.setItem('void.nick', nick);
    wPassInput.value = ''; // the session JWT is stored instead — a password never lingers
    statusEl.textContent = '';
    // If we arrived via `?join=<id>` (or the join button opened the welcome card
    // because no session was cached), resume the join now that we have a JWT — with
    // the seat and faction the player chose, not just the match id.
    const pending = pendingJoinAfterAuth.take();
    if (pending) {
      showStage('browse'); // hide the welcome card
      connectToMatch(pending.matchId, pending.slot, pending.faction);
    } else {
      openHub();
    }
  } finally {
    signingIn = false;
  }
}
wPassInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') signInByCallsign();
});
$('clogin').addEventListener('click', () => {
  const show = wLoginEl.style.display === 'none';
  wLoginEl.style.display = show ? 'flex' : 'none';
  statusEl.textContent = '';
  if (show) {
    wNickInput.value = (localStorage.getItem('void.nick') ?? '').trim();
    wNickInput.focus();
  }
});
$('cwgo').addEventListener('click', signInByCallsign);
wNickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') signInByCallsign();
});
$('cgoogle').addEventListener('click', () => openHub(t('auth.google.soon')));
$('capple').addEventListener('click', () => openHub(t('auth.apple.soon')));
$('cback').addEventListener('click', () => {
  showStage('welcome'); // reset #connect's inner stage for next time
  statusEl.textContent = '';
  openHub(); // back from the browser → the hub
});
// Language picker: RU ⇄ EN. The choice persists; a reload rebuilds every renderer
// in the new language (the picker lives on the welcome screen — no match to lose).
$('clang').textContent = LOCALE_LABEL[LOCALE] + ' ▾';
$('clang').addEventListener('click', () => {
  setLocale(LOCALE === 'ru' ? 'en' : 'ru');
  if (typeof location !== 'undefined' && location.reload) location.reload();
});
localizeStaticDom(); // static markup is canonical-Russian; translate it in place
for (const a of Array.from(document.querySelectorAll('.cfoot a'))) {
  a.addEventListener('click', () => {
    statusEl.textContent = t('soon.generic', { what: (a.textContent ?? '').trim() });
  });
}

// --- «Новый командир» → dedicated registration page (its own #connect stage) -------
// Callsign + password + repeat, on a page of its own (no live game behind it). Registration
// IS the first login (ensureSession: login → 401 → register), so a fresh callsign creates
// the account. «Восстановить доступ» is a stub until the accounts backend grows a real reset
// (no email on file yet — docs/accounts-roadmap.md).
const crNickInput = $('crnick') as HTMLInputElement;
const crMailInput = $('crmail') as HTMLInputElement;
const crPassInput = $('crpass') as HTMLInputElement;
const crPass2Input = $('crpass2') as HTMLInputElement;
function openRegister(): void {
  showStage('register');
  crNickInput.value = crNickInput.value.trim() || suggestCallsign();
  crPassInput.value = '';
  crPass2Input.value = '';
  statusEl.textContent = '';
  crPassInput.focus();
}
async function submitRegister(): Promise<void> {
  // The check ladder and the payload live in `registerForm.ts` (REFM-52): every
  // problem names its own field, and an empty email never reaches the request.
  const form = {
    nick: crNickInput.value,
    pass: crPassInput.value,
    pass2: crPass2Input.value,
    email: crMailInput.value,
  };
  const payload = registerPayload(form);
  if (!payload) {
    const problem = checkRegister(form)!;
    statusEl.textContent = t(problem.key);
    const focusOn = { nick: crNickInput, pass: crPassInput, pass2: crPass2Input };
    focusOn[problem.field].focus();
    return;
  }
  const nick = payload.nick;
  if (signingIn) return; // Enter + click must not double-register
  signingIn = true;
  try {
    // The callsign the player just typed lives on THIS page (`crnick`), while
    // resolveServer() reads the match browser's field (`cnick`) — empty for a brand-new
    // commander who came straight here from «Новый командир». Without this line the
    // whole registration dead-ended on «введите позывной» and never reached the server.
    nickInput.value = nick;
    const srv = resolveServer();
    if (!srv) return;
    // Email is OPTIONAL — it exists only so the account can be recovered later; skipping it
    // just means no self-service reset. A malformed one is caught by the server (400).
    const session = await ensureSession(srv.base, nick, payload.pass, payload.email);
    if (!session) {
      crPassInput.focus(); // ensureSession already explained why in the status line
      return;
    }
    localStorage.setItem('void.nick', nick);
    nickInput.value = nick;
    crPassInput.value = '';
    crPass2Input.value = '';
    statusEl.textContent = '';
    // Same resume as welcomeSignIn: a `?join=<id>` deep-link (or a «Войти» press with
    // no session yet) routes a BRAND-NEW player through the full registration page —
    // this path used to drop straight into the empty hub, silently abandoning the
    // match they were trying to join (the seat never got claimed).
    const pending = pendingJoinAfterAuth.take();
    if (pending) {
      showStage('browse');
      connectToMatch(pending.matchId, pending.slot, pending.faction);
    } else {
      openHub();
    }
  } finally {
    signingIn = false;
  }
}
$('crgo').addEventListener('click', () => void submitRegister());
crNickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') crMailInput.focus();
});
crMailInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') crPassInput.focus();
});
crPassInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') crPass2Input.focus();
});
crPass2Input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void submitRegister();
});
$('crback').addEventListener('click', () => {
  showStage('welcome');
  statusEl.textContent = '';
});

// --- Password recovery: request a reset link (email → /auth/recover) ------------------
// Anti-enumeration mirrors the server: the confirmation is identical whether or not the
// email is on file. «Восстановить доступ» on the registration page opens this stage.
const crecMailInput = $('crecmail') as HTMLInputElement;
async function submitRecover(): Promise<void> {
  const email = crecMailInput.value.trim();
  if (!email) {
    statusEl.textContent = t('auth.need-mail');
    crecMailInput.focus();
    return;
  }
  const srv = resolveServer();
  if (!srv) return;
  try {
    await fetch(`${httpBase(srv.base)}/auth/recover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch {
    /* swallow — never reveal a delivery/lookup outcome */
  }
  statusEl.textContent = t('auth.recover.sent');
}
$('crrecover').addEventListener('click', () => {
  showStage('recover');
  crecMailInput.value = crMailInput.value.trim();
  statusEl.textContent = '';
  crecMailInput.focus();
});
$('crecgo').addEventListener('click', () => void submitRecover());
crecMailInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void submitRecover();
});
$('crecback').addEventListener('click', () => {
  showStage('welcome');
  statusEl.textContent = '';
});

// --- Password reset: spend a mailed «?reset=<token>» link (→ /auth/reset) -------------
// Сцена живёт в `passwordReset.ts` (REFM-19); здесь проводка. Сеть и сессии остаются
// тут: модуль не знает ни адреса сервера, ни ключа сессии. Успешный сброс И ЕСТЬ вход —
// сервер отдаёт сессию в ответе, поэтому дальше сразу хаб.
const cresetPassInput = $('cresetpass') as HTMLInputElement;
const cresetPass2Input = $('cresetpass2') as HTMLInputElement;
const passwordReset = initPasswordReset({
  fields: () => ({ pass: cresetPassInput, pass2: cresetPass2Input }),
  status: (msg) => {
    statusEl.textContent = msg;
  },
  busy: () => signingIn,
  setBusy: (v) => {
    signingIn = v;
  },
  submit: async (token, password) => {
    const srv = resolveServer();
    if (!srv) return null;
    const res = await fetch(`${httpBase(srv.base)}/auth/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password }),
    }).catch(() => null);
    if (!res) return null;
    return { ok: res.ok, body: await res.json().catch(() => ({})) };
  },
  onSuccess: (login, token) => {
    const srv = resolveServer();
    if (srv) saveSession(localStorage, srv.base, { login, token });
    localStorage.setItem('void.nick', login);
    nickInput.value = login;
    note('✔ ' + t('auth.reset.done'));
    openHub();
  },
  showStage: () => {
    showConnect(true);
    showHub(false);
    showStage('reset');
    // Подсказать менеджеру паролей, К КАКОМУ аккаунту этот новый пароль (скрытое
    // `autocomplete="username"`); без этого запись сохранится ни к чему не привязанной.
    const resetUser = document.getElementById('cresetuser');
    if (resetUser instanceof HTMLInputElement) {
      resetUser.value = (localStorage.getItem('void.nick') ?? '').trim();
    }
  },
});
$('cresetgo').addEventListener('click', () => void passwordReset.submit());
cresetPassInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') cresetPass2Input.focus();
});
cresetPass2Input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void passwordReset.submit();
});
/** Open the reset stage for a «?reset=<token>» deep-link (called from the first-run gate). */
function openReset(token: string): void {
  // Токен — живая 15-минутная возможность угона аккаунта, поэтому он не должен остаться
  // в адресной строке и истории (referer, «назад», синхронизация между устройствами).
  const cleaned = passwordReset.open(token, location.href);
  try {
    if (cleaned !== location.href) history.replaceState(null, '', cleaned);
  } catch {
    /* history/URL unavailable (non-browser test env) — nothing to scrub */
  }
}

// hub interactions
$('hub-play').addEventListener('click', () => hubTab('games'));
// Single-player entry from the hub home — offline skirmish vs bots (both builds).
$('hub-solo').addEventListener('click', () => {
  userClosed = true; // intentional leave → don't auto-reconnect to a server
  NET = false;
  netAdmitted = false;
  showHub(false);
  openSetup('hub');
});
$('hub-msg').addEventListener('click', () => {
  hubNote.textContent = t('hub.messages.soon');
});
$('hub-logout').addEventListener('click', () => {
  // «Сменить командира» must really switch identity: drop this server's session so
  // the next sign-in authenticates the NEW callsign instead of replaying the old JWT.
  const srv = resolveServer();
  if (srv) clearSession(localStorage, srv.base);
  statusEl.textContent = '';
  showHub(false);
  showConnect(true);
  showStage('welcome');
});
for (const b of Array.from(document.querySelectorAll('.hub-tab'))) {
  b.addEventListener('click', () => hubTab((b as HTMLElement).dataset.hub ?? 'home'));
}
// «Прокачка» уехала из нижней навигации (там семь вкладок — предел) в «Ещё»: плитка
// открывает ТУ ЖЕ панель `hp-meta`, а не свою копию экрана.
document.getElementById('hub-meta')?.addEventListener('click', () => hubTab('meta'));
for (const tile of Array.from(document.querySelectorAll('#hp-more .hub-tile[data-more]'))) {
  tile.addEventListener('click', () => {
    // The tile's own label span is already localized (localizeStaticDom ran at boot);
    // read IT, not the Russian-only data-more attribute, so the toast matches the UI language.
    const label =
      tile.querySelector('[data-i18n]')?.textContent ?? (tile as HTMLElement).dataset.more ?? '';
    hubNote.textContent = t('soon.generic', { what: label });
  });
}

// --- settings overlay (hub → «Ещё» → Настройки) -----------------------------
// Окно живёт в `settingsOverlay.ts` (REFM-22); здесь проводка. Модуль настройками не
// владеет — каждая живёт там, где её читают (графика, цвета сторон, звук, развёртка), а
// оверлей только показывает снимок и отдаёт изменение обратно.
const settingsEl = $('settings');
const settings = initSettings({
  root: () => settingsEl,
  view: () => ({
    sweepOpacity,
    ownPings: showOwnPings,
    glow: glowOn(),
    starfield: starfieldOn(),
    fps: showFpsOn(),
    soundOn: snd.enabled(),
    volume: snd.volume(),
    youColor,
    neutralColor,
    palette: rivalPaletteId,
  }),
  setSweepOpacity,
  setOwnPings: setShowOwnPings,
  setGlow: setGlowFx,
  setStarfield: setStarfield,
  setFps: setShowFps,
  setSound: (v) => snd.setEnabled(v),
  setVolume: (v) => snd.setVolume(v),
  previewSound: () => snd.play('tap'),
  setColors: (you, neutral, palette) => setSideColors(you, neutral, palette),
  resetColors: () => setSideColors(COLOR.p1!, COLOR.null!, 'classic'),
});
$('hub-settings').addEventListener('click', () => settings.open());
// Rail: settings are reachable mid-match too, not only from the hub's «Ещё» tab.
document.getElementById('rail-settings')?.addEventListener('click', () => settings.open());

// First-run gate: a returning commander (a saved callsign) skips the identity card
// and boots straight into the hub — the raw "Новый командир / войти" screen is only
// for a genuinely new device. "Сменить командира" in the hub goes back to identity.
//
// Deep-link overrides (checked before the returning-player shortcut):
//  «?reset=<token>» — a mailed password-reset link → the reset page (set a new password).
//  «?join=<id>»     — a new tab spawned by «Войти» in the match list → straight into THAT
//                     session, reusing this browser's stored identity (nick / session JWT).
//
// These four belong to the accounts section below (SES-2.5), but they MUST be declared
// before this boot block: its async IIFEs read them SYNCHRONOUSLY when resolveServer()
// yields no server (no await happens before the read) — with the declarations after the
// block that read is a TDZ, and esbuild's const/let→var lowering turns the crash into a
// silent `undefined` (the httpBase trap; caught by tsc TS2448 when the prototype gained
// a typecheck).
let authMode = false;
/** When a join is attempted without a stored session, we show the welcome card; this
 *  holds the match AND the seat/faction the player already chose, so the sign-in can
 *  resume the join in full. `take()` reads and forgets in one step — see
 *  `pendingJoin.ts` (REFM-51) for why that matters. */
const pendingJoinAfterAuth = createPendingJoin();
const bootParams = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
const bootReset = (bootParams?.get('reset') ?? '').trim();
const bootJoinId = (bootParams?.get('join') ?? '').trim();
const bootSlot = (bootParams?.get('slot') ?? '').trim();
const bootFaction = (bootParams?.get('faction') ?? '').trim();
if (bootReset) {
  openReset(bootReset);
} else if (bootJoinId) {
  // Direct deep-link into a match. Two paths:
  //  (a) cached session JWT → connectToMatch immediately (no welcome card)
  //  (b) no session → show welcome card, welcomeSignIn auto-resumes the join
  showConnect(false);
  showHub(false);
  void (async () => {
    const srv = resolveServer();
    if (srv) await probeAuthMode(srv.base);
    // If auth-off LAN, just dial in (no login needed).
    if (!authMode) {
      showStage('browse');
      connectToMatch(bootJoinId, bootSlot || undefined, bootFaction || undefined);
      return;
    }
    // Auth-on: if we have a cached session JWT, go straight to the match.
    // NEVER log the record — even a prefix of `cached.token` is a session-JWT leak
    // into the browser console (and into any screen recording of a playtest).
    const cached = srv ? sessionRecord(srv.base) : null;
    if (cached) {
      showStage('browse');
      connectToMatch(bootJoinId, bootSlot || undefined, bootFaction || undefined);
      return;
    }
    // No session — show the welcome card so the player can register/login,
    // then welcomeSignIn auto-resumes the join via pendingJoinAfterAuth.
    pendingJoinAfterAuth.remember(bootJoinId, bootSlot, bootFaction);
    showStage('welcome');
    const savedNick = (localStorage.getItem('void.nick') ?? '').trim();
    wNickInput.value = savedNick || suggestCallsign();
    wPassRowEl.style.display = 'flex';
    wPassInput.focus();
  })();
} else {
  // Auth gate at boot (UX fix): show the welcome/login card FIRST, before the
  // hub — like every game's login screen. Previously a cached `void.nick` in
  // localStorage skipped straight to `openHub()`, but that left the player in
  // the hub with no valid session, so every Join silently failed (the session
  // JWT was missing or stale). Now the welcome card is the boot screen; a
  // returning player types their password once, gets a fresh JWT, and lands
  // on the hub with a live session — exactly the standard game-login flow.
  showConnect(true);
  showHub(false);
  showStage('welcome');
  void (async () => {
    const srv = resolveServer();
    if (srv) await probeAuthMode(srv.base);
    const savedNick = (localStorage.getItem('void.nick') ?? '').trim();
    if (savedNick) {
      wNickInput.value = savedNick;
    } else {
      wNickInput.value = suggestCallsign();
    }
    if (authMode) {
      wPassRowEl.style.display = 'flex';
      wPassInput.focus();
    } else {
      wPassRowEl.style.display = 'none';
    }
  })();
}

// --- single-player setup overlay --------------------------------------------
// Pick your homeworld on a mini-map and choose how many AI rivals join, then
// launch a fresh local match. Seat 1 is always you; seats 2-10 toggle AI/off.
// Switch every rival OFF for a solo sandbox — the core never ends a one-player
// match, so it's a peaceful space to read descriptions and learn the interface.
const setupEl = $('setup');
const setupMapEl = $('setupmap');
const setupSlotsEl = $('setupslots');
const setupFactionsEl = $('setupfactions');
const setupSpeedEl = $('setupspeed');
const setupHintEl = $('setuphint');
const setupGoEl = $('setupgo') as HTMLButtonElement;

// The player's division templates / hero roster / ship blueprints. Pre-match loadout
// EDITORS were removed (modules unlock via tech in-match, so freezing a loadout before
// the match is incoherent — loadout now happens in-match: ships at build time, heroes
// in the capital). These default rosters still seed the match via buildSetupConfig.
const setupHeroes: HeroLoadout[] = DEFAULT_HEROES.map((h) => ({
  name: h.name,
  grade: h.grade,
  abilities: [...h.abilities],
}));

/** The hero's display name — the главный hero shows the player's callsign (nick),
 *  falling back to its localized preset name only while the nick field is empty. */
function heroName(h: HeroLoadout): string {
  return h.grade === 'main' ? nickInput.value.trim() || t(h.name) : h.name;
}

const setupShips: ShipLoadout[] = DEFAULT_SHIP_LOADOUTS.map((l) => ({
  hull: l.hull,
  modules: [...l.modules],
}));

// Loadout is chosen in-match now (ships at build time under tech-unlocks, heroes in the
// capital), so the pre-match Верфь / Герои / Дивизии editors and their inventory chrome
// were removed. `setupTemplates` / `setupHeroes` / `setupShips` above keep seeding the
// match with the default rosters via buildSetupConfig.

function renderSetupMap(): void {
  // Рамка, трассы без повторов и порядок рисования — в `setupMap.ts` (REFM-45):
  // там же правило «каждое ребро один раз» и «кандидаты рисуются последними».
  const box = mapViewBox(MAP, 60);
  setupMapEl.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
  const order = drawOrder(MAP, START_CANDIDATES);
  let svg = '';
  for (const l of lanes(MAP)) {
    svg += `<line x1="${l.from.x}" y1="${l.from.y}" x2="${l.to.x}" y2="${l.to.y}" stroke="#1d3640" stroke-width="3"/>`;
  }
  for (const n of order.plain) {
    const planet = n.sector === 'planet';
    svg += `<circle cx="${n.x}" cy="${n.y}" r="${planet ? 16 : 11}" fill="${planet ? '#2c5460' : '#1b2d34'}" stroke="#33555f" stroke-width="2"/>`;
  }
  for (const n of order.candidates) {
    const picked = n.id === setupStart;
    svg +=
      `<circle class="cand" data-cand="${n.id}" cx="${n.x}" cy="${n.y}" r="${picked ? 30 : 22}" ` +
      `fill="${picked ? 'rgba(58,209,122,.35)' : 'rgba(53,214,230,.16)'}" ` +
      `stroke="${picked ? '#3ad17a' : '#35d6e6'}" stroke-width="${picked ? 6 : 4}"/>`;
  }
  setupMapEl.innerHTML = svg;
}

/** H3 — which house each seat plays: seat 0 (you) = `setupFaction`, then the four
 *  passive houses rotate in stable order across the remaining seats. */
function seatFactionIds(): string[] {
  // Раздача и нумерация домов — в `setupSeats.ts` (REFM-44): твой первый, остальные
  // по кругу в стабильном порядке, со второго круга имя получает номер.
  return seatSeatFactionIds(setupFaction, Object.keys(data.factions), SEAT_META.length);
}
function seatHouseName(fid: string, fallback: string, index: number): string {
  return houseNameFor(
    data.factions[fid]?.name ?? fallback,
    index,
    Object.keys(data.factions).length,
  );
}
/** A faction's passive-bonus readout, straight from the data (economy or units). */
function factionBonusLine(fid: string): string {
  const BONUS_KEY = {
    economy: 'setup.bonus.economy',
    damage: 'setup.bonus.damage',
    speed: 'setup.bonus.speed',
    radar: 'setup.bonus.radar',
  } as const;
  return factionBonuses(data.factions[fid]?.passives)
    .map((b) => t(BONUS_KEY[b.kind], { n: b.pct }))
    .join(' · ');
}

function renderSetupSlots(): void {
  // The faction picker (H3): four houses, each a pure passive bonus — pick yours.
  // Lives in its own container (#setupfactions, the left setup column); the team
  // toggle + seat rows fill #setupslots (the right column).
  let f2 = `<div class="fph">${t('setup.faction.note')}</div><div class="fpick">`;
  for (const fid of Object.keys(data.factions)) {
    const f = data.factions[fid];
    if (!f) continue;
    const on = fid === setupFaction;
    f2 +=
      `<button class="fchip${on ? ' on' : ''}" data-fpick="${fid}"><b>${esc(tData(f.name))}</b>` +
      `<span>${factionBonusLine(fid)}</span></button>`;
  }
  f2 += `</div>`;
  setupFactionsEl.innerHTML = f2;
  // Team-battle toggle: sides fight as allies. Only meaningful with ≥2 rivals (a 2v2
  // needs three AI seats on); shown always so the player can arm it before adding them.
  let h =
    `<div class="tmrow"><button class="tmtog${setupTeams ? ' on' : ''}" data-teamtog="1">` +
    `${setupTeams ? '⚔ ' + t('setup.teams.on') : t('setup.teams.off')}</button>` +
    (setupTeams ? `<span class="tmhint">${t('setup.teams.note')}</span>` : '') +
    `</div>`;
  const fids = seatFactionIds();
  // A/B side chip for a seat (you are locked to A; AI seats toggle side).
  const teamChip = (i: number, locked: boolean): string => {
    const side = setupSeatTeam[i]!;
    return `<button class="tmchip s${side}${locked ? ' lock' : ''}" data-teamseat="${i}"${locked ? ' disabled' : ''}>${side}</button>`;
  };
  for (let i = 0; i < SEAT_META.length; i++) {
    const m = SEAT_META[i]!;
    const role = setupSlots[i]!;
    const house = esc(houseDisplayName(seatHouseName(fids[i]!, m.name, i)));
    if (i === 0) {
      h +=
        `<div class="srow"><span class="dot" style="background:${m.color};color:${m.color}"></span>` +
        `<span class="nm">${house}</span>` +
        (setupTeams ? teamChip(0, true) : '') +
        `<span class="you">${t('comms.you')}</span></div>`;
    } else {
      const aiOn = role === 'ai';
      h +=
        `<div class="srow ${aiOn ? '' : 'off'}"><span class="dot" style="background:${m.color};color:${m.color}"></span>` +
        `<span class="nm">${house}</span>` +
        (setupTeams && aiOn ? teamChip(i, false) : '') +
        `<button class="stog ${aiOn ? 'ai' : ''}" data-slot="${i}">${aiOn ? t('diplo.filter.ai') : t('setup.off')}</button></div>`;
    }
  }
  setupSlotsEl.innerHTML = h;
}

function renderSetup(): void {
  renderSetupMap();
  renderSetupSlots();
  renderSetupCouncil();
  // Seat 1 (you) is always in, so the match can always launch — including with ZERO
  // rivals: a calm solo sandbox to read descriptions, learn the UI and test in peace
  // (the core never ends a one-player match — victory needs ≥2 active sides).
  const rivals = rivalCount(setupSlots);
  setupGoEl.disabled = false;
  setupGoEl.textContent = rivals === 0 ? t('setup.start.solo') : t('setup.start');
  setupHintEl.textContent = t(rivals === 0 ? 'setup.home.solo' : 'setup.home.pick', {
    home: setupStart,
  });
  for (const c of Array.from(setupSpeedEl.querySelectorAll('[data-spd]')))
    c.classList.toggle('on', Number((c as HTMLElement).dataset.spd) === setupSpeed);
}

// Where the Setup screen's Back button returns to — the surface that opened it, so
// arriving from the hub goes back to the hub, not the raw identity card.
let setupReturn: 'welcome' | 'hub' = 'welcome';
// --- scientist council picker: choose your 2 research leaders BEFORE the start-point ----
// Окно живёт в `sciPick.ts` (REFM-18); здесь только проводка. Список выбранных —
// `setupScientists` — принадлежит сетапу (его читает старт матча), поэтому ходит хуками.
const sciWin = $('scipick');
const setupCouncilEl = $('setupcouncil');
function renderSetupCouncil(): void {
  setupCouncilEl.innerHTML = sciCouncilRowHtml(setupScientists, data);
}
const sciPick = initSciPick({
  root: () => sciWin,
  body: () => $('scipickbody'),
  data: () => data,
  branchLabel,
  chosen: () => setupScientists,
  setChosen: (ids) => {
    setupScientists = ids;
    // Строка настройки идёт следом за КАЖДЫМ выбором, а не за закрытием окна: Back
    // закрывает окно мимо кода окна (лестница `BACK_LAYERS`), так что «дорисую при
    // закрытии» разошлось бы с состоянием ровно на этом пути.
    renderSetupCouncil();
  },
  onCancel: () => $('setupcancel').click(),
});
const openSciPick = (): void => sciPick.open();
setupCouncilEl.addEventListener('click', openSciPick);

function openSetup(from: 'welcome' | 'hub' = 'welcome'): void {
  setupReturn = from;
  setupSlots = freshSetupSlots();
  setupTeams = false; // a fresh setup opens on the classic free-for-all
  setupSeatTeam = [...DEFAULT_TEAM_SIDES];
  setupStart = START_CANDIDATES[0] ?? MAP[0]!.id;
  // Re-consecrate the council each time setup opens, PRE-SEEDED with the recommended
  // newbie pair (командование «Куратор» + генералист «Полимат»): the first permanent
  // choice a new player faces must never be a wall of empty slots + a disabled button —
  // one tap continues, swapping is optional. Guarded by presence so data edits degrade.
  setupScientists = ['overseer', 'polymath'].filter((id) => data.scientists[id]);
  // A lively default: ×1 wall-clock reads as a FROZEN screen to a newcomer, so the
  // setup opens on the last chosen multiplier (first launch: ×10). True real time
  // stays one tap away — the ×1 chip.
  const savedSpeed = Number(localStorage.getItem('void.setupSpeed'));
  setupSpeed = SETUP_SPEEDS.includes(savedSpeed) ? savedSpeed : 10;
  showConnect(false);
  setupEl.style.display = 'flex';
  $('setup-start').style.display = '';
  // SANDBOX — fenced hook. Each setup opens with the practice tools reset + unticked.
  if (!__PLAYER_BUILD__) {
    resetSandboxConfig();
    const sbx = $('setupsandbox') as HTMLInputElement | null;
    if (sbx) sbx.checked = false;
  }
  renderSetup();
  openSciPick(); // consecrate your 2 research leaders before picking the start point
}

// --- meta-progression (прокачка командующего) --------------------------------
// Per-callsign account state; v1 lives in localStorage next to the guest identity —
// the server account (SE-1.x) takes this over when the meta-layer lands there.
function metaKey(): string {
  return 'vd.meta.' + (nickInput.value.trim() || 'guest');
}
function loadMeta(): MetaState {
  return parseMetaState(localStorage.getItem(metaKey()));
}
function saveMeta(st: MetaState): void {
  localStorage.setItem(metaKey(), JSON.stringify(st));
}

function buildSetupConfig(): SetupConfig {
  // Seats play the HOUSES assigned at setup (H3): you = setupFaction, AI = the rest.
  // Seat name follows the house (its canonical data name); color stays per-seat.
  const fids = seatFactionIds();
  const seats: SeatConfig[] = [
    {
      id: SEAT_META[0]!.id,
      name: seatHouseName(fids[0]!, SEAT_META[0]!.name, 0),
      faction: fids[0]!,
      start: setupStart,
      ai: false,
      ...(setupTeams ? { team: setupSeatTeam[0] } : {}),
    },
  ];
  // Hand each active AI seat one of the remaining candidate worlds, in order.
  const free = START_CANDIDATES.filter((c) => c !== setupStart);
  let fi = 0;
  for (let i = 1; i < SEAT_META.length; i++) {
    if (setupSlots[i] !== 'ai') continue;
    const start = free[fi++];
    if (!start) break; // ran out of candidate worlds
    const m = SEAT_META[i]!;
    seats.push({
      id: m.id,
      name: seatHouseName(fids[i]!, m.name, i),
      faction: fids[i]!,
      start,
      ai: true,
      ...(setupTeams ? { team: setupSeatTeam[i] } : {}),
    });
  }
  // Carry the player's division templates + hero roster into the match (deep-cloned),
  // plus the meta-progression grant (snapshot — no live account reads mid-match).
  return {
    meta: metaGrant(loadMeta()),
    seats,
    ...(setupScientists.length ? { scientists: [...setupScientists] } : {}),
    heroes: setupHeroes.map((h) => ({
      name: heroName(h),
      grade: h.grade,
      abilities: [...h.abilities],
    })),
    ships: setupShips.map((l) => ({ hull: l.hull, modules: [...l.modules] })),
  };
}

// Install a ready GameState as the live match: reset all interaction state, queues,
// camera and log, then hide the setup overlay. `aiPlayers` are the seats the local
// sim drives. Shared by the normal skirmish and (via a hook) the dev test mode.
// Tap a resource chip → open the resource card (RC-1): stock, net flow, breakdown,
// and a button to open the market on that resource.
purse.addEventListener('click', (ev) => {
  const el = (ev.target as Element).closest('[data-res]') as HTMLElement | null;
  if (!el) return;
  resourceCard.open(el.dataset.res!);
});

// Tap the ✦ score chip → a plain-words breakdown of how the score is built and how
// the match ends (the victory rule is otherwise invisible mid-match).
topEl.addEventListener('click', (ev) => {
  if (!(ev.target as Element).closest('.dstat')) return;
  const mine = Object.values(s.planets).filter((p) => p.owner === ME);
  const worlds = mine.filter((p) => (p.kind ?? 'planet') === 'planet').length;
  const score = Math.round(s.match?.scores?.[ME]?.total ?? 0);
  note(
    t('hud.score.tip', {
      score,
      limit: SCORE_LIMIT,
      w: worlds,
      s: mine.length - worlds,
    }),
  );
});

function installMatch(state: GameState, aiPlayers: Set<string>): void {
  s = state;
  syncPlayerNames(s);
  ME = 'p1';
  AI_PLAYERS = aiPlayers;
  solo.reset();
  // ONB-2 (found live): a leftover guide from whatever was on screen before (a
  // tutorial the player exited without finishing/skipping, a stale reconnect) must
  // never survive into this match — #spotlight is a document.body singleton, so an
  // un-stopped tour keeps painting its last step over the NEW match too. Runs before
  // `maybeStartPendingTour()` (below) arms this match's own guide, if any.
  activeTour?.stop();
  // Reset interaction + queues + camera to the framed whole-map view.
  selFleet = null;
  selPlanet = null;
  selFleets = new Set();
  pendingMerges = [];
  pendingLoads = [];
  aiming = false;
  assaultAim = false;
  assaultOnArrival.clear();
  merging = false;
  additive = false;
  splitState = null;
  troopsPlan = null;
  if (chainMode) exitChainMode(); // режим «Приказ» не переживает смену матча
  chainRouteCache.clear(); // маршруты принадлежат карте СТАРОГО матча
  killStats = { destroyed: 0, lost: 0 };
  myBattleLocs.clear();
  memory.clear(); // fog memory belongs to the OLD match — stale intel must not carry over
  radarMemory.clear();
  threatMemory.clear(); // node ids repeat across matches — a stale episode must not mute a real alert
  threatScanAt = -1;
  battleLosses.clear();
  aaShots.length = 0;
  logLines.length = 0; // fresh log — drop notes from the menu-background match
  eventLog.length = 0; // ONB-5: the return digest belongs to THIS match only
  awayFromGameTime = null; // reset the away-window baseline for the new match
  banner = null; // clear any end-banner left by the menu-background match (else it sticks)
  endScreen = null; // a fresh match must not open into the previous result
  matchEnd.reset(); // новый матч зарабатывает свою награду
  // The match goal, written AFTER the wipe so it is the first line a player can read.
  // Kept honest against the kernel: victoryModule ends on score (SCORE_LIMIT), on
  // elimination, or on domination — no "capital capture" victory exists.
  note(t('hud.goal', { n: SCORE_LIMIT }));
  for (const k of Object.keys(buildQueues)) delete buildQueues[k];
  defaultView(); // phone: zoom onto home; desktop: whole-map fit
  setupEl.style.display = 'none';
  // SANDBOX — fenced hook. A fresh match starts with no frozen-queue carryover and the
  // practice tools off; startMatch() re-arms them if the setup checkbox was ticked.
  if (!__PLAYER_BUILD__) {
    resetSandboxRuntime();
    sandboxConfig.enabled = false;
    setSandboxButton(false);
  }
  maybeStartPendingTour(); // ONB-0: run a queued onboarding guide over the fresh HUD
  snd.play('start'); // приглушённая фанфара — матч начался (соло и дев-сценарии)
}
function startMatch(setup: SetupConfig): void {
  const st = newGame(setup);
  installMatch(st, new Set(setup.seats.filter((x) => x.ai).map((x) => x.id)));
  applyTimeSpeed(setupSpeed); // launch running at the chosen time-flow multiplier
  // SANDBOX — fenced hook. Arm the practice tools for this match from the setup
  // checkbox; remember the home world for the immortal-home toggle and show the opener.
  if (!__PLAYER_BUILD__) {
    sandboxConfig.enabled = ($('setupsandbox') as HTMLInputElement | null)?.checked ?? false;
    sandboxHomeId = setup.seats[0]?.start ?? null;
    setSandboxButton(sandboxConfig.enabled);
  }
}

setupMapEl.addEventListener('click', (ev) => {
  const direct = (ev.target as Element).closest('[data-cand]');
  let pick: string | null = direct?.getAttribute('data-cand') ?? null;
  if (!pick) {
    // The candidate circles are ~8px on a phone — a near miss still counts.
    // Перевод тапа в координаты viewBox и радиус снапа — `setupMap.ts` (REFM-126,
    // правила 4–5): SVG растянут с `preserveAspectRatio=meet`, и в экранных пикселях
    // снап промахивался бы тем сильнее, чем сильнее вытянуто окно. Ближайший кандидат —
    // `pointerPick.ts`, тот же поиск, что и на карте матча.
    const at = viewBoxPoint(
      setupMapEl.getBoundingClientRect(),
      (setupMapEl as unknown as SVGSVGElement).viewBox.baseVal,
      ev.clientX,
      ev.clientY,
    );
    if (at) {
      const hit = nearestHit(
        START_CANDIDATES.flatMap((id) => {
          const n = MAP.find((m) => m.id === id);
          return n ? [n] : [];
        }),
        (n) => n,
        at.x,
        at.y,
        SNAP_REACH,
      );
      pick = hit?.id ?? null;
    }
  }
  if (!pick) return;
  setupStart = pick;
  renderSetup();
});
setupFactionsEl.addEventListener('click', (ev) => {
  const fp = (ev.target as Element).closest('[data-fpick]');
  if (!fp) return;
  setupFaction = fp.getAttribute('data-fpick') ?? setupFaction;
  renderSetup();
});
setupSlotsEl.addEventListener('click', (ev) => {
  if ((ev.target as Element).closest('[data-teamtog]')) {
    setupTeams = !setupTeams;
    renderSetup();
    return;
  }
  const ts = (ev.target as Element).closest('[data-teamseat]');
  if (ts) {
    const i = Number(ts.getAttribute('data-teamseat'));
    if (i > 0) setupSeatTeam[i] = setupSeatTeam[i] === 'A' ? 'B' : 'A'; // you (0) are locked to A
    renderSetup();
    return;
  }
  const t = (ev.target as Element).closest('[data-slot]');
  if (!t) return;
  const i = Number(t.getAttribute('data-slot'));
  setupSlots[i] = setupSlots[i] === 'ai' ? 'off' : 'ai';
  renderSetup();
});
setupSpeedEl.addEventListener('click', (ev) => {
  const t = (ev.target as Element).closest('[data-spd]');
  if (!t) return;
  setupSpeed = Number(t.getAttribute('data-spd'));
  localStorage.setItem('void.setupSpeed', String(setupSpeed));
  renderSetup();
});
setupGoEl.addEventListener('click', () => startMatch(buildSetupConfig()));
$('setupcancel').addEventListener('click', () => {
  setupEl.style.display = 'none';
  if (setupReturn === 'hub') openHub();
  else showConnect(true);
});

function connect(): void {
  const srv = resolveServer();
  if (!srv) return;
  const { base, nick } = srv;
  // Seat lock (REL-5): the ticket the server minted for this seat on first join —
  // presented back on every reconnect so nobody else can take the seat by typing
  // our nick. Keyed per server+match+nick (the ticket is seat-scoped).
  const ticketKey = seatTicketKey(base, currentMatchId, nick);
  const seatTicket = localStorage.getItem(ticketKey);
  // Чем представляемся и как это ложится в адрес — `netDial.ts` (REFM-142). Там же
  // причины: два способа не смешиваются (в режиме аккаунтов ник и билет сервер
  // отвергнет), билет привязан к тройке «сервер + матч + позывной», а всё уходящее в
  // адрес экранируется — позывной вводит человек.
  const url = dialUrl(
    base,
    currentMatchId,
    dialIdentity(authMode, pendingJoinToken, nick, seatTicket),
  );
  pendingJoinToken = null; // one dial per token fetch — a reconnect mints a fresh one
  statusEl.textContent = t('net.connecting', { nick });
  localStorage.setItem('void.server', base);
  localStorage.setItem('void.nick', nick); // resume this seat next visit

  // WS "open" only means the socket connected, not that the server admitted us — it
  // may still reject (slot taken / unknown player). Flip to "in the match" only on
  // the first welcome snapshot, so a rejected join never flashes the map.
  let admitted = false;
  if (netSock) netSock.close();
  const sock = (netSock = new WebSocket(url));
  const client = (netClient = new MultiplayerClient(
    { send: (d: string) => sock.send(d), close: () => sock.close() },
    {
      onStatus: () => {
        // Intentionally no-op on "open": admission is confirmed by the first
        // welcome snapshot (see onSnapshot), not by the socket opening.
      },
      onSeatTicket: (ticket) => {
        // The server minted our seat ticket (first join of this nick) — persist it;
        // every later join must present it, and the server can't re-issue (hash-only).
        localStorage.setItem(ticketKey, ticket);
      },
      onPong: (_serverTime, clientTime) => {
        if (clientTime === undefined) return;
        const rtt = performance.now() - clientTime;
        rttEma = rttEma === null ? rtt : rttEma * 0.7 + rtt * 0.3;
      },
      onSnapshot: (snap) => {
        // Устаревший сокет не трогает общее состояние (`socketFate.ts`, REFM-143):
        // его снимок переписал бы игру чужой, уже закрытой сессией.
        if (!isCurrentSocket(sock, netSock)) return;
        // Что значит этот снимок — `netWelcome.ts` (REFM-144): вход подтверждает первый
        // снимок и ровно один раз на сокет, переподключение входит молча (это не новый
        // матч), и вход снимает только СВОЙ баннер.
        const plan = welcomePlan({ admitted, reconnecting, banner });
        banner = plan.banner;
        if (plan.admit) {
          // Server accepted us — NOW we're really in the match.
          admitted = true;
          netAdmitted = true; // BF-30: ME is now the server-assigned seat — safe to render
          if (plan.fanfare) snd.play('start');
          reconnecting = false; // a fresh welcome ends any reconnect cycle
          reconnectAttempts = 0;
          NET = true;
          ME = snap.playerId ?? ME;
          clearSelection();
          endScreen = null; // joining a match must not carry the previous result
          matchEnd.reset(); // переподключение к матчу считает его конец заново
          pendingLoads = []; // drop any queued loads from a prior/local session
          if (chainMode) exitChainMode(); // черновик прежней сессии не переносится
          chainRouteCache.clear();
          showConnect(false);
          showHub(false); // hide the hub so inMatch() is true → Back works (BF-31)
          note(t('net.connected', { who: NAME[ME] ?? ME }));
          // Latency probe: ping every 2s with a client timestamp the pong echoes.
          if (pingTimer) clearInterval(pingTimer);
          pingTimer = setInterval(() => client.ping(performance.now()), 2000);
          client.ping(performance.now()); // seed an RTT reading immediately
          // Perf sample (M2): smoothed fps + rtt + JS-heap (Chrome-only field),
          // every 30s — cheap enough to never matter, useful on every playtest.
          if (perfTimer) clearInterval(perfTimer);
          perfTimer = setInterval(() => {
            const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory
              ?.usedJSHeapSize;
            client.sendPerf({
              fps: Math.round(fpsEma),
              ...(rttEma !== null ? { rttMs: Math.round(rttEma) } : {}),
              ...(mem !== undefined ? { memMb: Math.round(mem / 1048576) } : {}),
            });
          }, PERF_SAMPLE_MS);
        }
        const diploShift = admitted && s !== snap.state && diffNetDiplomacy(s, snap.state);
        s = snap.state;
        syncPlayerNames(s);
        // Radar picture (BF-18): detected-but-unidentified enemy fleets are absent
        // from the fogged state — the server sends them as coarse contacts beside
        // each frame. The sweep paints THESE in NET (see updateRadarContacts).
        // Что снимок делает с миром — `snapshotIngest.ts` (REFM-146): контакты живут
        // ровно один снимок (иначе на карте остаётся призрак), десинк считается только
        // при присланном хеше, выбор чистится по-разному для одиночного и группового,
        // а баннер ожидания снимает тот, кто его поставил.
        netSignatures = [...radarContacts(snap.signatures)];
        // Re-render the open roster only NOW — the new state is in place, so the
        // stance chips and offer affordances (✓ accept / ⏳ pending) paint fresh.
        if (diploShift && diploOpen && diploTab === 'diplo') renderDiplo();
        if (snap.playerId) ME = snap.playerId;
        // Desync check (M0): the server tags each snapshot with hashState(view); we
        // hash our just-reconstructed view and compare. Mismatch ⇒ the client and
        // server disagree — the core invariant we most want to catch on a playtest.
        const verdict = desyncVerdict(snap.hash, () => hashState(snap.state));
        if (verdict !== null) {
          netDesync = verdict;
          if (netDesync) netDesyncCount++;
        }
        // mirror apply()'s selection cleanup (we replace `s` directly here)
        selFleet = keepFocus(selFleet, !!(selFleet && s.fleets[selFleet]));
        selFleets = new Set(keepGroup(selFleets, (id) => s.fleets[id]?.owner, ME));
        // No lobby (SES-2.1): sessions run from creation, a join lands in a live
        // world. `waiting` survives only for the transport's waitForPlayers mode
        // (unused by our hosts) — show the banner, clear it once the clock runs.
        const wait = waitingBanner(!!snap.waiting, banner);
        if (wait === 'show') banner = WAIT_MARK + ' ' + t('net.waiting-host');
        else if (wait === 'clear') banner = null;
        lastPanelHtml = '';
      },
      onRejection: (_id, code) => {
        snd.play('error');
        note('✖ ' + errText(code));
      },
      // Fog-filtered domain events ride each delta (the server already cuts what we
      // may not see): feed them to the SAME pipeline the local sim uses, so battle
      // toasts, AA tracers, siege arcs, loss tallies and the victory banner all work
      // in a network match too. Fired after onSnapshot — `s` is already up to date.
      onEvents: (events) => {
        if (sock !== netSock) return; // a superseded socket must not touch globals
        handleEvents(events);
      },
      // Server-relayed ally pings (own + allies, hidden from enemies): merge them into
      // the coalition channel so they render as map markers + chat lines, same as solo.
      onPingAdded: (ping: MultiplayerPing) => {
        // Что делать с ретранслированной строкой — `relayIntake.ts` (REFM-148): личность
        // строки назначает сервер, своё эхо (и повтор при входе) не удваивает её, а
        // строку, которую нечем показать, не берём вовсе.
        const node = ping.target.node;
        const intake = relayIntake({
          known: sessionMessages.some((m) => m.pingId === ping.id),
          showable: !!node, // prototype markers are province-anchored
        });
        if (intake !== 'add' || !node) return; // `!node` — сужение типа, решает intake
        sessionMessages.push({
          at: ping.createdAt,
          from: ping.owner,
          to: COALITION,
          text: ping.label ?? t('chat.ping.mark', { node }),
          sys: false,
          ping: node,
          pingId: ping.id,
          realAt: Date.now(),
        });
        if (diploOpen && diploTab === 'msgs') renderDiploFeed();
        chatWin.refreshIfVisible();
      },
      onPingRemoved: (pingId: string) => {
        sessionMessages = sessionMessages.filter((m) => m.pingId !== pingId);
        pings.closePop();
        if (diploOpen && diploTab === 'msgs') renderDiploFeed();
      },
      // Server-relayed chat (recipients decided server-side, like fog). Our own lines
      // render from this echo too; the id dedupes a live line vs the join replay.
      onChatMessage: (m: MultiplayerChatMessage) => {
        if (sock !== netSock) return;
        // Тот же разбор, что у меток (`relayIntake.ts`): реплика всегда показуема, но
        // дедуп по серверному id обязателен — эхо своей строки и повтор при входе.
        const known = sessionMessages.some((x) => x.chatId === m.id);
        if (relayIntake({ known, showable: true }) !== 'add') return;
        // Group lines carry the channel key in `to`; a DM keeps its true addressee —
        // convoMessages derives the thread from (from, to) like the solo path.
        const to =
          m.channel === 'session'
            ? CH_SESSION
            : m.channel === 'coalition'
              ? COALITION
              : (m.to ?? m.from);
        sessionMessages.push({
          at: m.at,
          from: m.from,
          to,
          text: m.text,
          sys: false,
          chatId: m.id,
          realAt: Date.now(),
        });
        if (sessionMessages.length > 300) sessionMessages.shift();
        if (m.from !== ME) unreadMsgs++;
        if (diploOpen && diploTab === 'msgs') renderDiploFeed();
        chatWin.refreshIfVisible();
      },
      onError: (code) => {
        // Где игрок увидит отказ — `errorRoute.ts` (REFM-149): отказ устаревшего сокета
        // не наш, отказ после входа идёт тостом (экран подключения уже скрыт), отказ до
        // входа — в строку этого экрана, и причина называется словами, а не кодом.
        const target = errorTarget({ current: sock === netSock, admitted, code });
        if (target === 'ignore') return;
        if (target === 'toast') {
          note('✖ ' + errText(code));
          return;
        }
        // NETA2-1: the server COMPLETED the handshake just to tell us why — a real
        // refusal, not "server down". Say it plainly instead of a generic error.
        const key = admitted ? null : refusalKey(code);
        statusEl.textContent = key ? t(key) : t('net.error', { code });
      },
    },
  ));
  sock.onopen = () => client.open();
  sock.onmessage = (ev) => client.receive(String(ev.data));
  sock.onclose = () => {
    // Что значит это закрытие — `socketFate.ts` (REFM-143): устаревший сокет (игрок
    // нажал «Подключиться» ещё раз) НЕ должен рушить свежую сессию — его позднее
    // закрытие погасило бы её таймеры и выбросило оверлей поверх живой игры.
    const fate = closeAction({
      current: isCurrentSocket(sock, netSock),
      inMatch: NET,
      userClosed,
      reconnecting,
      admitted,
    });
    if (fate === 'ignore') return;
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (perfTimer) {
      clearInterval(perfTimer);
      perfTimer = null;
    }
    rttEma = null;
    if (fate === 'closed-by-user' || fate === 'reconnect') {
      NET = false;
      netAdmitted = false;
    }
    if (fate === 'closed-by-user') {
      statusEl.textContent = 'disconnected';
      note(t('net.disconnected'));
      showConnect(true);
    } else if (fate === 'reconnect') {
      // unexpected drop → auto-rejoin our seat (the match keeps running server-side)
      note(t('net.reconnecting'));
      reconnecting = true;
      scheduleReconnect();
    } else if (fate === 'retry-admit') {
      scheduleReconnect(); // a reconnect attempt failed to admit → back off and retry
    }
    // `keep-reason`: нас не впустили — ответ сервера уже в строке статуса, и стирать
    // его нечем (правило 4); оверлей и так показан.
  };
  sock.onerror = () => {
    if (!isCurrentSocket(sock, netSock)) return; // ошибка устаревшего сокета — не наша
    statusEl.textContent = 'connection failed — is the server running / URL right?';
  };
}

// --- match browser (the meta-shell "Play" tab) -------------------------------
// Reads the server's read-model (`GET /matches?nick=`) into three tabs and joins /
// archives a chosen match. Meta lives on the server (no menu state in GameState).

/** Normalize the pasted server box to a ws(s):// ORIGIN + read the nick. Returns
 *  null (and sets the status line) when either is missing/invalid. Shared by the
 *  match browser and `connect()`. */
function resolveServer(): { base: string; nick: string } | null {
  let raw = srvInput.value.trim();
  if (!raw) {
    statusEl.textContent = t('net.need-address');
    return null;
  }
  // Accept http(s)://, ws(s)://, or a bare host:port and normalize. Kills three
  // silent failures: https page + ws:// (mixed content) → wss://; a pasted /matches
  // path → 404; a bare host with no scheme can't open.
  raw = raw.replace(/^http(s?):\/\//i, 'ws$1://');
  if (!/^wss?:\/\//i.test(raw)) {
    raw = (location.protocol === 'https:' ? 'wss://' : 'ws://') + raw;
  }
  if (location.protocol === 'https:' && raw.startsWith('ws://')) {
    raw = 'wss://' + raw.slice('ws://'.length);
  }
  let base: string;
  try {
    base = `${new URL(raw).protocol}//${new URL(raw).host}`; // drop any path/query
  } catch {
    statusEl.textContent = t('net.bad-address');
    return null;
  }
  const nick = nickInput.value.trim();
  if (!nick) {
    // Silent: the boot block calls this BEFORE anyone has typed anything (to probe
    // /auth/status), so painting a complaint here left «введите позывной» sitting under
    // a freshly opened welcome card. The null return still blocks the caller.
    return null;
  }
  return { base, nick };
}

// MUST stay a hoisted function declaration — NOT a `const` arrow. The boot block
// (~900 lines above) does `await probeAuthMode(...)` during module evaluation, and an
// async body runs synchronously up to its first `await` — so httpBase is CALLED long
// before a `const` on this line would be initialized. esbuild's minifier lowers a
// top-level `const` to `var`, so instead of a loud TDZ error this surfaced in the
// deployed bundle as `TypeError: Kn is not a function`, which rejected the whole boot
// chain: the welcome card never revealed its password field and a `?join=<id>` deep-link
// never reached connectToMatch (the seat was never claimed).

// --- accounts (SES-2.5) -------------------------------------------------------
// With AUTH on the server, the playable path runs the full account flow: the nick
// is a LOGIN, a password guards it, and joining goes register/login → session JWT →
// GET /matches/:id/join → short-lived join token → WS `?token=`. The client
// self-configures from GET /auth/status; without accounts the nick+ticket handshake
// stays exactly as before. The password is never persisted — only the session JWT
// (a revocable, expiring credential) lands in localStorage, keyed per server.
// (`authMode` itself is declared ABOVE the boot block — see the TDZ note there.)
const passRow = document.getElementById('cpassrow') as HTMLElement | null;
const passInput = document.getElementById('cpass') as HTMLInputElement | null;
// Хранилище сессии — в `sessionStore.ts` (REFM-46): там же три правила, каждое из
// которых стоит за конкретной неприятностью — токен привязан к ПОЗЫВНОМУ (семейный
// ноутбук), ключ включает адрес сервера, пароль не хранится никогда.
// Объявления, а не стрелки: обе читаются ВЫШЕ по файлу (boot-блок и рестарт), а
// `const` дал бы обращение в мёртвой зоне — TDZ.
function sessionRecord(base: string): SessionRec | null {
  return readSession(localStorage, base);
}
/** The cached session token for ANY identity on this server (best-effort reads:
 *  arsenal refresh, redial). Auth-critical paths use ensureSession, which checks
 *  the login matches. */
function sessionToken(base: string): string | null {
  return anyToken(localStorage, base);
}

/** Probe the server's identity mode and show/hide the password field. Network
 *  failure ⇒ assume nick mode (the old handshake) — the join itself will surface
 *  a real error if the server actually wants accounts. */
async function probeAuthMode(base: string): Promise<void> {
  const url = `${httpBase(base)}/auth/status`;
  try {
    const res = await fetch(url);
    // A non-OK answer is a normal outcome (a plain static host, an old build, a
    // 404 page): it means «no accounts here», NOT an error to report. Parsing it
    // as JSON is what used to throw — a bare `res.json()` on an HTML 404 body
    // raised an unhandled SyntaxError into the console on the most ordinary path
    // («opened the game off a static server»), drowning out real errors.
    authMode = res.ok && ((await res.json()) as { enabled?: unknown }).enabled === true;
  } catch {
    // Network failure or a non-JSON body ⇒ assume nick mode; the join itself will
    // surface a real error if the server actually wants accounts.
    authMode = false;
  }
  if (passRow) passRow.style.display = authMode ? '' : 'none';
}

// First visit, Bytro-style (SES-2.5 UX): when the server runs accounts, sign-up IS
// the welcome — probe the same-origin default and surface callsign+password on the
// greeting card right away, so a new commander registers before the hub, not deep
// inside the join flow. Probe failure ⇒ nick mode, the card stays as it was.
// The probe ALWAYS runs and is awaited by the welcome buttons (cnew / sign-in), so
// an early tap can't race /auth/status into the guest branch; revealing the form
// applies to first visits only (a remembered nick skipped the welcome card above).
const authProbe: Promise<void> = (async () => {
  const base = srvInput.value.trim();
  if (!base) return;
  await probeAuthMode(base);
  if (!authMode) return;
  if ((localStorage.getItem('void.nick') ?? '').trim()) return; // welcome card was skipped
  if (!wNickInput.value.trim()) wNickInput.value = suggestCallsign();
  wLoginEl.style.display = 'flex';
  wPassRowEl.style.display = 'flex';
})();

/** A valid session JWT for this server, or null (with the status line explaining).
 *  Zero-friction identity: try LOGIN first; unknown-or-wrong is a uniform 401, so
 *  then try REGISTER — a fresh login creates the account (registration IS the first
 *  login), while a taken one (409) means the password was simply wrong. */
async function ensureSession(
  base: string,
  login: string,
  passwordArg?: string,
  emailArg?: string,
): Promise<string | null> {
  // Only OUR OWN cached session counts — a token minted for a different callsign
  // (or a legacy unbound one) is ignored and replaced by a fresh login below.
  const mine = tokenFor(localStorage, base, login);
  if (mine) return mine;
  // Правила логина и пароля — в `authRules.ts` (REFM-47): зеркало серверных, чтобы
  // игрок увидел ПРИЧИНУ, а не сухой одинаковый отказ.
  if (!validLogin(login)) {
    statusEl.textContent = t('acc.nick.rule');
    return null;
  }
  // The password may come from the welcome card (Bytro-style sign-up) or the match
  // browser's field (custom-server joins) — whichever the player actually filled.
  const password = passwordArg ?? (wPassInput.value || (passInput?.value ?? ''));
  if (!validPassword(password)) {
    statusEl.textContent = t('acc.pass.rule');
    return null;
  }
  const call = async (
    path: string,
    extra: Record<string, string> = {},
  ): Promise<{ status: number; token?: string; error?: string }> => {
    const res = await fetch(`${httpBase(base)}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login, password, ...extra }),
    });
    const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
    return { status: res.status, token: body.token, error: body.error };
  };
  try {
    const login1 = await call('/auth/login');
    // Registration carries the optional recovery email (login never needs it).
    const reg = shouldRegister(login1)
      ? await call('/auth/register', emailArg ? { email: emailArg } : {})
      : undefined;
    // Причину называет `authRules.ts` — там же правило «401 на входе + 409 на
    // регистрации = неверный пароль», которое иначе свелось бы к «отказу регистрации».
    const outcome = authOutcome(login1, reg);
    const token = login1.token ?? reg?.token;
    if (token) {
      saveSession(localStorage, base, { login, token });
      if (outcome === 'created') note('✔ ' + t('acc.created'));
      return token;
    }
    statusEl.textContent = t(AUTH_REASON[outcome]);
    return null;
  } catch {
    statusEl.textContent = t('acc.server-down');
    return null;
  }
}

/** Exchange the session for a seat + join token. Клиент запоминает токен для
 *  немедленного коннекта; протухший (15 мин TTL) реконнект просто запрашивает
 *  новый — сессия живёт днями. 401 ⇒ сессия истекла: чистим её и просим пароль. */
async function fetchJoinToken(
  base: string,
  matchId: string,
  session: string,
  slot?: string,
  faction?: string,
): Promise<{ token: string; playerId: string } | null> {
  try {
    // REL-7: pass ?slot= to request a specific seat; ?faction= to override the
    // seat's default faction (BF-30: faction decoupled from start point).
    // Сборку запроса и разбор ответа держит `joinRules.ts` (REFM-48) — там же
    // правило «401 стирает сессию», без которого клиент вечно стучится в дверь
    // просроченным пропуском.
    const res = await fetch(
      `${httpBase(base)}/matches/${encodeURIComponent(matchId)}/join${joinQuery(slot, faction)}`,
      {
        headers: { authorization: `Bearer ${session}` },
      },
    );
    const outcome = joinOutcome(res.status);
    if (outcome !== 'ok') {
      if (dropsSession(outcome)) clearSession(localStorage, base);
      statusEl.textContent = t(JOIN_REASON[outcome]);
      return null;
    }
    return parseJoinPass(await res.json().catch(() => null));
  } catch {
    statusEl.textContent = t('acc.server-down');
    return null;
  }
}

/** The join token for the CURRENT dial attempt (auth mode) — consumed by connect(). */
let pendingJoinToken: string | null = null;
// (`pendingJoinAfterAuth` is declared above the boot block — see the TDZ note there.)

interface MatchRow {
  matchId: string;
  mapId: string;
  rules: MatchRules;
  days: number;
  players: { seated: number; capacity: number };
  status: string;
  /** Entry window (SES-2.3/2.4): can a NEW player still take a free seat here, and how
   *  long is left. Absent on an older server ⇒ treat as always open. */
  entryOpen?: boolean;
  entryClosesInMs?: number;
}

let matchLists: Record<MatchTab, MatchRow[]> | null = null;
let activeTab: MatchTab = 'available';

/** Join a chosen match: set it as the (re)connect target, then dial via `connect()`.
 *  Accounts mode (SES-2.5) first exchanges the session for a join token (register/
 *  login happens lazily inside `ensureSession` on the first join).
 *
 *  If `?join=<id>` arrives without a stored session (no cached JWT in localStorage),
 *  `ensureSession` would silently return — the password row is on the welcome card,
 *  which isn't shown by default. Fix: stash the id in `pendingJoinAfterAuth`, show
 *  the welcome card so the player can register/login, and `welcomeSignIn` resumes
 *  the join automatically on success. */
function connectToMatch(id: string, slot?: string, faction?: string): void {
  currentMatchId = id;
  reconnecting = false;
  reconnectAttempts = 0;
  userClosed = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // Развилка «пустить или послать на вход» — `joinGate.ts` (REFM-140); там же причины,
  // почему просьбу запоминают, почему пароль спрашивают только при известном сервере и
  // почему сессия проверяется наличием, а не совпадением позывного.
  if (!authMode) {
    connect();
    return;
  }
  void (async () => {
    const srv = resolveServer();
    const cached = srv ? sessionRecord(srv.base) : null;
    const next = joinStep({ accountsMode: authMode, serverKnown: !!srv, hasSession: !!cached });
    if (next.step === 'sign-in') {
      askSignIn(id, slot, faction, next.password ? srv : null);
      return;
    }
    const join = await fetchJoinToken(srv!.base, id, cached!.token, slot, faction);
    if (!join) {
      // Токен не выдан: сессии больше нет — вход просрочен, зовём войти заново; сессия на
      // месте — закрыт сам матч, и карточка входа тут ни при чём (правило 4).
      if (afterTokenRefused(!!sessionRecord(srv!.base)) === 'sign-in')
        askSignIn(id, slot, faction, srv);
      return;
    }
    pendingJoinToken = join.token;
    connect();
  })();
}

/**
 * Отправить игрока на карточку входа, ЗАПОМНИВ его просьбу вступить (`joinGate.ts`,
 * правило 1): после успешного входа `welcomeSignIn` доиграет её сам. Строка пароля
 * показывается только при известном сервере (правило 2) — `srv === null` значит «сначала
 * выбери, куда входишь».
 */
function askSignIn(
  id: string,
  slot: string | undefined,
  faction: string | undefined,
  srv: { nick?: string } | null,
): void {
  pendingJoinAfterAuth.remember(id, slot, faction);
  showConnect(false);
  showHub(false);
  showStage('welcome');
  if (!srv) return;
  wNickInput.value = srv.nick || suggestCallsign();
  wPassRowEl.style.display = 'flex';
  wPassInput.focus();
}

// Open a session in its OWN browser tab (deep-link «?join=<id>»): the hub/browser stays in
// THIS tab while the match runs in a fresh one, which boots straight into it from the shared
// same-origin localStorage identity (nick / session JWT).
//
// Audit (2026-07-25): `window.open(..., '_blank')` is silently blocked by most browsers
// for non-direct user-gestures, and the fallback `connectToMatch` then ran with a stale
// `nickInput.value` that didn't match the cached session login — so the welcome card
// re-opened instead of joining. Switch to `location.href` (same-tab navigation): the hub
// is replaced by the game view, no popup, no silent fallback. The hub is one tab-close away
// (the match itself is durable on the server). This matches the APK path (one window).
// REL-7: seat/faction picker — before joining, fetch the match's available seats
// and show a picker. The player chooses a faction/start, then we navigate to
// ?join=<id>&slot=<slotId>. Previously openSessionTab went straight to ?join=
// and the server auto-assigned the first free seat (no choice).
const seatpickEl = $('seatpick') as HTMLElement | null;
const seatpickListEl = $('seatpick-list') as HTMLElement | null;
const seatpickGoEl = $('seatpick-go') as HTMLButtonElement | null;
const seatpickCancelEl = $('seatpick-cancel') as HTMLButtonElement | null;
let seatpickMatchId: string | null = null;
let seatpickSelected: string | null = null;
let seatpickFaction: string | null = null; // BF-30: chosen faction (decoupled from slot)

async function openSeatPicker(matchId: string): Promise<void> {
  const srv = resolveServer();
  if (!srv) return;
  seatpickMatchId = matchId;
  // Чистый выбор на каждый заход и запертая кнопка, пока дом не выбран — `seatJoin.ts`
  // (REFM-152, правила 1–2): уцелевший выбор прошлого матча увёл бы игрока не туда.
  seatpickSelected = null;
  seatpickFaction = null;
  if (seatpickGoEl) seatpickGoEl.disabled = !startEnabled(seatpickSelected);
  if (seatpickListEl)
    seatpickListEl.innerHTML = `<p style="color:var(--dim);text-align:center">${t('seatpick.loading')}</p>`;
  if (seatpickEl) seatpickEl.style.display = 'flex';
  try {
    const res = await fetch(seatsUrl(srv.base, matchId));
    if (!res.ok) throw new Error('http ' + res.status);
    const data = (await res.json()) as {
      seats: Array<{
        playerId: string;
        name: string;
        faction: string;
        start: string | null;
        taken: boolean;
      }>;
    };
    if (seatpickListEl) {
      seatpickListEl.innerHTML = '';
      // The player picks a HOUSE, and the seat comes with it: `seatPicker.ts` (REFM-49)
      // holds the grouping and — importantly — the rule that the slot is the first FREE
      // seat of that house, not simply the first one.
      for (const house of houseRows(data.seats)) {
        const row = document.createElement('div');
        row.className = 'seat-row' + (house.full ? ' taken' : '');
        row.dataset.faction = house.faction;
        const dot = document.createElement('div');
        dot.className = 'seat-dot';
        dot.style.background = houseColor(house.faction);
        const info = document.createElement('div');
        info.className = 'seat-info';
        const name = document.createElement('div');
        name.className = 'seat-name';
        name.textContent = houseName(house.faction);
        const passive = document.createElement('div');
        passive.className = 'seat-faction';
        // The bonus line is a KEY — it has to go through t(), or the player reads
        // «seatpick.bonus.azure» at the exact moment of choosing a house.
        const bonusKey = houseBonusKey(house.faction);
        passive.textContent = bonusKey ? t(bonusKey) : '';
        const slots = document.createElement('div');
        slots.className = 'seat-faction';
        slots.style.fontSize = '10px';
        slots.textContent = t('browser.slots') + ': ' + house.free + '/' + house.total;
        info.appendChild(name);
        info.appendChild(passive);
        if (slots.textContent) info.appendChild(slots);
        const status = document.createElement('div');
        status.className = 'seat-status' + (house.full ? '' : ' free');
        status.textContent = house.full ? t('browser.taken') : t('browser.free');
        row.appendChild(dot);
        row.appendChild(info);
        row.appendChild(status);
        const choice = houseChoice(house);
        if (choice) {
          row.addEventListener('click', () => {
            for (const r of seatpickListEl.querySelectorAll('.seat-row.selected')) {
              r.classList.remove('selected');
            }
            row.classList.add('selected');
            seatpickSelected = choice.slot;
            seatpickFaction = choice.faction; // BF-30: faction chosen independently of start
            if (seatpickGoEl) seatpickGoEl.disabled = !startEnabled(seatpickSelected);
          });
        }
        seatpickListEl.appendChild(row);
      }
    }
  } catch {
    if (seatpickListEl)
      seatpickListEl.innerHTML = `<p style="color:var(--red)">${t('seatpick.load-failed')}</p>`;
  }
}

if (seatpickCancelEl) {
  seatpickCancelEl.addEventListener('click', () => {
    if (seatpickEl) seatpickEl.style.display = 'none';
    seatpickMatchId = null;
  });
}
if (seatpickGoEl) {
  seatpickGoEl.addEventListener('click', () => {
    if (!seatpickMatchId || !seatpickSelected) return;
    const id = seatpickMatchId;
    const slot = seatpickSelected;
    const faction = seatpickFaction;
    if (seatpickEl) seatpickEl.style.display = 'none';
    seatpickMatchId = null;
    // Navigate to ?join=<id>&slot=<slotId>&faction=<faction> — the boot block picks
    // up ?join and connectToMatch fetches the join token with ?slot=&faction= to
    // reserve the chosen seat AND override its faction (BF-30: decoupled from start).
    // Склейку и экранирование держит `seatJoin.ts` (REFM-152): в адрес уходит выбор
    // игрока, а фракции может не быть — тогда её нет и в ссылке.
    location.href = joinHref(location.pathname, id, slot, faction);
  });
}

function openSessionTab(id: string): void {
  // REL-7: show the seat/faction picker first (if the server supports it),
  // otherwise fall back to the direct join (no slot).
  void openSeatPicker(id);
}

async function refreshMatches(quiet = false): Promise<void> {
  const srv = resolveServer();
  if (!srv) return;
  // quiet = a background re-poll (player build): don't flash «загрузка…» over a
  // list that is already on screen — only a real state change repaints.
  if (!quiet) statusEl.textContent = t('browser.loading');
  // Identity mode first (SES-2.5): accounts servers get the password row shown
  // BEFORE the player clicks «Войти» on a row — no surprise prompt mid-join.
  await probeAuthMode(srv.base);
  try {
    const res = await fetch(matchesUrl(srv.base, srv.nick));
    if (queryOutcome(res) !== 'ok') throw new Error('http ' + res.status);
    matchLists = (await res.json()) as Record<MatchTab, MatchRow[]>;
    localStorage.setItem('void.server', srv.base);
    localStorage.setItem('void.nick', srv.nick);
    statusEl.textContent = '';
  } catch {
    matchLists = null;
    statusEl.textContent = t('acc.server-down');
  }
  renderMatches();
}

async function toggleArchive(id: string, restore: boolean): Promise<void> {
  const srv = resolveServer();
  if (!srv) return;
  // Адреса и разбор исхода — `matchQuery.ts` (REFM-150): всё уходящее в адрес
  // экранируется, а «сервер ОТВЕТИЛ отказом» и «до сервера не дошли» — разные беды и
  // разные сообщения: первую повторять бессмысленно, вторую как раз стоит.
  try {
    const res = await fetch(archiveUrl(srv.base, id, srv.nick, restore), { method: 'POST' });
    if (queryOutcome(res) === 'refused') {
      statusEl.textContent = restore ? t('browser.restore-failed') : t('browser.archive-failed');
      return;
    }
    await refreshMatches();
  } catch {
    statusEl.textContent = t('browser.archive-error');
  }
}

function renderMatches(): void {
  const el = $('mlist');
  const failed = statusEl.textContent === t('acc.server-down');
  // Что показать вместо списка — `browserFallback.ts` (REFM-151): никогда не тупик
  // (соло предлагается всегда — это путь без сервера), «сервер не ответил» и «ещё не
  // спрашивали» — разные сообщения, у сборки игрока свои тексты, а строка адреса
  // всплывает ровно пока список не загрузился.
  const состояние = { loaded: !!matchLists, failed, playerBuild: __PLAYER_BUILD__ };
  if (__PLAYER_BUILD__) {
    // The player screen is ONLY the three tabs + the list. The hidden server row
    // resurfaces exactly while the list can't be loaded (an APK has no useful page
    // origin — the player types the host's address once, then it hides again), and
    // the status line is not duplicated under the list's own message.
    const srvRow = srvInput.closest('.cfield') as HTMLElement | null;
    if (srvRow) srvRow.style.display = showServerRow(true, состояние.loaded) ? '' : 'none';
    if (clearStatusLine(true, failed)) statusEl.textContent = '';
  }
  // Never a dead end: whatever the server says (unreachable / empty list), the dev
  // client offers the path that ALWAYS works — a solo skirmish offline. The player
  // build has no single-player, so it states the situation honestly instead.
  const soloCard = (msg: string): void => {
    el.innerHTML =
      `<div class="mempty">${msg}</div>` +
      `<div class="msolo"><button class="mbtn" id="msolo-go">▶ ${t('browser.solo')}</button>` +
      `<div class="msolo-sub">${t('browser.solo.hint')}</div></div>`;
    document.getElementById('msolo-go')?.addEventListener('click', () => {
      userClosed = true;
      NET = false;
      netAdmitted = false;
      openSetup('hub');
    });
  };
  const rows = matchLists?.[activeTab] ?? [];
  const план = fallbackFor({ ...состояние, rows: rows.length });
  if (план.kind === 'empty') {
    soloCard(t(план.message));
    return;
  }
  el.textContent = '';
  for (const m of rows) {
    const row = document.createElement('div');
    row.className = 'mrow';
    const info = document.createElement('div');
    info.className = 'minfo';
    // Entry window (SES-2.4): on «Доступные», show how long a newcomer may still take a
    // seat — the server already drops fully-closed sessions from this tab, so an open
    // countdown reassures, a soon-to-close one nudges. Unbounded (dev / old server) or
    // other tabs: omitted. Own «Активные»/«Архив» rows don't gate a reconnect, so no
    // window there.
    const win = joinWindow(m, activeTab);
    let windowLine = '';
    if (win.kind === 'closed') {
      windowLine = ` · <span class="mwin shut">${t('acc.join-closed')}</span>`;
    } else if (win.kind === 'open') {
      windowLine = ` · <span class="mwin${win.soon ? ' soon' : ''}">${t('browser.join-window', { dur: fmtJoinWindow(win.left) })}</span>`;
    }
    info.innerHTML =
      `<div class="mname">${esc(m.mapId)} <span class="mid">${esc(m.matchId)}</span></div>` +
      `<div class="mmeta">${t('browser.day', { n: m.days })} · ${t('browser.players', { s: m.players.seated, c: m.players.capacity })} · ` +
      `${esc(ruleSummary(m.rules))} · ${m.status === 'ended' ? t('browser.finished') : t('browser.running')}${windowLine}</div>`;
    row.appendChild(info);
    const btns = document.createElement('div');
    btns.className = 'mbtns';
    const join = document.createElement('button');
    join.className = 'mbtn';
    join.textContent = t('browser.join');
    join.addEventListener('click', () => openSessionTab(m.matchId));
    btns.appendChild(join);
    const action = rowAction(activeTab);
    if (action) {
      const restore = action === 'restore';
      const arch = document.createElement('button');
      arch.className = 'mbtn ghost';
      arch.textContent = restore ? t('browser.restore') : t('browser.archive');
      arch.addEventListener('click', () => void toggleArchive(m.matchId, restore));
      btns.appendChild(arch);
    }
    row.appendChild(btns);
    el.appendChild(row);
  }
}

for (const btn of Array.from(document.querySelectorAll('.mtab'))) {
  btn.addEventListener('click', () => {
    activeTab = ((btn as HTMLElement).dataset.tab as MatchTab) ?? 'available';
    for (const b of Array.from(document.querySelectorAll('.mtab'))) {
      b.classList.toggle('active', b === btn);
    }
    renderMatches();
  });
}

// "Обновить список" reloads the read-model; per-row "Войти"/"В архив" act on a match.
$('cgo').addEventListener('click', () => void refreshMatches());

// Player build: the match screen is ONLY the tabs + list (Доступные/Активные/Архив).
// The callsign comes from the welcome/hub identity step and the server from the page
// origin, so their rows are noise here — hidden, NOT removed: the inputs stay in the
// DOM as the state carriers resolveServer() reads. The server row resurfaces from
// renderMatches only while the list can't be loaded (see there). With no «Обновить
// список» button, the open screen keeps itself fresh instead: a quiet 10s re-poll
// plus an immediate reload when the player edits the server address.
if (__PLAYER_BUILD__) {
  const browseEl = $('cbrowse');
  const hide = (n: Element | null): void => {
    if (n) (n as HTMLElement).style.display = 'none';
  };
  hide(browseEl.querySelector('.csub'));
  hide(nickInput.closest('.cfield'));
  hide(srvInput.closest('.cfield'));
  hide($('cgo').closest('.crow'));
  srvInput.addEventListener('change', () => void refreshMatches());
  setInterval(() => {
    if (connectEl.style.display === 'none') return; // overlay closed (hub / in match)
    if (browseEl.style.display === 'none') return; // welcome stage, not the browser
    void refreshMatches(true);
  }, 10_000);
}

// The match browser (stage 2) loads its list on entry — "Новый командир" / "Вход"
// call refreshMatches() themselves; nothing to prefetch while the clean welcome is up.

// Auto-reconnect after an unexpected drop: rejoin our seat with capped exponential backoff
// (1,2,4,8,8,… s). The budget (`reconnectDelayMs`, NETA2-2) OUTLASTS the server's ~30s
// socket-reap window on purpose — a reconnect within the reap must not give up before the
// old socket frees the seat (else it loses the race with `E_SLOT_TAKEN`). Same saved
// server + nick → same side.
function scheduleReconnect(): void {
  // Политика цикла — `reconnectCycle.ts` (REFM-145): одна назначенная попытка за раз (к
  // одному обрыву приходит несколько сигналов), счётчик растёт сквозь дозвоны, а
  // исчерпанный бюджет заканчивается честной сдачей, а не молчанием.
  const step = nextCycleStep({ timerPending: !!reconnectTimer, attempts: reconnectAttempts });
  if (step.kind === 'busy') return;
  reconnectAttempts++;
  if (step.kind === 'give-up') {
    reconnecting = false;
    reconnectAttempts = 0;
    banner = null;
    statusEl.textContent = t('acc.reconnect-failed');
    showConnect(true);
    return;
  }
  banner = t('acc.reconnecting');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    // Accounts mode (SES-2.5): the join token is short-lived (15 min), so a redial
    // mints a fresh one off the long-lived session first; an expired session drops
    // the redial to the connect screen with «введите пароль» (fail-explicit).
    const srv = authMode ? resolveServer() : null;
    const session = srv ? sessionToken(srv.base) : null;
    const plan = redialPlan(authMode, !!session);
    if (plan === 'dial') {
      connect(); // reuse the saved server + nick; don't reset the attempt counter
      return;
    }
    if (plan === 'mint-token' && srv && session) {
      void (async () => {
        const join = await fetchJoinToken(srv.base, currentMatchId, session);
        if (!join) {
          scheduleReconnect(); // transient (or session expired — status line explains)
          return;
        }
        pendingJoinToken = join.token;
        connect();
      })();
      return;
    }
    reconnecting = false; // сессии нет — на экран входа, а не в новый круг попыток
    banner = null;
    showConnect(true);
  }, step.delayMs);
}

// --- loop --------------------------------------------------------------------

const fpsEl = $('fps');
// Dev FX lab (dev client + DEV_UI only): push a demo siege volley between two nodes
// without staging a real standoff duel — for design review and the FX screenshot
// tests. Compiled out of the player build (dev tooling, not diagnostics).
if (!__PLAYER_BUILD__ && DEV_UI && typeof window !== 'undefined') {
  (window as unknown as { __vdFx?: object }).__vdFx = {
    // e2e probe: page-space anchors of own fleets and all worlds — lets a browser
    // test tap real map objects without guessing coordinates. Dev chrome, read-only.
    probe(): {
      fleets: Array<{ id: string; x: number; y: number }>;
      worlds: Array<{ id: string; x: number; y: number; owner: string | null }>;
    } {
      const r = canvas.getBoundingClientRect();
      const sx = (p: { x: number; y: number }) => toScreen(p, r, VW, VH);
      return {
        fleets: Object.values(s.fleets)
          .filter((f) => f.owner === ME)
          // fleetAnchor is null for a fleet with no drawable position — skip it
          .flatMap((f) => {
            const a = fleetAnchor(f);
            return a ? [{ id: f.id, ...sx(a) }] : [];
          }),
        worlds: Object.values(s.planets).map((p) => ({
          id: p.id,
          owner: p.owner,
          ...sx(world(p.position)),
        })),
      };
    },
    // Stock the first own fleet with hold cargo (squadrons in the hold + landing
    // troops + a fake in-progress load) so the emblem's cargo tail can be previewed
    // without building a carrier — dev chrome, mutates local state only.
    stockFleet(): string | null {
      const f = Object.values(s.fleets).find((x) => x.owner === ME);
      if (!f) return null;
      const wing = f.units.find((st) => isSquadron(st.unit));
      if (wing) wing.count += 2;
      else f.units.push({ unit: 'fighter_squadron', count: 2 });
      (f.landing ??= []).push({ unit: 'militia', count: 2 });
      pendingLoads.push({
        fleetId: f.id,
        unit: 'fighter_squadron',
        startAt: s.time,
        doneAt: s.time + LOAD_TIME,
      });
      return f.id;
    },
    pushSiege(fromId: string, toId: string): boolean {
      const a = s.planets[fromId]?.position;
      const b = s.planets[toId]?.position;
      if (!a || !b) return false;
      siegeShots.push({ from: { ...a }, to: { ...b }, at: performance.now(), seed: siegeSeed++ });
      return true;
    },
    // Open a hero corridor between two nodes so its overlay (blinking one-shot vs
    // timed lane) can be looked at without levelling a hero and casting for real.
    openCorridor(fromId: string, toId: string, tier: number): boolean {
      if (!s.planets[fromId] || !s.planets[toId]) return false;
      (s.tempLanes ??= []).push({
        id: `lane:dev:${s.tempLanes.length}`,
        owner: ME,
        from: fromId,
        to: toId,
        speedBonus: 0.5,
        expiresAt: s.time + 6 * HOUR,
        addedLink: true,
        tier,
      });
      return true;
    },
    // Preview the capture wave over a province without staging a real ground battle.
    flashCapture(node: string, owner: string): boolean {
      if (!s.planets[node]) return false;
      captureFlashes.set(node, { owner, at: performance.now() });
      return true;
    },
    // Force the match to a terminal state so the end screen can be previewed without
    // grinding to a score/elimination win. Seeds a plausible score if the victory
    // module hasn't populated one yet; checkEnd then paints the overlay.
    endMatch(outcome: 'win' | 'lose' | 'draw'): boolean {
      const m = s.match;
      if (!m) return false;
      m.status = 'ended';
      m.reason = 'score';
      m.endedAt = s.time;
      m.winner = outcome === 'draw' ? null : outcome === 'win' ? ME : ME === 'p1' ? 'p2' : 'p1';
      m.scores ??= {};
      for (const id of Object.keys(s.players)) {
        m.scores[id] ??= {
          controlledPlanets: worldsOf(id),
          fleets: 0,
          units: 0,
          total: worldsOf(id) * 50,
        };
      }
      return true;
    },
  };
}
let fpsEma = 60; // smoothed frames-per-second readout
let lastFpsText = '';
let lastTechAt = 0; // throttle for live re-rendering the tech window while it's open
let lastReal = performance.now();
// Build tag for the dev overlay so the RUNNING build is always visible in-game (not just
// on the welcome screen) — makes "am I on the latest APK?" answerable at a glance. Empty
// in the browser / dev build (no baked __BUILD__).
const BUILD_TAG = (() => {
  const b = currentBuild();
  return b ? buildLabel(b) : '';
})();
// --- Android Back / Escape = close the top UI layer (APK + desktop) -----------
// The APK's WebView maps the hardware Back to history.back(); desktop maps Escape
// (below). While ANY closable layer is open — OR a match is simply live — we keep
// ONE sentinel entry pushed: Back pops the sentinel (popstate), we close the
// topmost layer and re-arm. With nothing left to close AND a match running, the
// first Back only shows a "press again to leave" hint (BF-17-adjacent: a bare
// in-match Back used to silently unload the page and lose the solo match); a
// second Back within the window leaves the match OURSELVES (`$('tomenu').click()`).
// BF-31: this used to leave the second Back to "the system" (assume the platform's
// own back-stack falls through to an app exit once our history is exhausted) — but a
// plain browser tab (or some WebViews) just has nowhere left to go and no-ops
// instead, so "press again" silently did nothing. Re-arming the sentinel right after
// the hint guarantees a real second `popstate` to catch, so the exit never depends
// on the platform's fallback. Browser Back is the same.
let backArmed = false;
// Double-back-to-leave window: a second Back within this long of the hint leaves the
// match; after it lapses, a bare Back is the first press again (a fresh hint).
// `performance.now()` is fine here (prototype UI, not the deterministic core).
const BACK_EXIT_WINDOW_MS = 2500;
let backHintAt = -Infinity;

/** In a live match (the map backdrop), i.e. none of the chrome SCREENS is up. The
 *  three toggle `display` between 'flex'/'none'; on a fresh boot they read '' (CSS
 *  default) ≠ 'none', so this is false until the player actually enters a match —
 *  exactly when Back must stop silently unloading the page. */
function inMatch(): boolean {
  return (
    connectEl.style.display === 'none' &&
    hubEl.style.display === 'none' &&
    setupEl.style.display === 'none'
  );
}

// BACK-1: лестница слоёв — ДАННЫЕ, а не цепочка `if`. Порядок = визуальная стопка
// сверху вниз (z-index из build.mjs указан у каждой ступени), поэтому Back закрывает
// ровно то, что игрок видит верхним. Раньше порядок был «взведённые режимы вперёд», и
// при открытом окне поверх карты первый Back гасил невидимый прицел, а не окно.
//
// Полноту держит сторож `backLayers.test.ts`: каждый оверлей из CSS обязан быть в описи
// `LAYER_INVENTORY` слоем или не-слоем с причиной, а каждый слой описи — ступенью здесь.
// Опись нашла 37 оверлеев; 29 из них Back не видел вовсе.
//
// ЛОВУШКА ПРОБЫ. У экранов с инлайновым display сравниваем строго с 'flex', а НЕ
// `!== 'none'`: до первого открытия инлайновый стиль пуст (''), и «не none» залипло бы
// в «открыто» — Back бесконечно «закрывал» бы невидимый слой и никогда не дошёл до
// выхода из матча. Исключение — #setup: он ставит display явно на обеих ветках.
const shown = (id: string): boolean => document.getElementById(id)?.classList.contains('show') === true;
const hide = (id: string): void => document.getElementById(id)?.classList.remove('show');
const flexed = (id: string): boolean => document.getElementById(id)?.style.display === 'flex';

const BACK_LAYERS: BackLayer[] = [
  // --- модалки поверх всего (z60…z57) ---
  { id: 'corp', isOpen: () => flexed('corp'), close: () => corp.close() }, // z60
  { id: 'scipick', isOpen: () => shown('scipick'), close: () => hide('scipick') }, // z60
  { id: 'emblempick', isOpen: () => shown('emblempick'), close: () => hide('emblempick') }, // z60
  { id: 'settings', isOpen: () => shown('settings'), close: () => hide('settings') }, // z59
  // dev-оверлеи: в плеерной сборке узлов нет, проба просто всегда false
  { id: 'testmode', isOpen: () => flexed('testmode'), close: () => hideFlex('testmode') }, // z59
  { id: 'sandbox', isOpen: () => flexed('sandbox'), close: () => hideFlex('sandbox') }, // z59
  { id: 'intro', isOpen: () => shown('intro'), close: () => hide('intro') }, // z58
  { id: 'seatpick', isOpen: () => flexed('seatpick'), close: () => seatpickCancelEl?.click() }, // z58
  { id: 'recap', isOpen: () => shown('recap'), close: () => hide('recap') }, // z57
  { id: 'profile', isOpen: () => shown('profile'), close: () => profile.close() }, // z57
  // --- окна и карточки (z51…z44) ---
  { id: 'rescard', isOpen: () => resCardEl.classList.contains('show'), close: () => resCardEl.classList.remove('show') }, // z51
  // Обучающий тур (ONB-1): его панели глотают клики, так что без этой ступени игрок в
  // туре заперт. Проба идёт по ЖИВОСТИ тура, а не только по узлу: если stop() почему-то
  // не уберёт подсветку, лестница всё равно не залипнет в «открыто».
  {
    id: 'spotlight',
    isOpen: () => activeTour?.active === true && document.getElementById('spotlight') !== null,
    close: () => activeTour?.stop(), // ровно кнопка «Пропустить»
  }, // z50
  {
    id: 'playercard',
    isOpen: () => shown('playercard'),
    close: () => {
      const el = document.getElementById('playercard');
      el?.classList.remove('show');
      // Место чужого игрока обязано уйти вместе с карточкой: делегат кликов читает
      // dataset.seat, и забытое значение увело бы следующее открытие СВОЕЙ карточки
      // в ветку дипломатии по чужому месту.
      if (el) delete el.dataset.seat;
    },
  }, // z50
  { id: 'diplo', isOpen: () => diploOpen, close: () => closeDiplo() }, // z49
  // Проба по состоянию, а не по классу: `warPrompt` — источник истины, класс лишь его
  // отражение. Back здесь обязан вести в ОТМЕНУ: подтверждение объявляет войну, и вешать
  // необратимое действие на аппаратную кнопку нельзя.
  { id: 'warprompt', isOpen: () => warPrompt !== null, close: () => cancelWarPrompt() }, // z48
  { id: 'pingmenu', isOpen: () => pings.menuOpen(), close: () => pings.closeMenu() }, // z47
  { id: 'tech', isOpen: () => techWin.classList.contains('show'), close: () => techWin.classList.remove('show') }, // z47
  { id: 'steward', isOpen: () => stewWin?.classList.contains('show') === true, close: () => stewWin?.classList.remove('show') }, // z47
  { id: 'market', isOpen: () => marketWin.classList.contains('show'), close: () => marketWin.classList.remove('show') }, // z47
  { id: 'constructor', isOpen: () => constructorWin.classList.contains('show'), close: () => shipyard.close() }, // z47 «Верфь»
  { id: 'codex', isOpen: () => codexEl?.classList.contains('show') === true, close: () => codexEl?.classList.remove('show') }, // z46
  // «Постройки» стоят НИЖЕ кодекса (z45): карточка здания открывается поверх окна,
  // и Back обязан сначала закрыть её, а уже потом само окно.
  { id: 'buildwin', isOpen: () => buildWinEl.classList.contains('show'), close: () => buildWinEl.classList.remove('show') }, // z45 «Постройки»
  // Двухступенчатый Back режима «Приказ» (CHAIN-UX): сперва меню точки…
  {
    id: 'tgted',
    isOpen: () => chainMode?.menu != null,
    close: () => {
      if (chainMode) chainMode.menu = null;
      hide('tgted');
    },
  }, // z46
  { id: 'logwin', isOpen: () => logWin?.classList.contains('show') === true, close: () => logWin?.classList.remove('show') }, // z46
  { id: 'codexhub', isOpen: () => shown('codexhub'), close: () => hide('codexhub') }, // z45
  { id: 'pingpanel', isOpen: () => pings.panelOpen(), close: () => pings.closePanel() }, // z60
  { id: 'pingpop', isOpen: () => shown('pingpop'), close: () => pings.closePop() }, // z45
  { id: 'splitdlg', isOpen: () => splitState !== null, close: () => { splitState = null; lastPanelHtml = ''; } }, // z45
  // --- низ экрана (z27…z20) ---
  { id: 'chatwin', isOpen: () => chatWin.isOpen(), close: () => chatWin.close() }, // z27
  // Поповеры ряда команд живут ВНУТРИ #cmdbar: прячет их ближайший renderCmdBar, но
  // кэш разметки надо сбить руками, иначе строка не изменится и DOM останется прежним.
  {
    id: 'cmdbar',
    isOpen: () => troopsPlan !== null || fireMenu || castMenu,
    close: () => {
      troopsPlan = null;
      fireMenu = false;
      castMenu = false;
      lastCmdHtml = '';
    },
  }, // z26
  // …а вторым Back — сам режим (черновик выбрасывается, живые планы не тронуты).
  { id: 'chain', isOpen: () => chainMode !== null, close: () => exitChainMode() },
  {
    id: 'aim',
    isOpen: () => aiming || assaultAim || merging || barrageAim,
    close: () => {
      aiming = false;
      assaultAim = false;
      merging = false;
      barrageAim = false;
      lastPanelHtml = '';
    },
  },
  // Раскрытая панель инструментов рельсы: на телефоне она занимает пол-экрана, а CSS-опись
  // её не видит — узел живёт всегда, раскрытость это класс `.open` (см. EXTRA_LAYERS).
  { id: 'rail', isOpen: () => railEl.classList.contains('open'), close: () => setRailOpen(false) }, // z26
  { id: 'side', isOpen: () => selFleet !== null || selPlanet !== null || selFleets.size > 0, close: () => clearSelection() }, // z20
  // Экран настройки матча — последняя ступень: это не слой поверх матча, а сам экран,
  // и у него свой путь назад (в хаб / на экран входа).
  {
    id: 'setup',
    isOpen: () => setupEl.style.display !== 'none',
    close: () => ($('setupcancel') as HTMLButtonElement | null)?.click(),
  }, // z58
];

/** Спрятать оверлей с инлайновым display (dev-панели ставят его вручную). */
function hideFlex(id: string): void {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

/** Is any layer open that the Back button should close (probe only)? */
function topLayerOpen(): boolean {
  return layersOpen(BACK_LAYERS);
}

/** Close the TOPMOST open layer; returns false when nothing was open. Порядок —
 *  в `BACK_LAYERS` выше (визуальная стопка), сама лестница — в `backLayers.ts`. */
function closeTopLayer(): boolean {
  return closeTop(BACK_LAYERS) !== null;
}

window.addEventListener('popstate', () => {
  backArmed = false;
  if (closeTopLayer()) {
    snd.play('close'); // обратный блип: слой закрылся аппаратным Back
    if (topLayerOpen() || inMatch()) armBack(); // more layers / still in a match — stay
    return;
  }
  if (inMatch()) {
    // Nothing left to close but a match is live — don't let one stray Back drop it.
    // A second Back within the window leaves for real; re-arm so THAT press always
    // fires its own popstate here rather than possibly running out of history.
    if (performance.now() - backHintAt <= BACK_EXIT_WINDOW_MS) {
      $('tomenu').click();
      return;
    }
    backHintAt = performance.now();
    note(t('back.confirm.match'));
    armBack();
    return;
  }
  note(t('back.confirm')); // at the hub/welcome — the next Back exits
});
function armBack(): void {
  if (backArmed) return;
  history.pushState({ layer: true }, '');
  backArmed = true;
}

// Desktop parity: Escape closes the topmost layer, exactly like Back. Ignored while
// typing (chat / nick / server inputs) so Escape still blurs a field the native way.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' && e.key !== 'Esc') return;
  const el = e.target as HTMLElement | null;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (closeTopLayer()) {
    snd.play('close');
    e.preventDefault();
  }
});

function frame(nowReal: number) {
  // Keep the Back sentinel armed while something is closable OR a match is live, so a
  // bare in-match Back triggers the double-back hint instead of a silent unload. The
  // popstate handler re-arms itself right after a hint (so a genuine second Back
  // always has its own sentinel to pop) — this is the initial arm / self-healing net,
  // not the steady-state path, hence gating on being past the exit window.
  const matchGuard = inMatch() && performance.now() - backHintAt > BACK_EXIT_WINDOW_MS;
  if (!backArmed && (topLayerOpen() || matchGuard)) armBack();
  const dt = nowReal - lastReal;
  lastReal = nowReal;
  // Правдоподобие разрыва, ход мира и сдвиг времени — `simClock.ts` (REFM-87).
  // smooth FPS; ignore absurd gaps (tab backgrounded) so the readout stays sane
  if (saneGap(dt)) fpsEma = fpsNext(fpsEma, dt);
  if (simRuns(NET, speed, !!banner, !!endScreen)) {
    // Local single-player sim. In net mode the server owns the clock, combat,
    // construction and every rival — a connected human, or the server-side AI for
    // an empty seat — so we only render its snapshots (no local AI runs here).
    // A finished match (endScreen set) freezes the world — no advancing a decided game.
    // Время растёт от РЕАЛЬНОГО, помноженного на скорость: при просадке FPS мир идёт
    // с той же быстротой, а не медленнее (правило 3).
    const target = advanceTarget(s.time, dt, speed, HOUR);
    apply(advance(s, target));
    solo.autoEngage();
    pumpAssaultOrders();
    solo.checkFleetClashes();
    solo.drivePatrols(); // CC-4: дежурные вылеты бьют контакты в радиусе
    solo.driveChains(); // CC-1: продвинуть цепочки приказов (ждать → курс → штурм/обстрел)
    solo.runAI();
    pumpBuildQueues();
    closeIdleRallies(); // drop the 'rally' tag once a world's build pipeline empties
  }
  // Aimed ШТУРМ resolves in net too: the server drives fleet travel and the arrival
  // battle, and the client issues the ground assault once the fleet is parked on the
  // target world. (Solo pumps it inside the sim block above; in both modes assaultOnArrival
  // stays empty until a ШТУРМ is actually aimed, so this is a no-op otherwise.)
  if (NET) pumpAssaultOrders();
  updateGoals(); // ONB-7: tick the first-session checklist off live state (no-op when idle)
  // The orbit spin only advances while the world is actually running (sim ticking, or a
  // live net match), so pausing freezes the ships on their rings instead of drifting on.
  if (saneGap(dt) && spinRuns(NET, speed, !!banner)) orbitPhase += dt;
  pumpPendingLoads(); // fire ~1h cargo loads whose hour has elapsed (both modes)
  resolvePendingMerges(); // complete fleet merges whose movers have arrived
  // Итог матча приходит в ОБОИХ режимах (сетевые снимки несут его в `match`).
  const ended = matchEnd.check();
  if (ended) endScreen = ended;
  // SANDBOX — fenced hook. Hold the "immortal home" + "frozen queues" toggles every
  // solo frame (paused or not); the whole feature no-ops outside a sandboxed solo match.
  // Leading `!__PLAYER_BUILD__` lets esbuild tree-shake the sandbox out of the player bundle.
  if (!__PLAYER_BUILD__ && !NET && sandboxConfig.enabled) enforceSandbox(s, ME, sandboxHomeId);
  // SANDBOX — fenced hook. The "fog of war" toggle defaults ON; turning it OFF drops the
  // fog projection (null vision ⇒ everything is `known`, mirroring the dev reveal).
  vision =
    !__PLAYER_BUILD__ && !NET && sandboxConfig.enabled && !sandboxConfig.fog
      ? null
      : computeVision(); // fog projection for this frame
  if (vision) updateMemory(vision.identify); // variant B: remember what we see
  // BF-30: in net mode, don't render the map until the server's welcome snapshot
  // has arrived and ME is set to the correct seat — otherwise the default `ME = 'p1'`
  // paints a spawn at p1's start before the server assigns the real seat.
  if (NET && !netAdmitted) {
    // show a blank canvas + the connect overlay (already shown by showConnect(true))
  } else {
    render(nowReal);
    renderPanel();
    renderCmdBar();
    renderSplitDialog();
  }
  // Status strip below the top bar: the in-game clock plus the donate currency
  // (Суверены ◆) pushed to the right end — one level down from the resource row.
  // Day + countdown live in the #daycard, victory progress in the #tbscore chip
  // (row 1 of the bar, below). (World/fleet counts stay on the player card.)
  const statusHtml =
    `<span id="clock">${clockHM(s.time)}</span>` +
    `<span class="dl-donate" title="${t('hub.sovereigns')}"><i>${SOV_SVG}</i>${kfmt(SOVEREIGNS)}</span>`;
  if (statusHtml !== lastClockText) {
    devlineEl.innerHTML = statusHtml;
    lastClockText = statusHtml;
  }
  // Top-bar row 1: nick + live standing («N-е из M» — the end-screen ranking formula
  // over the LIVE scores), the ✦ victory chip in the middle gap, and the day card
  // with a countdown to the next game day. Fixed nodes are patched by textContent
  // (no innerHTML rebuild — the crest/who/dstat click targets stay put).
  const d = floor(s.time / DAY) + 1;
  const score = Math.round(s.match?.scores?.[ME]?.total ?? 0);
  const need = Math.max(0, SCORE_LIMIT - score);
  const sc = s.match?.scores ?? {};
  const ranked = Object.keys(sc).sort((a, b) => (sc[b]?.total ?? 0) - (sc[a]?.total ?? 0));
  const myPlace = ranked.indexOf(ME) + 1;
  // identity line = the commander's callsign; solo seats are named after the HOUSE
  // (buildSetupConfig), so an empty callsign falls back to that seat name
  const nick = nickInput.value.trim() || NAME[ME] || '';
  const eta = countdownHMS(DAY - (s.time % DAY));
  const topText = `${nick}${myPlace}/${ranked.length}${score}${d}${eta}`;
  if (topText !== lastTopText) {
    tbName.textContent = nick;
    // no scored seats yet (match module absent / pre-start) → no standing line
    tbPlace.textContent = myPlace >= 1 ? t('hud.place', { p: myPlace, n: ranked.length }) : '';
    tbScore.textContent = `✦ ${score}/${SCORE_LIMIT}`;
    tbScore.classList.toggle('win', need === 0);
    tbDay.textContent = t('browser.day', { n: d });
    tbEta.textContent = t('hud.next-day', { t: eta });
    lastTopText = topText;
  }

  // FPS + net overlay: FPS; when connected, append round-trip latency and a
  // desync flag (✓ in sync with the server, ✗ + running mismatch count if not).
  // Shown when the player opts in (Settings → FPS), forced on for dev chrome
  // (DEV_UI) and on a live desync — which everyone must be able to see and report.
  if (showFpsOn() || DEV_UI || (NET && netDesync)) {
    let fpsText = `${Math.round(fpsEma)} FPS`;
    if (NET) {
      const rtt = rttEma === null ? '· · ms' : `${Math.round(rttEma)} ms`;
      const sync = netDesync ? `desync ✗ ${netDesyncCount}` : 'sync ✓';
      fpsText += ` · ${rtt} · ${sync}`;
    }
    if (BUILD_TAG) fpsText += ` · ${BUILD_TAG}`; // running build, visible in dev
    if (fpsText !== lastFpsText) {
      fpsEl.textContent = fpsText;
      fpsEl.style.color = NET && netDesync ? 'var(--red, #ff5a4d)' : '';
      lastFpsText = fpsText;
    }
  } else if (lastFpsText !== '') {
    fpsEl.textContent = '';
    lastFpsText = '';
  }
  // Top bar = the five session resources (icon + amount). The donate currency (Суверены ◆)
  // is rendered separately on the status line right under this bar (see statusHtml above).
  const r = s.players[ME]?.resources ?? {};
  // Inline-SVG line icons (RES_SVG) — pixel-true to the mock, tinted via
  // currentColor. Name in `title` for hover/long-press.
  // Flow under the stock: the tested netIncome() (production − upkeep, per hour)
  // finally shown to the player. A resource with no stock AND no flow is dimmed —
  // it plays no part in the current match yet.
  const inc = netIncome(s, ME);
  const myArrears = s.players[ME]?.arrears ?? [];
  const chip = (icon: string, key: string) => {
    const stock = r[key] ?? 0;
    const raw = inc[key] ?? 0;
    // Building/army upkeep makes sub-1/h drains common — one decimal keeps a slow
    // bleed visible instead of rounding it to a lying zero.
    const flow = Math.abs(raw) >= 1 ? Math.round(raw) : Math.round(raw * 10) / 10;
    // A phone bar has no room for flow digits: the chip carries only the stock, a
    // negative net flow paints that stock red, and the exact rate lives behind a tap
    // (the #purse click handler). Desktop keeps the inline ±N/ч readout.
    const flowTxt =
      !MOBILE && flow !== 0
        ? `<em class="${flow > 0 ? 'up' : 'dn'}">${flow > 0 ? '+' : ''}${Math.abs(flow) >= 1 ? kfmt(flow) : flow}/ч</em>`
        : '';
    const dead = stock === 0 && flow === 0 ? ' dead' : '';
    // Unpaid upkeep on this resource → the chip flags the brownout (tap it for words).
    const short = myArrears.includes(key) ? ' short' : '';
    const bleed = MOBILE && flow < 0 ? ' class="neg"' : '';
    return `<span class="res${dead}${short}" title="${t(`hud.resource.${key}`)}" data-res="${key}"><i>${icon}</i><span class="rv"><b${bleed}>${kfmt(stock)}</b>${short ? '<em class="dn">⚠</em>' : flowTxt}</span></span>`;
  };
  // Capsule icons = RES_SVG (line art traced from the mock; TECH_CUR keeps the text
  // glyphs for prose); capsule order follows the mock: coins, cube, sprout, bolt, chip.
  const hudHtml =
    chip(RES_SVG['credits']!, 'credits') +
    chip(RES_SVG['metal']!, 'metal') +
    chip(RES_SVG['food']!, 'food') +
    chip(RES_SVG['energy']!, 'energy') +
    chip(RES_SVG['microelectronics']!, 'microelectronics');
  if (hudHtml !== lastHudHtml) {
    purse.innerHTML = hudHtml;
    lastHudHtml = hudHtml;
  }
  const msgBadge = document.getElementById('msgbadge');
  if (msgBadge) {
    msgBadge.style.display = unreadMsgs > 0 ? '' : 'none';
    msgBadge.textContent = String(unreadMsgs);
  }
  const battles = Object.values(s.battles).filter(
    (b) => b.attacker.owner === ME || b.defender.owner === ME || known(b.location),
  ).length;
  const alertText = String(battles);
  if (alertText !== lastAlertText) {
    alertBadge.style.display = battles > 0 ? 'grid' : 'none';
    alertBadge.textContent = alertText;
    lastAlertText = alertText;
  }
  // collapsed rail mirrors unread/battle attention onto the hamburger, so notifications
  // still surface while the tool panel (with its per-tool badges) is closed.
  const attn = battles + unreadMsgs;
  const railAlertText = attn > 0 && !railEl.classList.contains('open') ? String(attn) : '';
  if (railAlertText !== lastRailAlert) {
    railAlert.style.display = railAlertText ? 'grid' : 'none';
    if (railAlertText) railAlert.textContent = railAlertText;
    lastRailAlert = railAlertText;
  }
  const logHtml = logLines.map((l) => `<div>${esc(l)}</div>`).join('');
  if (logHtml !== lastLogHtml) {
    logEl.innerHTML = logHtml;
    lastLogHtml = logHtml;
  }
  if (banner) {
    // On a genuine single-player match END, offer a restart straight from the banner
    // (back to bot selection). Net-status banners (reconnecting / waiting) get no button.
    const ended = !NET && s.match?.status === 'ended';
    const html = ended
      ? `<div class="bn-text">${esc(banner)}</div><button class="bn-btn" data-restart>${t('hub.back-to-bots')}</button>`
      : `<div class="bn-text">${esc(banner)}</div>`;
    if (html !== lastBannerHtml) {
      bannerEl.innerHTML = html;
      lastBannerHtml = html;
    }
    bannerEl.style.display = 'block';
  } else if (bannerEl.style.display !== 'none') {
    bannerEl.style.display = 'none'; // banner cleared (e.g. a fresh match) → hide it
    lastBannerHtml = '';
  }
  renderEndScreen();
  // Speedbar restart — only the no-bots sandbox (no match end to restart from); other
  // modes use the end-banner button instead. Toggle each frame as the mode can change.
  // Player build: the button (and the skirmish it restarts into) doesn't exist.
  if (!__PLAYER_BUILD__) {
    const soloNoBots = !NET && AI_PLAYERS.size === 0;
    restartBtn.style.display = soloNoBots ? '' : 'none';
    restartSep.style.display = soloNoBots ? '' : 'none';
  }
  // Speedbar time controls. PC: gated by the developer «speed control» toggle — off
  // for a normal player, so the whole bar (its ⌂/▶▶ are PC-hidden in CSS) disappears.
  // Mobile is frozen: the exit ⌂ lives in the bar there (the rail exit is PC-only), so
  // the bar always shows and the controls follow the old solo/NET rule.
  const showSpdCtl = pcUi() ? devSpeedControl : !NET || !__PLAYER_BUILD__;
  if (spdCtl && spdCtl.style.display !== (showSpdCtl ? '' : 'none')) {
    spdCtl.style.display = showSpdCtl ? '' : 'none';
  }
  const showBar = pcUi() ? devSpeedControl : true;
  if (speedbarEl && speedbarEl.style.display !== (showBar ? '' : 'none')) {
    speedbarEl.style.display = showBar ? '' : 'none';
  }
  // Keep the tech window live while open (research progress bar / eta), throttled.
  if (techTree.isOpen() && nowReal - lastTechAt > 500) {
    lastTechAt = nowReal;
    techTree.repaint();
  }
  // Keep the build window live while open (a finished build flips its row), throttled.
  if (buildWin.isOpen() && nowReal - lastBuildAt > 500) {
    lastBuildAt = nowReal;
    buildWin.repaint();
  }
  // Keep the steward window live while open (countdown to control returning), throttled.
  if (steward.isOpen() && nowReal - lastStewAt > 500) {
    lastStewAt = nowReal;
    steward.repaint();
  }
  // Intel windows tick in hours — a lazy 5s refresh keeps the «Шпионаж» timers honest.
  if (diploOpen && diploTab === 'intel' && nowReal - lastIntelAt > 5000) {
    lastIntelAt = nowReal;
    renderDiplo();
  }
  requestAnimationFrame(frame);
}

// Codex popup: full specs for a building/ship tile, with a contextual "Build here"
// button. Tiles live in the build menu + fleet panel now (no global HUD strip).
const codexEl = document.getElementById('codex');
if (codexEl) {
  codexEl.addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    const build = (tg.closest('.cx-build') as HTMLElement | null)?.dataset.build;
    if (build && selPlanet) {
      const [kind, id] = build.split(':');
      enqueueBuild(selPlanet, { kind: kind as BuildKind, id: id!, count: 1 });
      codexEl.classList.remove('show');
      lastPanelHtml = '';
      renderPanel();
      return;
    }
    // BUILD-1: листалка уровней в карточке здания — перерисовка той же карточки.
    const blvl = (tg.closest('[data-cx-blvl]') as HTMLElement | null)?.dataset.cxBlvl;
    if (blvl) {
      openCodex(`b:${blvl}`);
      return;
    }
    // «Улучшить» из карточки: хостовый путь заказа (сеть → приказ, соло → очередь);
    // карточка остаётся открытой и сама показывает «в работе» (проба погасит кнопку).
    const upg = (tg.closest('[data-cx-upg]') as HTMLElement | null)?.dataset.cxUpg;
    if (upg && selPlanet) {
      enqueueBuild(selPlanet, { kind: 'upgrade', id: upg, count: 1 });
      lastPanelHtml = '';
      renderPanel();
      openCodex(`b:${upg}`);
      return;
    }
    if (tg.id === 'codex' || tg.classList.contains('cx-close')) codexEl.classList.remove('show');
  });
}

// Player card: tap the top-left crest to open your session dossier (faction, worlds,
// fleets, score, treasury); tap the backdrop or CLOSE to dismiss.
// the left crest (avatar + nick) opens the player dossier
document.querySelector('.crest')?.addEventListener('click', () => openPlayerCard());

// The ‹ chevron: close the top layer if any are open (mirrors hardware Back),
// or leave the match straight to the hub if none are (a visible button should act
// in one tap, not require the double-back hint that hardware Back uses).
$('topback').addEventListener('click', () => {
  if (closeTopLayer()) {
    snd.play('close'); // ложится поверх тапа шеврона — осознанное наложение
    if (topLayerOpen() || inMatch()) armBack();
    return;
  }
  if (inMatch()) {
    $('tomenu').click(); // no layers + in match → straight to the hub
    return;
  }
  history.back(); // at the hub/welcome → system Back
});

// mirror the chosen emblem into the top-left corner + the hub avatar
applyEmblem();

// collapsible rail — the hamburger toggles the tool panel; picking a tool closes it.
function setRailOpen(open: boolean): void {
  railEl.classList.toggle('open', open);
  railGlyph.textContent = open ? '✕' : '☰';
  railToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}
railToggle.addEventListener('click', () => setRailOpen(!railEl.classList.contains('open')));
document.getElementById('railtools')?.addEventListener('click', () => setRailOpen(false));

// emblem picker — the hub avatar opens a glyph grid; picking one persists + applies it.
const emblemPick = document.getElementById('emblempick');
const epGrid = document.getElementById('ep-grid');
function openEmblemPick(): void {
  if (!emblemPick || !epGrid) return;
  const cur = playerEmblem();
  epGrid.innerHTML = EMBLEMS.map(
    (g) =>
      `<button type="button" class="ep-cell${g === cur ? ' sel' : ''}" data-emblem="${g}">${g}</button>`,
  ).join('');
  emblemPick.classList.add('show');
}
document.getElementById('hubav')?.addEventListener('click', openEmblemPick);
// The identity strip opens the career dossier — the avatar itself keeps the emblem
// picker (its ✎ badge advertises that), so the name/status column is the door.
document.querySelector('#hub .hub-who')?.addEventListener('click', () => profile.open());
document
  .getElementById('ep-close')
  ?.addEventListener('click', () => emblemPick?.classList.remove('show'));
emblemPick?.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.id === 'emblempick') {
    emblemPick.classList.remove('show'); // backdrop tap closes
    return;
  }
  const cell = t.closest('.ep-cell') as HTMLElement | null;
  if (cell?.dataset.emblem) {
    setPlayerEmblem(cell.dataset.emblem);
    emblemPick.classList.remove('show');
  }
});

const playerCardEl = document.getElementById('playercard');
if (playerCardEl) {
  playerCardEl.addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    // Match dossier → career dossier: close this card, open the profile sheet.
    if (tg.closest('.pc-dossier')) {
      playerCardEl.classList.remove('show');
      delete playerCardEl.dataset.seat;
      profile.open();
      return;
    }
    if (tg.id === 'playercard' || tg.closest('.pc-close')) {
      playerCardEl.classList.remove('show');
      delete playerCardEl.dataset.seat;
      return;
    }
    // Diplomacy actions on a seat card (opened from a chat nick). They run through the
    // same intents as the roster; we repaint the card (and the roster / chat feed) after.
    const seat = playerCardEl.dataset.seat;
    if (!seat) return;
    // ЧТО попросил игрок — `diploClick.ts` (REFM-139), общий с окном дипломатии; ЧТО
    // перерисовать после — дело экрана, и здесь это сама карточка (правило 1).
    const intent = diploIntent(tg);
    if (intent && intent.kind !== 'message') {
      if (intent.kind === 'stance') proposeStance(intent.seat, intent.stance as DiplomaticStance);
      else if (intent.kind === 'map') toggleMapShare(intent.seat);
      else playerOrder(spyOn(ME, intent.seat, intent.what as 'treasury' | 'fleets'));
      refreshSeatCard(seat);
      return;
    }
    if (intent?.kind === 'message') {
      playerCardEl.classList.remove('show');
      delete playerCardEl.dataset.seat;
      openDiplo('msgs'); // hand off to the full message thread
      conversations.open(intent.seat);
      renderDiplo();
      document.getElementById('dp-text')?.focus();
    }
  });
}

// War prompt: a move routed through a player you're at peace with asks for
// confirmation — DECLARE WAR dispatches it (after declaring war), CANCEL/backdrop drops it.
const warPromptEl = document.getElementById('warprompt');
if (warPromptEl) {
  warPromptEl.addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    if (tg.classList.contains('wp-yes')) confirmWarPrompt();
    else if (tg.id === 'warprompt' || tg.classList.contains('wp-no')) cancelWarPrompt();
  });
}

// Session menu: the rail's Diplomacy / Dispatches buttons open the roster / message log.
document.getElementById('rail-diplo')?.addEventListener('click', () => {
  openDiplo('diplo');
  maybeIntro('diplomacy');
});
document.getElementById('rail-msgs')?.addEventListener('click', () => {
  unreadMsgs = 0; // reading the tab clears the badge
  openDiplo('msgs');
});


function toggleSet<T>(set: Set<T>, v: T): void {
  if (set.has(v)) set.delete(v);
  else set.add(v);
}
function sendDiploMsg(): void {
  const input = document.getElementById('dp-text') as HTMLInputElement | null;
  const text = input?.value.trim();
  if (!text) return;
  dispatchChat(conversations.current(), text); // NET: server relay + echo; solo: local append
  if (input) {
    input.value = '';
    input.focus();
  }
}
/** Ping the selected province into the coalition channel — also a clickable map
 *  marker. The composer text becomes the marker's short description. */
function pingSelected(): void {
  if (!selPlanet || !s.planets[selPlanet]) {
    note(t('chat.ping.need-province'));
    return;
  }
  const input = document.getElementById('dp-text') as HTMLInputElement | null;
  const desc = (input?.value.trim() ?? '').slice(0, 80);
  if (pingRoute(NET, !!netClient) === 'server') {
    // The server is authoritative for pings: it stamps the marker and relays a
    // `ping.added` back to us + allies — that echo is what adds it (see onPingAdded).
    netClient?.placePing({ kind: 'mark', target: { node: selPlanet }, label: desc });
  } else {
    pushMsg(COALITION, desc || t('chat.ping.mark', { node: selPlanet }), false, ME, selPlanet);
  }
  if (input) {
    input.value = '';
    input.focus();
  }
}

// --- province ping composer (tap a province → choose where the ping goes) --------
// Метка отмечает провинцию и делится ею: адресат — либо канал коалиции (общий маркер на
// карте, который видят все союзники), либо личка одного игрока (приватный указатель «вот
// сюда» в его ветке). Сама витрина — три окна (композер, список меток, попап маркера) —
// живёт в `pingUi.ts` (REFM-25) поверх чистой модели прав `pingPanel.ts`; здесь только
// её хуки. Камера, лента сессии и сетевой клиент остаются у хоста.
const pings = initPingUi({
  menuRoot: () => document.getElementById('pingmenu'),
  panelRoot: () => document.getElementById('pingpanel'),
  popRoot: () => document.getElementById('pingpop'),
  me: () => ME,
  selected: () => selPlanet,
  hasProvince: (loc) => !!s.planets[loc],
  messages: () => sessionMessages,
  setMessages: (next) => {
    sessionMessages = next;
  },
  push: (to, text, loc) => pushMsg(to, text, false, ME, loc),
  net: () => (NET && netClient ? netClient : null),
  seats: diploSeats,
  coalitionSize: () => conversations.coalition().length,
  name: (id) => NAME[id] ?? id,
  color: ownerColor,
  badge: seatBadge,
  provinceName: planetName,
  note,
  focus: focusWorld,
  jump: jumpToPing,
  anchor: (loc) => {
    const pl = s.planets[loc];
    if (!pl) return null;
    const at = toScreen(world(pl.position), canvas.getBoundingClientRect(), VW, VH);
    return { left: Math.round(at.x), top: Math.round(at.y) };
  },
  viewportW: () => window.innerWidth,
  ask: (current) => prompt(t('ping.panel.edit'), current),
  onFeedChanged: () => {
    if (diploOpen && diploTab === 'msgs') renderDiploFeed();
  },
});

// --- TGT-1: target-order composer (CC-1 chains rendered target-side) ---------
/** BOOST-1: is this fleet on форс-марш? (authoritative map, both modes). */
function marchFlagged(fid: string): boolean {
  return (s as { forcedMarch?: Record<string, true> }).forcedMarch?.[fid] === true;
}
/** CC-1 plan of an OWN fleet — authoritative in both modes (the module runs in MODULES). */
function chainStepsOf(fid: string): ChainStep[] | null {
  const ch = (s as { orders?: Record<string, { steps: ChainStep[] }> }).orders?.[fid];
  return ch ? ch.steps : null;
}
/** The closest OWN world to `fromId` — the «Домой» leg of a composed plan (REFM-66). */
function nearestOwnWorld(fromId: string): string | null {
  return ownWorldNearest(
    fromId,
    Object.values(s.planets).map((p) => ({
      id: p.id,
      owner: p.owner ?? null,
      x: p.position.x,
      y: p.position.y,
    })),
    ME,
  );
}
/** Способности героя на борту — данные для пунктов меню (CC-1 × HERO-4; та же
 *  фильтрация, что у старого композера: только кастуемые типы). */
function chainAbilitiesFor(fleetIds: string[]): ChainAbility[] {
  const hero = heroAboard(Object.values(s.heroes ?? {}), fleetIds);
  if (!hero) return [];
  return castOptionsOf(hero).map((opt) => ({
    id: opt.id,
    name: t(data.heroAbilities[opt.id]!.name),
    cdH: opt.cdH,
    ranged: opt.ranged,
  }));
}
/** Слоты героя, разрешённые по игровым данным → пункты каста (`heroCasts.ts`, REFM-68).
 *  Одна точка разрешения на все три места, которые спрашивают «что можно применить»:
 *  кнопка ✨ командной полосы, её поповер и меню точки режима «Приказ». */
function castOptionsOf(hero: Hero): CastOption[] {
  const specs = (hero.abilities ?? []).map((ab) => {
    const ad = ab !== null ? data.heroAbilities[ab] : undefined;
    if (!ab || !ad) return null;
    return {
      id: ab,
      type: ad.type,
      range: ad.range,
      readyAt: hero.cooldowns?.[heroCdKey(ad.type)],
    };
  });
  return castOptions(specs, HERO_CASTABLE, s.time, HOUR);
}
/** Остаток кулдауна способности — единственный реальный холд драйвера цепочек. */
function chainAbilityHoldH(fleetIds: string[]): (abilityId: string) => number {
  const abs = chainAbilitiesFor(fleetIds);
  return (id) => abs.find((a) => a.id === id)?.cdH ?? 0;
}
/** Старт плана флота: летящий начнёт исполнять цепочку в пункте назначения —
 *  от него и считаем (голова авторитетна по arrivesAt, хвост — оценка). */
function chainStart(f: Fleet): { fromId: string | null; baseH: number } {
  if (f.movement) {
    const mv = f.movement;
    const dest = journeyDestination(mv);
    const rawRestH = dest !== mv.to ? estimateTravelHours(s, data, mv.to, dest, f) : 0;
    const restH = restRouteHours(rawRestH, marchFlagged(f.id), FORCED_MARCH_MULT);
    return { fromId: dest, baseH: arrivalHours(mv.arrivesAt, s.time, HOUR, restH) };
  }
  return { fromId: fleetNode(f), baseH: 0 };
}
/** Оценка перелёта для таймлайна (форс-марш ускоряет, как в pn-eta панели: REFM-67). */
function chainTravelH(f: Fleet): (from: string, to: string) => number | null {
  const boosted = marchFlagged(f.id);
  return (from, to) =>
    marchHours(estimateTravelHours(s, data, from, to, f), boosted, FORCED_MARCH_MULT);
}
/** Маршрут для полилинии цепочки. Граф лейнов статичен всю партию — кэш на матч
 *  (Дейкстра на каждый кадр для каждого шага была бы расточительна). */
function chainRoute(from: string, to: string): string[] | null {
  const key = `${from}>${to}`;
  let hops = chainRouteCache.get(key);
  if (hops === undefined) {
    hops = planRoute(s, from, to);
    chainRouteCache.set(key, hops);
  }
  return hops;
}
/** Вход в режим «Приказ»: черновик — живой план ПЕРВОГО флота (весь префилл — один
 *  жест, ⟲ снимает его целиком). Режим держит свои fleetIds и живёт без выделения. */
function enterChainMode(fleetIds: string[]): void {
  const mine = fleetIds.filter((id) => s.fleets[id]?.owner === ME);
  if (!mine.length) return;
  const pre = draftFrom(chainStepsOf(mine[0]!) ?? []);
  chainMode = { fleetIds: mine, steps: pre.steps, gestures: pre.gestures, menu: null };
  aiming = false;
  note(t('hint.pick-order'));
  lastCmdHtml = '';
  lastPanelHtml = '';
}
function exitChainMode(): void {
  chainMode = null;
  document.getElementById('tgted')?.classList.remove('show');
  document.body.classList.remove('chain-mode');
  lastCmdHtml = '';
  lastPanelHtml = '';
}
/** Тап карты в режиме: точка → меню действий по её типу, пустота → закрыть меню.
 *  Радиусы хитов берутся из того же `tapPriority.ts`, что и у selectAt: вторая копия
 *  чисел рассинхронилась бы и рисовала одно, а слала другое.
 *  Приоритет цели («мир важнее флота» — наоборот к обычному выделению) — `chainTarget.ts`. */
function chainMapTap(mx: number, my: number): void {
  if (!chainMode) return;
  const n = nearestHit(MAP, (nn) => world(nn), mx, my, tapRadius('node', tapByTouch));
  const foe = n
    ? null
    : nearestHit(
        Object.values(s.fleets).filter((f) => f.owner !== ME),
        fleetAnchor,
        mx,
        my,
        tapRadius('fleet', tapByTouch),
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
function chainMenuAnchor(): { x: number; y: number } | null {
  const m = chainMode?.menu;
  if (!m) return null;
  if (m.kind === 'fleet') {
    const f = s.fleets[m.id];
    return f ? fleetAnchor(f) : null;
  }
  const pl = s.planets[m.id];
  return pl ? world(pl.position) : null;
}
/** Меню точки — в том же плавающем боксе #tgted, что жил у старого композера.
 *  Позицию каждый кадр обновляет updateChainDom (меню едет с камерой и флотом). */
function renderChainMenu(): void {
  const el = document.getElementById('tgted');
  if (!el || !chainMode) return;
  const m = chainMode.menu;
  if (!m) {
    el.classList.remove('show');
    return;
  }
  const f0 = s.fleets[chainMode.fleetIds[0]!];
  const startId = f0 ? chainStart(f0).fromId : null;
  const items = chainMenuItems(
    { steps: chainMode.steps, gestures: chainMode.gestures },
    m,
    startId,
    {
      capturable: m.kind !== 'fleet' && (sectorTypeOf(m.id)?.capturable ?? false),
      hasArtillery: chainMode.fleetIds.some((id) => fleetHasArtillery(s.fleets[id])),
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
function positionChainMenu(el: HTMLElement): void {
  const a = chainMenuAnchor();
  if (!a) return;
  const at = toScreen(a, canvas.getBoundingClientRect(), VW, VH);
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
document.getElementById('tgted')?.addEventListener('click', (ev) => {
  const btn = (ev.target as HTMLElement).closest('button');
  if (!btn || btn.disabled || !chainMode || !chainMode.menu) return;
  const act = btn.dataset.ch as
    | 'move'
    | 'wait'
    | 'wait6'
    | 'assault'
    | 'fire'
    | 'ability'
    | undefined;
  if (!act) return;
  const f0 = s.fleets[chainMode.fleetIds[0]!];
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
    note('✖ ' + t('chain.full'));
    return;
  }
  chainMode.steps = next.steps;
  chainMode.gestures = next.gestures;
  lastCmdHtml = ''; // полоска пересоберётся (счётчик шагов/кнопки)
  // ⏱/🎯 наращивают часы повторными тапами — меню живёт; остальное закрывает его.
  if (btn.dataset.keep) renderChainMenu();
  else {
    chainMode.menu = null;
    document.getElementById('tgted')?.classList.remove('show');
  }
});
/** Draw a pin per active coalition ping (owner-coloured), recording screen hit-boxes
 *  for tap detection. Pins float just above the node, tip pointing at it. Two sonar
 *  rings expand from the marked node (half a period apart) and the pin head breathes
 *  an owner-coloured glow — a "look here" you can catch from across the map. Your
 *  own pins can be hidden with the settings switch (allies' are always drawn). */
function drawPings(now: number): void {
  pingHits = [];
  for (const m of pings.drawable()) {
    // `drawable()` уже отбросил спрятанные ЛОКАЛЬНО (у союзника метка цела).
    if (m.from === ME && !showOwnPings) continue; // hidden by «Свои метки» switch
    const pl = s.planets[m.ping!];
    if (!pl) continue;
    const c = world(pl.position);
    if (!visible(c, 40)) continue;
    const x = c.x;
    const y = c.y - 22; // pin head floats above the node (плейтест: пинги крупнее)
    const col = ownerColor(m.from);
    // Фазы, дыхание и жизнь колец — `pingPulse.ts` (REFM-72).
    const phase = pingPhase(x);
    const pulse = pinPulse(now, phase);
    cx.save();
    // sonar waves: rings born at the node, growing and thinning out as they fade;
    // a newborn ring flashes a soft filled core so each wave visibly "drops in"
    cx.shadowColor = rgba(col, 0.7);
    for (const off of RING_OFFSETS) {
      const k = ringProgress(now, phase, off);
      const rr = ringRadius(k);
      const drop = dropInAlpha(k);
      if (drop > 0) {
        cx.fillStyle = rgba(col, drop); // the drop-in flash
        cx.beginPath();
        cx.arc(c.x, c.y, rr, 0, TAU);
        cx.fill();
      }
      cx.shadowBlur = fxBlur(6 * (1 - k));
      cx.strokeStyle = rgba(col, ringAlpha(k));
      cx.lineWidth = ringWidth(k);
      cx.beginPath();
      cx.arc(c.x, c.y, rr, 0, TAU);
      cx.stroke();
    }
    // the pin itself, breathing an owner-coloured glow (the dark stroke keeps contrast)
    cx.shadowColor = rgba(col, 0.85);
    cx.shadowBlur = fxBlur(4 + 8 * pulse);
    cx.fillStyle = rgba(col, pulse);
    cx.strokeStyle = 'rgba(4,10,12,.85)';
    cx.lineWidth = 1.4;
    cx.beginPath(); // teardrop pin: head + tip toward the node
    cx.moveTo(x, y + 14);
    cx.lineTo(x - 6.5, y);
    cx.arc(x, y - 1, 7, Math.PI, 0);
    cx.lineTo(x, y + 14);
    cx.fill();
    cx.stroke();
    cx.shadowBlur = 0;
    cx.fillStyle = 'rgba(6,18,22,.95)';
    cx.beginPath();
    cx.arc(x, y - 1, 2.7, 0, TAU);
    cx.fill();
    cx.fillStyle = rgba(col, pulse); // a blinking ember in the pin's eye
    cx.beginPath();
    cx.arc(x, y - 1, 1.4, 0, TAU);
    cx.fill();
    cx.restore();
    pingHits.push({ loc: m.ping!, x, y: y - 1 });
  }
}

/** TGT-1: standing order markers — a breathing crosshair on every world an OWN
 *  chained fleet is planned against (last move leg; a legless plan anchors at the
 *  fleet's spot). The ◎ badge above the ring is the tap handle (screen hit-boxes,
 *  like pings) — tapping it re-opens the composer with the live plan. */
/** CHAIN-UX: полилиния + капсулы шагов + накопленное «~T» для ОДНОЙ цепочки.
 *  Времена — клиентская оценка (авторитетны только arrivesAt/waitUntil головы),
 *  поэтому всегда с «~». Рисуется без LOD-затухания: план — то, ради чего смотрят. */
function drawChainPath(
  f: Fleet,
  steps: ChainStep[],
  fromId: string | null,
  baseH: number,
  headRemH: number | undefined,
  alpha: number,
): void {
  if (!steps.length || !fromId) return;
  const start = fleetAnchor(f);
  if (!start) return;
  const tl = chainTimeline(steps, fromId, baseH, chainTravelH(f), chainAbilityHoldH([f.id]), headRemH);
  // Полилиния: от якоря флота по маршруту каждого перелёта (стиль drawFleetRoutes).
  const pts: Array<{ x: number; y: number }> = [start];
  for (const hop of chainPathNodes(steps, fromId, chainRoute)) {
    const pl = s.planets[hop];
    if (pl) pts.push(world(pl.position));
  }
  cx.save();
  cx.globalAlpha = alpha;
  if (pts.length > 1) {
    cx.setLineDash([4, 6]);
    cx.strokeStyle = rgba(LOCK, 0.75);
    cx.lineWidth = 1.4;
    cx.shadowColor = LOCK;
    cx.shadowBlur = fxBlur(3);
    cx.beginPath();
    cx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) cx.lineTo(pts[i]!.x, pts[i]!.y);
    cx.stroke();
    cx.setLineDash([]);
    cx.shadowBlur = 0;
  }
  // Капсулы шагов: стопка вправо от точки; «~T» — под последней капсулой точки.
  // Стопка капсул и место подписи «~T» — правила в `chainPathLayout.ts` (REFM-71).
  const stack = stackIndexes(tl.map((r) => r.pointId));
  const lastAt = lastStepAtPoint(tl.map((r) => r.pointId));
  const last = new Map<string, { x: number; y: number; endH: number | null }>();
  cx.textAlign = 'center';
  for (let i = 0; i < steps.length; i++) {
    const pid = tl[i]!.pointId;
    const pl = pid ? s.planets[pid] : undefined;
    const k = stack[i];
    if (!pid || !pl || k === null || k === undefined) continue;
    const c = world(pl.position);
    if (!visible(c)) continue;
    const { x: bx, y: by } = capsuleAt(c, k);
    cx.fillStyle = 'rgba(6,18,22,.92)';
    cx.strokeStyle = rgba(LOCK, 0.85);
    cx.lineWidth = 1.2;
    cx.beginPath();
    cx.arc(bx, by, 9, 0, TAU);
    cx.fill();
    cx.stroke();
    cx.fillStyle = rgba(LOCK, 0.95);
    cx.font = '700 10px ui-monospace,Menlo,monospace';
    cx.fillText(stepGlyph(steps[i]!), bx, by + 3.5);
    const hrs = stepHours(steps[i]!);
    if (hrs) {
      cx.font = '600 8px ui-monospace,Menlo,monospace';
      cx.fillText(hrs, bx, by - 12);
    }
    // «~T» — под ПОСЛЕДНЕЙ капсулой точки: время точки это когда она отработана целиком.
    if (lastAt.get(pid) === i) last.set(pid, { x: bx, y: by, endH: tl[i]!.endH });
  }
  cx.font = '600 9px ui-monospace,Menlo,monospace';
  for (const p of last.values()) {
    if (p.endH === null) continue;
    cx.shadowColor = 'rgba(0,0,0,0.85)';
    cx.shadowBlur = fxBlur(3);
    cx.fillStyle = rgba(LOCK, 0.95);
    cx.fillText(`~${fmtEta(p.endH)}`, p.x, p.y + 20);
    cx.shadowBlur = 0;
  }
  cx.restore();
}
/** CHAIN-UX: слой цепочек — отправленные планы всех своих флотов (голова
 *  авторитетна: летящий — по arrivesAt, взведённая задержка — по waitUntil) и
 *  черновик открытого режима поверх. ◎-бейдж на якоре плана — хэндл: тап вне
 *  режима открывает редактирование. */
function drawChainOverlay(now: number): void {
  chainHits = [];
  const col = ownerColor(ME);
  // Отбор, группировка и счётчик бейджа — `chainBadges.ts` (REFM-73).
  const pulse = badgePulse(now);
  const orders = (s as { orders?: Record<string, { steps: ChainStep[]; waitUntil?: number }> })
    .orders;
  const editing = new Set(chainMode?.fleetIds ?? []);
  // Порядок обхода — по id флота: бейджи не должны переставляться между кадрами.
  const own: Array<{ fleetId: string; owner: string | null; fleet: Fleet }> = [];
  for (const fid of Object.keys(orders ?? {}).sort()) {
    const f = s.fleets[fid];
    if (f) own.push({ fleetId: fid, owner: f.owner, fleet: f });
  }
  // Якорь считается только для показываемых планов — чужие кадр не нагружают.
  const anchored: AnchoredOrder[] = shownOrders(own, ME, editing).map((e) => {
    const chain = orders![e.fleetId]!;
    const st = chainStart(e.fleet);
    const headRem =
      chain.waitUntil !== undefined ? Math.max(0, (chain.waitUntil - s.time) / HOUR) : undefined;
    drawChainPath(e.fleet, chain.steps, st.fromId, st.baseH, headRem, 0.5);
    const anchor = draftFinish(chain.steps, st.fromId);
    return { fleetId: e.fleetId, anchor: anchor && s.planets[anchor] ? anchor : null };
  });
  const byWorld = groupByAnchor(anchored);
  for (const [wid, fids] of byWorld) {
    const c = world(s.planets[wid]!.position);
    if (!visible(c)) continue;
    const bx = c.x;
    const by = c.y + BADGE_DY;
    cx.save();
    cx.shadowColor = rgba(col, 0.8);
    cx.shadowBlur = fxBlur(3 + 6 * pulse);
    cx.fillStyle = 'rgba(6,18,22,.92)';
    cx.strokeStyle = rgba(col, 0.9);
    cx.lineWidth = 1.4;
    cx.beginPath();
    cx.arc(bx, by, 7.5, 0, TAU);
    cx.fill();
    cx.stroke();
    cx.shadowBlur = 0;
    cx.beginPath();
    cx.arc(bx, by, 2.6, 0, TAU);
    cx.stroke();
    const count = badgeCount(fids.length);
    if (count) {
      cx.fillStyle = rgba(col, 0.95);
      cx.font = '700 8px ui-monospace,monospace';
      cx.textAlign = 'center';
      cx.fillText(count, bx + 11, by - 5);
    }
    cx.restore();
    chainHits.push({ target: wid, fleetIds: fids, x: bx, y: by });
  }
  // Черновик открытого режима — ярче отправленных; точка меню подсвечена кольцом.
  if (chainMode) {
    const f0 = s.fleets[chainMode.fleetIds[0]!];
    if (f0) {
      const st = chainStart(f0);
      drawChainPath(f0, chainMode.steps, st.fromId, st.baseH, undefined, 0.95);
    }
    const a = chainMenuAnchor();
    if (a) {
      cx.save();
      cx.strokeStyle = rgba(LOCK, 0.5 + 0.4 * pulse);
      cx.lineWidth = 1.6;
      cx.setLineDash([5, 4]);
      cx.lineDashOffset = -(now / 50) % 9;
      cx.beginPath();
      cx.arc(a.x, a.y, 17, 0, TAU);
      cx.stroke();
      cx.restore();
    }
  }
}
const GO_FLASH_MS = 1600;
let goFlash: { id: string; at: number } | null = null;
/** Обе дороги к точке карты. Чем прыжок из текста отличается от перехода по ссылке из
 *  панели (масштаб, выделение, диплоокно, вспышка) — `mapJump.ts` (REFM-108). */
function jumpTo(id: string, kind: JumpKind): void {
  const pl = s.planets[id];
  const step = jumpStep(kind, !!pl, cam.scale);
  if (!pl || step.do !== 'jump') return;
  centerOn(pl.position, step.scale);
  if (step.select) {
    selPlanet = id;
    selFleet = null;
    selFleets = new Set();
    lastPanelHtml = '';
  }
  if (step.closeDiplo) closeDiplo();
  if (step.ring) goFlash = { id, at: performance.now() };
}
/** Pan the camera to a world referenced from a plan row (data-goto) — selection stays
 *  untouched (the fleet panel must survive the tap) and a short ring marks the spot. */
function focusWorld(id: string): void {
  jumpTo(id, 'goto');
}
function drawGoFlash(now: number): void {
  if (!goFlash) return;
  if (flashDone(now, goFlash.at, GO_FLASH_MS)) {
    goFlash = null;
    return;
  }
  const pl = s.planets[goFlash.id];
  if (!pl) return;
  const c = world(pl.position);
  // Шкала одна на обе вспышки (`flashFx.ts`): прогресс 0→1, затухание — он же наоборот.
  const k = fadeOf(flashProgress(now, goFlash.at, GO_FLASH_MS));
  cx.save();
  cx.strokeStyle = rgba(LOCK, 0.25 + 0.55 * k);
  cx.lineWidth = 1.6;
  cx.setLineDash([4, 4]);
  cx.beginPath();
  cx.arc(c.x, c.y, growRadius(14, 10, 1 - k), 0, TAU);
  cx.stroke();
  cx.restore();
}
const CAPTURE_FLASH_MS = 1500;
/** A province that changed hands lights up in its NEW owner's colour: a bright wave
 *  sweeps across the flipped cell from its centre and the frontier ignites, fading
 *  over ~1.5s. The cell polygon is recomputed each frame with the SAME weighted-
 *  Voronoi math the political map bakes (computePowerCell), so the wave lines up
 *  pixel-for-pixel with the fill and tracks pan/zoom. Only runs while a flash is live
 *  (captures are rare), so the O(n) recompute costs nothing on a quiet frame. */
function drawCaptureFlashes(now: number): void {
  if (captureFlashes.size === 0) return;
  // ТЕ ЖЕ семена и рамка, что у политической заливки — `provinceMap.ts` (REFM-61,
  // правило 6): волна обрезается по клетке, и разъедься копия формул хоть на пиксель,
  // волна потекла бы за границу провинции или не дошла бы до неё. Здесь своя копия и
  // стояла: `9000 * scale²` и `max(40, ширина × 0.05)` литералами прямо в кадре.
  // Проекция — этим кадром, чтобы волна ехала вместе с камерой.
  const idxByNode = new Map<string, number>();
  let seedIdx = 0;
  const seeds: TerritorySeed[] = provinceSeeds(MAP, cam.scale, (n) => {
    const p = s.planets[n.id];
    if (!p) return null;
    idxByNode.set(n.id, seedIdx++);
    return { size: p.size ?? 1, at: world(n), owner: knownOwner(n.id) };
  });
  const frameB = clipRect({ minX: MINX, maxX: MAXX, minY: MINY, maxY: MAXY });
  const clip = clipPolygon(world(frameB.topLeft), world(frameB.bottomRight));
  const trace = (poly: Array<[number, number]>): void => {
    cx.beginPath();
    cx.moveTo(poly[0]![0], poly[0]![1]);
    for (let i = 1; i < poly.length; i++) cx.lineTo(poly[i]![0], poly[i]![1]);
    cx.closePath();
  };
  for (const [node, flash] of captureFlashes) {
    if (flashDone(now, flash.at, CAPTURE_FLASH_MS)) {
      captureFlashes.delete(node);
      continue;
    }
    const idx = idxByNode.get(node);
    if (idx === undefined) continue; // province gone (shouldn't happen mid-flash)
    const cell = computePowerCell(seeds, clip, idx);
    if (!cell) continue;
    const c = { x: seeds[idx]!.x, y: seeds[idx]!.y }; // seeds are already screen-space
    // Кламп прогресса и затухание — `flashFx.ts`: метка кадра rAF может опередить
    // постановку вспышки, а отрицательный радиус роняет cx.arc().
    const k = flashProgress(now, flash.at, CAPTURE_FLASH_MS); // 0 → 1
    const fade = fadeOf(k);
    const col = ownerColor(flash.owner);
    // cell radius (centre → farthest vertex) sets how far the wave travels
    let maxR = 0;
    for (const [px, py] of cell.poly) maxR = Math.max(maxR, Math.hypot(px - c.x, py - c.y));
    cx.save();
    // 1) colour wash of the whole cell, fading — the province "flips" to the new hue
    trace(cell.poly);
    cx.fillStyle = rgba(col, 0.3 * fade);
    cx.fill();
    // 2) the wave: a bright ring expanding from the centre, CLIPPED to the cell so it
    //    reads as energy sweeping across the province out to its border
    trace(cell.poly);
    cx.clip();
    cx.globalCompositeOperation = 'lighter';
    const rr = waveRadius(k, maxR, 1.25);
    cx.strokeStyle = rgba(col, 0.85 * fade);
    cx.lineWidth = 3 + 5 * fade;
    cx.shadowColor = col;
    cx.shadowBlur = fxBlur(12 * fade);
    cx.beginPath();
    cx.arc(c.x, c.y, rr, 0, TAU);
    cx.stroke();
    cx.restore();
    // 3) the frontier igniting — the cell outline pulses bright then settles
    cx.save();
    trace(cell.poly);
    cx.strokeStyle = rgba(col, 0.9 * fade);
    cx.lineWidth = 1.5 + 2.5 * fade;
    cx.shadowColor = col;
    cx.shadowBlur = fxBlur(8 * fade);
    cx.stroke();
    cx.restore();
  }
}
/** Fly to a world referenced from TEXT (toast / recap row / diplo ping): the map is not
 *  in front of the player yet, so this one zooms in and takes over the selection. */
function jumpToPing(id: string): void {
  jumpTo(id, 'ping');
}
const diploEl = document.getElementById('diplo');
if (diploEl) {
  diploEl.addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    if (tg.id === 'diplo' || tg.closest('.dp-close')) return closeDiplo();
    const tab = (tg.closest('.dp-tab') as HTMLElement | null)?.dataset.tab;
    if (tab) {
      diploTab = tab as 'diplo' | 'msgs' | 'intel';
      renderDiplo();
      return;
    }
    const sort = (tg.closest('.dp-sortb') as HTMLElement | null)?.dataset.sort;
    if (sort) {
      diploSort = sort as typeof diploSort;
      renderDiplo();
      return;
    }
    const fstance = (tg.closest('.dp-fchip[data-fstance]') as HTMLElement | null)?.dataset.fstance;
    if (fstance) {
      toggleSet(diploStanceFilter, fstance as DiplomaticStance);
      renderDiplo();
      return;
    }
    const ftype = (tg.closest('.dp-fchip[data-ftype]') as HTMLElement | null)?.dataset.ftype;
    if (ftype) {
      toggleSet(diploTypeFilter, ftype as 'human' | 'ai');
      renderDiplo();
      return;
    }
    if (tg.closest('.dp-fclear')) {
      diploStanceFilter.clear();
      diploTypeFilter.clear();
      renderDiplo();
      return;
    }
    // Тот же разбор, что и у карточки игрока (`diploClick.ts`, REFM-139) — а перерисовку
    // здесь делает окно целиком. Письмо ниже: между ним и шпионом стоит окно интела, и
    // порядок ветвей сохранён (правило 3).
    const intent = diploIntent(tg);
    if (intent && intent.kind !== 'message') {
      if (intent.kind === 'stance') proposeStance(intent.seat, intent.stance as DiplomaticStance);
      else if (intent.kind === 'map') toggleMapShare(intent.seat);
      else playerOrder(spyOn(ME, intent.seat, intent.what as 'treasury' | 'fleets'));
      renderDiplo(); // the intel row (or the rejection note) reflects the outcome
      return;
    }
    const iw = (tg.closest('[data-iw]') as HTMLElement | null)?.dataset.iw;
    if (iw) {
      closeDiplo(); // карта должна быть видна — перелетаем к миру из окна интела
      focusWorld(iw);
      return;
    }
    if (intent?.kind === 'message') {
      conversations.open(intent.seat);
      diploTab = 'msgs';
      renderDiplo();
      document.getElementById('dp-text')?.focus();
      return;
    }
    const convo = (tg.closest('.dp-cv') as HTMLElement | null)?.dataset.convo;
    if (convo) {
      conversations.open(convo);
      renderDiplo();
      document.getElementById('dp-text')?.focus();
      return;
    }
    if (tg.closest('.dp-ping')) return pingSelected();
    const nick = (tg.closest('[data-nickseat]') as HTMLElement | null)?.dataset.nickseat;
    if (nick) return openSeatCard(nick);
    const ping = (tg.closest('.dp-line.ping') as HTMLElement | null)?.dataset.ping;
    if (ping) return jumpToPing(ping);
    if (tg.closest('.dp-send')) return sendDiploMsg();
    const row = tg.closest('.dp-row') as HTMLElement | null;
    if (row?.dataset.seat) {
      diploExpanded = diploExpanded === row.dataset.seat ? null : row.dataset.seat;
      renderDiplo();
    }
  });
  // Enter sends the composed message.
  diploEl.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter' && (ke.target as HTMLElement).id === 'dp-text') {
      e.preventDefault();
      sendDiploMsg();
    }
  });
}

requestAnimationFrame(frame);

// --- in-app APK auto-update -------------------------------------------------
// Вся проводка (и оба решения под ней — что сказать про исход и когда проверять) —
// в `apkUpdate.ts`. Вне APK вызов тихо ничего не делает.
initApkUpdater();

// --- corporation cabinet (AVA-C1/C2) -----------------------------------------
// Сам кабинет живёт в `corpScreen.ts` (REFM-11); здесь только его хуки и две двери,
// которые его открывают (кнопка хаба и рельса матча). `authorizedBase` — та же
// политика, что у «Арсенала» и профиля; кэша у кабинета сознательно нет.
const corp = initCorp({
  root: () => $('corp'),
  head: () => $('corphd'),
  tabs: () => $('corptabs'),
  body: () => $('corpbody'),
  note,
  errText,
  onIntro: maybeIntro,
  authorizedBase: hubAuthorizedBase,
});
$('ccorp').addEventListener('click', () => corp.open());
$('railcorp').addEventListener('click', () => corp.open());
