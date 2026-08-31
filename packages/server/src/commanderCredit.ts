/**
 * Начисление опыта командиру по итогам матча (SES-2, остаток кирпича).
 *
 * Ядро уже посчитало детерминированную таблицу наград (`state.match.rewards` — место и
 * XP на каждое занятое кресло); здесь она банкуется НА АККАУНТ, чтобы уровень командира
 * пережил смену устройства, в отличие от прототипного `localStorage` по позывному.
 *
 * 1. **Начисляется ЛЮБОЙ матч, а не только AvA.** Это и есть закрытая здесь дыра: на
 *    боевом входе начисление висело внутри AvA-ветки `matchExtras`, а у обычного матча
 *    `extras` = `null` — то есть рядовая партия заканчивалась, и пожизненный опыт
 *    аккаунта не двигался. Прототипный хост при этом начислял всегда, так что два хоста
 *    расходились ещё и здесь.
 * 2. **«Как узнать аккаунт места» и «как забанковать» — разные вопросы.** Ответ на
 *    первый зависит от матча: у обычного личность места — позывной (в режиме учёток он
 *    И ЕСТЬ логин: `GET /matches/:id/join` сажает под логином сессии), у AvA — ростер
 *    сессии, который знает и тех, кто ни разу не подключился, а значит не оставил
 *    посадочной записи. Поэтому резолвер — параметр, а правила банковки одни на всех:
 *    двух копий «начислить в конце матча» этот проект уже наелся (блок CONV).
 * 3. **Нулевой опыт не пишется.** Строка «начислили ноль» — шум в durable-сторе, а не
 *    запись; отрицательный тем более (таблица наград его не даёт, но контракт не должен
 *    на это опираться).
 * 4. **Нечего начислять — стор не зовём вовсе.** Иначе матч получил бы durable-метку
 *    «начислен», не начислив ничего, и следующая попытка (скажем, после починки
 *    маппинга мест) была бы отклонена стором как повтор.
 * 5. **Идемпотентность — забота стора.** `CommanderStore.creditMatch` держит метку
 *    «этот матч уже начислен» и переживает рестарт, который заново наблюдает тот же
 *    конец матча; дублировать этот замок здесь значило бы завести второй ответ на
 *    вопрос, у которого уже есть один.
 */

import type { PlayerReward } from '@void/shared-core';
import type { AccountStore, CommanderStore, UserStore } from './store';

/** Кто сидит за местами матча: `playerId` → `accountId` (правило 2). Места без
 *  аккаунта в карте просто отсутствуют — бот и ник-режим без учёток это норма. */
export type SeatAccounts = () => Promise<Record<string, string>>;

/** Резолвер по ПОЗЫВНЫМ — обычный матч в режиме учёток (правило 2). */
export function nickSeatAccounts(
  accounts: Pick<AccountStore, 'seatedNicks'>,
  users: Pick<UserStore, 'findUser'>,
  matchId: string,
): SeatAccounts {
  return async () => {
    const out: Record<string, string> = {};
    for (const { playerId, nick } of await accounts.seatedNicks(matchId)) {
      const user = await users.findUser(nick);
      if (user) out[playerId] = user.userId;
    }
    return out;
  };
}

/**
 * Забанковать награды матча на аккаунты. Возвращает `true`, если начисление
 * состоялось (вызывающему есть что залогировать), `false` — если начислять было нечего.
 */
export async function creditCommanderXp(
  commanders: Pick<CommanderStore, 'creditMatch'>,
  seatAccounts: SeatAccounts,
  matchId: string,
  rewards: Record<string, { xp: number }> | undefined,
): Promise<boolean> {
  if (!rewards) return false;
  const accounts = await seatAccounts();
  const rows: Array<{ accountId: string; xp: number }> = [];
  for (const [playerId, accountId] of Object.entries(accounts)) {
    const xp = rewards[playerId]?.xp ?? 0;
    if (xp > 0) rows.push({ accountId, xp }); // правило 3
  }
  if (rows.length === 0) return false; // правило 4
  await commanders.creditMatch(matchId, rows); // правило 5
  return true;
}

/** Обвязка обычного (не-AvA) матча: только банковка опыта (правило 1). */
export interface OrdinaryMatchStores {
  accountStore: Pick<AccountStore, 'seatedNicks'>;
  userStore: Pick<UserStore, 'findUser'>;
  commanderStore: Pick<CommanderStore, 'creditMatch'>;
}

/**
 * Что боевой вход подключает к ОБЫЧНОМУ матчу.
 *
 * Существует отдельной функцией, потому что дыра SES-2 была именно здесь и именно такой:
 * `matchExtras` возвращал `null` всему, что не AvA, — то есть у рядовой партии не было
 * ни `onEnd`, ни шанса что-либо начислить. Тот же класс ошибки, что ENTRY-1: хостовая
 * обвязка молча роняла half контракта, и тестов у неё не было. `null` отсюда не
 * возвращается никогда.
 */
export function ordinaryMatchExtras(
  stores: OrdinaryMatchStores,
  matchId: string,
  onError: (message: string) => void,
): { onEnd: (winner: string | null, rewards?: Record<string, PlayerReward>) => void } {
  const seats = nickSeatAccounts(stores.accountStore, stores.userStore, matchId);
  return {
    onEnd: (_winner, rewards) => {
      void creditCommanderXp(stores.commanderStore, seats, matchId, rewards).catch(
        (err: unknown) => {
          onError(
            `commander xp credit failed for ${matchId} — ${err instanceof Error ? err.message : String(err)}`,
          );
        },
      );
    },
  };
}
