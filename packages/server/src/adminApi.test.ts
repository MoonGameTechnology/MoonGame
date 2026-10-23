import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { NewsAnnouncement, NewsView } from '@void/protocol';
import { MS_PER_DAY, type GameData } from '@void/shared-core';
import { registerAdminApi, adminLoginsFromEnv, isAdmin, type AdminApiDeps } from './adminApi';
import { kickSeat } from './seatKick';
import { seatClaimAction, seatConfirmAction } from './joinSeat';
import { MatchRegistry } from './matchRegistry';
import { registerNewsApi } from './newsApi';
import { MemoryAccountStore, MemoryAnnouncementStore, MemoryAvaFeedStore } from './store';
import { createDevMatch, loadShippedData } from './scenario';
import type { MatchRoom, RoomPeer } from './matchRoom';

// ADM-1 — админский слайс: состав живого матча и снятие игрока с места.

let data: GameData;
beforeAll(() => {
  data = loadShippedData();
});

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

/** Сокет-заглушка: помнит, что ему прислали и с каким кодом закрыли. */
function fakePeer(): RoomPeer & { sent: string[]; closedWith: string[] } {
  const sent: string[] = [];
  const closedWith: string[] = [];
  return {
    sent,
    closedWith,
    send: (d: string) => sent.push(d),
    close: (_code?: number, reason?: string) => closedWith.push(reason ?? ''),
  };
}

interface World {
  registry: MatchRegistry;
  accounts: MemoryAccountStore;
  room: MatchRoom;
}

/** Матч с одним СЕВШИМ игроком: позывной привязан в сторе, место закреплено в ядре. */
async function world(nick = 'griefer', seat = 'green'): Promise<World> {
  const accounts = new MemoryAccountStore();
  const registry = new MatchRegistry(accounts);
  // Часы заморожены: с настоящими `Date.now()` догон от `time: 0` до сегодняшнего дня
  // мгновенно завершает матч по очкам, и любое действие получает `E_MATCH_ENDED`.
  const room = createDevMatch(data, { id: 'm1', now: () => 1_000 });
  registry.register(room, { mapId: 'nexus-duel', rules: { timeScale: 1 }, createdAt: 2 });
  await accounts.resolveSeat('m1', nick, Object.keys(room.state.players), seat);
  await room.submitServerAction(seat, seatClaimAction('m1', seat, room.state.time, {}));
  await room.submitServerAction(seat, seatConfirmAction('m1', seat, room.state.time));
  return { registry, accounts, room };
}

/** Учётки, существующие к монтированию: логин (без учёта регистра) → id. По умолчанию
 *  каждый логин зарегистрирован как `acct:<логин>` — так же, как его называет `identify`. */
type Accounts = Map<string, string> | 'all';

/** Сервер с админским API. Личность — как в остальных тестах: `Bearer <логин>` или
 *  `Bearer <логин>@<id учётки>`, когда тесту нужна другая учётка под тем же логином. */
function adminApp(
  w: World,
  admins: string[],
  accounts: Accounts = 'all',
  kick?: AdminApiDeps['kick'],
): FastifyInstance {
  app = Fastify();
  registerAdminApi(app, {
    admins: new Set(admins),
    users: {
      findUser: (login) => {
        const id = accounts === 'all' ? `acct:${login}` : accounts.get(login.toLowerCase());
        return Promise.resolve(id ? { userId: id, login, passHash: 'x' } : null);
      },
    },
    identify: (request) => {
      const raw = request.headers.authorization;
      const bearer = typeof raw === 'string' ? raw.replace(/^Bearer /, '') : '';
      const [login = '', accountId = `acct:${login}`] = bearer.split('@');
      return Promise.resolve(login ? { accountId, login } : null);
    },
    roster: async (id) => {
      const room = w.registry.get(id);
      if (!room) return null;
      const bySeat = new Map(
        (await w.accounts.seatedNicks(id)).map((s) => [s.playerId, s.nick] as const),
      );
      const online = new Set(room.connectedPlayers());
      return {
        matchId: id,
        day: Math.floor(room.state.time / MS_PER_DAY),
        ended: room.state.match.status === 'ended',
        entryOpen: w.registry.entryOpen(id),
        seats: Object.values(room.state.players).map((p) => ({
          playerId: p.id,
          name: p.name,
          faction: p.faction,
          nick: bySeat.get(p.id) ?? null,
          seated: p.seated === true,
          connected: online.has(p.id),
        })),
      };
    },
    kick: kick ?? ((id, nick) => kickSeat({ matchId: id, room: w.registry.get(id), accounts: w.accounts }, nick)),
  });
  return app;
}

