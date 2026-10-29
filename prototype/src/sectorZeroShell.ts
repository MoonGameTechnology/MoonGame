/**
 * Оболочка Sector Zero (REFM-211): меню и подготовка, кошелёк в шапке забега, сутки магазина,
 * ролики площадки, комиксы глав, награда героем и вход {@link openSectorZero}.
 *
 * Всё это жило в `main.ts` проводкой поверх профиля (`sectorProfile.ts`) и забега
 * (`sectorRun.ts`); теперь оба владельца уже есть, и оболочка берёт их напрямую. Из
 * `main.ts` ей нужно только то, что принадлежит ему самому: мир на экране, виджеты комиксов,
 * запуск партии, выход из прежнего мира и экраны хаба — это хуки {@link initSectorZeroShell}.
 *
 * Меню, подготовка и кошелёк — `export let`, их создаёт инициализация, а `main.ts` читает их
 * как прежде. Остальное — функции модуля, и они доступны с момента импорта: экран итогов
 * получает {@link watchAd} раньше, чем поднимается оболочка.
 *
 * Площадку модуль берёт через `getPlatform()` в момент вызова или инициализации, а не при
 * импорте: дев-сборка и смоуки ставят её телом `main.ts`, уже после импорта модуля.
 */
import { LOCALE, t, tData } from '../../localization/runtime';
import {
  PVE_MISSION_COUNT,
  pveChapter,
  pveModeId,
  pveState,
} from '../../packages/client/src/gameData';
import type { GameState } from '../../packages/shared-core/src/index';
import { abandonPromise, fleetLostPrompt, shipCount } from '../../decisions/fleetLost';
import type { AdOutcome, AdPlacement } from '../../decisions/adPlacements';
import type { ChapterStep } from '../../decisions/chapterChain';
import {
  comicDue,
  comicId,
  comicsTriggered,
  echoComicMoment,
  markComicSeen,
  storyFacts,
  type ComicMoment,
  type ComicRegistry,
} from '../../decisions/chapterComics';
import { chapterMapView, chapterTargets } from '../../decisions/chapterMap';
import { CHAPTER_KEYS } from '../../decisions/chapterRoute';
import { albumEpisode, comicAlbum } from '../../decisions/comicAlbum';
import { chapterHero } from '../../decisions/heroRecruits';
import { missionBriefs, type MissionRow } from '../../decisions/missionView';
import {
  adSovereigns,
  advanceShopDay,
  localShopDay,
  shopCapabilities,
} from '../../decisions/sectorZeroShop';
import {
  abandonRunReward,
  REPAIR_HP_PER_SOVEREIGN,
  WARRANTS_PER_REWARD,
} from '../../decisions/sectorZeroProgress';
import {
  SECTOR_ZERO_ABSENT_HUD,
  SECTOR_ZERO_ABSENT_TOOLS,
  SECTOR_ZERO_ABSENT_TWINS,
  type SessionTool,
  toolShown,
} from '../../decisions/sectorZeroTools';
import { swarmCatalog, swarmCodexView } from '../../decisions/swarmCodex';
import { swarmLoreKnown } from '../../decisions/swarmLore';
import { COMIC_TRIGGERS } from './comicArt';
import type { ComicPlayer } from './comicPlayer';
import type { createComicQueue } from './comicQueue';
import { detach } from './detach';
import { recordSectorZeroEntry } from './connectScreen';
import { displayUnit } from './format';
import { abandonRun, data } from './game';
import { playerOrder } from './orderPipeline';
import { getPlatform } from './platform/host';
import { initRunWallet } from './runWallet';
import {
  changeSectorProgress,
  chapterLater,
  chapterShown,
  claimSectorZero,
  saveSectorProgress,
  sectorChapterIds,
  sectorProgress,
  sectorZeroAccount,
} from './sectorProfile';
import {
  chapterForSettle,
  chooseDifficulty,
  chooseMission,
  isSectorZeroRun,
  isTraining,
  loadSavedRun,
  nextSectorDifficulty,
  nextSectorMission,
  resetSectorZero,
  restoreRun,
  runInProgress,
  sectorDevActive,
  sectorMission,
  sectorZeroToolsHidden,
} from './sectorRun';
import { initSectorZeroMenu } from './sectorZeroMenu';
import { initSectorZeroPreparation } from './sectorZeroPreparation';

