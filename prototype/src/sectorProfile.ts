/**
 * Профиль Sector Zero — у одного владельца (REFM-209): хранение с печатью и теневой копией,
 * облачная копия площадки и вкладка-хозяйка.
 *
 * Всё это жило `let`'ами в `main.ts`, и профиль с облаком писали переменные друг друга:
 * запись профиля двигала номер правки облака, сверка облака подменяла профиль, перехват
 * вкладки перечитывал и то и другое, а забег сам писал три переменные облака, решая, пора
 * ли отправить свой мир. Теперь профиль и облако меняют только функции ниже, а забег отдаёт
 * облаку свой снимок одной из них ({@link offerRunToCloud}).
 *
 * `main.ts` читает профиль как прежде — {@link sectorProgress} и {@link progressWrite} это
 * `export let`, живая привязка; присвоить мимо владельца не даст компилятор. Что профилю
 * нужно от игры (лента, журнал забега, сам забег, экран), приходит хуками
 * {@link initSectorProfile}: забег и экран живут в `main.ts`, и импорт оттуда был бы циклом.
 *
 * Площадку модуль берёт через `getPlatform()` только внутри функций: дев-сборка и смоуки
 * ставят её телом `main.ts`, то есть ПОСЛЕ импорта этого модуля.
 */
import { t, tData } from '../../localization/runtime';
import {
  pveChapter,
  pveRescues,
  pveState,
  PVE_MISSION_COUNT,
} from '../../packages/client/src/gameData';
import type { GameState } from '../../packages/shared-core/src/index';
import {
  adoptMark,
  bumpMark,
  keepLocalMark,
  parseCloudProfile,
  parseSyncMark,
  planCloudSync,
  profileNumbers,
  profileHasProgress,
  cloudEnvelope,
  type CloudProfile,
} from '../../decisions/cloudSync';
import { grantChapterHeroes } from '../../decisions/heroRecruits';
import { grantTokenHeroes } from '../../decisions/heroTokens';
import {
  LOCAL_SEAL,
  SECTOR_ZERO_SHADOW_KEY,
  cloudSeal,
  pickLocalProfile,
  sealProgress,
  wholeCloud,
  type LocalProfile,
} from '../../decisions/profileSeal';
import { shownObjectives } from '../../decisions/missionObjectives';
import { retireDoneEncounters } from '../../decisions/retiredEncounters';
import { metaUnlocks } from '../../decisions/runAnalytics';
import type { RunDifficulty } from '../../decisions/runDifficulty';
import type { RunSaveStore } from '../../decisions/runSave';
import {
  SECTOR_ZERO_PROGRESS_KEY,
  changeSectorZeroProgress,
  freshSectorZeroProgress,
  parseSectorZeroProgress,
  type SectorProgressAction,
  type SectorZeroProgress,
} from '../../decisions/sectorZeroProgress';
import { TAB_OWNER_KEY, tabSuperseded } from '../../decisions/tabLock';
import { detach } from './detach';
import { data } from './game';
import { getPlatform } from './platform/host';
import { readRaw, writeRaw } from './prefs';
import { localRunSaveStore, PORTABLE_RUN_KEY, RUN_SAVE_KEY } from './runSaveLocal';
import type { SectorZeroAccount } from './sectorZeroMenu';

/** Что профилю нужно от игры. Забег и экраны живут в `main.ts`. */
export interface SectorProfileHost {
  /** Строка ленты: к игроку пришёл герой, принят облачный профиль. */
  note(text: string): void;
  /** Текущая запись журнала забега: облако отправляет и принимает профиль только после неё. */
  runWritten(): Promise<void>;
  /** Профиль сменился под вкладкой (облако, перехват) — забег прежнего профиля, стоящий на
   *  паузе в этой вкладке, перестаёт быть забегом. */
  stopRun(): void;
  /** …и хранимый для «Продолжить» забег прежнего профиля забывается: меню перечитает журнал. */
  forgetRun(): void;
  /** Вкладка показывает Sector Zero: меню или идущий забег. */
  shown(): boolean;
  /** Вкладку вытеснили — мир встаёт. */
  pause(): void;
  /** Хранилище браузера перестало принимать записи (`true`) или снова принимает (`false`):
   *  игрок должен знать, что прогресс не переживёт закрытия вкладки (PT-07). */
  saveFailing(failing: boolean): void;
}

