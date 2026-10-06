/**
 * Забег Sector Zero — у одного владельца (REFM-210): флаги забега, его журнал (снимок и
 * дескриптор), хранимый забег для «Продолжить», засчёт и восстановление.
 *
 * Всё это жило `let`'ами в `main.ts`, и флаги писали шесть зон: запуск забега и полигона,
 * установка партии, меню, восстановление и его откат. Теперь флаги меняют только функции
 * ниже — `main.ts` читает их как прежде (`export let`, живая привязка; присвоить мимо
 * владельца не даст компилятор), а запуск партии зовёт {@link prepareRun},
 * {@link startRun}, {@link startTrainingRun} и {@link resetRunFlags}.
 *
 * Мир, темп, экраны и комиксы живут в `main.ts` и приходят хуками {@link initSectorRun}:
 * у них ещё нет своих владельцев (REFM-219, REFM-211), и импорт оттуда был бы циклом.
 * Профиль — у `sectorProfile.ts`, его модуль импортирует напрямую.
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
} from '../../packages/client/src/gameData';
import type { GameState } from '../../packages/shared-core/src/index';
import type { ComicMoment } from '../../decisions/chapterComics';
import { chapterBlueprint } from '../../decisions/moduleRarity';
import {
  describeRun,
  parsePortableRun,
  resumePortableRun,
  serializePortableRun,
  type PortableRunSave,
} from '../../decisions/portableRun';
import { runAiSeats } from '../../decisions/runAiSeats';
import { pveOutcomeEvent } from '../../decisions/runAnalytics';
import {
  DEFAULT_RUN_DIFFICULTY,
  parseRunDifficulty,
  type RunDifficulty,
} from '../../decisions/runDifficulty';
import {
  RUN_SAVE_VERSION,
  parseRunSave,
  serializeRunSave,
  type RunSave,
} from '../../decisions/runSave';
import { RUN_TRAVEL_SPEED } from '../../decisions/runTempo';
import {
  portableRunPreview,
  sectorZeroRunPreview,
  type RunPreview,
} from '../../decisions/sectorZeroMenu';
import { prepareSectorZeroRun, settleSectorZeroRun } from '../../decisions/sectorZeroProgress';
import {
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
  chapterWorld,
  offerRunToCloud,
  portableRunStore,
  profileWaitsFor,
  progressWrite,
  runSaveStore,
  saveSectorProgress,
  sectorProgress,
} from './sectorProfile';

/** Что забегу нужно от игры. Мир, темп, экраны и комиксы живут в `main.ts`. */
export interface SectorRunHost {
  /** Мир на экране. */
  world(): GameState;
  /** Место игрока в этом мире. */
  me(): string;
  /** Идёт сетевая партия — у неё забега нет. */
  online(): boolean;
  /** Игрок пришёл по ссылке и дозванивается в сетевую партию. */
  fromLink(): boolean;
  /** Партия на экране, а не хаб или меню. */
  inMatch(): boolean;
  /** Мир идёт: игрок не поставил паузу и не читает комикс. */
  worldRunning(): boolean;
  /** Флаг забега сменился — инструменты мультиплеера прячутся или возвращаются. */
  syncTools(): void;
  /** Поставить партию (`installMatch`). */
  install(state: GameState, ai: Map<string, AiProfile>, mode: string): void;
  /** Подменить мир: откат неудачного восстановления и мир, поднятый по дескриптору. */
  setWorld(state: GameState): void;
  /** Первый ход ядра — засевает секцию PvE. */
  seed(): void;
  /** Мир встаёт: откат возвращает прежнюю партию на паузе. */
  halt(): void;
  /** Забег поднят: темп забега, а экраны по дороге к матчу закрыты. */
  enterRun(): void;
  /** Строка ленты. */
  note(text: string): void;
  /** Комикс главы по событию — один раз на профиль. */
  comic(chapter: string, moment: ComicMoment): void;
  /** Комиксы задач и главной цепочки этого кадра. */
  taskComics(): void;
}

