/** Creation is offered only after an explicit successful server grant. Missing
 * endpoints, malformed bodies and failures never turn into permission. */
export function matchCreationAllowed(reply: { status: number; body: unknown } | null): boolean {
  if (reply?.status !== 200) return false;
  const body = reply.body;
  return body !== null && typeof body === 'object' && !Array.isArray(body) &&
    Object.hasOwn(body, 'canCreate') && (body as { canCreate?: unknown }).canCreate === true;
}
