import { randomBytes } from 'node:crypto';
import type { EntitlementCommandV1, EntitlementReceipt } from '@void/protocol';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MemoryCommerceStore,
  type CommerceOrder,
  type CommerceStore,
  type CommerceVerification,
} from './commerceStore';
import {
  COMMERCE_TABLES,
  migrateCommerceDatabase,
  PostgresCommerceStore,
  verifyCommerceDatabase,
} from './commercePostgres';
import { hashEntitlementCommand } from './commerceTransport';

function order(id = 'order', accountId = 'pilot'): CommerceOrder {
  return {
    orderId: id,
    accountId,
    requestId: `request:${id}`,
    provider: 'test',
    state: 'created',
    createdAt: 1,
    offer: {
      productId: 'pack',
      catalogVersion: 'v0',
      source: 'payment',
      nameKey: 'name',
      contentsKey: 'contents',
      contents: { soulbound: true },
      available: true,
      price: { amountMinor: 100, currency: 'USD' },
    },
  };
}
function proof(input = order(), refund = false): CommerceVerification {
  return {
    eventId: `${input.orderId}:${refund ? 'refund' : 'purchase'}`,
    provider: input.provider,
    providerTransactionId: `tx:${input.orderId}`,
    orderId: input.orderId,
    accountId: input.accountId,
    productId: input.offer.productId,
    catalogVersion: input.offer.catalogVersion,
    kind: refund ? 'refund' : 'payment',
    amountMinor: 100,
    currency: 'USD',
  };
}
function command(p = proof()): EntitlementCommandV1 {
  const revoke = p.kind === 'refund' || p.kind === 'chargeback';
  const body: Omit<EntitlementCommandV1, 'payloadHash'> = {
    version: 1,
    commandId: `${p.orderId}:${revoke ? 'revoke' : 'grant'}`,
    kind: revoke ? 'revoke' : 'grant',
    source: 'payment',
    orderId: p.orderId,
    provider: p.provider,
    providerTransactionId: p.providerTransactionId,
    accountId: p.accountId,
    productId: p.productId,
    catalogVersion: p.catalogVersion,
    at: 2,
    ...(revoke ? { originalCommandId: `${p.orderId}:grant` } : {}),
  };
  return { ...body, payloadHash: hashEntitlementCommand(body) };
}
function receipt(c = command()): EntitlementReceipt {
  return {
    commandId: c.commandId,
    payloadHash: c.payloadHash,
    at: 3,
    status: c.kind === 'grant' ? 'applied' : 'revoked',
  };
}
function contract(make: () => CommerceStore) {
  it('preserves idempotent order/proof after JSON key reordering and rejects conflicting reuse', async () => {
    const store = make(),
      original = order();
    await store.create(original);
    const reordered = {
      ...original,
      offer: Object.fromEntries(Object.entries(original.offer).reverse()) as CommerceOrder['offer'],
    };
    expect(await store.create(reordered)).toEqual(original);
    await expect(
      store.create({ ...original, offer: { ...original.offer, productId: 'other' } }),
    ).rejects.toThrow('E_COMMERCE_CONFLICT');
    const p = proof(),
      c = command();
    await store.record(p, c, 5);
    expect(
      await store.record(
        Object.fromEntries(Object.entries(p).reverse()) as unknown as CommerceVerification,
        c,
        6,
      ),
    ).toMatchObject({ state: 'pending' });
    await expect(store.record({ ...p, amountMinor: 101 }, c, 6)).rejects.toThrow(
      'E_COMMERCE_CONFLICT',
    );
    expect(await store.claim(6, 8, 20)).toHaveLength(1);
  });
  it('atomically rejects one provider transaction used for a different account/order', async () => {
    const store = make();
    const one = order('one', 'a'),
      two = order('two', 'b');
    await store.create(one);
    await store.create(two);
    const a = proof(one),
      b = { ...proof(two), providerTransactionId: a.providerTransactionId };
    const results = await Promise.allSettled([
      store.record(a, command(a), 10),
      store.record(b, command(b), 10),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await store.claim(10, 8, 20)).toHaveLength(1);
  });
  it('reserves concurrent leases once and ignores completion from an expired lease', async () => {
    const store = make();
    await store.create(order());
    await store.record(proof(), command(), 5);
    const claimed = (await Promise.all([store.claim(5, 8, 10), store.claim(5, 8, 10)])).flat();
    expect(claimed).toHaveLength(1);
    const later = (await store.claim(16, 8, 10))[0]!;
    expect(later.command).toEqual(claimed[0]!.command);
    expect(later.leaseToken).not.toBe(claimed[0]!.leaseToken);
    await store.finish(claimed[0]!, receipt());
    expect((await store.get('order'))?.state).toBe('pending');
    await store.finish(later, receipt());
    expect(await store.get('order')).toMatchObject({ state: 'fulfilled', receipt: receipt() });
    expect(await store.retry(command().commandId, 50)).toBe(false);
  });
  it('keeps refund blocked until ambiguous grant is reconciled and retains reversal through manual retry', async () => {
    const store = make();
    await store.create(order());
    await store.record(proof(), command(), 5);
    const first = (await store.claim(5, 1, 10))[0]!;
    const reversal = proof(order(), true),
      revoke = command(reversal);
    await store.record(reversal, revoke, 6);
    await store.defer(first, 6, true);
    expect(await store.claim(20, 8, 10)).toHaveLength(0);
    expect(await store.retry(first.command.commandId, 21)).toBe(true);
    expect((await store.get('order'))?.state).toBe('revocation-pending');
    const retried = (await store.claim(21, 8, 10))[0]!;
    expect(retried.command).toEqual(first.command);
    await store.finish(retried, receipt(retried.command));
    expect((await store.get('order'))?.state).toBe('revocation-pending');
    const revoked = (await store.claim(22, 8, 10))[0]!;
    expect(revoked.command).toEqual(revoke);
    await store.finish(revoked, receipt(revoke));
    expect((await store.get('order'))?.state).toBe('revoked');
    expect(await store.retry(first.command.commandId, 23)).toBe(false);
  });
  it('quarantines out-of-order refunds and rejects mismatched commands and receipts', async () => {
    const store = make();
    await store.create(order());
    const reversal = proof(order(), true);
    await store.record(reversal, command(reversal), 5);
    expect((await store.get('order'))?.state).toBe('review-required');
    expect(await store.claim(5, 8, 10)).toHaveLength(0);
    await expect(store.create(order('new'))).rejects.toThrow('E_COMMERCE_REVIEW_REQUIRED');
    const another = order('other', 'other');
    await store.create(another);
    const p = proof(another),
      c = command(p);
    const tampered = command({ ...p, accountId: 'wrong' });
    await expect(store.record(p, tampered, 5)).rejects.toThrow('E_COMMERCE_CONFLICT');
    await store.record(p, c, 5);
    const delivery = (await store.claim(5, 8, 10))[0]!;
    await expect(store.finish(delivery, receipt(command()))).rejects.toThrow('E_COMMERCE_CONFLICT');
    expect((await store.get(another.orderId))?.state).toBe('pending');
  });
}

describe('Commerce memory store contract', () => {
  let store: MemoryCommerceStore;
  beforeEach(() => {
    store = new MemoryCommerceStore();
  });
  contract(() => store);
});

const base = process.env.DATABASE_URL;
describe.skipIf(!base)('Commerce dedicated PostgreSQL and runtime trust boundary', () => {
  const suffix = randomBytes(6).toString('hex'),
    dbName = `commerce_test_${suffix}`,
    role = `commerce_test_${suffix}`,
    elevated = `commerce_elevated_${suffix}`;
  const password = randomBytes(32).toString('hex');
  const root = new Pool({ connectionString: base, max: 1 });
  let admin: Pool, runtime: Pool, store: PostgresCommerceStore;
  const connection = (user?: string) => {
    const url = new URL(base!);
    url.pathname = `/${dbName}`;
    if (user) {
      url.username = user;
      url.password = password;
    }
    return url.toString();
  };
  beforeAll(async () => {
    await root.query(`CREATE DATABASE ${dbName}`);
    await root.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
    await root.query(`CREATE ROLE ${elevated} NOLOGIN CREATEDB`);
    admin = new Pool({ connectionString: connection(), max: 8 });
    await migrateCommerceDatabase(admin);
    await admin.query(`REVOKE ALL ON DATABASE ${dbName} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${role}`);
    await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    for (const table of COMMERCE_TABLES)
      await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO ${role}`);
    await admin.query(`GRANT SELECT ON commerce_schema_revision TO ${role}`);
    runtime = new Pool({ connectionString: connection(role), max: 8 });
    await verifyCommerceDatabase(runtime);
    store = new PostgresCommerceStore(runtime);
  }, 30_000);
  beforeEach(async () => {
    await admin.query(`TRUNCATE ${COMMERCE_TABLES.join(',')} CASCADE`);
  });
  afterAll(async () => {
    await runtime?.end();
    await admin?.end();
    await root.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await root.query(`DROP ROLE IF EXISTS ${role}`);
    await root.query(`DROP ROLE IF EXISTS ${elevated}`);
    await root.end();
  });
  contract(() => store);
  it('retains command, lease and receipt across store reconstruction', async () => {
    await store.create(order());
    await store.record(proof(), command(), 5);
    const first = (await store.claim(5, 1, 10))[0]!;
    const restarted = new PostgresCommerceStore(runtime);
    expect(await restarted.claim(6, 1, 10)).toHaveLength(0);
    const delivery = (await restarted.claim(16, 1, 10))[0]!;
    expect(delivery.command).toEqual(first.command);
    await restarted.finish(delivery, receipt());
    expect((await new PostgresCommerceStore(runtime).get('order'))?.receipt).toEqual(receipt());
  });
  it('rejects Game tables in every schema, destructive privileges, revision writes and role escalation', async () => {
    await admin.query('CREATE SCHEMA meta');
    await admin.query('CREATE TABLE meta.arsenal(id text)');
    await admin.query(`GRANT USAGE ON SCHEMA meta TO ${role}`);
    try {
      for (const privilege of ['SELECT', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        await admin.query(`GRANT ${privilege} ON meta.arsenal TO ${role}`);
        await expect(verifyCommerceDatabase(runtime)).rejects.toThrow('E_COMMERCE_DATABASE_ROLE');
        await admin.query(`REVOKE ${privilege} ON meta.arsenal FROM ${role}`);
      }
      await admin.query(`GRANT UPDATE ON commerce_schema_revision TO ${role}`);
      await expect(verifyCommerceDatabase(runtime)).rejects.toThrow('E_COMMERCE_DATABASE_ROLE');
      await admin.query(`REVOKE UPDATE ON commerce_schema_revision FROM ${role}`);
      await admin.query(`GRANT ${elevated} TO ${role}`);
      await expect(verifyCommerceDatabase(runtime)).rejects.toThrow('E_COMMERCE_DATABASE_ROLE');
      await admin.query(`REVOKE ${elevated} FROM ${role}`);
      await verifyCommerceDatabase(runtime);
      await expect(runtime.query('SELECT * FROM meta.arsenal')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(runtime.query('TRUNCATE commerce_orders CASCADE')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await admin.query('DROP SCHEMA meta CASCADE');
    }
  });
  it('claims durable nonces once across store instances', async () => {
    const second = new PostgresCommerceStore(runtime);
    expect(
      await Promise.all([store.claimNonce('nonce', 100, 10), second.claimNonce('nonce', 100, 10)]),
    ).toEqual(expect.arrayContaining([true, false]));
  });
});