let game: SectorRunHost;

/** Сила Роя в забеге (PVR-2.1): выбор игрока ДО запуска, переживающий перезагрузку. */
export let pveDifficulty: RunDifficulty = DEFAULT_RUN_DIFFICULTY;
/** Глава, на которой идёт ТЕКУЩИЙ забег (в отличие от выбранной для следующего). */
export let sectorMission = 0;
export let sectorAttempt = 0;
export let sectorRunActive = false;
export let sectorDevActive = false;
/** Идёт учебный полигон «Протокол допуска» (§14). Ставит только {@link startTrainingRun},
 *  снимает {@link resetRunFlags} — как у дев-забега, флаг живёт ровно один матч. */
export let trainingActive = false;
export let runShipLoadouts: Record<string, string[]> = {};
export let savedRun: RunSave | null = null;
/** Дескриптор с прошлой сессии — запасной путь, когда полный снимок не читается. */
export let savedPortable: PortableRunSave | null = null;
export let nextSectorDifficulty = parseRunDifficulty(readRaw('void.pveDifficulty'));
/** Выбранная ГЛАВА забега (0 — первая). Живёт рядом со сложностью и хранится так же:
 *  это тот же род настройки запуска. Номер приводит `pveMissionIndex` — тем же правилом,
 *  что карта (AUD-32): испорченное хранилище открывает первую главу, а не роняет вход. */
export let nextSectorMission = pveMissionIndex(Number(readRaw('void.pveMission') ?? 0));
/** Очередь записей журнала забега. Профиль и облако её дожидаются. */
export let runWrite = Promise.resolve();
let clearedAttempt = 0;
/** Реальное время последней записи. Снимок пишется НЕ каждый кадр: он весит десятки
 *  килобайт, а забегу хватает секундной точности. */
let runSavedAtReal = 0;
const RUN_SAVE_EVERY_MS = 4000;

/** Подключить забег к игре. Зовётся один раз, до первой партии. */
export function initSectorRun(hooks: SectorRunHost): void {
  game = hooks;
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
  game.syncTools();
  markGameplay();
}

/**
 * Разметка геймплея для площадки — одна дверь на все её поводы (`YAG-1.2a`, `YAG-6.2`).
 * «Геймплей идёт» = забег идёт И мир не стоит: пауза игрока, уход со страницы и выход в
 * меню забега останавливают его так же, как конец забега. Раньше разметку знал только
 * флаг забега, и после выхода в меню индикатор площадки оставался зелёным.
 *
 * Зовётся из сеттера забега и из кадра — при смене ответа: темп мира меняют больше десятка
 * мест (полоса скорости, кнопка паузы, запуск и восстановление), и поставить вызов в
 * каждое — значит однажды забыть одно. Повторы гасит адаптер (`decisions/platformLifecycle`).
 */
export let gameplayMarked: boolean | null = null;
export function markGameplay(): void {
  const playing = sectorRunActive && game.worldRunning();
  gameplayMarked = playing;
  const api = getPlatform() as Partial<PlatformHost>;
  if (playing) api.gameplayStart?.();
  else api.gameplayStop?.();
}

/** Идёт ли забег Sector Zero — для ИНТЕРФЕЙСА. Не `isSectorZeroRun()`: тот ждёт ещё и
 *  секцию `s.pve`, а она появляется позже, чем `setRunActive(true)`, — синхронизация на
 *  нём видела «не забег» и оставляла кнопки (поймал `sectorzerotest.mjs`). Флаг же ставят
 *  только забеги Sector Zero. */
export function sectorZeroToolsHidden(): boolean {
  return sectorRunActive && !game.online();
}
export function isTraining(): boolean {
  return trainingActive && !game.online();
}
/** Уход из матча ведёт в меню Sector Zero — из забега и из полигона, а не в хаб. */
export function leavesToSectorZero(): boolean {
  return isSectorZeroRun() || isTraining();
}
/** Идёт ли сейчас забег, который стоит хранить: PvE-матч, который ещё не кончился. */
export function runInProgress(): boolean {
  return isSectorZeroRun() && game.world().match.status !== 'ended';
}
export function isSectorZeroRun(): boolean {
  return sectorRunActive && !game.online() && game.world().pve !== undefined;
}

