/**
 * Жизненный цикл матча (REFM-219): установка партии, запуск схватки, забега, полигонов и
 * сетевой партии, уход из матча одной дверью и выходы ⌂, «Покинуть сессию» и итогового экрана.
 *
 * Установка любой партии сбрасывала два десятка состояний присваиваниями в `main.ts`. Теперь
 * чужие состояния гаснут дверями своих владельцев (выбор, лента, туман, забег, соло, тур), а
 * то, что принадлежит самому `main.ts` — мир, своё место, места ИИ, кеш мира, итог и баннер,
 * темп, пиратское знакомство, соло-драйверы, — модуль получает хуками
 * {@link initMatchLifecycle}: импорт из `main.ts` был бы циклом.
 */
import { linkedAlly } from '../../decisions/allyPanel';
import { httpBase } from '../../decisions/matchQuery';
import { runAiSeats } from '../../decisions/runAiSeats';
import { RUN_SPEED_FAST, RUN_SPEED_NORMAL } from '../../decisions/runTempo';
import { prepareSectorZeroRun } from '../../decisions/sectorZeroProgress';
import { tokenFor } from '../../decisions/sessionStore';
import { startFleetMerges } from '../../decisions/startFleets';
import { trainingFlagshipMerge } from '../../decisions/trainingGuide';
import { t } from '../../localization/runtime';
import {
  PROVING_GROUND_PLAYER,
  provingGroundState,
  pveChapter,
  pveModeId,
  trainingModeId,
  trainingState,
} from '../../packages/client/src/gameData';
import { type GameState, shareRoadNetwork } from '../../packages/shared-core/src/index';
import { chainMode, exitChainMode, forgetChainRoutes } from './chainComposer';
import { detach } from './detach';
import type { EndAction } from './endScreen';
import { note, resetEventFeed } from './eventFeed';
import {
  advance,
  type AiProfile,
  data,
  mergeFleet,
  newGame,
  order,
  setMatchMode,
  type SetupConfig,
} from './game';
import { forgetAutoAssault } from './groupOrders';
import { activeTour, forgetLesson, stopFirstGoals } from './guideFlow';
import { forgetAway } from './helpCenter';
import { disarm } from './interaction';
import { defaultView } from './mapCamera';
import { type MapId, mapPreset } from './mapCatalog';
import { clearFlak } from './mapEffects';
import { refreshVision, resetFogMemory } from './mapFog';
import { forgetAdditive } from './mapInput';
import { needMapPreparation } from './mapLoading';
import { SEAT_META } from './mapPalette';
import { forgetRadarContacts } from './mapRadar';
import { openSeatPicker } from './matchJoin';
import { applyTimeSpeed, hideSwarmDossier, resetThreatAlerts } from './matchTopBar';
import { leaveNetwork } from './netSession';
import { apply } from './orderPipeline';
import { getPlatform } from './platform/host';
import {
  resetSandboxConfig,
  resetSandboxRuntime,
  sandboxConfig,
  setSandboxButton,
} from './sandbox';
import { clearSeatNicks } from './seatNicks';
import { chapterWorld, sectorProgress } from './sectorProfile';
import {
  beginAttempt,
  enterRun,
  isSectorZeroRun,
  isTraining,
  leaveRun,
  pveDifficulty,
  runInProgress,
  saveRun,
  sectorAttempt,
  sectorMission,
} from './sectorRun';
import { openAbandon, openSectorZero } from './sectorZeroShell';
import {
  netSetup,
  openSetup,
  sciWin,
  setupEl,
  setupMapId,
  setupSlots,
  setupSpeed,
} from './setupScreen';
import { seatAiProfile } from './setupSeats';
import { enterSolo, leaveSolo } from './soloCheckpoint';
import { resetTrainingScenario } from './trainingScenario';

declare const __PLAYER_BUILD__: boolean;