/** Что оболочке нужно от игры. Мир, виджеты комиксов, партии и экраны живут в `main.ts`. */
export interface SectorZeroShellHost {
  /** Корень меню Sector Zero. */
  menuRoot: HTMLElement;
  /** Корень кошелька в шапке забега. */
  walletRoot: HTMLElement;
  /** Идёт забег Sector Zero — для интерфейса: кошелёк в шапке есть только в нём. */
  runOnScreen(): boolean;
  /** Мир на экране и место игрока в нём — для комиксов по событиям. */
  world(): GameState;
  me(): string;
  /** Виджеты комиксов: плеер, очередь показа и реестр арта (робот подкладывает свой). */
  comics: {
    player: ComicPlayer;
    queue: ReturnType<typeof createComicQueue>;
    art: { registry: ComicRegistry };
  };
  /** Новая попытка главы — уже после её комикса. */
  startRun(): void;
  /** Дев-забег без профиля; нет — в сборке для игроков. */
  startDev?: () => void;
  /** Учебный полигон — уже после его комикса. */
  startTraining(): void;
  /** Уйти из прежнего мира: сохранить схватку, выйти через дверь партии, забыть вход по ссылке. */
  leaveWorld(): void;
  /** Закрыть экраны, через которые сюда пришли, и слои карты. */
  closeScreens(): void;
  /** «Назад» из меню — в хаб. */
  back(): void;
  openSettings(): void;
  note(text: string): void;
  /** На экране партия, а не меню: кнопка «Завершить» живёт только в идущем забеге. */
  inMatch(): boolean;
}

let game: SectorZeroShellHost;

export let sectorPreparation: ReturnType<typeof initSectorZeroPreparation>;
export let runWallet: ReturnType<typeof initRunWallet>;
export let sectorZeroMenu: ReturnType<typeof initSectorZeroMenu>;

// Витрина магазина ротируется посуточно (`SZE-3.2`). Единственные часы у офлайнового
// клиента — часы игрока, поэтому номер дня МОНОТОНЕН: `advanceShopDay` никогда его не
// уменьшает. Часы назад не откатывают витрину, часы вперёд двигают её навсегда и сжигают
// промотанные дни вместе с товаром — накрутка наказывает сама себя.
export function syncShopDay(): void {
  const next = advanceShopDay(sectorProgress, localShopDay(Date.now()));
  if (next !== sectorProgress) saveSectorProgress(next);
}

/** Дверь к ролику площадки (`YAG-3.2`) — единственный вызов `showRewardedAd` в игре. Её
 *  получают все экраны с рекламой — подготовка, итоги забега и кошелёк, — и все зовут её
 *  только по нажатию (`platform/adPlacementGuard.test.ts`). */
export async function watchAd(
  placement: AdPlacement,
  props?: Record<string, string>,
): Promise<AdOutcome> {
  const platform = getPlatform();
  platform.analytics.emit('rewarded_ad_offered', { placement, ...props });
  const shown = await platform.ads.showRewardedAd({ placement });
  if (shown.status === 'ok')
    platform.analytics.emit('rewarded_ad_completed', { placement, ...props });
  return shown.status;
}

/** Поднять оболочку: подготовку, кошелёк и меню. Зовётся один раз, когда игра готова отвечать
 *  хукам, — площадка к этому времени уже выбрана. */
