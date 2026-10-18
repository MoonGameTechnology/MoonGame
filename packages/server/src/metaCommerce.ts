import type { FastifyInstance } from 'fastify';
import type { MetaEconomy } from './metaEconomy';
import type { MetaEconomyStore } from './metaEconomyStore';
import { registerCommerceEntitlementApi } from './commerceTransport';

/** Optional internal trust boundary, entirely separate from player sessions.
 *  An unconfigured provider never opens a public grant route. */
export function registerMetaCommerce(
  app: FastifyInstance,
  economy: Pick<MetaEconomy, 'applyEntitlement' | 'entitlementStatus'>,
  store: Pick<MetaEconomyStore, 'claimNonce'>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const keyId = env.COMMERCE_META_KEY_ID;
  const key = env.COMMERCE_META_KEY;
  const keyring = env.COMMERCE_META_KEYS;
  if (!keyId && !key && !keyring) return;
  if ((keyId || key) && (!keyId || !key)) throw new Error('E_COMMERCE_CONFIG');
  let keys: Record<string, string> = {};
  if (keyring) {
    try {
      const raw: unknown = JSON.parse(keyring);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || Object.values(raw).some((value) => typeof value !== 'string')) throw new Error();
      keys = raw as Record<string, string>;
    } catch { throw new Error('E_COMMERCE_CONFIG'); }
  }
  if (keyId && key) keys[keyId] = key;
  registerCommerceEntitlementApi(app, {
    keys,
    service: { apply: (command) => economy.applyEntitlement(command), status: (id) => economy.entitlementStatus(id) },
    claimNonce: (nonce, expiresAt) => store.claimNonce(nonce, expiresAt),
  });
}
