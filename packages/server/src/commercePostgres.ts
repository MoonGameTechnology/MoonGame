import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Pool, PoolClient } from 'pg';
import type { EntitlementCommandV1, EntitlementReceipt } from '@void/protocol';
import {
  commerceConflict,
  isRevocation,
  matchingProof,
  matchingCommand,
  assertCommerceReceipt,
  type CommerceDelivery,
  type CommerceOrder,
  type CommerceStore,
  type CommerceVerification,
} from './commerceStore';

/** Dedicated Commerce schema. Never invokes Game migrations or grants Game tables. */
export const COMMERCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS commerce_orders (
  order_id text PRIMARY KEY, account_id text NOT NULL, request_id text NOT NULL,
  payload jsonb NOT NULL, UNIQUE(account_id, request_id)
);
CREATE TABLE IF NOT EXISTS commerce_provider_transactions (
  provider text NOT NULL, transaction_id text NOT NULL, order_id text NOT NULL REFERENCES commerce_orders(order_id),
  PRIMARY KEY(provider, transaction_id), UNIQUE(provider, order_id)
);
CREATE TABLE IF NOT EXISTS commerce_provider_receipts (
  provider text NOT NULL, event_id text NOT NULL, proof jsonb NOT NULL,
  PRIMARY KEY(provider, event_id)
);
CREATE TABLE IF NOT EXISTS commerce_delivery (
  command_id text PRIMARY KEY, order_id text NOT NULL REFERENCES commerce_orders(order_id),
  kind text NOT NULL CHECK(kind IN ('grant','revoke')), command jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0, next_attempt_at bigint NOT NULL,
  lease_until bigint NOT NULL DEFAULT 0, lease_token text NOT NULL DEFAULT '',
  terminal boolean NOT NULL DEFAULT false, receipt jsonb,
  UNIQUE(order_id, kind)
);
CREATE INDEX IF NOT EXISTS commerce_delivery_due ON commerce_delivery(next_attempt_at) WHERE NOT terminal;
CREATE TABLE IF NOT EXISTS commerce_gateway_nonces (
  nonce text PRIMARY KEY, expires_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS commerce_schema_revision (
  id integer PRIMARY KEY CHECK(id=1), fingerprint text NOT NULL
);`;
export const COMMERCE_TABLES = [
  'commerce_orders',
  'commerce_provider_transactions',
  'commerce_provider_receipts',
  'commerce_delivery',
  'commerce_gateway_nonces',
] as const;
const fingerprint = () => createHash('sha256').update(COMMERCE_SCHEMA).digest('hex');

/** Migrations use separately provisioned credentials; runtime only verifies its grants. */
export async function migrateCommerceDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(144731, 1669)');
    await client.query(COMMERCE_SCHEMA);
    await client.query(
      'INSERT INTO commerce_schema_revision(id,fingerprint) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint',
      [fingerprint()],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function verifyCommerceDatabase(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ unsafe: boolean }>(
    `
    SELECT r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls
      OR EXISTS (SELECT 1 FROM pg_roles granted WHERE granted.rolname<>current_user
        AND pg_has_role(current_user,granted.oid,'MEMBER'))
      OR has_database_privilege(current_user,current_database(),'CREATE')
      OR has_database_privilege(current_user,current_database(),'TEMP')
      OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_'
        AND n.nspname <> 'information_schema' AND has_schema_privilege(current_user,n.oid,'CREATE'))
      OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','S','v','m','f')
          AND (pg_has_role(current_user,c.relowner,'MEMBER')
            OR CASE WHEN c.relkind='S' THEN has_sequence_privilege(current_user,c.oid,'SELECT,UPDATE,USAGE')
              WHEN n.nspname='public' AND c.relname=ANY($1::text[])
                THEN has_table_privilege(current_user,c.oid,'TRUNCATE,REFERENCES,TRIGGER')
              WHEN n.nspname='public' AND c.relname='commerce_schema_revision'
                THEN has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
              ELSE has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') END)) AS unsafe
    FROM pg_roles r WHERE r.rolname=current_user`,
    [COMMERCE_TABLES],
  );
  if (rows.length !== 1 || rows[0]!.unsafe) throw Error('E_COMMERCE_DATABASE_ROLE');
  const revision = await pool.query<{ fingerprint: string }>(
    'SELECT fingerprint FROM public.commerce_schema_revision WHERE id=1',
  );
  if (revision.rows[0]?.fingerprint !== fingerprint()) throw Error('E_COMMERCE_DATABASE_SCHEMA');
  for (const table of COMMERCE_TABLES) {
    const result = await pool.query<{ ok: boolean }>(
      `SELECT bool_and(has_table_privilege(current_user,$1,p)) AS ok
       FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p`,
      [`public.${table}`],
    );
    if (!result.rows[0]?.ok) throw Error('E_COMMERCE_DATABASE_ROLE');
  }
}

type DeliveryRow = {
  command: EntitlementCommandV1;
  attempts: number;
  next_attempt_at: string;
  lease_until: string;
  lease_token: string;
  terminal: boolean;
  receipt?: EntitlementReceipt | null;
};
const deliveryOf = (row: DeliveryRow): CommerceDelivery => ({
  command: row.command,
  attempts: row.attempts,
  nextAttemptAt: Number(row.next_attempt_at),
  leaseUntil: Number(row.lease_until),
  leaseToken: row.lease_token,
  terminal: row.terminal,
  ...(row.receipt ? { receipt: row.receipt } : {}),
});

export class PostgresCommerceStore implements CommerceStore {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        commerceConflict();
      throw error;
    } finally {
      client.release();
    }
  }

  async create(order: CommerceOrder): Promise<CommerceOrder> {
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1669))', [
        order.accountId,
      ]);
      const previous = await client.query<{ payload: CommerceOrder }>(
        'SELECT payload FROM commerce_orders WHERE account_id=$1 AND request_id=$2',
        [order.accountId, order.requestId],
      );
      const old = previous.rows[0]?.payload;
      if (old) {
        if (!isDeepStrictEqual(old.offer, order.offer) || old.provider !== order.provider)
          commerceConflict();
        return old;
      }
      const blocked = await client.query(
        "SELECT 1 FROM commerce_orders WHERE account_id=$1 AND payload->>'state'='review-required' LIMIT 1",
        [order.accountId],
      );
      if (blocked.rowCount) throw Error('E_COMMERCE_REVIEW_REQUIRED');
      await client.query(
        'INSERT INTO commerce_orders(order_id,account_id,request_id,payload) VALUES($1,$2,$3,$4)',
        [order.orderId, order.accountId, order.requestId, order],
      );
      return order;
    });
  }

  async get(orderId: string): Promise<CommerceOrder | null> {
    const result = await this.pool.query<{ payload: CommerceOrder }>(
      'SELECT payload FROM commerce_orders WHERE order_id=$1',
      [orderId],
    );
    return result.rows[0]?.payload ?? null;
  }

  async record(
    proof: CommerceVerification,
    command: EntitlementCommandV1,
    now: number,
  ): Promise<CommerceOrder> {
    return this.transaction(async (client) => {
      // Shares the account fence with create/finish/defer so a review freeze cannot race a new order.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1669))', [
        proof.accountId,
      ]);
      // Serializes a duplicate provider transaction even across different order rows.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1670))', [
        JSON.stringify([proof.provider, proof.providerTransactionId]),
      ]);
      const result = await client.query<{ payload: CommerceOrder }>(
        'SELECT payload FROM commerce_orders WHERE order_id=$1 FOR UPDATE',
        [proof.orderId],
      );
      const order = result.rows[0]?.payload;
      if (!order || !matchingProof(order, proof) || !matchingCommand(order, proof, command))
        commerceConflict();
      const event = await client.query<{ proof: CommerceVerification }>(
        'SELECT proof FROM commerce_provider_receipts WHERE provider=$1 AND event_id=$2',
        [proof.provider, proof.eventId],
      );
      if (event.rows[0]) {
        // jsonb key order is not a business fact.
        if (!isDeepStrictEqual(event.rows[0]!.proof, proof)) commerceConflict();
        return order;
      }
      await client.query(
        'INSERT INTO commerce_provider_transactions(provider,transaction_id,order_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [proof.provider, proof.providerTransactionId, proof.orderId],
      );
      const owner = await client.query<{ order_id: string }>(
        'SELECT order_id FROM commerce_provider_transactions WHERE provider=$1 AND transaction_id=$2',
        [proof.provider, proof.providerTransactionId],
      );
      if (owner.rows[0]?.order_id !== proof.orderId) commerceConflict();
      const existing = await client.query<DeliveryRow>(
        'SELECT * FROM commerce_delivery WHERE order_id=$1 AND kind=$2',
        [order.orderId, command.kind],
      );
      if (
        existing.rows[0] &&
        existing.rows[0].command.providerTransactionId !== proof.providerTransactionId
      )
        commerceConflict();
      await client.query(
        'INSERT INTO commerce_provider_receipts(provider,event_id,proof) VALUES($1,$2,$3)',
        [proof.provider, proof.eventId, proof],
      );
      if (existing.rows[0] || order.state === 'revoked' || order.state === 'review-required')
        return order;
      const grant = await client.query<{ command_id: string }>(
        "SELECT command_id FROM commerce_delivery WHERE order_id=$1 AND kind='grant'",
        [order.orderId],
      );
      if (
        isRevocation(proof) &&
        grant.rows[0] &&
        command.originalCommandId !== grant.rows[0].command_id
      )
        commerceConflict();
      if (isRevocation(proof) && !grant.rowCount) {
        order.state = 'review-required';
      } else {
        await client.query(
          'INSERT INTO commerce_delivery(command_id,order_id,kind,command,next_attempt_at) VALUES($1,$2,$3,$4,$5)',
          [command.commandId, order.orderId, command.kind, command, now],
        );
        order.state = isRevocation(proof) ? 'revocation-pending' : 'pending';
      }
      await client.query('UPDATE commerce_orders SET payload=$2 WHERE order_id=$1', [
        order.orderId,
        order,
      ]);
      return order;
    });
  }

  async claim(now: number, limit: number, leaseMs: number): Promise<CommerceDelivery[]> {
    return this.transaction(async (client) => {
      const result = await client.query<DeliveryRow>(
        `
        SELECT d.* FROM commerce_delivery d WHERE NOT d.terminal AND d.next_attempt_at<=$1 AND d.lease_until<=$1
          AND (d.kind='grant' OR EXISTS (SELECT 1 FROM commerce_delivery g
            WHERE g.command_id=d.command->>'originalCommandId' AND g.receipt->>'status'='applied'))
        ORDER BY d.next_attempt_at,d.command_id LIMIT $2 FOR UPDATE OF d SKIP LOCKED`,
        [now, limit],
      );
      const deliveries: CommerceDelivery[] = [];
      for (const row of result.rows) {
        const token = randomUUID();
        await client.query(
          'UPDATE commerce_delivery SET attempts=attempts+1,lease_until=$2,lease_token=$3 WHERE command_id=$1',
          [row.command.commandId, now + leaseMs, token],
        );
        deliveries.push({
          ...deliveryOf(row),
          attempts: row.attempts + 1,
          leaseUntil: now + leaseMs,
          leaseToken: token,
        });
      }
      return deliveries;
    });
  }

  async finish(delivery: CommerceDelivery, receipt: EntitlementReceipt): Promise<void> {
    assertCommerceReceipt(delivery.command, receipt);
    await this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1669))', [
        delivery.command.accountId,
      ]);
      const orderResult = await client.query<{ payload: CommerceOrder }>(
        'SELECT payload FROM commerce_orders WHERE order_id=$1 FOR UPDATE',
        [delivery.command.orderId],
      );
      const result = await client.query(
        'UPDATE commerce_delivery SET terminal=true,receipt=$3 WHERE command_id=$1 AND lease_token=$2 AND NOT terminal RETURNING command_id',
        [delivery.command.commandId, delivery.leaseToken, receipt],
      );
      if (!result.rowCount) return;
      const order = orderResult.rows[0]!.payload;
      order.receipt = receipt;
      if (receipt.status === 'review-required') order.state = 'review-required';
      else if (receipt.status === 'revoked') order.state = 'revoked';
      else if (order.state !== 'revocation-pending') order.state = 'fulfilled';
      await client.query('UPDATE commerce_orders SET payload=$2 WHERE order_id=$1', [
        order.orderId,
        order,
      ]);
    });
  }

  async defer(
    delivery: CommerceDelivery,
    nextAttemptAt: number,
    quarantine: boolean,
  ): Promise<void> {
    await this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1669))', [
        delivery.command.accountId,
      ]);
      const orderResult = await client.query<{ payload: CommerceOrder }>(
        'SELECT payload FROM commerce_orders WHERE order_id=$1 FOR UPDATE',
        [delivery.command.orderId],
      );
      const result = await client.query(
        'UPDATE commerce_delivery SET next_attempt_at=$3,lease_until=0,terminal=$4 WHERE command_id=$1 AND lease_token=$2 AND NOT terminal RETURNING command_id',
        [delivery.command.commandId, delivery.leaseToken, nextAttemptAt, quarantine],
      );
      if (result.rowCount && quarantine) {
        const order = orderResult.rows[0]!.payload;
        order.state = 'review-required';
        await client.query('UPDATE commerce_orders SET payload=$2 WHERE order_id=$1', [
          order.orderId,
          order,
        ]);
      }
    });
  }

  async retry(commandId: string, now: number): Promise<boolean> {
    return this.transaction(async (client) => {
      // Observe the owner, then follow the same order -> delivery lock order as finish/defer.
      const owner = await client.query<{ order_id: string; account_id: string }>(
        "SELECT order_id,command->>'accountId' AS account_id FROM commerce_delivery WHERE command_id=$1",
        [commandId],
      );
      if (!owner.rows[0]) return false;
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1669))', [
        owner.rows[0].account_id,
      ]);
      const orders = await client.query<{ payload: CommerceOrder }>(
        'SELECT payload FROM commerce_orders WHERE order_id=$1 FOR UPDATE',
        [owner.rows[0].order_id],
      );
      const order = orders.rows[0]?.payload;
      if (!order || order.state === 'revoked') return false;
      const reversals = await client.query<DeliveryRow>(
        "SELECT * FROM commerce_delivery WHERE order_id=$1 AND kind='revoke'",
        [order.orderId],
      );
      if (reversals.rows[0]?.receipt) return false;
      const result = await client.query<{ kind: string }>(
        "UPDATE commerce_delivery SET terminal=false,attempts=0,next_attempt_at=$2,lease_until=0,lease_token='' WHERE command_id=$1 AND terminal AND receipt IS NULL RETURNING kind",
        [commandId, now],
      );
      const row = result.rows[0];
      if (!row) return false;
      order.state =
        row.kind === 'revoke' || reversals.rows.length ? 'revocation-pending' : 'pending';
      await client.query('UPDATE commerce_orders SET payload=$2 WHERE order_id=$1', [
        order.orderId,
        order,
      ]);
      return true;
    });
  }

  async claimNonce(nonce: string, expires: number, now = Date.now()): Promise<boolean> {
    return this.transaction(async (client) => {
      await client.query('DELETE FROM commerce_gateway_nonces WHERE expires_at<$1', [now]);
      const result = await client.query(
        'INSERT INTO commerce_gateway_nonces(nonce,expires_at) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING nonce',
        [nonce, expires],
      );
      return result.rowCount === 1;
    });
  }

  async ready(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}
