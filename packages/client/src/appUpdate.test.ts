import { describe, expect, it } from 'vitest';
import {
  watchForUpdate,
  SW_URL,
  type RegistrationLike,
  type UpdateIo,
  type WorkerLike,
} from './appUpdate';

/**
 * CP2.2 — обновление предлагают, а не применяют.
 *
 * Две проверяемые здесь ошибки одинаково невидимы до продакшена: баннер «новая версия
 * готова» на ПЕРВОМ в жизни визите и лишняя перезагрузка на первой установке (её
 * вызывает `clients.claim()`, а не обновление).
 */
interface FakeWorker extends WorkerLike {
  state: string;
  posted: unknown[];
  /** Сообщить подписчикам, что состояние изменилось. */
  fire(): void;
}

function fakeWorker(state = 'installed'): FakeWorker {
  const listeners: Array<() => void> = [];
  const posted: unknown[] = [];
  return {
    state,
    posted,
    postMessage: (m) => void posted.push(m),
    addEventListener: (_t, cb) => void listeners.push(cb),
    fire: () => listeners.forEach((cb) => cb()),
  };
}

interface FakeRegistration extends RegistrationLike {
  installing: WorkerLike | null;
  /** Сообщить подписчикам, что пошла установка новой сборки. */
  found(): void;
}

function fakeRegistration(waiting: WorkerLike | null = null): FakeRegistration {
  const listeners: Array<() => void> = [];
  return {
    waiting,
    installing: null,
    addEventListener: (_t, cb) => void listeners.push(cb),
    found: () => listeners.forEach((cb) => cb()),
  };
}

interface FakeIo extends UpdateIo {
  reloads: number;
  registered: string[];
  /** Сообщить подписчикам, что страницу перехватил другой воркер. */
  takeOver(): void;
}

function fakeIo(reg: RegistrationLike | null, controlled = true): FakeIo {
  const listeners: Array<() => void> = [];
  const io: FakeIo = {
    reloads: 0,
    registered: [],
    register: (url) => {
      io.registered.push(url);
      return Promise.resolve(reg);
    },
    controlled: () => controlled,
    onControllerChange: (cb) => void listeners.push(cb),
    reload: () => void io.reloads++,
    takeOver: () => listeners.forEach((cb) => cb()),
  };
  return io;
}

describe('обновление клиента (CP2.2)', () => {
  it('браузер без воркеров — просто нет оболочки, а не сломанный клиент', async () => {
    const io = fakeIo(null);
    const offers: Array<() => void> = [];
    await watchForUpdate(io, (a) => void offers.push(a));
    expect(io.registered).toEqual([SW_URL]);
    expect(offers).toHaveLength(0);
  });

  it('первая установка ничего не предлагает и не перезагружает страницу', async () => {
    const io = fakeIo(fakeRegistration(fakeWorker()), false);
    const offers: Array<() => void> = [];
    await watchForUpdate(io, (a) => void offers.push(a));
    expect(offers).toHaveLength(0);
    io.takeOver(); // так стреляет `clients.claim()` на первой установке
    expect(io.reloads).toBe(0);
  });

  it('ждущая новая сборка предлагается, применяется по кнопке и перезагружает ОДИН раз', async () => {
    const worker = fakeWorker();
    const io = fakeIo(fakeRegistration(worker));
    const offers: Array<() => void> = [];
    await watchForUpdate(io, (a) => void offers.push(a));
    expect(offers).toHaveLength(1);
    offers[0]?.();
    expect(worker.posted).toEqual([{ type: 'skip-waiting' }]);
    io.takeOver();
    io.takeOver();
    expect(io.reloads).toBe(1);
  });

  it('сборка, доустановившаяся уже при открытой вкладке, тоже предлагается', async () => {
    const reg = fakeRegistration(null);
    const io = fakeIo(reg);
    const offers: Array<() => void> = [];
    await watchForUpdate(io, (a) => void offers.push(a));
    expect(offers).toHaveLength(0);

    const worker = fakeWorker('installing');
    reg.installing = worker;
    reg.found();
    worker.fire(); // ещё ставится — предлагать нечего
    expect(offers).toHaveLength(0);

    worker.state = 'installed';
    worker.fire();
    expect(offers).toHaveLength(1);
  });
});
