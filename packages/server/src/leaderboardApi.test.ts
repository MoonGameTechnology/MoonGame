import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { rankCorps, registerLeaderboardApi, type BoardView } from './leaderboardApi';
import { MemoryCommanderStore, MemoryCorpStore, MemoryUserStore } from './store';
import type { CorpSummary } from './store';

function corp(corpId: string, name: string, influence: number, members = 1): CorpSummary {
  return { corpId, name, influence, members };
}

describe('RANK-1 — правило места', () => {
  it('равные очки делят ОДНО место, следующий за ними падает вниз', () => {
    // Место = «сколько строго выше меня» + 1. Индекс в отсортированном списке дал бы
    // двум одинаковым корпорациям разные места — доска соврала бы о разнице, которой нет.
    const view = rankCorps([corp('a', 'Альфа', 50), corp('b', 'Бета', 50), corp('c', 'Гамма', 10)], null);
    expect(view.rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('порядок стабилен: равные очки не тасуются между обновлениями', () => {
    const shuffled = [corp('z', 'Зет', 7), corp('a', 'Альфа', 7), corp('m', 'Эм', 7)];
    const first = rankCorps(shuffled, null).rows.map((r) => r.name);
    const second = rankCorps([...shuffled].reverse(), null).rows.map((r) => r.name);
    expect(second).toEqual(first);
  });

  it('своя строка помечена, и её место — НАСТОЯЩЕЕ, даже когда она вне страницы', () => {
    const many = Array.from({ length: 12 }, (_, i) => corp(`c${i}`, `Корп ${i}`, 100 - i));
    const view = rankCorps(many, 'c11', 3); // страница — три строки, моя одиннадцатая
    expect(view.rows).toHaveLength(3);
    expect(view.rows.some((r) => r.me)).toBe(false); // в странице меня нет — и не выдумываем
    expect(view.me.rank).toBe(12); // но место известно: считается по ВСЕМ
    expect(view.total).toBe(12);
  });

  it('без корпорации место пустое — это не «последнее место»', () => {
    const view = rankCorps([corp('a', 'Альфа', 5)], null);
    expect(view.me.rank).toBeNull();
    expect(view.me.name).toBeNull();
  });
});

describe('RANK-1 — хранилище очков командира', () => {
  it('топ отсортирован по XP, ничьи разведены стабильным ключом', async () => {
    const store = new MemoryCommanderStore();
    await store.creditMatch('m1', [
      { accountId: 'zeta', xp: 100 },
      { accountId: 'alpha', xp: 100 },
      { accountId: 'beta', xp: 300 },
    ]);
    expect((await store.topXp(10)).map((r) => r.accountId)).toEqual(['beta', 'alpha', 'zeta']);
    expect(await store.topXp(1)).toHaveLength(1);
  });

  it('своё место считается по всем, а ничьи делят его', async () => {
    const store = new MemoryCommanderStore();
    await store.creditMatch('m1', [
      { accountId: 'a', xp: 100 },
      { accountId: 'b', xp: 100 },
      { accountId: 'c', xp: 300 },
    ]);
    expect(await store.standingOf('c')).toEqual({ rank: 1, xp: 300, total: 3 });
    expect(await store.standingOf('a')).toEqual({ rank: 2, xp: 100, total: 3 });
    expect(await store.standingOf('b')).toEqual({ rank: 2, xp: 100, total: 3 });
  });

  it('аккаунт без единого доигранного матча — БЕЗ места, а не последний', async () => {
    const store = new MemoryCommanderStore();
    await store.creditMatch('m1', [{ accountId: 'a', xp: 10 }]);
    expect(await store.standingOf('новичок')).toEqual({ rank: null, xp: 0, total: 1 });
  });
});

/** Wire the route over memory stores; returns the app plus a seeded identity. */
async function wire(opts: { withCorps?: boolean } = {}) {
  const app = Fastify();
  const commanders = new MemoryCommanderStore();
  const users = new MemoryUserStore();
  const corps = opts.withCorps === false ? undefined : new MemoryCorpStore();
  const made = await users.createUser('Vasya', 'x');
  const me = made.ok ? made.userId : '';
  registerLeaderboardApi(app, {
    commanders,
    users,
    corps,
    identify: (request) =>
      Promise.resolve(
        request.headers.authorization === 'Bearer ok' ? { accountId: me, login: 'Vasya' } : null,
      ),
  });
  return { app, commanders, users, corps, me };
}

describe('RANK-1 — маршрут /leaderboard', () => {
  it('без сессии — 401, доска не отдаётся анониму', async () => {
    const { app } = await wire();
    const res = await app.inject({ method: 'GET', url: '/leaderboard' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('обе доски приходят ОДНИМ ответом — переключение вкладки без запроса', async () => {
    const { app, commanders, users, corps, me } = await wire();
    const other = await users.createUser('Petya', 'x');
    await commanders.creditMatch('m1', [
      { accountId: me, xp: 50 },
      { accountId: other.ok ? other.userId : 'x', xp: 90 },
    ]);
    await corps!.createCorp('Флот', me, 'Vasya');
    const res = await app.inject({
      method: 'GET',
      url: '/leaderboard',
      headers: { authorization: 'Bearer ok' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { players: BoardView; corps: BoardView };
    expect(body.players.rows.map((r) => r.name)).toEqual(['Petya', 'Vasya']);
    expect(body.players.rows[1]!.me).toBe(true); // своя строка помечена на месте
    expect(body.players.me).toEqual({ rank: 2, score: 50, name: 'Vasya' });
    expect(body.corps.rows[0]!.name).toBe('Флот');
    expect(body.corps.rows[0]!.me).toBe(true);
    await app.close();
  });

  it('без корп-хранилища доска корпораций ПУСТАЯ, а не отсутствующая', async () => {
    // Плейтест-хост не держит корпораций: экран не должен знать, кто его обслуживает.
    const { app } = await wire({ withCorps: false });
    const res = await app.inject({
      method: 'GET',
      url: '/leaderboard',
      headers: { authorization: 'Bearer ok' },
    });
    const body = res.json() as { corps: BoardView };
    expect(body.corps).toEqual({ rows: [], me: { rank: null, score: 0, name: null }, total: 0 });
    await app.close();
  });

  it('строка исчезнувшего аккаунта выбрасывается, а не печатается пустой', async () => {
    const { app, commanders, me } = await wire();
    await commanders.creditMatch('m1', [
      { accountId: 'аккаунта-нет', xp: 900 },
      { accountId: me, xp: 10 },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/leaderboard',
      headers: { authorization: 'Bearer ok' },
    });
    const body = res.json() as { players: BoardView };
    expect(body.players.rows.map((r) => r.name)).toEqual(['Vasya']);
    // Место при этом честное: удалённый аккаунт всё ещё выше меня по очкам.
    expect(body.players.rows[0]!.rank).toBe(2);
    await app.close();
  });
});
