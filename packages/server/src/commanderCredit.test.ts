import { describe, expect, it } from 'vitest';
import {
  creditCommanderXp,
  nickSeatAccounts,
  ordinaryMatchExtras,
  type SeatAccounts,
} from './commanderCredit';
import type { PlayerId } from '@void/shared-core';

interface Credited {
  matchId: string;
  rows: ReadonlyArray<{ accountId: string; xp: number }>;
}

/** Стор наград в том объёме, который читает начисление. */
function commanders(): { store: { creditMatch: (m: string, r: ReadonlyArray<{ accountId: string; xp: number }>) => Promise<boolean> }; credited: Credited[] } {
  const credited: Credited[] = [];
  return {
    credited,
    store: {
      creditMatch: async (matchId, rows) => {
        credited.push({ matchId, rows });
        return true;
      },
    },
  };
}

const seats = (map: Record<string, string>): SeatAccounts => async () => map;

describe('банковка опыта командира (SES-2)', () => {
  it('НАЧИСЛЯЕТ ЛЮБОЙ МАТЧ, а не только AvA', async () => {
    // Ровно та дыра, которую кирпич закрывает: на боевом сервере начисление висело
    // внутри AvA-ветки `matchExtras`, а у обычного матча `extras` = null — рядовая
    // партия заканчивалась, и пожизненный опыт аккаунта не двигался.
    const { store, credited } = commanders();
    expect(await creditCommanderXp(store, seats({ p1: 'acc-1' }), 'm-1', { p1: { xp: 40 } })).toBe(true);
    expect(credited).toEqual([{ matchId: 'm-1', rows: [{ accountId: 'acc-1', xp: 40 }] }]);
  });

  it('место без аккаунта не начисляется — его нет в карте мест', async () => {
    const { store, credited } = commanders();
    await creditCommanderXp(store, seats({ p1: 'acc-1' }), 'm-1', { p1: { xp: 40 }, p2: { xp: 10 } });
    expect(credited).toEqual([{ matchId: 'm-1', rows: [{ accountId: 'acc-1', xp: 40 }] }]);
  });

  it('НУЛЕВОЙ ОПЫТ НЕ ПИШЕТСЯ: строка «начислили ноль» — шум, а не запись', async () => {
    const { store, credited } = commanders();
    await creditCommanderXp(store, seats({ p1: 'acc-1', p2: 'acc-2' }), 'm-1', {
      p1: { xp: 0 },
      p2: { xp: 7 },
    });
    expect(credited).toEqual([{ matchId: 'm-1', rows: [{ accountId: 'acc-2', xp: 7 }] }]);
  });

  it('НЕЧЕГО НАЧИСЛЯТЬ — СТОР НЕ ЗОВЁМ ВОВСЕ', async () => {
    // Иначе матч получил бы durable-метку «начислен», не начислив ничего: следующая
    // попытка (после починки маппинга мест) была бы отклонена стором как повтор.
    const { store, credited } = commanders();
    expect(await creditCommanderXp(store, seats({}), 'm-1', { p1: { xp: 40 } })).toBe(false);
    expect(await creditCommanderXp(store, seats({ p1: 'acc-1' }), 'm-1', {})).toBe(false);
    expect(credited).toEqual([]);
  });

  it('матч без таблицы наград не трогает ни стора, ни резолвера', async () => {
    const { store, credited } = commanders();
    let asked = false;
    const resolver: SeatAccounts = async () => {
      asked = true;
      return { p1: 'acc-1' };
    };
    expect(await creditCommanderXp(store, resolver, 'm-1', undefined)).toBe(false);
    expect([asked, credited]).toEqual([false, []]);
  });
});

describe('кто сидит за местом: резолвер по позывным (SES-2)', () => {
  const users = (accounts: Record<string, string>) => ({
    findUser: async (login: string) =>
      accounts[login] ? ({ userId: accounts[login] } as never) : null,
  });

  it('позывной места — логин аккаунта, поэтому мостик один', async () => {
    const accounts = {
      seatedNicks: async () => [
        { playerId: 'p1' as PlayerId, nick: 'ann' },
        { playerId: 'p2' as PlayerId, nick: 'bob' },
      ],
    };
    expect(await nickSeatAccounts(accounts, users({ ann: 'acc-1', bob: 'acc-2' }), 'm-1')()).toEqual({
      p1: 'acc-1',
      p2: 'acc-2',
    });
  });

  it('позывной без учётки (бот, ник-режим) в карту не попадает — это не ошибка', async () => {
    const accounts = {
      seatedNicks: async () => [
        { playerId: 'p1' as PlayerId, nick: 'ann' },
        { playerId: 'p2' as PlayerId, nick: 'bot' },
      ],
    };
    expect(await nickSeatAccounts(accounts, users({ ann: 'acc-1' }), 'm-1')()).toEqual({ p1: 'acc-1' });
  });
});

describe('обвязка ОБЫЧНОГО матча на боевом входе (SES-2)', () => {
  const storesFor = (credited: Credited[]) => ({
    accountStore: {
      seatedNicks: async () => [{ playerId: 'p1' as PlayerId, nick: 'ann' }],
    },
    userStore: { findUser: async () => ({ userId: 'acc-1' }) as never },
    commanderStore: {
      creditMatch: async (matchId: string, rows: ReadonlyArray<{ accountId: string; xp: number }>) => {
        credited.push({ matchId, rows });
        return true;
      },
    },
  });

  it('ОБЫЧНЫЙ МАТЧ ПОЛУЧАЕТ `onEnd`, а не `null`', async () => {
    // Дыра SES-2 была ровно такой: `matchExtras` возвращал `null` всему, что не AvA,
    // и у рядовой партии не было ни `onEnd`, ни шанса что-либо начислить. Тот же класс,
    // что ENTRY-1: хостовая обвязка молча роняла половину контракта.
    const credited: Credited[] = [];
    const extras = ordinaryMatchExtras(storesFor(credited), 'm-1', () => {});
    expect(typeof extras.onEnd).toBe('function');
    extras.onEnd(null, { p1: { place: 1, xp: 40 } });
    await new Promise((r) => setImmediate(r));
    expect(credited).toEqual([{ matchId: 'm-1', rows: [{ accountId: 'acc-1', xp: 40 }] }]);
  });

  it('сбой стора не роняет конец матча — он уезжает в лог', async () => {
    const messages: string[] = [];
    const stores = storesFor([]);
    stores.commanderStore.creditMatch = async () => {
      throw new Error('стор недоступен');
    };
    const extras = ordinaryMatchExtras(stores, 'm-1', (m) => messages.push(m));
    expect(() => extras.onEnd(null, { p1: { place: 1, xp: 40 } })).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(messages).toEqual(['commander xp credit failed for m-1 — стор недоступен']);
  });
});
