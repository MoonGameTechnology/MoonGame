/**
 * Забег Sector Zero — у одного владельца (REFM-210): флаги забега, его журнал (полный
 * снимок и дескриптор), засчёт конца и подъём по кнопке «Продолжить».
 *
 * Всё это жило `let`'ами в `main.ts`, и писал их не только забег: установка любой партии
 * гасила три флага, запуск главы и полигона ставил свои, а меню Sector Zero само
 * перечитывало и забывало хранимый забег. Теперь флаги меняют только функции ниже:
 * `main.ts` читает {@link sectorRunActive}, {@link sectorAttempt}, {@link sectorMission} и
 * соседей как живую привязку (`export let`), присвоить мимо владельца не даст компилятор.
 *
 * Мир матча, экраны, темп и комиксы живут в `main.ts`; модуль получает их хуками
 * {@link initSectorRun} — импорт оттуда был бы циклом. Профиль забег берёт у его владельца
 * (`sectorProfile.ts`, REFM-209), а тот спрашивает о забеге своими хуками.
 *
 * Площадку модуль берёт через `getPlatform()` только внутри функций: дев-сборка и смоуки
 * ставят её телом `main.ts`, то есть ПОСЛЕ импорта этого модуля.
 */
import { t } from '../../localization/runtime';
import {
  pveChapter,
  pveMissionIndex,
  pveMissionOfMap,
  pveModeId,
  trainingObjectives,
} from '../../packages/client/src/gameData';
import { extractionNeedMs, type GameState } from '../../packages/shared-core/src/index';
import { chapterChain, type ChapterStep } from '../../decisions/chapterChain';
import { bossMissionRow, missionRows, type MissionRow } from '../../decisions/missionView';
import { runPauseStep, type RunPauseEvent } from '../../decisions/runPause';
import { bossTask } from '../../decisions/runBoss';
import { chapterBlueprint } from '../../decisions/moduleRarity';
import {
  describeRun,
  resumePortableRun,
  type PortableRunSave,
} from '../../decisions/portableRun';
import {
  parseSealedRunSave,
  serializeSealedRunSave,
  parseSealedPortableRun,
  serializeSealedPortableRun,
} from '../../decisions/runSeal';
import { runAiSeats } from '../../decisions/runAiSeats';
import { pveOutcomeEvent } from '../../decisions/runAnalytics';
import {
  DEFAULT_RUN_DIFFICULTY,
  parseRunDifficulty,
  type RunDifficulty,
} from '../../decisions/runDifficulty';
import {
  RUN_SAVE_VERSION,
  type RunSave,
} from '../../decisions/runSave';
import { RUN_TRAVEL_SPEED } from '../../decisions/runTempo';
import {
  portableRunPreview,
  sectorZeroRunPreview,
  type RunPreview,
} from '../../decisions/sectorZeroMenu';
import {
  freshSectorZeroProgress,
  prepareSectorZeroRun,
  settleSectorZeroRun,
} from '../../decisions/sectorZeroProgress';
import { unitTitle } from './dossiers';
import {
  ctx,
  data,
  matchMode,
  setMatchMode,
  setMatchPveBoss,
  setMatchTravelSpeed,
  setMatchVeteranPower,
  type AiProfile,
} from './game';
import { getPlatform, type PlatformHost } from './platform/host';
import { readRaw, writeRaw } from './prefs';
import {
  chapterShown,
  chapterWorld,
  offerRunToCloud,
  portableRunStore,
  persistSectorProgress,
  profileWaitsFor,
  progressWrite,
  runSaveStore,
  saveSectorProgress,
  sectorProgress,
} from './sectorProfile';

