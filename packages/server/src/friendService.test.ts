import { describe, expect, it } from 'vitest';
import { FriendService } from './friendService';
import { MemoryFriendStore, MemoryUserStore } from './store';

/**
 * FRIENDS-1 — the social-graph rules. Each test states a rule a client must NOT be
 * able to talk the server out of (invariant #5): the client asks, the server decides.
 */

async function world(logins: string[]) {
  const users = new MemoryUserStore();
  const ids: Record<string, string> = {};
  for (const login of logins) {
    const made = await users.createUser(login, 'hash');
    if (!made.ok) throw new Error(made.code);
    ids[login] = made.userId;
  }
  const friends = new MemoryFriendStore();
  let clock = 1_000;
  const service = new FriendService({ friends, users, now: () => ++clock });
  const who = (login: string) => ({ accountId: ids[login]!, login });
  return { service, friends, users, ids, who };
}

describe('FRIENDS-1 — заявка', () => {
  it('заявка по позывному находит аккаунт независимо от регистра', async () => {
    const w = await world(['Vasya', 'Petya']);
    expect(await w.service.request(w.who('Vasya'), 'PETYA')).toEqual({ ok: true });
    const mine = await w.service.list(w.ids.Vasya!);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.kind).toBe('outgoing');
    // Та же строка — у второго это ВХОДЯЩАЯ: одна строка, два прочтения.
    const theirs = await w.service.list(w.ids.Petya!);
    expect(theirs[0]!.kind).toBe('incoming');
    expect(theirs[0]!.login).toBe('Vasya');
  });

  it('себя в друзья не добавить', async () => {
    const w = await world(['Vasya']);
    expect(await w.service.request(w.who('Vasya'), 'vasya')).toEqual({ ok: false, code: 'E_SELF' });
  });

  it('несуществующий позывной — E_NO_ACCOUNT, и ребра не появляется', async () => {
    const w = await world(['Vasya']);
    expect(await w.service.request(w.who('Vasya'), 'Никого')).toEqual({
      ok: false,
      code: 'E_NO_ACCOUNT',
    });
    expect(await w.service.list(w.ids.Vasya!)).toHaveLength(0);
  });

  it('пустой позывной отсекается до похода в хранилище', async () => {
    const w = await world(['Vasya']);
    expect(await w.service.request(w.who('Vasya'), '   ')).toEqual({
      ok: false,
      code: 'E_BAD_TARGET',
    });
  });

  it('ВСТРЕЧНАЯ заявка не создаёт второе ребро — пара всегда одна строка', async () => {
    const w = await world(['Vasya', 'Petya']);
    await w.service.request(w.who('Vasya'), 'Petya');
    expect(await w.service.request(w.who('Petya'), 'Vasya')).toEqual({
      ok: false,
      code: 'E_EXISTS',
    });
    expect(await w.service.list(w.ids.Petya!)).toHaveLength(1);
  });

  it('повторная заявка уже другу — E_EXISTS', async () => {
    const w = await world(['Vasya', 'Petya']);
    await w.service.request(w.who('Vasya'), 'Petya');
    await w.service.accept(w.ids.Petya!, w.ids.Vasya!);
    expect(await w.service.request(w.who('Vasya'), 'Petya')).toEqual({
      ok: false,
      code: 'E_EXISTS',
    });
  });
});

describe('FRIENDS-1 — принятие', () => {
  it('принимает только ТА сторона, которую попросили', async () => {
    const w = await world(['Vasya', 'Petya']);
    await w.service.request(w.who('Vasya'), 'Petya');
    // Проситель не может принять сам себя — иначе дружба выдаётся в один клик.
    expect(await w.service.accept(w.ids.Vasya!, w.ids.Petya!)).toEqual({
      ok: false,
      code: 'E_NO_EDGE',
    });
    expect(await w.service.accept(w.ids.Petya!, w.ids.Vasya!)).toEqual({ ok: true });
    expect((await w.service.list(w.ids.Vasya!))[0]!.kind).toBe('friend');
    expect((await w.service.list(w.ids.Petya!))[0]!.kind).toBe('friend');
  });

  it('принять несуществующую заявку нельзя, и дважды — тоже', async () => {
    const w = await world(['Vasya', 'Petya']);
    expect(await w.service.accept(w.ids.Petya!, w.ids.Vasya!)).toEqual({
      ok: false,
      code: 'E_NO_EDGE',
    });
    await w.service.request(w.who('Vasya'), 'Petya');
    await w.service.accept(w.ids.Petya!, w.ids.Vasya!);
    expect(await w.service.accept(w.ids.Petya!, w.ids.Vasya!)).toEqual({
      ok: false,
      code: 'E_NO_EDGE',
    });
  });
});

