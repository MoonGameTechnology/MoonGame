import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { MS_PER_DAY, type GameData } from '@void/shared-core';
import { registerAdminApi, adminLoginsFromEnv, isAdmin } from './adminApi';
import { kickSeat } from './seatKick';
import { seatClaimAction, seatConfirmAction } from './joinSeat';
import { MatchRegistry } from './matchRegistry';
import { MemoryAccountStore } from './store';
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

/** Сервер с админским API. Личность — как в остальных тестах: логин в `Bearer`. */
function adminApp(w: World, admins: string[]): FastifyInstance {
  app = Fastify();
  registerAdminApi(app, {
    admins: new Set(admins),
    identify: (request) => {
      const raw = request.headers.authorization;
      const login = typeof raw === 'string' ? raw.replace(/^Bearer /, '') : '';
      return Promise.resolve(login ? { accountId: `acct:${login}`, login } : null);
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
    kick: (id, nick) => kickSeat({ matchId: id, room: w.registry.get(id), accounts: w.accounts }, nick),
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