/** Что забегу нужно от игры. Мир, экраны, темп и комиксы живут в `main.ts`. */
export interface SectorRunHost {
  /** Мир идущего матча. */
  world(): GameState;
  /** Подменить мир: откат неудачного подъёма, забег по дескриптору. */
  adopt(state: GameState): void;
  /** Первый ход часов: модуль PvE засевает волну, как у нового запуска. */
  step(): void;
  /** Установить партию — общая дверь любого матча. */
  install(state: GameState, ai: Map<string, AiProfile>, modeId: string): void;
  /** Мир встаёт: откатанный подъём не должен пойти сам. */
  halt(): void;
  /** Поднятый забег на экране: темп забега, экраны входа закрыты. */
  show(): void;
  /** Флаг забега сменился: инструменты рельса и разметка геймплея площадки. */
  runChanged(): void;
  /** Игрок этого клиента. */
  me(): string;
  /** Идёт сетевая партия. */
  net(): boolean;
  /** Игрок пришёл по ссылке на сетевой матч. */
  cameFromLink(): boolean;
  /** На экране партия, а не меню. */
  inMatch(): boolean;
  /** Строка ленты. */
  note(text: string): void;
  /** Комиксы конца забега — оболочка Sector Zero: полигон пройден… */
  trainingWon(): void;
  /** …сцены и задачи победного кадра — в очередь РАНЬШЕ засчёта и финала главы… */
  finalScenes(): void;
  /** …и финал главы поверх итогов, после засчёта. */
  chapterWon(): void;
  /** Мир идёт: темп больше нуля и комикс не держит экран. */
  playing(): boolean;
  /** Темп мира сейчас (0 — пауза). */
  speed(): number;
  /** Поставить темп; возобновление не нагоняет время паузы. */
  setSpeed(next: number): void;
  /** Обычный темп кнопки ▶ — с ним паузу снимают, если до неё темпа не было. */
  playSpeed(): number;
}

let game: SectorRunHost;

export let sectorAttempt = 0;
export let sectorRunActive = false;
/** Сила Роя в забеге (PVR-2.1). Выбор игрока ДО запуска, переживающий перезагрузку, —
 *  {@link nextSectorDifficulty}; здесь — сложность идущего забега. */
export let pveDifficulty: RunDifficulty = DEFAULT_RUN_DIFFICULTY;
/** Глава, на которой идёт ТЕКУЩИЙ забег (в отличие от выбранной для следующего). */
export let sectorMission = 0;
export let runShipLoadouts: Record<string, string[]> = {};
export let sectorDevActive = false;
/** Идёт учебный полигон «Протокол допуска» (§14). Ставит только вход полигона
 *  ({@link enterRun}), снимает установка партии — как у дев-забега, флаг живёт ровно один матч. */
export let trainingActive = false;
let savedRun: RunSave | null = null;
/** Дескриптор с прошлой сессии — запасной путь, когда полный снимок не читается. */
let savedPortable: PortableRunSave | null = null;
export let nextSectorDifficulty = parseRunDifficulty(readRaw('void.pveDifficulty'));
/** Выбранная ГЛАВА забега (0 — первая). Живёт рядом со сложностью и хранится так же:
 *  это тот же род настройки запуска. Номер приводит `pveMissionIndex` — тем же правилом,
 *  что карта (AUD-32): испорченное хранилище открывает первую главу, а не роняет вход. */
export let nextSectorMission = pveMissionIndex(Number(readRaw('void.pveMission') ?? 0));
export let runWrite = Promise.resolve();
let clearedAttempt = 0;
/** Terminal journal still protects an award until the profile is durable. This is
 * separate from clearedAttempt, which also controls end-of-run scenes and analytics. */
let protectedTerminalAttempt = 0;
let awardWritten: Promise<boolean> = Promise.resolve(false);
/** Реальное время последней записи. Снимок пишется НЕ каждый кадр: он весит десятки
 *  килобайт, а забегу хватает секундной точности. */
let runSavedAtReal = 0;
const RUN_SAVE_EVERY_MS = 4000;

/** Подключить забег к игре. Хуки зовутся позже — из кадра, кнопок и меню. */
export function initSectorRun(host: SectorRunHost): void {
  game = host;
}

