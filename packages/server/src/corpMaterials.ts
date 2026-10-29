import { createHash, randomUUID } from 'node:crypto';
import type {
  CorpBuildError,
  CorpBuildOrder,
  CorpBuildSettlement,
  CorpMaterialBank,
  CorpMaterialsView,
} from '@void/protocol';
import type { MetaEconomyStore } from './metaEconomyStore';
import type { MetaEconomyCatalog } from './metaEconomyCatalog';
import type { CorpStore } from './store';
import { reserveMaterials } from './materialStock';

type Result = { ok: true } | { ok: false; code: string };
class Rejection extends Error {}
const fail = (code: string): never => {
  throw new Rejection(code);
};
const key = (id: string): string => `corp:${id}`;
const digest = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const bankOf = (a: import('@void/protocol').MetaEconomyAccount): CorpMaterialBank =>
  (a.corpMaterials ??= { available: {}, history: [] });
const trim = (b: CorpMaterialBank): void => {
  b.history = b.history
    .filter((e) => e.status === 'pending')
    .concat(b.history.filter((e) => e.status !== 'pending').slice(-99));
};
const add = (a: number, b: number): number => {
  if (!Number.isSafeInteger(a + b) || a + b < 0) fail('E_CORP_MATERIALS');
  return a + b;
};

/** Game-owned stock. No database transaction is held across a build commit RPC.
 * Unknown delivery retains its durable hold; only a terminal Corp receipt releases it. */
