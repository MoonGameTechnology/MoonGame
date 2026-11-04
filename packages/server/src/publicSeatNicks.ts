import type { AccountStore, UserStore } from './store';
import { SYSTEM_BOT_NICKNAMES } from './botNicknames';

/** A null nick still occupies its seat. Authentication lookups already exclude
 * pending deletion; reuse that rule before publishing account callsigns. */
export async function publicSeatNicks(
  accounts: Pick<AccountStore, 'seatedNicks'>,
  users: Pick<UserStore, 'findUser'> | undefined,
  matchId: string,
): Promise<Map<string, string | null>> {
  const rows = await accounts.seatedNicks(matchId);
  return new Map(
    await Promise.all(
      rows.map(
        async ({ playerId, nick }) =>
          [
            playerId,
            !users ||
            SYSTEM_BOT_NICKNAMES.some((name) => name.toLowerCase() === nick.toLowerCase()) ||
            (await users.findUser(nick))
              ? nick
              : null,
          ] as const,
      ),
    ),
  );
}
