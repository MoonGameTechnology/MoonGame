/**
 * Sovereigns ◆ paid for an order inside a match (TEC-3.1, `docs/time-economy-roadmap.md`).
 *
 * ◆ live on the account (the meta-economy store), the order lives in the match room, and
 * no transaction spans both. The host therefore works in two recorded steps:
 *
 * 1. `spend` debits the price under a receipt. A retry with the same `requestId` returns
 *    the amount already taken and never debits twice; the same `requestId` with a
 *    different order is `E_IDEMPOTENCY_CONFLICT`. Too few ◆ is refused WITHOUT a receipt,
 *    so a retry after a top-up goes through.
 * 2. The host submits the order to the room and records the verdict with `settle`:
 *    accepted keeps the ◆ spent, refused returns them. The first settlement is final: a
 *    repeat replays it and never refunds twice.
 *
 * A spend with no settlement means the host does not know whether the room applied the
 * order (a crash or a failed room write between the two steps). It is resolved by the
 * client repeating the request with the same `requestId`: the room's own receipt for the
 * order's id answers whether it was applied.
 */
import { metaEconomyFingerprint } from './metaEconomy';
import type { MetaEconomyStore } from './metaEconomyStore';

/** What the price of a fresh spend came to, or why there is none. */
export type MatchQuote = { ok: true; amount: number } | { ok: false; code: string };

export interface MatchRequest {
  matchId: string;
  requestId: string;
  /** The order being paid for. A retry must carry the same one. */
  order: unknown;
}

export interface MatchSpend extends MatchRequest {
  /** Prices a FRESH spend inside the store transaction; never called on a retry, which
   *  returns the amount already debited. */
  quote(): MatchQuote;
}

export type MatchSpendResult = { ok: true; amount: number } | { ok: false; code: string };

/** The room's verdict on the paid order. */
export type MatchVerdict = { ok: true } | { ok: false; code: string };

/** How a paid order ended: kept (`ok`) or refused with the ◆ returned. */
export type MatchOutcome =
  | { ok: true; amount: number }
  | { ok: false; code: string; refunded: number };

/** What the ledger already says about a request: its outcome, or a conflict when the
 *  request id was spent on another order. */
export type MatchReplay = MatchOutcome | { ok: false; code: 'E_IDEMPOTENCY_CONFLICT' };

class Refusal extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const SETTLED = metaEconomyFingerprint('match-settle');

function key(kind: string, accountId: string, matchId: string, requestId: string): string {
  return `meta:${kind}:${metaEconomyFingerprint([accountId, matchId, requestId])}`;
}

export class MatchSovereignLedger {
  constructor(private readonly store: Pick<MetaEconomyStore, 'transaction' | 'receipt'>) {}

  /** The settled request's outcome, a conflict if its id was spent on another order, or
   *  `null` while nothing is settled. Receipts never change once written, so this reads
   *  them outside a transaction. */
  async replay(accountId: string, request: MatchRequest): Promise<MatchReplay | null> {
    const { matchId, requestId } = request;
    const spent = await this.store.receipt(key('match-spend', accountId, matchId, requestId));
    if (!spent) return null;
    if (spent.fingerprint !== metaEconomyFingerprint(request.order))
      return { ok: false, code: 'E_IDEMPOTENCY_CONFLICT' };
    const settled = await this.store.receipt(key('match-settle', accountId, matchId, requestId));
    return settled ? (settled.response as MatchOutcome) : null;
  }

  async spend(accountId: string, spend: MatchSpend): Promise<MatchSpendResult> {
    const receiptKey = key('match-spend', accountId, spend.matchId, spend.requestId);
    const fingerprint = metaEconomyFingerprint(spend.order);
    try {
      return await this.store.transaction([accountId], async (tx) => {
        const previous = await tx.receipt(receiptKey);
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw new Refusal('E_IDEMPOTENCY_CONFLICT');
          return previous.response as MatchSpendResult;
        }
        const quote = spend.quote();
        if (!quote.ok) throw new Refusal(quote.code);
        if (!Number.isSafeInteger(quote.amount) || quote.amount <= 0) throw new Refusal('E_BAD_REQUEST');
        const account = tx.account(accountId);
        const balance = account.sovereigns ?? 0;
        if (balance < quote.amount) throw new Refusal('E_SOVEREIGNS');
        account.sovereigns = balance - quote.amount;
        const response: MatchSpendResult = { ok: true, amount: quote.amount };
        await tx.saveReceipt(receiptKey, fingerprint, response);
        return response;
      });
    } catch (error) {
      if (error instanceof Refusal) return { ok: false, code: error.code };
      throw error;
    }
  }

  /** Record the room's verdict once: a refusal returns the spent ◆ in the same
   *  transaction. Settling a request that spent nothing is a host bug and throws. */
  async settle(
    accountId: string,
    matchId: string,
    requestId: string,
    verdict: MatchVerdict,
  ): Promise<MatchOutcome> {
    const settleKey = key('match-settle', accountId, matchId, requestId);
    return this.store.transaction([accountId], async (tx) => {
      const previous = await tx.receipt(settleKey);
      if (previous) return previous.response as MatchOutcome;
      const spendKey = key('match-spend', accountId, matchId, requestId);
      const spent = (await tx.receipt(spendKey))?.response as MatchSpendResult | undefined;
      if (!spent?.ok) throw new Error('E_NOTHING_SPENT');
      let outcome: MatchOutcome;
      if (verdict.ok) {
        outcome = { ok: true, amount: spent.amount };
      } else {
        const account = tx.account(accountId);
        account.sovereigns = (account.sovereigns ?? 0) + spent.amount;
        outcome = { ok: false, code: verdict.code, refunded: spent.amount };
      }
      await tx.saveReceipt(settleKey, SETTLED, outcome);
      return outcome;
    });
  }
}