/**
 * Единственная дверь к {@link sectorRunActive} — и заодно разметка геймплея для площадки
 * (`YAG-1.2a`, требование 1.19).
 *
 * ⚠️ Почему сеттер, а не пять вызовов рядом с пятью присваиваниями. Точек, где забег
 * начинается или кончается, уже пять: новый забег, установка другой партии, уход в сеть,
 * успешное восстановление снимка и откат неудачного. Расставить `gameplayStart/stop` по
 * ним значит завести шестую в следующем кирпиче и НЕ заметить этого: индикатор на
 * debug-панели просто останется зелёным после выхода в меню, а модерация смотрит именно
 * его. Сторож в `platform/gameplayMarking.test.ts` падает, если присвоить мимо сеттера.
 *
 * Повторный `start` и `stop` без `start` адаптер гасит сам (`decisions/platformLifecycle`),
 * поэтому здесь нет проверки «а не то же ли самое значение» — она была бы вторым местом,
 * где живёт одно правило.
 *
 * Та же дверь включает и выключает темп перемещения забега (PVR-2.3): ×5 ко всем скоростям
 * карты живёт ровно столько, сколько живёт забег, во всех тех же точках. И силу ветерана
 * (VET-6): урон и корпус за пережитые бои есть только в забеге, сетевая партия и песочница
 * платят ветерану одной наградой.
 */
export function setRunActive(on: boolean): void {
  sectorRunActive = on;
  setMatchTravelSpeed(on ? RUN_TRAVEL_SPEED : 1);
  setMatchVeteranPower(on);
  // Левиафан — босс МАТЁРОГО Роя (PVR-4.7): сложность забега к этой двери уже выбрана.
  setMatchPveBoss(on && pveDifficulty === 'strong');
  // Инструменты рельса и разметка геймплея площадки (`markGameplay`) — в `main.ts`.
  game.runChanged();
}

/** Новая попытка главы — до установки её мира: сложность, номер попытки (он же уходит в
 *  профиль), оснащение кораблей и глава. Стенд разработчика номера не берёт. */
export function beginAttempt(testing: boolean): void {
  pveDifficulty = nextSectorDifficulty;
  sectorAttempt = testing ? 0 : sectorProgress.nextAttempt;
  if (!testing) saveSectorProgress({ ...sectorProgress, nextAttempt: sectorAttempt + 1 });
  runShipLoadouts = JSON.parse(JSON.stringify(sectorProgress.loadouts));
  sectorMission = nextSectorMission;
}

/** Мир установлен — забег пошёл: глава, стенд разработчика или учебный полигон. */
export function enterRun(kind: 'run' | 'dev' | 'training'): void {
  setRunActive(true);
  sectorDevActive = kind === 'dev';
  trainingActive = kind === 'training';
}

/** Установка любой партии: флаги забега живут ровно один матч. */
export function leaveRun(): void {
  setRunActive(false);
  sectorDevActive = false;
  trainingActive = false;
}

/** Сложность следующего забега — выбор игрока, переживающий перезагрузку. */
export function chooseDifficulty(value: RunDifficulty): void {
  nextSectorDifficulty = value;
  writeRaw('void.pveDifficulty', value);
}

/** Глава следующего забега — выбор игрока, переживающий перезагрузку. */
export function chooseMission(value: number): void {
  nextSectorMission = value;
  writeRaw('void.pveMission', String(value));
}

export function isTraining(): boolean {
  return trainingActive && !game.net();
}

/** Идёт ли сейчас забег, который стоит хранить: PvE-матч, который ещё не кончился. */
export function runInProgress(): boolean {
  return isSectorZeroRun() && game.world().match.status !== 'ended';
}
export function isSectorZeroRun(): boolean {
  return sectorRunActive && !game.net() && game.world().pve !== undefined;
}

/** Глава для засчёта забега: карта и задачи плюс гарантированный чертёж за первую
 *  победу (SZE-5.3, `chapterBlueprint`) — ступень растёт к эпицентру. */
export function chapterForSettle(mission: number) {
  // Номер из журнала или хранилища приводится ОДИН раз (AUD-32): карта и награда главы
  // считаются по одной и той же главе.
  const index = pveMissionIndex(mission);
  return { ...pveChapter(index), blueprint: chapterBlueprint(index) };
}

