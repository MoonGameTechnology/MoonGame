import {
  attackBattle,
} from '../../decisions/actions';
import { inspectBattle } from '../../packages/shared-core/src/state/battleReadout';
import { startPlayerActivity } from '../../packages/client/src/playerActivity';
import { isEmplacementFleet } from '../../decisions/emplacement';
import { visibleOrdnance } from '../../packages/shared-core/src/state/visibility';
import { drawOrdnance } from '../../packages/client/src/ordnanceView';
import { rocketMinesUi } from './rocketMinesUi';
import type { SoloSave } from '../../decisions/soloSave';
import {
  closeSoloReplace,
  enterSolo,
  initSoloCheckpoint,
  leaveSolo,
  refreshHubDoor,
  restoreSolo,
  saveSolo,
  soloSaveActive,
  suspendSolo,
  tickSoloSave,
} from './soloCheckpoint';
import {
  authMode,
  initAccountSession,
  pendingJoinAfterAuth,
  probeAuthMode,
  resumeSession,
  sessionRecord,
  sessionToken,
} from './accountSession';
import {
  dispatchChat,
  initMessageLog,
  pushMsg,
  readMessages,
  replaceMessages,
  sessionMessages,
  unreadMsgs,
} from './messageLog';
import { pendingDecisions } from '../../decisions/pendingDecisions';
import { battleConcernsMe } from './attentionBadges';
import { pendingHtml } from './pendingPanel';
import { tabPick, tabsForSelection } from '../../decisions/worldFleetTabs';
import type { TapPick } from '../../decisions/tapCycle';
import { pairFacts, rememberCardTab } from './worldFleetCard';
import {
  closeDiplo,
  conversations,
  diffNetDiplomacy,
  diploOpen,
  diploTab,
  fmtStamp,
  initDiploWindow,
  openDiplo,
  openPlayerCard,
  openSeatCard,
  renderDiplo,
  renderDiploFeed,
  seatBadge,
  worldsOf,
} from './diploWindow';
import { closeCoalitions, coalOpen, initCoalitionWindow, syncCoalitions } from './coalitionWindow';
import {
  fillWelcome,
  initSignInPages,
  openReset,
  showStage,
  startAuthProbe,
  suggestCallsign,
  welcomePassword,
} from './signInPages';
import {
  NET,
  countNetFrame,
  initNetSession,
  leaveNetwork,
  netAdmitted,
  netClient,
  netDesync,
  netDesyncCount,
  netMatchId,
  netView,
  netWorld,
  rttEma,
  serverMatchId,
} from './netSession';
import { clearSeatNicks, refreshSeatNicks, seatNick } from './seatNicks';
import {
  closeSeatPicker,
  connectToMatch,
  initMatchJoin,
  openSeatPicker,
  stopNetSetupPoll,
} from './matchJoin';
import { initMatchBrowser, refreshMatches, refreshMyMatches } from './matchBrowser';
import { closeMatchDescription, isMatchDescriptionOpen } from './matchDescription';
import { shareRoadNetwork } from '../../packages/shared-core/src/index';
import { kernel as soloKernel } from './protoKernel';
import { isFrontier, mapPreset, mapNodesFromState, scoreLimitFor, type MapId } from './mapCatalog';
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
  ctx,
  setMatchMode,
  matchMode,
  data,
  MAP as LEGACY_MAP,
  SECTOR_TYPES,
  SCORE_LIMIT as LEGACY_SCORE_LIMIT,
  HOUR,
  // SHU-3.1 — челноки: перегрузка порт ⇄ носитель и сам вылет.
  mergeFleet,
  buildBuilding,
  netIncome,
  capitalOf,
  type SetupConfig,
  buySupply,
  type AiProfile,
} from './game';
import {
} from './unitGlyphs';
import { fleetCallsign, FLEET_KIND_KEY } from './fleetName';
import { worldName } from './planetName';
// «Производство» — экран заказа (REFM-13, ROS-3.1): окно целиком живёт в `shipyard.ts`, здесь
// только проводка (host-хуки) и панель героев, которая переедет своим кирпичом.
import { initShipyard } from './shipyard';
import { initHeroStaff } from './heroStaff';
import {
  COALITION,
  CH_SESSION,
  CH_GLOBAL,
  GROUP_CHANNELS,
  type SessionMsg,
} from './conversations';
// HUD-DOCK: видимость листа и «нижний хаб уезжает» — одна чистая модель на все
// прицельные режимы; она же держит замер высоты листа для привязки ряда команд.
import { sheetHeightVar } from './hudDock';
import { initTermTips } from './termTip';
import {
  closeStatPop,
  fleetLandShown,
  garrisonTilesHtml,
  initFleetCard,
  initStatPop,
  statPopOpen,
  strikeTitle,
  unitTileHtml,
} from './fleetCard';
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
  sightCircles,
  type SightCircle,
  type Squadron,
  type ShuttleStrike,
  traderOf,
  type ModeTrader,
} from '../../packages/shared-core/src/index';
import { createBattleModel } from '../../packages/client/src/index';
import { pveModeId, pveChapter, trainingState, trainingModeId, provingGroundState, PROVING_GROUND_PLAYER } from '../../packages/client/src/gameData';
import { fitTransform as camFitTransform } from '../../packages/client/src/camera';
import { bakedServer, buildLabel, currentBuild } from './updater';
import { initApkUpdater } from './apkUpdate';
import { measureViewport } from './viewport';
import { hideMapLoading, initMapLoading, leaveLoadingMap, mapPreparation, needMapPreparation, prepareEnteringMap } from './mapLoading';
import { forgetBorderLayer, initBorderLayer } from './borderLayer';
import { drawAbilityRings, drawCombatRanges, drawSelectionBox, drawCorridors, drawFleetRoutes, drawPatrolRings, drawRallyPoint, drawSeenPatrols, drawStrikeTrails, drawSwarmNet, initMapOverlays } from './mapOverlays';
import { drawAimPreview, drawAssaultTargets, drawCourseReach, drawCastAim, drawEngageTargets, drawPatrolAim, drawRelocateTargets, engageCandidates, initMapAim, relocateSpotPx, squadronRelocateSpots } from './mapAim';
import { clearFlak, drawFlak, drawGoFlash, drawMineFlashes, drawNoticeFlashes, flashGo, flashProvince, initMapEffects } from './mapEffects';
import { chainHits, drawAllyMarks, drawChainOverlay, drawDevourSieges, drawMinefields, drawMissiles, drawMissionTargets, drawPings, initMapMarks, pingHits } from './mapMarks';
import { drawSweepAfterglow, drawWorlds, initMapWorlds } from './mapWorlds';
import { drawBattles, drawBattleTracers, drawFleets, drawOrbitRings, initMapFleets } from './mapFleets';
import { drawMapSurface, initMapSurface, markSelection } from './mapSurface';
import { backgroundContextEvents, bgx, blitStaticLayer, forgetMapArt, forgetMapBake, initMapLayer, mapContextEvents, mapLayerForInput, mapPreparationJobs, provinceAt, roadDrawingOf } from './mapLayer';
import { skinIcon } from './holographicIcons';
import type { PingMarkerKind } from '../../decisions/pingKind';
import { initPingUi } from './pingUi';
import { initSoloDrivers } from './soloDrivers';
import { initMatchEnd } from './matchEnd';
import { catalogPortraitHtml } from './shipArt';
import { isWingUnit } from './planetSummary';
import {
  endSplitAwait,
  fleetInfoFor,
  initSidePanel,
  invalidatePanel,
  openDossier,
  planetTab,
  setPlanetTab,
  renderPanel,
  renderSplitDialog,
  revealMobileSelection,
  splitAwait,
} from './sidePanel';
import {
  initWorldCard,
} from './worldCard';
import { buildRoster } from './planetTabs';
import { tileLock, type TileLock } from './catalogTile';
import { tokenFor } from '../../decisions/sessionStore';
import { signOutEverywhere } from './accountSession';
import { mountAccountDeletion, mountPrivacyLinks } from './accountDeletion';
import { battleForecast, battleHostility } from '../../decisions/battleForecast';
import { initMissionPanel } from './missionPanel';
import { orbitSeats, type OrbitSeats } from '../../decisions/orbitSeats';
import { runAiSeats } from '../../decisions/runAiSeats';
import { pirateEncounter } from '../../decisions/pirateEncounter';
import { initPirateIntro } from './pirateIntro';
import { initComicPlayer } from './comicPlayer';
import { createComicQueue } from './comicQueue';
import { CHAPTER_COMICS } from './comicArt';
import type { ComicRegistry } from '../../decisions/chapterComics';
import {
  toolShown,
  victoryPointsShown,
} from '../../decisions/sectorZeroTools';
import {
  changeSectorProgress,
  chapterWorld,
  initSectorProfile,
  pushCloud,
  saveSectorProgress,
  sectorProgress,
} from './sectorProfile';
import {
  awardSectorRun,
  beginAttempt,
  enterRun,
  fleetLabelOf,
  forgetSavedRun,
  initSectorRun,
  isSectorZeroRun,
  isTraining,
  leaveRun,
  markGameplay,
  pveDifficulty,
  runChain,
  runInProgress,
  runMissionRows,
  runPauseEvent,
  runPauseShown,
  runShipLoadouts,
  runWrite,
  saveRun,
  sectorAttempt,
  sectorDevActive,
  sectorMission,
  sectorRunActive,
  sectorZeroToolsHidden,
  setRunActive,
  tickGameplayMark,
  tickRunSave,
} from './sectorRun';
import {
  closeAbandon,
  initSectorZeroShell,
  openAbandon,
  openSectorZero,
  playChapterComic,
  playTaskComic,
  sectorZeroMenu,
  syncSectorZeroTools,
  tickAbandon,
  watchAd,
} from './sectorZeroShell';
import {
  buildSetupConfig,
  initSetupScreen,
  netSetup,
  openSetup,
  sciWin,
  setupEl,
  setupMapId,
  setupSlots,
  setupSpeed,
} from './setupScreen';
import { getPlatform, type PlatformHost } from './platform/host';
import { doubleReward, shopCapabilities } from '../../decisions/sectorZeroShop';
import {
  changeSectorZeroProgress,
  prepareSectorZeroRun,
  TRAINING_REWARD,
} from '../../decisions/sectorZeroProgress';
import { resumeStep } from '../../decisions/tourResume';
import { initTrainingResume } from './trainingResume';
import { RUN_SPEED_FAST, RUN_SPEED_NORMAL } from '../../decisions/runTempo';
import { syncCommanderXp } from './commanderSync';
import { cardCovers } from './panelSlack';
import { frontierOutline } from './frontierOutline';
import { initMobileHud, type MobileChoice } from './mobileHud';
import { initPhoneNav } from './phoneNav';
import type { PhoneItemId } from '../../decisions/phoneNav';
import { initPhoneSpeed } from './phoneSpeed';
import { initPcHotkeys } from './pcHotkeys';
import { HOTKEY_SILENT_LAYERS, cycledFleets, homeTarget, nextFleet } from '../../decisions/hotkeys';
import { toScreen } from './screenAnchor';
import { pickHome } from './openingView';
import { houseDisplayName, seatAiProfile } from './setupSeats';
// Localization: one locale = one file (src/locale/*). Msgid = the canonical
// Russian source string; `t()` wraps every user-visible literal, `tData()` maps
// English data/*.json names, the static HTML is localized by a boot pass.
import {
  t,
  LOCALE,
  setLocale,
  localizeStaticDom,
} from '../../localization/runtime';
// REFM-2: the pure presentation formatters live in `format.ts` now (no state, no DOM)
import {
  esc,
  setRateUnit,
  setRunClock,
} from './format';
import { parseRateUnit } from '../../decisions/rateUnit';
// REFM-3: the icon vocabulary (glyph tables + menu renderers) lives in `icons.ts`
import {
  RES_SVG,
} from './icons';
// REFM-4: the object dossiers + the codex card live in `dossiers.ts`; the renderers
// that read live match state come out of `createDossiers(hooks)` further down.
import { buildingDossier, createDossiers } from './dossiers';
import {
  META_TREE,
  META_BRANCH_RU,
  metaLevel,
  metaLevelProgress,
  metaPoints,
  canUnlock,
  unlockNode,
  parseMetaState,
  type MetaState,
  type MetaBranch,
} from './meta';
// ARS-5 — arsenal witryna: the hub tab itself (`arsenalScreen.ts`, REFM-5 —
// `initArsenal(hooks)` owns its cache and markup); the pure model is `arsenal.ts`.
// H4 — конструктор шаблонов дивизий: модель в `formations.ts`, редактор — REFM-8.
// TT-3.1 — экран дерева технологий (REFM-9).
import { initTechTree } from './techTree';
import { initBuildScreen } from './buildScreen';
import type { MetaMatchRewardsView } from '../../packages/protocol/src/metaEconomyView';
import { initEndScreen, type MatchEnd } from './endScreen';
import {
  pcUi,
  glowOn,
  setGlowFx,
  starfieldOn,
  setStarfield,
  showFpsOn,
  setShowFps,
  motionOn,
  setMotion,
  setWindowOpacity,
  windowAlpha,
  windowOpacityPct,
  setUiScale,
  uiScalePct,
  mapSharpChosen,
  mapSharpOn,
  mapSlowSeen,
  markMapSlow,
  setMapSharp,
} from './graphicsPrefs';
import { initSettings } from './settingsOverlay';
import { initPush } from './pushSetup';
import { canvasCompatibilityActive, canvasCompatibilityRequested, canvasCompatibilityOptions, setCanvasCompatibility } from './canvasCompatibility';
import { initHolographicUi } from './holographicUi';
import { provincePingTarget, provinceForPing } from './provincePingAnchor';
import { reframePresentation } from './holographicLayout';
// «Профиль командира» — карьерное досье (REFM-10).
import { initProfile } from './profileScreen';
import { initRegistrationReward } from './registrationReward';
import { initTutorialMedal } from './tutorialMedal';
import { initMedalRewards } from './medalRewards';
import { PORTRAITS } from './profileArt';
import { parseAppearance } from '../../packages/protocol/src/playerProfile';
// AVA-C1/C2 — корпоративный кабинет (REFM-11).
import { initCorp } from './corpScreen';
// ECON-4 — session market: the model + orders live next door; the WINDOW is REFM-6.
import { initMarket } from './marketScreen';
import { initTrader } from './traderScreen';
import { initAllyScreen } from './allyScreen';
import { linkedAlly } from '../../decisions/allyPanel';
import { extractionCandidates } from '../../decisions/chapterChain';
import { captiveLoad, extractionStart } from '../../decisions/actions';
import { captiveCandidates } from '../../decisions/captive';
// Плавающее окно чата (REFM-12) — своя геометрия, свои настройки, свой кэш.
import { initChat } from './chatWindow';
import { initResourceCard } from './resourceCard';
// SND-1 — синтезированные звуки интерфейса (тёмный космос + космическая опера).
import { initSound } from './sound';
// REFM-16 — клиентские настройки: одно правило чтения/записи на весь клиент вместо
// восьми рукописных копий «нет ключа ⇒ умолчание» + try/catch вокруг setItem.
import { prefStore, readBool, readRaw, writeBool, writeRaw } from './prefs';
// REFM-200: что карточка пришвартованного флота ПРЕДЛАГАЕТ сделать.
import {
} from './dockedActions';
// REFM-201: чей сейчас ход в переговорах — одна формула на оба чипа.
// REFM-17 — палитра и правило «цвет = отношение»: одна таблица на карту и на экран
// дипломатии (раньше их было две, и настройку палитры знала только карта).
import { COLOR, paletteOf } from './sideColors';
// REFM-237 — цвета сторон, места матча и константы карты: у владельца, `mapPalette.ts`.
import {
  initMapPalette,
  neutralColor,
  ownerColor,
  rivalPaletteId,
  SEAT_META,
  setSideColors,
  stanceCol,
  youColor,
} from './mapPalette';
import { cam, centerOn, clampCam, defaultView, focusWorld, frameMap, initMapCamera, insets, jumpTo, jumpToPing, mapBounds, pirateIntroRect, setView, world, worldDist } from './mapCamera';
import { fleetSeen, forgetVision, initMapFog, known, memory, myIntel, refreshVision, resetFogMemory, restoreFogMemory, vision, type Vision } from './mapFog';
import { fleetAnchor, fleetOriginPx, fleetPos, initFleetGeometry, selectedFleetIds, spinOrbits, strikeWorldPos } from './fleetGeometry';
import { drawRadarContacts, drawRadarCoverage, drawRadarRange, drawScanSweep, forgetRadarContacts, initMapRadar, netSignatures, ownRadarSources, setSweepOpacity, sweepOpacity, takeNetSignatures, updateRadarContacts, type RadarSources } from './mapRadar';
import { apply, initOrderPipeline, playerOrder, settleOrder } from './orderPipeline';
import {
  forceIntroduced,
  hideTrainingBoard,
  resetTrainingScenario,
  tickTrainingScenario,
  type TrainingScenarioHost,
} from './trainingScenario';
import { startSimLink, workerPort, type SimLink } from './simLink';
import { autoRetreatAt, cancelWarPrompt, confirmLoadPrompt, confirmWarPrompt, forgetAutoAssault, initGroupOrders, orderPromptOpen, restoreAutoAssault, soloAutoAssault } from './groupOrders';
import {
  cancelMobileOrder,
  initCmdActions,
  mobileOrderKind,
  mobileTargetAvailable,
  mobileTargetLabel,
} from './cmdActions';
import { initCmdBar, invalidateCmdBar, renderCmdBar } from './cmdBar';
import { flushPinch, forgetAdditive, initMapInput, selectionBox, tapByTouch } from './mapInput';
import { chainMode, dropChainMenu, exitChainMode, forgetChainRoutes, initChainComposer } from './chainComposer';
import { activeConstruction, coreQueue, enqueueBuild, initWorldQueries, progressPct, timeLeft } from './worldQueries';
import { handleEvents, initEventFeed, killStats, logLines, note, resetEventFeed, toast } from './eventFeed';
import {
  PLAY_BASE,
  applyTimeSpeed,
  closeSwarmDossier,
  forgetStatusLine,
  hideSwarmDossier,
  initTopBar,
  renderSpeedbar,
  renderSwarmDossier,
  renderTopBar,
  resetThreatAlerts,
  swarmDossierPinned,
  updateThreatAlerts,
} from './matchTopBar';
// ST-2/ST-3 — «Хранитель»: the window is REFM-7; its read-only helpers are shared with
// the threat alert (`stewFmtDur`, `matchTopBar.ts`), the side panel (`stewardTechDone`)
// and the morning report (`stewMetrics`).
import { battleRetreats, initBattleWindow } from './battleScreen';
import {
  initSteward,
} from './stewardScreen';
import { initArsenal } from './arsenalScreen';
import { initMetaMarket } from './metaMarketScreen';
import { initMetaEconomy } from './metaEconomyScreen';
import { initShop } from './shopScreen';
import { initNews } from './newsScreen';
import { initHubWallet } from './hubWallet';
// DEV TEST MODE — self-contained dev-only scenarios; remove this import + the
// initTestMode(...) call below + the #testmode HTML/CSS to cut it cleanly.
// (The player build already does: the only uses sit under `!__PLAYER_BUILD__`, so
// esbuild tree-shakes the whole module out of that bundle.)
import { initTestMode, openTestMode } from './testmode';
import { pullNextDevWave } from './sectorZeroDev';
// SANDBOX — self-contained dev-only single-player "practice tools"; remove this
// import + the fenced hooks below (setup checkbox, frame enforce/fog, free-build
// snapshot, initSandbox call) + the #sandbox HTML/CSS to cut it cleanly.
import {
  sandboxConfig,
  resetSandboxConfig,
  resetSandboxRuntime,
  enforceSandbox,
  initSandbox,
  setSandboxButton,
} from './sandbox';
// Обучение (ONB-0/1/2/7) — у владельца `guideFlow.ts` (REFM-221): тур по HUD, флаг
// пройденного обучения, ведомый первый матч, цели первой сессии.
import {
  activeTour,
  forgetLesson,
  initGuideFlow,
  launchTour,
  lessonRunning,
  loadOnboard,
  maybeStartPendingTour,
  setPendingGuide,
  stopFirstGoals,
  updateGoals,
} from './guideFlow';
// TRN-2 — тур полигона: собирается здесь, запускается лаунчером `guideFlow.ts`.
import { buildTrainingTour } from './trainingTour';
import { trainingTourUi } from './trainingTourDom';
import { trainingFlagshipMerge } from '../../decisions/trainingGuide';
import { startFleetMerges } from '../../decisions/startFleets';
import { trainingBaseline } from '../../decisions/trainingStages';
// Справка (ONB-3/4/5) — у владельца `helpCenter.ts` (REFM-221): справочник и его поиск,
// карточка корабля, вводные к механикам, сводка «пока вас не было».
import { forgetAway, initHelpCenter, maybeIntro, openCodex, openShipCard } from './helpCenter';
import { HOLD_TIP_MS, holdTipPos, movedTooFar } from './tipPlacement';
import {
  IDLE,
  consumeClick,
  mature,
  moveAway,
  press,
  release,
  type HoldState,
} from '../../decisions/holdPress';
import { CLEARED, needsClearing, overlayAlarm, overlayShown, overlayText } from './netOverlay';
import {
  BANNER_FORGOTTEN,
  bannerOffersRestart,
} from './matchExits';
import { INTEL_MS, PROGRESS_MS, intelVisible, repaintDue } from './liveWindows';
import {
  allyAim,
  anyArmed,
  arm,
  cmdMore,
  disarm,
  drop,
  hasSelection,
  inspectFleet,
  mobileChoices,
  offerChoices,
  pickFleets,
  pickMode,
  pickStrike,
  pickWorld,
  pruneSelection,
  selFleet,
  selFleets,
  selPlanet,
  selStrike,
  splitState,
  stageDraft,
  strikeAim,
} from './interaction';
import {
} from './fleetEffects';
import {
  advanceTarget,
  fpsNext,
  saneGap,
  simRuns,
  spinRuns,
  stepBacklog,
} from '../../decisions/simClock';
import { simWorkerScript } from '../../decisions/simWorker';
import {
  JUDGE_WARMUP_MS,
  judgingFrames,
  mapDpr,
  sharpnessMatters,
  slowFrames,
} from '../../decisions/mapSharpness';
import {
  NET_VIEW_IDLE,
  netViewAt,
  netViewFollow,
  netViewSettled,
  netViewSnapshot,
  type NetViewShown,
} from '../../decisions/netViewClock';
import { mountLocaleMenu } from './localeMenu';
import { mapLod, mapSpacing, type MapLod } from '../../packages/client/src/mapLod';
import { authorizedBase } from '../../decisions/hubAuth';
import { joinLanding } from '../../decisions/joinLanding';
import { refusalText as errText } from '../../decisions/refusalText';
import { detach } from './detach';
import { claimIntent, matchIdFrom } from '../../decisions/matchAddress';
import { httpBase } from '../../decisions/matchQuery';
import { toggleInSelection } from '../../decisions/fleetSelection';
import { fleetsUnderTap } from '../../decisions/tapTargets';
import { defaultServerField, resolveAddress, resolveBase } from '../../decisions/serverAddress';
import { radarContacts } from './snapshotIngest';
import { GOTO_MIN_ZOOM } from './mapJump';
// FRIENDS-1 — вкладка «Друзья»: список и заявки живут на аккаунте (сервер решает).
import { initFriends } from './friendsScreen';
import { initRank } from './rankScreen';
import { aaRings, type RangeRing } from './combatRanges';
// Остаток SHU-3.1: где сейчас летящая эскадра и по какой линии (чистые решения).
// ONB-0 — какой хаб показать новичку (флаг обучения хранит `guideFlow.ts`).
import { welcomeMode } from './onboarding';
import type {
  GameState,
  Fleet,
} from '../../packages/shared-core/src/index';

// --- constants ---------------------------------------------------------------

// --- side-colour SCHEMES and map constants -----------------------------------
// Палитра сторон и константы карты — у владельца, `mapPalette.ts` (REFM-237). Отсюда —
// только то, что принадлежит игре: мир, своё место и канвас карты.
initMapPalette({
  world: () => s,
  me: () => ME,
  ctx: () => cx,
  dpr: () => DPR,
});
// Build profile. `__PLAYER_BUILD__` is an esbuild define — REQUIRED by every bundler
// of this file (build.mjs sets it for both artifacts, uitest.mjs pins `false`); a
// missing define fails loudly at boot with this exact name. `true` bakes the PLAYER
// artifact (void-dominion-player.html): the dev affordances gated on it below (test
// mode, single-player skirmish, time acceleration) are compiled OUT of the bundle
// (the literal define is what lets esbuild dead-code-eliminate the branches — a
// `const` alias would fold but not propagate), and build.mjs strips their markup.
// `false` = the full dev client, today's behavior unchanged.
declare const __PLAYER_BUILD__: boolean;
// Product profile (`YAG-1.1c`) — REQUIRED by every bundler, like `__PLAYER_BUILD__`.
// `true` bakes ONLY the platform archive (dist/yandex/): Sector Zero without the rest of
// Void Dominion. The hub screens, the live-match tools a run never shows (chat, pings,
// corporation, market, steward — `decisions/sectorZeroTools.ts`), the link doors
// (`?join=`, `?reset=`) and the APK updater are compiled out. Cut with a CONDITION —
// `__SECTOR_ZERO_ONLY__ ? null : initX(…)` or `if (!__SECTOR_ZERO_ONLY__) …` — never with
// an early `return`: esbuild drops the imports of an unreachable branch, but code after a
// `return` still holds on to them. What must stay out is checked against the bundler's
// own inventory in `platform/productCut.test.ts`.
declare const __SECTOR_ZERO_ONLY__: boolean;
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
let MAP = LEGACY_MAP;
let SCORE_LIMIT = LEGACY_SCORE_LIMIT;
// H4-REVERT: наземные юниты вернулись в общий конвейер. Пока их поднимала мобилизация
// дивизии, этот массив был чисто космическим — и снос дивизий без этой строки оставил
// бы игрока вовсе без сухопутных войск, то есть без второй фазы захвата мира.
// Панель уже раскладывает их по своим полкам (`groundBuilds` / `shipBuilds` /
// `wingBuilds` фильтруют этот же список), так что достаточно их сюда вписать.
const BUILD_UNITS = [
  'frigate',
  'cruiser',
  'heavy_cruiser',
  'scout',
  'picket_frigate',
  'shuttle_carrier',
  'interceptor',
  'bomber',
  'heavy_striker',
  'landing_shuttle',
  'militia',
  'heavy_infantry',
  'special_forces',
  'tank',
];
// A small glyph per province KIND, drawn above each province so its type reads at a
// glance (planet / asteroid / nebula / wreck-field / storm / …). Text glyphs only.
let ME = 'p1';

// --- state -------------------------------------------------------------------

