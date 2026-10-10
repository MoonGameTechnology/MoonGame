/**
 * Владелец забега Sector Zero (REFM-210) — прямой тест поведения.
 *
 * Пока забег жил в `main.ts`, его держали только сторожа, читающие текст (`portableRunWiring`,
 * `gameplayMarking`, `runTravelSpeed` и соседи — они остаются и смотрят в новый файл). Здесь —
 * то, что текстом не проверить: что дверь забега делает с ядром прототипа, что реально легло
 * в хранилище, сколько раз засчитывается конец и что получает игра через хуки. Каждый тест —
 * свежая загрузка модулей над своим хранилищем, как перезагрузка страницы.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pveModeId } from '../../packages/client/src/gameData';
import type { GameState } from '../../packages/shared-core/src/index';
import { parseRunSave } from '../../decisions/runSave';
import { runAiSeats } from '../../decisions/runAiSeats';
import { RUN_TRAVEL_SPEED } from '../../decisions/runTempo';
import { prepareSectorZeroRun } from '../../decisions/sectorZeroProgress';
import { t } from '../../localization/runtime';
import { PORTABLE_RUN_KEY, RUN_SAVE_KEY } from './runSaveLocal';

let cell: Map<string, string>;

beforeEach(() => {
  cell = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => cell.get(k) ?? null,
    setItem: (k: string, v: string) => void cell.set(k, v),
    removeItem: (k: string) => void cell.delete(k),
  });
  vi.stubGlobal('addEventListener', () => {});
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Поднять профиль и забег, как их поднимает игра. Мир и экраны — подставные хуки. */
async function boot() {
  const platform = await import('./platform/host');
  const emitted: string[] = [];
  // Исходы попыток; прочие события (`meta_unlock` профиля) этому тесту не предмет.
  platform.setPlatform({
    ...platform.getPlatform(),
    analytics: { emit: (event) => void (event.startsWith('pve_') && emitted.push(event)) },
  });
  const game = await import('./game');
  const profile = await import('./sectorProfile');
  const run = await import('./sectorRun');
  profile.initSectorProfile({
    note: vi.fn(),
    runWritten: () => run.runWrite,
    stopRun: vi.fn(),
    forgetRun: run.forgetSavedRun,
    shown: () => false,
    pause: vi.fn(),
    saveFailing: vi.fn(),
  });
  await profile.progressWrite;
  let world: GameState = game.newGame();
  const host = {
    world: () => world,
    adopt: vi.fn((state: GameState) => {
      world = state;
    }),
    step: vi.fn(() => {
      world = game.advance(world, world.time + 1).state;
    }),
    // Как `installMatch`: флаги забега живут один матч, режим вооружается до первого хода.
    install: vi.fn((state: GameState, _ai: unknown, modeId: string) => {
      run.leaveRun();
      game.setMatchMode(modeId);
      world = state;
    }),
    halt: vi.fn(),
    show: vi.fn(),
    runChanged: vi.fn(),
    me: () => 'p1',
    net: vi.fn(() => false),
    cameFromLink: vi.fn(() => false),
    inMatch: () => true,
    note: vi.fn(),
    trainingWon: vi.fn(),
    finalScenes: vi.fn(),
    chapterWon: vi.fn(),
  };
  run.initSectorRun(host);
  return { run, profile, game, host, emitted, world: () => world };
}
type Env = Awaited<ReturnType<typeof boot>>;

/** Перезагрузка страницы: то же хранилище, свежие модули. */
async function reload(): Promise<Env> {
  vi.resetModules();
  return boot();
}

/** Новый забег главы — тем же путём, что `startPvEMatch`: попытка, мир, вход, первый ход. */
function startRun({ run, profile, game, host }: Env, testing = false): void {
  run.beginAttempt(testing);
  const world = prepareSectorZeroRun(
    profile.chapterWorld(run.sectorMission, run.pveDifficulty),
    profile.sectorProgress,
    game.data,
  );
  host.install(world, runAiSeats(world, 'p1', run.pveDifficulty), pveModeId(run.sectorMission)!);
  run.enterRun(testing ? 'dev' : 'run');
  host.step();
}