/** Записать снимок (или забыть его, если забег кончился). Провал записи молчалив —
 *  бэкенд обещает не ронять игру, а не обещает сохранить. */
function currentRunSave(): RunSave<GameState> | null {
  if (!isSectorZeroRun() || sectorDevActive) return null;
  const mode = matchMode();
  if (!mode) return null;
  return {
    v: RUN_SAVE_VERSION,
    mode,
    difficulty: pveDifficulty,
    state: game.world(),
    sectorZeroAttempt: sectorAttempt,
    shipLoadouts: runShipLoadouts,
    sectorZeroMission: sectorMission,
  };
}
export function saveRun(): void {
  const save = currentRunSave();
  if (!save || (save.state.match.status === 'ended' && clearedAttempt === sectorAttempt)) return;
  const blob = serializeSealedRunSave(save, sectorProgress.seed);
  const boons = data.modes[save.mode]?.pve?.boons ?? [];
  const portable = serializeSealedPortableRun(
    describeRun(save.state, game.me(), (id) => boons.includes(id), {
      mode: save.mode,
      difficulty: save.difficulty,
      attempt: sectorAttempt,
    }),
    sectorProgress.seed,
  );
  // Capture the write before extending runWrite: a later award can make the profile
  // wait for this journal, so starting persistence inside the callback would cycle.
  const priorAwardWritten = protectedTerminalAttempt > 0 &&
    protectedTerminalAttempt !== save.sectorZeroAttempt
    ? persistSectorProgress()
    : null;
  if (save.state.match.status === 'ended' && protectedTerminalAttempt === 0) {
    protectedTerminalAttempt = save.sectorZeroAttempt ?? 0;
  }
  const seed = sectorProgress.seed;
  runWrite = runWrite.then(async () => {
    const prior = priorAwardWritten
      ? parseSealedRunSave(await runSaveStore.load(), seed)
      : null;
    const replacesTerminal = prior && prior.sectorZeroAttempt !== save.sectorZeroAttempt &&
      (prior.state as GameState).match?.status === 'ended';
    if (replacesTerminal && !(await priorAwardWritten)) return;
    await runSaveStore.save(blob);
    await portableRunStore.save(portable);
    if (replacesTerminal && protectedTerminalAttempt === prior.sectorZeroAttempt) {
      protectedTerminalAttempt = 0;
    }
    if (save.state.match.status === 'ended') protectedTerminalAttempt = save.sectorZeroAttempt ?? 0;
  });
  // Дескриптор и мир забега — часть облачного профиля: когда они станут новой правкой,
  // решает его владелец (`offerRunToCloud`).
  offerRunToCloud(portable, blob);
}

export function awardSectorRun(): number {
  if (sectorDevActive) return 0;
  const s = game.world();
  // Задачи главы платят и здесь, в обычном конце забега (раньше их платил только засчёт
  // после перезагрузки — PVR-5.3 нашёл это при переходе на запас задач).
  const next = settleSectorZeroRun(
    sectorProgress,
    sectorAttempt,
    s,
    chapterForSettle(sectorMission),
    data,
  );
  if (next !== sectorProgress) {
    // Journal the terminal run before its award. If the page closes between the
    // two writes, opening the menu settles the same serial exactly once.
    saveRun();
    profileWaitsFor(runWrite);
    saveSectorProgress(next);
  }
  awardWritten = persistSectorProgress();
  return sectorProgress.lastReward;
}

/** Кадровый такт сохранения: раз в несколько секунд, пока забег идёт. Кончился —
 *  снимок забывается, иначе следующий запуск воскресил бы доигранный мир. */
