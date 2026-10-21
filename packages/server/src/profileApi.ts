import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  BOT_PROFILE_HISTORY_LIMIT,
  PROFILE_MEDALS,
  defaultAppearance,
  medalGrade,
  parseAppearance,
  type PlayerProfile,
} from '@void/protocol';
import type { Identity } from './matchApi';
import type { CommanderStore, UserStore } from './store';
import type { ProfileStore } from './profileStore';
import type { RegistrationRewardStore } from './registrationRewardStore';
import type { BotRosterStore } from './botRoster';
import { slidingWindowIpLimiter } from './rateLimit';

export interface ProfileApiDeps {
  profiles: ProfileStore;
  users: Pick<UserStore, 'findUser' | 'findById'>;
  commanders: Pick<CommanderStore, 'xpOf'>;
  bots?: Pick<BotRosterStore, 'findByLogin' | 'recentMatches'>;
  registrationRewards?: RegistrationRewardStore;
  /** A running premium account (Meta): shown as the profile frame. */
  premium?(accountId: string): Promise<boolean>;
  identify(request: FastifyRequest): Promise<Identity | null>;
}

/** Public to other signed-in players; deliberately excludes email, currency and private match state. */
export function registerProfileApi(app: FastifyInstance, deps: ProfileApiDeps): void {
  const limited = slidingWindowIpLimiter({ now: Date.now, max: 120, windowMs: 60_000 });
  const view = async (id: string, login: string, owner = true): Promise<PlayerProfile> => {
    const [appearance, progress, xp, premium] = await Promise.all([
      deps.profiles.appearance(id),
      deps.profiles.progress(id),
      deps.commanders.xpOf(id),
      // The frame is decoration: a failed read leaves it off, never the whole profile.
      deps.premium?.(id).catch(() => false) ?? false,
    ]);
    const frame = premium ? { premium: true } : {};
    if (owner) return { login, xp, progress, ...appearance, ...frame };
    const publicProgress: PlayerProfile['progress'] = {};
    for (const id of appearance.slots) {
      if (!id) continue;
      const grade = medalGrade(id, progress);
      const medal = PROFILE_MEDALS.find((m) => m.id === id)!;
      if (grade) publicProgress[medal.metric] = Math.max(publicProgress[medal.metric] ?? 0, medal.goals[3 - grade]!);
    }
    return { login, xp, progress: publicProgress, ...appearance, ...frame };
  };
  app.get<{ Querystring: { login?: string } }>('/profiles', async (request, reply) => {
    if (limited(request.ip)) return reply.code(429).send({ error: 'E_RATE_LIMIT' });
    const who = await deps.identify(request);
    if (!who) return reply.code(401).send({ error: 'E_AUTH' });
    const login = request.query.login;
    if (login !== undefined && (typeof login !== 'string' || login.length > 64))
      return reply.code(400).send({ error: 'E_BAD_REQUEST' });
    const user =
      login === undefined
        ? await deps.users.findById(who.accountId)
        : await deps.users.findUser(login);
    // Real accounts always retain their own profile, even if a roster has a colliding name.
    if (user) return view(user.userId, user.login, user.userId === who.accountId);
    if (!login?.startsWith('~') || !deps.bots)
      return reply.code(404).send({ error: 'E_NO_PROFILE' });
    const bot = await deps.bots.findByLogin(login);
    if (!bot) return reply.code(404).send({ error: 'E_NO_PROFILE' });
    const [progress, history] = await Promise.all([
      deps.profiles.progress(bot.id),
      deps.bots.recentMatches(bot.id, BOT_PROFILE_HISTORY_LIMIT),
    ]);
    const earned = PROFILE_MEDALS.filter((medal) => medalGrade(medal.id, progress) !== null);
    const profile: PlayerProfile = {
      kind: 'bot',
      login: bot.login,
      portrait: bot.portrait,
      xp: bot.xp,
      progress,
      slots: defaultAppearance().slots.map((_, i) => earned[i]?.id ?? null),
      // Project explicitly: server-only bot/seat identifiers never cross the public API.
      recentMatches: history.slice(0, BOT_PROFILE_HISTORY_LIMIT).map((match) => ({
        matchId: match.matchId,
        mapId: match.mapId,
        endedAt: match.endedAt,
        outcome: match.outcome,
        xp: match.xp,
        place: match.place,
      })),
    };
    return profile;
  });
  app.post('/profiles/me', { bodyLimit: 2048 }, async (request, reply) => {
    if (limited(request.ip)) return reply.code(429).send({ error: 'E_RATE_LIMIT' });
    const who = await deps.identify(request);
    if (!who) return reply.code(401).send({ error: 'E_AUTH' });
    const appearance = parseAppearance(request.body);
    if (!appearance) return reply.code(400).send({ error: 'E_BAD_REQUEST' });
    const progress = await deps.profiles.progress(who.accountId);
    if (appearance.slots.some((id) => id !== null && medalGrade(id, progress) === null))
      return reply.code(403).send({ error: 'E_MEDAL_LOCKED' });
    const user = await deps.users.findById(who.accountId);
    if (!user) return reply.code(401).send({ error: 'E_AUTH' });
    await deps.profiles.save(who.accountId, appearance);
    return view(who.accountId, user.login);
  });
  if (deps.registrationRewards) {
    const rewards = deps.registrationRewards;
    app.get('/profiles/rewards/registration', async (request, reply) => {
      if (limited(request.ip)) return reply.code(429).send({ error: 'E_RATE_LIMIT' });
      const who = await deps.identify(request);
      if (!who) return reply.code(401).send({ error: 'E_AUTH' });
      reply.header('cache-control', 'no-store');
      return { reward: await rewards.ensure(who.accountId) };
    });
    app.post('/profiles/rewards/registration/accept', { bodyLimit: 256 }, async (request, reply) => {
      if (limited(request.ip)) return reply.code(429).send({ error: 'E_RATE_LIMIT' });
      const who = await deps.identify(request);
      if (!who) return reply.code(401).send({ error: 'E_AUTH' });
      const body = request.body as { equip?: unknown } | null;
      if (!body || typeof body.equip !== 'boolean' || Object.keys(body).some((key) => key !== 'equip'))
        return reply.code(400).send({ error: 'E_BAD_REQUEST' });
      const result = await rewards.accept(who.accountId, body.equip);
      if (!result.ok) return reply.code(result.code === 'E_NO_REWARD' ? 404 : 409).send({ error: result.code });
      reply.header('cache-control', 'no-store');
      return { reward: result.reward };
    });
  }
}
