import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseEntitlementCommand } from './commerceTransport';
import type {
  CommerceOffer,
  CommerceOrderState,
  EntitlementCommandV1,
  EntitlementReceipt,
} from '@void/protocol';

export interface CommerceOrder {
  orderId: string;
  accountId: string;
  requestId: string;
  provider: string;
  offer: CommerceOffer;
  state: CommerceOrderState;
  createdAt: number;
  receipt?: EntitlementReceipt;
}

export interface CommerceVerification {
  /** Comes exclusively from a configured provider verifier, never from the client. */
  eventId: string;
  provider: string;
  providerTransactionId: string;
  orderId: string;
  accountId: string;
  productId: string;
  catalogVersion: string;
  kind: 'payment' | 'rewarded_ad' | 'refund' | 'chargeback';
  amountMinor?: number;
  currency?: string;
}

export interface CommerceDelivery {
  command: EntitlementCommandV1;
  attempts: number;
  nextAttemptAt: number;
  leaseUntil: number;
  leaseToken: string;
  terminal: boolean;
  receipt?: EntitlementReceipt;
}

export interface CommerceStore {
  create(order: CommerceOrder): Promise<CommerceOrder>;
  get(orderId: string): Promise<CommerceOrder | null>;
  /** Proof, provider uniqueness and outbox are committed together. */
  record(
    proof: CommerceVerification,
    command: EntitlementCommandV1,
    now: number,
  ): Promise<CommerceOrder>;
  claim(now: number, limit: number, leaseMs: number): Promise<CommerceDelivery[]>;
  finish(delivery: CommerceDelivery, receipt: EntitlementReceipt): Promise<void>;
  defer(delivery: CommerceDelivery, nextAttemptAt: number, quarantine: boolean): Promise<void>;
  retry(commandId: string, now: number): Promise<boolean>;
  ready(): Promise<void>;
}

export function commerceConflict(): never {
  throw Error('E_COMMERCE_CONFLICT');
}

export function matchingProof(order: CommerceOrder, proof: CommerceVerification): boolean {
  return (
    proof.provider === order.provider &&
    proof.accountId === order.accountId &&
    proof.productId === order.offer.productId &&
    proof.catalogVersion === order.offer.catalogVersion &&
    (proof.kind === 'refund' || proof.kind === 'chargeback' || proof.kind === order.offer.source) &&
    (order.offer.source === 'rewarded_ad'
      ? proof.amountMinor === undefined && proof.currency === undefined
      : proof.amountMinor === order.offer.price?.amountMinor &&
        proof.currency === order.offer.price?.currency)
  );
}

export function matchingCommand(
  order: CommerceOrder,
  proof: CommerceVerification,
  command: EntitlementCommandV1,
): boolean {
  return (
    parseEntitlementCommand(command) !== null &&
    command.orderId === order.orderId &&
    command.provider === proof.provider &&
    command.providerTransactionId === proof.providerTransactionId &&
    command.accountId === order.accountId &&
    command.productId === order.offer.productId &&
    command.catalogVersion === order.offer.catalogVersion &&
    command.source === order.offer.source &&
    command.kind === (isRevocation(proof) ? 'revoke' : 'grant')
  );
}

export function assertCommerceReceipt(
  command: EntitlementCommandV1,
  receipt: EntitlementReceipt,
): void {
  if (
    receipt.commandId !== command.commandId ||
    receipt.payloadHash !== command.payloadHash ||
    !Number.isSafeInteger(receipt.at) ||
    receipt.at < 0 ||
    (receipt.status !== 'review-required' &&
      receipt.status !== (command.kind === 'grant' ? 'applied' : 'revoked'))
  )
    commerceConflict();
}

export function isRevocation(proof: CommerceVerification): boolean {
  return proof.kind === 'refund' || proof.kind === 'chargeback';
}

/** Memory is an explicit test/dev adapter. Runtime never falls back after a DB failure. */
export class MemoryCommerceStore implements CommerceStore {
  private readonly orders = new Map<string, CommerceOrder>();
  private readonly requests = new Map<string, string>();
  private readonly transactions = new Map<string, string>();
  private readonly events = new Map<string, CommerceVerification>();
  private readonly deliveries = new Map<string, CommerceDelivery>();

  async create(order: CommerceOrder): Promise<CommerceOrder> {
    const key = JSON.stringify([order.accountId, order.requestId]);
    const previous = this.requests.get(key);
    if (previous) {
      const old = this.orders.get(previous)!;
      if (!isDeepStrictEqual(old.offer, order.offer) || old.provider !== order.provider)
        commerceConflict();
      return structuredClone(old);
    }
    if (
      [...this.orders.values()].some(
        (row) => row.accountId === order.accountId && row.state === 'review-required',
      )
    )
      throw Error('E_COMMERCE_REVIEW_REQUIRED');
    if (this.orders.has(order.orderId)) commerceConflict();
    this.requests.set(key, order.orderId);
    this.orders.set(order.orderId, structuredClone(order));
    return structuredClone(order);
  }