let s: GameState = newGame();
let speed = 1 / 3600; // game-hours per real second (0 = paused); ×1 = wall-clock, overwritten at launch
let banner: string | null = null;
// Terminal end screen (the match-over overlay): outcome + reason + XP award, filled
// once by checkEnd from the authoritative `match` state. `dismissed` lets the player
// hide it to look at the final board (the match stays frozen). Reset on a fresh match
// / reconnect so a new game never opens straight into the old result.
let endScreen: MatchEnd | null = null;
// Выбор (`selFleet`, `selPlanet`, `selFleets`, осмотр `inspectFleet`, мобильные `mobileDraft`
// и `mobileChoices`) и прицелы, режимы и окна командного ряда (`aiming`, `castMenu`,
// `splitState`…) живут в `interaction.ts` (REFM-207, REFM-208): их меняют только функции
// владельца — `pick*`, `arm`/`drop`, `disarm(повод)`.
let lastHeroCardRefresh = 0;
/** До какого момента (ms, `performance.now`) чип союзника мигает после встречи. */
let allyPulseUntil = 0;

// --- session diplomacy & comms menu state ------------------------------------
// Лента сообщений сессии и счётчик непрочитанного живут в `messageLog.ts` (REFM-214):
// `main.ts` читает их живыми привязками, пишут только двери модуля. Окна, часы мира и
// сеть лента получает хуками; перерисовка — та же, что у снятия метки в `pingUi`.
initMessageLog({
  now: () => s.time,
  me: () => ME,
  changed: repaintFeeds,
  chat: () => (NET && netClient ? netClient : null),
  note,
  provinceName: placeName,
});
// --- floating chat window (desktop only) -------------------------------------
// REFM-12: окно уехало в `chatWindow.ts` целиком — состояние, разметка, геометрия и
// кэш настроек живут там. Здесь только сборка, и она стоит ИМЕННО ЗДЕСЬ, а не рядом
// с остальным UI внизу файла: `resize()` (строкой ниже по файлу, вызывается
// синхронно при загрузке) спрашивает у окна `onViewportResize`, поэтому привязка
// обязана существовать раньше. Внизу она попала бы в temporal dead zone и уронила
// бы загрузку целиком. Все зависимости взяты ленивo — стрелками, поэтому объявленные
// ниже `NAME`/`VW`/`MOBILE` читаются в момент вызова, а не сейчас.
// пользуются рейл, реестр слоёв Back/Escape и приход нового сообщения.
const chatWin = __SECTOR_ZERO_ONLY__
  ? null
  : initChat(
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
        premium: () => premiumRunning(),
      },
      CH_SESSION,
    );
document.getElementById('rail-chat')?.addEventListener('click', () => chatWin?.toggle());

// Окно дипломатии, карточки мест, вкладка разведки и составление реплики живут в
// `diploWindow.ts` (REFM-214): `main.ts` читает открытое окно и вкладку живыми привязками,
// открывает и закрывает их дверями. Мир, имена, цвета, приказы и карту окно получает хуками.
initDiploWindow({
  state: () => s,
  me: () => ME,
  net: () => NET,
  online: () => !!netClient,
  names: () => NAME,
  localAi: (id) => AI_PLAYERS.has(id),
  seats: SEAT_META,
  scoreLimit: () => SCORE_LIMIT,
  killStats: () => killStats,
  ownerColor,
  stanceCol,
  myIntel,
  placeName,
  note,
  playerOrder,
  maybeIntro,
  sectorZeroToolsHidden,
  sendProvincePing,
  focusWorld,
  jumpToPing,
  openProfile: (login) => profile?.open(login),
  refreshChat: () => chatWin?.refreshIfVisible(),
  seatNick,
  refreshNicks: () => pullSeatNicks(),
});
// COAL-1: окно коалиций — кнопка полосы `#rail-coal`.
initCoalitionWindow({ state: () => s, me: () => ME, names: () => NAME, ownerColor, playerOrder });

/** Ники соседей по сетевой партии — из расклада мест сервера (`decisions/seatNicks.ts`).
 *  В состоянии мира их нет: там имя дома. Пришли новые — перерисовать дипломатию. */
function pullSeatNicks(force = false): void {
  if (!NET) return;
  const srv = resolveServer();
  if (!srv) return;
  refreshSeatNicks(
    srv.base,
    netMatchId(),
    srv.nick,
    () => {
      if (diploOpen && diploTab === 'diplo') renderDiplo();
    },
    force,
  );
}

// --- multiplayer (net mode) --------------------------------------------------
// Сетевой жизненный цикл — `netSession.ts` (REFM-216): признак сети, сокет, клиент места,
// переподключение, пинг и замер. Его признаки `main.ts` читает живыми привязками, а мир,
// выбор, экраны, баннер и строку статуса отдаёт хуками ниже.
initNetSession({
  status: (text) => {
    statusEl.textContent = text;
  },
  statusText: () => statusEl.textContent ?? '',
  note,
  sound: (id) => snd.play(id),
  banner: () => banner,
  setBanner: (text) => {
    banner = text;
  },
  leaveLocal: () => {
    leaveSolo();
    setRunActive(false);
  },
  resolveServer,
  enter: (playerId, fanfare) => {
    if (fanfare) needMapPreparation();
    if (fanfare) snd.play('start');
    ME = playerId ?? ME;
    pullSeatNicks(true); // кто сидит в соседних креслах — для дипломатии
    disarm('match', MOBILE); // как в соло: выбор, прицелы и окна старой сессии гаснут одной строкой
    endScreen = null; // joining a match must not carry the previous result
    matchEnd.reset(); // переподключение к матчу считает его конец заново
    if (chainMode) exitChainMode(); // черновик прежней сессии не переносится
    forgetChainRoutes();
    showConnect(false);
    showHub(false); // hide the hub so inMatch() is true → Back works (BF-31)
    // Экран настройки — по той же причине. Вход из обозревателя партий открывает
    // партию в СВЕЖЕМ документе (`/game/<id>`), где этот экран никто не прятал: его
    // инлайновый display пуст, `inMatch()` читал «настройка открыта», и ‹, Back и
    // Escape «закрывали» её поверх живой партии вместо выхода (нашёл `smoke:net`).
    setupEl.style.display = 'none';
    // Тоста «подключён как …» нет: игрок и так видит свою партию, а служебная строка о
    // соединении была шумом (плейтест 2026-10-17).
  },
  takeSnapshot: (snap, plan) => {
    // Дипломатию, пропущенную в обрыве, досказывает только переподключение
    // (`netWelcome.ts`, правило 6): живая дельта везёт её событиями, а первый вход
    // сравнивал бы мир партии с миром хаба или прошлой схватки.
    const diploShift = plan.catchUp && s !== snap.state && diffNetDiplomacy(s, snap.state);
    const changedMap = s.mapId !== snap.state.mapId || plan.admit;
    s = snap.state;
    if (changedMap) installMapGeometry(s);
    syncPlayerNames(s);
    // Radar picture (BF-18): detected-but-unidentified enemy fleets are absent
    // from the fogged state — the server sends them as coarse contacts beside
    // each frame. The sweep paints THESE in NET (see updateRadarContacts).
    // Что снимок делает с миром — `snapshotIngest.ts` (REFM-146): контакты живут
    // ровно один снимок (иначе на карте остаётся призрак), а выбор чистится
    // по-разному для одиночного и группового.
    takeNetSignatures(radarContacts(snap.signatures));
    // Re-render the open roster only NOW — the new state is in place, so the
    // stance chips and offer affordances (✓ accept / ⏳ pending) paint fresh.
    if (diploShift && diploOpen && diploTab === 'diplo') renderDiplo();
    if (snap.playerId) ME = snap.playerId;
    // FOG-13: зрение этого снимка, а не прошлого. События дельты едут в журнал сразу
    // после снимка, раньше первого кадра (`onEvents`), а сервер пропустил их по
    // опознанным узлам ЭТОГО снимка: и новая карта, и мир, открывшийся обычной
    // дельтой (замечание Codex на #1490). Кадр следом возьмёт то же зрение из памяти.
    refreshVision(); // every snapshot: its delta's events follow
    if (changedMap && plan.fanfare) defaultView();
    // Та же чистка выбора, что после хода локального мира (REFM-208): `s` заменён здесь
    // напрямую, мимо `apply`. Своя копия правил не закрывала окно деления и ⇅-меню.
    pruneSelection(s.fleets, ME, s.strikes);
    invalidatePanel();
    syncCoalitions(); // чужая правка коалиции приходит дельтой без события
  },
  events: (events) => {
    handleEvents(events);
    push?.onEvents(events, ME); // UIX-4.4: первая спокойная своя новость — спросить о push
  },
  pingProvince: (target) => provinceForPing(target, MAP),
  closePingPop: () => pings?.closePop(),
  fps: () => fpsEma,
  showConnect: (show) => showConnect(show),
  connectShown: () => connectShown(),
  openHub,
  cameFromLink: () => cameFromLink,
});
// Часы картинки в сети (`netViewClock.ts`): снимок сервера приходит раз в секунду, и без
// досчёта флоты на карте двигались бы рывками раз в секунду при любом FPS. Часы ведёт
// `netSession.ts` (`netView`), показанное время досчитывает кадр: он следует за оценкой
// часов и назад не едет (правило 7).
let netShownTime = 0;
let netShown: NetViewShown | null = null;
/** Игровое «сейчас» ДЛЯ КАРТИНКИ движения: в соло — время мира (оно и так идёт каждый
 *  кадр), в сети — время снимка, досчитанное до этого кадра. Только для того, ГДЕ рисовать
 *  движущееся; правила, приказы и таймеры читают `s.time`. */
function mapNow(): number {
  // Серверный мир рисуется по часам картинки и на обрыве (`netWorld`): иначе флоты на миг
  // отъезжали бы ко времени последнего снимка и прыгали обратно на переподключении.
  return netWorld ? netShownTime : simLink ? simShownTime : s.time;
}
// Player ids the local sim drives as AI (empty seats become AI), each with the
// DIFFICULTY chosen on the setup screen (AIDIFF-1: «слабый» = the old simple bot,
// «сильный» = the full-heuristics one). Default solo = p2 on weak.
let AI_PLAYERS = new Map<string, AiProfile>([['p2', 'weak']]);
// Отдельный поток расчёта соло-мира (`simLink.ts`): мир обычной схватки считает он, а кадр
// только рисует. Файл потока (и для дев-сборки с диска — исходник строкой) кладёт сборка
// (`build.mjs`); откуда поднимать — `decisions/simWorker.ts`. Не поднялся — мир идёт в кадре.
declare const __SIM_WORKER_URL__: string | undefined;
declare const __SIM_WORKER_SRC__: string | undefined;
const SIM_WORKER = simWorkerScript({
  protocol: location.protocol,
  query: new URLSearchParams(location.search).get('sim'),
  url: typeof __SIM_WORKER_URL__ === 'string' ? __SIM_WORKER_URL__ : '',
  source: typeof __SIM_WORKER_SRC__ === 'string' ? __SIM_WORKER_SRC__ : '',
});
let simLink: SimLink | null = null;
/** Поток не поднялся или сломался — до перезагрузки мир идёт в кадре. */
let simBroken = false;
/** Игровое время, накопленное кадрами к следующему шагу потока (`stepBacklog`). */
let simBacklog = 0;
/** Часы картинки между шагами потока — те же, что у сети между снимками сервера. */
let simView = NET_VIEW_IDLE;
let simShownTime = 0;
/** Поток считает только обычную схватку: забег, обучение, полигон, песочница и сеть ведут
 *  мир в кадре — там экран сам правит мир и ждёт итог приказа сразу. */
function simEligible(): boolean {
  return (
    SIM_WORKER !== null &&
    !simBroken &&
    !netWorld &&
    soloSaveActive &&
    !s.pve &&
    inMatch() &&
    !(!__PLAYER_BUILD__ && sandboxConfig.enabled)
  );
}
function stopSim(): void {
  simLink?.stop();
  simLink = null;
  simBacklog = 0;
  simView = NET_VIEW_IDLE;
}
// SANDBOX — the home world of the local player (immortal-home target), captured at
// launch. `sandboxConfig.enabled`/toggles live in ./sandbox; this is the only host var.
let sandboxHomeId: string | null = null;
let lastLogHtml = '';
let lastPendHtml = '';
// --- fog of war (renderer projection; always on) -----------------------------
// Client-side projection just for the renderer — NOT the real security boundary
// (that is `visibleState` in shared-core). Зрение кадра и память разведки — `mapFog.ts`.

// --- dom ---------------------------------------------------------------------

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const canvas = $('map') as unknown as HTMLCanvasElement;
const mapContextOptions = canvasCompatibilityOptions();
const cx = (mapContextOptions ? canvas.getContext('2d', mapContextOptions) : canvas.getContext('2d')) as CanvasRenderingContext2D;
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
const logPendEl = $('log-pending');
const topEl = $('top');
const bannerEl = $('banner');
let lastBannerHtml = ''; // dirty-check so the banner's restart button isn't recreated each frame
const cmdbar = $('cmdbar');
// top-bar right cluster + collapsible rail
const railEl = $('rail');
const railToggle = $('railtoggle');
const railGlyph = $('railglyph');
const crestMark = $('crestmark');
const holoCoarsePointer = window.matchMedia?.('(pointer: coarse)');
const holographic = initHolographicUi({
  commands: cmdbar,
  top: topEl,
  side,
  exit: () => $('topback').click(),
  // ✕ окна выбора закрывает его ЦЕЛИКОМ: набор группы и прицелы тоже. Иначе режим набора
  // держал пустое окно «0 флотов», и крестик его не закрывал (плейтест 2026-09-26).
  dismiss: () => {
    disarm('dismiss', MOBILE); // и выбор забыт: ✕ — это пустое выделение и ☰
    invalidatePanel();
    renderCmdBar();
  },
  details: () => {
    side.querySelector<HTMLElement>('[data-act="fleetinfo"]')?.click();
  },
  selectionKey: () =>
    (selStrike ? `strike:${selStrike}` : '') || selectedFleetIds().join('|') || panelFleet() || selPlanet || '',
  selectionAnchor: () => {
    const fid = panelFleet();
    const fleet = fid && s.fleets[fid];
    const planet = selPlanet && s.planets[selPlanet];
    // Эскадра в воздухе (SHU-6.14) — её значок на трассе: нить окна идёт к нему.
    const aloft = selStrike ? strikeWorldPos(selStrike) : null;
    const at = aloft ? world(aloft) : fleet ? fleetAnchor(fleet) : planet ? world(planet.position) : null;
    return at ? toScreen(at, canvas.getBoundingClientRect(), VW, VH) : null;
  },
});
const mobileHud = initMobileHud({
  side,
  commands: cmdbar,
  dismiss: () => {
    if (mobileChoices.length) offerChoices([]);
    else clearSelection();
  },
  choose: (pick) => {
    offerChoices([]);
    choosePhonePick(pick);
  },
  ping: () => side.querySelector<HTMLButtonElement>('[data-act="ping"]')?.click(),
  summary: () => side.querySelector<HTMLElement>('[data-act="fleetinfo"]')?.click(),
  describe: (key) => {
    openDossier(key);
  },
  resized: () => revealMobileSelection(),
  // UIX-7.1: вкладка переключает выбор между флотом и его миром и запоминается.
  tab: (tab) => {
    const cur = cardTabs();
    if (!cur) return;
    rememberCardTab(tab);
    choosePhonePick(tabPick(cur.pair, tab));
  },
});
/** Выбор с карточки телефона — строкой списка или вкладкой «Флот» / «Мир». */
function choosePhonePick(pick: TapPick): void {
  if (pick.kind === 'fleet') setFleetSelection([pick.id]);
  else if (pick.kind === 'strike') {
    pickStrike(pick.id);
    invalidatePanel();
  } else {
    clearSelection();
    pickWorld(pick.id);
    markSelection(lastReal);
  }
}
/** Вкладки карточки для текущего выбора (`worldFleetTabs.ts`, правило 3). */
function cardTabs() {
  const ids = selectedFleetIds();
  const sel = selPlanet
    ? ({ kind: 'planet', id: selPlanet } as const)
    : ids.length === 1
      ? ({ kind: 'fleet', id: ids[0]! } as const)
      : null;
  return tabsForSelection(sel, pairFacts(s, ME));
}

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
  if (hubAv) { hubAv.textContent = g; hubAv.classList.remove('portrait'); }
  if (!__SECTOR_ZERO_ONLY__) applyProfilePortrait();
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
let SCREEN_DPR = 1; // the screen's pixel density, capped
let DPR = 1; // the map canvas's: the screen's, or one pixel a point (`decisions/mapSharpness.ts`)
let MOBILE = false;
function resize() {
  // The two decisions under this — the DPR cap and what counts as a phone — live in
  // `viewport.ts` (REFM-24), where they are covered by tests.
  const v = measureViewport();
  VW = v.w;
  VH = v.h;
  SCREEN_DPR = v.dpr;
  DPR = mapDpr(v.dpr, mapSharpOn());
  MOBILE = v.mobile;
  // WebView can repeat resize notifications without changing the viewport.
  // Assigning even the SAME canvas size erases its bitmap and resets the context;
  // keep the displayed frame until a real size/DPR change requires a new surface.
  const width = Math.round(VW * DPR);
  const height = Math.round(VH * DPR);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  canvas.style.width = VW + 'px';
  canvas.style.height = VH + 'px';
  chatWin?.onViewportResize(); // the half-screen cap follows the new viewport
}
if (typeof window !== 'undefined') window.addEventListener('resize', resize);
resize();

// Player display preference (client-only, localStorage): show YOUR OWN ping markers
// on the map. Purely visual — the ping itself (chat line, allies' view, the server
// relay) is untouched; allies' pins are always drawn. Default on.
let showOwnPings = readBool('void.showOwnPings', true);
function setShowOwnPings(v: boolean): void {
  showOwnPings = v;
  writeBool('void.showOwnPings', v);
}
// Доход ресурсов в час или в сутки (client-only, localStorage): единица всех скоростей
// ресурсов на экране. Форматтеры спрашивают её сами (`format.ts`), поэтому смена видна на
// следующем кадре — бар и панели перерисуются по изменившейся разметке.
let rateUnit = parseRateUnit(readRaw('void.rateUnit'));
setRateUnit(() => rateUnit);
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
// Радар — у владельца, `mapRadar.ts` (REFM-239): развёртка, контакты и обе картины
// дальности. Отсюда — то, что принадлежит игре: мир, своё место, канвас, экран, кэш кадра,
// лента, имя места и звук засечки.
initMapRadar({
  world: () => s,
  me: () => ME,
  ctx: () => cx,
  vw: () => VW,
  vh: () => VH,
  sources: () => perWorld('radar', ownRadarSources),
  sight: () => perWorld('sight', () => sightCircles(s, ME, data)),
  note,
  placeName,
  ping: () => snd.play('radar'),
});

// Камера карты и рамка — у владельца, `mapCamera.ts` (REFM-231). Отсюда — только то, что
// принадлежит игре: экран, раскладка, мир, своё место и побочные действия перехода.
initMapCamera({
  vw: () => VW,
  vh: () => VH,
  mobile: () => MOBILE,
  console: () => holographic.active(),
  world: () => s,
  me: () => ME,
  select: (id) => {
    pickWorld(id);
    invalidatePanel();
  },
  closeDiplo: () => closeDiplo(),
  ring: flashGo,
});
frameMap(MAP);
// node sector type by id — drives asteroid-junction rendering + capture-by-arrival
let SECTOR_OF: Record<string, string> = Object.fromEntries(MAP.map((n) => [n.id, n.sector]));
let galaxyOutline: Array<{ x: number; y: number }> = [];
let mapNodeSpacing = mapSpacing(MAP);

function installMapGeometry(state: GameState): void {
  forgetMapArt(); // другая карта — другая сеть дорог и местность
  MAP = mapNodesFromState(state);
  mapNodeSpacing = mapSpacing(MAP);
  galaxyOutline = isFrontier(state.mapId) ? frontierOutline(MAP) : [];
  SCORE_LIMIT = scoreLimitFor(state);
  SECTOR_OF = Object.fromEntries(MAP.map((n) => [n.id, n.sector]));
  frameMap(MAP);
  needMapPreparation();
  for (const p of Object.values(state.players)) if (p.npc) COLOR[p.id] = p.npc === 'pirate' ? '#f17457' : p.npc === 'swarm' ? '#8eb858' : '#b79bea';
}
/** Sector-type def of a node. SECTOR_OF is total for the generated MAP, but the type
 *  can't promise that for an arbitrary id — fail-soft to undefined (callers `?.`). */
function sectorTypeOf(id: string) {
  const kind = SECTOR_OF[id];
  return kind === undefined ? undefined : SECTOR_TYPES[kind];
}
/**
 * Волна на границах провинций (M2.9, решение владельца: «в космосе нет прямых углов»).
 *
 * Числа заданы в МИРОВЫХ единицах и переводятся в локальные координаты мозаики умножением
 * на подгон карты под экран: `territoryGeometry.shape` уже поделил экранные на зум, но
 * не на подгон. Из-за этого изгиб не зависит от приближения — правило кирпича.
 *
 * Амплитуда взята долей от шага между провинциями (~260 мировых единиц на шипнутых
 * картах): заметно глазу, но далеко от того, чтобы клетка полезла на соседнюю.
 */
function provinceWave(): { amp: number; wavelength: number; segment: number } {
  const fit = camFitTransform(insets(), mapBounds()).scale;
  return { amp: 11 * fit, wavelength: 190 * fit, segment: 26 * fit };
}

function currentMapLod(): MapLod {
  return mapLod(worldDist(mapNodeSpacing), cam.scale);
}
// Re-validate the camera after a real resize (orientation / window). Attached after
// `cam` exists so the initial in-module resize() call never touches it (TDZ-safe).
if (typeof window !== 'undefined') window.addEventListener('resize', () => {
  clampCam();
  requestAnimationFrame(revealMobileSelection);
});

// --- helpers -----------------------------------------------------------------

// Запросы к миру и очередь стройки — у владельца, `worldQueries.ts` (REFM-242). Отсюда —
// то, что принадлежит игре: мир, своё место, лента, имя места, путь приказа и замок здания.
initWorldQueries({
  world: () => s,
  me: () => ME,
  note,
  placeName,
  playerOrder,
  buildingLocked,
});
// Крыло — это САМИ МАШИНЫ и только они (ROS-3.2): вкладка «Челноки» держит
// перехватчик, бомбардировщик и десантный челнок, а НОСИТЕЛЬ («Шаттл») — корабль
// линии и живёт среди кораблей. Он их возит, как авианосец возит авиацию, и от этого
// челноком не становится.
// Само правило живёт в `planetSummary.ts` (REFM-38) — одно место, где «крыло»
// отделено от корабля линии, иначе один и тот же корпус считается дважды.
const isShuttle = (u: string) => isWingUnit(u, data);
/** Compact number like Iron Order's bar: 15.7k, 728, … */

// Returns HTML (resource-tinted tokens) — callers feed innerHTML, don't esc() this.
/** Та же цена ПЛОСКИМ текстом — для мест, где подпись уходит через `esc()`
 *  (`btn()`, `codexTile()`): там HTML из `cost()` показался бы игроку как разметка. */
// Геометрия флотов — у владельца, `fleetGeometry.ts` (REFM-238). Отсюда — то, что
// принадлежит игре: мир, своё место, часы картинки, детализация и кэши дорог и кадра.
initFleetGeometry({
  world: () => s,
  me: () => ME,
  now: () => mapNow(),
  lod: () => currentMapLod(),
  forkMarks: () => roadDrawingOf(s).marks,
  orbits: () => perWorld('orbits', () => orbitSeats(Object.values(s.fleets), (g) => isEmplacementFleet(g, data))),
});

/** Имя соединения в карточке и списках: «Флот «ПОЗЫВНОЙ»», а крепость зовётся
 *  крепостью — она сооружение, а не флот (`emplacement.ts`). */
function fleetTitleOf(id: string): string {
  const f = s.fleets[id];
  if (f && isEmplacementFleet(f, data)) return t('fleet.kind.fortress');
  return `${t(FLEET_KIND_KEY)} «${fleetCallsign(id)}»`;
}


/** Division ⇄ hold transport for a docked fleet `f` over world `here`: load the
 *  player's garrisoning divisions (if they fit the free hold) and unload the ones it
 *  carries (onto an enemy world = a landing). Empty string when there's nothing to do. */

let hologramTime = 0; // visual-only clock; also freezes when decorative motion is disabled

// Реакция на события мира и лента — у владельца, `eventFeed.ts` (REFM-230). Отсюда — то, что
// принадлежит игре: мир, своё место, имена, выбор флота, окна и пульс союзника.
initEventFeed({
  world: () => s,
  me: () => ME,
  names: () => NAME,
  placeName,
  fleetTitleOf,
  setFleetSelection,
  splitAwait: () => splitAwait,
  endSplitAwait,
  techTree: () => techTree,
  battleWindow: () => battleWindow,
  pulseAlly: () => {
    allyPulseUntil = performance.now() + 12_000;
  },
});

/** Хранилище браузера не принимает записи (приватный режим, нет места): прогресс не
 *  переживёт закрытия вкладки, и игрок узнаёт об этом сразу, а не после перезагрузки
 *  (плейтест 2026-10-09, PT-07). Плашка стоит над тостами, пока запись не пройдёт снова;
 *  ✕ прячет её до следующего провала. Тост не годится: он гаснет сам за пять секунд. */
function saveWarning(failing: boolean): void {
  const host = document.getElementById('toasts');
  const shown = document.getElementById('savewarn');
  if (!failing || !host) return void shown?.remove();
  if (shown) return;
  const bar = document.createElement('div');
  bar.id = 'savewarn';
  bar.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = t('sector-zero.save-failed');
  const hide = document.createElement('button');
  hide.type = 'button';
  hide.className = 'btn-x';
  hide.textContent = '×';
  hide.setAttribute('aria-label', t('card.close'));
  hide.addEventListener('click', () => bar.remove());
  bar.append(text, hide);
  host.prepend(bar);
}

// Туман карты — у владельца, `mapFog.ts` (REFM-231). Отсюда — то, что принадлежит игре:
// мир, своё место, сеть, контакты радара и круги обзора из кэша кадра.
initMapFog({
  world: () => s,
  me: () => ME,
  net: () => NET,
  contacts: () => netSignatures,
  sight: () => perWorld('sight', () => sightCircles(s, ME, data)),
});

/** Производные мира для кадра (шаг 9 плавности) — по тому же договору, что `visionMemo`.
 *  Доход в шапке, круги обзора, отметки ПКО, дальности радарной развёртки и союзник главы
 *  читают только мир, игрока и данные, а отметки ПКО — ещё и туман кадра. Пока мир, игрок
 *  и зрение — те же объекты, прежний ответ верен: в сети он считается раз на снимок, на
 *  паузе соло — после действия игрока. На 1675 провинциях эти обходы всех миров и флотов
 *  каждым кадром были половиной скрипта сетевого кадра. Сбрасывает память тот, кто правит
 *  мир на месте (песочница, dev-хуки), и смена матча. Что читает ещё что-то — выделение,
 *  камеру, часы вида, — сюда не кладётся: положение флота (`fleetPos` идёт по часам вида)
 *  кадр берёт сам. */
