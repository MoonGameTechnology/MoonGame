/**
 * Хозяин обучения (REFM-221): лаунчер туров по HUD (один тур за раз, шов `window.__vdTour`),
 * флаг «обучение пройдено» по позывному, ведомый первый матч (ONB-2) и список целей первой
 * сессии (ONB-7) с наградой ровно один раз.
 *
 * Модуль — хозяин живого тура {@link activeTour} и очереди гида: тур полигона собирает
 * `main.ts` и ставит в очередь дверью {@link setPendingGuide}, а запускает тот же лаунчер.
 * Мир, своё место, позывной, раскладку, мета-прогресс, переходы хаба и старт партии модуль
 * получает хуками {@link initGuideFlow}: импорт из `main.ts` был бы циклом.
 */
import { isForkSite, type GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import {
  GUIDE_HULL,
  GUIDE_TARGET,
  GUIDE_TECH,
  guideCourseSet,
  guideFleet,
  guideMineLevel,
  guideShipCount,
} from '../../decisions/firstMatchGuide';
import { note } from './eventFeed';
import { FIRST_GOALS, type GoalSignals, goalsComplete, mergeDone, metGoals } from './firstGoals';
import { buildFirstMatchTour } from './firstMatchTour';
import {
  GOALS_BONUS_XP,
  goalsChanged,
  goalsListHtml,
  goalsTrayHtml,
  rewardDue,
} from './goalsPanel';
import { goalBaseline, grew, mineLevels } from './goalTally';
import { pcUi } from './graphicsPrefs';
import { aiming, mobileDraft, pickWorld, selFleet, selPlanet } from './interaction';
import { focusWorld, world } from './mapCamera';
import { applyTimeSpeed } from './matchTopBar';
import { matchXp, type MetaState } from './meta';
import type { SetupConfig } from './matchSetup';
import { NET } from './netSession';
import {
  applyTourOutcome,
  markSkipped,
  markStarted,
  type OnboardState,
  parseOnboardState,
} from './onboarding';
import { HUD_ORIENTATION_TOUR } from './onboardingTour';
import { buildSetupConfig, prepareGuidedSetup } from './setupScreen';
import { invalidatePanel, planetTab, renderPanel, setPlanetTab } from './sidePanel';
import { refreshHubDoor } from './soloCheckpoint';
import type { TourResult } from './spotlight';
import { type RunningTour, startTour } from './spotlightDom';
import { activeConstruction, coreQueue } from './worldQueries';

declare const __PLAYER_BUILD__: boolean;

/** Что обучению нужно от игры. Мир, позывной, раскладка, мета и переходы — в `main.ts`. */
export interface GuideFlowHost {
  /** Мир на экране. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Позывной из поля хаба, без пробелов по краям; пустой — гость. */
  callsign(): string;
  /** Телефонная раскладка. */
  mobile(): boolean;
  /** Телефонный лист развёрнут. */
  panelExpanded(): boolean;
  /** Мета-прогресс командующего. */
  loadMeta(): MetaState;
  /** Сохранить мета-прогресс. */
  saveMeta(st: MetaState): void;
  /** Показать или скрыть хаб. */
  showHub(show: boolean): void;
  /** Показать или скрыть экран входа. */
  showConnect(show: boolean): void;
  /** Начать партию по настройке; `persist` — помнить её как последнюю. */
  startMatch(setup: SetupConfig, persist: boolean): void;
  /** Дев-диагностика включена (`?dev`). */
  devUi(): boolean;
}

let game: GuideFlowHost;
const live = (): GameState => game.world();
const me = (): string => game.me();
const windowEl = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

interface TourWindow {
  __vdTour?: {
    start: (steps?: typeof HUD_ORIENTATION_TOUR) => void;
    stop: () => void;
    readonly active: boolean;
  };
}

// --- ONB-1 guide-mark launcher ------------------------------------------------
// One tour at a time; `playerOrder` (`orderPipeline.ts`) notifies it of accepted actions so a
// step's `advance: { on: 'action' }` fires on the real order. Exposed on `window`
// as the reusable seam ONB-0/ONB-2 (auto-offer, «Ещё → Обучение») and headless
// e2e drive — starting a HUD tour needs an active match, which those own.
export let activeTour: RunningTour | null = null;
// Player build: the 'clock' step points at the pause/acceleration controls, which are
// stripped there (the server owns the clock in a net match) — drop it so the tour
// never narrates a control that doesn't exist. Dev client keeps the full chain.
const ORIENTATION_TOUR = __PLAYER_BUILD__
  ? HUD_ORIENTATION_TOUR.filter((step) => step.id !== 'clock')
  : HUD_ORIENTATION_TOUR;
export function launchTour(steps = ORIENTATION_TOUR, onEnd?: (r: TourResult) => void): void {
  activeTour = startTour(steps, (r) => {
    activeTour = null;
    onEnd?.(r);
  });
}

// --- ONB-0/ONB-2 first-run onboarding: flag + funnel + guided first match -----
// The "passed onboarding" signal lives per-nick in localStorage (separate from the
// saved callsign — a returning device can still be new to the guide). A brand-new
// commander gets a one-time hub offer; accepting (or «Ещё → Обучение») launches the
// ONB-2 guided first match: a bot-free solo sandbox with the data-described guide
// (firstMatchTour) walking produce→build→move→capture→score over the live HUD.
function onboardKey(): string {
  return 'vd.onboard.' + (game.callsign() || 'guest');
}
export function loadOnboard(): OnboardState {
  return parseOnboardState(localStorage.getItem(onboardKey()));
}
function saveOnboard(st: OnboardState): void {
  localStorage.setItem(onboardKey(), JSON.stringify(st));
}
// A guide queued to launch once the next match's HUD is live (from installMatch).
let pendingGuide: (() => void) | null = null;
/** Поставить гид в очередь: он стартует, когда HUD следующей партии оживёт. Дверь
 *  полигона (TRN-2): его тур собирает `main.ts`, а запускает тот же лаунчер. */
export function setPendingGuide(run: () => void): void {
  pendingGuide = run;
}
export function maybeStartPendingTour(): void {
  if (!pendingGuide || NET) return;
  const run = pendingGuide;
  pendingGuide = null;
  requestAnimationFrame(run); // let the fresh HUD paint a frame so selectors resolve
}
const myScore = (): number => Math.round(live().match?.scores?.[me()]?.total ?? 0);
// Крепость на развилке (FORT-6.1) — не мир: её постройка не «захват нового мира».
const myWorldCount = (): number =>
  Object.values(live().planets).filter((p) => p.owner === me() && !isForkSite(p)).length;
// ONB-2: start a bot-free solo sandbox and arm the guided first match over its HUD.
export function startGuidedMatch(): void {
  prepareGuidedSetup(); // a bot-free solo sandbox on a deterministic homeworld
  pendingGuide = () => {
    const home = Object.values(live().planets).find(
      (p) => p.owner === me() && p.kind === 'planet',
    )!.id;
    const mineLevel = guideMineLevel(live(), home);
    const ships = guideShipCount(live(), me());
    const mineImproved = () => guideMineLevel(live(), home) > mineLevel;
    const hasShip = () => guideShipCount(live(), me()) > ships;
    const researchDone = () =>
      live().players[me()]?.technologies?.completed.includes(GUIDE_TECH) === true;
    const box = (p: { x: number; y: number } | null) =>
      p && p.x >= 22 && p.x <= innerWidth - 22 && p.y >= 80 && p.y <= innerHeight - 44
        ? { left: p.x - 22, top: p.y - 22, width: 44, height: 44 }
        : null;
    const planetBox = (id: string) =>
      box(live().planets[id] ? world(live().planets[id]!.position) : null);
    const dossier = (selector: string) => !!document.querySelector(`#codex.show ${selector}`);
    startFirstGoals(); // ONB-7: the first-session checklist rides alongside the guide
    launchTour(
      buildFirstMatchTour({
        mouse: pcUi,
        homeOpened: () => selPlanet === home,
        cardLayout: () => game.mobile(),
        panelOpen: () => game.panelExpanded(),
        buildingsTabOpen: () => selPlanet === home && planetTab === 'buildings',
        mineCardOpen: () => dossier('[data-cx-upg="mine"]'),
        mineOrdered: () =>
          mineImproved() ||
          activeConstruction(home, 'buildings')?.payload.building === 'mine' ||
          coreQueue(home, 'buildings').some((q) => q.building === 'mine'),
        mineImproved,
        dossierClosed: () => !document.getElementById('codex')?.classList.contains('show'),
        techOpen: () => windowEl('tech').classList.contains('show'),
        techAccessible: () =>
          Array.from(
            document.querySelectorAll('[data-phone-tab="science"], [data-phone-more="science"]'),
          ).some((el) => el.getBoundingClientRect().width > 0),
        spaceTabOpen: () => !!windowEl('tech').querySelector('[data-ttab="space"].on'),
        researchStarted: () =>
          researchDone() ||
          live().players[me()]?.technologies?.active?.some((r) => r.technology === GUIDE_TECH) ===
            true,
        researchDone,
        shipsTabOpen: () => selPlanet === home && planetTab === 'ships',
        catalogOpen: () => windowEl('buildwin').classList.contains('show'),
        shipCardOpen: () => dossier('[data-build="unit:frigate"]'),
        shipOrdered: () =>
          hasShip() ||
          activeConstruction(home, 'units')?.payload.unit === GUIDE_HULL ||
          coreQueue(home, 'units').some((q) => q.unit === GUIDE_HULL),
        hasShip,
        fleetSelected: () => selFleet !== null && selFleet === guideFleet(live(), me())?.id,
        moveArmed: () => aiming,
        courseSet: () => guideCourseSet(live(), me()),
        coursePicked: () =>
          mobileDraft?.order === 'move' &&
          mobileDraft.target.kind === 'planet' &&
          mobileDraft.target.id === GUIDE_TARGET &&
          mobileDraft.fleetIds.includes(guideFleet(live(), me())?.id ?? ''),
        capturedWorld: () => live().planets[GUIDE_TARGET]?.owner === me(),
        homeAnchor: () => planetBox(home),
        fleetSelector: () => {
          const f = guideFleet(live(), me());
          return f ? `[data-act="selfleet"][data-arg="${CSS.escape(f.id)}"]` : null;
        },
        targetAnchor: () => planetBox(GUIDE_TARGET),
        showHome: () => focusWorld(home),
        showFleet: () => {
          focusWorld(home);
          pickWorld(home);
          setPlanetTab('ships');
          invalidatePanel();
          renderPanel();
          if (game.mobile() && !game.panelExpanded())
            document
              .querySelector<HTMLButtonElement>('#mobile-sheet [data-mobile="details"]')
              ?.click();
        },
        showTarget: () => focusWorld(GUIDE_TARGET),
      }),
      onGuidedTourEnded,
    );
  };
  game.showHub(false);
  game.showConnect(false);
  game.startMatch(buildSetupConfig(), false); // installMatch → maybeStartPendingTour runs the guide
  // The bot-free lesson accelerates the real construction, research and travel clocks.
  applyTimeSpeed(300);
  note(t('onb.tour.speed'));
}
// Fold the finished guide into the flag (+funnel); first completion earns XP + a nudge.
function onGuidedTourEnded(r: TourResult): void {
  const { state, rewarded } = applyTourOutcome(loadOnboard(), r);
  saveOnboard(state);
  if (rewarded) {
    const cur = game.loadMeta();
    const xp = matchXp({ won: false, score: 100 }); // a modest onboarding packet
    game.saveMeta({ ...cur, xp: cur.xp + xp });
    note(t('onb.tour.done', { n: xp }));
  }
  stopFirstGoals(); // ONB-7: the checklist belongs to the onboarding session only
  if (game.devUi())
    console.debug(
      `[onboard] ${r.completed ? 'completed' : r.skipped ? 'skipped' : 'stopped'} @ step ${r.reachedStep + 1}`,
    );
}

// --- ONB-7 first-session goals checklist -------------------------------------
// A light "am I playing right?" list, shown only in the onboarding match: four
// goals tick from live state (mine improved, frigate built, sector taken, first point),
// and finishing all four praises the player + nudges them to a real match.
let goalsActive = false;
let goalsCollapsed = false;
let goalsRewarded = false;
let goalsDone: string[] = [];
let goalBase = { worlds: 0, mineLevel: 0, fleets: 0 };
let goalScoreBase = 0;
let goalShipBase = 0;
// Чем меряется прогресс — `goalTally.ts` (REFM-99): от базы на момент запуска списка,
// а шахты суммой УРОВНЕЙ, потому что домашняя шахта уже стоит.
const myMineLevel = (): number => mineLevels(Object.values(live().planets), me());
function goalSignals(): GoalSignals {
  return {
    builtMine: grew(myMineLevel(), goalBase.mineLevel),
    launchedFleet: grew(guideShipCount(live(), me()), goalShipBase),
    capturedWorld: grew(myWorldCount(), goalBase.worlds),
    score: Math.max(0, myScore() - goalScoreBase),
  };
}
function startFirstGoals(): void {
  goalBase = goalBaseline(Object.values(live().planets), Object.values(live().fleets), me());
  goalScoreBase = myScore();
  goalShipBase = guideShipCount(live(), me());
  goalsDone = [];
  goalsRewarded = loadOnboard().goalsRewarded === true;
  goalsCollapsed = false;
  goalsActive = true;
  renderGoals();
}
export function stopFirstGoals(): void {
  goalsActive = false;
  document.getElementById('goals')?.classList.remove('show');
}
// Called each frame while active: tick newly-met goals; all-done → praise + XP once.
export function updateGoals(): void {
  if (!goalsActive) return;
  const next = mergeDone(goalsDone, metGoals(goalSignals()));
  // Перерисовка только при СДВИГЕ списка — `goalsPanel.ts` (REFM-183): панель
  // собирается через innerHTML, и перезапись каждый кадр рвала бы тап по кнопке.
  if (!goalsChanged(goalsDone.length, next.length)) return;
  goalsDone = next;
  renderGoals();
  // Награда ровно ОДИН раз: «список выполнен» остаётся истиной навсегда, защёлка — нет.
  if (rewardDue(goalsComplete(goalsDone), goalsRewarded)) {
    goalsRewarded = true;
    saveOnboard({ ...loadOnboard(), goalsRewarded: true });
    const cur = game.loadMeta();
    game.saveMeta({ ...cur, xp: cur.xp + GOALS_BONUS_XP });
    note(
      t('onb.goals.all-done', {
        n: GOALS_BONUS_XP,
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
  // Свёрнутая подача — ЛОТОК, а не спрятанные строки: смысл сворачивания вернуть карте
  // место, а шапка во всю ширину этого не даёт (`goalsPanel.ts`, правило 3).
  if (goalsCollapsed) {
    el.innerHTML = goalsTrayHtml(t('onb.goal.tray.title'), goalsDone.length, FIRST_GOALS.length);
    el.classList.add('show');
    return;
  }
  el.innerHTML = goalsListHtml(
    t('onb.goals.title'),
    t('onb.goal.collapse.title'),
    FIRST_GOALS.map((g) => ({ label: t(g.labelKey), done: goalsDone.includes(g.id) })),
    goalsDone.length,
  );
  el.classList.add('show');
}
// «Начать обучение» / «Ещё → Обучение»: launch the guided first match.
function beginOnboarding(): void {
  saveOnboard(markStarted(loadOnboard()));
  const nudge = document.getElementById('onboard-nudge');
  if (nudge) nudge.style.display = 'none';
  startGuidedMatch();
}

/** Поднять обучение: хуки игры, шов `window.__vdTour` для e2e и слушатели — список целей,
 *  «Начать обучение», «Пропустить» и «Ещё → Обучение». Зовётся из `main.ts` один раз, на
 *  месте прежних слушателей. */
export function initGuideFlow(host: GuideFlowHost): void {
  game = host;
  (window as unknown as TourWindow).__vdTour = {
    start: (steps) => launchTour(steps),
    stop: () => activeTour?.stop(),
    get active() {
      return activeTour?.active ?? false;
    },
  };
  document.getElementById('goals')?.addEventListener('click', (ev) => {
    const tgt = ev.target as HTMLElement;
    if (tgt.closest('#gl-tg') || tgt.closest('#gl-tray')) {
      goalsCollapsed = !goalsCollapsed;
      renderGoals();
    }
  });
  document.getElementById('ob-start')?.addEventListener('click', beginOnboarding);
  document.getElementById('ob-skip')?.addEventListener('click', () => {
    saveOnboard(markSkipped(loadOnboard())); // respected forever — never nagged again
    refreshHubDoor();
  });
  document.getElementById('hub-tutorial')?.addEventListener('click', beginOnboarding);
}