/** Новая партия: флаги прежнего забега, дев-забега и полигона гаснут вместе с ней. */
export function resetRunFlags(): void {
  setRunActive(false);
  sectorDevActive = false;
  trainingActive = false;
}
/** Новая попытка главы до установки её мира: сложность и глава — выбранные в меню, номер
 *  попытки — из профиля (дев-забег профиль не пишет), снаряжение — копия профиля. */
export function prepareRun(testing: boolean): void {
  pveDifficulty = nextSectorDifficulty;
  sectorAttempt = testing ? 0 : sectorProgress.nextAttempt;
  if (!testing) saveSectorProgress({ ...sectorProgress, nextAttempt: sectorAttempt + 1 });
  runShipLoadouts = JSON.parse(JSON.stringify(sectorProgress.loadouts));
  sectorMission = nextSectorMission;
}
/** Мир забега поставлен — забег идёт; `dev` — дев-забег без профиля. */
export function startRun(dev: boolean): void {
  setRunActive(true);
  sectorDevActive = dev;
}
/** Мир полигона поставлен: темп и инструменты — забега, флаг — полигона. */
export function startTrainingRun(): void {
  setRunActive(true);
  trainingActive = true;
}
/** Профиль сменился под вкладкой — забег прежнего профиля, стоящий на паузе в этой вкладке,
 *  перестаёт быть забегом. */
export function stopRun(): void {
  if (runInProgress()) setRunActive(false);
}
/** Хранимый для «Продолжить» забег забывается: меню перечитает журнал. */
export function forgetSavedRun(): void {
  savedRun = null;
  savedPortable = null;
}
/** Сложность следующего забега — выбор игрока в меню, переживающий перезагрузку. */
export function chooseDifficulty(value: RunDifficulty): void {
  nextSectorDifficulty = value;
  writeRaw('void.pveDifficulty', value);
}
/** Глава следующего забега — так же. */
export function chooseMission(value: number): void {
  nextSectorMission = value;
  writeRaw('void.pveMission', String(value));
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
  const s = game.world();
  const ME = game.me();
  const save = currentRunSave();
  if (!save || (s.match.status === 'ended' && clearedAttempt === sectorAttempt)) return;
  const blob = serializeRunSave(save);
  const boons = data.modes[save.mode]?.pve?.boons ?? [];
  const portable = serializePortableRun(
    describeRun(s, ME, (id) => boons.includes(id), {
      mode: save.mode,
      difficulty: save.difficulty,
      attempt: sectorAttempt,
    }),
  );
  runWrite = runWrite
    .then(() => runSaveStore.save(blob))
    .then(() => portableRunStore.save(portable));
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
  return sectorProgress.lastReward;
}

/** Кадровый такт сохранения: раз в несколько секунд, пока забег идёт. Кончился —
 *  снимок забывается, иначе следующий запуск воскресил бы доигранный мир. */
export function tickRunSave(nowReal: number): void {
  if (sectorDevActive) return;
  const s = game.world();
  const ME = game.me();
  if (isTraining() && s.match.status === 'ended' && s.match.winner === ME)
    game.comic('training-1', 'outro');
  if (isSectorZeroRun() && s.match.status === 'ended') {
    if (sectorAttempt > 0 && clearedAttempt !== sectorAttempt) {
      const won = s.match.winner === ME || (s.match.winners ?? []).includes(ME);
      // Спасение/встреча в победном кадре должны показаться до финала главы.
      game.taskComics();
      // Исход попытки (`YAG-5.1`) — один раз, там же, где засчитывается её награда.
      const outcome = pveOutcomeEvent(s, ME, {
        chapter: pveChapter(sectorMission).id,
        attempt: sectorAttempt,
      });
      if (outcome) getPlatform().analytics.emit(outcome.event, outcome.props);
      awardSectorRun();
      clearedAttempt = sectorAttempt;
      // Победа — комикс главы поверх итогов (в первый раз); итоги под ним уже нарисованы.
      if (won) game.comic(pveChapter(sectorMission).id, 'outro');
      const awardWrite = progressWrite;
      runWrite = runWrite
        .then(() => awardWrite)
        .then(() => runSaveStore.clear())
        .then(() => portableRunStore.clear());
    }
    return;
  }
  if (!game.inMatch() || !runInProgress() || nowReal - runSavedAtReal < RUN_SAVE_EVERY_MS) return;
  runSavedAtReal = nowReal;
  saveRun();
}