  async get(orderId: string): Promise<CommerceOrder | null> {
    return structuredClone(this.orders.get(orderId) ?? null);
  }

  async record(
    proof: CommerceVerification,
    command: EntitlementCommandV1,
    now: number,
  ): Promise<CommerceOrder> {
    const order = this.orders.get(proof.orderId);
    if (!order || !matchingProof(order, proof) || !matchingCommand(order, proof, command))
      commerceConflict();
    const eventKey = JSON.stringify([proof.provider, proof.eventId]);
    const priorEvent = this.events.get(eventKey);
    if (priorEvent) {
      if (!isDeepStrictEqual(priorEvent, proof)) commerceConflict();
      return structuredClone(order);
    }
    const txKey = JSON.stringify([proof.provider, proof.providerTransactionId]);
    const previous = this.transactions.get(txKey);
    if (previous && previous !== proof.orderId) commerceConflict();
    if ([...this.transactions.entries()].some(([tx, id]) => id === proof.orderId && tx !== txKey))
      commerceConflict();
    const existing = [...this.deliveries.values()].find(
      (row) => row.command.orderId === order.orderId && row.command.kind === command.kind,
    );
    if (existing && existing.command.providerTransactionId !== proof.providerTransactionId)
      commerceConflict();
    const grant = [...this.deliveries.values()].find(
      (row) => row.command.orderId === order.orderId && row.command.kind === 'grant',
    );
    if (isRevocation(proof) && grant && command.originalCommandId !== grant.command.commandId)
      commerceConflict();
    if (!existing && this.deliveries.has(command.commandId)) commerceConflict();
    this.events.set(eventKey, structuredClone(proof));
    this.transactions.set(txKey, proof.orderId);
    if (existing || order.state === 'revoked' || order.state === 'review-required')
      return structuredClone(order);
    if (isRevocation(proof) && !grant) {
      // An out-of-order reversal cannot invent the missing purchase or game grant.
      order.state = 'review-required';
      return structuredClone(order);
    }
    this.deliveries.set(command.commandId, {
      command: structuredClone(command),
      attempts: 0,
      nextAttemptAt: now,
      leaseUntil: 0,
      leaseToken: '',
      terminal: false,
    });
    order.state = isRevocation(proof) ? 'revocation-pending' : 'pending';
    return structuredClone(order);
  }

  async claim(now: number, limit: number, leaseMs: number): Promise<CommerceDelivery[]> {
    const candidates = [...this.deliveries.values()]
      .filter((row) => !row.terminal && row.nextAttemptAt <= now && row.leaseUntil <= now)
      .filter(
        (row) =>
          row.command.kind === 'grant' ||
          [...this.deliveries.values()].some(
            (grant) =>
              grant.command.commandId === row.command.originalCommandId &&
              grant.receipt?.status === 'applied',
          ),
      )
      .sort(
        (a, b) =>
          a.nextAttemptAt - b.nextAttemptAt ||
          a.command.commandId.localeCompare(b.command.commandId),
      )
      .slice(0, limit);
    for (const row of candidates) {
      row.attempts++;
      row.leaseUntil = now + leaseMs;
      row.leaseToken = randomUUID();
    }
    return structuredClone(candidates);
  }

  async finish(delivery: CommerceDelivery, receipt: EntitlementReceipt): Promise<void> {
    const row = this.deliveries.get(delivery.command.commandId);
    if (!row || row.leaseToken !== delivery.leaseToken || row.terminal) return;
    assertCommerceReceipt(row.command, receipt);
    row.terminal = true;
    row.receipt = structuredClone(receipt);
    const order = this.orders.get(row.command.orderId)!;
    order.receipt = structuredClone(receipt);
    if (receipt.status === 'review-required') order.state = 'review-required';
    else if (receipt.status === 'revoked') order.state = 'revoked';
    else if (order.state !== 'revocation-pending') order.state = 'fulfilled';
  }

  async defer(
    delivery: CommerceDelivery,
    nextAttemptAt: number,
    quarantine: boolean,
  ): Promise<void> {
    const row = this.deliveries.get(delivery.command.commandId);
    if (!row || row.leaseToken !== delivery.leaseToken || row.terminal) return;
    row.nextAttemptAt = nextAttemptAt;
    row.leaseUntil = 0;
    row.terminal = quarantine;
    if (quarantine) this.orders.get(row.command.orderId)!.state = 'review-required';
  }

  async retry(commandId: string, now: number): Promise<boolean> {
    const row = this.deliveries.get(commandId);
    if (!row || !row.terminal || row.receipt) return false;
    const order = this.orders.get(row.command.orderId)!;
    const reversal = [...this.deliveries.values()].find(
      (other) => other.command.orderId === row.command.orderId && other.command.kind === 'revoke',
    );
    if (order.state === 'revoked' || reversal?.receipt) return false;
    row.terminal = false;
    row.attempts = 0;
    row.nextAttemptAt = now;
    row.leaseUntil = 0;
    row.leaseToken = '';
    order.state = row.command.kind === 'revoke' || reversal ? 'revocation-pending' : 'pending';
    return true;
  }

  async ready(): Promise<void> {}
}