export function tickRunSave(nowReal: number): void {
  if (sectorDevActive) return;
  const s = game.world();
  const ME = game.me();
  if (isTraining() && s.match.status === 'ended' && s.match.winner === ME) game.trainingWon();
  if (isSectorZeroRun() && s.match.status === 'ended') {
    if (sectorAttempt > 0 && clearedAttempt !== sectorAttempt) {
      const won = s.match.winner === ME || (s.match.winners ?? []).includes(ME);
      // Спасение/встреча в победном кадре должны показаться до финала главы.
      game.finalScenes();
      // Исход попытки (`YAG-5.1`) — один раз, там же, где засчитывается её награда.
      const outcome = pveOutcomeEvent(s, ME, {
        chapter: pveChapter(sectorMission).id,
        attempt: sectorAttempt,
      });
      if (outcome) getPlatform().analytics.emit(outcome.event, outcome.props);
      awardSectorRun();
      clearedAttempt = sectorAttempt;
      // Победа — комикс главы поверх итогов (в первый раз); итоги под ним уже нарисованы.
      if (won) game.chapterWon();
      const awardWrite = awardWritten;
      const attempt = sectorAttempt;
      runWrite = runWrite.then(async () => {
        if (!(await awardWrite) || sectorAttempt !== attempt) return;
        await runSaveStore.clear();
        await portableRunStore.clear();
        if (protectedTerminalAttempt === attempt) protectedTerminalAttempt = 0;
      });
    }
    return;
  }
  if (!game.inMatch() || !runInProgress() || nowReal - runSavedAtReal < RUN_SAVE_EVERY_MS) return;
  runSavedAtReal = nowReal;
  saveRun();
}

/**
 * Карточка «Продолжить» для меню Sector Zero: засчитывает и стирает законченный забег,
 * иначе читает снимок, а без него — дескриптор. Мир при этом не ставится.
 */
export async function loadSavedRun(): Promise<RunPreview | null> {
  await progressWrite;
  await runWrite;
  savedRun = parseSealedRunSave(await runSaveStore.load(), sectorProgress.seed);
  // Persistence can be unavailable. A paused run still exists in this tab.
  if (runInProgress() && !sectorDevActive) savedRun = currentRunSave();
  if (
    savedRun &&
    savedRun.mode === pveModeId() &&
    (savedRun.state as GameState).match?.status === 'ended'
  ) {
    const terminalAttempt = savedRun.sectorZeroAttempt ?? 0;
    protectedTerminalAttempt = terminalAttempt;
    // The signed journal can outlive the failed metadata write that reserved its
    // serial. Adopt that trusted reservation before settlement, as on live resume.
    if (terminalAttempt >= sectorProgress.nextAttempt) {
      saveSectorProgress({ ...sectorProgress, nextAttempt: terminalAttempt + 1 });
    }
    const next = settleSectorZeroRun(
      sectorProgress,
      savedRun.sectorZeroAttempt ?? 0,
      savedRun.state as GameState,
      chapterForSettle(savedRun.sectorZeroMission ?? sectorMission),
      data,
    );
    if (next !== sectorProgress) saveSectorProgress(next);
    if (await persistSectorProgress()) {
      await runSaveStore.clear();
      await portableRunStore.clear();
      if (protectedTerminalAttempt === terminalAttempt) protectedTerminalAttempt = 0;
    }
    savedRun = null;
    // При отказе записи журнал ещё нужен для награды. Его дескриптор не должен
    // воскресить уже завершённую попытку и затереть этот журнал новым миром.
    savedPortable = null;
    return null;
  }
  const full = sectorZeroRunPreview(savedRun, pveModeId() ?? '');
  if (full) return full;
  // Полного снимка нет или он не читается (игру обновили, форма мира сменилась) —
  // карточка по дескриптору: тот же забег, та же волна, но мир соберётся заново.
  savedPortable = parseSealedPortableRun(await portableRunStore.load(), sectorProgress.seed);
  const mode = pveModeId() ?? '';
  const known = pveMissionOfMap(savedPortable?.map) !== null;
  return portableRunPreview(known ? savedPortable : null, mode, data.modes[mode]?.pve?.waves ?? 0);
}