export class CorpMaterials {
  constructor(
    private readonly deps: {
      store: MetaEconomyStore;
      catalog: MetaEconomyCatalog;
      corps: Pick<CorpStore, 'membershipOf' | 'prepareBuild' | 'commitBuild'>;
      now?: () => number;
    },
  ) {}
  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
  private definitions() {
    return Object.entries(this.deps.catalog.materials).filter(
      ([, def]) => def.purpose === 'corporation',
    );
  }
  private async member(accountId: string, head = false) {
    const m = await this.deps.corps.membershipOf(accountId);
    if (!m || m.role === 'recruit' || (head && m.role !== 'head')) fail('E_FORBIDDEN');
    return m!;
  }
  private async guard(run: () => Promise<Result>): Promise<Result> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof Rejection) return { ok: false, code: e.message };
      throw e;
    }
  }
  async view(accountId: string): Promise<CorpMaterialsView | null> {
    const m = await this.deps.corps.membershipOf(accountId);
    if (!m || m.role === 'recruit') return null;
    const [personal, shared] = await Promise.all([
      this.deps.store.read(accountId),
      this.deps.store.read(key(m.corpId)),
    ]);
    const b = bankOf(shared);
    return {
      corpId: m.corpId,
      pending: !!b.pending,
      history: b.history.slice(-50).reverse(),
      materials: this.definitions().map(([id, def]) => ({
        id,
        nameKey: def.nameKey,
        personal: personal.materials
          .filter(
            (l) =>
              l.materialId === id && !l.soulbound && l.source !== 'commerce' && l.source !== 'ad',
          )
          .reduce((n, l) => add(n, l.quantity), 0),
        available: b.available[id] ?? 0,
        reserved: b.pending?.materials[id] ?? 0,
      })),
    };
  }
  contribute(
    accountId: string,
    requestId: string,
    materialId: string,
    quantity: number,
  ): Promise<Result> {
    return this.guard(async () => {
      if (
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > 1_000_000 ||
        this.deps.catalog.materials[materialId]?.purpose !== 'corporation'
      )
        fail('E_CORP_MATERIALS');
      const m = await this.member(accountId);
      const receipt = `corp-contribute:${digest([accountId, requestId])}`;
      const fingerprint = digest([m.corpId, materialId, quantity]);
      return this.deps.store.transaction([accountId, key(m.corpId)], async (tx) => {
        const old = await tx.receipt(receipt);
        if (old) {
          if (old.fingerprint !== fingerprint) fail('E_IDEMPOTENCY_CONFLICT');
          return { ok: true };
        }
        if ((await this.member(accountId)).corpId !== m.corpId) fail('E_FORBIDDEN');
        const a = tx.account(accountId),
          bank = bankOf(tx.account(key(m.corpId)));
        if (!reserveMaterials(a.materials, materialId, quantity, randomUUID()))
          fail('E_INSUFFICIENT');
        a.materials = a.materials.filter((lot) => lot.quantity > 0);
        bank.available[materialId] = add(bank.available[materialId] ?? 0, quantity);
        bank.history.push({
          id: randomUUID(),
          at: this.now(),
          kind: 'contribution',
          amounts: { [materialId]: quantity },
          status: 'complete',
        });
        trim(bank);
        await tx.saveReceipt(receipt, fingerprint, { ok: true });
        return { ok: true };
      });
    });
  }
  build(accountId: string, order: CorpBuildOrder): Promise<Result> {
    return this.guard(async () => {
      const m = await this.member(accountId, true);
      const prepared = await this.deps.corps.prepareBuild(m.corpId, accountId, this.now(), {
        ...order,
        requestId: digest(order.requestId),
      });
      if (!prepared.ok) return prepared;
      const t = prepared.ticket;
      if (
        t.corpId !== m.corpId ||
        t.order.price !== order.price ||
        t.order.buildingId !== order.buildingId ||
        t.order.expectedLevel !== order.expectedLevel ||
        Object.entries(t.materials).some(
          ([id, n]) =>
            this.deps.catalog.materials[id]?.purpose !== 'corporation' ||
            !Number.isSafeInteger(n) ||
            n <= 0,
        )
      )
        fail('E_CORP_PRICE');
      const reserved = await this.deps.store.transaction(
        [key(m.corpId)],
        async (tx): Promise<Result | null> => {
          const old = await tx.receipt(`corp-build:${t.id}`);
          if (old) return old.response as Result;
          const b = bankOf(tx.account(key(m.corpId)));
          if (b.pending) {
            if (b.pending.id !== t.id) fail('E_CORP_PAYMENT_PENDING');
            return null;
          }
          if ((await this.member(accountId, true)).corpId !== m.corpId) fail('E_FORBIDDEN');
          for (const [id, n] of Object.entries(t.materials))
            if ((b.available[id] ?? 0) < n) fail('E_CORP_MATERIALS');
          for (const [id, n] of Object.entries(t.materials))
            b.available[id] = add(b.available[id] ?? 0, -n);
          b.pending = t;
          b.history.push({
            id: t.id,
            at: this.now(),
            kind: 'construction',
            amounts: Object.fromEntries(Object.entries(t.materials).map(([id, n]) => [id, -n])),
            status: 'pending',
          });
          trim(b);
          return null;
        },
      );
      return reserved ?? (await this.reconcile(m.corpId));
    });
  }
  async reconcile(corpId: string): Promise<Result> {
    const t = (await this.deps.store.read(key(corpId))).corpMaterials?.pending;
    if (!t) return { ok: true };
    let result: CorpBuildSettlement;
    try {
      result = await this.deps.corps.commitBuild(t.id, this.now());
    } catch {
      return { ok: false, code: 'E_CORP_PAYMENT_PENDING' };
    }
    // Even a 404/unknown ticket is ambiguous after service restore or rollback.
    if (!result || (result.state !== 'applied' && result.state !== 'rejected'))
      return { ok: false, code: 'E_CORP_PAYMENT_PENDING' };
    if (
      result.state === 'rejected' &&
      (typeof result.code !== 'string' || !/^E_[A-Z_]+$/.test(result.code))
    )
      return { ok: false, code: 'E_CORP_PAYMENT_PENDING' };
    return this.deps.store.transaction([key(corpId)], async (tx) => {
      const previous = await tx.receipt(`corp-build:${t.id}`);
      if (previous) return previous.response as Result;
      const bank = bankOf(tx.account(key(corpId)));
      if (bank.pending?.id !== t.id) fail('E_CORP_PAYMENT_PENDING');
      const movement = bank.history.find((e) => e.id === t.id);
      if (!movement) throw Error('E_CORP_PAYMENT_STATE');
      let response: Result = { ok: true };
      if (result.state === 'rejected') {
        for (const [id, n] of Object.entries(t.materials))
          bank.available[id] = add(bank.available[id] ?? 0, n);
        movement.status = 'refunded';
        bank.history.push({
          id: randomUUID(),
          at: this.now(),
          kind: 'refund',
          amounts: t.materials,
          status: 'complete',
        });
        response = { ok: false, code: result.code as CorpBuildError };
      } else movement.status = 'spent';
      delete bank.pending;
      trim(bank);
      await tx.saveReceipt(`corp-build:${t.id}`, digest(t), response);
      return response;
    });
  }
  private sweeping = false;
  private sweepAfter: string | undefined;
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const ids = await this.deps.store.pendingCorpMaterials(100, this.sweepAfter);
      this.sweepAfter = ids.length === 100 ? ids.at(-1) : undefined;
      for (const id of ids) await this.reconcile(id).catch(() => undefined);
    } finally {
      this.sweeping = false;
    }
  }
}