describe('FRIENDS-1 — одна операция на отклонить / отозвать / удалить', () => {
  it('отклонить входящую', async () => {
    const w = await world(['Vasya', 'Petya']);
    await w.service.request(w.who('Vasya'), 'Petya');
    expect(await w.service.drop(w.ids.Petya!, w.ids.Vasya!)).toEqual({ ok: true });
    expect(await w.service.list(w.ids.Vasya!)).toHaveLength(0);
  });

  it('отозвать свою исходящую', async () => {
    const w = await world(['Vasya', 'Petya']);
    await w.service.request(w.who('Vasya'), 'Petya');
    expect(await w.service.drop(w.ids.Vasya!, w.ids.Petya!)).toEqual({ ok: true });
    expect(await w.service.list(w.ids.Petya!)).toHaveLength(0);
  });

  it('удалить из друзей — с ОБЕИХ сторон разом', async () => {
    const w = await world(['Vasya', 'Petya']);
    await w.service.request(w.who('Vasya'), 'Petya');
    await w.service.accept(w.ids.Petya!, w.ids.Vasya!);
    expect(await w.service.drop(w.ids.Vasya!, w.ids.Petya!)).toEqual({ ok: true });
    expect(await w.service.list(w.ids.Vasya!)).toHaveLength(0);
    expect(await w.service.list(w.ids.Petya!)).toHaveLength(0);
  });

  it('снятие несуществующего ребра — E_NO_EDGE, а не тихий успех', async () => {
    const w = await world(['Vasya', 'Petya']);
    expect(await w.service.drop(w.ids.Vasya!, w.ids.Petya!)).toEqual({
      ok: false,
      code: 'E_NO_EDGE',
    });
  });

  it('после удаления можно подружиться заново', async () => {
    const w = await world(['Vasya', 'Petya']);
    await w.service.request(w.who('Vasya'), 'Petya');
    await w.service.accept(w.ids.Petya!, w.ids.Vasya!);
    await w.service.drop(w.ids.Vasya!, w.ids.Petya!);
    expect(await w.service.request(w.who('Petya'), 'Vasya')).toEqual({ ok: true });
  });
});

describe('FRIENDS-1 — предел списка', () => {
  it('на пределе новых заявок не отправить, а ВХОДЯЩИЕ не принять', async () => {
    const users = new MemoryUserStore();
    const mk = async (login: string): Promise<string> => {
      const r = await users.createUser(login, 'h');
      if (!r.ok) throw new Error(r.code);
      return r.userId;
    };
    const me = await mk('Me');
    const a = await mk('A');
    const b = await mk('B');
    const friends = new MemoryFriendStore();
    const service = new FriendService({ friends, users, limit: 1, now: () => 1 });
    // Один принятый друг — предел выбран.
    await service.request({ accountId: me, login: 'Me' }, 'A');
    await service.accept(a, me);
    expect(await service.request({ accountId: me, login: 'Me' }, 'B')).toEqual({
      ok: false,
      code: 'E_LIMIT',
    });
    // Чужая заявка приходит (её шлёт ДРУГОЙ, у него свой лимит), но принять нельзя.
    await service.request({ accountId: b, login: 'B' }, 'Me');
    expect(await service.accept(me, b)).toEqual({ ok: false, code: 'E_LIMIT' });
  });

  it('незакрытые заявки места не занимают', async () => {
    const users = new MemoryUserStore();
    for (const l of ['Me', 'A', 'B']) await users.createUser(l, 'h');
    const me = (await users.findUser('Me'))!.userId;
    const friends = new MemoryFriendStore();
    const service = new FriendService({ friends, users, limit: 1, now: () => 1 });
    await service.request({ accountId: me, login: 'Me' }, 'A'); // висит исходящей
    expect(await service.request({ accountId: me, login: 'Me' }, 'B')).toEqual({ ok: true });
  });
});
