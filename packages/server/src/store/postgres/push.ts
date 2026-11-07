/** Postgres: подписки на push (SLIM-5). */
import type { Pool } from 'pg';
import { type PushStore, type PushSubscriptionRecord, PUSH_KINDS } from '../types';

export class PostgresPushStore implements PushStore {
  constructor(private readonly pool: Pool) {}

  async save(accountId: string, sub: PushSubscriptionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth, kinds)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_id) DO UPDATE
         SET endpoint = $2, p256dh = $3, auth = $4, kinds = $5`,
      [
        accountId,
        sub.endpoint,
        sub.keys.p256dh,
        sub.keys.auth,
        sub.kinds ? sub.kinds.join(',') : null,
      ],
    );
  }

  async remove(accountId: string): Promise<void> {
    await this.pool.query(`DELETE FROM push_subscriptions WHERE account_id = $1`, [accountId]);
  }

  async of(accountId: string): Promise<PushSubscriptionRecord | undefined> {
    const r = await this.pool.query<{
      endpoint: string;
      p256dh: string;
      auth: string;
      kinds: string | null;
    }>(`SELECT endpoint, p256dh, auth, kinds FROM push_subscriptions WHERE account_id = $1`, [
      accountId,
    ]);
    const row = r.rows[0];
    if (!row) return undefined;
    const kinds =
      row.kinds === null ? undefined : PUSH_KINDS.filter((k) => row.kinds!.split(',').includes(k));
    return {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
      ...(kinds ? { kinds } : {}),
    };
  }
}
