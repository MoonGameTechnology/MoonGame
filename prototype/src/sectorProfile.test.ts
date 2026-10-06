/**
 * Владелец профиля Sector Zero (REFM-209) — прямой тест поведения.
 *
 * Пока профиль жил в `main.ts`, его стык проверялся только чтением текста (`cloudSaveWiring`,
 * `profileSealWiring`, `tabLockWiring` — они остаются и смотрят в новый файл). Здесь —
 * то, что текстом не проверить: что реально легло в хранилище, когда двигается правка
 * облака, что получает площадка и какие хуки игры зовутся. Каждый тест — свежая загрузка
 * модуля над своим хранилищем, как перезагрузка страницы.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cloudEnvelope, parseCloudProfile } from '../../decisions/cloudSync';
import {
  LOCAL_SEAL,
  SECTOR_ZERO_SHADOW_KEY,
  checkSeal,
  cloudSeal,
  sealProgress,
} from '../../decisions/profileSeal';
import {
  SECTOR_ZERO_PROGRESS_KEY,
  freshSectorZeroProgress,
} from '../../decisions/sectorZeroProgress';
import { TAB_OWNER_KEY } from '../../decisions/tabLock';
import { t } from '../../localization/runtime';
import { data } from './game';
import type { GamePlatform } from './platform/types';

const CLOUD_MARK_KEY = 'sector-zero.cloud.v1';

let cell: Map<string, string>;
let listeners: Record<string, Array<(event: { key: string | null }) => void>>;

beforeEach(() => {
  cell = new Map();
  listeners = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => cell.get(k) ?? null,
    setItem: (k: string, v: string) => void cell.set(k, v),
    removeItem: (k: string) => void cell.delete(k),
  });
  vi.stubGlobal('addEventListener', (type: string, fn: (event: { key: string | null }) => void) => {
    (listeners[type] ??= []).push(fn);
  });
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Поднять модуль, как его поднимает игра, и дождаться чтения профиля и сверки. */
async function boot(platform: Partial<GamePlatform> = {}) {
  const host = await import('./platform/host');
  host.setPlatform({ ...host.getPlatform(), ...platform });
  const profile = await import('./sectorProfile');
  const game = {
    note: vi.fn(),
    runWritten: () => Promise.resolve(),
    stopRun: vi.fn(),
    forgetRun: vi.fn(),
    shown: vi.fn(() => false),
    pause: vi.fn(),
  };
  profile.initSectorProfile(game);
  await profile.progressWrite;
  return { profile, game };
}

/** Перезагрузка страницы: то же хранилище, свежий модуль. */
async function reload(platform: Partial<GamePlatform> = {}) {
  vi.resetModules();
  listeners = {};
  return boot(platform);
}

const rev = (): number => JSON.parse(cell.get(CLOUD_MARK_KEY) ?? '{"rev":0}').rev;

/** Площадка с облаком и вошедшим игроком `p-1`; `cloud` — что лежит в облаке. */
function cloudPlatform(cloud: string | null = null) {
  const saved: string[] = [];
  const platform: Partial<GamePlatform> = {
    capabilities: {
      auth: true,
      cloudSave: true,
      rewardedAds: false,
      interstitialAds: false,
      iap: false,
      analytics: false,
    },
    auth: {
      player: async () => ({ id: 'p-1', authenticated: true }),
      canSignIn: false,
      signIn: async () => ({ status: 'unavailable', player: { id: 'p-1', authenticated: true } }),
    },
    save: {
      load: async () => cloud,
      save: async (snapshot) => {
        saved.push(snapshot);
      },
    },
  };
  return { platform, saved };
}