/** Хранимый для «Продолжить» забег забывается: меню перечитает журнал. */
export function forgetSavedRun(): void {
  savedRun = null;
  savedPortable = null;
}

/**
 * ВРЕМЕННО (заказ владельца 2026-09-27): «Начать всё заново». Чистый профиль с тем же сидом
 * (облако узнаёт его как свой и не спрашивает «какой оставить»), без сохранённого забега —
 * локально и, через номер правки, в облаке. Аккаунт и настройки не трогает.
 */
export async function resetSectorZero(): Promise<void> {
  await progressWrite;
  await runWrite;
  if (runInProgress()) setRunActive(false);
  await runSaveStore.clear();
  await portableRunStore.clear();
  protectedTerminalAttempt = 0;
  forgetSavedRun();
  chooseMission(0);
  saveSectorProgress(freshSectorZeroProgress(data, sectorProgress.seed));
  await progressWrite;
}

/**
 * Поднять забег только по кнопке «Продолжить». Чтение карточки сохранения не
 * устанавливает мир и не запускает часы за главным меню.
 */
export function restoreRun(): boolean {
  // Пришедшего ПО ССЫЛКЕ забег не перехватывает: он уже дозванивается в сетевой матч,
  // и поднять поверх этого локальный мир значило бы увести его не туда. Снимок при
  // этом не трогаем — он дождётся обычного запуска.
  if (game.cameFromLink() || game.net()) return false;
  const save = savedRun;
  // Полный снимок недоступен — запасной путь по дескриптору (`YAG-2.1`).
  if (!save || !sectorZeroRunPreview(save, pveModeId() ?? '')) return restorePortable();
  const state = save.state as GameState;
  // Режим из снимка может не существовать в задеплоенных данных (игру обновили) —
  // тогда восстанавливать нельзя: волны пошли бы по другим правилам, а то и не пошли.
  if (!data.modes[save.mode]) {
    return restorePortable();
  }
  const priorState = game.world();
  const priorMode = matchMode();
  const priorRunActive = sectorRunActive;
  const priorDevActive = sectorDevActive;
  try {
    const aiSeats = runAiSeats(state, 'p1', parseRunDifficulty(save.difficulty));
    game.install(state, aiSeats, save.mode);
  } catch {
    // Снимок прошёл разбор, но миром не стал (чужая форма состояния, битая карта).
    // Оставляем файл на месте; меню сообщает об отказе и предлагает новый запуск.
    game.adopt(priorState);
    setMatchMode(priorMode);
    setRunActive(priorRunActive);
    sectorDevActive = priorDevActive;
    game.halt();
    return restorePortable();
  }
  pveDifficulty = parseRunDifficulty(save.difficulty);
  setRunActive(true);
  sectorAttempt = save.sectorZeroAttempt ?? sectorProgress.nextAttempt;
  sectorMission = pveMissionIndex(save.sectorZeroMission ?? sectorMission);
  if (sectorProgress.nextAttempt <= sectorAttempt) {
    saveSectorProgress({ ...sectorProgress, nextAttempt: sectorAttempt + 1 });
  }
  runShipLoadouts = save.shipLoadouts ?? {};
  // Темп тот же, что у запуска. Экраны, через которые игрок обычно ИДЁТ к матчу,
  // закрываются сами — по дороге. Восстановление в эту дорогу не входит, поэтому
  // закрывает их явно: без этого забег оживает ПОД экраном приветствия, и игрок видит
  // форму входа с окном усиления поверх неё (поймано снимком живой сборки, не тестом).
  game.show();
  saveRun();
  game.note(t('setup.pve.restored'));
  return true;
}

