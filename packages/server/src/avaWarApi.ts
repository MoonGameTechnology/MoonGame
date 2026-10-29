import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { GameData, GameState, VictoryRules } from '@void/shared-core';
import { avaWarView } from './avaBattleView';
import type { Identity } from './matchApi';
import type { AvaChallengeStore, AvaSessionStore, AvaSide, CorpStore, UserStore } from './store';

/**
 * CORP-9 — the war of one side, from the hub's «Битвы» tab.
 *
 *   GET /ava-war/:matchupId   the caller's side in its running battle (`AvaWarView`)
 *
 * Served by the host that runs the battle, the only one holding its state, so the route
 * stays outside `/ava`: a host with `CORPORATIONS_URL` forwards that prefix to the
 * corporations authority, which has no battles. Session-gated: the caller is a member, not
 * a recruit, of a corporation party to the matchup. What it shows of the rival is
 * `avaWarView`'s rule (`corporation-wars.md` §8).
 *
 * Codes: 401 `E_AUTH`, 404 `E_NO_CHALLENGE`, 403 `E_FORBIDDEN`, 404 `E_NO_BATTLE` — no
 * battle is running for the matchup: its roster is not locked yet, the battle is not
 * raised yet, or it is over and settled (its breakdown is in `/ava/battles`).
 */

export interface AvaWarApiDeps {
  /** Resolve the caller's identity from the session token — REQUIRED (no anon path). */
  identify(request: FastifyRequest): Promise<Identity | null>;
  /** The corporations authority's reads: local stores or `CORPORATIONS_URL`. */
  corps: Pick<CorpStore, 'membershipOf'>;
  challenges: Pick<AvaChallengeStore, 'getChallenge'>;
  sessions: Pick<AvaSessionStore, 'byMatchup'>;
  users: Pick<UserStore, 'loginsOf'>;
  /** The battle's room on this host: its state and the victory rules it plays. */
  battle(matchId: string): Promise<{ state: GameState; victoryRules: VictoryRules } | undefined>;
  data: GameData;
}

type AvaWarError = 'E_NO_CHALLENGE' | 'E_FORBIDDEN' | 'E_NO_BATTLE';

const STATUS: Record<AvaWarError, number> = {
  E_NO_CHALLENGE: 404,
  E_FORBIDDEN: 403,
  E_NO_BATTLE: 404,
};

export function registerAvaWarApi(app: FastifyInstance, deps: AvaWarApiDeps): void {
  const failed = (reply: FastifyReply, code: AvaWarError): { error: AvaWarError } => {
    void reply.code(STATUS[code]);
    return { error: code };
  };

  app.get('/ava-war/:matchupId', async (request, reply) => {
    const who = await deps.identify(request);
    if (!who) {
      void reply.code(401);
      return { error: 'E_AUTH' as const };
    }
    const { matchupId } = request.params as { matchupId: string };
    const matchup = await deps.challenges.getChallenge(matchupId);
    if (!matchup) return failed(reply, 'E_NO_CHALLENGE');
    const membership = await deps.corps.membershipOf(who.accountId);
    const side: AvaSide | null =
      !membership || membership.role === 'recruit'
        ? null
        : membership.corpId === matchup.challengerCorp
          ? 'challenger'
          : membership.corpId === matchup.targetCorp
            ? 'target'
            : null;
    if (!side) return failed(reply, 'E_FORBIDDEN');
    // A battle runs only while its matchup is locked: after the settlement the room is not
    // raised again for the hub.
    const session = matchup.status === 'locked' ? await deps.sessions.byMatchup(matchupId) : null;
    const battle = session ? await deps.battle(session.matchId) : undefined;
    if (!session || !battle) return failed(reply, 'E_NO_BATTLE');
    const view = avaWarView({
      matchupId,
      side,
      session,
      state: battle.state,
      rules: battle.victoryRules,
      data: deps.data,
      logins: await deps.users.loginsOf(Object.keys(session.seats)),
    });
    return view ?? failed(reply, 'E_NO_BATTLE');
  });
}