/** Что жизненному циклу нужно от игры. Мир, места, темп и экраны хаба — в `main.ts`. */
export interface MatchLifecycleHost {
  /** Мир на экране. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Поставить мир новой партии: своё место `p1`, места ИИ (и NPC с ИИ), геометрия карты и
   *  имена мест. */
  adopt(state: GameState, ai: Map<string, AiProfile>): void;
  /** Забыть экран прошлой партии, которым владеет `main.ts`: пиратское знакомство,
   *  соло-драйверы, кеш производных мира, вспышки, итог, баннер и награду конца. */
  resetScreen(): void;
  /** Остановить поток локальной симуляции. */
  stopSim(): void;
  /** Мир встаёт: темп 0. */
  halt(): void;
  /** Телефонная раскладка. */
  mobile(): boolean;
  /** Порог очков обычной партии — для строки цели. */
  scoreLimit(): number;
  /** Показать дев-управление темпом (пауза и множители) — дев-забег. */
  devSpeedControl(on: boolean): void;
  /** Звук интерфейса. */
  sound(name: 'start'): void;
  /** Домашний мир для неуязвимого дома песочницы; `null` — нет. */
  setSandboxHome(id: string | null): void;
  /** Мигнуть чипом союзника: связь с первой минуты главы. */
  pulseAlly(): void;
  /** Поставить в очередь тур полигона — его собирает `main.ts` над своим HUD. */
  armTrainingTour(): void;
  /** Спрятать кнопку «Вернуть обучение» полигона (`trainingResume.ts`). */
  hideTrainingResume(): void;
  /** Показать или скрыть экран входа. */
  showConnect(show: boolean): void;
  /** Показать или скрыть хаб. */
  showHub(show: boolean): void;
  /** Открыть хаб. */
  openHub(): void;
  /** Вкладка хаба. */
  hubTab(tab: string): void;
  /** Сервер и позывной из полей хаба; `null` — не заданы (строка статуса уже сказала). */
  resolveServer(): { base: string; nick: string } | null;
}

let game: MatchLifecycleHost;
const live = (): GameState => game.world();
const me = (): string => game.me();
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

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
export function leaveMatch(): void {
  saveRun();
  game.stopSim();
  game.halt();
  leaveNetwork();
  clearSeatNicks();
  stopFirstGoals();
  activeTour?.stop();
  game.hideTrainingResume(); // остановка тура выше — не «Пропустить» игрока
}

/** Уход из матча ведёт в меню Sector Zero — из забега и из полигона, а не в хаб. */
export function leavesToSectorZero(): boolean {
  return isSectorZeroRun() || isTraining();
}

/** Выбор игрока на итоговом экране — «Ещё раз», «Повторить главу» или «В меню». Куда вести:
 *  полигон — в новый полигон или меню Sector Zero, забег — в меню Sector Zero (с подготовкой
 *  или сразу в главу), соло — в настройку схватки, сеть — в браузер матчей, иначе — в хаб. */
export function leaveFromEnd(which: EndAction, wasNet: boolean): void {
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
      game.openHub();
      game.hubTab('games');
    } else {
      openSetup('hub');
    }
  } else {
    game.openHub(); // «В меню»
  }
}