export function initSectorZeroShell(hooks: SectorZeroShellHost): void {
  game = hooks;
  const platform = getPlatform();
  abandonCard = $('abandon');
  railAbandon = $('rail-abandon');
  railAbandon.addEventListener('click', () => openAbandon('ask', railAbandon));
  $('abandon-stay').addEventListener('click', closeAbandon);
  // «В меню» — тот же выход, что ⌂ вне экспедиции: забег сохраняется, продолжить можно позже.
  // Программный `.click()` не доверенный, поэтому ⌂ не спросит второй раз.
  $('abandon-menu').addEventListener('click', () => {
    closeAbandon();
    $('tomenu').click();
  });
  $('abandon-go').addEventListener('click', () => {
    closeAbandon();
    if (runInProgress()) playerOrder(abandonRun(game.me()));
  });

  sectorPreparation = initSectorZeroPreparation({
    data,
    // Решения UI принимаются по capability, а не по имени площадки (`platform-adapters.md`).
    // Суверены тратятся там, где у них есть кран — покупка ИЛИ ролик (`SZE-3.5`).
    platform: shopCapabilities(platform.capabilities),
    sync: syncShopDay,
    watchAd,
    progress: () => sectorProgress,
    change: changeSectorProgress,
  });

  // Кошелёк профиля в шапке забега и «+» у Суверенов (`run.sovereigns`, решение владельца
  // 2026-09-24): тот же кран, что кнопка магазина — одна порция, один дневной лимит. Сутки
  // сверяются до предложения, иначе вчерашний исчерпанный лимит прятал бы «+» до выхода в меню.
  runWallet = initRunWallet({
    root: game.walletRoot,
    wallet: () => (game.runOnScreen() ? sectorProgress : null),
    offer: () => {
      syncShopDay();
      const ad = adSovereigns(sectorProgress, data, shopCapabilities(platform.capabilities));
      return ad.state === 'ready' ? { amount: ad.amount, left: ad.left } : null;
    },
    // Числа описаний валют — из тех же правил, по которым профиль платит и списывает.
    rules: () => ({
      warrantsPerReward: WARRANTS_PER_REWARD,
      repairHp: REPAIR_HP_PER_SOVEREIGN,
      supplyPrice: data.sectorZeroShop.runSupply.price,
      adAmount: data.sectorZeroShop.adSovereigns.amount,
      adPerDay: data.sectorZeroShop.adSovereigns.perDay,
    }),
    watchAd,
    apply: () => changeSectorProgress({ kind: 'ad-sovereigns' }),
    note: (text) => game.note(text),
  });

  sectorZeroMenu = initSectorZeroMenu({
    root: game.menuRoot,
    standalone: document.body.dataset.entry === 'sector-zero',
    preparation: sectorPreparation,
    account: sectorZeroAccount,
    // Карточка «Продолжить» — хранимый забег у его владельца (`sectorRun.ts`, REFM-210).
    load: loadSavedRun,
    difficulty: () => nextSectorDifficulty,
    setDifficulty: chooseDifficulty,
    mission: () => nextSectorMission,
    chapters: PVE_MISSION_COUNT,
    chapterInfo: (index) => ({
      waves: data.modes[pveModeId(index) ?? '']?.pve?.waves ?? 0,
      tasks: chapterShown(index).length,
      pool: pveChapter(index).objectives.length,
      cleared: sectorProgress.chaptersWon.includes(pveChapter(index).id),
      ...heroReward(index),
      briefs: missionBriefs(chapterShown(index), pveChapter(index).slots?.base),
      // Остаток запаса — подписи меток «позже» на карте главы (их награду не показываем:
      // номинал считается от набора, который будет виден, когда задача откроется).
      laterBriefs: missionBriefs(chapterLater(index), pveChapter(index).slots?.base),
    }),
    // Карта главы: мир на старте главы + память тумана прошлых забегов из профиля.
    chapterMap: (index) => {
      const chapter = pveChapter(index);
      const start = pveState(data, index);
      const scouted = sectorProgress.chapterScouted[chapter.id] ?? [];
      // Цели задач: активные — видимые в следующем забеге, «позже» — остаток запаса главы;
      // выполненные закрыты навсегда и на карту не зовут (`chapterTargets`).
      const done = new Set(sectorProgress.objectivesDone[chapter.id] ?? []);
      const known = new Set([
        ...scouted,
        ...Object.values(start.planets)
          .filter((p) => p.owner === 'p1')
          .map((p) => p.id),
      ]);
      return chapterMapView(
        start,
        scouted,
        'p1',
        chapterTargets(
          start,
          chapter.objectives.filter((o) => !done.has(o.id)),
          new Set(chapterShown(index).map((o) => o.id)),
          known,
        ),
      );
    },
    // Досье Роя (заказ владельца 2026-09-24): память профиля против каталога игры.
    swarmCodex: () => {
      const view = swarmCodexView(
        sectorProgress.swarmCodex,
        swarmCatalog(
          data,
          sectorChapterIds().map((_, i) => pveState(data, i)),
        ),
        data,
      );
      return {
        lore: swarmLoreKnown(sectorProgress, true),
        known: view.known,
        total: view.total,
        units: view.units.map((u) => {
          const def = data.units[u.id]!;
          return {
            name: displayUnit(u.id),
            known: u.known,
            max: u.max,
            runs: u.runs,
            stats: {
              attack: def.stats.attack ?? 0,
              defense: def.stats.defense ?? 0,
              hp: def.stats.hp ?? 0,
              speed: def.stats.speed ?? 0,
            },
          };
        }),
        modules: view.modules.map((m) => {
          const def = data.modules[m.id]!;
          return {
            name: tData(def.name),
            desc: def.description ? t(def.description) : '',
            known: m.known,
            evidence: m.evidence,
            n: m.n,
          };
        }),
        buildings: view.buildings.map((b) => ({
          name: tData(data.buildings[b.id]?.name ?? b.id),
          known: b.known,
        })),
      };
    },
    comicAlbum: () => {
      const view = sectorComicAlbum();
      return {
        open: view.open,
        total: view.total,
        chapters: view.chapters.map((c) => {
          const index = sectorChapterIds().indexOf(c.chapter);
          const key = CHAPTER_KEYS[index]?.name;
          return {
            title:
              c.chapter === 'training-1' ? t('sector-zero.training') : key ? t(key) : c.chapter,
            episodes: c.episodes.map((e) => ({
              id: e.id,
              open: e.open,
              cover: e.open ? albumImage(e.panels[0]!) : '',
              pages: e.panels.length,
            })),
          };
        }),
      };
    },
    playAlbum: (id) => {
      const panels = albumEpisode(sectorComicAlbum(), id);
      return panels ? game.comics.player.play(panels, 'album') : Promise.resolve();
    },
    setMission: chooseMission,
    start: () => launchSectorRun(),
    startTraining: () => playChapterComic('training-1', 'intro', () => game.startTraining()),
    startDev: game.startDev,
    resume: restoreRun,
    // ВРЕМЕННО (заказ владельца 2026-09-27): «Начать всё заново» — `resetSectorZero`.
    resetAll: resetSectorZero,
    settings: () => game.openSettings(),
    back: () => game.back(),
  });
}

