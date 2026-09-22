import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../../../data/bundle';
import { skirmishState } from './gameData';
import {
  isRestorable,
  rememberLatest,
  type CachedWorld,
  type SnapshotStore,
} from './snapshotCache';

/**
 * CP2.3 — что кэш обязан ОТКАЗАТЬСЯ показывать, и как он пишет, не тормозя карту.
 *
 * Мир для фикстуры строится настоящий (`skirmishState` на шипнутом каталоге): проверка
 * годности читает `state.version.dataHash`, а он появляется только в состоянии, собранном
 * штатным путём. Слепленный вручную объект прошёл бы мимо того самого поля, ради которого
 * проверка и существует.
 */
const data = shippedGameData();

const world = (over: Partial<CachedWorld> = {}): CachedWorld => ({
  matchId: 'm-1',
  base: 'wss://play.example.com',
  playerId: 'p1',
  seq: 12,
  state: skirmishState(data),
  ...over,
});

describe('годность кэша (CP2.3)', () => {
  it('свой мир текущей сборки — показывается', () => {
    expect(isRestorable(world(), data)).toBe(true);
    expect(isRestorable(world(), data, 'm-1')).toBe(true);
  });

  it('пусто — показывать нечего', () => {
    expect(isRestorable(null, data)).toBe(false);
  });

  it('мир ДРУГОГО матча не подставляется под текущий', () => {
    expect(isRestorable(world(), data, 'm-2')).toBe(false);
  });

  it('контент сборки уехал — мир не рисуется', () => {
    // Версия каталога сменилась: id юнитов и зданий в кэше уже могут не существовать.
    const stale = world();
    stale.state.version = { ...stale.state.version, data: '0.0.1-старая' };
    expect(isRestorable(stale, data)).toBe(false);
  });

  it('версия та же, а СОДЕРЖИМОЕ другое — тоже не рисуется', () => {
    // Ровно случай MP-4: номер версии забыли поднять, а бандл подменили.
    const tampered = world();
    tampered.state.version = { ...tampered.state.version, dataHash: 'подменённый' };
    expect(isRestorable(tampered, data)).toBe(false);
  });

  it('отпечатка нет вовсе — отказ, а не доверие по умолчанию', () => {
    const old = world();
    const { dataHash: _dropped, ...withoutHash } = old.state.version;
    old.state.version = withoutHash;
    expect(isRestorable(old, data)).toBe(false);
  });
});

/** Стор, который держит запись «в полёте», пока тест не разрешит ей завершиться. */
function gatedStore(): {
  store: SnapshotStore;
  written: CachedWorld[];
  release: () => Promise<void>;
} {
  const written: CachedWorld[] = [];
  let unlock: (() => void) | null = null;
  return {
    written,
    store: {
      read: () => Promise.resolve(null),
      clear: () => Promise.resolve(),
      write: (w) =>
        new Promise<void>((resolve) => {
          written.push(w);
          unlock = resolve;
        }),
    },
    release: async () => {
      unlock?.();
      unlock = null;
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('запись последнего мира (CP2.3)', () => {
  it('пишет СРАЗУ и не ждёт второй записи, пока идёт первая', async () => {
    const { store, written, release } = gatedStore();
    const remember = rememberLatest(store);
    remember(world({ seq: 1 }));
    expect(written.map((w) => w.seq)).toEqual([1]);
    remember(world({ seq: 2 }));
    remember(world({ seq: 3 }));
    // Пока первая в полёте — очередь не растёт: вторая и третья не пишутся.
    expect(written.map((w) => w.seq)).toEqual([1]);
    await release();
    // …а когда полёт кончился, пишется ПОСЛЕДНЯЯ. Снапшот №2 устарел, не долетев до
    // диска, и писать его значило бы задержать №3 ради картинки, которой уже нет.
    expect(written.map((w) => w.seq)).toEqual([1, 3]);
    await release();
    expect(written.map((w) => w.seq)).toEqual([1, 3]);
  });

  it('отказ хранилища не ломает следующую запись', async () => {
    const written: number[] = [];
    let fail = true;
    const store: SnapshotStore = {
      read: () => Promise.resolve(null),
      clear: () => Promise.resolve(),
      write: (w) => {
        written.push(w.seq);
        return fail ? Promise.reject(new Error('quota')) : Promise.resolve();
      },
    };
    const remember = rememberLatest(store);
    remember(world({ seq: 1 }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    fail = false;
    remember(world({ seq: 2 }));
    await Promise.resolve();
    expect(written).toEqual([1, 2]);
  });
});