interface WorldDerived {
  income: Record<string, number>;
  sight: SightCircle[];
  aa: RangeRing[];
  radar: RadarSources;
  ally: string | null;
  /** Кто где стоит у мира: кольца и строи боёв (`orbitSeats.ts`). */
  orbits: OrbitSeats<Fleet>;
}
let worldMemo: {
  state: GameState;
  me: string;
  vision: Vision | null;
  got: Partial<WorldDerived>;
} | null = null;
/** `key` для мира этого кадра: считается раз на мир, дальше берётся из памяти. */
function perWorld<K extends keyof WorldDerived>(
  key: K,
  compute: () => WorldDerived[K],
): WorldDerived[K] {
  let memo = worldMemo;
  if (!memo || memo.state !== s || memo.me !== ME || memo.vision !== vision)
    memo = worldMemo = { state: s, me: ME, vision, got: {} };
  if (!(key in memo.got)) memo.got[key] = compute();
  return memo.got[key] as WorldDerived[K];
}

/** Имя места для игрока — одно на подписи, журнал, окно боя и метки (`planetName.ts`):
 *  раньше подпись и журнал на картах без имён показывали координату («бой · C0R2»), а окно
 *  того же боя — авто-имя («Бой: STYX-3»), UIX-5.2. */
function placeName(id: string): string {
  return worldName(s, id);
}

// Конвейер приказа — у владельца, `orderPipeline.ts` (REFM-240): шаг мира, приказ игрока
// и рассказы ленты о вахте, герое и стройке. Отсюда — то, что принадлежит игре: мир и его
// замена шагом, своё место, разбор событий, лента, имя места, звук отказа, тур обучения,
// вставки и окно вахты.
initOrderPipeline({
  world: () => s,
  setWorld: (state) => {
    s = state;
  },
  me: () => ME,
  handleEvents,
  note,
  placeName,
  refusalSound: () => snd.play('error'),
  tour: () => activeTour,
  intro: maybeIntro,
  steward: () => steward,
  forward: (action) => simLink?.forward(action),
});

// Обучение — у владельца, `guideFlow.ts` (REFM-221): лаунчер туров, флаг «обучение
// пройдено», ведомый первый матч и список целей первой сессии. Отсюда — мир, своё место,
// позывной, раскладка, мета-прогресс, переходы хаба, старт партии, лист телефона, рынок и
// медаль за обучение.
initGuideFlow({
  world: () => s,
  me: () => ME,
  callsign: () => nickInput.value.trim(),
  mobile: () => MOBILE,
  panelExpanded: () => mobileHud.expanded(),
  loadMeta,
  saveMeta,
  showHub,
  showConnect: (show) => showConnect(show), // объявлен ниже, у экрана входа
  startMatch,
  sheetExpanded: (key) => mobileHud.expanded(key),
  collapseSheet: () => mobileHud.collapse(),
  refreshSheet: () => updateMobileHud(),
  openMarket: (good) => market?.open(good),
  tutorialEnded: (run) => tutorialMedal?.award(run), // объявлена ниже, у наград хаба
  devUi: () => DEV_UI,
});

// Приказы группе — курс, штурм, запрос войны на пути через мирных, слияние, авто-штурм и
// вход меню десанта — живут в `groupOrders.ts` (REFM-228). Здесь только хуки: мир, своё
// место, лента, имя места из таблицы мест и смена выбора.
initGroupOrders({
  world: () => s,
  me: () => ME,
  note,
  seatName: (id) => NAME[id],
  selectFleets: setFleetSelection,
});

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
  // Что значит выделение (только своё, один или группа, чужой на осмотр) — `pickFleets`.
  pickFleets(ids, (id) => s.fleets[id]?.owner === ME);
  invalidatePanel();
}
/**
 * Чей флот показывает панель. Осмотр чужого (UI-14) уступает ВСЕМУ: он виден, только
 * пока не выбрано ничего своего. Это не вежливость, а структура: так протухший
 * `inspectFleet` не может заслонить свежий выбор мира или флота, и правило держится
 * само, а не дисциплиной в пяти местах, где выбор меняется.
 */
function panelFleet(): string | null {
  if (selFleet || selPlanet || selFleets.size) return selFleet;
  return inspectFleet;
}
function clearSelection() {
  // Пустое выделение забывает выбор (`armDisarm.ts`, правило 16) и гасит то, что держится
  // за него (правило 10): прицелы и меню ряда, набор группы, окно деления, слияние звеньев.
  // Прицелы из окон (отход, каст, удар, союзник) взводятся без выделения и им не гаснут.
  disarm('deselect', MOBILE);
  invalidatePanel();
}

/** Ctrl/⌘-click toggle: fold the current selection into a group and add/remove one. */
function toggleFleetInSelection(id: string) {
  // Ctrl-клик — `fleetSelection.ts` (правила 4–5): текущий одиночный СКЛАДЫВАЕТСЯ в
  // группу (иначе он терялся бы ровно в момент сбора группы), а промах по чужому не
  // трогает набор вовсе — иначе он молча схлопнул бы одиночный в группу из одного.
  const next = toggleInSelection(
    { picked: [...selFleets], single: selFleet },
    id,
    (fid) => s.fleets[fid]?.owner === ME,
  );
  if (next) setFleetSelection(next);
}

// --- red AI ------------------------------------------------------------------
// Ходы ИИ, авто-штурм, столкновения флотов, авто-отступление и цепочки приказов живут в
// `soloDrivers.ts` (REFM-26): в сетевом матче всё это делает сервер, в одиночном —
// подталкивает кадр. Здесь только хуки: состояние, два пути приказов (свой идёт через
// `playerOrder`, чужой применяется локально) и опт-ин авто-штурма.
const solo = initSoloDrivers({
  state: () => s,
  me: () => ME,
  aiSeats: () => AI_PLAYERS,
  applyLocal: (a) => apply(order(s, a, s.time)),
  playerOrder: (a) => void playerOrder(a),
  autoAssault: (id) => soloAutoAssault.has(id),
});

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
  runAward: () => isSectorZeroRun() ? awardSectorRun() : null,
  training: isTraining,
  // Стартовый пакет полигона (§14.7) — один раз на профиль; dev-полигон не платит.
  trainingAward: () =>
    !sectorDevActive && changeSectorProgress({ kind: 'training-reward' }) ? TRAINING_REWARD : null,
  // Dev-забег не засчитывается — его разбивки нет, и чужую (прошлого забега) не показываем.
  runSummary: () =>
    sectorDevActive || sectorProgress.lastRun?.attempt !== sectorAttempt ? null : sectorProgress.lastRun,
});

// --- rendering ---------------------------------------------------------------

// Наложения карты — уголки цели, волны боя, маршруты, трассы, круги патрулей, коридоры и
// радиусы — живут в `mapOverlays.ts` (REFM-233). Мир, кадр, часы карты, кольца ПКО и
// эскадру прицела они получают хуками.
initMapOverlays({
  world: () => s,
  me: () => ME,
  ctx: () => cx,
  now: () => mapNow(),
  aa: () => perWorld('aa', () => aaRings(s, data, ME, known)),
  aimSquadron,
});

// Прицелы и цели — путь к цели, цели «Атаки» и «Штурма», круги каста и патруля, базы
// перелёта — живут в `mapAim.ts` (REFM-233, часть 2). Мир, кадр, узлы карты, раскладку,
// штурмуемость секторов и эскадру прицела они получают хуками.
initMapAim({
  world: () => s,
  me: () => ME,
  ctx: () => cx,
  nodes: () => MAP,
  mobile: () => MOBILE,
  capturable: (id) => sectorTypeOf(id)?.capturable ?? false,
  aimSquadron,
});

// Вспышки и залпы — огонь ПКО и шаттлов, волна захвата, мины, кольцо перехода и малая
// вспышка — живут в `mapEffects.ts` (REFM-234). Мир и кадр они получают хуками.
initMapEffects({
  world: () => s,
  ctx: () => cx,
});

// Метки — цели задач, союзник, ракеты, мины, осада, метки коалиции и цепочки «Приказ» —
// живут в `mapMarks.ts` (REFM-234). Мир, кадр, часы и вид голограммы, метки коалиции и
// задачи забега они получают хуками.
initMapMarks({
  world: () => s,
  me: () => ME,
  ctx: () => cx,
  clock: () => hologramTime,
  holographic: holographicMapOn,
  ownPings: () => showOwnPings,
  pings: () => pings?.drawable() ?? [],
  missionRows: runMissionRows,
  chain: runChain,
});

// Миры карты — искусство узлов, туман, подписи, области и крепости развилок — живут в
// `mapWorlds.ts` (REFM-235). Мир, кадр, узлы, часы и вид голограммы и тип сектора они
// получают хуками.
initMapWorlds({
  world: () => s,
  me: () => ME,
  nodes: () => MAP,
  ctx: () => cx,
  clock: () => hologramTime,
  holographic: holographicMapOn,
  sectorType: sectorTypeOf,
});

// Флоты карты и их бои — значок боя, орбиты, трассы огня, корпуса, трюм и портреты героев —
// живут в `mapFleets.ts` (REFM-235). Мир, место, кадр, часы и вид голограммы и тип сектора
// они получают хуками.
initMapFleets({
  world: () => s,
  me: () => ME,
  ctx: () => cx,
  clock: () => hologramTime,
  holographic: holographicMapOn,
  sectorType: sectorTypeOf,
});

// Статический слой карты — небо и политическая карта, выпеченные под камерой, — живёт в
// `mapLayer.ts` (REFM-232). Мир, кадр, экран и режимы карты он получает хуками.
initMapLayer({
  world: () => s,
  me: () => ME,
  nodes: () => MAP,
  ctx: () => cx,
  vw: () => VW,
  vh: () => VH,
  dpr: () => DPR,
  mobile: () => MOBILE,
  fps: () => fpsEma,
  outline: () => galaxyOutline,
  holographic: holographicMapOn,
  sectorType: sectorTypeOf,
  wave: provinceWave,
  lod: currentMapLod,
  surfacesLost: forgetBorderLayer,
});

// Слой живых границ — `borderLayer.ts` (REFM-232, часть 2). Контекст кадра, экран и часы
// голограммы он получает хуками.
initBorderLayer({
  ctx: () => cx,
  vw: () => VW,
  vh: () => VH,
  dpr: () => DPR,
  clock: () => hologramTime,
});

// Поверхность карты — живые границы, стекло, блики, выделение провинции и волна захвата —
// живёт в `mapSurface.ts` (REFM-235). Контекст кадра, экран, часы и вид голограммы она
// получает хуками.
initMapSurface({
  ctx: () => cx,
  vw: () => VW,
  vh: () => VH,
  dpr: () => DPR,
  clock: () => hologramTime,
  holographic: holographicMapOn,
});

/** Подпись карты в списках партий и на двери «Продолжить» хаба. Обе карты Фронтира
 *  показываются одним именем — раньше это был тернарник, скопированный в два места, и два
 *  ключа локали с ОДИНАКОВЫМ текстом. Третья карта теперь не потребует правок в двух списках. */
function mapLabel(mapId: string | undefined): string {
  if (mapId === 'duel-1') return t('setup.map.duel-1');
  if (mapId === 'ffa-4') return t('setup.map.ffa-4');
  if (mapId === 'team-2v2') return t('setup.map.team-2v2');
  if (mapId === 'team-3v3') return t('setup.map.team-3v3');
  if (mapId === 'ffa-20') return t('setup.map.ffa-20');
  if (mapId === 'ffa-50') return t('setup.map.ffa-50');
  return isFrontier(mapId) ? t('map.frontier') : mapId === 'nexus' ? t('map.nexus') : (mapId ?? '');
}

/** Map art is shared by desktop and phone; floating windows remain desktop-only. */
function holographicMapOn(): boolean {
  return holographic.active() || MOBILE;
}

// Заставка входа в карту — `mapLoading.ts` (REFM-241); рецепт подготовки — фон, выпечка,
// местность — у слоя карты в `mapLayer.ts` (REFM-232).
initMapLoading({
  entered: () => inMatch() && (!NET || netAdmitted),
  viewport: () => `${VW}:${VH}:${DPR}:${holographicMapOn()}`,
  jobs: mapPreparationJobs,
  failed: forgetMapBake,
  leave: () => $('tomenu').click(), // the same intentional leave/solo pause as the HUD button
});

/**
 * Кадр карты — слои снизу вверх (REFM-235). Порядок вызовов и есть картинка: каждый слой
 * ложится поверх предыдущих, поэтому слой переставляют только вместе с решением, что должно
 * его закрывать. Слои живут у своих владельцев; здесь только их порядок.
 *
 * Semantic zoom (LOD): zoomed far out the map turns SCHEMATIC — holo type badges, callout
 * text, fleet pyramids/cargo/counts, orbit rings and battle timers dissolve with screen
 * density and the whole-map camera overview, leaving territories, uniform rings, fleet
 * chevrons, battle pulses and pings. Skipping those draws over the widest views — where the
 * most nodes are on screen at once — is also the frame-time win. Сам закон и его следствия —
 * `semanticZoom.ts` (REFM-93).
 */
function renderMap(now: number) {
  if (cx.isContextLost?.()) return;
  cx.setTransform(DPR, 0, 0, DPR, 0, 0); // draw in CSS pixels, crisp on hi-DPI
  const lod = currentMapLod();
  const detail = lod.detail;

  // 1. Поверхность: небо и политическая карта из выпечки, над ними стекло и выделение.
  blitStaticLayer(now); // sky + political map (a cached bake, moved with the camera)
  drawMapSurface(now, lod); // в пространстве выпечки: живые границы, стекло, блики, выделение провинции, волна захвата

  // 2. Радар: развёртка, её контакты и покрытие.
  drawScanSweep(now); // slow radar sweep — pure console chrome
  updateRadarContacts(now); // the arm paints enemy signatures as it crosses them
  updateThreatAlerts(); // «враг у ваших рубежей» — once per game step
  drawRadarCoverage(); // my sensor reach (radar arrays + ships)

  // 3. Наложения под мирами: сеть Роя, маршруты, патрули, вылеты, мины и ракеты, вспышки.
  drawSwarmNet(); // сеть Роя: круги связи разведанных узлов
  drawFleetRoutes();
  drawRallyPoint(); // RALLY-1: точка сбора выбранного мира-верфи
  drawPatrolRings(); // SHU-6.3: круг патруля и остаток висения — под значками вылетов
  drawSeenPatrols(); // SHU-6.10: чужой висящий патруль в моём обзоре — круг и состав
  drawStrikeTrails(now); // остаток SHU-3.1: вылет в воздухе виден на карте
  drawOrdnance(cx, mineView(), ME, world, cam.scale);
  drawMissiles(); // SM-3.7b: летящая ракета — отряд, но рисуется стрелкой с курсом
  mineControls.refresh();
  drawGoFlash(now); // brief ring on a world reached via a plan row's target link
  drawNoticeFlashes(now); // UIX-4.1: своя постройка готова, свой флот дошёл

  // 4. Бои и огонь.
  drawBattles(now, detail); // значок боя над схваткой с отсчётом до раунда
  drawFlak(); // H2: трассы огня ПКО, перехвата, корабельного ПВО и ударов шаттлов

  // 5. Миры: дальномер выбранного, засветка развёртки под метками, сами узлы.
  // selected sector: its radar detection radius (a physical circle in map space →
  // an axis-aligned ellipse on screen because the fit projection is non-uniform).
  drawRadarRange(now);
  drawSweepAfterglow(lod); // засветка узлов там, где прошёл луч развёртки
  drawWorlds(now, lod); // миры: имена своих на схеме, области, узлы, туман, подписи, крепости развилок

  // 6. Флоты: орбиты, трассы огня между строями, корпуса и портреты; контакты радара поверх.
  drawOrbitRings(now, detail); // кольцо орбиты у мира со стоящим флотом
  drawBattleTracers(now); // трассы огня между строями боя
  drawFleets(now, lod); // флоты: корпус доминанта, счёт, трюм, рамка выбора, портреты героев
  drawRadarContacts(now); // swept enemy signatures — last-known ghosts until repainted

  // 7. Верхний слой: рамка выделения, метки, цели, радиусы и прицелы.
  drawSelectionBox(selectionBox); // рамка выделения флотов протяжкой
  drawPings(now); // ally ping markers (coalition), with screen hit-boxes for taps
  drawChainOverlay(now); // CHAIN-UX: цепочки планов + черновик режима «Приказ»
  drawAssaultTargets();
  drawEngageTargets(lastReal);
  drawMissionTargets();
  drawAllyMarks(); // глава IV: цель операции союзника и носитель накопителя
  drawMineFlashes(now); // SM-3.5: вспышка срабатывания мин
  drawMinefields(); // SM-3.5: свои минные поля «💣 ×заряд» и установки
  drawDevourSieges(); // PVR-4.7: осада «Поглощения мира» над своим миром — кольцо-часы и отсчёт
  drawCorridors(now); // HERO-CORRIDOR: временные коридоры героев
  drawCombatRanges(); // RANGE-UX: артиллерия / эскадрилья / ПКО — до прицельных линий
  drawAbilityRings(); // ABIL-RING: уже работающие ауры и сканы — фиолетовым пунктиром
  drawCourseReach(); // UIX-7.2: ближайшие миры под «Курс» — кольцо и срок пути
  drawAimPreview(lastReal);
  drawCastAim(); // CAST-UX: дальность каста + область действия
  drawPatrolAim(); // SHU-6.3: круг патруля под указателем
  drawRelocateTargets(lastReal); // SHU-6.5: базы, куда эскадра перелетит
}

// --- side panel --------------------------------------------------------------

// Карточка мира, ангар и карточки эскадр — у владельца, `worldCard.ts` (REFM-223). Отсюда —
// то, что принадлежит игре: мир, место, имена, открытая вкладка, плитки гарнизона и карта узлов.
initWorldCard({
  world: () => s,
  me: () => ME,
  names: () => NAME,
  planetTab: () => planetTab,
  buildUnits: () => BUILD_UNITS,
  devUi: () => DEV_UI,
  sectorOf: (id) => SECTOR_OF[id],
  sectorType: sectorTypeOf,
  garrisonTiles: garrisonTilesHtml,
  sectorZeroToolsHidden,
});

// Карточка флота, группы, мин и ракеты, плитки юнитов — у владельца, `fleetCard.ts` (REFM-224).
// Карточка эскадры в воздухе и всплывашка надбавок — там же. Отсюда — то, что принадлежит
// игре: мир, место, имена, открытая сводка армии, окно консоли, видимые мины, часы карты,
// имя флота, тип сектора, эскадра вылета и её база, флот листа и досье параметра.
initFleetCard({
  world: () => s,
  me: () => ME,
  names: () => NAME,
  fleetInfoFor: () => fleetInfoFor,
  consoleFleet,
  mineView,
  mapNow,
  fleetTitleOf,
  sectorType: sectorTypeOf,
  strikeSquadron,
  strikeFrom,
  panelFleet,
  dossier: (key) => objDossier(key),
});

/** Где стоит эта эскадра — мир или носитель. Адрес ВЫВОДИТСЯ из состояния, а не
 *  склеивается в `data-arg`: составной ключ «база+звено» разъехался бы с ангаром на
 *  первой же перегрузке порт ⇄ носитель. */
function squadronBase(id: string): { planetId: string } | { fleetId: string } | null {
  for (const p of Object.values(s.planets)) {
    if ((p.hangar ?? []).some((q) => q.id === id)) return { planetId: p.id };
  }
  for (const f of Object.values(s.fleets)) {
    if ((f.hangar ?? []).some((q) => q.id === id)) return { fleetId: f.id };
  }
  return null;
}

/** Эскадра по id — вместе с базой, на которой она стоит. */
function squadronAt(id: string): { sq: Squadron; base: { planetId: string } | { fleetId: string } } | null {
  const base = squadronBase(id);
  if (!base) return null;
  const host = 'planetId' in base ? s.planets[base.planetId] : s.fleets[base.fleetId];
  const sq = (host?.hangar ?? []).find((q) => q.id === id);
  return sq ? { sq, base } : null;
}

/** СВОЙ вылет по id (SHU-6.14) — эскадра в воздухе. Чужой — `null`: соло видит полное
 *  состояние и обязано само повторить туман сети (`strikeTrail.ts`, правило 1). */
function ownStrike(id: string): ShuttleStrike | null {
  const st = (s.strikes ?? []).find((x) => x.id === id);
  return st && st.owner === ME ? st : null;
}

/** Эскадра вылета той же формы, что в ангаре: правила дальности, патруля и дележа меряют
 *  её теми же функциями, что и эскадру дома. */
function strikeSquadron(st: ShuttleStrike): Squadron {
  return {
    id: st.squadronId,
    units: st.units,
    ...(st.cargo ? { cargo: st.cargo } : {}),
    ...(st.damage ? { damage: st.damage } : {}),
  };
}

/** База вылета размеченным адресом — как у прицела из ангара. */
function strikeFrom(st: ShuttleStrike): { planetId: string } | { fleetId: string } {
  return st.base.kind === 'planet' ? { planetId: st.base.id } : { fleetId: st.base.id };
}

/** Эскадра взведённого прицела удара: из ангара или в воздухе (`strikeAim.strikeId`). */
function aimSquadron(): {
  sq: Squadron;
  base: { planetId: string } | { fleetId: string };
  aloft: ShuttleStrike | null;
} | null {
  if (!strikeAim) return null;
  if (strikeAim.strikeId) {
    const st = ownStrike(strikeAim.strikeId);
    return st ? { sq: strikeSquadron(st), base: strikeFrom(st), aloft: st } : null;
  }
  const found = squadronAt(strikeAim.squadronId);
  return found ? { ...found, aloft: null } : null;
}

/** Свои эскадры в воздухе под тапом, ближайшая первой (SHU-6.14): тот же отбор, что у
 *  флотов (`tapTargets.ts`), точка — значок на трассе (`strikeWorldPos`). */
function strikesUnderTap(mx: number, my: number, r: number): string[] {
  return fleetsUnderTap(
    (s.strikes ?? [])
      .filter((st) => st.owner === ME)
      .map((st) => {
        const at = strikeWorldPos(st.id);
        return { id: st.id, mine: true, visible: true, anchor: at ? world(at) : null };
      }),
    mx,
    my,
    r,
  );
}




/** Какой флот окно показывает консолью (макет владельца 2026-09-27): только на ПК и
 *  планшете, только ОДИН свой флот и не в режимах выбора. Чужой флот приказов не имеет,
 *  у группы нет одного состава и одного трюма, а в режиме «Приказ» ряд команд заменён
 *  полоской плана. Спрашивают оба хозяина окна — лист и ряд команд, — чтобы раскладка
 *  не могла достаться одному из них. */
function consoleFleet(): Fleet | null {
  if (!holographic.active() || chainMode || pickMode) return null;
  const ids = selectedFleetIds();
  if (ids.length !== 1 || panelFleet() !== ids[0]) return null;
  const f = s.fleets[ids[0]!];
  return f && f.owner === ME ? f : null;
}


// Всплывашка надбавок параметра флота — у владельца, `fleetCard.ts` (REFM-224): здесь только
// её слушатель «клик мимо». Он встаёт до подсказок терминов, как и стоял.
initStatPop();

// Слова-термины с подсказкой (UIX-9.4): во всплывашке параметра, в окне производства, в
// справочнике. Подсказки — свои узлы в `body`, слушатели — на документе.
initTermTips();



// --- object dossiers + codex (REFM-4) ----------------------------------------
// The hover/tap blurbs and the full-info codex card live in `dossiers.ts` now; here
// they only get their live-state hooks. The pure parts (`buildingDossier`,
// `resLine`, the `Dossier` type) are imported at the top of the file.
const { objDossier, codexHtml } = createDossiers({
  state: () => s,
  me: () => ME,
  pcUi,
  youColor: () => youColor,
  queuedOrders: (planetId, lane) =>
    coreQueue(planetId, lane).map((q) => ({
      kind: q.kind,
      id: q.building ?? q.unit ?? '',
      count: q.count ?? 1,
    })),
  activeConstruction,
  progressPct,
  victoryPoints: () => victoryPointsShown(sectorZeroToolsHidden()),
});

/** Лента сообщений изменилась (`messageLog.ts`, снятие метки в `pingUi`): перерисовать
 *  открытый тред окна дипломатии и плавающий чат — строки показывают оба. */
function repaintFeeds(): void {
  if (diploOpen && diploTab === 'msgs') renderDiploFeed();
  chatWin?.refreshIfVisible();
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
  // (REFM-42). Второй аргумент — очередь МИРА: с BLD-1 она живёт в ядре, поэтому
  // читается оттуда же (`coreQueue`), а не из клиентской копии, которой больше нет.
  return tileLock(
    canOrder(s, buildBuilding(ME, planetId, id)),
    coreQueue(planetId, 'buildings').some((q) => q.building === id),
  );
}
/** Ground-garrison tiles (the ЗЕМЛЯ tab): one flowing row of icon·count chips — no
 *  names; the hover dossier (PC) / tap dossier (touch) carries the identification. */
let mineViewState: typeof s | undefined;
let mineViewOwner = '';
let mineViewCache: ReturnType<typeof visibleOrdnance>;
function mineView(): ReturnType<typeof visibleOrdnance> {
  if (mineViewState !== s || mineViewOwner !== ME) {
    mineViewState = s; mineViewOwner = ME;
    mineViewCache = visibleOrdnance(s, ME);
  }
  return mineViewCache;
}
const mineControls = rocketMinesUi({
  state: () => s, viewer: () => ME, visible: mineView, data,
  hourMs: () => 3_600_000 / (ctx(s.time, s).config?.timeScale ?? 1),
  issue: playerOrder, verdict: (action) => canOrder(s, action),
  portrait: (id) => catalogPortraitHtml('md', id, data),
});

// Справка — у владельца, `helpCenter.ts` (REFM-221): карточка корабля, справочник с кнопкой
// «Построить здесь», поиск по статьям, вводные к механикам и сводка «пока вас не было».
// Отсюда — мир, своё место, позывной, мета, досье, замок здания, имя флота и режим забега.
initHelpCenter({
  world: () => s,
  me: () => ME,
  callsign: () => nickInput.value.trim(),
  loadMeta,
  inMatch,
  codexHtml: (kind, id, level) => codexHtml(kind, id, level),
  buildingLocked,
  fleetTitle: fleetTitleOf,
  sectorZeroToolsHidden,
});

