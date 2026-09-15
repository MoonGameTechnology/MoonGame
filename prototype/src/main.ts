import { mapPreset, mapNodesFromState, scoreLimitFor, MAP_IDS, type MapId } from './mapCatalog';
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
  MAP as LEGACY_MAP,
  SECTOR_TYPES,
  SCORE_LIMIT as LEGACY_SCORE_LIMIT,
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
  engageFleet,
  loadArmy,
  unloadArmy,
  // SHU-3.1 — челноки: перегрузка порт ⇄ носитель и сам вылет.
  loadShuttle,
  unloadShuttle,
  strikeShuttle,
  splitSquadron,
  mergeSquadron,
  loadSquadronTroops,
  unloadSquadronTroops,
  mergeFleet,
  splitFleet,
  buildBuilding,
  upgradeBuilding,
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
  type AiProfile,
  type ChainStep,
} from './game';
import {
  dominantUnit,
  glyphHalo,
  glyphScale,
  unitArchetype,
  unitGlyphSvg,
  unitShape,
  unitSizeClass,
} from './unitGlyphs';
import { drawShipShape } from '../../packages/client/src/shipShapes';
import { catalogPortraitHtml } from './shipArt';
import { fleetCallsign, FLEET_KIND_KEY } from './fleetName';
import { planetName } from './planetName';
// GRND-1: гарнизон, запертый живым боем, не отпускает войска (ядро: E_UNDER_ASSAULT).
import { garrisonUnderAssault } from '../../packages/shared-core/src/util/fleet';
import { DEFAULT_HEROES, type HeroLoadout } from './heroes';
import { DEFAULT_SHIP_LOADOUTS, type ShipLoadout } from './ships';
// «Производство» — экран заказа (REFM-13, ROS-3.1): окно целиком живёт в `shipyard.ts`, здесь
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
// REFM-198: что ЗНАЧИТ нажатие — вердикты Back, Escape и шеврона.
import {
  backAction,
  chevronAction,
  escapeConsultsLadder,
  rearmAfterClose,
  rearmAfterHint,
  selfHealArm,
  typingTarget,
} from './backGesture';
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
  hangarMachines,
  type Squadron,
  type StrikeBase,
  type PausedConstructionSite,
  type QueuedConstruction,
} from '../../packages/shared-core/src/index';
import {
  MultiplayerClient,
  type MultiplayerPing,
  type MultiplayerChatMessage,
  createBattleModel,
  type BattleSideView,
} from '../../packages/client/src/index';
import { pveState } from '../../packages/client/src/gameData';
import {
  worldToScreen as camWorldToScreen,
  zoomAt as camZoomAt,
  pinchAt as camPinchAt,
  clampCam as camClampCam,
  centerOn as camCenterOn,
  fitTransform as camFitTransform,
} from '../../packages/client/src/camera';
import {
  rgba,
  blitGlow as hdBlitGlow,
  blitSphere as hdBlitSphere,
  clearHolographicSprites,
} from '../../packages/client/src/holoDraw';
import {
  drawTerritory,
  computePowerCell,
  type TerritorySeed,
} from '../../packages/client/src/territory';
import { buildLabel, currentBuild } from './updater';
import { initApkUpdater } from './apkUpdate';
import { measureViewport, STARS, NEBULAE } from './viewport';
import { drawSpaceBackdrop, spaceBackdropReady, prepareSpaceBackdrop } from '../../packages/client/src/spaceBackdrop';
import { MapPreparation, type PreparationJob } from './mapPreparation';
import { drawHolographicBattle, drawHolographicPing } from './holographicEffects';
import { commandIcon, skinIcon } from './holographicIcons';
import { drawProvinceSelection, insideProvince, selectionPulse, type ProvincePolygon } from '../../packages/client/src/provinceSelection';
import { initPingUi } from './pingUi';
import { initSoloDrivers } from './soloDrivers';
import { initMatchEnd } from './matchEnd';
import { STANCES, diffDiplomacy } from './diploEvents';
import { asteroidsFor, bracketStrokes, polyPoints } from './mapShapes';
import { conveyorHtml as kitConveyorHtml } from './conveyorView';
import { LIMP_PCT, fleetSummary, hullPct, stackHullPct } from './fleetSummary';
import { isGroundUnit, isWingUnit, planetSummary } from './planetSummary';
// SHU-3.1 — ангар глазами игрока: состав, вместимость, топливо, перегрузка.
import {
  fleetHangar,
  hasHangar,
  planetHangar,
  transferOffer,
  transferPick,
  type HangarView,
} from './hangarPanel';
// SHU-4.3 — эскадра глазами игрока: карточка соединения, делёж, слияние, десант.
import {
  mergeTargets,
  splitOne,
  squadronCallsignOf,
  squadronCards,
  SQUADRON_KIND_KEY,
  troopsInputForSquadron,
  type SquadronCard,
} from './squadronPanel';
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
} from '../../decisions/sessionStore';
import {
  authOutcome,
  shouldRegister,
  validLogin,
  validPassword,
  type AuthOutcome,
} from '../../decisions/authRules';
import {
  dropsSession,
  joinOutcome,
  joinQuery,
  parseJoinPass,
  type JoinOutcome,
} from '../../decisions/joinRules';
import { createPendingJoin } from './pendingJoin';
import { syncCommanderXp } from './commanderSync';
import { panelSlackFor } from './panelSlack';
import { longPressAction, pressIntent } from '../../decisions/pressIntent';
import { assaultMovers, assaultTargetBlocker, collectBlockers, moveMovers } from './warPrompt';
import { laneEnds, warConfirmPlan } from '../../decisions/warOrders';
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
  ownRingLook,
  ownRingShown,
  type SightTier,
} from './sightFrontier';
import { drawSightFrontier } from './drawSightFrontier';
import { BADGE_R, badgeBob, badgeCenterY, badgeLook, badgeShown, badgeTether } from './kindBadge';
import { chipFontPx, chipGlyph, chipMetrics, chipXs, chipY, chipsShown } from './buildChips';
import { tapOwner, tapRadius } from '../../decisions/tapPriority';
import { nextPick, tapCandidates, touchPick, type TapPick } from '../../decisions/tapCycle';
import { initMobileHud, mobileOrderBar, type MobileChoice } from './mobileHud';
import { mobileDraftMatches, mobileTargetPoint, type MobileOrderDraft, type MobileOrderKind, type MobileOrderTarget } from './mobileOrders';
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
  modeLabel,
  rowAction,
  ruleSummary,
  type MatchRules,
  type MatchTab,
} from './matchRow';
import {
  clampFilter,
  mapsOf,
  matchesFilter,
  playerBounds,
  restoreFilter,
  serializeFilter,
  FILTER_STORE_KEY,
  type FilterState,
} from './matchFilter';

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
  assignSeats,
  factionBonuses,
  houseDisplayName,
  houseNameFor,
  isAiSeat as isAiRole,
  nextSeatRole,
  rivalCount,
  seatAiProfile,
  seatFactionIds as seatSeatFactionIds,
  type SeatRole,
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
} from '../../decisions/pointerPick';
import {
  afford as coreAfford,
  laneOf,
  queuedAction as coreQueuedAction,
  queuedCost,
} from './buildOrders';
import {
  activeConstruction as coreActiveConstruction,
  barPct,
  buildDurationHours as coreBuildDurationHours,
  hoursLeft,
  progressPct as coreProgressPct,
} from './buildProgress';
import { contactAlpha, contactLost, hourBucket, paintedThisFrame } from './alerts';
import { threatAlerts, threatScanDue, threatsHeard, type ThreatSighting } from './threatAlerts';
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
  motionOn,
  setMotion,
  fxBreath,
} from './graphicsPrefs';
import { initSettings } from './settingsOverlay';
import { canvasCompatibilityActive, canvasCompatibilityRequested, canvasCompatibilityOptions, setCanvasCompatibility } from './canvasCompatibility';
import { initHolographicUi, commandWindowHtml } from './holographicUi';
import { provincePingTarget, provinceForPing } from './provincePingAnchor';
import { reframePresentation, supportsHolography } from './holographicLayout';
import { drawGlassScreen, clipGlassSurface, drawGlassWave, drawGlassRim, drawTerrainField, makeTerrainField, hasTerrainMaterial, type TerrainField } from './holographicSurface';
import { TerrainRasterCache } from './terrainRasterCache';
import { holographyOn, setHolography } from './graphicsPrefs';
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
// GRND-1 — меню десанта: чистая модель «кого и сколь