const ADMIN = { authorization: 'Bearer boss' };

describe('ADM-1 · кто такой администратор', () => {
  it('список читается из окружения, регистр не важен, мусор не расширяет его', () => {
    expect(adminLoginsFromEnv('Alice, bob')).toEqual(new Set(['alice', 'bob']));
    expect(adminLoginsFromEnv('alice bob')).toEqual(new Set(['alice', 'bob']));
    // Висящая запятая — НЕ пустой администратор: иначе опечатка в env впустила бы
    // любого, кто пришлёт пустой логин.
    expect(adminLoginsFromEnv('alice,')).toEqual(new Set(['alice']));
    expect(adminLoginsFromEnv('')).toEqual(new Set());
    expect(adminLoginsFromEnv(undefined)).toEqual(new Set());
  });

  it('логин сверяется без учёта регистра — учётки дедуплятся так же', () => {
    const admins = adminLoginsFromEnv('Boss');
    expect(isAdmin('boss', admins)).toBe(true);
    expect(isAdmin('BOSS', admins)).toBe(true);
    expect(isAdmin('bo', admins)).toBe(false);
  });

  // Решение 2: пустой список — это ОТСУТСТВИЕ поверхности, а не дверь с отказом.
  it('без администраторов маршруты не монтируются вовсе', async () => {
    const server = adminApp(await world(), []);
    for (const url of ['/admin/whoami', '/admin/matches/m1/roster']) {
      expect((await server.inject({ method: 'GET', url, headers: ADMIN })).statusCode).toBe(404);
    }
    const kick = await server.inject({
      method: 'POST',
      url: '/admin/matches/m1/kick',
      headers: ADMIN,
      payload: { nick: 'griefer' },
    });
    expect(kick.statusCode).toBe(404);
  });

  it('без сессии — 401, с чужой сессией — 403', async () => {
    const server = adminApp(await world(), ['boss']);
    const anon = await server.inject({ method: 'GET', url: '/admin/whoami' });
    expect(anon.statusCode).toBe(401);
    const other = await server.inject({
      method: 'GET',
      url: '/admin/whoami',
      headers: { authorization: 'Bearer griefer' },
    });
    expect(other.statusCode).toBe(403);
    const ok = await server.inject({ method: 'GET', url: '/admin/whoami', headers: ADMIN });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ login: 'boss', admin: true });
  });

  // Полномочие — у УЧЁТКИ, которая носила логин к запуску сервера, а не у любого, кто
  // назовётся этим логином потом: логин из списка, ещё не занятый (или стёртый вместе с
  // памятью хоста при рестарте), мог бы зарегистрировать кто угодно.
  it('логин, которого не было к запуску, полномочий не даёт — даже зарегистрированный позже', async () => {
    const server = adminApp(await world(), ['boss'], new Map());
    const late = await server.inject({ method: 'GET', url: '/admin/whoami', headers: ADMIN });
    expect(late.statusCode).toBe(403);
  });

  it('другая учётка под тем же логином (в любом регистре) — не администратор', async () => {
    const server = adminApp(await world(), ['boss'], new Map([['boss', 'acct:boss']]));
    for (const bearer of ['Bearer boss@acct:other', 'Bearer BOSS@acct:other']) {
      const r = await server.inject({
        method: 'GET',
        url: '/admin/whoami',
        headers: { authorization: bearer },
      });
      expect(r.statusCode, bearer).toBe(403);
    }
    const ok = await server.inject({ method: 'GET', url: '/admin/whoami', headers: ADMIN });
    expect(ok.statusCode).toBe(200);
  });
});

