import type { FastifyInstance } from 'fastify';
import { isOperatorRequest, MIN_OPERATOR_TOKEN_LENGTH } from './operatorAccess';
import type { CreatedMatch } from './matchApi';

/** Operations-only creation, behind the full operator credential and /metrics edge deny. */
export function registerOperatorMatchApi(app: FastifyInstance, deps: {
  token: string | undefined;
  mapIds: readonly string[];
  createMatch(request: { mapId: string; timeScale: number }): Promise<CreatedMatch>;
}): void {
  if (!deps.token || deps.token.length < MIN_OPERATOR_TOKEN_LENGTH) return;
  app.post('/metrics/matches', {
    bodyLimit: 1024,
    onRequest: async (request, reply) => {
      if (!isOperatorRequest({ remoteAddress: request.socket.remoteAddress, headers: request.headers }, deps.token)) {
        return reply.callNotFound();
      }
    },
  }, async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'E_BAD_PAYLOAD' });
    }
    const payload = body as Record<string, unknown>;
    if (Object.keys(payload).some((key) => key !== 'mapId' && key !== 'timeScale') ||
        typeof payload.mapId !== 'string' || !deps.mapIds.includes(payload.mapId) ||
        typeof payload.timeScale !== 'number' || !Number.isInteger(payload.timeScale) ||
        payload.timeScale < 1 || payload.timeScale > 24) {
      return reply.code(400).send({ error: 'E_BAD_PAYLOAD' });
    }
    try {
      const result = await deps.createMatch({ mapId: payload.mapId, timeScale: payload.timeScale });
      return reply.code(201).send(result);
    } catch {
      return reply.code(503).send({ error: 'E_CREATE_MATCH' });
    }
  });
}