/** Альбом комиксов профиля: полигон, затем главы по маршруту (`decisions/comicAlbum.ts`). */
function sectorComicAlbum() {
  return comicAlbum(sectorProgress, game.comics.art.registry, [
    'training-1',
    ...sectorChapterIds(),
  ]);
}

/** Обложка эпизода — его первая страница в языке игрока, как её покажет проигрыватель. */
function albumImage(panel: { image: string; imageEn?: string }): string {
  return LOCALE === 'en' && panel.imageEn ? panel.imageEn : panel.image;
}

/** Герой-награда главы для карточки на маршруте: кто придёт и пришёл ли уже. */
function heroReward(index: number): { hero?: { name: string; joined: boolean } } {
  const id = chapterHero(index);
  const def = id ? data.heroes[id] : undefined;
  return id && def ? { hero: { name: tData(def.name), joined: !!sectorProgress.heroes[id] } } : {};
}

/**
 * Комикс главы, если он положен (`decisions/chapterComics.ts`), и затем `then`. Показ —
 * один раз на профиль; отметка пишется, когда игрок комикс закрыл (досмотрел или
 * пропустил), поэтому вкладка, закрытая посреди комикса, покажет его снова, а не потеряет.
 */
export function playChapterComic(chapter: string, moment: ComicMoment, then: () => void): void {
  const { player: comicPlayer, queue: comicQueue, art: comicArt } = game.comics;
  const panels = comicDue(sectorProgress, comicArt.registry, chapter, moment);
  if (!panels) {
    then();
    return;
  }
  detach(
    'Sector Zero: комикс главы',
    comicQueue.enqueue(comicId(chapter, moment), async () => {
      // Предыдущая страница могла записать ту же отметку (живая/архивная версия Эхо).
      const current = comicDue(sectorProgress, comicArt.registry, chapter, moment);
      if (current) {
        await comicPlayer.play(
          current,
          moment === 'intro' ? 'battle' : moment === 'outro' ? 'results' : 'resume',
        );
        saveSectorProgress(markComicSeen(sectorProgress, comicId(chapter, moment)));
      }
      then();
    }),
  );
}