describe('ADM-1 · состав матча', () => {
  it('показывает позывной, закрепление и присутствие на связи', async () => {
    const w = await world();
    w.room.addPeer('green', fakePeer());
    const server = adminApp(w, ['boss']);
    const r = await server.inject({ method: 'GET', url: '/admin/matches/m1/roster', headers: ADMIN });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { seats: Array<{ playerId: string; nick: string | null; seated: boolean; connected: boolean }> };
    const green = body.seats.find((s) => s.playerId === 'green');
    expect(green).toMatchObject({ nick: 'griefer', seated: true, connected: true });
    // Свободные кресла видно как свободные — иначе администратор не поймёт, куда
    // сможет сесть новый игрок после кика.
    expect(body.seats.some((s) => s.nick === null)).toBe(true);
  });

  it('несуществующий матч — 404', async () => {
    const server = adminApp(await world(), ['boss']);
    const r = await server.inject({ method: 'GET', url: '/admin/matches/nope/roster', headers: ADMIN });
    expect(r.statusCode).toBe(404);
  });
});

describe('ADM-1 · кик', () => {
  it('закреплённый хостом ИИ-командир возвращает 409 со своим кодом отказа', async () => {
    const w = await world('~Orion');
    const server = adminApp(w, ['boss'], 'all', async () => ({
      ok: false,
      code: 'E_BOT_SEAT_LOCKED',
    }));
    const res = await server.inject({
      method: 'POST',
      url: '/admin/matches/m1/kick',
      headers: ADMIN,
      payload: { nick: '~Orion' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'E_BOT_SEAT_LOCKED' });
    expect(await w.accounts.seatOf('m1', '~Orion')).toBe('green');
    expect(w.room.state.players.green?.seated).toBe(true);
  });

  it('освобождает кресло во ВСЕХ трёх слоях и называет причину снятому', async () => {
    const w = await world();
    const peer = fakePeer();
    w.room.addPeer('green', peer);
    const server = adminApp(w, ['boss']);

    const r = await server.inject({
      method: 'POST',
      url: '/admin/matches/m1/kick',
      headers: ADMIN,
      payload: { nick: 'griefer' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, playerId: 'green', closed: 1 });

    // 1. Ядро: место больше не закреплено — значит, заявляемо снова.
    expect(w.room.state.players['green']?.seated).toBeUndefined();
    expect(w.room.state.players['green']?.claimedAt).toBeUndefined();
    // 2. Стор: позывной отвязан, кресло достаётся следующему.
    expect(await w.accounts.seatOf('m1', 'griefer')).toBeNull();
    expect((await w.accounts.resolveSeat('m1', 'newbie', ['green'], 'green'))?.playerId).toBe('green');
    // 3. Транспорт: причина названа кадром, потом закрытие.
    expect(peer.sent.some((m) => m.includes('E_KICKED'))).toBe(true);
    expect(peer.closedWith).toEqual(['E_KICKED']);
    // Империя осталась на карте: снят человек, а не сторона.
    expect(w.room.state.players['green']).toBeDefined();
  });

  it('снять можно и того, кто уже ушёл со связи — кик про кресло, а не про сокет', async () => {
    const w = await world();
    const server = adminApp(w, ['boss']);
    const r = await server.inject({
      method: 'POST',
      url: '/admin/matches/m1/kick',
      headers: ADMIN,
      payload: { nick: 'griefer' },
    });
    expect(r.json()).toEqual({ ok: true, playerId: 'green', closed: 0 });
  });

  it('пустое кресло — 409, повтор кика тоже: состав у администратора устарел', async () => {
    const w = await world();
    const server = adminApp(w, ['boss']);
    const kick = (): Promise<{ statusCode: number; json(): unknown }> =>
      server.inject({
        method: 'POST',
        url: '/admin/matches/m1/kick',
        headers: ADMIN,
        payload: { nick: 'griefer' },
      });
    expect((await kick()).statusCode).toBe(200);
    const again = await kick();
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'E_NOT_SEATED' });
  });

  it('неизвестный матч — 404, пустой позывной — 400', async () => {
    const w = await world();
    const server = adminApp(w, ['boss']);
    const noMatch = await server.inject({
      method: 'POST',
      url: '/admin/matches/nope/kick',
      headers: ADMIN,
      payload: { nick: 'griefer' },
    });
    expect(noMatch.statusCode).toBe(404);
    const bad = await server.inject({
      method: 'POST',
      url: '/admin/matches/m1/kick',
      headers: ADMIN,
      payload: { nick: '  ' },
    });
    expect(bad.statusCode).toBe(400);
  });

  // Регрессия ЖИВОГО прогона: кик отработал во всех трёх слоях, новый игрок сел в
  // кресло — и не закрепился. Идентификатор `seat-claim:<матч>:<место>` совпал с
  // квитанцией предыдущего владельца, комната вернула кэшированный успех, ничего не
  // применив: в сторе место занято, в состоянии — незаявлено. Ловится только через
  // комнату: у ядра квитанций нет, поэтому модульные тесты кика это пропускали.
  it('кресло после кика ДЕЙСТВИТЕЛЬНО переиспользуемо — заявка нового игрока применяется', async () => {
    const w = await world();
    const server = adminApp(w, ['boss']);
    await server.inject({
      method: 'POST',
      url: '/admin/matches/m1/kick',
      headers: ADMIN,
      payload: { nick: 'griefer' },
    });

    // Тот же путь, каким входит настоящий игрок: заявка, потом подтверждение.
    const room = w.room;
    const freedAt = room.state.players['green']?.freedAt;
    expect(freedAt, 'кик обязан пометить кресло освободившимся').toBeDefined();
    await w.accounts.resolveSeat('m1', 'newbie', ['green'], 'green');
    const claim = await room.submitServerAction(
      'green',
      seatClaimAction('m1', 'green', room.state.time, {}, freedAt),
    );
    expect(claim.ok).toBe(true);
    expect(room.state.players['green']?.claimedAt, 'заявка применена, а не дедуплена').toBeDefined();

    const confirmed = await room.submitServerAction(
      'green',
      seatConfirmAction('m1', 'green', room.state.time, room.state.players['green']?.claimedAt),
    );
    expect(confirmed.ok).toBe(true);
    expect(room.state.players['green']?.seated, 'новый игрок закрепился в кресле').toBe(true);
  });

  it('повторный вход ОДНОГО игрока по-прежнему дедуплится — id не стал случайным', async () => {
    const w = await world();
    const room = w.room;
    const claimedAt = room.state.players['green']?.claimedAt;
    // Второе подтверждение тем же id — кэшированная квитанция, не новое применение.
    const again = await room.submitServerAction(
      'green',
      seatConfirmAction('m1', 'green', room.state.time, claimedAt),
    );
    expect(again.ok).toBe(true);
    expect(room.state.players['green']?.claimedAt).toBe(claimedAt);
    // И повтор ЗАЯВКИ тем же id не заводит вторую: кресло не освобождали, поколения нет.
    const reclaim = await room.submitServerAction(
      'green',
      seatClaimAction('m1', 'green', room.state.time, {}, room.state.players['green']?.freedAt),
    );
    expect(reclaim.ok).toBe(true);
    expect(room.state.players['green']?.seated).toBe(true);
  });

  it('чужая сессия кикнуть не может — место остаётся за игроком', async () => {
    const w = await world();
    const server = adminApp(w, ['boss']);
    const r = await server.inject({
      method: 'POST',
      url: '/admin/matches/m1/kick',
      headers: { authorization: 'Bearer griefer' },
      payload: { nick: 'griefer' },
    });
    expect(r.statusCode).toBe(403);
    expect(await w.accounts.seatOf('m1', 'griefer')).toBe('green');
    expect(w.room.state.players['green']?.seated).toBe(true);
  });
});

