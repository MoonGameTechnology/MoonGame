import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '@void/shared-core';
import { admitSeat, seatClaim, seatClaimAction, type JoinSeatInput } from './joinSeat';
import type { MatchRoom } from './matchRoom';
import { createDevMatch, loadShippedData } from './scenario';
import { MemoryAccountStore } from './store';

const KNOWN = ['azure', 'crimson', 'amber'] as const;
const input = (over: Partial<JoinSeatInput> = {}): JoinSeatInput => ({
  knownFactions: KNOWN,
  ...over,
});
const fresh = (playerId = 'p1'): JoinSeatInput['resolved'] => ({ playerId, isNew: true });
const returning = (playerId = 'p1'): JoinSeatInput['resolved'] => ({ playerId, isNew: false });

describe('seatClaim (ENTRY-1/ENTRY-3)', () => {
  it('сажает на место, которое вернул резолвер', () => {
    expect(seatClaim(input({ resolved: fresh('p3') }))).toEqual({
      ok: true,
      playerId: 'p3',
      claim: {},
    });
  });

  it('несёт выбранный дом в заявку', () => {
    expect(seatClaim(input({ resolved: fresh('p2'), preferredFaction: 'azure' }))).toEqual({
      ok: true,
      playerId: 'p2',
      claim: { faction: 'azure' },
    });
  });

  it('возврат на НЕзаявленное место — всё ещё первый захват: выбор применяется (правило 6)', () => {
    expect(
      seatClaim(input({ resolved: returning('p2'), claimed: false, preferredFaction: 'crimson' })),
    ).toEqual({ ok: true, playerId: 'p2', claim: { faction: 'crimson' } });
    expect(
      seatClaim(input({ resolved: returning('p2'), claimed: false, preferredFaction: 'nope' })),
    ).toEqual({ ok: false, code: 'E_UNKNOWN_FACTION' });
  });

  it('на возврате в свой матч заявки нет — место уже заявлено (правило 2)', () => {
    expect(seatClaim(input({ resolved: returning('p2'), preferredFaction: 'crimson' }))).toEqual({
      ok: true,
      playerId: 'p2',
      claim: null,
    });
  });

  it('без свободного места — отказ, а не «посадим куда-нибудь» (правило 3)', () => {
    expect(seatClaim(input({ resolved: null, preferredFaction: 'azure' }))).toEqual({
      ok: false,
      code: 'E_MATCH_FULL',
    });
    expect(seatClaim(input())).toEqual({ ok: false, code: 'E_MATCH_FULL' });
  });

  describe('правило 5 — заявка подаётся и без выбора', () => {
    it('новый захват без дома всё равно даёт заявку: она замок, а не запись выбора', () => {
      expect(seatClaim(input({ resolved: fresh() }))).toEqual({
        ok: true,
        playerId: 'p1',
        claim: {},
      });
    });

    it('пустая строка дома — тоже «не выбирал», но заявка есть', () => {
      expect(seatClaim(input({ resolved: fresh(), preferredFaction: '' }))).toEqual({
        ok: true,
        playerId: 'p1',
        claim: {},
      });
    });
  });

  describe('AvA (правило 1)', () => {
    it('место берётся из ростера, резолвер не спрашивается', () => {
      expect(seatClaim(input({ avaPlayerId: 'p5', resolved: fresh() }))).toEqual({
        ok: true,
        playerId: 'p5',
        claim: {},
      });
    });

    it('выбор дома не применяется — заявка пустая, решает ростер', () => {
      expect(seatClaim(input({ avaPlayerId: 'p5', preferredFaction: 'azure' }))).toEqual({
        ok: true,
        playerId: 'p5',
        claim: {},
      });
    });

    it('неизвестный дом на AvA-месте не мешает войти — он там и не применяется', () => {
      expect(seatClaim(input({ avaPlayerId: 'p7', preferredFaction: 'not-a-house' }))).toEqual({
        ok: true,
        playerId: 'p7',
        claim: {},
      });
    });
  });

  describe('каталог домов (правило 4)', () => {
    it('неизвестный дом — отказ, а не тихая посадка с домом по умолчанию', () => {
      expect(seatClaim(input({ resolved: fresh(), preferredFaction: 'not-a-house' }))).toEqual({
        ok: false,
        code: 'E_UNKNOWN_FACTION',
      });
    });

    it('пустой каталог отвергает любой выбор — fail-secure, а не «раз списка нет, пускаем всё»', () => {
      expect(
        seatClaim({ knownFactions: [], resolved: fresh(), preferredFaction: 'azure' }),
      ).toEqual({ ok: false, code: 'E_UNKNOWN_FACTION' });
    });

    // Вторая половина правила 4: сверяем ТОЛЬКО там, где дом применяется. Иначе стухший
    // `&faction=` в закладке запирал бы игрока в его же матче.
    it('на возврате неизвестный дом не запирает вход', () => {
      expect(
        seatClaim(input({ resolved: returning('p2'), preferredFaction: 'not-a-house' })),
      ).toEqual({ ok: true, playerId: 'p2', claim: null });
    });
  });

  // Тот самый баг, ради которого модуль и заведён: реализация принимала три параметра
  // вместо пяти и молча теряла `faction`. Проверяем НАБЛЮДАЕМОЕ следствие — что выбор
  // игрока доходит до решения. Две попытки отличаются ровно наличием `faction`.
  it('выбор дома не теряется по дороге — пришёл, значит учтён', () => {
    expect(seatClaim(input({ resolved: fresh() }))).toEqual({
      ok: true,
      playerId: 'p1',
      claim: {},
    });
    expect(seatClaim(input({ resolved: fresh(), preferredFaction: 'azure' }))).toEqual({
      ok: true,
      playerId: 'p1',
      claim: { faction: 'azure' },
    });
  });
});