/**
 * Забег по ДЕСКРИПТОРУ (`YAG-2.1`) — когда полного снимка нет или он не стал миром.
 *
 * Мир собирается так же, как у нового запуска той же главы (карта, снаряжение, сложность),
 * засевается модулем PvE и только потом получает волну и усиления из дескриптора —
 * чистой функцией `resumePortableRun`. ⚠️ Восстановление НЕ побайтовое: флоты, бои и
 * ресурсы начинаются заново, и игрок это видит в журнале, а не догадывается. Номер попытки
 * берётся из дескриптора — награда за этот забег не выдастся дважды.
 *
 * ⚠️ Это ЗАПАСНОЙ путь, и держать его таким обязательно (AUD-24). Новый мир с карты главы
 * выгоднее проигрываемого — дом цел, наступление Роя стёрто, — поэтому путь, на который
 * игрок может встать по желанию, был перемоткой поражения. Облако теперь везёт точный мир,
 * и сюда приходят только когда его нет: игру обновили и снимок не стал миром, или мир не
 * влез в лимит площадки.
 */
function restorePortable(): boolean {
  const save = savedPortable;
  const mission = pveMissionOfMap(save?.map);
  const pve = save ? data.modes[save.mode]?.pve : undefined;
  if (!save || mission === null || !pve || pveModeId(mission) !== save.mode) return false;
  const priorState = game.world();
  const priorMode = matchMode();
  const priorRunActive = sectorRunActive;
  const priorDevActive = sectorDevActive;
  const priorMission = sectorMission;
  try {
    sectorMission = mission;
    const world = prepareSectorZeroRun(
      chapterWorld(mission, parseRunDifficulty(save.difficulty)),
      sectorProgress,
      data,
    );
    game.install(world, runAiSeats(world, 'p1', parseRunDifficulty(save.difficulty)), save.mode);
    game.step(); // засеять PvE: волна 0, следующая назначена
    const resumed = resumePortableRun(game.world(), save, game.me(), pve.boons ?? []);
    if (!resumed) throw new Error('E_RESUME_UNSEEDED');
    game.adopt(resumed);
  } catch {
    game.adopt(priorState);
    setMatchMode(priorMode);
    setRunActive(priorRunActive);
    sectorDevActive = priorDevActive;
    sectorMission = priorMission;
    game.halt();
    return false;
  }
  pveDifficulty = parseRunDifficulty(save.difficulty);
  setRunActive(true);
  sectorDevActive = false;
  sectorAttempt = save.attempt ?? sectorProgress.nextAttempt;
  if (sectorProgress.nextAttempt <= sectorAttempt) {
    saveSectorProgress({ ...sectorProgress, nextAttempt: sectorAttempt + 1 });
  }
  runShipLoadouts = JSON.parse(JSON.stringify(sectorProgress.loadouts));
  game.show();
  saveRun();
  game.note(t('setup.pve.restored-portable', { n: game.world().pve?.waveNumber ?? 0 }));
  return true;
}

// --- остатки забега из `main.ts` (REFM-243): разметка геймплея, инструменты экрана, задачи и
// цепочка главы, пауза. Мир, своё место, сеть и темп — хуками {@link initSectorRun}.

/**
 * Разметка геймплея для площадки — одна дверь на все её поводы (`YAG-1.2a`, `YAG-6.2`).
 * «Геймплей идёт» = забег идёт И мир не стоит: пауза игрока, уход со страницы и выход в
 * меню забега останавливают его так же, как конец забега. Раньше разметку знал только
 * флаг забега, и после выхода в меню индикатор площадки оставался зелёным.
 *
 * Зовётся из сеттера забега (`setRunActive`, хук `runChanged`) и из кадра — при смене
 * ответа: темп мира меняют больше десятка мест (полоса скорости, кнопка паузы, запуск и
 * восстановление), и поставить вызов в каждое — значит однажды забыть одно. Повторы гасит
 * адаптер (`decisions/platformLifecycle`).
 *
 * «Мир идёт» отвечает игра (хук `playing`): темп и комиксы живут в `main.ts`.
 */
let gameplayMarked: boolean | null = null;
export function markGameplay(): void {
  const playing = sectorRunActive && game.playing();
  gameplayMarked = playing;
  const api = getPlatform() as Partial<PlatformHost>;
  if (playing) api.gameplayStart?.();
  else api.gameplayStop?.();
}
/** Кадровый такт разметки: ответ «геймплей идёт» сменился — разметить заново. */
export function tickGameplayMark(): void {
  if (gameplayMarked !== (sectorRunActive && game.playing())) markGameplay();
}