describe('REFM-209 — профиль пишется с печатью и поднимается по её правилу', () => {
  it('нетронутый свежий профиль хранилище не трогает', async () => {
    await boot();
    expect(cell.has(SECTOR_ZERO_PROGRESS_KEY)).toBe(false);
    expect(cell.has(SECTOR_ZERO_SHADOW_KEY)).toBe(false);
  });

  it('запись кладёт запечатанный профиль в основную и теневую копии и двигает правку облака', async () => {
    const { profile } = await boot();
    profile.saveSectorProgress({ ...profile.sectorProgress, sovereigns: 7 });
    // Игра читает профиль живой привязкой — новое значение видно сразу, до записи.
    expect(profile.sectorProgress.sovereigns).toBe(7);
    await profile.progressWrite;
    const main = cell.get(SECTOR_ZERO_PROGRESS_KEY)!;
    expect(checkSeal(main, LOCAL_SEAL)).toBe('sealed');
    expect(cell.get(SECTOR_ZERO_SHADOW_KEY)).toBe(main);
    const mark = JSON.parse(cell.get(CLOUD_MARK_KEY)!);
    expect(mark.rev).toBe(1);
    expect(mark.sealed).toBe(true); // флаг встал после того, как запись легла
  });

  it('профиль переживает перезагрузку', async () => {
    const { profile } = await boot();
    expect(profile.changeSectorProgress({ kind: 'ad-sovereigns' })).toBe(true);
    const after = profile.sectorProgress.sovereigns;
    expect(after).toBeGreaterThan(0);
    await profile.progressWrite;
    const { profile: next } = await reload();
    expect(next.sectorProgress.sovereigns).toBe(after);
  });

  it('правленая руками основная копия не берётся: профиль встаёт из теневой и переписывается', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { profile } = await boot();
    profile.saveSectorProgress({ ...profile.sectorProgress, sovereigns: 5 });
    await profile.progressWrite;
    const honest = cell.get(SECTOR_ZERO_PROGRESS_KEY)!;
    const tampered = honest.replace('"sovereigns":5', '"sovereigns":999');
    expect(tampered).not.toBe(honest);
    cell.set(SECTOR_ZERO_PROGRESS_KEY, tampered);
    const { profile: next } = await reload();
    expect(next.sectorProgress.sovereigns).toBe(5);
    expect(cell.get(SECTOR_ZERO_PROGRESS_KEY)).toBe(honest);
    expect(warn).toHaveBeenCalledWith('E_PROFILE_SEAL', 'shadow');
  });
});

describe('REFM-209 — главы по профилю', () => {
  it('закрытая в профиле задача главы не видна в забеге и не ждёт «позже»', async () => {
    const { profile } = await boot();
    const { pveChapter } = await import('../../packages/client/src/gameData');
    const chapter = pveChapter(0);
    const first = profile.chapterShown(0)[0];
    expect(first).toBeDefined();
    profile.saveSectorProgress({
      ...profile.sectorProgress,
      objectivesDone: { ...profile.sectorProgress.objectivesDone, [chapter.id]: [first!.id] },
    });
    expect(profile.chapterShown(0).map((o) => o.id)).not.toContain(first!.id);
    expect(profile.chapterLater(0).map((o) => o.id)).not.toContain(first!.id);
  });
});

describe('REFM-209 — одна вкладка — один писатель', () => {
  it('вытесненная вкладка не пишет ни профиль, ни отметку облака', async () => {
    const { profile } = await boot();
    cell.set(TAB_OWNER_KEY, 'other-tab');
    profile.saveSectorProgress({ ...profile.sectorProgress, sovereigns: 3 });
    await profile.progressWrite;
    expect(cell.has(SECTOR_ZERO_PROGRESS_KEY)).toBe(false);
    expect(cell.has(CLOUD_MARK_KEY)).toBe(false);
  });

  it('перехват у другой вкладки снимает забег и перечитывает её профиль', async () => {
    const { profile, game } = await boot();
    profile.claimSectorZero(); // первая хозяйка — снимать нечего
    expect(game.stopRun).not.toHaveBeenCalled();
    expect(game.forgetRun).not.toHaveBeenCalled();
    // Другая вкладка стала хозяйкой и сыграла.
    cell.set(TAB_OWNER_KEY, 'other-tab');
    const theirs = sealProgress({ ...profile.sectorProgress, sovereigns: 42 }, LOCAL_SEAL);
    cell.set(SECTOR_ZERO_PROGRESS_KEY, theirs);
    cell.set(SECTOR_ZERO_SHADOW_KEY, theirs);
    profile.claimSectorZero();
    expect(game.stopRun).toHaveBeenCalledTimes(1);
    expect(game.forgetRun).toHaveBeenCalledTimes(1);
    await profile.progressWrite;
    expect(profile.sectorProgress.sovereigns).toBe(42);
    expect(cell.get(TAB_OWNER_KEY)).not.toBe('other-tab');
  });

  it('вытесненная вкладка, показывающая Sector Zero, встаёт и закрывается заставкой один раз', async () => {
    const { game } = await boot();
    const append = vi.fn();
    const el = () => ({
      id: '',
      type: '',
      textContent: '',
      setAttribute: vi.fn(),
      addEventListener: vi.fn(),
      append: vi.fn(),
      focus: vi.fn(),
    });
    vi.stubGlobal('document', { createElement: el, body: { append } });
    const storage = (key: string) => {
      for (const fn of listeners.storage ?? []) fn({ key });
    };
    // Своя вкладка — хозяйка: событие ничего не делает.
    game.shown.mockReturnValue(true);
    storage(TAB_OWNER_KEY);
    expect(game.pause).not.toHaveBeenCalled();
    // Перехватила другая, а эта Sector Zero не показывает — тоже ничего.
    cell.set(TAB_OWNER_KEY, 'other-tab');
    game.shown.mockReturnValue(false);
    storage(TAB_OWNER_KEY);
    expect(game.pause).not.toHaveBeenCalled();
    // Показывает — мир встаёт, заставка ставится; чужой ключ перехватом не считается.
    game.shown.mockReturnValue(true);
    storage('void.pveMission');
    expect(game.pause).not.toHaveBeenCalled();
    storage(TAB_OWNER_KEY);
    expect(game.pause).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledTimes(1);
    // Возврат из кэша «назад/вперёд» сверяется сам; вторая заставка не ставится.
    for (const fn of listeners.pageshow ?? []) fn({ key: null });
    expect(game.pause).toHaveBeenCalledTimes(2);
    expect(append).toHaveBeenCalledTimes(1);
  });
});

