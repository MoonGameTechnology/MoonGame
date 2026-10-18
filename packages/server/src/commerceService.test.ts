import { describe, expect, it, vi } from 'vitest';
import type { EntitlementReceipt } from '@void/protocol';
import { CommerceService, type CommerceProvider } from './commerceService';
import { MemoryCommerceStore, type CommerceVerification } from './commerceStore';
import type { CommerceEntitlementService } from './commerceTransport';

function fixture() {
  let now = 1000;
  const store = new MemoryCommerceStore();
  const receipts = new Map<string, EntitlementReceipt>();
  const meta: CommerceEntitlementService = {
    status: vi.fn(async (id) => receipts.get(id) ?? null),
    apply: vi.fn(async (command) => {
      const receipt: EntitlementReceipt = {
        commandId: command.commandId,
        payloadHash: command.payloadHash,
        at: now,
        status: command.kind === 'grant' ? 'applied' : 'revoked',
      };
      receipts.set(command.commandId, receipt);
      return { ok: true as const, receipt };
    }),
  };
  const provider: CommerceProvider = {
    id: 'test-only',
    offers: [
      { productId: 'supply_personal', price: { amountMinor: 100, currency: 'USD' } },
      { productId: 'rewarded_supply' },
    ],
    verify: vi.fn(async ({ headers, rawBody }) =>
      headers.signature === 'test-proof'
        ? (JSON.parse(Buffer.from(rawBody).toString()) as CommerceVerification)
        : null,
    ),
  };
  const service = new CommerceService(store, meta, [provider], () => now);
  const proof = (
    orderId: string,
    extra: Partial<CommerceVerification> = {},
  ): CommerceVerification => ({
    provider: provider.id,
    eventId: `event:${orderId}`,
    providerTransactionId: `tx:${orderId}`,
    orderId,
    accountId: 'account-a',
    productId: 'supply_personal',
    catalogVersion: 'meta-v0.1',
    kind: 'payment',
    amountMinor: 100,
    currency: 'USD',
    ...extra,
  });
  const webhook = (value: CommerceVerification) =>
    service.webhook(provider.id, { signature: 'test-proof' }, Buffer.from(JSON.stringify(value)));
  return {
    service,
    store,
    provider,
    meta,
    receipts,
    proof,
    webhook,
    setNow: (value: number) => {
      now = value;
    },
    clock: () => now,
  };
}