/** Идёт ли забег Sector Zero — для ИНТЕРФЕЙСА. Не `isSectorZeroRun()`: тот ждёт ещё и
 *  секцию `s.pve`, а она появляется позже, чем `setRunActive(true)`, — синхронизация на
 *  нём видела «не забег» и оставляла кнопки (поймал `sectorzerotest.mjs`). Флаг же ставят
 *  только забеги Sector Zero. */
export function sectorZeroToolsHidden(): boolean {
  return sectorRunActive && !game.net();
}

/** Задачи этого забега для панели, меток и чипа (`missionView.ts`). */
export function runMissionRows(): MissionRow[] {
  if (isTraining()) return missionRows(trainingObjectives(), game.world(), game.me());
  const chapter = pveChapter(sectorMission);
  const s = game.world();
  const rows = missionRows(chapterShown(sectorMission), s, game.me(), chapter.slots?.base);
  // Босс — своя задача, пока он на поле или пал в этом забеге (PVR-4.7, `runBoss.ts`).
  const boss = bossTask(s);
  return boss ? [...rows, bossMissionRow(boss)] : rows;
}

/** Подпись флота для кнопки «Извлечь флотом …»: его корабли, «2× Крейсер, 1× Фрегат». */
export function fleetLabelOf(fleetId: string): string {
  const f = game.world().fleets[fleetId];
  if (!f) return fleetId;
  return f.units
    .filter((u) => u.count > 0)
    .map((u) => `${u.count}× ${unitTitle(u.unit)}`)
    .join(', ');
}

/** Главная цепочка главы: IV (PVR-7.5) — связь → архив → накопитель → вывод; V (PVR-9.7) —
 *  звено сети → очаги; VI (PVR-8.5) — доки → эвакуация → очаги → главные силы. `null` — в этой
 *  главе цепочки нет. Доля работы — под темп матча (`extractionNeedMs` ядра). */
export function runChain(): ChapterStep[] | null {
  if (!sectorRunActive) return null;
  const s = game.world();
  return chapterChain(s, game.me(), extractionNeedMs(s, ctx(s.time, s)), data);
}

// --- пауза забега (YAG-6.2) ---------------------------------------------------
// Резолюция владельца 2026-09-24: мир забега ЗАМИРАЕТ, пока игрока нет, и у игрока есть
// кнопка паузы на любом устройстве. Правила — `decisions/runPause.ts`; здесь — память
// паузы и её применение, поводы подключает `main.ts`.
/** С каким темпом продолжить после паузы — обычным или ускоренным, как шли до неё. */
let runResumeSpeed = 0;
/** Паузу поставила площадка — её «продолжить» и снимет. */
let runPlatformHeld = false;
/** Кнопка паузы есть, пока идёт забег Sector Zero, — не сетевой и не законченный. */
export function runPauseShown(): boolean {
  return sectorRunActive && !game.net() && game.world().match.status !== 'ended';
}
/** Правило паузы забега (`decisions/runPause.ts`) — одно на все поводы: кнопку «‖» полосы
 *  скорости, уход со страницы и паузу площадки. Возобновление не нагоняет время паузы:
 *  сброс отметки реального времени делает хук `setSpeed`. */
export function runPauseEvent(event: RunPauseEvent): void {
  if (!runPauseShown()) return;
  const next = runPauseStep(
    {
      speed: game.speed(),
      resumeSpeed: runResumeSpeed || game.playSpeed(),
      platformHeld: runPlatformHeld,
    },
    event,
  );
  game.setSpeed(next.speed);
  runResumeSpeed = next.resumeSpeed;
  runPlatformHeld = next.platformHeld;
  for (const x of Array.from(document.querySelectorAll('[data-speed]')))
    x.classList.toggle('on', Number((x as HTMLElement).dataset.speed) === next.speed);
  markGameplay();
}
