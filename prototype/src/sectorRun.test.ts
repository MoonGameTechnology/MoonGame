/**
 * Владелец забега Sector Zero (REFM-210) — прямой тест поведения.
 *
 * Пока забег жил в `main.ts`, его стык держали только сторожа по тексту (`gameplayMarking`,
 * `portableRunWiring`, `comicWiring` и соседи — они остаются и смотрят в новый файл). Здесь —
 * то, что текстом не проверить: что легло в журнал, когда засчитывается конец забега, что
 * поднимает «Продолжить» и куда откатывается неудачное восстановление. Мир — настоящий мир
 * главы, засеянный ядром; хост — подделка, которая делает то же, что `main.ts` с флагами
 * забега. Каждый тест — свежая загрузка модулей над своим хранилищем, как перезагрузка.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pveChapter, pveModeId, pveState } from '../../packages/client/src/gameData';
import type { GameState } from '../../packages/shared-core/src/index';
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

/** Поднять профиль и забег так, как их поднимает `main.ts`, над текущим хранилищем. */
async function boot() {
  const platformHost = await import('./platform/host');
  const marks: string[] = [];
  platformHost.setPlatform({
    ...platformHost.getPlatform(),
    gameplayStart: () => marks.push('start'),
    gameplayStop: () => marks.push('stop'),
  } as ReturnType<typeof platformHost.getPlatform>);
  const game = await import('./game');
  const profile = await import('./sectorProfile');
  const run = await import('./sectorRun');
  profile.initSectorProfile({
    note: () => {},
    runWritten: () => run.runWrite,
    stopRun: run.stopRun,
    forgetRun: run.forgetSavedRun,
    shown: () => false,
    pause: () => {},
  });
  await profile.progressWrite;

  // Мир главы, засеянный первым ходом ядра, — как его оставляет запуск забега.
  game.setMatchMode(pveModeId());
  const start = pveState(game.data);
  const seeded = game.advance(start, start.time + 1).state;
  const calls: string[] = [];
  const host = {
    world: seeded,
    online: false,
    fromLink: false,
    running: true,
    failInstall: false,
  };
  const note = vi.fn();
  run.initSectorRun({
    world: () => host.world,
    me: () => 'p1',
    online: () => host.online,
    fromLink: () => host.fromLink,
    inMatch: () => true,
    worldRunning: () => host.running,
    syncTools: () => calls.push('sync'),
    // Установка партии гасит флаги прежнего забега и вооружает режим — как `installMatch`.
    install: (state, _ai, mode) => {
      // `installMatch` гасит флаги, вооружает режим и ставит мир — и только потом может упасть
      // на мире, который прошёл разбор, но миром не стал. Откат обязан вернуть всё это.
      calls.push('install');
      run.resetRunFlags();
      game.setMatchMode(mode);
      host.world = state;
      if (host.failInstall) throw new Error('E_TEST_BAD_WORLD');
    },
    setWorld: (state) => {
      calls.push('setWorld');
      host.world = state;
    },
    seed: () => {
      host.world = game.advance(host.world, host.world.time + 1).state;
    },
    halt: () => calls.push('halt'),
    enterRun: () => calls.push('enter'),
    note,
    comic: (chapter, moment) => calls.push(`comic:${chapter}:${moment}`),
    taskComics: () => calls.push('tasks'),
  });
  return { run, profile, game, host, calls, marks, note };
}

/** Забег главы идёт: попытка из профиля, флаг поднят. */
async function bootRunning() {
  const env = await boot();
  env.run.prepareRun(false);
  env.run.startRun(false);
  return env;
}

const ended = (s: GameState): GameState => ({
  ...s,
  match: { ...s.match, status: 'ended', winner: 'p1', winners: ['p1'] },
});