/**
 * Карточка «Продолжить» для меню: хранимый забег из журнала. Закончившийся, но не
 * засчитанный забег (вкладку закрыли на итогах) засчитывается здесь и стирается.
 */
export async function loadSavedRun(): Promise<RunPreview | null> {
  await progressWrite;
  await runWrite;
  savedRun = parseRunSave(await runSaveStore.load());
  // Persistence can be unavailable. A paused run still exists in this tab.
  if (runInProgress() && !sectorDevActive) savedRun = currentRunSave();
  if (
    savedRun &&
    savedRun.mode === pveModeId() &&
    (savedRun.state as GameState).match?.status === 'ended'
  ) {
    const next = settleSectorZeroRun(
      sectorProgress,
      savedRun.sectorZeroAttempt ?? 0,
      savedRun.state as GameState,
      chapterForSettle(savedRun.sectorZeroMission ?? sectorMission),
      data,
    );
    if (next !== sectorProgress) saveSectorProgress(next);
    await progressWrite;
    await runSaveStore.clear();
    await portableRunStore.clear();
    savedRun = null;
  }
  const full = sectorZeroRunPreview(savedRun, pveModeId() ?? '');
  if (full) return full;
  // Полного снимка нет или он не читается (игру обновили, форма мира сменилась) —
  // карточка по дескриптору: тот же забег, та же волна, но мир соберётся заново.
  savedPortable = parsePortableRun(await portableRunStore.load());
  const mode = pveModeId() ?? '';
  const known = pveMissionOfMap(savedPortable?.map) !== null;
  return portableRunPreview(known ? savedPortable : null, mode, data.modes[mode]?.pve?.waves ?? 0);
}

/** «Начать всё заново» (временная кнопка, заказ владельца 2026-09-27) — забеговая часть:
 *  без сохранённого забега и с первой главой. Профиль чистит вызывающий. */
export async function resetRuns(): Promise<void> {
  await progressWrite;
  await runWrite;
  stopRun();
  await runSaveStore.clear();
  await portableRunStore.clear();
  forgetSavedRun();
  chooseMission(0);
}

/**
 * Поднять забег только по кнопке «Продолжить». Чтение карточки сохранения не
 * устанавливает мир и не запускает часы за главным меню.
 */
export function restoreRun(): boolean {
  // Пришедшего ПО ССЫЛКЕ забег не перехватывает: он уже дозванивается в сетевой матч,
  // и поднять поверх этого локальный мир значило бы увести его не туда. Снимок при
  // этом не трогаем — он дождётся обычного запуска.
  if (game.fromLink() || game.online()) return false;
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
    game.setWorld(priorState);
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
  game.enterRun(); // тот же темп, что у запуска
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
export function restorePortable(): boolean {
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
    game.seed(); // засеять PvE: волна 0, следующая назначена
    const resumed = resumePortableRun(game.world(), save, game.me(), pve.boons ?? []);
    if (!resumed) throw new Error('E_RESUME_UNSEEDED');
    game.setWorld(resumed);
  } catch {
    game.setWorld(priorState);
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
  game.enterRun();
  saveRun();
  game.note(t('setup.pve.restored-portable', { n: game.world().pve?.waveNumber ?? 0 }));
  return true;
}