function updateMobileHud(): void {
  if (!MOBILE) return;
  const fid = panelFleet();
  const f = fid ? s.fleets[fid] : null;
  const inspectable = f && fleetSeen(f);
  const key = selStrike
    ? `strike:${selStrike}`
    : selPlanet && s.planets[selPlanet]
      ? `planet:${selPlanet}`
      : inspectable
        ? `fleet:${fid}`
        : selectedFleetIds().join('|');
  const choices: MobileChoice[] = [];
  for (const pick of mobileChoices) {
    if (pick.kind === 'strike') {
      // Своя эскадра в воздухе (SHU-6.14): имя — тот же позывной, что над её значком.
      const st = ownStrike(pick.id);
      if (!st) continue;
      choices.push({ ...pick, title: strikeTitle(st), sub: t('side.aloft.sub') });
    } else if (pick.kind === 'fleet') {
      const f = s.fleets[pick.id];
      if (!f || !fleetSeen(f)) continue;
      choices.push({ ...pick, title: fleetTitleOf(f.id), sub: NAME[f.owner] ?? f.owner });
    } else if (s.planets[pick.id]) {
      choices.push({ ...pick, title: placeName(pick.id), sub: known(pick.id) ? t('hud.mobile.province') : t('side.notelemetry.title') });
    }
  }
  offerChoices(choices.map(({ kind, id }) => ({ kind, id })));
  mobileHud.update(
    key,
    !!mobileOrderKind() || pickMode || !!chainMode,
    cmdMore,
    choices,
    selStrike ? null : (cardTabs()?.active ?? null),
  );
}

// Ряд команд — разметка, поповеры, полоска «Приказ» и кэш разметки — живёт в `cmdBar.ts`
// (REFM-226). Здесь только хуки: мир, своё место, раскладка, окно флота, тип сектора, имя
// места и мобильный черновик приказа из `cmdActions.ts` (REFM-227).
initCmdBar({
  world: () => s,
  me: () => ME,
  mobile: () => MOBILE,
  holo: () => holographic.active(),
  consoleFleet,
  fleetLandShown,
  capturable: (id) => !!sectorTypeOf(id)?.capturable,
  placeName,
  mobileOrderKind,
  mobileTargetAvailable,
  mobileTargetLabel,
});

// Боковая панель — выбор карточки, лист с кэшем разметки и дверью перерисовки, живые сроки,
// досье по наведению и тапу, подъём камеры над листом на телефоне, нажатия по листу и окно
// деления — живёт в `sidePanel.ts` (REFM-225). Слушатели листа и окна деления встают здесь,
// на прежнем месте. Отсюда — то, что принадлежит игре: мир, своё место, раскладка, выбор,
// эскадры и вылеты, досье, замок здания, окна и отход.
initSidePanel({
  world: () => s,
  me: () => ME,
  mobile: () => MOBILE,
  vw: () => VW,
  vh: () => VH,
  inMatch,
  panelFleet,
  dossier: (key) => objDossier(key),
  setFleetSelection,
  clearSelection,
  squadronBase,
  squadronAt,
  ownStrike,
  strikeSquadron,
  strikeFrom,
  buildingLocked,
  openShipCard,
  openCodex,
  techTree: () => techTree,
  buildWin: () => buildWin,
  battleWindow: () => battleWindow,
  pings: () => pings,
  armRetreat,
});