describe('REFM-210 — дверь забега', () => {
  it('флаг, правила матча и разметка площадки меняются одним действием', async () => {
    const { run, game, calls, marks, host } = await boot();
    run.setRunActive(true);
    expect(run.sectorRunActive).toBe(true);
    expect(game.ctx(0).config?.veteranPower).toBe(true);
    expect(calls).toContain('sync');
    expect(marks.at(-1)).toBe('start');
    // Мир стоит (пауза, комикс) — геймплей не идёт, хотя забег идёт.
    host.running = false;
    run.markGameplay();
    expect(run.gameplayMarked).toBe(false);
    expect(marks.at(-1)).toBe('stop');
    run.setRunActive(false);
    expect(run.sectorRunActive).toBe(false);
    expect(game.ctx(0).config?.veteranPower).not.toBe(true);
  });

  it('новая партия гасит забег, дев-забег и полигон', async () => {
    const { run } = await boot();
    run.startRun(true);
    expect(run.sectorDevActive).toBe(true);
    run.startTrainingRun();
    expect(run.trainingActive).toBe(true);
    expect(run.isTraining()).toBe(true);
    run.resetRunFlags();
    expect([run.sectorRunActive, run.sectorDevActive, run.trainingActive]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('в сетевой партии забега нет — ни инструментов, ни полигона', async () => {
    const { run, host } = await bootRunning();
    expect(run.isSectorZeroRun()).toBe(true);
    expect(run.sectorZeroToolsHidden()).toBe(true);
    host.online = true;
    expect(run.isSectorZeroRun()).toBe(false);
    expect(run.sectorZeroToolsHidden()).toBe(false);
    expect(run.leavesToSectorZero()).toBe(false);
  });
});

describe('REFM-210 — попытка', () => {
  it('сложность и глава — из меню и переживают перезагрузку; номер — из профиля; снаряжение — копия', async () => {
    const { run, profile } = await boot();
    run.chooseDifficulty('strong');
    run.chooseMission(1);
    const attempt = profile.sectorProgress.nextAttempt;
    run.prepareRun(false);
    expect(run.pveDifficulty).toBe('strong');
    expect(run.sectorMission).toBe(1);
    expect(run.sectorAttempt).toBe(attempt);
    expect(profile.sectorProgress.nextAttempt).toBe(attempt + 1);
    expect(run.runShipLoadouts).toEqual(profile.sectorProgress.loadouts);
    expect(run.runShipLoadouts).not.toBe(profile.sectorProgress.loadouts);
    await profile.progressWrite;
    const next = await (async () => {
      vi.resetModules();
      return boot();
    })();
    expect(next.run.nextSectorDifficulty).toBe('strong');
    expect(next.run.nextSectorMission).toBe(1);
  });

  it('дев-забег профиль не пишет и попытки не тратит', async () => {
    const { run, profile } = await boot();
    const before = profile.sectorProgress;
    run.prepareRun(true);
    expect(run.sectorAttempt).toBe(0);
    expect(profile.sectorProgress).toBe(before);
  });
});

describe('REFM-210 — журнал забега', () => {
  it('пишет снимок и дескриптор только идущий забег главы, и не дев-забег', async () => {
    const env = await boot();
    env.run.saveRun();
    await env.run.runWrite;
    expect(cell.has(RUN_SAVE_KEY)).toBe(false);
    env.run.startRun(true);
    env.run.saveRun();
    await env.run.runWrite;
    expect(cell.has(RUN_SAVE_KEY)).toBe(false);
    env.run.resetRunFlags();
    env.run.prepareRun(false);
    env.run.startRun(false);
    env.run.saveRun();
    await env.run.runWrite;
    expect(cell.has(RUN_SAVE_KEY)).toBe(true);
    expect(cell.has(PORTABLE_RUN_KEY)).toBe(true);
  });

  it('кадровый такт пишет не чаще раза в 4 с', async () => {
    const { run } = await bootRunning();
    run.tickRunSave(10_000);
    await run.runWrite;
    expect(cell.has(RUN_SAVE_KEY)).toBe(true);
    cell.delete(RUN_SAVE_KEY);
    run.tickRunSave(12_000);
    await run.runWrite;
    expect(cell.has(RUN_SAVE_KEY)).toBe(false);
    run.tickRunSave(14_000);
    await run.runWrite;
    expect(cell.has(RUN_SAVE_KEY)).toBe(true);
  });

  it('конец забега засчитывается один раз: комиксы задач раньше финала, журнал стирается', async () => {
    const { run, host, calls } = await bootRunning();
    run.saveRun();
    await run.runWrite;
    expect(cell.has(RUN_SAVE_KEY)).toBe(true);
    host.world = ended(host.world);
    run.tickRunSave(20_000);
    const outro = `comic:${pveChapter(run.sectorMission).id}:outro`;
    expect(calls.indexOf('tasks')).toBeGreaterThan(-1);
    expect(calls.indexOf('tasks')).toBeLessThan(calls.indexOf(outro));
    await run.runWrite;
    expect(cell.has(RUN_SAVE_KEY)).toBe(false);
    expect(cell.has(PORTABLE_RUN_KEY)).toBe(false);
    run.tickRunSave(30_000);
    expect(calls.filter((c) => c === 'tasks')).toHaveLength(1);
  });
});

describe('REFM-210 — «Продолжить»', () => {
  /** Забег сохранён, вкладку закрыли и открыли заново: меню прочитало журнал. */
  async function reopenedWithSave(change: (s: GameState) => GameState = (s) => s) {
    const first = await bootRunning();
    first.host.world = change(first.host.world);
    first.run.saveRun();
    await first.run.runWrite;
    await first.profile.progressWrite;
    const saved = { attempt: first.run.sectorAttempt, time: first.host.world.time };
    vi.resetModules();
    const env = await boot();
    const preview = await env.run.loadSavedRun();
    return { ...env, preview, saved };
  }

  it('поднимает тот же мир с той же попыткой, темпом забега и строкой ленты', async () => {
    const { run, host, calls, note, preview, saved } = await reopenedWithSave();
    expect(preview).not.toBeNull();
    expect(run.restoreRun()).toBe(true);
    expect(host.world.time).toBe(saved.time);
    expect(run.sectorRunActive).toBe(true);
    expect(run.sectorAttempt).toBe(saved.attempt);
    expect(calls).toContain('enter');
    expect(note).toHaveBeenCalledWith(t('setup.pve.restored'));
  });

  it('пришедшего по ссылке и сетевого игрока не перехватывает', async () => {
    const { run, host, calls } = await reopenedWithSave();
    host.fromLink = true;
    expect(run.restoreRun()).toBe(false);
    host.fromLink = false;
    host.online = true;
    expect(run.restoreRun()).toBe(false);
    expect(calls).not.toContain('install');
  });

  it('снимок не стал миром — прежние мир, флаг забега и режим вернулись, мир стоит', async () => {
    const { run, game, host, calls } = await reopenedWithSave();
    // На экране шла другая партия: без режима, с поднятым флагом забега.
    game.setMatchMode(undefined);
    run.startRun(false);
    const prior = host.world;
    host.failInstall = true;
    // Дескриптора меню не читало (полный снимок был), так что запасного пути нет — отказ.
    expect(run.restoreRun()).toBe(false);
    expect(host.world).toBe(prior);
    expect(run.sectorRunActive).toBe(true);
    expect(game.matchMode()).toBeUndefined();
    expect(calls).toContain('halt');
    expect(calls).not.toContain('enter');
  });

  it('закончившийся, но не засчитанный забег меню засчитывает и стирает', async () => {
    const { preview, profile } = await reopenedWithSave(ended);
    expect(preview).toBeNull();
    expect(cell.has(RUN_SAVE_KEY)).toBe(false);
    expect(cell.has(PORTABLE_RUN_KEY)).toBe(false);
    expect(profile.sectorProgress.lastReward).toBeGreaterThanOrEqual(0);
  });

  it('смена профиля под вкладкой снимает только идущий забег и забывает хранимый', async () => {
    const { run, preview } = await reopenedWithSave();
    expect(preview).not.toBeNull();
    run.stopRun(); // забег не идёт — снимать нечего
    expect(run.sectorRunActive).toBe(false);
    run.forgetSavedRun();
    expect(run.savedRun).toBeNull();
    expect(run.restoreRun()).toBe(false);
  });
});