// CORP-1 — объявления ленты новостей: публикует и снимает администратор, видит любой.
describe('CORP-1 · объявления в ленте', () => {
  let clock = 1_000;

  /** Админский слайс + публичная лента над одним хранилищем объявлений. */
  function newsApp(announcements?: MemoryAnnouncementStore): FastifyInstance {
    app = Fastify();
    registerAdminApi(app, {
      admins: new Set(['boss']),
      users: { findUser: (login) => Promise.resolve({ userId: `acct:${login}`, login, passHash: 'x' }) },
      identify: (request) => {
        const raw = request.headers.authorization;
        const login = typeof raw === 'string' ? raw.replace(/^Bearer /, '') : '';
        return Promise.resolve(login ? { accountId: `acct:${login}`, login } : null);
      },
      roster: () => Promise.resolve(null),
      kick: () => Promise.resolve({ ok: false as const, code: 'E_NO_MATCH' as const }),
      ...(announcements ? { announcements, now: () => clock } : {}),
    });
    registerNewsApi(app, {
      feed: new MemoryAvaFeedStore(),
      announcements: announcements ?? new MemoryAnnouncementStore(),
      now: () => clock,
    });
    return app;
  }

  const shown = async (server: FastifyInstance): Promise<string[]> =>
    (await server.inject({ method: 'GET', url: '/news' })).json<NewsView>().announcements.map((a) => a.title.ru);

  async function publish(server: FastifyInstance, payload: object, who = 'boss') {
    return server.inject({
      method: 'POST',
      url: '/admin/news',
      headers: { authorization: `Bearer ${who}` },
      payload,
    });
  }

  it('без хранилища объявлений маршрутов нет', async () => {
    const server = newsApp();
    const r = await server.inject({ method: 'GET', url: '/admin/news', headers: ADMIN });
    expect(r.statusCode).toBe(404);
  });

  it('публикует и снимает только администратор', async () => {
    const store = new MemoryAnnouncementStore();
    const server = newsApp(store);
    const draft = { kind: 'event', title: { ru: 'Турнир' } };
    expect((await server.inject({ method: 'POST', url: '/admin/news', payload: draft })).statusCode).toBe(401);
    expect((await publish(server, draft, 'player')).statusCode).toBe(403);
    await store.add({
      id: 'n1',
      at: 1,
      kind: 'update',
      pinned: false,
      until: null,
      title: { ru: 'Обновление', en: '' },
      body: { ru: '', en: '' },
    });
    const remove = await server.inject({
      method: 'POST',
      url: '/admin/news/n1/remove',
      headers: { authorization: 'Bearer player' },
    });
    expect(remove.statusCode).toBe(403);
    expect(await shown(server)).toEqual(['Обновление']);
  });

  it('опубликованное видно в ленте до срока, снятое пропадает', async () => {
    clock = 1_000;
    const server = newsApp(new MemoryAnnouncementStore());
    const made = await publish(server, {
      kind: 'tech',
      pinned: true,
      until: clock + 500,
      title: { ru: 'Техработы', en: 'Maintenance' },
      body: { ru: 'Сервер перезапустится.' },
    });
    expect(made.statusCode).toBe(201);
    const { announcement } = made.json<{ ok: true; announcement: NewsAnnouncement }>();
    expect(announcement).toMatchObject({ at: 1_000, kind: 'tech', pinned: true, until: 1_500 });
    expect(await shown(server)).toEqual(['Техработы']);

    clock = 1_500; // срок показа вышел: в ленте нет, у администратора — есть
    expect(await shown(server)).toEqual([]);
    const list = await server.inject({ method: 'GET', url: '/admin/news', headers: ADMIN });
    expect(list.json<{ announcements: NewsAnnouncement[] }>().announcements.map((a) => a.id)).toEqual([
      announcement.id,
    ]);

    const open = (await publish(server, { kind: 'update', title: { ru: 'Новая версия' } })).json<{
      announcement: NewsAnnouncement;
    }>().announcement;
    expect(await shown(server)).toEqual(['Новая версия']);
    const removeUrl = `/admin/news/${open.id}/remove`;
    const removed = await server.inject({ method: 'POST', url: removeUrl, headers: ADMIN });
    expect(removed.json()).toEqual({ ok: true });
    expect(await shown(server)).toEqual([]);
    const again = await server.inject({ method: 'POST', url: removeUrl, headers: ADMIN });
    expect(again.statusCode).toBe(404);
    expect(again.json()).toEqual({ error: 'E_NO_NEWS' });
  });

  it('кривое объявление — 400, и в ленту ничего не попадает', async () => {
    const server = newsApp(new MemoryAnnouncementStore());
    const bad = await publish(server, { kind: 'ad', title: { ru: 'Купи' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'E_BAD_NEWS' });
    expect(await shown(server)).toEqual([]);
  });
});