/** Комиксы главы по событиям (`COMIC_TRIGGERS`): один раз на профиль, в тот кадр, когда
 *  триггер впервые засчитан. Триггером может быть и шаг главной цепочки главы: встреча с
 *  союзником в IV (`chain.contact`), доки и основная эвакуация в VI (`chain.docks`,
 *  `chain.evacuate`), — и факт мира (`storyFacts`): разрыв сети Роя в V (`net.cut`).
 *  Дев-забег и полигон комикс не показывают. */
export function playTaskComic(
  missions: readonly MissionRow[],
  chain: readonly ChapterStep[] | null,
): void {
  if (isTraining() || sectorDevActive || !isSectorZeroRun()) return;
  const s = game.world();
  const ME = game.me();
  const comicArt = game.comics.art;
  const chapter = pveChapter(sectorMission).id;
  const complete = [
    ...missions.filter((m) => m.complete).map((m) => m.id),
    ...(chain ?? []).filter((st) => st.done).map((st) => st.key),
    ...(sectorProgress.objectivesDone[chapter] ?? []),
    ...storyFacts(s),
  ];
  for (const moment of comicsTriggered(
    sectorProgress,
    comicArt.registry,
    COMIC_TRIGGERS,
    chapter,
    complete,
  ))
    playChapterComic(chapter, moment, () => {});
  if (chapter === 'pve-1') {
    const scientistAvailable =
      complete.includes('mission.rescue-scientist') ||
      (s.missionFacts?.recruited?.[ME] ?? []).includes('research_station') ||
      sectorProgress.chaptersWon.includes('pve-1');
    const moment = echoComicMoment(
      s,
      ME,
      scientistAvailable,
      complete.includes('mission.claim-colony'),
    );
    if (moment) playChapterComic(chapter, moment, () => {});
  }
}

/** Новая попытка главы — и меню, и «Сыграть главу снова»: сперва комикс главы (в первый
 *  раз), потом забег. Дев-забег комикс не показывает: он не пишет профиль. */
export function launchSectorRun(): void {
  playChapterComic(pveChapter(nextSectorMission).id, 'intro', () => game.startRun());
}

/** `replay` — сразу новая попытка той же главы (кнопка итогов «Сыграть главу снова»). Идёт
 *  через открытие меню: оно засчитывает и стирает закончившийся забег, и только потом
 *  стартует новый — тем же путём, что кнопка «Новый забег». */
export function openSectorZero(preparation = false, replay = false): void {
  claimSectorZero();
  recordSectorZeroEntry();
  game.leaveWorld();
  // Close the map's layers before the new screen takes over. Do not route the
  // setup's Back button through the multiplayer hub on the way here.
  sectorZeroMenu.hide();
  game.closeScreens();
  const chapter = sectorMission;
  detach(
    'Sector Zero menu',
    sectorZeroMenu.open().then(() => {
      if (preparation && sectorZeroMenu.isOpen()) sectorPreparation.open();
      if (replay && sectorZeroMenu.isOpen()) {
        chooseMission(chapter);
        sectorZeroMenu.hide();
        launchSectorRun();
      }
    }),
  );
}

/** Узел разметки по id: карточка ухода и инструменты экрана живут в статичной разметке. */
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

// «Флот потерян» / «Завершить экспедицию» (PVR-6.29, решение владельца 2026-09-25): без флота
// игрок минутами смотрел, как Рой штурмует его планету. Карточка встаёт в кадре, когда кораблей
// стало ноль (`decisions/fleetLost.ts`), и та же открывается кнопкой рельса в любой момент
// забега. «Завершить» — хостовое `pve.abandon`: поражение ставит ядро, итоги и награду считает
// обычный конец забега (`tickRunSave`). Фокус — на «остаться»: сдача необратима.
let abandonCard: HTMLElement;
let railAbandon: HTMLElement;
let abandonOpener: HTMLElement | null = null;
/** Счёт кораблей прошлого кадра забега; `null` — вне забега, чтобы вход не поднял карточку. */
let lastRunShips: number | null = null;
/** Повод карточки: флот потерян, ⚑ «Завершить» или ⌂ «Выйти» (решение владельца 2026-09-26:
 *  ⌂ в экспедиции спрашивает — в меню с сохранением или завершить и забрать награду). */
export type AbandonReason = 'lost' | 'ask' | 'exit';
const ABANDON_TEXT: Record<
  AbandonReason,
  { title: string; text: string; stay: string; go: string }