// Install a ready GameState as the live match: reset all interaction state, queues,
// camera and log, then hide the setup overlay. `aiPlayers` are the seats the local
// sim drives. Shared by the normal skirmish and (via a hook) the dev test mode.
export function installMatch(
  state: GameState,
  aiPlayers: Map<string, AiProfile>,
  modeId?: string,
): void {
  leaveNetwork(); // свой мир — уже не сетевая партия: гаснут и дозвон, и признак серверного мира
  leaveSolo();
  forgetLesson(); // startGuidedMatch raises it again after its own install
  game.stopSim(); // поток считал мир прошлого матча
  forgetAutoAssault();
  leaveRun();
  needMapPreparation();
  // PVR-1.1: режим вооружается ЗДЕСЬ, до первого хода часов — как у сервера, где он
  // фиксируется при рождении комнаты. Опущен = обычная партия без режима, и это же
  // снимает режим предыдущего матча: без сброса PvE-волны утекли бы в следующую соло-игру.
  setMatchMode(modeId);
  // ROADS-7: состояние из сохранения прошло через JSON и потеряло метку разделяемой сети
  // дорог — без неё каждый шаг мира копировал бы всю сеть заново.
  shareRoadNetwork(state.planets);
  game.adopt(state, aiPlayers); // мир, своё место p1, места ИИ, геометрия карты и имена мест
  game.resetScreen(); // экран прошлой партии в `main.ts`: пираты, соло-драйверы, итог, кеш мира
  hideSwarmDossier();
  // ONB-2 (found live): a leftover guide from whatever was on screen before (a
  // tutorial the player exited without finishing/skipping, a stale reconnect) must
  // never survive into this match — #spotlight is a document.body singleton, so an
  // un-stopped tour keeps painting its last step over the NEW match too. Runs before
  // `maybeStartPendingTour()` (below) arms this match's own guide, if any.
  activeTour?.stop();
  // Reset interaction + queues + camera to the framed whole-map view.
  disarm('match', game.mobile()); // выбор, прицелы и окна старого матча указывают на то, чего здесь нет
  forgetAdditive();
  if (chainMode) exitChainMode(); // режим «Приказ» не переживает смену матча
  forgetChainRoutes(); // маршруты принадлежат карте СТАРОГО матча
  resetEventFeed(); // журнал, сводка возвращения и память боёв — у владельца ленты (REFM-230)
  resetFogMemory(); // fog memory belongs to the OLD match — and its vision was written into it
  forgetRadarContacts();
  resetThreatAlerts(); // тревоги и доклады союзника старого матча — у владельца полосы (REFM-222)
  clearFlak();
  forgetAway(); // reset the away-window baseline for the new match
  // The match goal, written AFTER the wipe so it is the first line a player can read.
  // Kept honest against the kernel: victoryModule ends on score (SCORE_LIMIT), on
  // elimination, or on domination — no "capital capture" victory exists.
  const waves = data.modes[modeId ?? '']?.pve?.waves;
  note(
    modeId !== undefined && modeId === trainingModeId()
      ? t('training.goal') // полигон кончается взятием миров противника, а не очками
      : waves
        ? t('hud.goal.pve', { n: waves })
        : t('hud.goal', { n: game.scoreLimit() }),
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
  game.sound('start'); // приглушённая фанфара — матч начался (соло и дев-сценарии)
}
export function startMatch(
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
    game.setSandboxHome(setup.seats[0]?.start ?? null);
    setSandboxButton(sandboxConfig.enabled);
  }
  enterSolo(persist);
}

/** Запуск ЗАБЕГА: игрок против Роя, плюс неподвижный пиратский гарнизон карты. */
export function startPvEMatch(dev = false): void {
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
    game.setSandboxHome(
      Object.values(live().planets).find((p) => p.owner === me() && p.kind === 'planet')?.id ??
        null,
    );
    setSandboxButton(true);
    game.devSpeedControl(true);
  }
  // Seed the PvE section through the kernel before the first save. A page can
  // close before its first animation frame; that must not lose a fresh attempt.
  apply(advance(live(), live().time + 1));
  // Стартовые флоты главы — одним флотом вокруг корабля героя (решение владельца
  // 2026-09-26, `decisions/startFleets.ts`). Сливает ядро, приказом: его правила в силе.
  for (const m of startFleetMerges(live(), me())) {
    const merged = order(live(), mergeFleet(me(), m.from, m.into), live().time);
    if (!merged.error) apply(merged);
  }
  // У забега СВОЙ темп, а не дефолт песочницы: на ×10 полное прохождение занимало бы
  // около четырнадцати часов (PVR-2.2, решение владельца §0.3).
  applyTimeSpeed(RUN_SPEED_NORMAL, RUN_SPEED_FAST);
  game.showConnect(false);
  game.showHub(false);
  setupEl.style.display = 'none';
  sciWin.classList.remove('show');
  saveRun();
  note(t('setup.pve.started'));
  // Союзник на связи с первой минуты (`contactAtStart`, главы V и VI): встречи, которая
  // зажигает чип «⬡ Союзник» в главе IV, не будет — та же заметка и мигание со старта.
  if (linkedAlly(live(), me())) {
    note(t('ally.contact.note'));
    game.pulseAlly();
  }
}

/**
 * УЧЕБНЫЙ ПОЛИГОН «Протокол допуска» (`docs/sector-zero-map-concepts.md` §14). Не глава и не
 * забег: у мира нет секции `pve`, поэтому ни волн, ни досье Роя (§14.6), ни снимка забега,
 * ни засчёта в профиль. Темп и инструменты — забега (`setRunActive`), чтобы полигон учил
 * тому же управлению, что ждёт в главе I.
 */
