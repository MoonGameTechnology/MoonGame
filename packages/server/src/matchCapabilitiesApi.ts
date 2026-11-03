import type { FastifyInstance } from 'fastify';
import type { Identity, MatchApiDeps } from './matchApi';

/** The read-only capability and POST /matches use the same live policy. */
export async function matchCreationPermitted(
  identity: Identity | null,
  policy: MatchApiDeps['canCreate'],
): Promise<boolean> {
  return policy ? identity !== null && await policy(identity) === true : true;
}

export function registerMatchCapabilitiesApi(
  app: FastifyInstance,
  deps: Pick<MatchApiDeps, 'identify' | 'canCreate' | 'createMatch'>,
): void {
  app.get('/matches/capabilities', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    try {
      const identity = deps.identify ? await deps.identify(request) : null;
      if (deps.identify && !identity)
        return reply.code(401).send({ error: 'E_AUTH' });
      return { canCreate: !!deps.createMatch && await matchCreationPermitted(identity, deps.canCreate) };
    } catch {
      return reply.code(503).send({ error: 'E_UNAVAILABLE' });
    }
  });
}
