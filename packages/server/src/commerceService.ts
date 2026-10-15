import { createHash, randomUUID } from 'node:crypto';
import type {
  CommerceOffer,
  CommerceOrderView,
  EntitlementCommandV1,
  EntitlementReceipt,
} from '@void/protocol';
import { commerceOffers } from './commerceCatalog';
import { hashEntitlementCommand, type CommerceEntitlementService } from './commerceTransport';
import {
  isRevocation,
  type CommerceOrder,
  type CommerceStore,
  type CommerceVerification,
} from './commerceStore';

export interface CommerceProvider {
  id: string;
  offers: readonly {
    productId: string;
    price?: { amountMinor: number; currency: string };
  }[];
  /** Verify provider signatures/receipts with the provider's documented protocol.
   * Client SDK outcomes are not proof. No production adapter ships enabled in v0. */
  verify(input: {
    headers: Readonly<Record<string, string>>;
    rawBody: Uint8Array;
    signal: AbortSignal;
  }): Promise<CommerceVerification | null>;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const validId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);
const commandId = (orderId: string, kind: 'grant' | 'revoke') =>
  `commerce:${kind}:${createHash('sha256').update(orderId).digest('hex')}`;

function publicOrder(order: CommerceOrder): CommerceOrderView {
  return {
    orderId: order.orderId,
    productId: order.offer.productId,
    catalogVersion: order.offer.catalogVersion,
    state: order.state,
    createdAt: order.createdAt,
    ...(order.receipt ? { receipt: order.receipt } : {}),
  };
}

export class CommerceService {
  private readonly providers = new Map<string, CommerceProvider>();
  private readonly products = new Map<string, { provider: string; offer: CommerceOffer }>();
  private delivering = false;

  constructor(
    private readonly store: CommerceStore,
    private readonly meta: CommerceEntitlementService,
    providers: readonly CommerceProvider[] = [],
    private readonly now: () => number = Date.now,
  ) {
    for (const provider of providers) {
      if (!validId(provider.id) || this.providers.has(provider.id))
        throw Error('E_COMMERCE_CONFIG');
      this.providers.set(provider.id, provider);
      for (const configured of provider.offers) {
        const offer = commerceOffers().find((row) => row.productId === configured.productId);
        if (!offer || this.products.has(configured.productId)) throw Error('E_COMMERCE_CONFIG');
        if (offer.source === 'payment') {
          if (
            !configured.price ||
            !Number.isSafeInteger(configured.price.amountMinor) ||
            configured.price.amountMinor <= 0 ||
            configured.price.amountMinor > 100_000_000 ||
            !/^[A-Z]{3}$/.test(configured.price.currency)
          )
            throw Error('E_COMMERCE_CONFIG');
        } else if (configured.price) throw Error('E_COMMERCE_CONFIG');
        const { unavailableReason: _reason, ...available } = offer;
        this.products.set(offer.productId, {
          provider: provider.id,
          offer: {
            ...available,
            available: true,
            ...(configured.price ? { price: { ...configured.price } } : {}),
          },
        });
      }
    }
  }

  offers(): CommerceOffer[] {
    return commerceOffers().map((offer) =>
      structuredClone(this.products.get(offer.productId)?.offer ?? offer),
    );
  }

  async createOrder(
    accountId: string,
    requestId: string,
    productId: string,
    catalogVersion: string,
  ): Promise<CommerceOrderView> {
    if (!validId(accountId) || !validId(requestId)) throw Error('E_BAD_REQUEST');
    const product = this.products.get(productId);
    if (!product || product.offer.catalogVersion !== catalogVersion)
      throw Error('E_COMMERCE_UNAVAILABLE');
    return publicOrder(
      await this.store.create({
        orderId: `order:${randomUUID()}`,
        accountId,
        requestId,
        provider: product.provider,
        offer: structuredClone(product.offer),
        state: 'created',
        createdAt: this.now(),
      }),
    );
  }

  async order(accountId: string, orderId: string): Promise<CommerceOrderView | null> {
    if (!validId(accountId) || !validId(orderId)) return null;
    const order = await this.store.get(orderId);
    return order?.accountId === accountId ? publicOrder(order) : null;
  }