> = {
  lost: {
    title: 'run.abandon.lost.title',
    text: 'run.abandon.lost.text',
    stay: 'run.abandon.rebuild',
    go: 'run.abandon.go',
  },
  ask: {
    title: 'run.abandon.ask.title',
    text: 'run.abandon.ask.text',
    stay: 'run.abandon.back',
    go: 'run.abandon.go',
  },
  exit: {
    title: 'run.exit.title',
    text: 'run.exit.text',
    stay: 'run.abandon.back',
    go: 'run.exit.go',
  },
};
export function openAbandon(reason: AbandonReason, opener: HTMLElement | null = null): void {
  const txt = ABANDON_TEXT[reason];
  const exit = reason === 'exit';
  $('abandon-title').textContent = t(txt.title);
  // Сколько заберёт «Завершить» (решение владельца 2026-09-26) — та же формула, что засчёт
  // после сдачи. Стенд разработчика не платит (`awardSectorRun`), и обещать там нечего.
  const reward = $('abandon-reward');
  reward.hidden = sectorDevActive;
  const r = sectorDevActive
    ? { research: 0, warrants: 0 }
    : abandonRunReward(sectorProgress, game.world(), chapterForSettle(sectorMission), data);
  if (!sectorDevActive) reward.textContent = t('run.exit.reward', { n: r.research, w: r.warrants });
  // ×2 за ролик живёт на экране итогов (`run.double`); здесь о нём только говорят — и лишь
  // там, где его предложат: без рекламы или без награды обещать удвоение значило бы соврать.
  const promise = abandonPromise(r, shopCapabilities(getPlatform().capabilities).ads);
  $('abandon-text').textContent =
    exit && promise.double ? `${t(txt.text)} ${t('run.exit.double')}` : t(txt.text);
  $('abandon-stay').textContent = t(txt.stay);
  // «Завершить и забрать награду» без награды — просто «Завершить экспедицию».
  $('abandon-go').textContent = t(exit && !promise.collect ? 'run.abandon.go' : txt.go);
  $('abandon-menu').hidden = !exit;
  abandonCard.classList.toggle('exit', exit);
  abandonOpener = opener;
  abandonCard.classList.add('show');
  $('abandon-stay').focus({ preventScroll: true });
}
export function closeAbandon(): void {
  abandonCard.classList.remove('show');
  abandonOpener?.focus({ preventScroll: true });
  abandonOpener = null;
}
/** Кадровый такт карточки: кнопка рельса живёт, пока идёт забег; карточка встаёт на переходе
 *  к нулю кораблей и уходит сама, если забег кончился иначе. */
export function tickAbandon(): void {
  const live = game.inMatch() && runInProgress();
  const ships = live ? shipCount(game.world(), game.me(), data) : null;
  if (ships !== null && fleetLostPrompt(lastRunShips, ships)) openAbandon('lost');
  lastRunShips = ships;
  const shown = live ? '' : 'none';
  if (railAbandon.style.display !== shown) railAbandon.style.display = shown;
  if (!live && abandonCard.classList.contains('show')) closeAbandon();
}

/** PVR-6.1: мультиплеерных кнопок рельса в забеге Sector Zero нет — чат, почта, маркеры,
 *  корпорация, рынок, «Сон» (`decisions/sectorZeroTools.ts`). Флаг забега меняется только
 *  через `setRunActive`, поэтому синхронизацию зовёт он (хук `runChanged`) и возвращает
 *  кнопки на выходе. */
export function syncSectorZeroTools(): void {
  const run = sectorZeroToolsHidden();
  for (const [tool, id] of Object.entries(SECTOR_ZERO_ABSENT_TOOLS)) {
    const el = document.getElementById(id);
    if (el) el.style.display = toolShown(tool as SessionTool, run) ? '' : 'none';
  }
  // Эмблема с названием и местом, очки победы, день шапки и «Производство» — тоже не про
  // забег (решения владельца 2026-09-24 и 2026-09-26).
  for (const [field, id] of Object.entries(SECTOR_ZERO_ABSENT_HUD)) {
    const twin = SECTOR_ZERO_ABSENT_TWINS[field as keyof typeof SECTOR_ZERO_ABSENT_HUD];
    for (const el of [id, twin].map((x) => (x ? document.getElementById(x) : null)))
      if (el) el.style.display = run ? 'none' : '';
  }
}
