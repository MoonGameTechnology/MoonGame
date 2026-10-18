import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PROFILE_MEDALS, medalGrade, parseAppearance, type PlayerProfile } from '@void/protocol';
import type { Identity } from './matchApi';
import type { CommanderStore, UserStore } from './store';
import type { ProfileStore } from './profileStore';
import type { RegistrationRewardStore } from './registrationRewardStore';
import { slidingWindowIpLimiter } from './rateLimit';

export interface ProfileApiDeps {
  profiles: ProfileStore;
  users: Pick<UserStore, 'findUser' | 'findById'>;
  commanders: Pick<CommanderStore, 'xpOf'>;
  registrationRewards?: RegistrationRewardStore;
  identify(request: FastifyRequest): Promise<Identity | null>;
}

/** Public to other signed-in players; deliberately excludes email, currency and private match state. */
export function registerProfileApi(app: FastifyInstance, deps: ProfileApiDeps): void {
  const limited = slidingWindowIpLimiter({ now: Date.now, max: 120, windowMs: 60_000 });
  const view = async (id: string, login: string, owner = true): Promise<PlayerProfile> => {
    const [appearance, progress, xp] = await Promise.all([
      deps.profiles.appearance(id),
      deps.profiles.progress(id),
      deps.commanders.xpOf(id),
    ]);
    if (owner) return { login, xp, progress, ...appearance };
    const publicProgress: PlayerProfile['progress'] = {};
    for (const id of appearance.slots) {
      if (!id) continue;
      const grade = medalGrade(id, progress);
      const medal = PROFILE_MEDALS.find((m) => m.id === id)!;
      if (grade) publicProgress[medal.metric] = Math.max(publicProgress[medal.metric] ?? 0, medal.goals[3 - grade]!);
    }
    return { login, xp, progress: publicProgress, ...appearance };
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
    if (!user) return reply.code(404).send({ error: 'E_NO_PROFILE' });
    return view(user.userId, user.login, user.userId === who.accountId);
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