let game: SectorProfileHost;

/**
 * Сохранение забега (PVR-0.3).
 *
 * Бэкенд подставляется ЗДЕСЬ и только здесь: забег о нём не знает, он знает интерфейс
 * `RunSaveStore`. В релизной сборке площадки сюда встанет облачное хранилище, и код
 * ниже не изменится — в этом и была цена асинхронного интерфейса.
 */
/**
 * Одна вкладка — один писатель Sector Zero (`AUD-29`, `decisions/tabLock.ts`). Две вкладки
 * одной игры держали по копии профиля в памяти и молча затирали записи друг друга, а
 * облако этого не видело: имя устройства и номера правок у них общие. Хозяйка — вкладка,
 * последней открывшая Sector Zero (`claimSectorZero`); профиль, журнал забега, отметку и
 * облако пишет только она, и спрашивает об этом хранилище в момент записи.
 */
const TAB_ID =
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
function ownsSectorZero(): boolean {
  return !tabSuperseded(TAB_ID, readRaw(TAB_OWNER_KEY));
}
/** Последняя запись в хранилище не прошла. Хозяин экрана узнаёт только о смене исхода:
 *  запись идёт каждые несколько секунд, и сообщать о каждой незачем. */
let writeFailing = false;
function noteWrite(ok: boolean): void {
  if (writeFailing === !ok) return;
  writeFailing = !ok;
  // До `initSectorProfile` записей нет, а исход, пойманный раньше, хозяин получит там.
  game?.saveFailing(writeFailing);
}
export const runSaveStore: RunSaveStore = localRunSaveStore(RUN_SAVE_KEY, ownsSectorZero, noteWrite);
// Дескриптор забега (`YAG-2.1`) — рядом с полным снимком. Снимок точнее, дескриптор живучее:
// шесть полей переживают смену формы мира после обновления игры, блоб — нет.
export const portableRunStore: RunSaveStore = localRunSaveStore(PORTABLE_RUN_KEY, ownsSectorZero, noteWrite);
const sectorProgressStore = localRunSaveStore(SECTOR_ZERO_PROGRESS_KEY, ownsSectorZero, noteWrite);
// Теневая копия профиля (`YAG-4.4`) — последний целый профиль: правленый руками основной
// игра не берёт, а берёт её.
const sectorShadowStore = localRunSaveStore(SECTOR_ZERO_SHADOW_KEY, ownsSectorZero, noteWrite);
// Сид профиля Sector Zero — постоянная часть ключа броска Мастерской (SZE-0.3).
// Случайность живёт ЗДЕСЬ, а не в `decisions/`: те обязаны оставаться чистыми. Родится
// он один раз — у сохранённого профиля свой сид, и разбор его сохраняет.
const sectorSeed = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}`;
export let sectorProgress = freshSectorZeroProgress(data, sectorSeed);
/** Очередь записей профиля. Меню и забег её дожидаются; цепляет к ней только этот модуль
 *  (чужой записи хватает {@link profileWaitsFor}). Старт ставит {@link initSectorProfile}. */
export let progressWrite: Promise<void> = Promise.resolve();

/**
 * Поднять профиль: прочитать его по правилу печати, сверить с облаком и слушать перехват
 * вкладки. Зовётся один раз, когда игра готова отвечать хукам.
 */
export function initSectorProfile(hooks: SectorProfileHost): void {
  game = hooks;
  if (writeFailing) game.saveFailing(true);
  progressWrite = loadSectorProfile().then((pick) => {
    sectorProgress = parseSectorZeroProgress(pick.raw, data, sectorSeed);
    // Профиль с главами, выигранными до наград-героев, и с уже засчитанными спасениями
    // догоняет их при чтении (heroRecruits §3, §4).
    const granted = grantChapterHeroes(sectorProgress, sectorChapterIds(), data, pveRescues());
    // Запись и тогда, когда печать велит: подделка стирается, старый профиль запечатывается.
    if (granted.progress === sectorProgress && !pick.rewrite) return;
    sectorProgress = granted.progress;
    return writeSectorProgress(sealProgress(granted.progress, LOCAL_SEAL));
  });
  progressWrite = progressWrite.then(syncCloud).catch(cloudSyncFailed);
  addEventListener('storage', (event) => {
    if (event.key === TAB_OWNER_KEY) checkTabOwner();
  });
  // Вкладка из кэша «назад/вперёд» событий `storage` не слышала — сверяется на возврате.
  addEventListener('pageshow', checkTabOwner);
}

/**
 * Профиль из хранилища по правилу печати (`YAG-4.4`, `pickLocalProfile`): целый основной,
 * иначе теневая копия, иначе профиль старой версии — один раз. Флаг «уже запечатывало»
 * лежит в отметке сверки облака (ниже по файлу).
 */
async function loadSectorProfile(): Promise<LocalProfile> {
  const main = await sectorProgressStore.load();
  const shadow = await sectorShadowStore.load();
  const pick = pickLocalProfile(main, shadow, syncMark.sealed === true);
  // Правка руками не прощается молча: причина — в журнал, а игроку ничего (наказаний нет).
  if (pick.from === 'shadow' || (pick.from === 'none' && main))
    console.warn('E_PROFILE_SEAL', pick.from);
  return pick;
}

/**
 * Запечатанный профиль (`sealProgress`) — в основную копию и сразу в теневую. Флаг «уже
 * запечатывало» встаёт, только когда запись правда легла. Иначе переполненное хранилище
 * оставило бы рядом с флагом старый профиль без печати, и следующий старт принял бы
 * честный профиль за правленый.
 */
async function writeSectorProgress(blob: string): Promise<void> {
  await sectorProgressStore.save(blob);
  await sectorShadowStore.save(blob);
  if (syncMark.sealed || (await sectorProgressStore.load()) !== blob) return;
  syncMark = { ...syncMark, sealed: true };
  writeSyncMark();
}

/** Id глав по номерам — для правила «герой за главу» (`heroRecruits.ts`). */
export function sectorChapterIds(): string[] {
  return Array.from({ length: PVE_MISSION_COUNT }, (_, i) => pveChapter(i).id);
}

/** Задачи главы, видимые в забеге по текущему профилю (PVR-5.3). Профиль меняется только
 *  засчётом, поэтому набор стоит неизменным весь забег. */
export function chapterShown(mission: number) {
  const chapter = pveChapter(mission);
  return shownObjectives(
    chapter.objectives,
    sectorProgress.objectivesDone[chapter.id] ?? [],
    chapter.slots,
  );
}

/** Мир главы на старт забега: карта минус встречи, чьи задачи уже закрыты в профиле
 *  (`retiredEncounters.ts`) — взятое логово пиратов не встаёт заново. Старт — под
 *  сложность забега (PVR-6.32): новая попытка и восстановленная получают одну карту. */
export function chapterWorld(mission: number, difficulty: RunDifficulty): GameState {
  const chapter = pveChapter(mission);
  return retireDoneEncounters(
    pveState(data, mission, difficulty),
    chapter.objectives,
    sectorProgress.objectivesDone[chapter.id] ?? [],
  );
}

/** Задачи главы, что откроются позже: запас минус видимые и выполненные. */
export function chapterLater(mission: number) {
  const chapter = pveChapter(mission);
  const shown = new Set(chapterShown(mission).map((o) => o.id));
  const done = new Set(sectorProgress.objectivesDone[chapter.id] ?? []);
  return chapter.objectives.filter((o) => !shown.has(o.id) && !done.has(o.id));
}

export function saveSectorProgress(next: SectorZeroProgress): void {
  // Победа в главе приводит её героя (решение владельца 2026-09-23), спасение задачей главы —
  // спасённого (баг-репорт 2026-09-27) — на любом пути засчёта.
  const granted = grantChapterHeroes(next, sectorChapterIds(), data, pveRescues());
  // Герой, для которого набралось 10 жетонов (`heroTokens.ts`), — тоже на любом пути:
  // жетоны приходят и с итогов забега, и из магазина.
  const byTokens = grantTokenHeroes(granted.progress, data);
  next = byTokens.progress;
  for (const id of [...granted.joined, ...byTokens.joined])
    game.note(t('sector-zero.hero.joined', { name: tData(data.heroes[id]?.name ?? id) }));
  // Что открыла эта запись (`YAG-5.1`). Облако и загрузка кладут профиль мимо этой функции,
  // поэтому принесённое с другого устройства за открытие здесь не считается.
  for (const unlock of metaUnlocks(sectorProgress, next))
    getPlatform().analytics.emit('meta_unlock', unlock);
  sectorProgress = next;
  const blob = sealProgress(next, LOCAL_SEAL);
  progressWrite = progressWrite.then(() => writeSectorProgress(blob));
  bumpCloudRev();
}

/** Действие игрока над профилем Sector Zero; `false` — действие не прошло правила. */
export function changeSectorProgress(action: SectorProgressAction): boolean {
  const next = changeSectorZeroProgress(sectorProgress, action, data);
  if (!next) return false;
  saveSectorProgress(next);
  return true;
}

/** Следующая запись профиля ляжет только после `write`. Так награда за забег пишется после
 *  его журнала: закройся страница между ними, меню засчитает тот же забег ровно один раз. */
export function profileWaitsFor(write: Promise<void>): void {
  progressWrite = progressWrite.then(() => write);
}

// --- облачный сейв профиля (YAG-2.2) ------------------------------------------
// Облако есть только у ВОШЕДШЕГО игрока; гость живёт локально (`YAG-1.4`). Источник
// прогресса — по-прежнему локальное хранилище, облако — его копия, которая переезжает
// между устройствами. Что делать на старте, решает `decisions/cloudSync.ts`; здесь только
// проводка: сверка на старте, номер правки на каждое сохранение, запись по событию.
const CLOUD_MARK_KEY = 'sector-zero.cloud.v1';
/** Сколько ждать сверку с облаком на старте — ВСЮ: и вопрос «кто играет», и чтение облака
 *  (AUD-33; раньше срок стоял только на чтении, и молчащий `getPlayer` запирал меню
 *  навсегда). Не ответило — в этой сессии облака нет: писать поверх того, чего мы не
 *  видели, нельзя, а держать меню дольше незачем. */
const CLOUD_LOAD_TIMEOUT_MS = 4000;
let syncMark = parseSyncMark(readRaw(CLOUD_MARK_KEY));
// Имя устройства для родословной профиля (`cloudSync.ts`): случайное, выдаётся один раз и
// живёт в отметке. Решения случайности не держат — её даёт хост.
if (!syncMark.device)
  syncMark = {
    ...syncMark,
    device:
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  };
/** `off` — облака нет; `guest` — облако у площадки есть, а игрок не вошёл (кнопка «Войти»);
 *  `on` — сверено, пишем; `held` — прогресс разошёлся с облачным, и до выбора игрока
 *  облако не трогаем (экран выбора в меню, `YAG-1.4`). */
let cloudState: 'off' | 'guest' | 'on' | 'held' = 'off';
/** Id вошедшего игрока площадки — привязка печати облачной копии (`YAG-4.4`, `cloudSeal`).
 *  Ставит сверка до того, как облако станет `on`, — раньше в облако никто не пишет. */
let cloudPlayer = '';
/** Облачный профиль на развилке — ждёт выбора игрока (`held`). */
let cloudFork: { cloud: CloudProfile; progress: SectorZeroProgress } | null = null;
let cloudWrite: Promise<void> = Promise.resolve();
let lastCloudEnvelope = '';
let lastCloudFlushed = '';
let lastPortableRaw: string | null = null;
/** Мир забега, последним поставленный в облако, и когда (AUD-24). */
let lastCloudRunBlob: string | null = null;
let cloudRunAt = 0;
/**
 * Как часто мир идущего забега уходит в облако (AUD-24). Реже локального автосейва: снимок
 * главы — до 36 КБ, и в окно писателя (раз в 6 с) это ~12 МБ трафика за главу на телефоне,
 * а раз в 30 с — ~2 МБ. Цена — другое устройство может получить мир давностью до 30 секунд
 * реального времени: откат на полминуты, а не пересборка главы с карты. Уход со страницы
 * и выход площадки отправляют последний мир сразу (`pushCloud(true)`).
 */
const CLOUD_RUN_EVERY_MS = 30_000;

function writeSyncMark(): void {
  if (ownsSectorZero()) writeRaw(CLOUD_MARK_KEY, JSON.stringify(syncMark));
}
/** Профиль или дескриптор забега изменился — новая правка, и облако её получит. */
function bumpCloudRev(): void {
  syncMark = bumpMark(syncMark);
  writeSyncMark();
  pushCloud();
}
/**
 * Забег записал свой журнал (`portable` — дескриптор, `blob` — полный снимок) и отдаёт его
 * облаку. Дескриптор — часть облачного профиля: сменился (волна, усиление) — новая правка.
 * Мир забега (AUD-24) — тоже, но не чаще `CLOUD_RUN_EVERY_MS` и только изменившийся: на
 * паузе облако не пишется.
 */
export function offerRunToCloud(portable: string, blob: string): void {
  const now = performance.now();
  const worldDue = blob !== lastCloudRunBlob && now - cloudRunAt >= CLOUD_RUN_EVERY_MS;
  if (portable !== lastPortableRaw || worldDue) {
    lastPortableRaw = portable;
    lastCloudRunBlob = blob;
    cloudRunAt = now;
    bumpCloudRev();
  }
}
/** Отправить текущий профиль в облако. Частоту держит адаптер (квота), здесь — только
 *  «есть ли что отправлять». `flush` — страница уходит: сразу, а не в окно квоты. */
export function pushCloud(flush = false): void {
  cloudWrite = cloudWrite.then(async () => {
    // Облако пишет та же вкладка, что и хранилище (AUD-29): копия вытесненной отстаёт.
    if (cloudState !== 'on' || !ownsSectorZero()) return;
    await progressWrite;
    await game.runWritten();
    const run = await portableRunStore.load();
    // AUD-24: вместе с дескриптором едет ТОЧНЫЙ мир забега. Без него другое устройство
    // пересобирало мир с карты главы, и «Продолжить» там стирало поражение. Не влез в
    // лимит площадки — уходит без мира, профиль всё равно доезжает (`cloudEnvelope`).
    const state = await runSaveStore.load();
    const platform = getPlatform();
    const envelope = cloudEnvelope(
      {
        v: 1,
        seed: sectorProgress.seed,
        rev: syncMark.rev,
        // Облачная копия запечатана для этого игрока (`YAG-4.4`): чужое облако её не примет.
        progress: sealProgress(sectorProgress, cloudSeal(cloudPlayer)),
        ...(run ? { run } : {}),
        ...(state ? { state } : {}),
        ...(syncMark.lineage ? { lineage: syncMark.lineage } : {}),
      },
      (candidate) => platform.save.fits?.(candidate) ?? true,
    );
    if (envelope === (flush ? lastCloudFlushed : lastCloudEnvelope)) return;
    lastCloudEnvelope = envelope;
    if (flush) lastCloudFlushed = envelope;
    // Отмечаем сверку сразу: не дойди запись — облако окажется ПОЗАДИ отметки, и
    // следующий старт отправит профиль снова (`planCloudSync`, «наша запись не дошла»).
    syncMark = { ...syncMark, syncedRev: syncMark.rev };
    writeSyncMark();
    detach('облако: запись профиля', getPlatform().save.save(envelope, { flush }));
  });
}
/** Сверка на старте. Цепляется к записи профиля — меню ждёт её и сразу показывает
 *  правильный прогресс. Любой сбой — «облака в этой сессии нет», а не сломанное меню. */
async function syncCloud(): Promise<void> {
  const host = getPlatform();
  if (!host.capabilities.cloudSave) return;
  const late = new Promise<undefined>((resolve) => setTimeout(resolve, CLOUD_LOAD_TIMEOUT_MS));
  const player = await Promise.race([host.auth.player(), late]);
  if (!player) return;
  if (!player.authenticated) {
    cloudState = 'guest';
    return;
  }
  cloudPlayer = player.id;
  const raw = await Promise.race([host.save.load(), late]);
  if (raw === undefined) return;
  // Замок 3 (`YAG-4.4`): облачная копия без целой печати ЭТОГО игрока — как «облака нет»,
  // и сверка отправит туда целый локальный профиль.
  const found = parseCloudProfile(raw);
  const cloud = wholeCloud(found, player.id);
  if (found && !cloud) console.warn('E_PROFILE_SEAL', 'cloud');
  const cloudProgress = cloud ? parseSectorZeroProgress(cloud.progress, data, cloud.seed) : null;
  const plan = planCloudSync(
    {
      seed: sectorProgress.seed,
      rev: syncMark.rev,
      syncedRev: syncMark.syncedRev,
      hasProgress: profileHasProgress(sectorProgress),
      ...(syncMark.lineage ? { lineage: syncMark.lineage } : {}),
    },
    cloud,
    cloudProgress ? profileHasProgress(cloudProgress) : false,
  );
  if (plan === 'choose' && cloud && cloudProgress) {
    cloudState = 'held';
    cloudFork = { cloud, progress: cloudProgress };
    return;
  }
  if (plan === 'adopt' && cloud && cloudProgress) {
    await adoptCloud(cloud, cloudProgress);
    game.note(t('sector-zero.cloud.adopted'));
    return;
  }
  cloudState = 'on';
  if (plan === 'upload') pushCloud();
}
/** Облачный профиль становится единственным: молча на старте или выбором на развилке. */
async function adoptCloud(cloud: CloudProfile, cloudProgress: SectorZeroProgress): Promise<void> {
  await game.runWritten();
  // Забег, стоящий на паузе в этой вкладке, принадлежит прежнему профилю — выбор на
  // развилке делается и после него. Меню иначе предложило бы «Продолжить» его и засчитало
  // бы облачному профилю чужой забег.
  game.stopRun();
  sectorProgress = grantChapterHeroes(
    cloudProgress,
    sectorChapterIds(),
    data,
    pveRescues(),
  ).progress;
  await writeSectorProgress(sealProgress(sectorProgress, LOCAL_SEAL));
  // Снимок забега принадлежит прежнему профилю — забег продолжается по облачному: ТОЧНЫМ
  // миром, если облако его привезло (AUD-24), иначе по дескриптору (или его нет вовсе).
  // Именно мир, а не дескриптор: пересборка по дескриптору начинает мир с карты главы, и
  // вход с другого устройства превращался в бесплатную перемотку поражения.
  await runSaveStore.clear();
  if (cloud.state) await runSaveStore.save(cloud.state);
  if (cloud.run) await portableRunStore.save(cloud.run);
  else await portableRunStore.clear();
  game.forgetRun();
  syncMark = adoptMark(syncMark, cloud);
  writeSyncMark();
  cloudFork = null;
  cloudState = 'on';
}
const cloudSyncFailed = (error: unknown): void => {
  console.error('E_CLOUD_SYNC', error);
};

/** Меню: вход площадки и развилка профилей (`YAG-1.4`). Вход — только по нажатию игрока
 *  (требование 1.2.1), и польза названа рядом с кнопкой ДО окна. */
export const sectorZeroAccount: SectorZeroAccount = {
  canSignIn: () => cloudState === 'guest' && getPlatform().auth.canSignIn,
  async signIn() {
    // Отказ — не ошибка: кнопка остаётся, игрок продолжает гостем.
    if ((await getPlatform().auth.signIn()).status !== 'ok') return;
    progressWrite = progressWrite.then(syncCloud).catch(cloudSyncFailed);
    await progressWrite;
  },
  fork: () =>
    cloudFork
      ? { here: profileNumbers(sectorProgress), cloud: profileNumbers(cloudFork.progress) }
      : null,
  async choose(pick) {
    const fork = cloudFork;
    if (!fork) return;
    if (pick === 'cloud') {
      progressWrite = progressWrite
        .then(() => adoptCloud(fork.cloud, fork.progress))
        .catch(cloudSyncFailed);
      await progressWrite;
      return;
    }
    // «Оставить этот»: облако получит локальный профиль с номером ВПЕРЕДИ облачного
    // (`keepLocalMark` — почему именно так).
    syncMark = keepLocalMark(syncMark, fork.cloud);
    writeSyncMark();
    cloudFork = null;
    cloudState = 'on';
    pushCloud();
  },
};

/**
 * Эта вкладка становится хозяйкой Sector Zero (AUD-29). Хозяйкой до неё была другая —
 * значит, память этой могла отстать от хранилища (вкладка хаба грузила профиль давно,
 * а другая с тех пор играла): профиль и отметка облака перечитываются, а забег в памяти
 * снимается — меню возьмёт его журнал из хранилища, где лежит самый свежий.
 */
export function claimSectorZero(): void {
  const previous = readRaw(TAB_OWNER_KEY);
  writeRaw(TAB_OWNER_KEY, TAB_ID);
  if (!tabSuperseded(TAB_ID, previous)) return;
  game.stopRun();
  game.forgetRun();
  const mark = readRaw(CLOUD_MARK_KEY);
  if (mark !== null) syncMark = parseSyncMark(mark);
  // Перечитывается тем же правилом печати, что и на старте (`YAG-4.4`): правленый за это
  // время профиль не берётся, а стирается целой копией.
  progressWrite = progressWrite.then(loadSectorProfile).then(async (pick) => {
    if (!pick.raw) return;
    sectorProgress = parseSectorZeroProgress(pick.raw, data, sectorSeed);
    if (pick.rewrite) await writeSectorProgress(sealProgress(sectorProgress, LOCAL_SEAL));
  });
}

/** Sector Zero перехватила другая вкладка, а эта его показывает: мир встаёт, экран
 *  закрывается заставкой. «Играть здесь» перезагружает вкладку — та перехватит его обратно
 *  и прочтёт свежее хранилище, а не свою отставшую память. */
let tabTaken: HTMLElement | null = null;
function checkTabOwner(): void {
  if (ownsSectorZero() || !game.shown()) return;
  game.pause();
  if (tabTaken) return;
  tabTaken = document.createElement('div');
  tabTaken.id = 'tab-taken';
  tabTaken.setAttribute('role', 'alertdialog');
  const title = document.createElement('h1');
  title.textContent = t('sector-zero.tab-taken.title');
  const text = document.createElement('p');
  text.textContent = t('sector-zero.tab-taken.text');
  const here = document.createElement('button');
  here.type = 'button';
  here.textContent = t('sector-zero.tab-taken.here');
  here.addEventListener('click', () => location.reload());
  tabTaken.append(title, text, here);
  document.body.append(tabTaken);
  here.focus({ preventScroll: true });
}
