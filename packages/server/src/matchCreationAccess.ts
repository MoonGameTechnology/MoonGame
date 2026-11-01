import type { Identity } from './matchApi';

/** Production provisioning belongs to explicitly named account IDs, not display names.
 * A deleted account's name can never transfer this authority to its next owner. */
export function matchCreationAccess(env: Record<string, string | undefined>):
  ((identity: Identity) => boolean) | undefined {
  if (env.PROD !== '1' && !env.MATCH_CREATOR_ACCOUNT_IDS) return undefined;
  const allowed = new Set((env.MATCH_CREATOR_ACCOUNT_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean));
  return identity => allowed.has(identity.accountId);
}