export function startTraining(): void {
  saveRun(); // пауза обычной экспедиции переживает полигон — «Продолжить» её поднимет
  // Учебный противник сам не ходит (§14.2: соединения вводятся по этапам) — ИИ-мест нет.
  // Герой, арсенал и оснащение — те же, что поедут в главу I (`prepareSectorZeroRun`):
  // полигон учит тем кораблям, с которыми игрок пойдёт дальше.
  // TRN-2: двенадцать этапов §14.4 — тур собирает `main.ts`: он водит по его HUD.
  game.hideTrainingResume();
  game.armTrainingTour();
  installMatch(
    prepareSectorZeroRun(trainingState(data), sectorProgress, data),
    new Map(),
    trainingModeId(),
  );
  enterRun('training');
  apply(advance(live(), live().time + 1));
  const merge = trainingFlagshipMerge(live(), me());
  if (merge) {
    const prepared = order(live(), mergeFleet(me(), merge.from, merge.into), live().time);
    if (!prepared.error) apply(prepared);
  }
  // TRN-3: силы противника, контратака и исход — у сценария; на входе он начинается заново.
  resetTrainingScenario(live().time);
  applyTimeSpeed(RUN_SPEED_NORMAL, RUN_SPEED_FAST);
  game.showConnect(false);
  game.showHub(false);
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
export function startProvingGround(): void {
  leaveMatch();
  const st = provingGroundState(data);
  installMatch(st, runAiSeats(st, PROVING_GROUND_PLAYER, 'weak'));
  applyTimeSpeed(setupSpeed);
  game.showConnect(false);
  game.showHub(false);
  note(t('proving-ground.started'));
}

let creatingMatch = false;
export function createOnlineMatch(mapId: MapId): void {
  if (creatingMatch) return;
  const srv = game.resolveServer();
  if (!srv) {
    note(t('acc.server-down'));
    return;
  }
  // Подписи у двух кнопок свои: «Создать сетевую игру» в настройке схватки, «Создать» на
  // странице «Матчи» (UIX-17.1). После запроса каждая возвращает свою.
  const buttons = [
    { button: $('setup-network-create') as HTMLButtonElement, label: t('setup.network.create') },
    { button: $('match-create-go') as HTMLButtonElement, label: t('browser.create.go') },
  ];
  creatingMatch = true;
  for (const { button } of buttons) {
    button.disabled = true;
    button.textContent = t('setup.network.creating');
  }
  detach(
    'create match',
    (async () => {
      try {
        const pass = tokenFor(localStorage, srv.base, srv.nick);
        const res = await fetch(`${httpBase(srv.base)}/matches`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(pass ? { authorization: `Bearer ${pass}` } : {}),
          },
          body: JSON.stringify({ mapId }),
        });
        if (!res.ok) {
          const refusal = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(refusal?.error ?? 'E_CREATE_MATCH');
        }
        const body = (await res.json()) as { matchId: string };
        await openSeatPicker(body.matchId);
      } catch (err) {
        note(
          t(
            err instanceof Error && err.message === 'E_MATCH_QUOTA'
              ? 'setup.network.quota'
              : 'setup.network.failed',
          ),
        );
      } finally {
        creatingMatch = false;
        for (const { button, label } of buttons) {
          button.disabled = false;
          button.textContent = label;
        }
      }
    })(),
  );
}

/** Поднять жизненный цикл: хуки игры и кнопки выхода (⌂, «Покинуть сессию») и создания
 *  сетевой партии. Зовётся из `main.ts` один раз, на месте прежних слушателей. */
export function initMatchLifecycle(host: MatchLifecycleHost): void {
  game = host;
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
    else game.openHub();
  });
  // Rail: «Покинуть сессию» — same exit as the speedbar ⌂, reachable from the rail too. На ПК ⌂
  // в полосе скорости спрятан и выход живёт здесь, поэтому в экспедиции спрашивает и он.
  document.getElementById('rail-exit')?.addEventListener('click', (ev) => {
    if (runInProgress()) openAbandon('exit', ev.currentTarget as HTMLElement);
    else $('tomenu').click();
  });
  $('setup-network-create').addEventListener('click', () => {
    if (!netSetup) createOnlineMatch(setupMapId);
  });
  $('match-create-go').addEventListener('click', () => {
    createOnlineMatch(mapPreset(($('match-create-map') as HTMLSelectElement).value).id);
  });
}