// The browser context menu is suppressed across the whole game surface (the map, the
// HUD, every overlay) on EVERY device: on PC right-click is a game input, on a phone a
// long press would open the system menu («save image» on ship art and portraits) —
// Yandex Games requirement 1.6.1.8. Text fields keep their native menu (paste!).
document.addEventListener('contextmenu', (ev) => {
  if ((ev.target as HTMLElement).closest('input,textarea')) return;
  ev.preventDefault();
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
// Навык героя в меню приказов (✨ командной полосы и меню точки «Приказа») — тоже цель
// удержания: его сводка `ab:` — описание, перезарядка и дальность (заказ владельца
// 2026-09-25). Короткий тап по-прежнему применяет навык: съедается только хвостовой клик
// созревшего удержания.
const HOLD_TARGETS = '.ptile, .ptab, .asset-row, [data-desc^="ab:"]';
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

// Нажатия ряда команд и мобильный черновик приказа живут в `cmdActions.ts` (REFM-227):
// делегат вешает на `#cmdbar` сам модуль. Здесь только хуки: мир, своё место, раскладка,
// лента, имена, тип сектора, панель, окно деления, мины заградителя и звук отправки.
initCmdActions({
  world: () => s,
  me: () => ME,
  mobile: () => MOBILE,
  note,
  placeName,
  fleetTitleOf,
  capturable: (id) => !!sectorTypeOf(id)?.capturable,
  renderPanel,
  invalidatePanel,
  renderSplitDialog,
  openMineFleet: (id) => mineControls.openFleet(id),
  sentSound: () => snd.play('send'),
});

// --- canvas input ------------------------------------------------------------

// Тап и клик, пальцы, рамка, щипок, колесо — `mapInput.ts` (REFM-236).
initMapInput({
  world: () => s,
  me: () => ME,
  mobile: () => MOBILE,
  vw: () => VW,
  vh: () => VH,
  nodes: () => MAP,
  note,
  invalidatePanel,
  capturable: (id) => sectorTypeOf(id)?.capturable ?? false,
  chainHits: () => chainHits,
  pingHits: () => pingHits,
  closePingPop: () => pings?.closePop(),
  openPingPop: (loc) => pings?.openPop(loc),
  openBattle: (id) => battleWindow.open(id),
  battleRetreatAim: () => battleRetreatAim,
  clearBattleRetreatAim: () => {
    battleRetreatAim = null;
  },
  markSelection: () => {
    markSelection(lastReal);
  },
  clearSelection,
  setFleetSelection,
  toggleFleetInSelection,
  engageCandidates,
  mapLayer: mapLayerForInput,
  provinceAt,
  ownStrike,
  squadronAt,
  squadronRelocateSpots,
  strikeFrom,
  strikeSquadron,
  strikesUnderTap,
  relocateSpotPx,
});

// --- top bar / speed ---------------------------------------------------------
// Верхняя полоса — строка статуса, шапка, плашки, значки и тревоги, полоса скорости и досье
// Роя — у владельца, `matchTopBar.ts` (REFM-222). Отсюда — то, что принадлежит игре: мир,
// своё место, имена, темп и реальные часы мира, пауза забега, окна и такт телефона.
initTopBar({
  world: () => s,
  me: () => ME,
  names: () => NAME,
  placeName,
  inMatch,
  speed: () => speed,
  setSpeed: (v) => {
    speed = v;
  },
  restartRealClock: () => {
    lastReal = performance.now();
  },
  runPauseShown,
  runPauseEvent,
  toolsHidden: sectorZeroToolsHidden,
  scoreLimit: () => SCORE_LIMIT,
  nick: () => nickInput.value,
  income: () => perWorld('income', () => netIncome(s, ME)),
  mobile: () => MOBILE,
  aiSeats: () => AI_PLAYERS.size,
  speedControl: () => devSpeedControl,
  lessonSpeed: lessonRunning,
  phoneSpeed: () => phoneSpeed,
  phoneBadges: (battles, unread) => phoneNav.badges(battles, unread),
  allyPulsing: () => performance.now() < allyPulseUntil,
  pulseAlly: () => {
    allyPulseUntil = performance.now() + 12_000;
  },
  openAlly: () => allyScreen.open(),
  toggleMissions: () => missionPanel.toggle(),
  missionsOpen: () => missionPanel.isOpen(),
  openResource: (key) => resourceCard.open(key),
  restart: () => {
    if (leavesToSectorZero()) openSectorZero();
    else openSetup();
  },
});
bannerEl.addEventListener('click', (ev) => {
  if (!(ev.target as Element).closest('[data-restart]')) return;
  if (leavesToSectorZero()) openSectorZero();
  else openSetup();
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
  hubVisible: () => (!!hubEl && hubEl.style.display !== 'none') || sectorZeroMenu.isOpen(),
  net: () => NET,
  worldsFallback: () => worldsOf(ME),
  fmtStamp,
  rewards: __SECTOR_ZERO_ONLY__ ? undefined : {
    matchId: serverMatchId,
    read: async (matchId) => {
      const auth = await hubAuthorizedBase();
      if (!auth) throw new Error('E_AUTH');
      const response = await fetch(`${auth.base}/meta-economy/matches/${encodeURIComponent(matchId)}/rewards`, {
        headers: { authorization: `Bearer ${auth.token}` },
      });
      if (!response.ok) throw new Error('E_NETWORK');
      const result = await response.json() as MetaMatchRewardsView;
      const current = await hubAuthorizedBase();
      if (current?.base !== auth.base || current?.token !== auth.token) throw new Error('E_AUTH');
      return result;
    },
  },
  // ×2 к награде забега (`run.double`) — та же дверь к ролику и то же удвоение, что на
  // экране подготовки; удвоение одно на забег, так что две кнопки не дают двух выплат.
  double: {
    offer: () => {
      if (!isSectorZeroRun()) return null;
      const twice = doubleReward(sectorProgress, shopCapabilities(getPlatform().capabilities));
      return twice.state === 'ready' ? { research: twice.research, warrants: twice.warrants } : null;
    },
    watchAd,
    apply: () => changeSectorProgress({ kind: 'double-reward' }),
  },
  onLeave: (which, wasNet) => {
    // Уход — через дверь `leaveMatch` (REFM-205): из сетевого матча без дозвона, гайд и
    // первые цели гаснут (матч мог закончиться посреди гайда, ONB-2).
    leaveMatch();
    // «Повторить обучение» — сразу новый полигон; «В меню» — в меню Sector Zero.
    if (!wasNet && isTraining()) {
      if (which === 'again') startTraining();
      else openSectorZero();
      return;
    }
    if (!wasNet && isSectorZeroRun()) {
      openSectorZero(which === 'again', which === 'replay');
      return;
    }
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

/**
 * Выход из партии — одна дверь (REFM-205). Её зовут ⌂ (а через него ‹, рельс и аппаратный
 * Back), итоговый экран, вход в Sector Zero, «Одиночная игра» в хабе и в обзоре партий и
 * кнопка тестов. Куда вести игрока дальше, решает вызывающий. Пока выход был копиями, они
 * разошлись: итоговый экран не гасил первые цели, три копии не закрывали сокет, и ни одна
 * не гасила дозвон (см. `leaveNetwork`).
 *
 * - Забег Sector Zero сохраняется, и «Продолжить» поднимет его с этой минуты. Вне забега и
 *   после его засчёта `saveRun` ничего не пишет.
 * - Мир под меню встаёт. В соло иначе ИИ доигрывал бы партию, и «Победа!» ложилась поверх
 *   хаба (BF-29). Сетевому миру после выхода снимков больше не будет, а локальный ход
 *   сочинял бы его сам.
 * - Гайд гаснет (ONB-2): его #spotlight — синглтон на document.body, и незакрытый тур
 *   рисовал свой последний шаг поверх хаба и следующего матча (z-50, выше всего).
 * - Первые цели гаснут (ONB-7): список первой сессии живёт ровно одну партию.
 */
// «Вернуть обучение» полигона: кнопку держит `trainingResume.ts`, тур — `startTraining`.
let trainingResumeRun: ((from: number) => void) | null = null;
const trainingResume = initTrainingResume((from) => trainingResumeRun?.(from));
function leaveMatch(): void {
  saveRun();
  stopSim();
  speed = 0;
  leaveNetwork();
  clearSeatNicks();
  stopFirstGoals();
  activeTour?.stop();
  trainingResume.hide(); // остановка тура выше — не «Пропустить» игрока
}

// Speedbar "⌂ В меню": leave the current match from anywhere in-game — through the one
// door `leaveMatch`; a run or the training ground leads to the Sector Zero menu, the rest
// to the hub.
$('tomenu').addEventListener('click', (ev) => {
  // ⌂ в идущей экспедиции спрашивает (решение владельца 2026-09-26): в меню с сохранением
  // или завершить и забрать награду. Спрашивает только живой тап — программные выходы
  // (аппаратный Back, отмена загрузки карты, «В меню» самой карточки) уходят сразу.
  if (ev.isTrusted && runInProgress()) {
    openAbandon('exit', $('tomenu'));
    return;
  }
  const toSectorZero = leavesToSectorZero();
  leaveMatch();
  if (toSectorZero) openSectorZero();
  else openHub();
});
// Rail: «Покинуть сессию» — same exit as the speedbar ⌂, reachable from the rail too. На ПК ⌂
// в полосе скорости спрятан и выход живёт здесь, поэтому в экспедиции спрашивает и он.
document.getElementById('rail-exit')?.addEventListener('click', (ev) => {
  if (runInProgress()) openAbandon('exit', ev.currentTarget as HTMLElement);
  else $('tomenu').click();
});

// Event-log window: the rail's ≡ opens it; ✕ or the backdrop closes it. The feed
// (#log) updates in place each frame whether the window is open or not.
const logWin = document.getElementById('logwin');
document.getElementById('rail-log')?.addEventListener('click', () => logWin?.classList.add('show'));
logWin?.addEventListener('click', (e) => {
  const tg = e.target as HTMLElement;
  if (tg.id === 'logwin' || tg.classList.contains('lw-close')) logWin.classList.remove('show');
  // UIX-4.2: «Показать» у пункта «Ждёт решения» — бой: окно боя и камера к его миру;
  // письма — вкладка сообщений (чтение гасит значок, как у кнопки ✉).
  const show = tg.closest<HTMLElement>('[data-pending]');
  if (!show) return;
  logWin.classList.remove('show');
  if (show.dataset.pending === 'battle') {
    if (show.dataset.loc) focusWorld(show.dataset.loc);
    if (show.dataset.id) battleWindow.open(show.dataset.id);
  } else {
    readMessages();
    openDiplo('msgs');
  }
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
document.getElementById('rail-pings')?.addEventListener('click', () => pings?.togglePanel());
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
    coreQueue(pid, 'buildings').some((q) => q.building === id),
  build: (pid, id) => enqueueBuild(pid, { kind: 'building', id, count: 1 }),
  upgrade: (pid, id) => enqueueBuild(pid, { kind: 'upgrade', id, count: 1 }),
  // Юнитные вкладки окна стройки (BUILD-2): тот же путь, которым их строила боковая
  // панель, — ростер по вкладке, заказ через ту же очередь, карточка через тот же кодекс.
  // Новой логики здесь нет и быть не должно: окно переехало, правила остались.
  unitIds: (tab) => buildRoster(tab, BUILD_UNITS, data),
  buildUnit: (pid, id, troop) =>
    enqueueBuild(pid, { kind: 'unit', id, count: 1, ...(troop !== undefined ? { troop } : {}) }),
  openUnitInfo: (id) => openCodex(`u:${id}`),
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
let lastBattleWinAt = 0;
let lastBuildAt = 0;
let lastIntelAt = 0; // throttle for the live intel-window timers (диплом. вкладка «Шпионаж»)
const steward = __SECTOR_ZERO_ONLY__
  ? null
  : initSteward({
      root: () => stewWin,
      body: () => $('stewardbody'),
      state: () => s,
      me: () => ME,
      order: playerOrder,
      onOpen: () => maybeIntro('steward'),
      openTech: () => techTree.open(),
    });
document.getElementById('rail-steward')?.addEventListener('click', () => steward?.open());

// --- окно боя (заказ владельца 2026-09-15) -----------------------------------
// Значок боя на карте и так показывал фазу и отсчёт до раунда; теперь он ОТКРЫВАЕТСЯ.
// До этого расклад можно было увидеть единственным путём — выделив свой флот в этом
// бою, — то есть про чужую схватку рядом узнать было нечем.
const battleWin = $('battlewin');
/** Взвести «Отступить» для флота: остальные прицелы гаснут, окно боя уступает карту. */
let battleRetreatAim: string | null = null;
function armRetreat(fleetId: string): void {
  battleRetreatAim = null;
  arm('retreatAim', fleetId);
  battleWin.classList.remove('show');
  note(t('hint.pick-retreat'));
  invalidatePanel();
}
let battleReadoutCache: ReturnType<typeof inspectBattle> = {};
let battleReadoutId = '';
let battleReadoutAt = -Infinity;
const battleWindow = initBattleWindow({
  root: () => battleWin,
  body: () => $('battlewinbody'),
  head: () => $('battlewinhead'),
  state: () => s,
  me: () => ME,
  model: (id) => {
    // VET-6: тот же конфиг матча, на котором считает редьюсер, — иначе окно показало бы
    // надбавку ветерана там, где хост её не дал.
    const m = createBattleModel(s, id, ME, data, ctx(s.time, s).config);
    if (!m.ok) return null;
    const now = performance.now();
    if (id !== battleReadoutId || now - battleReadoutAt >= 250) {
      battleReadoutCache = inspectBattle(soloKernel, s, ctx(s.time, s), id);
      battleReadoutAt = now;
      battleReadoutId = id;
    }
    for (const side of m.sides) side.readout = side.key ? battleReadoutCache[side.key] : undefined;
    return m;
  },
  attack: (id, side) => playerOrder(attackBattle(ME, id, side)),
  retreatAll: (id) => {
    const first = battleRetreats(s, id, ME)[0];
    if (!first) return;
    armRetreat(first);
    battleRetreatAim = id;
  },
  // Отступление из окна боя — тот же прицел, что и кнопкой боковой панели.
  retreat: (fleetId) => armRetreat(fleetId),
  view: {
    color: ownerColor,
    ownerName: (owner) => owner ? NAME[owner] ?? owner : t('side.neutral'),
    tiles: (side, limit, color) => (side.stacks ?? side.units).map((u, index) => ({ u, index }))
      .filter(({ u }) => u.count > 0).slice(0, limit).map(({ u, index }) => {
        const open = side.ref?.kind === 'fleet' && side.mine
          ? `data-shipcard="${esc(side.ref.fleetId)}|${index}"` : `data-codex="u:${esc(u.unit)}"`;
        return unitTileHtml(u, side.owner, open, true, color);
      }).join(''),
    fleetName: fleetCallsign,
    placeName,
    autoRetreatAt,
    timeLeft,
    // UIX-6.2: прогноз по текущему составу сторон — новый раунд сам даёт новый прогноз.
    forecast: (sides) => battleForecast(sides, data, battleHostility(s)),
  },
});
battleWin.addEventListener('click', (event) => {
  const tile = (event.target as HTMLElement).closest<HTMLButtonElement>('button.ptile');
  if (!tile) return;
  if (tile.dataset.shipcard) {
    const at = tile.dataset.shipcard.lastIndexOf('|');
    openShipCard(tile.dataset.shipcard.slice(0, at), Number(tile.dataset.shipcard.slice(at + 1)));
  } else if (tile.dataset.codex) openCodex(tile.dataset.codex);
});
/** Сколько экрана вокруг дома занимают его значки — стек флотов, гарнизон, подписи (YAG-7.2). */
const HOME_CLEARANCE_PX = 80;
const pirateIntro = initPirateIntro({
  root: $('pirate-intro'),
  copy: $('pirate-copy'),
  action: $('pirate-action'),
  close: $('pirate-close'),
  focus: focusWorld,
  openBattle: (id) => battleWindow.open(id),
  // Воронка обучения (`YAG-5.1`): первый бой с пиратами — это и есть обучение забега.
  onStage: (step) => {
    if (isSectorZeroRun())
      getPlatform().analytics.emit('onboarding_step', { guide: 'pirates', step, attempt: sectorAttempt });
  },
  // YAG-7.2: подсказка встаёт после первого хода часов, когда стартовый вид уже выбран. Если
  // она легла на дом (и его флоты рядом), вид пересчитывается — теперь с припуском под ней.
  onFirstShow: () => {
    const home = pickHome(Object.values(s.planets), ME);
    if (home && cardCovers(pirateIntroRect(), world(home.position), HOME_CLEARANCE_PX)) defaultView();
  },
});
// Комиксы глав (решение владельца 2026-09-24): арт рисует владелец, реестр — `comicArt.ts`.
// Реестр читается через держатель, чтобы робот мог подложить свой комикс.
const comicPlayer = initComicPlayer({
  root: $('comic'),
  img: $('comic-img') as HTMLImageElement,
  caption: $('comic-caption'),
  count: $('comic-count'),
  next: $('comic-next') as HTMLButtonElement,
  skip: $('comic-skip') as HTMLButtonElement,
});
const comicArt: { registry: ComicRegistry } = { registry: CHAPTER_COMICS };
const comicQueue = createComicQueue();


// --- heroes («штаб героев») ---------------------------------------------------
// The hero pane of «Производство»: roster, skill tree, abilities, fittings. The pane
// itself lives in `heroStaff.ts` (REFM-14); here it only gets the host state it
// cannot reach on its own. Ranged casts and deploys resolve on the MAP, so the pane
// arms `heroAim`/`heroSpawnAim` through these two hooks and the world tap fires them.
const heroStaff = initHeroStaff({
  state: () => s,
  me: () => ME,
  order: playerOrder,
  note: (msg) => note(msg),
  armCast: (heroId, abilityId) => arm('heroAim', { heroId, abilityId }),
  armSpawn: (heroId) => arm('heroSpawnAim', heroId),
});

// --- session market: a two-sided order book, one tab per tradeable good -------
// The window itself lives in `marketScreen.ts` (REFM-6); here it gets its hooks and
// the rail button that opens it.
// The Android-Back / Escape layer stack still needs the node itself (it is a registry
// of «layer → how to close it», see the REFM-1 note) — one handle, shared.
const marketWin = $('market');
const market = __SECTOR_ZERO_ONLY__
  ? null
  : initMarket({
      root: () => marketWin,
      state: () => s,
      me: () => ME,
      order: playerOrder,
      onOpen: () => maybeIntro('market'),
    });
document.getElementById('rail-market')?.addEventListener('click', () => market?.open());

// --- торговец экспедиции («живой курс», решение владельца 2026-09-26) -------------------
// Рынок основной игры — книга заявок живых игроков, и в забеге его нет; здесь торгуют с самим
// рынком (`modules/trader.ts`). Окно — `traderScreen.ts`; открыт торговец, пока идёт забег
// режима с разделом `trader`: кнопка рельса и карточка ресурса спрашивают `runTrader()`.
const traderWin = $('trader');
/** Раздел торговца, если он у текущего забега есть. */
function runTrader(): ModeTrader | undefined {
  return runInProgress() ? traderOf(ctx(s.time, s)) : undefined;
}
const trader = initTrader({
  root: () => traderWin,
  state: () => s,
  me: () => ME,
  ctx: () => ctx(s.time, s),
  cfg: runTrader,
  order: playerOrder,
});
const railTrader = $('rail-trader');
railTrader.addEventListener('click', () => trader.open());
/** Кадровый такт торговца: кнопка рельса — пока он есть, окно следит за курсом (он плывёт к
 *  базе) и закрывается само, когда забег кончился. */
function tickTrader(): void {
  const live = runTrader() !== undefined;
  const shown = live ? '' : 'none';
  if (railTrader.style.display !== shown) railTrader.style.display = shown;
  if (!live) {
    if (trader.isOpen()) trader.close();
    return;
  }
  trader.refresh();
}

// --- связь с союзником (глава IV, PVR-7.5) ---------------------------------------------
// Окно — `allyScreen.ts`, статус операции — тот же план, по которому ходит бот союзника
// (`decisions/allyPanel.ts`). Вход — чип «⬡ Союзник» в строке статуса: он есть и на ПК, и на
// телефоне, и появляется только после встречи.
const allyWin = $('ally');
const allyScreen = initAllyScreen({
  root: () => allyWin,
  state: () => s,
  me: () => ME,
  data: () => data,
  targetName: (planet, fleet) => {
    if (planet) return placeName(planet);
    const f = fleet ? s.fleets[fleet] : undefined;
    const at = f ? (f.location ?? f.movement?.to) : undefined;
    return at ? placeName(at) : '—';
  },
  arm: (kind) => {
    arm('allyAim', kind);
    note(t('ally.pick', { order: t(`ally.kind.${kind}`) }));
  },
  armed: () => allyAim,
  findFleet: (fleetId) => {
    const f = s.fleets[fleetId];
    const at = f ? (f.location ?? f.movement?.to) : undefined;
    if (at) jumpTo(at, 'goto');
  },
  order: playerOrder,
  sees: fleetSeen,
});
/** Кадровый такт окна союзника: связи нет — окно закрыто и прицел снят. */
function tickAlly(): void {
  if (!perWorld('ally', () => linkedAlly(s, ME))) {
    if (allyScreen.isOpen()) allyScreen.close();
    drop('allyAim');
    return;
  }
  allyScreen.refresh();
}

// --- resource card (RC-1): tap a resource chip → popup with stats + market button -
const resCardEl = $('rescard');
const resourceCard = initResourceCard({
  root: () => resCardEl,
  state: () => s,
  me: () => ME,
  icons: RES_SVG,
  onOpenMarket: (res) => market?.open(res),
  marketShown: () => toolShown('market', sectorZeroToolsHidden()),
  traderGoods: () => {
    const cfg = runTrader();
    return cfg ? Object.keys(cfg.goods) : null;
  },
  onOpenTrader: (res) => trader.open(res),
  // Пакет снабжения за Суверены (решение владельца 2026-09-24): состав и лимит — правило
  // мира (режим), цена — магазин профиля.
  supply: () => {
    if (!isSectorZeroRun()) return null;
    const cfg = data.modes[matchMode() ?? '']?.pve?.supply;
    const { price } = data.sectorZeroShop.runSupply;
    if (!cfg || cfg.perRun <= 0 || price <= 0) return null;
    const bought = s.pve?.supplies?.[ME] ?? 0;
    return {
      pack: cfg.pack,
      price,
      perRun: cfg.perRun,
      left: Math.max(0, cfg.perRun - bought),
      affordable: sectorProgress.sovereigns >= price,
    };
  },
  // Как ремонт за Суверены: сперва профиль может ли заплатить, потом ядро выдаёт пакет, и
  // только потом списание — отказ ядра (лимит, конец забега) не стоит игроку валюты.
  onBuySupply: () => {
    if (!isSectorZeroRun()) return;
    const paid = changeSectorZeroProgress(sectorProgress, { kind: 'run-supply' }, data);
    if (!paid) {
      toast(t('rescard.supply.poor', { price: data.sectorZeroShop.runSupply.price }));
      return;
    }
    if (playerOrder(buySupply(ME))) {
      saveSectorProgress(paid);
      note(t('rescard.supply.done'));
    }
  },
});


// --- constructor («Производство», ROS-0.2): the unified order screen ---------
// One in-match screen that switches between the loadout constructors (ships and
// shuttles now; the «Герои» pane is still the hero штаб below — it folds in with
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
  probe: (a) => canOrder(s, a),
  note: (msg) => note(msg),
  errText,
  arsenalItems: () => arsenal?.items() ?? [],
  preparedModules: (hull) => isSectorZeroRun() ? [...(runShipLoadouts[hull] ?? [])] : undefined,
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
/** Виден ли экран подключения. Нужен там, где решение зависит от того, ПРОЧИТАЕТ ли
 *  игрок написанное в его строку статуса. Пришёл ли он по ссылке — отдельный вопрос и
 *  отдельный признак (`cameFromLink`): оверлей держится до впуска в обоих случаях. */
const connectShown = (): boolean => connectEl.style.display !== 'none';
// Remembered server, then the one baked into the APK, then the page's own origin
// (`serverAddress.ts`, rule 8).
srvInput.value = defaultServerField(localStorage.getItem('void.server'), bakedServer(), location);
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
    leaveMatch();
    showConnect(false);
    openTestMode();
  });
  // SANDBOX — fenced hook. Wire the single-player practice-tools panel; the floating
  // opener stays hidden until a match launches with the setup checkbox ticked.
  initSandbox({
    getState: () => s,
    available: () => !NET && inMatch() && sandboxConfig.enabled,
    data,
    waveTools: () => sectorDevActive,
    nextWave: () => {
      if (NET || !sectorDevActive || !inMatch()) return false;
      const next = pullNextDevWave(s);
      if (!next) return false;
      const out = advance(next, next.time + 1);
      if (out.error || out.state.pve?.waveNumber === s.pve?.waveNumber) return false;
      apply(out);
      return true;
    },
    me: () => ME,
    homeId: () => sandboxHomeId,
    note: (msg) => note(msg),
    getSpeedControl: () => devSpeedControl,
    setSpeedControl: (on) => setDevSpeedControl(on),
    techIds: () => Object.keys(data.technologies),
  });
  initTestMode({
    startScenario: (state, resumeSpeed) => {
      installMatch(state, new Map()); // scenarios drive themselves — no AI
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

// --- welcome stage → match browser ------------------------------------------------
// Страницы входа и переключатель стадий `#connect` живут в `signInPages.ts` (REFM-218);
// отсюда обозреватель партий открывается своей стадией.
function enterBrowse(): void {
  if (!nickInput.value.trim()) nickInput.value = suggestCallsign();
  showStage('browse');
  detach('обозреватель: список партий', refreshMatches());
}
// --- meta-shell hub: post-login home + bottom nav (docs/main-menu.md) -------
// After identity you land on the hub (home + PLAY + bottom nav), not the raw match
// list. The nav routes into the existing flow: "Игры"/"ИГРАТЬ" → the match browser
// (стадия 2 of #connect, untouched), «Корпорация» → вкладка `corpScreen.ts` (CORP-3), Ещё →
// настройки. Social sign-in is a guest stub (accounts AC-1.1) with a "скоро" note.
const hubEl = $('hub');
const hubNote = $('hub-note');
let registrationReward: ReturnType<typeof initRegistrationReward> | null = null;
function showHub(show: boolean): void {
  if (!show) registrationReward?.close();
  if (!show) arsenal?.close();
  if (!show) shop?.close();
  if (!show) corp?.hideHub();
  // Карточка справочника, открытая в партии (её кнопки строят на выбранном мире), в хаб не переходит.
  if (show) document.getElementById('codex')?.classList.remove('show');
  hubEl.style.display = show ? 'flex' : 'none';
  // Справочник, открытый из хаба (карточка арсенала, плитка «Справка»), встаёт ПОВЕРХ хаба:
  // в партии его слой ниже, а у хаба выше, и раньше он открывался за ним (build.mjs).
  document.body.classList.toggle('hub-open', show);
}
const HUB_PANELS: Record<string, string> = {
  home: 'hp-home',
  rank: 'hp-rank',
  meta: 'hp-meta',
  friends: 'hp-friends',
  arsenal: 'hp-arsenal',
  auction: 'hp-auction',
  supply: 'hp-supply',
  shop: 'hp-shop',
  corp: 'hp-corp',
  community: 'hp-community',
  more: 'hp-more',
};
let currentHubTab = 'home'; // the visible hub panel, so an async XP sync can repaint it
/** Панели, в которые входят из «Ещё»: пока открыта любая, подсвечена вкладка «Ещё» (UIX-10.1). */
const HUB_UNDER_MORE: ReadonlySet<string> = new Set(['meta', 'auction', 'rank', 'friends', 'supply', 'shop', 'community']);
function hubTab(tab: string): void {
  hubNote.textContent = '';
  hubWallet?.render();
  if (tab === 'games') {
    showHub(false);
    showConnect(true);
    enterBrowse(); // hand off to the existing match browser
    return;
  }
  currentHubTab = tab;
  // ADDR-4: свои партии — главный экран, а не вкладка обозревателя, поэтому лента
  // переспрашивается при каждом заходе домой (день и число игроков успевают устареть).
  if (tab === 'home') detach('хаб: свои партии', refreshMyMatches());
  // Кошелёк Варрантов в шапке (UIX-10.2) — тихо: гостю и при сбое сервера остаётся прежнее число.
  if (tab === 'home' && metaMarket) detach('хаб: кошелёк аукциона', metaMarket.sync());
  // Суверены на той же плашке: баланс знает только сервер, гостю остаётся знак без числа.
  if (tab === 'home' && shop) detach('хаб: кошелёк Суверенов', shop.sync());
  if (tab === 'home' && news) detach('хаб: лента новостей', news.refresh());
  if (tab !== 'home') news?.close(); // the feed sheet lives over the home panel
  if (tab === 'meta') renderMetaPanel(); // live numbers every visit (XP may have grown)
  if (tab === 'friends' && friends) detach('хаб: друзья', friends.refresh()); // roster + presence are server truth
  if (tab === 'rank' && rank) detach('хаб: рейтинг', rank.refresh()); // places are computed server-side (RANK-1)
  if (tab === 'arsenal' && arsenal) detach('хаб: арсенал', arsenal.refresh()); // cache paints now, server refresh trails
  if (tab !== 'arsenal') arsenal?.close(); // the phone sheet lives over the hub, not in the tab
  if (tab === 'auction' && metaMarket) detach('хаб: аукцион', metaMarket.refresh());
  if (tab === 'supply' && metaEconomy) detach('хаб: снабжение', metaEconomy.refresh());
  if (tab === 'shop' && shop) detach('хаб: магазин', shop.refresh());
  if (tab !== 'shop') shop?.close(); // the phone sheet lives over the hub, like the arsenal's
  for (const [k, pid] of Object.entries(HUB_PANELS))
    $(pid).style.display = k === tab ? 'flex' : 'none';
  // CORP-3: the corporation tab paints after its panel is visible — the panorama centres by width.
  if (tab === 'corp') corp?.showHub();
  else corp?.hideHub();
  const navTab = HUB_UNDER_MORE.has(tab) ? 'more' : tab;
  for (const b of Array.from(document.querySelectorAll('.hub-tab')))
    b.classList.toggle('active', (b as HTMLElement).dataset.hub === navTab);
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
    {
      server: srv,
      accountsMode: authMode === 'accounts',
      token: srv ? sessionToken(srv.base) : null,
    },
    httpBase,
  );
}

const friends = __SECTOR_ZERO_ONLY__
  ? null
  : initFriends({
      root: () => $('hp-friends'),
      authorizedBase: hubAuthorizedBase,
      openPlayer: (login) => profile?.open(login),
    });

// --- «Рейтинги» — commander + corporation boards (hub tab, RANK-1) ----------
// Доски считает сервер (`leaderboardApi.ts`): своё место — по ВСЕЙ популяции, а не по
// присланной странице, поэтому клиент его вывести и не смог бы. Доступ — та же
// политика, что у «Друзей»: переиспользуем добытую входом сессию, пароль ради
// просмотра не спрашиваем; нет сессии — гостевое состояние с причиной.
const rank = __SECTOR_ZERO_ONLY__
  ? null
  : initRank({
      root: () => $('hp-rank'),
      authorizedBase: hubAuthorizedBase,
      openPlayer: (login) => profile?.open(login),
    });

// --- «Арсенал» — the account's persistent collection and its workshop (hub tab, ARS-5) ----
// The tab itself lives in `arsenalScreen.ts` (REFM-5); here it gets its hooks. Cache key is
// per callsign, like the meta store. `authorizedBase` encodes the tab's policy: it may reuse
// a session token a prior join already stashed, but must never prompt for a password just to
// LOOK at the collection — no server, no accounts or no stashed session all read the same way
// (the starter kit and a sign-in). Narrow = the tab is too narrow for the detail beside the
// list (the `@container arsenal` rule in build.mjs uses the same width), and then the detail
// opens as a sheet over the hub.
const ARSENAL_WIDE_MIN = 700;
const arsenal = __SECTOR_ZERO_ONLY__
  ? null
  : initArsenal({
      root: () => $('hp-arsenal'),
      sheet: () => $('arsenal-sheet'),
      narrow: () => $('hp-arsenal').clientWidth < ARSENAL_WIDE_MIN,
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
      canSignIn: () => !!resolveServer() && authMode === 'accounts',
      signIn: () => {
        showHub(false);
        showConnect(true);
        showStage('welcome');
        fillWelcome((localStorage.getItem('void.nick') ?? '').trim(), 'show');
      },
      openAuction: () => hubTab('auction'),
      sell: (itemId) => {
        metaMarket?.focusSell(itemId);
        hubTab('auction');
      },
      openSeason: () => hubTab('supply'),
      openStore: (offerId) => {
        shop?.show('modules', offerId);
        hubTab('shop');
      },
      changed: async () => {
        await metaMarket?.sync();
      },
    });
if (arsenal && typeof ResizeObserver !== 'undefined')
  new ResizeObserver(() => arsenal.relayout()).observe($('hp-arsenal'));
// EC-3 «Аукцион»: витрина торговли мета-предметами. Лоты и кошелёк живут на сервере,
// поэтому кэша, как у арсенала, здесь нет — экран всегда спрашивает свежее.
const metaMarket = __SECTOR_ZERO_ONLY__
  ? null
  : initMetaMarket({
      root: () => $('hp-auction'),
      arsenal: () => arsenal?.items() ?? [],
      authorizedBase: hubAuthorizedBase,
      note: (message) => {
        hubNote.textContent = message;
      },
      changed: () => hubWallet?.render(),
      inventoryChanged: async () => { await arsenal?.refresh(); },
    });
// «Магазин» (заказ владельца 2026-10-20): Суверены, премиум, модули и материалы за ◆.
// Единственное место покупок — Снабжение и Арсенал ведут сюда. Баланс ◆ и срок премиума
// приходят с ответом аккаунта: плашка хаба показывает число, чат помнит премиум по позывному
// (цвет шрифта — его бонус; сам срок проверяется по часам при каждом открытии настроек).
const SHOP_WIDE_MIN = 700;
const premiumKey = (): string => 'vd.premium.' + (nickInput.value.trim() || 'guest');
const shop = __SECTOR_ZERO_ONLY__
  ? null
  : initShop({
      root: () => $('hp-shop'),
      sheet: () => $('shop-sheet'),
      narrow: () => $('hp-shop').clientWidth < SHOP_WIDE_MIN,
      authorizedBase: hubAuthorizedBase,
      canSignIn: () => !!resolveServer() && authMode === 'accounts',
      signIn: () => {
        showHub(false);
        showConnect(true);
        showStage('welcome');
        fillWelcome((localStorage.getItem('void.nick') ?? '').trim(), 'show');
      },
      warrants: () => metaMarket?.balance() ?? 0,
      now: () => Date.now(),
      accountChanged: (view) => {
        if (view) writeRaw(premiumKey(), String(view.premiumUntil ?? 0));
        hubWallet?.render();
      },
      changed: async () => {
        await arsenal?.refresh();
        await metaMarket?.sync();
      },
    });
if (shop && typeof ResizeObserver !== 'undefined')
  new ResizeObserver(() => shop.relayout()).observe($('hp-shop'));
// CORP-2 «Домой»: лента новостей. Экран — `newsScreen.ts`, решения — `decisions/newsFeed.ts`.
// Ленту сервер отдаёт без входа, поэтому ей нужен только адрес; сессия хаба — для «Моей
// корпорации», карточки корпорации и заявки.
const news = __SECTOR_ZERO_ONLY__
  ? null
  : initNews({
      column: () => $('news-col'),
      teaser: () => $('news-teaser'),
      sheet: () => $('news-sheet'),
      publicBase: () => {
        const step = resolveBase(srvInput.value, location.protocol === 'https:');
        return step.kind === 'ok' ? httpBase(step.base) : null;
      },
      authorizedBase: hubAuthorizedBase,
      note: (text) => {
        hubNote.textContent = text;
      },
      errText,
      openCorp: (tab) => {
        corp?.showSection(tab === 'hq' ? 'base' : 'battles');
        hubTab('corp');
      },
      now: () => Date.now(),
    });
/** Premium is running for this callsign, by the last account read on this device. */
function premiumRunning(): boolean {
  return Number(readRaw(premiumKey()) ?? 0) > Date.now();
}
// Main-game supply has its own server-owned state; Sector Zero remains independent.
const metaEconomy = __SECTOR_ZERO_ONLY__
  ? null
  : initMetaEconomy({
      root: () => $('hp-supply'),
      authorizedBase: hubAuthorizedBase,
      changed: async () => {
        await arsenal?.refresh();
        await metaMarket?.sync();
      },
    });
// Кошелёк главного экрана (UIX-10.2, заказ владельца 2026-10-01): Суверены — та же плашка с
// «+», что в строке статуса партии; Варранты аукциона — плашкой, которая и есть дверь в аукцион.
const hubWallet = __SECTOR_ZERO_ONLY__
  ? null
  : initHubWallet({
      root: $('hubwallet'),
      wallet: () => ({ sovereigns: shop?.sovereigns() ?? null, warrants: metaMarket?.balance() ?? 0 }),
      donate: () => {
        shop?.show('sovereigns');
        hubTab('shop');
      },
      auction: () => hubTab('auction'),
    });

function arsenalKey(): string {
  return 'vd.arsenal.' + (nickInput.value.trim() || 'guest');
}


// --- Профиль командира — the career dossier (docs/main-menu.md §4.2) ------------
// Само досье живёт в `profileScreen.ts` (REFM-10); здесь только его хуки. Ключ кэша
// медалей — по позывному, рядом с остальными ключами. `authorizedBase` кодирует ту же
// политику, что у «Арсенала»: за паролем ради ПОСМОТРЕТЬ витрину не ходим.
const profile = __SECTOR_ZERO_ONLY__
  ? null
  : initProfile({
      root: () => $('profile'),
      identity: () => profileKey(),
      readAppearance: readProfileAppearance,
      writeAppearance: (value) => writeRaw(profileKey(), JSON.stringify(value)),
      appearanceChanged: applyProfilePortrait,
      view: () => {
        const st = loadMeta();
        return {
          nick: nickInput.value,
          xp: st.xp,
          stats: st.stats,
          corp: (() => {
            const c = corp?.mine().corp;
            return c ? { name: c.name, influence: c.influence } : null;
          })(),
          sovereigns: shop?.sovereigns() ?? null,
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
      authorizedBase: async () => {
        const srv = resolveServer();
        if (!srv) return null;
        const session = await hubAuthorizedBase();
        return session && tokenFor(localStorage, srv.base, nickInput.value.trim()) === session.token ? session : null;
      },
    });
const medalsKey = (): string => 'vd.medals.' + (nickInput.value.trim() || 'guest');
if (!__SECTOR_ZERO_ONLY__) registrationReward = initRegistrationReward({
  identity: profileKey,
  visible: () => hubEl.style.display !== 'none',
  authorizedBase: hubAuthorizedBase,
  changed: async () => { await Promise.all([syncProfileAppearance(), syncCommanderFromServer()]); },
});
// The tutorial medal: earned on this device per callsign, carried into the account profile.
const tutorialMedal = __SECTOR_ZERO_ONLY__
  ? null
  : initTutorialMedal({
      key: () => 'vd.medal.tutorial.' + (nickInput.value.trim() || 'guest'),
      authorizedBase: hubAuthorizedBase,
    });
// Medal rewards (owner's order 2026-10-24): every reached degree of a profile medal pays
// Sovereigns, Warrants and XP once; the window lists the grant, then XP and wallets re-read.
const medalRewards = __SECTOR_ZERO_ONLY__
  ? null
  : initMedalRewards({
      identity: profileKey,
      visible: () => hubEl.style.display !== 'none',
      authorizedBase: hubAuthorizedBase,
      changed: async () => {
        await Promise.all([syncCommanderFromServer(), shop?.sync(), metaMarket?.sync()]);
      },
    });
function profileKey(): string {
  return `vd.profile.${resolveServer()?.base ?? 'local'}.${nickInput.value.trim().toLowerCase() || 'guest'}`;
}
function readProfileAppearance(): unknown {
  try { return JSON.parse(readRaw(profileKey()) ?? 'null'); } catch { return null; }
}
function applyProfilePortrait(portrait?: number): void {
  if (__SECTOR_ZERO_ONLY__) return;
  const id = portrait ?? parseAppearance(readProfileAppearance())?.portrait;
  const src = id ? PORTRAITS[id - 1] : undefined;
  const avatar = document.getElementById('hubav');
  if (!avatar) return;
  if (!src) { avatar.textContent = playerEmblem(); avatar.classList.remove('portrait'); return; }
  const img = document.createElement('img');
  img.src = src;
  img.alt = t('profile.title');
  avatar.replaceChildren(img);
  avatar.classList.add('portrait');
}

async function syncProfileAppearance(): Promise<void> {
  if (__SECTOR_ZERO_ONLY__) return;
  const key = profileKey();
  const srv = resolveServer();
  if (!srv) return;
  const session = await hubAuthorizedBase();
  if (!session || tokenFor(localStorage, srv.base, nickInput.value.trim()) !== session.token) return;
  try {
    const response = await fetch(`${session.base}/profiles`, { headers: { authorization: `Bearer ${session.token}` } });
    if (!response.ok) return;
    const raw = await response.json() as { portrait?: unknown; slots?: unknown };
    const appearance = parseAppearance({ portrait: raw.portrait, slots: raw.slots });
    if (!appearance || key !== profileKey()) return;
    writeRaw(key, JSON.stringify(appearance));
    applyProfilePortrait(appearance.portrait);
  } catch { /* Keep the previously saved portrait while offline. */ }
}

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
  if (authMode !== 'accounts') return;
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
  if (soloSaveActive) { saveSolo(); speed = 0; }
  if (!nickInput.value.trim()) nickInput.value = suggestCallsign();
  const nick = nickInput.value.trim();
  $('hub-name').textContent = nick || t('auth.commander');
  applyProfilePortrait();
  showConnect(false);
  showHub(true);
  hubTab('home');
  hubNote.textContent = note;
  refreshHubDoor(); // после позывного: пройденное обучение помнится по нику (`onboardKey`)
  detach('хаб: сверка командира с сервером', syncCommanderFromServer()); // account-backed XP → local mirror (accounts mode only)
  detach('хаб: портрет аккаунта', syncProfileAppearance());
  detach('account deletion capability', refreshAccountDeletion());
  if (registrationReward) detach('registration reward', registrationReward.show());
  // The tutorial claim goes first: its medal is then paid by the same hub entry.
  detach(
    'tutorial medal claim and medal rewards',
    (async () => {
      if (tutorialMedal) await tutorialMedal.claim();
      if (medalRewards) await medalRewards.claim();
    })(),
  );
}

// Страницы входа — у своего владельца (`signInPages.ts`, REFM-218): приветствие и вход
// по позывному, регистрация, восстановление и сброс пароля. Строку статуса, поле позывного
// обозревателя, сервер, хаб и вход в партию модуль получает хуками.
initSignInPages({
  status: (text) => {
    statusEl.textContent = text;
  },
  note,
  setNick: (nick) => {
    nickInput.value = nick;
  },
  resolveServer,
  serverField: () => srvInput.value,
  showConnect,
  showHub,
  openHub,
  connectToMatch,
});
// Вход в партию и выбор места — у своего владельца (`matchJoin.ts`, REFM-217). Подключается
// до загрузочного блока: ссылка на партию входит в неё прямо оттуда.
initMatchJoin({ resolveServer });
// Обозреватель партий и «Мои партии» хаба — у своего владельца (`matchBrowser.ts`,
// REFM-217). Тоже до загрузочного блока: тот открывает хаб, а заход домой переспрашивает
// свои партии.
initMatchBrowser({
  resolveServer,
  status: (text) => {
    statusEl.textContent = text;
  },
  statusText: () => statusEl.textContent ?? '',
  connectShown,
  hubNote: (text) => {
    hubNote.textContent = text;
  },
  hubTab,
  mapLabel,
  leaveMatch,
});
$('cback').addEventListener('click', () => {
  showStage('welcome'); // reset #connect's inner stage for next time
  statusEl.textContent = '';
  openHub(); // back from the browser → the hub
});
// Выбор языка — кнопка со списком (`localeMenu.ts`, заказ владельца 2026-09-25): на экране
// входа, в хабе и в меню Sector Zero. Выбор сохраняется, перезагрузка перестраивает все
// рендеры на новом языке (кнопки живут только вне партии — терять нечего).
for (const id of ['clang', 'hub-lang', 'sz-lang'])
  mountLocaleMenu($(id), {
    current: () => LOCALE,
    pick: (locale) => {
      setLocale(locale);
      if (typeof location !== 'undefined' && location.reload) location.reload();
    },
  });
localizeStaticDom(); // static markup is canonical-Russian; translate it in place
mountPrivacyLinks();
for (const a of Array.from(document.querySelectorAll('.cfoot a:not([href])'))) {
  a.addEventListener('click', () => {
    statusEl.textContent = t('soon.generic', { what: (a.textContent ?? '').trim() });
  });
}

const refreshAccountDeletion = mountAccountDeletion(() => resolveServer()?.base ?? null, () => {
  leaveMatch(); showHub(false); showConnect(true); showStage('welcome');
  statusEl.textContent = t('account.delete.pending');
}, () => !__SECTOR_ZERO_ONLY__ && authMode === 'accounts');

// hub interactions
$('hub-play').addEventListener('click', () => hubTab('games'));
// Single-player entry from the hub home — offline skirmish vs bots (both builds).
$('hub-solo').addEventListener('click', () => {
  leaveMatch();
  showHub(false);
  openSetup('hub');
});
$('hub-solo-continue').addEventListener('click', restoreSolo);
$('hub-sector-zero').addEventListener('click', () => openSectorZero());
$('hub-proving-ground').addEventListener('click', () => startProvingGround());
$('hub-msg').addEventListener('click', () => {
  hubNote.textContent = t('hub.messages.soon');
});
$('hub-logout').addEventListener('click', async () => {
  // «Сменить командира» must really switch identity: drop this server's session so
  // the next sign-in authenticates the NEW callsign instead of replaying the old JWT.
  const srv = resolveServer();
  if (srv && !(await signOutEverywhere(srv.base))) {
    hubNote.textContent = t('auth.logout.failed');
    return;
  }
  leaveMatch();
  statusEl.textContent = '';
  showHub(false);
  showConnect(true);
  showStage('welcome');
});
for (const b of Array.from(document.querySelectorAll('.hub-tab'))) {
  b.addEventListener('click', () => hubTab((b as HTMLElement).dataset.hub ?? 'home'));
}
// «Прокачка», а с UIX-10.1 и «Рейтинг» с «Друзьями» уехали из нижней навигации (вкладок в ней
// пять) в «Ещё»: плитка открывает ТУ ЖЕ панель, а не свою копию экрана.
document.getElementById('hub-meta')?.addEventListener('click', () => hubTab('meta'));
document.getElementById('hub-rank')?.addEventListener('click', () => hubTab('rank'));
document.getElementById('hub-friends')?.addEventListener('click', () => hubTab('friends'));
document.getElementById('hub-auction')?.addEventListener('click', () => hubTab('auction'));
document.getElementById('hub-supply')?.addEventListener('click', () => hubTab('supply'));
document.getElementById('hub-shop')?.addEventListener('click', () => hubTab('shop'));
document.getElementById('hub-community')?.addEventListener('click', () => hubTab('community'));
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
/** On-demand diagnostics: no pixel readbacks (those alter canvas heuristics),
 * no match/account state, and no automatic upload. Attributes are requests, not
 * proof of which raster backend WebView actually selected.
 */
function mapRenderingReport(): string {
  const rect = canvas.getBoundingClientRect();
  const active = canvasCompatibilityActive();
  const requested = canvasCompatibilityRequested();
  return JSON.stringify({
    schema: 1,
    build: currentBuild(),
    userAgent: navigator.userAgent,
    compatibility: { active, requested, restartPending: active !== requested },
    viewport: { width: VW, height: VH, devicePixelRatio: window.devicePixelRatio,
      renderDpr: DPR, visualScale: window.visualViewport?.scale ?? null },
    canvas: { width: canvas.width, height: canvas.height, cssWidth: rect.width, cssHeight: rect.height,
      attributes: cx.getContextAttributes?.() ?? null, contextLost: cx.isContextLost?.() ?? null,
      events: { ...mapContextEvents } },
    background: { attributes: bgx.getContextAttributes?.() ?? null,
      contextLost: bgx.isContextLost?.() ?? null, events: { ...backgroundContextEvents } },
    frameErrors: frameErrs,
    estimatedFps: Math.round(fpsEma),
    cameraScale: cam.scale,
  }, null, 2);
}
/** Стекло окон ПК и планшета берёт альфу из переменной на `body` (`holographic.css`). */
function applyWindowOpacity(): void {
  document.body.style.setProperty('--holo-window-alpha', String(windowAlpha(windowOpacityPct())));
}
applyWindowOpacity();
const settings = initSettings({
  root: () => settingsEl,
  view: () => ({
    sweepOpacity,
    ownPings: showOwnPings,
    glow: glowOn(),
    starfield: starfieldOn(),
    motion: motionOn(),
    renderCompatibility: canvasCompatibilityRequested(),
    renderCompatibilityActive: canvasCompatibilityActive(),
    renderCompatibilitySupported: /Android/i.test(navigator.userAgent),
    fps: showFpsOn(),
    soundOn: snd.enabled(),
    volume: snd.volume(),
    youColor,
    neutralColor,
    palette: rivalPaletteId,
    touchOnly: !pcUi(),
    speedKeys: devSpeedControl,
    ...(document.body.classList.contains('holo-available') ? { windowOpacity: windowOpacityPct() / 100 } : {}),
    // Чёткость карты есть у экрана, которому есть что понижать (`decisions/mapSharpness.ts`).
    ...(sharpnessMatters(SCREEN_DPR) ? { mapSharp: mapSharpOn() } : {}),
    // Размер интерфейса — множитель зума ПК (`holographicUi.ts`), у телефона его нет.
    ...(pcUi() ? { uiScale: uiScalePct() / 100 } : {}),
    // Нижняя панель есть там, где телефонная раскладка (UIX-3.3); настраивают её и с хаба.
    ...(MOBILE ? { phoneBar: phoneNav.bar() } : {}),
    // Push (UIX-4.4): вкладка есть там, где браузер умеет уведомления.
    ...(push?.view() ? { push: push.view()! } : {}),
    // В сборке одного Sector Zero скорость всегда за минуту забега — выбирать там нечего.
    ...(__SECTOR_ZERO_ONLY__ ? {} : { rateUnit }),
  }),
  setSweepOpacity,
  setWindowOpacity: (v) => {
    setWindowOpacity(Math.round(v * 100));
    applyWindowOpacity();
  },
  // Новый зум подхватит `holographic.sync` на ближайшем кадре.
  setUiScale: (v) => setUiScale(Math.round(v * 100)),
  setOwnPings: setShowOwnPings,
  setGlow: setGlowFx,
  setStarfield: setStarfield,
  setMapSharp: (v) => {
    setMapSharp(v);
    resize();
  },
  setMotion: setMotion,
  setRenderCompatibility: setCanvasCompatibility,
  renderingReport: mapRenderingReport,
  setFps: setShowFps,
  setSound: (v) => snd.setEnabled(v),
  setVolume: (v) => snd.setVolume(v),
  previewSound: () => snd.play('tap'),
  setColors: (you, neutral, palette) => setSideColors(you, neutral, palette),
  resetColors: () => setSideColors(COLOR.p1!, COLOR.null!, 'classic'),
  setPhoneBar: (bar) => phoneNav.setBar(bar),
  setRateUnit: (unit) => {
    rateUnit = unit;
    writeRaw('void.rateUnit', unit);
  },
  setPush: async (on) => push?.setEnabled(on),
  setPushKind: async (kind, on) => push?.setKind(kind, on),
});
// Push-уведомления (UIX-4.4) — у владельца, `pushSetup.ts`: вопрос о согласии, worker,
// подписка и виды. Стоит ПОСЛЕ окна настроек: `changed` перерисовывает его.
const push = __SECTOR_ZERO_ONLY__
  ? null
  : initPush({
      authorizedBase: hubAuthorizedBase,
      askRoot: () => $('pushask'),
      changed: () => {
        if (settingsEl.classList.contains('show')) settings.render();
      },
    });
/** Окно настроек; вход и подписка перечитываются — вкладка «Уведомления» покажет их свежими. */
function openSettings(): void {
  settings.open();
  push?.refresh().catch(() => undefined); // не вышло перечитать — вкладка покажет прошлое
}
$('hub-settings').addEventListener('click', openSettings);
$('hub-gear').addEventListener('click', openSettings);
// Rail: settings are reachable mid-match too, not only from the hub's «Ещё» tab.
document.getElementById('rail-settings')?.addEventListener('click', openSettings);

// Сессия аккаунта — у своего владельца (`accountSession.ts`). Проводка стоит до
// загрузочного блока: его ветка по ссылке может попросить войти.
let activity: ReturnType<typeof startPlayerActivity> | undefined;
initAccountSession({
  sessionChanged: () => {
    activity?.refresh();
    arsenal?.forget();
  },
  status: (text) => {
    statusEl.textContent = text;
  },
  note,
  welcomePassword,
  // Карточка входа живёт ВНУТРИ экрана подключения, поэтому экран показывают, а не прячут.
  // Прятали — и игрок, которому отказали в билете (сессия истекла), оставался на карте
  // прошлой партии без карточки и без строки «введите пароль» (нашла живая проверка
  // REFM-215; та же ошибка, что ADDR-5 вычистил из ветки по ссылке).
  showSignIn: (srv) => {
    showConnect(true);
    showHub(false);
    showStage('welcome');
    if (!srv) return;
    fillWelcome(srv.nick ?? '', 'show');
  },
});

// The shared entry always starts at login, including returning commanders with a
// saved callsign or local Sector Zero run. Identity leads to the main hub; the
// player chooses a mode there. A save is data to continue, not a navigation request.
//
// Explicit deep-link overrides (checked before the ordinary login entry):
//  «?reset=<token>» — a mailed password-reset link → the reset page (set a new password).
//  «?join=<id>»     — a new tab spawned by «Войти» in the match list → straight into THAT
//                     session, reusing this browser's stored identity (nick / session JWT).
//
// These two belong to the accounts section below (SES-2.5), but they MUST be declared
// before this boot block: its async IIFEs read them SYNCHRONOUSLY when resolveServer()
// yields no server (no await happens before the read) — with the declarations after the
// block that read is a TDZ, and esbuild's const/let→var lowering turns the crash into a
// silent `undefined` (the httpBase trap; caught by tsc TS2448 when the prototype gained
// a typecheck). `authMode` and `pendingJoinAfterAuth` stood here for the same reason;
// they now live in `accountSession.ts` (REFM-215), and an import is initialized before
// the first line of this file runs.
/** Игрок пришёл ПО ССЫЛКЕ на партию, а не через экран подключения. Решает, куда его
 *  посадить, если войти не дали: у пришедшего по ссылке нет экрана, на который можно
 *  вернуться, — ему его надо дать (ADDR-5). Раньше это выводилось из невидимости
 *  оверлея, но оверлей теперь держится до впуска, и признак стал самостоятельным. */
let cameFromLink = false;
const bootParams = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
// YAG-1.1c: в архиве площадки обе двери по ссылке закрыты — и сброс пароля, и вход в
// партию ведут в основную игру, которой там нет. Любой адрес открывает Sector Zero.
const bootReset = __SECTOR_ZERO_ONLY__ ? '' : (bootParams?.get('reset') ?? '').trim();
// ADDR-3: партия адресуется ПУТЁМ (`/game/<id>`), но старый хвост (`?join=<id>`) уже
// роздан игрокам и лежит в закладках — читаем обе формы, пишем только новую.
const bootJoinId =
  !__SECTOR_ZERO_ONLY__ && bootParams ? matchIdFrom(location.pathname, bootParams) : '';
// ADDR-2: что ссылка просит СВЕРХ адреса партии. Отдельный вопрос от «куда вести» —
// решение в `decisions/matchAddress.ts` (правила: адрес несёт только id, параметры
// захвата одноразовы, сидящему в партии они не адресованы вовсе).
const bootClaim = bootParams ? claimIntent(bootParams, false) : null;
const bootSlot = bootClaim?.slot ?? '';
const bootFaction = bootClaim?.faction ?? '';
const bootScientists = bootClaim?.scientists ?? [];
if (bootReset) {
  openReset(bootReset);
} else if (bootJoinId) {
  // Direct deep-link into a match. Two paths:
  //  (a) cached session JWT → connectToMatch immediately (no welcome card)
  //  (b) no session → show welcome card, welcomeSignIn auto-resumes the join
  //
  // ПОКА НЕ ВПУСТИЛИ — КАРТА ЗАКРЫТА. Раньше ветка начиналась с `showConnect(false)`, и
  // это снимало оверлей ДО того, как станет известен исход: пришедший по ссылке видел
  // карту, пока сервер ещё только решал, пускать ли его. Тому, кого не пустят, она не
  // предназначалась вовсе. Оверлей снимает единственное честное событие — приход
  // приветственного снимка (там `showConnect(false)` и стоит); ровно об этом же
  // предупреждает правило 2 в `socketFate.ts`: «отвергнутый вход мигнёт игроку картой».
  cameFromLink = true;
  showConnect(true);
  showHub(false);
  detach(
    'ссылка-приглашение: посадка',
    (async () => {
      const srv = resolveServer();
      if (srv) await probeAuthMode(srv.base);
      // Куда ведёт ссылка — `joinLanding.ts` (ADDR-5): сервер без аккаунтов пускает сразу,
      // живая сессия ведёт в матч, её отсутствие — на стартовый экран.
      // NEVER log the record — even a prefix of `cached.token` is a session-JWT leak
      // into the browser console (and into any screen recording of a playtest).
      const cached = srv ? sessionRecord(srv.base) : null;
      // Закладка на партию — тоже возвращение: продлеваем сессию и здесь (AC-0.2), иначе
      // игрок, входящий только по ссылке, через неделю снова упрётся в пароль. Мёртвую
      // сессию продление стирает, и посадка честно ведёт на карточку входа.
      const resumed = srv && cached && authMode === 'accounts' ? await resumeSession(srv.base, cached.login) : null;
      const where = joinLanding({
        identity: authMode,
        hasSession: !!cached && resumed !== 'gone',
        refused: false,
      });
      if (where === 'match') {
        showStage('browse');
        connectToMatch(bootJoinId, bootSlot || undefined, bootFaction || undefined, bootScientists);
        return;
      }
      // No session — show the welcome card so the player can register/login,
      // then welcomeSignIn auto-resumes the join via pendingJoinAfterAuth.
      pendingJoinAfterAuth.remember(bootJoinId, bootSlot, bootFaction, bootScientists);
      // ADDR-5. Оверлей ветка держит показанным с самого начала, так что строка здесь —
      // не «показать», а «не дать погаснуть»: когда-то ветка начиналась со скрытого
      // оверлея, и карточка входа выставлялась ВНУТРИ него — игрок получал пустой экран.
      showConnect(true);
      showStage('welcome');
      const savedNick = (localStorage.getItem('void.nick') ?? '').trim();
      fillWelcome(savedNick, 'show');
    })(),
  );
} else if (document.body.dataset.entry === 'sector-zero') {
  // The direct Sector Zero page enters its own home after the host is initialized.
  // No identity or server request is needed for this local run.
  showConnect(false);
  showHub(false);
} else {
  // Auth gate at boot: the welcome/login card is the boot screen, before the hub.
  // A cached `void.nick` alone once skipped straight to `openHub()` and left the player
  // in the hub with no valid session, so every Join silently failed. Remember-me
  // (AC-0.2) skips the card only on PROOF: the server renews the stored session of
  // this callsign (`resumeSession`), and only a live renewal opens the hub. A dead one
  // is erased, an unanswered one is kept — both show the card as before, password row
  // included, so the player can still sign in by hand.
  showConnect(true);
  showHub(false);
  showStage('welcome');
  detach(
    'стартовый экран: режим входа сервера',
    (async () => {
      const srv = resolveServer();
      const mode = srv ? await probeAuthMode(srv.base) : authMode;
      const savedNick = (localStorage.getItem('void.nick') ?? '').trim();
      if (mode === 'accounts') {
        const resumed = srv && savedNick ? await resumeSession(srv.base, savedNick) : null;
        // Пока продлевали, игрок мог уйти с карточки (регистрация, восстановление) или
        // уже войти сам — тогда хаб его не перебивает.
        const stillWelcome = connectShown() && $('connect').dataset.stage === 'welcome';
        if (resumed === 'live' && stillWelcome) {
          nickInput.value = savedNick;
          openHub();
          return;
        }
        fillWelcome(savedNick, 'show');
      } else fillWelcome(savedNick, 'hide');
    })(),
  );
}

// --- single-player setup overlay --------------------------------------------
// Экран и его состояние — у владельца, `setupScreen.ts` (REFM-212). Отсюда — только то,
// что принадлежит игре: места матча, позывной, прокачка, часы, опрос мест, экраны и старт.
initSetupScreen({
  seats: SEAT_META,
  nick: () => nickInput.value,
  meta: () => loadMeta(),
  net: () => NET,
  halt: () => {
    speed = 0;
  },
  stopNetPoll: () => stopNetSetupPoll(),
  showConnect,
  openHub: () => openHub(),
  startMatch: (setup) => startMatch(setup),
  joinMatch: (id, slot, faction, scientists) => connectToMatch(id, slot, faction, scientists),
  mapLabel,
  // Чужой мир на мини-карте — цветом войны из выбранной палитры: так соперник выглядит
  // и на карте партии, и игрок с CVD-палитрой не получит красно-зелёную пару.
  sideColors: () => ({ you: youColor, rival: paletteOf(rivalPaletteId).war }),
});

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

// Install a ready GameState as the live match: reset all interaction state, queues,
// camera and log, then hide the setup overlay. `aiPlayers` are the seats the local
// sim drives. Shared by the normal skirmish and (via a hook) the dev test mode.
function installMatch(state: GameState, aiPlayers: Map<string, AiProfile>, modeId?: string): void {
  leaveNetwork(); // свой мир — уже не сетевая партия: гаснут и дозвон, и признак серверного мира
  leaveSolo();
  forgetLesson(); // startGuidedMatch raises it again after its own install
  stopSim(); // поток считал мир прошлого матча
  forgetAutoAssault();
  leaveRun();
  needMapPreparation();
  // PVR-1.1: режим вооружается ЗДЕСЬ, до первого хода часов — как у сервера, где он
  // фиксируется при рождении комнаты. Опущен = обычная партия без режима, и это же
  // снимает режим предыдущего матча: без сброса PvE-волны утекли бы в следующую соло-игру.
  setMatchMode(modeId);
  s = state;
  // ROADS-7: состояние из сохранения прошло через JSON и потеряло метку разделяемой сети
  // дорог — без неё каждый шаг мира копировал бы всю сеть заново.
  shareRoadNetwork(s.planets);
  installMapGeometry(s);
  syncPlayerNames(s);
  ME = 'p1';
  AI_PLAYERS = new Map(aiPlayers);
  for (const p of Object.values(s.players)) if (p.npc && p.ai) AI_PLAYERS.set(p.id, 'weak');
  pirateIntro.reset();
  hideSwarmDossier();
  solo.reset();
  // ONB-2 (found live): a leftover guide from whatever was on screen before (a
  // tutorial the player exited without finishing/skipping, a stale reconnect) must
  // never survive into this match — #spotlight is a document.body singleton, so an
  // un-stopped tour keeps painting its last step over the NEW match too. Runs before
  // `maybeStartPendingTour()` (below) arms this match's own guide, if any.
  activeTour?.stop();
  // Reset interaction + queues + camera to the framed whole-map view.
  disarm('match', MOBILE); // выбор, прицелы и окна старого матча указывают на то, чего здесь нет
  forgetAdditive();
  if (chainMode) exitChainMode(); // режим «Приказ» не переживает смену матча
  forgetChainRoutes(); // маршруты принадлежат карте СТАРОГО матча
  resetEventFeed(); // журнал, сводка возвращения и память боёв — у владельца ленты (REFM-230)
  resetFogMemory(); // fog memory belongs to the OLD match — and its vision was written into it
  worldMemo = null;
  forgetRadarContacts();
  resetThreatAlerts(); // тревоги и доклады союзника старого матча — у владельца полосы (REFM-222)
  clearFlak();
  forgetAway(); // reset the away-window baseline for the new match
  banner = null; // clear any end-banner left by the menu-background match (else it sticks)
  endScreen = null; // a fresh match must not open into the previous result
  matchEnd.reset(); // новый матч зарабатывает свою награду
  // The match goal, written AFTER the wipe so it is the first line a player can read.
  // Kept honest against the kernel: victoryModule ends on score (SCORE_LIMIT), on
  // elimination, or on domination — no "capital capture" victory exists.
  const waves = data.modes[modeId ?? '']?.pve?.waves;
  note(
    modeId !== undefined && modeId === trainingModeId()
      ? t('training.goal') // полигон кончается взятием миров противника, а не очками
      : waves ? t('hud.goal.pve', { n: waves }) : t('hud.goal', { n: SCORE_LIMIT }),
  );
  defaultView(); // phone / flagship console: home; simple desktop: whole-map fit
  setupEl.style.display = 'none';
  // SANDBOX — fenced hook. A fresh match starts with no frozen-queue carryover and the
  // practice tools off; startMatch() re-arms them if the setup checkbox was ticked.
  if (!__PLAYER_BUILD__) {
    resetSandboxRuntime();
    sandboxConfig.enabled = false;
    setSandboxButton(false);
  }
  // FOG-13: зрение ЭТОЙ партии — до засевающего шага мира, который вызывающий делает
  // сразу следом, ещё до первого кадра. `s` и `ME` уже новые, а песочница прошлой
  // партии уже снята: её выключенный туман не должен стать «видно всё» новой
  // (замечание Codex на #1490).
  refreshVision();
  // Start the queued tour after the prepared HUD is actually visible.
  snd.play('start'); // приглушённая фанфара — матч начался (соло и дев-сценарии)
}
function startMatch(
  setup: SetupConfig,
  persist = true,
  scenario: (st: GameState) => GameState = (st) => st,
): void {
  const st = scenario(newGame(setup));
  // Сложность каждого соперника берётся из его строки на экране настройки (AIDIFF-1).
  // Политика локального хоста хранится рядом с миром в одиночном сохранении.
  const profiles = new Map<string, AiProfile>();
  for (const seat of setup.seats) {
    if (!seat.ai) continue;
    const i = SEAT_META.findIndex((m) => m.id === seat.id);
    profiles.set(seat.id, (i >= 0 ? seatAiProfile(setupSlots[i]) : null) ?? 'weak');
  }
  installMatch(st, profiles, st.modeId);
  applyTimeSpeed(setupSpeed); // launch running at the chosen time-flow multiplier
  // SANDBOX — fenced hook. Arm the practice tools for this match from the setup
  // checkbox; remember the home world for the immortal-home toggle and show the opener.
  if (!__PLAYER_BUILD__) {
    sandboxConfig.enabled = ($('setupsandbox') as HTMLInputElement | null)?.checked ?? false;
    sandboxHomeId = setup.seats[0]?.start ?? null;
    setSandboxButton(sandboxConfig.enabled);
  }
  enterSolo(persist);
}

/** Запуск ЗАБЕГА: игрок против Роя, плюс неподвижный пиратский гарнизон карты. */
function startPvEMatch(dev = false): void {
  const testing = !__PLAYER_BUILD__ && dev;
  saveRun(); // preserve a paused normal attempt before replacing the in-memory world
  beginAttempt(testing);
  // Новая попытка (`YAG-5.1`); «Продолжить» — та же попытка, её исход придёт своим событием.
  if (!testing)
    getPlatform().analytics.emit('pve_started', {
      chapter: pveChapter(sectorMission).id,
      difficulty: pveDifficulty,
      attempt: sectorAttempt,
    });
  const st = prepareSectorZeroRun(chapterWorld(sectorMission, pveDifficulty), sectorProgress, data);
  // Гарнизон без полевого ИИ ждёт игрока; сложность управляет штурмом Роя.
  const aiSeats = runAiSeats(st, 'p1', pveDifficulty);
  // Режим берётся из САМОЙ КАРТЫ, а не зашит здесь: карта объявляет, подо что её играют
  // (§0.7 sector-zero-roadmap.md). Без этого `pveModule` стоял в ядре и молчал — секции
  // `pve` он не видел, потому что конфиг ехал без `modeId`.
  installMatch(st, aiSeats, pveModeId(sectorMission));
  enterRun(testing ? 'dev' : 'run');
  if (!__PLAYER_BUILD__ && testing) {
    resetSandboxConfig();
    sandboxConfig.enabled = true;
    sandboxHomeId = Object.values(s.planets).find(p => p.owner === ME && p.kind === 'planet')?.id ?? null;
    setSandboxButton(true);
    setDevSpeedControl(true);
  }
  // Seed the PvE section through the kernel before the first save. A page can
  // close before its first animation frame; that must not lose a fresh attempt.
  apply(advance(s, s.time + 1));
  // Стартовые флоты главы — одним флотом вокруг корабля героя (решение владельца
  // 2026-09-26, `decisions/startFleets.ts`). Сливает ядро, приказом: его правила в силе.
  for (const m of startFleetMerges(s, ME)) {
    const merged = order(s, mergeFleet(ME, m.from, m.into), s.time);
    if (!merged.error) apply(merged);
  }
  // У забега СВОЙ темп, а не дефолт песочницы: на ×10 полное прохождение занимало бы
  // около четырнадцати часов (PVR-2.2, решение владельца §0.3).
  applyTimeSpeed(RUN_SPEED_NORMAL, RUN_SPEED_FAST);
  showConnect(false);
  showHub(false);
  setupEl.style.display = 'none';
  sciWin.classList.remove('show');
  saveRun();
  note(t('setup.pve.started'));
  // Союзник на связи с первой минуты (`contactAtStart`, главы V и VI): встречи, которая
  // зажигает чип «⬡ Союзник» в главе IV, не будет — та же заметка и мигание со старта.
  if (linkedAlly(s, ME)) {
    note(t('ally.contact.note'));
    allyPulseUntil = performance.now() + 12_000;
  }
}

/**
 * УЧЕБНЫЙ ПОЛИГОН «Протокол допуска» (`docs/sector-zero-map-concepts.md` §14). Не глава и не
 * забег: у мира нет секции `pve`, поэтому ни волн, ни досье Роя (§14.6), ни снимка забега,
 * ни засчёта в профиль. Темп и инструменты — забега (`setRunActive`), чтобы полигон учил
 * тому же управлению, что ждёт в главе I.
 */
function startTraining(): void {
  saveRun(); // пауза обычной экспедиции переживает полигон — «Продолжить» её поднимет
  // Учебный противник сам не ходит (§14.2: соединения вводятся по этапам) — ИИ-мест нет.
  // Герой, арсенал и оснащение — те же, что поедут в главу I (`prepareSectorZeroRun`):
  // полигон учит тем кораблям, с которыми игрок пойдёт дальше.
  // TRN-2: двенадцать этапов §14.4 — по одной подсказке, этап засчитывает дело, а не
  // «Далее». Отметка роста снимается, когда HUD уже живой, — от неё этапы и считаются.
  trainingResume.hide();
  setPendingGuide(() => {
    const baseline = trainingBaseline(s, ME, data);
    const steps = buildTrainingTour({
        world: () => s,
        me: ME,
        data,
        baseline,
        ui: trainingTourUi({
          world: () => s, me: () => ME, mobile: MOBILE,
          expanded: () => mobileHud.expanded(selPlanet ? `planet:${selPlanet}` : `fleet:${selFleet}`), collapse: () => mobileHud.collapse(), tab: () => planetTab,
          ships: () => { setPlanetTab('ships'); },
          // Synchronize the phone selection before Show expands its sheet.
          render: () => { invalidatePanel(); renderPanel(); updateMobileHud(); },
        }),
        introduced: forceIntroduced,
      });
    // «Пропустить обучение» оставляет кнопку «Вернуть обучение» (заказ владельца
    // 2026-10-25): подсказки вернутся с начала этапа, на котором их закрыли.
    const run = (from: number): void =>
      launchTour(
        steps,
        (r) => {
          if (r.skipped && isTraining() && s.match.status !== 'ended')
            trainingResume.offer(resumeStep(steps.map((step) => step.stage), r.reachedStep));
        },
        from,
      );
    trainingResumeRun = run;
    run(0);
  });
  installMatch(prepareSectorZeroRun(trainingState(data), sectorProgress, data), new Map(), trainingModeId());
  enterRun('training');
  apply(advance(s, s.time + 1));
  const merge = trainingFlagshipMerge(s, ME);
  if (merge) {
    const prepared = order(s, mergeFleet(ME, merge.from, merge.into), s.time);
    if (!prepared.error) apply(prepared);
  }
  // TRN-3: силы противника, контратака и исход — у сценария; на входе он начинается заново.
  resetTrainingScenario(s.time);
  applyTimeSpeed(RUN_SPEED_NORMAL, RUN_SPEED_FAST);
  showConnect(false);
  showHub(false);
  setupEl.style.display = 'none';
  sciWin.classList.remove('show');
  note(t('training.started'));
}

/**
 * ПОЛИГОН ОСНОВНОЙ ИГРЫ (M2.15, заказ владельца 2026-09-29): все области и весь каталог,
 * старт песочницей (`provingGroundState`). Обычная партия основной игры — без режима, волн
 * и наград; соперник и Рой ходят местами ИИ, как в главах (`runAiSeats`). В одиночное
 * сохранение полигон не пишется: «Продолжить» в хабе остаётся за обычной партией.
 */
function startProvingGround(): void {
  leaveMatch();
  const st = provingGroundState(data);
  installMatch(st, runAiSeats(st, PROVING_GROUND_PLAYER, 'weak'));
  applyTimeSpeed(setupSpeed);
  showConnect(false);
  showHub(false);
  note(t('proving-ground.started'));
}

let creatingMatch = false;
function createOnlineMatch(mapId: MapId): void {
  if (creatingMatch) return;
  const srv = resolveServer();
  if (!srv) { note(t('acc.server-down')); return; }
  // Подписи у двух кнопок свои: «Создать сетевую игру» в настройке схватки, «Создать» на
  // странице «Матчи» (UIX-17.1). После запроса каждая возвращает свою.
  const buttons = [
    { button: $('setup-network-create') as HTMLButtonElement, label: t('setup.network.create') },
    { button: $('match-create-go') as HTMLButtonElement, label: t('browser.create.go') },
  ];
  creatingMatch = true;
  for (const { button } of buttons) { button.disabled = true; button.textContent = t('setup.network.creating'); }
  detach('create match', (async () => {
    try {
      const pass = tokenFor(localStorage, srv.base, srv.nick);
      const res = await fetch(`${httpBase(srv.base)}/matches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(pass ? { authorization: `Bearer ${pass}` } : {}) },
        body: JSON.stringify({ mapId }),
      });
      if (!res.ok) {
        const refusal = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(refusal?.error ?? 'E_CREATE_MATCH');
      }
      const body = await res.json() as { matchId: string };
      await openSeatPicker(body.matchId);
    } catch (err) {
      note(t(err instanceof Error && err.message === 'E_MATCH_QUOTA' ? 'setup.network.quota' : 'setup.network.failed'));
    }
    finally {
      creatingMatch = false;
      for (const { button, label } of buttons) { button.disabled = false; button.textContent = label; }
    }
  })());
}
$('setup-network-create').addEventListener('click', () => {
  if (!netSetup) createOnlineMatch(setupMapId);
});
$('match-create-go').addEventListener('click', () => {
  createOnlineMatch(mapPreset(($('match-create-map') as HTMLSelectElement).value).id);
});

// --- match browser (the meta-shell "Play" tab) -------------------------------
// The list itself — tabs, filter, archive and the hub's «Мои партии» — lives in
// `matchBrowser.ts` (REFM-217); the server box it reads stays here.

/** Normalize the pasted server box to a ws(s):// ORIGIN + read the nick. Returns
 *  null (and sets the status line) when either is missing/invalid. Shared by the
 *  match browser and `connect()`. */
function resolveServer(): { base: string; nick: string } | null {
  // Разбор набранного — `serverAddress.ts` (REFM-162): схема правится (скопированный из
  // браузера `https://` → `wss://`, голый хост дополняется схемой страницы, а на
  // HTTPS-странице `ws://` поднимается до `wss://` — иначе браузер молча режет сокет),
  // путь отбрасывается, а пустой ПОЗЫВНОЙ не пускает дальше МОЛЧА: пробу режима
  // аккаунтов зовут из загрузочного блока, до того как игрок что-то напечатал.
  const step = resolveAddress({
    server: srvInput.value,
    nick: nickInput.value,
    pageHttps: location.protocol === 'https:',
  });
  if (step.kind === 'ok') return { base: step.base, nick: step.nick };
  if (step.kind !== 'need-nick') statusEl.textContent = t(step.key);
  return null;
}

if (!__SECTOR_ZERO_ONLY__) activity = startPlayerActivity(() => {
  const step=resolveBase(srvInput.value,location.protocol==='https:');
  const base=step.kind==='ok' ? step.base : null;
  const token=base ? sessionToken(base) : null;
  return base && token ? {base:httpBase(base),token} : null;
});

// MUST stay a hoisted function declaration — NOT a `const` arrow. The boot block
// (~900 lines above) does `await probeAuthMode(...)` during module evaluation, and an
// async body runs synchronously up to its first `await` — so httpBase is CALLED long
// before a `const` on this line would be initialized. esbuild's minifier lowers a
// top-level `const` to `var`, so instead of a loud TDZ error this surfaced in the
// deployed bundle as `TypeError: Kn is not a function`, which rejected the whole boot
// chain: the welcome card never revealed its password field and a `?join=<id>` deep-link
// never reached connectToMatch (the seat was never claimed).

// --- accounts (SES-2.5) -------------------------------------------------------
// The account flow itself — the server's identity mode, the stored session, login-or-
// register and the join token — lives in `accountSession.ts` (REFM-215); the welcome
// card it drives, with the first-visit probe started here, in `signInPages.ts`
// (REFM-218). The direct Sector Zero page probes no server unless a link brought it.
startAuthProbe(
  document.body.dataset.entry === 'sector-zero' && !bootJoinId && !bootReset
    ? ''
    : srvInput.value.trim(),
);

// --- loop --------------------------------------------------------------------

const fpsEl = $('fps');
// Dev FX lab (dev client + DEV_UI only): push a demo siege volley between two nodes
// without staging a real standoff duel — for design review and the FX screenshot
// tests. Compiled out of the player build (dev tooling, not diagnostics).
if (!__PLAYER_BUILD__ && DEV_UI && typeof window !== 'undefined') {
  const oxy = (p: { x: number; y: number }): { ox: number; oy: number } => ({
    ox: p.x,
    oy: p.y,
  });
  (window as unknown as { __vdFx?: object }).__vdFx = {
    // e2e probe: page-space anchors of own fleets and all worlds — lets a browser
    // test tap real map objects without guessing coordinates. Dev chrome, read-only.
    probe(): {
      fleets: Array<{ id: string; x: number; y: number; ox: number; oy: number }>;
      worlds: Array<{ id: string; x: number; y: number; owner: string | null }>;
    } {
      const r = canvas.getBoundingClientRect();
      const sx = (p: { x: number; y: number }) => toScreen(p, r, VW, VH);
      return {
        fleets: Object.values(s.fleets)
          .filter((f) => f.owner === ME)
          // fleetAnchor is null for a fleet with no drawable position — skip it
          .flatMap((f) => {
            // Обе точки флота: `x,y` — моделька (по ней тапают, она кружит по кольцу),
            // `ox,oy` — точка отсчёта (её знает ядро, она неподвижна на стоянке).
            const a = fleetAnchor(f);
            const o = fleetOriginPx(f);
            return a && o ? [{ id: f.id, ...sx(a), ...oxy(sx(o)) }] : [];
          }),
        worlds: Object.values(s.planets).map((p) => ({
          id: p.id,
          owner: p.owner,
          ...sx(world(p.position)),
        })),
      };
    },
    // Stock the first own fleet with hold cargo (shuttles in the hold + landing
    // troops + a fake in-progress load) so the emblem's cargo tail can be previewed
    // without building a carrier — dev chrome, mutates local state only.
    stockFleet(): string | null {
      const f = Object.values(s.fleets).find((x) => x.owner === ME);
      if (!f) return null;
      const wing = f.units.find((st) => isShuttle(st.unit));
      if (wing) wing.count += 2;
      else f.units.push({ unit: 'interceptor', count: 2 });
      (f.landing ??= []).push({ unit: 'militia', count: 2 });
      (f.loading ??= []).push({
        unit: 'interceptor',
        count: 1,
        from: f.location ?? '',
        startAt: s.time,
        doneAt: s.time + HOUR,
      });
      worldMemo = null; // edited in place: the top bar must count the new wing's upkeep
      return f.id;
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
      flashProvince(node, owner);
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
// Окно двойного нажатия и сами вердикты Back — `backGesture.ts` (REFM-198).
let backHintAt = -Infinity;

/** In a live match (the map backdrop), i.e. none of the chrome SCREENS is up. The
 *  three toggle `display` between 'flex'/'none'; on a fresh boot they read '' (CSS
 *  default) ≠ 'none', so this is false until the player actually enters a match —
 *  exactly when Back must stop silently unloading the page. */
function inMatch(): boolean {
  return (
    connectEl.style.display === 'none' &&
    hubEl.style.display === 'none' &&
    !sectorZeroMenu.isOpen() &&
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
  { id: 'match-description', isOpen: isMatchDescriptionOpen, close: closeMatchDescription }, // native top layer
  { id: 'comic', isOpen: () => comicPlayer.isOpen(), close: () => comicPlayer.skip() }, // z90
  { id: 'maploading', isOpen: () => mapPreparation.active, close: leaveLoadingMap }, // z70
  { id: 'intro', isOpen: () => shown('intro'), close: () => hide('intro') }, // z61, above the cabinet it explains
  // --- модалки поверх всего (z60…z57) ---
  { id: 'solo-replace', isOpen: () => flexed('solo-replace'), close: closeSoloReplace }, // z60
  { id: 'corp', isOpen: () => flexed('corp'), close: () => corp?.close() }, // z60
  { id: 'scipick', isOpen: () => shown('scipick'), close: () => hide('scipick') }, // z60
  { id: 'emblempick', isOpen: () => shown('emblempick'), close: () => hide('emblempick') }, // z60
  { id: 'swarm-dossier', isOpen: () => !swarmDossierPinned && shown('swarm-dossier'), close: closeSwarmDossier }, // z60 modal only
  { id: 'settings', isOpen: () => shown('settings'), close: () => hide('settings') }, // z59
  { id: 'sector-zero', isOpen: () => sectorZeroMenu.canGoBack(), close: () => sectorZeroMenu.back() }, // z58
  // dev-оверлеи: в плеерной сборке узлов нет, проба просто всегда false
  { id: 'testmode', isOpen: () => flexed('testmode'), close: () => hideFlex('testmode') }, // z59
  { id: 'sandbox', isOpen: () => flexed('sandbox'), close: () => hideFlex('sandbox') }, // z59
  // Оверлей мест остался только заглушкой на время загрузки и на отказ (ENTRY-2):
  // выбор переехал на экран настройки, поэтому закрывать его нечем, кроме как скрыть.
  { id: 'seatpick', isOpen: () => flexed('seatpick'), close: closeSeatPicker }, // z58
  { id: 'recap', isOpen: () => shown('recap'), close: () => hide('recap') }, // z57
  { id: 'profile', isOpen: () => shown('profile'), close: () => profile?.close() }, // z57
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
  { id: 'coalwin', isOpen: () => coalOpen, close: () => closeCoalitions() }, // z49, окно коалиций
  // Проба по состоянию, а не по классу: `orderPromptOpen` (запрос войны или окно погрузки) — источник истины, класс лишь его
  // отражение. Back здесь обязан вести в ОТМЕНУ: подтверждение объявляет войну, и вешать
  // необратимое действие на аппаратную кнопку нельзя.
  { id: 'warprompt', isOpen: orderPromptOpen, close: () => cancelWarPrompt() }, // z48
  // «Завершить экспедицию?» — та же ступень и то же правило: Back ведёт в «остаться».
  { id: 'abandon', isOpen: () => shown('abandon'), close: () => closeAbandon() }, // z48
  { id: 'pushask', isOpen: () => push?.asking() ?? false, close: () => push?.dismiss() }, // z48
  { id: 'pingmenu', isOpen: () => pings?.menuOpen() ?? false, close: () => pings?.closeMenu() }, // z47
  { id: 'tech', isOpen: () => techWin.classList.contains('show'), close: () => techWin.classList.remove('show') }, // z47
  { id: 'steward', isOpen: () => stewWin?.classList.contains('show') === true, close: () => stewWin?.classList.remove('show') }, // z47
  // Окно боя — та же ступень z47, что и «Хранитель»: оно модалка поверх карты, и Back
  // обязан закрывать именно его, а не выделение под ним.
  { id: 'battlewin', isOpen: () => shown('battlewin'), close: () => hide('battlewin') }, // z47
  { id: 'market', isOpen: () => marketWin.classList.contains('show'), close: () => marketWin.classList.remove('show') }, // z47
  { id: 'trader', isOpen: () => trader.isOpen(), close: () => trader.close() }, // z47 торговец экспедиции
  { id: 'ally', isOpen: () => allyScreen.isOpen(), close: () => allyScreen.close() }, // z47 связь с союзником
  { id: 'constructor', isOpen: () => constructorWin.classList.contains('show'), close: () => shipyard.close() }, // z47 «Производство»
  { id: 'codex', isOpen: () => shown('codex'), close: () => hide('codex') }, // z46
  // «Постройки» стоят НИЖЕ кодекса (z45): карточка здания открывается поверх окна,
  // и Back обязан сначала закрыть её, а уже потом само окно.
  { id: 'buildwin', isOpen: () => buildWinEl.classList.contains('show'), close: () => buildWinEl.classList.remove('show') }, // z45 «Постройки»
  // Двухступенчатый Back режима «Приказ» (CHAIN-UX): сперва меню точки…
  {
    id: 'tgted',
    isOpen: () => chainMode?.menu != null,
    close: () => {
      dropChainMenu();
      hide('tgted');
    },
  }, // z46
  { id: 'logwin', isOpen: () => logWin?.classList.contains('show') === true, close: () => logWin?.classList.remove('show') }, // z46
  { id: 'codexhub', isOpen: () => shown('codexhub'), close: () => hide('codexhub') }, // z45
  { id: 'arsenal-sheet', isOpen: () => arsenal?.isOpen() ?? false, close: () => arsenal?.close() }, // inside the hub (z52), under the codex opened from it
  { id: 'shop-sheet', isOpen: () => shop?.isOpen() ?? false, close: () => shop?.close() }, // inside the hub (z52)
  { id: 'news-sheet', isOpen: () => news?.isOpen() ?? false, close: () => news?.close() }, // inside the hub (z52), the feed and a corp card
  { id: 'corp-sheet', isOpen: () => corp?.hubSheetOpen() ?? false, close: () => corp?.closeHubSheet() }, // inside the hub (z52), a building, levels, a member
  { id: 'pingpanel', isOpen: () => pings?.panelOpen() ?? false, close: () => pings?.closePanel() }, // z60
  { id: 'pingpop', isOpen: () => shown('pingpop'), close: () => pings?.closePop() }, // z45
  { id: 'splitdlg', isOpen: () => splitState !== null, close: () => { drop('splitState'); invalidatePanel(); } }, // z45
  // Всплывашка надбавок стоит над окном флота: Back закрывает её, а не выделение под ней.
  { id: 'statpop', isOpen: statPopOpen, close: closeStatPop }, // z43
  // --- низ экрана (z27…z20) ---
  { id: 'chatwin', isOpen: () => chatWin?.isOpen() ?? false, close: () => chatWin?.close() }, // z27
  { id: 'mobile-picker', isOpen: () => MOBILE && mobileChoices.length > 0, close: () => offerChoices([]) },
  // Поповеры ряда команд живут ВНУТРИ #cmdbar: прячет их ближайший renderCmdBar, но
  // кэш разметки надо сбить руками, иначе строка не изменится и DOM останется прежним.
  {
    id: 'cmdbar',
    isOpen: () => anyArmed('back-popover', MOBILE),
    close: () => {
      disarm('back-popover', MOBILE);
      invalidateCmdBar();
    },
  }, // z26
  // …а вторым Back — сам режим (черновик выбрасывается, живые планы не тронуты).
  { id: 'chain', isOpen: () => chainMode !== null, close: () => exitChainMode() },
  // Любой прицел — и из окон тоже (`armDisarm.ts`, правило 9): прицел героя, удара или
  // союзника иначе переживал Back, и следующий тап по карте срабатывал.
  {
    id: 'aim',
    isOpen: () => anyArmed('back-aim', MOBILE),
    close: () => {
      if (MOBILE) cancelMobileOrder();
      disarm('back-aim', MOBILE);
      invalidatePanel();
    },
  },
  // Раскрытая панель инструментов рельсы: на телефоне она занимает пол-экрана, а CSS-опись
  // её не видит — узел живёт всегда, раскрытость это класс `.open` (см. EXTRA_LAYERS).
  { id: 'rail', isOpen: () => railEl.classList.contains('open'), close: () => setRailOpen(false) }, // z26
  // Лист «Ещё» нижней панели телефона (UIX-3.1): узел живёт всегда, открытость — `hidden`.
  { id: 'phone-more', isOpen: () => phoneNav.moreOpen(), close: () => phoneNav.closeMore() }, // z41
  // Раскрытый ряд скорости телефона (UIX-3.2): узел — полоса скорости, раскрытость — класс `body`.
  { id: 'phone-speed', isOpen: () => phoneSpeed.isOpen(), close: () => phoneSpeed.close() }, // z41
  // Панель задач забега: открыта чипом «Задачи», закрывается и Escape/Back (см. EXTRA_LAYERS).
  { id: 'missions', isOpen: () => missionPanel.isOpen(), close: () => missionPanel.toggle(false) }, // z44
  { id: 'side', isOpen: hasSelection, close: () => {
    if (mobileHud.expanded()) mobileHud.collapse();
    else clearSelection();
  } }, // z20
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

/** Что остаётся, когда нижняя панель телефона ведёт к карте: выделение, экран настройки и
 *  то, что окном не является, — снять комикс, подготовку карты или обучающий тур значило
 *  бы пропустить урок или уйти из партии. */
const MAP_KEEPS = new Set(['comic', 'maploading', 'spotlight', 'side', 'setup']);
/** Ступень «Назад» окна, которое открывает пункт нижней панели (UIX-3.3). Дипломатия и
 *  сообщения — одно окно с двумя вкладками, их различает вкладка (`phoneWindowOpen`). */
const PHONE_WINDOW_LAYER: Record<Exclude<PhoneItemId, 'diplomacy' | 'mail'>, string> = {
  production: 'constructor',
  science: 'tech',
  events: 'logwin',
  coalitions: 'coalwin',
  pings: 'pingpanel',
  market: 'market',
  trader: 'trader',
  corporation: 'corp',
  steward: 'steward',
  dossier: 'swarm-dossier',
  codex: 'codexhub',
  settings: 'settings',
};
/** Открыто ли окно пункта: по нему раздел панели подсвечен. */
function phoneWindowOpen(id: PhoneItemId): boolean {
  if (id === 'diplomacy') return diploOpen && diploTab !== 'msgs';
  if (id === 'mail') return diploOpen && diploTab === 'msgs';
  return BACK_LAYERS.find((layer) => layer.id === PHONE_WINDOW_LAYER[id])?.isOpen() === true;
}
// UIX-3.1: нижняя панель телефона. Состав и правила — `decisions/phoneNav.ts`; разделы
// нажимают кнопки рельсы, а перед этим убирают окна над картой, как «Назад».
const phoneNav = initPhoneNav({
  toMap: () => {
    for (const layer of BACK_LAYERS) if (!MAP_KEEPS.has(layer.id) && layer.isOpen()) layer.close();
  },
  windowOpen: phoneWindowOpen,
});
// UIX-3.2: скорость на телефоне — одна кнопка, ряд раскрывается над ней (`phoneSpeed.ts`).
const phoneSpeed = initPhoneSpeed();
// UIX-9.1: горячие клавиши ПК. Что делает клавиша и когда молчит — `decisions/hotkeys.ts`;
// кнопки, подсказки и памятка — `pcHotkeys.ts`. Окна клавиша открывает кнопками рельсы, а
// сюда приходит то, у чего кнопки нет: камера к столице и перебор флотов.
const SILENT_LAYERS = new Set(HOTKEY_SILENT_LAYERS);
const pcHotkeys = initPcHotkeys({
  pc: pcUi,
  inMatch,
  silentLayer: () => BACK_LAYERS.some((layer) => SILENT_LAYERS.has(layer.id) && layer.isOpen()),
  pauseToggles: runPauseShown,
  home: () => {
    const fallback = pickHome(Object.values(s.planets), ME)?.id ?? null;
    const to = homeTarget(capitalOf(s, ME), (id) => s.planets[id]?.owner, ME, fallback);
    if (to) jumpTo(to, 'goto');
  },
  nextFleet: () => {
    const immobile = (unit: string): boolean => data.units[unit]?.traits.includes('immobile') === true;
    const id = nextFleet(cycledFleets(Object.values(s.fleets), ME, immobile), selFleet);
    if (!id) return;
    setFleetSelection([id]);
    const at = fleetPos(s.fleets[id]!);
    if (at) centerOn(at, Math.max(cam.scale, GOTO_MIN_ZOOM));
  },
});

// Что ЗНАЧИТ нажатие «Назад» — `backGesture.ts` (REFM-198): пока есть что закрыть, Back
// разбирает стопку; в матче первое нажатие только предупреждает (аппаратный Back жмут
// вслепую, и матч не должен теряться от одного случайного касания), второе в пределах
// окна выходит по-настоящему, а вне матча ступень истории не ставится вовсе — там
// следующий Back и обязан закрыть приложение.
/**
 * Один шаг «назад» — общий для аппаратной кнопки браузера (`popstate`) и кнопки площадки
 * (`HISTORY_BACK`, `YAG-6.4`): закрыть верхний слой, а в матче сперва подсказать и только
 * вторым нажатием выйти. `rearm` — только для браузера: его «назад» съедает запись
 * истории, и её надо положить обратно; у площадки истории нет.
 */
function stepBack(rearm: boolean): void {
  const act = backAction(closeTopLayer(), inMatch(), performance.now(), backHintAt);
  if (act === 'closed') {
    snd.play('close'); // обратный блип: слой закрылся аппаратным Back
    if (rearm && rearmAfterClose(topLayerOpen(), inMatch())) armBack();
    return;
  }
  if (act === 'exit') {
    $('tomenu').click();
    return;
  }
  if (act === 'hint') backHintAt = performance.now();
  note(t(act === 'hint' ? 'back.confirm.match' : 'back.confirm'));
  if (rearm && rearmAfterHint(act)) armBack();
}
window.addEventListener('popstate', () => {
  backArmed = false;
  stepBack(true);
});
function armBack(): void {
  if (backArmed) return;
  history.pushState({ layer: true }, '');
  backArmed = true;
}

// Desktop parity: Escape closes the topmost layer, exactly like Back. Ignored while
// typing (chat / nick / server inputs) so Escape still blurs a field the native way.
window.addEventListener('keydown', (e) => {
  const el = e.target as HTMLElement | null;
  const typing = !!el && typingTarget(el.tagName, el.isContentEditable);
  const empty = !!el && 'value' in el && (el as HTMLInputElement).value === '';
  if (!escapeConsultsLadder(e.key, typing, empty)) return;
  if (closeTopLayer()) {
    snd.play('close');
    e.preventDefault();
  }
});

// Слот обычной схватки — такт записи, пауза на уходе, «Продолжить» и замена сохранения —
// `soloCheckpoint.ts` (REFM-213). Здесь только снимок политик хоста и проводка к миру, темпу
// и экранам.
function currentSoloSave(): SoloSave {
  return {
    state: simLink ? simLink.saved(s) : s, ai: [...AI_PLAYERS],
    normalSpeed: Number($('spd-play').dataset.speed) / PLAY_BASE,
    fastSpeed: Number($('spd-fast').dataset.speed) / PLAY_BASE,
    autoAssault: [...soloAutoAssault], memory: memory.dump(),
  };
}
initSoloCheckpoint({
  world: () => s,
  net: () => NET,
  practice: () => !__PLAYER_BUILD__ && sandboxConfig.enabled,
  inMatch,
  snapshot: currentSoloSave,
  halt: () => {
    speed = 0;
    // Мир стоит, пока игрок не нажмёт ▶, — ряд скорости показывает паузу, а не прежний темп.
    for (const x of Array.from(document.querySelectorAll('[data-speed]')))
      x.classList.toggle('on', Number((x as HTMLElement).dataset.speed) === 0);
  },
  install: (save) => {
    leaveNetwork(); // схватка из сохранения — не сетевая партия: из сети той же дверью
    cameFromLink = false;
    installMatch(save.state, new Map(save.ai), save.state.modeId);
    restoreAutoAssault(save.autoAssault);
    restoreFogMemory(save.memory);
    applyTimeSpeed(save.normalSpeed, save.fastSpeed);
    speed = 0;
    for (const x of Array.from(document.querySelectorAll('[data-speed]')))
      x.classList.toggle('on', Number((x as HTMLElement).dataset.speed) === 0);
    lastReal = performance.now(); // never catch up the wall time spent away
  },
  show: () => {
    sectorZeroMenu.hide();
    showConnect(false);
    showHub(false);
  },
  startNew: () => startMatch(buildSetupConfig()),
  newcomer: () => welcomeMode(loadOnboard()) === 'new',
  mapLabel,
  note,
});

// Забег Sector Zero — флаги, журнал, засчёт и «Продолжить» — `sectorRun.ts` (REFM-210).
// Здесь только проводка к миру, экранам и комиксам. Хуки зовутся позже — из кадра, кнопок
// и меню, — поэтому функции и меню, объявленные ниже, к тому времени уже есть.
initSectorRun({
  world: () => s,
  adopt: (state) => {
    s = state;
  },
  step: () => apply(advance(s, s.time + 1)),
  install: installMatch,
  halt: () => {
    speed = 0;
  },
  show: () => {
    applyTimeSpeed(RUN_SPEED_NORMAL, RUN_SPEED_FAST);
    showConnect(false);
    showHub(false);
    setupEl.style.display = 'none';
  },
  runChanged: () => {
    syncSectorZeroTools();
    markGameplay();
  },
  me: () => ME,
  net: () => NET,
  cameFromLink: () => cameFromLink,
  inMatch,
  note,
  trainingWon: () => {
    trainingResume.hide();
    playChapterComic('training-1', 'outro', () => {});
  },
  finalScenes: () => playTaskComic(runMissionRows(), runChain()),
  chapterWon: () => playChapterComic(pveChapter(sectorMission).id, 'outro', () => {}),
  playing: () => speed > 0 && !comicQueue.isBusy(),
  speed: () => speed,
  setSpeed: (next) => {
    // Возобновление не нагоняет время паузы — как у соло-сохранения.
    if (speed <= 0 && next > 0) lastReal = performance.now();
    speed = next;
  },
  playSpeed: () => Number($('spd-play').dataset.speed),
});

/** Уход из матча ведёт в меню Sector Zero — из забега и из полигона, а не в хаб. */
function leavesToSectorZero(): boolean {
  return isSectorZeroRun() || isTraining();
}

// Профиль Sector Zero, его облачная копия и вкладка-хозяйка — `sectorProfile.ts` (REFM-209).
// Здесь только проводка к забегу и экрану. Хуки зовутся позже, по событию или после
// ожидания хранилища, — меню, объявленное ниже, к тому времени уже есть.
initSectorProfile({
  note,
  runWritten: () => runWrite,
  stopRun: () => {
    if (runInProgress()) setRunActive(false);
  },
  forgetRun: forgetSavedRun,
  shown: () => sectorZeroMenu.isOpen() || (sectorRunActive && !NET),
  pause: () => runPauseEvent('hidden'),
  saveFailing: saveWarning,
});

// --- панель задач забега (заказ владельца 2026-09-24) ---------------------------------
// Разметка и клики — `missionPanel.ts`; здесь только проводка к камере и чипу.
const missionPanel = initMissionPanel({
  root: $('missionpanel'),
  rows: runMissionRows,
  training: isTraining,
  jump: id => jumpTo(id, 'goto'),
  onToggle: forgetStatusLine,
  chain: () => runChain(),
  extractors: () => extractionCandidates(s, ME).map((id) => ({ id, label: fleetLabelOf(id) })),
  extract: (fleetId) => {
    if (playerOrder(extractionStart(ME, fleetId))) note(t('chain.carrier-warning'));
  },
  captiveLoaders: () => captiveCandidates(s, ME).map((id) => ({ id, label: fleetLabelOf(id) })),
  loadCaptive: (fleetId) => {
    if (playerOrder(captiveLoad(ME, fleetId))) note(t('captive.carrier-warning'));
  },
});

// Площадка (`YAG-1.1a`/`YAG-1.1b`). КАКАЯ именно — решает хост ДО импорта этого модуля
// (`bootstrap.ts`): здесь площадка уже готова, и игра про её имя ничего не знает. В
// обычном браузере это веб-адаптер: rewarded-рекламы и платежей там нет, и `capabilities`
// честно говорят `false` — магазин по ним просто не рисует такие кнопки. В дев-сборке
// поднимается управляемая симуляция, чтобы путь «посмотрел рекламу → товар выдан»
// проходился целиком, а не только в юнит-тесте. Пускать симуляцию к игроку нельзя: это
// ровно «обещать механику, которой у него не будет».
const platform = getPlatform();

// Начало сессии (`YAG-5.1`): точка входа — страница Sector Zero или основная игра.
platform.analytics.emit('session_started', { entry: document.body.dataset.entry ?? 'main' });

// Разметка жизненного цикла для площадки (`YAG-1.2`). Хост отдаёт её, только если под
// нами правда площадка; в браузере методов нет, и вызывать нечего — поэтому `host?.`, а
// не сравнение с именем площадки. Сторож в `platform/yandex.test.ts` следит, чтобы имя
// сюда не проникло даже строкой: он поймал ровно эту фразу, когда она была примером.
const host = platform as Partial<PlatformHost>;

// Требование площадки 1.3: при потере фокуса звук обязан замолкнуть (дают две секунды).
// Пауза приходит ОТ ПЛОЩАДКИ (реклама, свёрнутая вкладка), поэтому глушим через
// `setPaused`, а не `setEnabled`: настройка игрока обязана пережить ролик, иначе он
// вернётся в тишину, которую не просил и которую надо чинить руками.
host.onPlatformPause?.((paused) => snd.setPaused(paused));

// Оболочка Sector Zero — `sectorZeroShell.ts` (REFM-211): меню, подготовка, кошелёк, сутки
// магазина, ролики, комиксы глав и вход. Здесь только проводка к миру, виджетам комиксов,
// партиям и экранам хаба; хуки зовутся по нажатиям и событиям, а не при загрузке.
initSectorZeroShell({
  menuRoot: $('sector-zero'),
  walletRoot: $('tbwallet'),
  runOnScreen: () => sectorZeroToolsHidden(),
  world: () => s,
  me: () => ME,
  comics: { player: comicPlayer, queue: comicQueue, art: comicArt },
  startRun: () => startPvEMatch(),
  startDev: __PLAYER_BUILD__ ? undefined : () => startPvEMatch(true),
  startTraining: () => startTraining(),
  leaveWorld: () => {
    saveSolo();
    leaveMatch();
    cameFromLink = false; // explicit local entry after a network visit may resume its own run
    hideMapLoading();
  },
  closeScreens: () => {
    setupEl.style.display = 'none';
    for (const layer of BACK_LAYERS) if (layer.id !== 'setup' && layer.isOpen()) layer.close();
    showConnect(false);
    showHub(false);
    endscreenEl.style.display = 'none';
  },
  back: () => {
    openHub();
    $('hub-sector-zero').focus({ preventScroll: true });
  },
  openSettings,
  note,
  inMatch,
});

// Часы забега (решение владельца 2026-09-24): пока забег на экране, отсчёты и сроки —
// реальные минуты и секунды на обычном темпе, приток — в минуту (`format.ts`). Форматтеры
// спрашивают сами, поэтому выход из забега не надо не забыть «выключить».
setRunClock(isSectorZeroRun);

/** Что сценарию полигона (TRN-3) нужно от игры. */
const trainingScenarioHost: TrainingScenarioHost = {
  world: () => s,
  setWorld: (state) => apply({ state, events: [] }),
  order: (state, action) => order(state, action, state.time).state,
  me: () => ME,
  tour: () => activeTour,
  note,
  // Табло — под верхней панелью по её настоящему низу: `--tbh` у раскладок ПК меньше, чем
  // панель вышла на деле, и табло наезжало на её край.
  board: () => {
    const board = document.getElementById('trnraid');
    const top = document.getElementById('top')?.getBoundingClientRect().bottom;
    if (board && top !== undefined && top > 0) board.style.top = `${Math.round(top) + 8}px`;
    return board;
  },
};

// Чёткость карты на слабом устройстве (`decisions/mapSharpness.ts`): кадры матча судят
// устройство, пока игрок не выбрал сам и вердикта нет. Слабое — карта переходит на пиксель на
// точку сразу, и это запоминается.
const sharpGaps: number[] = []; // the frame gaps judged so far
let sharpFrom = -1; // when the gaps start counting, after the warm-up; -1 — the map is not shown
let sharpJudged = false; // this session's frames found the device fine
function judgeMapSharpness(nowReal: number, dt: number): void {
  if (!judgingFrames(SCREEN_DPR, mapSharpChosen(), mapSlowSeen(), sharpJudged)) return;
  if (!inMatch() || mapPreparation.active) {
    sharpFrom = -1;
    sharpGaps.length = 0;
    return;
  }
  if (sharpFrom < 0) sharpFrom = nowReal + JUDGE_WARMUP_MS;
  if (nowReal < sharpFrom || !saneGap(dt)) return;
  sharpGaps.push(dt);
  const slow = slowFrames(sharpGaps);
  if (slow === null) return;
  sharpGaps.length = 0;
  if (!slow) {
    sharpJudged = true;
    return;
  }
  markMapSlow();
  resize();
  toast(t('settings.gfx.map-sharp.auto'));
}

function frame(nowReal: number) {
  flushPinch();
  const wasHolographic = holographic.active();
  const previousViewport = insets();
  holographic.sync(VW, VH, holoCoarsePointer?.matches ?? false, inMatch());
  mobileHud.sync(MOBILE && inMatch());
  phoneNav.sync(MOBILE && inMatch());
  if (!MOBILE) { stageDraft(null); offerChoices([]); }
  if (wasHolographic !== holographic.active()) {
    setView(reframePresentation(cam, previousViewport, insets(), mapBounds()));
    clampCam();
  }
  // Keep the Back sentinel armed while something is closable OR a match is live, so a
  // bare in-match Back triggers the double-back hint instead of a silent unload. The
  // popstate handler re-arms itself right after a hint (so a genuine second Back
  // always has its own sentinel to pop) — this is the initial arm / self-healing net,
  // not the steady-state path, hence gating on being past the exit window.
  if (selfHealArm(backArmed, topLayerOpen(), inMatch(), performance.now(), backHintAt)) armBack();
  const dt = nowReal - lastReal;
  lastReal = nowReal;
  // Правдоподобие разрыва, ход мира и сдвиг времени — `simClock.ts` (REFM-87).
  // smooth FPS; ignore absurd gaps (tab backgrounded) so the readout stays sane
  if (saneGap(dt)) {
    fpsEma = fpsNext(fpsEma, dt);
    countNetFrame(dt);
  }
  judgeMapSharpness(nowReal, dt);
  // Отдельный поток расчёта: сначала то, что он прислал, — мир, события и исходы своих
  // приказов, — потом следующий шаг, уже от пришедшего мира.
  if (simLink && !simEligible()) stopSim();
  if (!simLink && simEligible()) {
    const port = SIM_WORKER && workerPort(SIM_WORKER);
    if (port) simLink = startSimLink(port, s, ME, matchMode());
    else simBroken = true;
  }
  if (simLink) {
    const sync = simLink.take();
    if (sync) {
      apply({ state: sync.state, events: sync.events });
      for (const o of [...sync.driverOrders, ...sync.refused]) settleOrder(o.type, o.error);
      if (sync.stepped) simView = netViewSnapshot(simView, s.time, nowReal);
    }
    if (simLink.failed !== null) {
      // Мир на экране цел (последняя разность и неподтверждённые приказы) — кадр ведёт его дальше.
      console.warn('sim worker failed:', simLink.failed);
      stopSim();
      simBroken = true;
    }
  }
  // `netWorld`, а не `NET`: на обрыве мир на экране всё ещё серверный, под туманом, и
  // локальный ход по нему выбил бы «безземельных» соперников и объявил ложную победу.
  const simRunning = simRuns(netWorld, speed, !!banner || comicQueue.isBusy() || !!activeTour?.holdsClock, !!endScreen);
  if (simRunning && simLink) {
    simBacklog = stepBacklog(simBacklog, dt, speed, HOUR);
    if (!simLink.busy && simBacklog > 0) {
      simLink.step(s.time + simBacklog, !comicQueue.isBusy(), AI_PLAYERS, soloAutoAssault, nowReal);
      simBacklog = 0;
    }
  } else if (simRunning) {
    // Local single-player sim. In net mode the server owns the clock, combat,
    // construction and every rival — a connected human, or the server-side AI for
    // an empty seat — so we only render its snapshots (no local AI runs here).
    // A finished match (endScreen set) freezes the world — no advancing a decided game.
    // Время растёт от РЕАЛЬНОГО, помноженного на скорость: при просадке FPS мир идёт
    // с той же быстротой, а не медленнее (правило 3).
    const target = advanceTarget(s.time, dt, speed, HOUR);
    apply(advance(s, target));
    // Прибытие к Эхо — до исполнения следующего приказа цепочки (наземного штурма).
    // Очередь становится busy сразу, ещё до открытия картинки в микрозадаче.
    playTaskComic(runMissionRows(), runChain());
    // RETR-2 ПЕРВЫМ среди драйверов: смысл приказа — выйти из боя до следующего
    // раунда, а не после того, как флот отработает остальные намерения.
    if (!comicQueue.isBusy()) {
      solo.driveAutoRetreat();
      solo.autoEngage();
      solo.checkFleetClashes();
      solo.driveChains(); // CC-1: продвинуть цепочки приказов (ждать → курс → штурм/обстрел)
      solo.runAI();
    }
  }
  // ORD-2: отложенного ШТУРМА у клиента больше нет вовсе — он уехал в ядро цепочкой
  // «дойти → штурмовать», и её гоняют оба хоста (сервер и соло-драйвер). Поэтому
  // покадрового насоса здесь тоже нет: приказ исполняется, даже когда вкладка закрыта.
  // Новые часы (вход, другая партия) — кадр начинает с их оценки, а не догоняет её от прошлой.
  if (netView.t === null || netView.bornAt > (netShown?.at ?? -Infinity)) netShown = null;
  netShown = netViewFollow(netShown, netView, nowReal, s.time);
  netShownTime = netShown.time;
  // На паузе картинка стоит на мире: досчитывать вперёд нечего.
  if (!simRunning) {
    simBacklog = 0;
    simView = NET_VIEW_IDLE;
  }
  simShownTime = netViewAt(simView, nowReal, s.time);
  updateGoals(); // ONB-7: tick the first-session checklist off live state (no-op when idle)
  // The orbit spin only advances while the world is actually running (sim ticking, or a
  // live net match), so pausing freezes the ships on their rings instead of drifting on.
  if (saneGap(dt) && spinRuns(netWorld, speed, !!banner || comicQueue.isBusy())) spinOrbits(dt);
  if (saneGap(dt) && !document.hidden && motionOn() && !endScreen && spinRuns(netWorld, speed, !!banner || comicQueue.isBusy())) hologramTime += dt;
  // Итог матча приходит в ОБОИХ режимах (сетевые снимки несут его в `match`).
  const ended = matchEnd.check();
  if (ended) endScreen = ended;
  // SANDBOX — fenced hook. Hold the "immortal home" + "frozen queues" toggles every
  // solo frame (paused or not); the whole feature no-ops outside a sandboxed solo match.
  // Leading `!__PLAYER_BUILD__` lets esbuild tree-shake the sandbox out of the player bundle.
  // The sandbox edits the world in place (here and from its panel), so the same world
  // object no longer means the same world: a sandboxed match keeps no vision or world memo.
  if (!__PLAYER_BUILD__ && !NET && sandboxConfig.enabled) {
    enforceSandbox(s, ME, sandboxHomeId);
    forgetVision();
    worldMemo = null;
  }
  refreshVision(); // fog projection for this frame; recomputed only when the world changes
  const preparingMap = prepareEnteringMap();
  // Памятка клавиш ПК (UIX-9.1) ждёт конца подготовки карты: в кадре входа подготовка ещё
  // не началась, и памятка встала бы под заставку, отсчитывая свои секунды впустую.
  pcHotkeys.sync();
  // Opaque entry screens and hidden tabs do not paint the covered map. Setup is
  // translucent and keeps its backdrop; an admitted match waits for preparation.
  if (
    !document.hidden &&
    !connectShown() &&
    hubEl.style.display === 'none' &&
    !(NET && !netAdmitted) &&
    !preparingMap
  ) {
    renderMap(nowReal);
    renderPanel();
    renderCmdBar();
    renderSplitDialog();
    if (nowReal - lastHeroCardRefresh >= 1000) {
      shipyard.refreshHeroes();
      // Очередь мира в «Производстве»: в сетевой партии заказ встаёт, когда его примет
      // сервер, — полоса подхватывает это без нажатия.
      shipyard.refreshQueue();
      lastHeroCardRefresh = nowReal;
    }
    holographic.layoutWindows();
    updateMobileHud();
    // В сети заставка держится и до калибровки часов картинки (`netViewClock.ts`, правило 6):
    // иначе флоты при входе сперва стоят, а потом трогаются рывком.
    if (
      mapPreparation.active &&
      mapPreparation.ready &&
      !cx.isContextLost?.() &&
      (!netWorld || netViewSettled(netView, nowReal))
    ) {
      hideMapLoading(); // reveal only after the first complete frame, never a blank canvas
      maybeStartPendingTour();
    }
  }
  tickRunSave(nowReal);
  // TRN-3: сценарий полигона — силы по этапам, контратака и исход. Каждый кадр: силы входят
  // на входе в этап, даже когда тур держит часы; отсчёт идёт по часам мира и стоит вместе с ними.
  if (isTraining()) tickTrainingScenario(trainingScenarioHost);
  else hideTrainingBoard(document.getElementById('trnraid'));
  tickSoloSave(nowReal);
  tickGameplayMark();
  renderSwarmDossier(nowReal);
  pirateIntro.update(!NET && inMatch() ? pirateEncounter(s, ME) : null);
  tickAbandon();
  tickTrader();
  tickAlly();
  // Задачи забега этого кадра: их читают чип строки статуса, панель задач и комиксы главы.
  const missions = sectorRunActive ? runMissionRows() : [];
  const chain = runChain();
  if (isSectorZeroRun()) playTaskComic(missions, chain);
  // Строка статуса, шапка, плашки ресурсов и значки внимания — у владельца полосы (REFM-222).
  renderTopBar(missions);
  missionPanel.render(missions);

  // Служебное наложение (FPS, задержка, десинк) — `netOverlay.ts` (REFM-192): десинк
  // ПОКАЗЫВАЕТ строку сам, помимо галочки игрока, потому что иначе о нём некому сообщить;
  // задержка и признак синхронизации есть только в СЕТИ («0 ms · sync ✓» в соло — выдумка
  // про несуществующий канал); неизмеренная задержка пишется многоточием, а не нулём; и
  // условие ушло — строка ОЧИЩАЕТСЯ, иначе мёртвое показание висит поверх карты как живое.
  if (overlayShown(showFpsOn(), DEV_UI, NET, netDesync)) {
    const fpsText = overlayText(fpsEma, NET, rttEma, netDesync, netDesyncCount, BUILD_TAG);
    if (fpsText !== lastFpsText) {
      fpsEl.textContent = fpsText;
      fpsEl.style.color = overlayAlarm(NET, netDesync) ? 'var(--red, #ff5a4d)' : '';
      lastFpsText = fpsText;
    }
  } else if (needsClearing(lastFpsText)) {
    fpsEl.textContent = CLEARED;
    lastFpsText = CLEARED;
  }
  // UIX-4.2: над журналом — то, что ждёт решения (`pendingDecisions.ts`). Бои — те же,
  // что считает значок тревоги на кнопке «События» (`attentionBadges.ts`).
  const pendHtml = pendingHtml(
    pendingDecisions(
      Object.values(s.battles)
        .filter((b) => battleConcernsMe(b, ME, known) || !!vision?.engaged.battles.has(b.id))
        .map((b) => ({
          id: b.id,
          location: b.location,
          mine: b.sides.some((sd) => sd.owner === ME),
          ...(b.nextRoundAt !== undefined ? { nextRoundAt: b.nextRoundAt } : {}),
        })),
      unreadMsgs,
    ),
    placeName,
  );
  if (pendHtml !== lastPendHtml) {
    logPendEl.innerHTML = pendHtml;
    lastPendHtml = pendHtml;
  }
  const logHtml = logLines.map((l) => `<div>${esc(l)}</div>`).join('');
  if (logHtml !== lastLogHtml) {
    logEl.innerHTML = logHtml;
    lastLogHtml = logHtml;
  }
  // Пути НАРУЖУ из матча — `matchExits.ts` (REFM-193): кнопка перезапуска в баннере только
  // на настоящем конце СОЛО-матча (на сетевом «переподключаюсь» она увела бы из живой
  // партии), убранный баннер ЗАБЫВАЕТ разметку (иначе следующий такой же не нарисуется), а
  // на ТЕЛЕФОНЕ узел полосы скорости не гасится никогда: её ряд раскрывает кнопка скорости
  // (UIX-3.2), и погашенный узел не раскрылся бы.
  if (banner) {
    const html = bannerOffersRestart(NET, s.match?.status)
      ? `<div class="bn-text">${esc(banner)}</div><button class="bn-btn" data-restart>${t('hub.back-to-bots')}</button>`
      : `<div class="bn-text">${esc(banner)}</div>`;
    if (html !== lastBannerHtml) {
      bannerEl.innerHTML = html;
      lastBannerHtml = html;
    }
    bannerEl.style.display = 'block';
  } else if (bannerEl.style.display !== 'none') {
    bannerEl.style.display = 'none'; // banner cleared (e.g. a fresh match) → hide it
    lastBannerHtml = BANNER_FORGOTTEN;
  }
  renderEndScreen();
  renderSpeedbar();
  // Как часто живёт открытое окно — `liveWindows.ts` (REFM-194): дроссель считает РЕАЛЬНОЕ
  // время (по игровому он на разгоне ×7200 пробивался бы каждым кадром, а на паузе — никогда),
  // отметка у каждого окна СВОЯ (с общей два открытых окна обновлялись бы вдвое реже), и
  // сроки разные: полсекунды там, где идёт прогресс, пять секунд у разведки, чьи таймеры
  // тикают часами и за полсекунды не меняются вовсе.
  // Keep the tech window live while open (research progress bar / eta), throttled.
  if (repaintDue(techTree.isOpen(), nowReal, lastTechAt, PROGRESS_MS)) {
    lastTechAt = nowReal;
    techTree.repaint();
  }
  // Keep the build window live while open (a finished build flips its row), throttled.
  if (repaintDue(buildWin.isOpen(), nowReal, lastBuildAt, PROGRESS_MS)) {
    lastBuildAt = nowReal;
    buildWin.repaint();
  }
  // Keep the steward window live while open (countdown to control returning), throttled.
  if (steward && repaintDue(steward.isOpen(), nowReal, lastStewAt, PROGRESS_MS)) {
    lastStewAt = nowReal;
    steward.repaint();
  }
  // Окно боя живое: раунды идут по расписанию, и состав сторон меняется под рукой.
  // Тот же троттлинг, что у «Хранителя», — окно перерисовывается, только пока открыто.
  if (repaintDue(battleWindow.isOpen(), nowReal, lastBattleWinAt, PROGRESS_MS)) {
    lastBattleWinAt = nowReal;
    battleWindow.repaint();
  }
  if (repaintDue(intelVisible(diploOpen, diploTab), nowReal, lastIntelAt, INTEL_MS)) {
    lastIntelAt = nowReal;
    renderDiplo();
  }
}

/** Сколько исключений кадра печатать целиком: первое — с полным стеком, дальше только
 *  счётчик. Иначе сломанный кадр забивает консоль по 60 строк в секунду, и в ней уже
 *  не найти ничего другого. */
const FRAME_ERR_LOG_MAX = 3;
let frameErrs = 0;

/**
 * Цикл кадров. Планирование следующего кадра ВЫНЕСЕНО из `frame` намеренно: пока
 * `requestAnimationFrame(frame)` стоял последней строкой самого кадра, любое исключение
 * внутри означало, что следующий кадр не будет запланирован НИКОГДА — карта замирала
 * насмерть, а страница при этом оставалась живой (чат, кнопки, окна работают на своих
 * обработчиках), и выглядело это как «завис только мир». Ровно так и вышло на первом
 * плейтесте: выделение флота дергало `canOrder`, тот падал на состоянии без RNG.
 * Один плохой кадр — это пропущенная отрисовка, а не конец карты.
 */
function frameLoop(nowReal: number) {
  try {
    frame(nowReal);
  } catch (err) {
    if (frameErrs++ < FRAME_ERR_LOG_MAX) console.error('frame failed', err);
    else if (frameErrs === FRAME_ERR_LOG_MAX + 1) console.error('frame failing repeatedly — further errors muted');
  }
  requestAnimationFrame(frameLoop);
}

// Player card: tap the top-left crest to open your session dossier (faction, worlds,
// fleets, score, treasury); tap the backdrop or CLOSE to dismiss.
// the left crest (avatar + nick) opens the player dossier
document.querySelector('.crest')?.addEventListener('click', () => openPlayerCard());

// The ‹ chevron: close the top layer if any are open (mirrors hardware Back),
// or leave the match straight to the hub if none are (a visible button should act
// in one tap, not require the double-back hint that hardware Back uses).
$('topback').addEventListener('click', () => {
  const act = chevronAction(closeTopLayer(), inMatch());
  if (act === 'closed') {
    snd.play('close'); // ложится поверх тапа шеврона — осознанное наложение
    if (rearmAfterClose(topLayerOpen(), inMatch())) armBack();
    return;
  }
  // no layers + in match → straight to the hub; на хабе/входе — системный Back. В идущей
  // экспедиции шеврон спрашивает, как ⌂ (решение владельца 2026-09-26): на ПК ⌂ спрятан,
  // и шеврон — это и есть видимый выход.
  if (act === 'exit' && runInProgress()) openAbandon('exit', $('topback'));
  else if (act === 'exit') $('tomenu').click();
  else history.back();
});

// mirror the chosen emblem into the top-left corner + the hub avatar
applyEmblem();

// collapsible rail — the hamburger toggles the tool panel; picking a tool closes it.
function setRailOpen(open: boolean): void {
  railEl.classList.toggle('open', open);
  railGlyph.innerHTML = open ? skinIcon('x', '✕') : skinIcon('list', '☰');
  railToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}
railToggle.addEventListener('click', () => setRailOpen(!railEl.classList.contains('open')));
document.getElementById('railtools')?.addEventListener('click', () => setRailOpen(false));
document.getElementById('holo-tech')?.addEventListener('click', () => $('rail-tech').click());
document.getElementById('holo-constructor')?.addEventListener('click', () => $('rail-constructor').click());

// The hub avatar now opens the account portrait and medal editor.
const emblemPick = document.getElementById('emblempick');
document.getElementById('hubav')?.addEventListener('click', () => profile?.open());
// Both the portrait and identity strip open the same saved profile.
document.querySelector('#hub .hub-who')?.addEventListener('click', () => profile?.open());
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

// War prompt: a move routed through a player you're at peace with asks for
// confirmation — DECLARE WAR dispatches it (after declaring war), CANCEL/backdrop drops it.
const warPromptEl = document.getElementById('warprompt');
if (warPromptEl) {
  warPromptEl.addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    if (tg.classList.contains('wp-yes')) confirmWarPrompt();
    else if (tg.classList.contains('lp-after')) confirmLoadPrompt('after');
    else if (tg.classList.contains('lp-now')) confirmLoadPrompt('now');
    else if (tg.id === 'warprompt' || tg.classList.contains('wp-no')) cancelWarPrompt();
  });
}

// --- province ping composer (tap a province → choose where the ping goes) --------
/** Unknown nodes are valid public coordinates, but remain subject to the server's
 * existing E_PING_UNSEEN rule for identified-node targets. */
function sendProvincePing(loc: string, label: string, kind: PingMarkerKind = 'mark'): void {
  const target = provincePingTarget(loc, known(loc), MAP);
  if (target) netClient?.placePing({ kind, target, label });
}
// Метка отмечает провинцию и делится ею: адресат — либо канал коалиции (общий маркер на
// карте, который видят все союзники), либо личка одного игрока (приватный указатель «вот
// сюда» в его ветке). Сама витрина — три окна (композер, список меток, попап маркера) —
// живёт в `pingUi.ts` (REFM-25) поверх чистой модели прав `pingPanel.ts`; здесь только
// её хуки. Камера, лента сессии и сетевой клиент остаются у хоста.
const pings = __SECTOR_ZERO_ONLY__
  ? null
  : initPingUi({
      menuRoot: () => document.getElementById('pingmenu'),
      now: () => s.time,
      panelRoot: () => document.getElementById('pingpanel'),
      popRoot: () => document.getElementById('pingpop'),
      me: () => ME,
      selected: () => selPlanet,
      hasProvince: (loc) => !!s.planets[loc],
      messages: () => sessionMessages,
      setMessages: replaceMessages,
      push: (to, text, loc, kind) => pushMsg(to, text, false, ME, loc, kind),
      net: () =>
        NET && netClient
          ? {
              placePing: (ping) => sendProvincePing(ping.target.node, ping.label, ping.kind),
              clearPing: (id) => netClient?.clearPing(id),
            }
          : null,
      coalition: () => conversations.coalition(),
      name: (id) => NAME[id] ?? id,
      color: ownerColor,
      badge: seatBadge,
      provinceName: placeName,
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
      onFeedChanged: repaintFeeds,
    });

// Композер цепочек «Приказ» — режим, меню точки, план и его маршруты — живёт в
// `chainComposer.ts` (REFM-229). Здесь только хуки: мир, своё место, лента, узлы карты,
// тип сектора, источник тапа, проекция на экран и перерисовка ряда и панели.
initChainComposer({
  world: () => s,
  me: () => ME,
  note,
  nodes: () => MAP,
  capturable: (id) => sectorTypeOf(id)?.capturable ?? false,
  touchTap: () => tapByTouch,
  screenPoint: (p) => toScreen(p, canvas.getBoundingClientRect(), VW, VH),
  invalidateCmdBar,
  invalidatePanel,
});

requestAnimationFrame(frameLoop);

// --- сохранение забега (PVR-0.3) --------------------------------------------
// Страницу закрывают чаще, чем проходит такт записи, поэтому снимок берётся ещё и на
// уходе. `pagehide` вместо `beforeunload`: второй ненадёжен на мобильных, где вкладку
// не «закрывают», а вытесняют из памяти.
addEventListener('pagehide', saveRun);
addEventListener('pagehide', suspendSolo);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') suspendSolo();
});
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveRun();
});

// --- пауза забега (YAG-6.2) ---------------------------------------------------
// Резолюция владельца 2026-09-24: мир забега ЗАМИРАЕТ, пока игрока нет, и у игрока есть
// кнопка паузы на любом устройстве. Правила — `decisions/runPause.ts`, память паузы и её
// применение — у забега (`sectorRun.ts`, REFM-243); здесь только поводы: уход со страницы и
// пауза площадки.
addEventListener('pagehide', () => runPauseEvent('hidden'));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') runPauseEvent('hidden');
});
host.onPlatformPause?.((paused) => runPauseEvent(paused ? 'platform-pause' : 'platform-resume'));
// YAG-6.4: «назад» площадки (на телефоне — системная кнопка) идёт по той же лестнице слоёв,
// что и браузерный; без обработчика она выкинула бы игрока из игры посреди забега. Выход
// площадки сохраняет всё сразу — тем же путём, что уход со страницы.
host.onHistoryBack?.(() => stepBack(false));
host.onExit?.(() => {
  runPauseEvent('hidden');
  saveRun();
  pushCloud(true);
});
// YAG-2.2: уходя, страница отправляет облачную копию СРАЗУ — таймер окна квоты после
// выгрузки не сработает. Порядок важен: сначала снимок забега (он же двигает правку).
addEventListener('pagehide', () => pushCloud(true));
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') pushCloud(true);
});
// Only the explicit standalone page opens Sector Zero at boot. The shared entry
// must keep its login screen even when a run exists (or its stored data is invalid).
// The hub button loads that save on demand, without losing or resuming it here.
if (!bootJoinId && !bootReset && document.body.dataset.entry === 'sector-zero')
  openSectorZero();

// --- in-app APK auto-update -------------------------------------------------
// Вся проводка (и оба решения под ней — что сказать про исход и когда проверять) —
// в `apkUpdate.ts`. Вне APK вызов тихо ничего не делает.
if (currentBuild()) document.getElementById('hub-android')?.remove();
if (!__SECTOR_ZERO_ONLY__) initApkUpdater();

// --- corporation cabinet (AVA-C1/C2) -----------------------------------------
// Сам кабинет живёт в `corpScreen.ts` (REFM-11); здесь только его хуки: окно в партии
// открывает рельса матча, а в хабе корпорация — своя вкладка (CORP-3, `hubTab('corp')`).
// `authorizedBase` — та же политика, что у «Арсенала» и профиля; кэша сознательно нет.
const corp = __SECTOR_ZERO_ONLY__
  ? null
  : initCorp({
      root: () => $('corp'),
      head: () => $('corphd'),
      tabs: () => $('corptabs'),
      body: () => $('corpbody'),
      note,
      errText,
      onIntro: maybeIntro,
      authorizedBase: hubAuthorizedBase,
      hub: {
        root: () => $('hp-corp'),
        sheet: () => $('corp-sheet'),
        note: (text) => {
          hubNote.textContent = text;
        },
        canSignIn: () => !!resolveServer() && authMode === 'accounts',
        signIn: () => {
          showHub(false);
          showConnect(true);
          showStage('welcome');
          fillWelcome((localStorage.getItem('void.nick') ?? '').trim(), 'show');
        },
      },
    });
$('railcorp').addEventListener('click', () => corp?.open());