  async webhook(
    providerId: string,
    headers: Readonly<Record<string, string>>,
    rawBody: Uint8Array,
  ): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) throw Error('E_COMMERCE_UNAVAILABLE');
    if (rawBody.byteLength > 65_536) throw Error('E_BAD_REQUEST');
    let raw: CommerceVerification | null;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      raw = await Promise.race([
        provider.verify({ headers, rawBody, signal: controller.signal }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(null);
          }, 2000);
        }),
      ]);
    } catch {
      throw Error('E_COMMERCE_PROOF');
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (
      !raw ||
      raw.provider !== provider.id ||
      ![
        raw.eventId,
        raw.providerTransactionId,
        raw.orderId,
        raw.accountId,
        raw.productId,
        raw.catalogVersion,
      ].every(validId) ||
      !['payment', 'rewarded_ad', 'refund', 'chargeback'].includes(raw.kind)
    )
      throw Error('E_COMMERCE_PROOF');
    // Copy only defined proof fields. Raw provider responses/secrets are never persisted.
    const proof: CommerceVerification = {
      eventId: raw.eventId,
      provider: raw.provider,
      providerTransactionId: raw.providerTransactionId,
      orderId: raw.orderId,
      accountId: raw.accountId,
      productId: raw.productId,
      catalogVersion: raw.catalogVersion,
      kind: raw.kind,
      ...(raw.amountMinor !== undefined ? { amountMinor: raw.amountMinor } : {}),
      ...(raw.currency !== undefined ? { currency: raw.currency } : {}),
    };
    const order = await this.store.get(proof.orderId);
    if (!order) throw Error('E_COMMERCE_PROOF');
    const kind = isRevocation(proof) ? 'revoke' : 'grant';
    const payload: Omit<EntitlementCommandV1, 'payloadHash'> = {
      version: 1,
      commandId: commandId(order.orderId, kind),
      kind,
      source: order.offer.source,
      orderId: order.orderId,
      provider: provider.id,
      providerTransactionId: proof.providerTransactionId,
      accountId: order.accountId,
      productId: order.offer.productId,
      catalogVersion: order.offer.catalogVersion,
      at: this.now(),
      ...(kind === 'revoke' ? { originalCommandId: commandId(order.orderId, 'grant') } : {}),
    };
    await this.store.record(
      proof,
      { ...payload, payloadHash: hashEntitlementCommand(payload) },
      this.now(),
    );
  }

  /** Bounded durable delivery. Failure never changes command ID, payload or proof. */
  async deliver(limit = 8): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 16) throw Error('E_COMMERCE_CONFIG');
    if (this.delivering) return 0;
    this.delivering = true;
    try {
      const deliveries = await this.store.claim(this.now(), limit, 15_000);
      await Promise.all(
        deliveries.map(async (delivery) => {
          try {
            // Resolve unknown outcomes before sending the same immutable command again.
            let receipt: EntitlementReceipt | null = await this.meta.status(
              delivery.command.commandId,
            );
            if (!receipt) {
              const result = await this.meta.apply(delivery.command);
              if (!result.ok) {
                await this.store.defer(delivery, this.now(), true);
                return;
              }
              receipt = result.receipt;
            }
            if (
              receipt.commandId !== delivery.command.commandId ||
              receipt.payloadHash !== delivery.command.payloadHash ||
              !Number.isSafeInteger(receipt.at) ||
              receipt.at < 0 ||
              (delivery.command.kind === 'grant' &&
                receipt.status !== 'applied' &&
                receipt.status !== 'review-required') ||
              (delivery.command.kind === 'revoke' &&
                receipt.status !== 'revoked' &&
                receipt.status !== 'review-required')
            )
              throw Error('E_COMMERCE_RECEIPT');
            await this.store.finish(delivery, receipt);
          } catch {
            // Deterministic per-command jitter avoids synchronized recovery, no RNG dependency.
            const jitter =
              parseInt(
                createHash('sha256').update(delivery.command.commandId).digest('hex').slice(0, 4),
                16,
              ) % 1000;
            await this.store.defer(
              delivery,
              this.now() + Math.min(300_000, 1000 * 2 ** Math.min(delivery.attempts, 8)) + jitter,
              delivery.attempts >= 8,
            );
          }
        }),
      );
      return deliveries.length;
    } finally {
      this.delivering = false;
    }
  }

  /** Trusted operator port, deliberately not exposed to browser or provider routes. */
  retry(commandIdValue: string): Promise<boolean> {
    return this.store.retry(commandIdValue, this.now());
  }
  ready(): Promise<void> {
    return this.store.ready();
  }
}