describe('REFM-209 — забег отдаёт облаку снимок функцией владельца', () => {
  it('новая правка — на сменившийся дескриптор сразу, на сменившийся мир не чаще окна', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(100_000);
    const { profile } = await boot();
    profile.offerRunToCloud('portable-1', 'world-1');
    expect(rev()).toBe(1);
    profile.offerRunToCloud('portable-1', 'world-1'); // пауза: тот же журнал
    expect(rev()).toBe(1);
    profile.offerRunToCloud('portable-1', 'world-2'); // мир сменился, окно не прошло
    expect(rev()).toBe(1);
    profile.offerRunToCloud('portable-2', 'world-2'); // дескриптор сменился — сразу
    expect(rev()).toBe(2);
    now.mockReturnValue(100_000 + 30_000);
    profile.offerRunToCloud('portable-2', 'world-3'); // окно прошло
    expect(rev()).toBe(3);
  });
});

describe('REFM-209 — облачная копия', () => {
  it('без облачной копии вошедший игрок получает свой профиль, запечатанный для него', async () => {
    const { platform, saved } = cloudPlatform();
    const { profile } = await boot(platform);
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    profile.saveSectorProgress({ ...profile.sectorProgress, sovereigns: 4 });
    await vi.waitFor(() => expect(saved).toHaveLength(2));
    const sent = parseCloudProfile(saved[1]!)!;
    expect(checkSeal(sent.progress, cloudSeal('p-1'))).toBe('sealed');
    expect(JSON.parse(sent.progress).sovereigns).toBe(4);
    expect(sent.rev).toBe(rev());
  });

  it('облако не пишет вытесненная вкладка', async () => {
    const { platform, saved } = cloudPlatform();
    const { profile } = await boot(platform);
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    cell.set(TAB_OWNER_KEY, 'other-tab');
    profile.saveSectorProgress({ ...profile.sectorProgress, sovereigns: 4 });
    await profile.progressWrite;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saved).toHaveLength(1);
  });

  it('облачный профиль с прогрессом берётся на старте и снимает забег прежнего', async () => {
    const theirs = { ...freshSectorZeroProgress(data, 'cloud-seed'), sovereigns: 9 };
    const cloud = cloudEnvelope({
      v: 1,
      seed: 'cloud-seed',
      rev: 3,
      progress: sealProgress(theirs, cloudSeal('p-1')),
      state: 'cloud-world',
    });
    const { platform } = cloudPlatform(cloud);
    const { profile, game } = await boot(platform);
    expect(profile.sectorProgress.seed).toBe('cloud-seed');
    expect(profile.sectorProgress.sovereigns).toBe(9);
    expect(game.stopRun).toHaveBeenCalledTimes(1);
    expect(game.forgetRun).toHaveBeenCalledTimes(1);
    expect(game.note).toHaveBeenCalledWith(t('sector-zero.cloud.adopted'));
    // Облако привезло точный мир забега — он лёг локальным снимком (AUD-24).
    expect(await profile.runSaveStore.load()).toBe('cloud-world');
    expect(checkSeal(cell.get(SECTOR_ZERO_PROGRESS_KEY)!, LOCAL_SEAL)).toBe('sealed');
  });

  it('облачная копия чужого игрока не берётся', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const theirs = { ...freshSectorZeroProgress(data, 'cloud-seed'), sovereigns: 9 };
    const cloud = cloudEnvelope({
      v: 1,
      seed: 'cloud-seed',
      rev: 3,
      progress: sealProgress(theirs, cloudSeal('someone-else')),
    });
    const { platform } = cloudPlatform(cloud);
    const { profile, game } = await boot(platform);
    expect(profile.sectorProgress.seed).not.toBe('cloud-seed');
    expect(game.stopRun).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('E_PROFILE_SEAL', 'cloud');
  });
});