describe('Commerce orders and durable entitlement delivery', () => {
  it('leaves every product unavailable without a real provider adapter', async () => {
    const f = fixture();
    const service = new CommerceService(f.store, f.meta);
    expect(service.offers()).toHaveLength(4);
    expect(service.offers().every((offer) => !offer.available && !offer.price)).toBe(true);
    await expect(
      service.createOrder('a', 'request', 'supply_personal', 'meta-v0.1'),
    ).rejects.toThrow('E_COMMERCE_UNAVAILABLE');
    await expect(service.webhook('browser', {}, Buffer.from('{}'))).rejects.toThrow(
      'E_COMMERCE_UNAVAILABLE',
    );
    expect(f.meta.apply).not.toHaveBeenCalled();
  });

  it('pins the offer and returns the same order for an idempotent request', async () => {
    const f = fixture();
    const first = await f.service.createOrder('account-a', 'r1', 'supply_personal', 'meta-v0.1');
    expect(await f.service.createOrder('account-a', 'r1', 'supply_personal', 'meta-v0.1')).toEqual(
      first,
    );
    await expect(
      f.service.createOrder('account-a', 'r1', 'rewarded_supply', 'meta-v0.1'),
    ).rejects.toThrow('E_COMMERCE_CONFLICT');
    expect(await f.service.order('account-b', first.orderId)).toBeNull();
  });

  it('persists verified proof before delivery and deduplicates provider retries across restarts', async () => {
    const f = fixture();
    const order = await f.service.createOrder('account-a', 'r1', 'supply_personal', 'meta-v0.1');
    await f.webhook(f.proof(order.orderId));
    expect((await f.service.order('account-a', order.orderId))?.state).toBe('pending');
    expect(f.meta.apply).not.toHaveBeenCalled();
    f.setNow(2000);
    await f.webhook(f.proof(order.orderId));
    const restarted = new CommerceService(f.store, f.meta, [f.provider], f.clock);
    expect(await restarted.deliver()).toBe(1);
    expect((await restarted.order('account-a', order.orderId))?.state).toBe('fulfilled');
    expect(await restarted.deliver()).toBe(0);
    expect(f.meta.apply).toHaveBeenCalledTimes(1);
  });

  it('reconciles a lost response after grant commit instead of granting twice', async () => {
    const f = fixture();
    const order = await f.service.createOrder('account-a', 'r1', 'supply_personal', 'meta-v0.1');
    await f.webhook(f.proof(order.orderId));
    vi.mocked(f.meta.apply).mockImplementationOnce(async (command) => {
      f.receipts.set(command.commandId, {
        commandId: command.commandId,
        payloadHash: command.payloadHash,
        status: 'applied',
        at: 1000,
      });
      throw Error('lost response');
    });
    await f.service.deliver();
    expect((await f.service.order('account-a', order.orderId))?.state).toBe('pending');
    f.setNow(10_000);
    await new CommerceService(f.store, f.meta, [f.provider], f.clock).deliver();
    expect((await f.service.order('account-a', order.orderId))?.state).toBe('fulfilled');
    expect(f.meta.apply).toHaveBeenCalledTimes(1);
  });

  it('does not accept browser success or provider proof for another account/product/price', async () => {
    const f = fixture();
    const order = await f.service.createOrder('account-a', 'r1', 'supply_personal', 'meta-v0.1');
    await expect(
      f.service.webhook('test-only', {}, Buffer.from(JSON.stringify(f.proof(order.orderId)))),
    ).rejects.toThrow('E_COMMERCE_PROOF');
    for (const change of [
      { accountId: 'account-b' },
      { productId: 'frontier_fleet_premium' },
      { amountMinor: 1 },
      { currency: 'EUR' },
    ])
      await expect(f.webhook(f.proof(order.orderId, change))).rejects.toThrow(
        'E_COMMERCE_CONFLICT',
      );
    expect(await f.service.deliver()).toBe(0);
  });

  it('rejects a provider transaction reused under a different order/account', async () => {
    const f = fixture();
    const a = await f.service.createOrder('account-a', 'r1', 'supply_personal', 'meta-v0.1');
    const b = await f.service.createOrder('account-b', 'r2', 'supply_personal', 'meta-v0.1');
    await f.webhook(f.proof(a.orderId, { providerTransactionId: 'shared' }));
    await expect(
      f.webhook(f.proof(b.orderId, { providerTransactionId: 'shared', accountId: 'account-b' })),
    ).rejects.toThrow('E_COMMERCE_CONFLICT');
    await f.service.deliver();
    expect(f.meta.apply).toHaveBeenCalledTimes(1);
  });

  it('keeps verified orders pending while Meta is unavailable and ready stays local', async () => {
    const f = fixture();
    const order = await f.service.createOrder('account-a', 'r1', 'supply_personal', 'meta-v0.1');
    await f.webhook(f.proof(order.orderId));
    vi.mocked(f.meta.status).mockRejectedValue(Error('offline'));
    await f.service.deliver();
    expect((await f.service.order('account-a', order.orderId))?.state).toBe('pending');
    await expect(f.service.ready()).resolves.toBeUndefined();
    expect(f.meta.apply).not.toHaveBeenCalled();
  });

  it('delivers refund as a separate idempotent command after the confirmed grant', async () => {
    const f = fixture();
    const order = await f.service.createOrder('account-a', 'r1', 'supply_personal', 'meta-v0.1');
    await f.webhook(f.proof(order.orderId));
    const refund = f.proof(order.orderId, { eventId: 'refund:1', kind: 'refund' });
    await f.webhook(refund);
    await f.service.deliver();
    expect((await f.service.order('account-a', order.orderId))?.state).toBe('revocation-pending');
    await f.service.deliver();
    expect((await f.service.order('account-a', order.orderId))?.state).toBe('revoked');
    await f.webhook(refund);
    expect(await f.service.deliver()).toBe(0);
    expect(vi.mocked(f.meta.apply).mock.calls.map(([command]) => command.kind)).toEqual([
      'grant',
      'revoke',
    ]);
  });

  it('holds further orders when a consumed entitlement requires refund review', async () => {
    const f = fixture();
    const order = await f.service.createOrder('account-a', 'r1', 'supply_personal', 'meta-v0.1');
    await f.webhook(f.proof(order.orderId));
    await f.service.deliver();
    await f.webhook(f.proof(order.orderId, { eventId: 'chargeback:1', kind: 'chargeback' }));
    vi.mocked(f.meta.apply).mockImplementationOnce(async (command) => ({
      ok: true,
      receipt: {
        commandId: command.commandId,
        payloadHash: command.payloadHash,
        status: 'review-required',
        at: 2000,
      },
    }));
    await f.service.deliver();
    expect((await f.service.order('account-a', order.orderId))?.state).toBe('review-required');
    await expect(
      f.service.createOrder('account-a', 'r2', 'supply_personal', 'meta-v0.1'),
    ).rejects.toThrow('E_COMMERCE_REVIEW_REQUIRED');
  });

  it('quarantines out-of-order refund instead of inventing its missing grant', async () => {
    const f = fixture();
    const order = await f.service.createOrder('account-a', 'r1', 'supply_personal', 'meta-v0.1');
    await f.webhook(f.proof(order.orderId, { eventId: 'refund:first', kind: 'refund' }));
    await f.webhook(f.proof(order.orderId));
    expect((await f.service.order('account-a', order.orderId))?.state).toBe('review-required');
    expect(await f.service.deliver()).toBe(0);
  });

  it('cannot mark an order fulfilled from a receipt with another payload hash', async () => {
    const f = fixture();
    const order = await f.service.createOrder('account-a', 'r1', 'supply_personal', 'meta-v0.1');
    await f.webhook(f.proof(order.orderId));
    vi.mocked(f.meta.status).mockImplementation(async (commandIdValue) => ({
      commandId: commandIdValue,
      payloadHash: '0'.repeat(64),
      status: 'applied',
      at: 1000,
    }));
    await f.service.deliver();
    expect((await f.service.order('account-a', order.orderId))?.state).toBe('pending');
  });

  it('bounds repeated outage retries and preserves the original command for operator replay', async () => {
    const f = fixture();
    const order = await f.service.createOrder('account-a', 'r1', 'supply_personal', 'meta-v0.1');
    await f.webhook(f.proof(order.orderId));
    vi.mocked(f.meta.apply).mockRejectedValue(Error('offline'));
    for (let attempt = 0; attempt < 8; attempt++) {
      f.setNow(1000 + attempt * 1_000_000);
      await f.service.deliver();
    }
    expect((await f.service.order('account-a', order.orderId))?.state).toBe('review-required');
    const commands = vi.mocked(f.meta.apply).mock.calls.map(([command]) => command);
    expect(new Set(commands.map((command) => command.payloadHash)).size).toBe(1);
    expect(await f.service.retry(commands[0]!.commandId)).toBe(true);
    expect((await f.service.order('account-a', order.orderId))?.state).toBe('pending');
  });

  it('sends only a named rewarded product without currency or arbitrary value', async () => {
    const f = fixture();
    const order = await f.service.createOrder('account-a', 'ad1', 'rewarded_supply', 'meta-v0.1');
    const proof = f.proof(order.orderId, { productId: 'rewarded_supply', kind: 'rewarded_ad' });
    delete proof.amountMinor;
    delete proof.currency;
    await f.webhook(proof);
    await f.service.deliver();
    expect(vi.mocked(f.meta.apply).mock.calls[0]![0]).toMatchObject({
      productId: 'rewarded_supply',
      source: 'rewarded_ad',
    });
    expect(vi.mocked(f.meta.apply).mock.calls[0]![0]).not.toHaveProperty('amount');
  });
});