// PT-09 (плейтест 2026-10-09): отказ входа оставлял кресло занятым навсегда. Проверяем на
// настоящей комнате и настоящем сторе мест — ровно ту цепочку, что делают оба хоста:
// бронь резолвером → решение `seatClaim` → `admitSeat`.
describe('admitSeat — отказ не оставляет кресла (PT-09)', () => {
  let data: GameData;
  beforeAll(() => {
    data = loadShippedData();
  });

  async function join(
    room: MatchRoom,
    accounts: MemoryAccountStore,
    login: string,
    choice: { faction?: string; scientists?: string[] } = {},
  ) {
    const held = await accounts.seatOf('m1', login);
    const resolved = held
      ? { playerId: held, isNew: false }
      : await accounts.resolveSeat('m1', login, Object.keys(room.state.players));
    const claim = seatClaim({
      resolved,
      claimed: resolved ? room.state.players[resolved.playerId]?.claimedAt !== undefined : undefined,
      preferredFaction: choice.faction,
      knownFactions: [...new Set(Object.values(room.state.players).map((p) => p.faction))],
    });
    return admitSeat({
      matchId: 'm1',
      claim,
      reserved: resolved?.isNew === true,
      release: () => accounts.releaseSeat('m1', login),
      room,
      scientists: choice.scientists,
    });
  }

  function setup() {
    // Часы заморожены — иначе догон до сегодняшнего дня завершает матч по очкам.
    const room = createDevMatch(data, { id: 'm1', now: () => 1_000 });
    return { room, accounts: new MemoryAccountStore() };
  }

  it('неизвестный дом: отказ и кресло свободно', async () => {
    const { room, accounts } = setup();
    expect(await join(room, accounts, 'ann', { faction: 'nope' })).toEqual({
      ok: false,
      error: 'E_UNKNOWN_FACTION',
    });
    expect(await accounts.seatOf('m1', 'ann')).toBeNull();
    expect(await accounts.occupiedSeats('m1')).toBe(0);
  });

  it('ядро отбило совет: отказ с причиной, кресло свободно, заявки в состоянии нет', async () => {
    const { room, accounts } = setup();
    expect(await join(room, accounts, 'ann', { scientists: ['nobody'] })).toEqual({
      ok: false,
      error: 'E_CLAIM_REFUSED',
      reason: 'E_UNKNOWN_SCIENTIST',
    });
    expect(await accounts.seatOf('m1', 'ann')).toBeNull();
    expect(Object.values(room.state.players).some((p) => p.claimedAt !== undefined)).toBe(false);
  });

  it('исправленный повтор садится с выбором — отказ не застрял в квитанциях', async () => {
    const { room, accounts } = setup();
    const faction = Object.values(room.state.players)[1]!.faction;
    await join(room, accounts, 'ann', { faction, scientists: ['nobody'] });
    const seat = await join(room, accounts, 'ann', { faction, scientists: ['polymath'] });
    expect(seat.ok).toBe(true);
    const id = seat.ok ? seat.playerId : '';
    expect(await accounts.seatOf('m1', 'ann')).toBe(id);
    expect(room.state.players[id]?.claimedAt).toBeDefined();
    expect(room.state.players[id]?.faction).toBe(faction);
    expect(room.state.players[id]?.scientists?.map((s) => s.id)).toEqual(['polymath']);
  });

  it('кресло с бронью, но без заявки, вход доводит до заявки с выбором (правило 6)', async () => {
    const { room, accounts } = setup();
    // Так оставлял кресло прежний код: бронь в сторе есть, заявки в ядре нет.
    const orphan = await accounts.resolveSeat('m1', 'ann', Object.keys(room.state.players));
    const faction = Object.values(room.state.players).find((p) => p.id !== orphan!.playerId)!.faction;
    expect(await join(room, accounts, 'ann', { faction })).toEqual({
      ok: true,
      playerId: orphan!.playerId,
    });
    expect(room.state.players[orphan!.playerId]?.claimedAt).toBeDefined();
    expect(room.state.players[orphan!.playerId]?.faction).toBe(faction);
  });

  it('отказ на возврате не отнимает кресло, которое логин уже держал', async () => {
    const { room, accounts } = setup();
    const orphan = await accounts.resolveSeat('m1', 'ann', Object.keys(room.state.players));
    expect(await join(room, accounts, 'ann', { scientists: ['nobody'] })).toMatchObject({
      ok: false,
      error: 'E_CLAIM_REFUSED',
    });
    expect(await accounts.seatOf('m1', 'ann')).toBe(orphan!.playerId);
  });

  it('заявленное место на возврате заявку не подаёт — дом не переписывается', async () => {
    const { room, accounts } = setup();
    const first = await join(room, accounts, 'ann');
    const id = first.ok ? first.playerId : '';
    const before = room.state.players[id]!.faction;
    const other = Object.values(room.state.players).find((p) => p.faction !== before)!.faction;
    expect(await join(room, accounts, 'ann', { faction: other })).toEqual({ ok: true, playerId: id });
    expect(room.state.players[id]!.faction).toBe(before);
  });

  it('комнаты нет — вход без заявки, как и раньше: кресло за игроком', async () => {
    const accounts = new MemoryAccountStore();
    await accounts.resolveSeat('m1', 'ann', ['green', 'red']);
    expect(
      await admitSeat({
        matchId: 'm1',
        claim: { ok: true, playerId: 'green', claim: {} },
        reserved: true,
        release: () => accounts.releaseSeat('m1', 'ann'),
        room: null,
      }),
    ).toEqual({ ok: true, playerId: 'green' });
    expect(await accounts.seatOf('m1', 'ann')).toBe('green');
  });

  it('подача отбита после черновика — тоже отказ входа и снятая бронь', async () => {
    const { room, accounts } = setup();
    await accounts.resolveSeat('m1', 'ann', ['green']);
    // Квитанция с отказом под тем же id — так комната ответит из кэша.
    const stale = seatClaimAction('m1', 'green', room.state.time, {});
    await room.submitServerAction('green', { ...stale, payload: { scientists: ['nobody'] } });
    expect(
      await admitSeat({
        matchId: 'm1',
        claim: { ok: true, playerId: 'green', claim: {} },
        reserved: true,
        release: () => accounts.releaseSeat('m1', 'ann'),
        room,
      }),
    ).toEqual({ ok: false, error: 'E_CLAIM_REFUSED', reason: 'E_UNKNOWN_SCIENTIST' });
    expect(await accounts.seatOf('m1', 'ann')).toBeNull();
  });
});
