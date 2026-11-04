import type { FastifyInstance } from 'fastify';

/** Fastify's default 404 embeds the full request URL, including bearer queries. */
export function registerSafeNotFound(app: FastifyInstance): void {
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'E_NOT_FOUND' }));
}