/** Забег кончился: победа игрока или Роя. */
function end(env: Env, winner: string): void {
  const s = env.world();
  env.host.adopt({ ...s, match: { ...s.match, status: 'ended', winner } });
}

describe('REFM-210 — дверь забега', () => {
  it('включает темп, силу ветерана и босса матёрого Роя, зовёт игру и снимает всё на выходе', async () => {
    const { run, game, host } = await boot();
    run.chooseDifficulty('strong');
    run.beginAttempt(true);
    run.setRunActive(true);
    expect(run.sectorRunActive).toBe(true);
    expect(game.ctx(0).config).toMatchObject({
      travelSpeedFactor: RUN_TRAVEL_SPEED,
      veteranPower: true,
      pveBoss: true,
    });
    expect(host.runChanged).toHaveBeenCalledTimes(1);
    run.setRunActive(false);
    expect(run.sectorRunActive).toBe(false);
    expect(game.ctx(0).config?.travelSpeedFactor).toBeUndefined();
    expect(game.ctx(0).config?.veteranPower).toBeUndefined();
    expect(game.ctx(0).config?.pveBoss).toBeUndefined();
    expect(host.runChanged).toHaveBeenCalledTimes(2);
  });

  it('у слабого Роя Левиафана нет', async () => {
    const { run, game } = await boot();
    run.chooseDifficulty('weak');
    run.beginAttempt(true);
    run.setRunActive(true);
    expect(game.ctx(0).config?.veteranPower).toBe(true);
    expect(game.ctx(0).config?.pveBoss).toBeUndefined();
  });

  it('стенд и полигон живут один матч и не бывают разом; полигон в сети — не полигон', async () => {
    const { run, host } = await boot();
    run.enterRun('dev');
    expect([run.sectorRunActive, run.sectorDevActive, run.trainingActive]).toEqual([
      true,
      true,
      false,
    ]);
    run.enterRun('training');
    expect([run.sectorDevActive, run.trainingActive, run.isTraining()]).toEqual([
      false,
      true,
      true,
    ]);
    host.net.mockReturnValue(true);
    expect(run.isTraining()).toBe(false);
    run.leaveRun();
    expect([run.sectorRunActive, run.sectorDevActive, run.trainingActive]).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe('REFM-210 — попытка и выбор следующего забега', () => {
  it('новая попытка берёт номер у профиля, двигает его и копирует оснащение', async () => {
    const env = await boot();
    const { run, profile } = env;
    const loadouts = { corvette: ['m1'] };
    profile.saveSectorProgress({ ...profile.sectorProgress, nextAttempt: 4, loadouts });
    run.chooseMission(2);
    run.chooseDifficulty('strong');
    run.beginAttempt(false);
    expect([run.sectorAttempt, run.sectorMission, run.pveDifficulty]).toEqual([4, 2, 'strong']);
    expect(profile.sectorProgress.nextAttempt).toBe(5);
    expect(run.runShipLoadouts).toEqual(loadouts);
    run.runShipLoadouts.corvette!.push('m2');
    expect(profile.sectorProgress.loadouts.corvette).toEqual(['m1']);
  });

  it('стенд разработчика номера не берёт и профиль не трогает', async () => {
    const { run, profile } = await boot();
    const before = profile.sectorProgress;
    run.beginAttempt(true);
    expect(run.sectorAttempt).toBe(0);
    expect(profile.sectorProgress).toBe(before);
  });

  it('глава и сложность переживают перезагрузку; испорченная глава открывает первую', async () => {
    const { run } = await boot();
    run.chooseMission(3);
    run.chooseDifficulty('strong');
    expect([cell.get('void.pveMission'), cell.get('void.pveDifficulty')]).toEqual(['3', 'strong']);
    const again = await reload();
    expect([again.run.nextSectorMission, again.run.nextSectorDifficulty]).toEqual([3, 'strong']);
    cell.set('void.pveMission', 'испорчено');
    expect((await reload()).run.nextSectorMission).toBe(0);
  });
});

describe('REFM-210 — журнал забега', () => {
  it('запись кладёт снимок и дескриптор той же попытки; кадровый такт пишет не чаще раза в 4 с', async () => {
    const env = await boot();
    const { run } = env;
    startRun(env);
    run.tickRunSave(1000);
    await run.runWrite;
    expect(cell.has(RUN_SAVE_KEY)).toBe(false);
    run.tickRunSave(5000);
    await run.runWrite;
    const save = parseRunSave(cell.get(RUN_SAVE_KEY));
    expect(save?.sectorZeroAttempt).toBe(run.sectorAttempt);
    expect(save?.mode).toBe(pveModeId(0));
    expect(JSON.parse(cell.get(PORTABLE_RUN_KEY)!)).toMatchObject({ attempt: run.sectorAttempt });
    cell.clear();
    run.tickRunSave(6000);
    await run.runWrite;
    expect(cell.has(RUN_SAVE_KEY)).toBe(false);
  });

  it('стенд разработчика журнала не пишет', async () => {
    const env = await boot();
    startRun(env, true);
    env.run.saveRun();
    await env.run.runWrite;
    expect(cell.has(RUN_SAVE_KEY)).toBe(false);
  });

  it('победа засчитывается один раз: сцены до финала главы, исход в аналитику, журнал стёрт', async () => {
    const env = await boot();
    const { run, profile, host } = env;
    startRun(env);
    run.saveRun();
    end(env, 'p1');
    run.tickRunSave(10_000);
    expect(host.finalScenes).toHaveBeenCalledTimes(1);
    expect(host.chapterWon).toHaveBeenCalledTimes(1);
    expect(host.finalScenes.mock.invocationCallOrder[0]).toBeLessThan(
      host.chapterWon.mock.invocationCallOrder[0]!,
    );
    expect(env.emitted).toEqual(['pve_completed']);
    expect(profile.sectorProgress.settledThrough).toBe(run.sectorAttempt);
    await run.runWrite;
    expect([cell.has(RUN_SAVE_KEY), cell.has(PORTABLE_RUN_KEY)]).toEqual([false, false]);
    run.tickRunSave(20_000);
    run.saveRun();
    await run.runWrite;
    expect(host.finalScenes).toHaveBeenCalledTimes(1);
    expect(env.emitted).toEqual(['pve_completed']);
    expect(cell.has(RUN_SAVE_KEY)).toBe(false);
  });

  it('поражение засчитывается без финала главы', async () => {
    const env = await boot();
    startRun(env);
    end(env, 'p3');
    env.run.tickRunSave(10_000);
    expect(env.host.finalScenes).toHaveBeenCalledTimes(1);
    expect(env.host.chapterWon).not.toHaveBeenCalled();
    expect(env.emitted).toEqual(['pve_failed']);
  });

  it('пройденный полигон зовёт свой финал', async () => {
    const env = await boot();
    env.run.enterRun('training');
    end(env, 'p1');
    env.run.tickRunSave(10_000);
    expect(env.host.trainingWon).toHaveBeenCalledTimes(1);
    expect(env.host.finalScenes).not.toHaveBeenCalled();
  });
});

describe('REFM-210 — «Продолжить»', () => {
  async function savedRun(): Promise<{ attempt: number; env: Env }> {
    const first = await boot();
    startRun(first);
    first.run.saveRun();
    await first.run.runWrite;
    await first.profile.progressWrite;
    const attempt = first.run.sectorAttempt;
    const env = await reload();
    return { attempt, env };
  }

  it('после перезагрузки поднимает тот же забег с той же попыткой', async () => {
    const { attempt, env } = await savedRun();
    const { run, profile, host } = env;
    expect(await run.loadSavedRun()).not.toBeNull();
    expect(run.restoreRun()).toBe(true);
    expect(host.install).toHaveBeenCalledWith(expect.anything(), expect.any(Map), pveModeId(0));
    expect([run.sectorRunActive, run.sectorAttempt, run.sectorDevActive]).toEqual([
      true,
      attempt,
      false,
    ]);
    expect(run.isSectorZeroRun()).toBe(true);
    expect(profile.sectorProgress.nextAttempt).toBeGreaterThan(attempt);
    expect(host.show).toHaveBeenCalledTimes(1);
    expect(host.note).toHaveBeenCalledWith(t('setup.pve.restored'));
  });

  it('пришедшего по ссылке и сетевую партию не перехватывает', async () => {
    const { env } = await savedRun();
    await env.run.loadSavedRun();
    env.host.cameFromLink.mockReturnValue(true);
    expect(env.run.restoreRun()).toBe(false);
    env.host.cameFromLink.mockReturnValue(false);
    env.host.net.mockReturnValue(true);
    expect(env.run.restoreRun()).toBe(false);
    expect(env.host.install).not.toHaveBeenCalled();
  });

  it('снимок, не ставший миром, откатывается: прежний мир, флаги, мир стоит', async () => {
    const { env } = await savedRun();
    const { run, host } = env;
    await run.loadSavedRun();
    const prior = env.world();
    host.install.mockImplementationOnce(() => {
      run.leaveRun();
      throw new Error('битая карта');
    });
    expect(run.restoreRun()).toBe(false);
    expect(host.adopt).toHaveBeenCalledWith(prior);
    expect(env.world()).toBe(prior);
    expect(host.halt).toHaveBeenCalled();
    expect(run.sectorRunActive).toBe(false);
    expect(host.show).not.toHaveBeenCalled();
  });

  it('нечитаемый снимок — забег по дескриптору с его попыткой', async () => {
    const { attempt, env } = await savedRun();
    cell.set(RUN_SAVE_KEY, 'испорчено');
    const { run, host } = env;
    expect(await run.loadSavedRun()).not.toBeNull();
    expect(run.restoreRun()).toBe(true);
    expect(host.step).toHaveBeenCalledTimes(1);
    expect([run.sectorRunActive, run.sectorAttempt, run.sectorMission]).toEqual([true, attempt, 0]);
    expect(host.note).toHaveBeenCalledWith(
      t('setup.pve.restored-portable', { n: env.world().pve?.waveNumber ?? 0 }),
    );
  });

  it('законченный забег меню засчитывает при чтении и стирает журнал', async () => {
    const first = await boot();
    startRun(first);
    end(first, 'p3');
    first.run.saveRun();
    await first.run.runWrite;
    await first.profile.progressWrite;
    const attempt = first.run.sectorAttempt;
    const env = await reload();
    expect(await env.run.loadSavedRun()).toBeNull();
    expect(env.profile.sectorProgress.settledThrough).toBe(attempt);
    expect([cell.has(RUN_SAVE_KEY), cell.has(PORTABLE_RUN_KEY)]).toEqual([false, false]);
  });

  it('«Начать всё заново» снимает забег, стирает журнал и выбор главы, профиль — с тем же сидом', async () => {
    const env = await boot();
    const { run, profile } = env;
    startRun(env);
    run.saveRun();
    run.chooseMission(2);
    const seed = profile.sectorProgress.seed;
    await run.resetSectorZero();
    expect(run.sectorRunActive).toBe(false);
    expect([cell.has(RUN_SAVE_KEY), cell.has(PORTABLE_RUN_KEY)]).toEqual([false, false]);
    expect([run.nextSectorMission, cell.get('void.pveMission')]).toEqual([0, '0']);
    expect(profile.sectorProgress.seed).toBe(seed);
    expect(profile.sectorProgress.nextAttempt).toBe(1);
    expect(await run.loadSavedRun()).toBeNull();
  });
});
