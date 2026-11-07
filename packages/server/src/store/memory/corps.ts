/** В памяти: корпорации и аренда корпоративных построек (SLIM-5). */
import type {
  CorpBuildOrder,
  CorpEmblemId,
  CorpInfrastructureResult,
  CorpInfrastructureState,
  CorpShowcaseResult,
} from '@void/protocol';
import { corpBuildPrice, updateCorpInfrastructure } from '../../corpConstruction';
import { corpFoundedNews, corpLevelNews } from '../../corpNews';
import { corpFacilities, publicCorpFacilities, validateShowcase } from '../../corpFacilities';
import { randomUUID } from 'node:crypto';
import {
  type AvaFeedStore,
  type AvaResultStore,
  type CorpAuditEntry,
  type CorpFeedEntry,
  type CorpMembership,
  type CorpRecord,
  type CorpRent,
  type CorpRentStore,
  type CorpRole,
  type CorpStore,
  type CorpSummary,
  DEFAULT_AUDIT_LIMIT,
} from '../types';

/** In-memory corp store — membership keyed by account (one corp per account). */
export class MemoryCorpStore implements CorpStore {
  private readonly memberNonces = new Map<string, string>();
  private readonly buildTickets = new Map<string, {
    ticket: import('@void/protocol').CorpBuildTicket; nonce: string | null; key: string;
    result?: import('@void/protocol').CorpBuildSettlement;
  }>();
  async prepareBuild(corpId: string, actor: string, now: number, order: CorpBuildOrder): Promise<import('@void/protocol').CorpBuildPreparation> {
    const view = await this.infrastructure(corpId, actor, now);
    const member = this.members.get(actor);
    if (!view.ok || member?.role !== 'head' || member.corpId !== corpId) return { ok: false, code: 'E_FORBIDDEN' };
    let nonce = this.memberNonces.get(actor);
    if (!nonce) this.memberNonces.set(actor, nonce = randomUUID());
    const key = order.requestId!;
    const old = [...this.buildTickets.values()].find((t) => t.ticket.corpId === corpId && t.nonce === nonce && t.key === key);
    if (old) return old.ticket.order.price === order.price && old.ticket.order.buildingId === order.buildingId && old.ticket.order.expectedLevel === order.expectedLevel
      ? { ok: true, ticket: structuredClone(old.ticket) } : { ok: false, code: 'E_IDEMPOTENCY_CONFLICT' };
    const b = view.infrastructure.buildings.find((b) => b.id === order.buildingId);
    if (!b?.next || b.level !== order.expectedLevel) return { ok: false, code: 'E_CORP_BUILD_LEVEL' };
    if (!order.requestId || order.price !== b.next.price) return { ok: false, code: 'E_CORP_PRICE' };
    if (b.blocked) return { ok: false, code: b.blocked };
    const ticket = { id: randomUUID(), corpId, order: { ...order, requestId: undefined }, materials: { ...b.next.materials } };
    this.buildTickets.set(ticket.id, { ticket, nonce, key });
    return { ok: true, ticket: structuredClone(ticket) };
  }
  async commitBuild(id: string, now: number): Promise<import('@void/protocol').CorpBuildSettlement> {
    const row = this.buildTickets.get(id);
    if (!row) return { state: 'unknown' };
    if (row.result) return structuredClone(row.result);
    const battles = (await this.results?.statsForCorp(row.ticket.corpId))?.matches ?? 0;
    // Recheck after await. Authorize, mutate, and cache the terminal receipt without yielding.
    if (row.result) return structuredClone(row.result);
    const { corpId, order } = row.ticket;
    const member = [...this.members.values()].find((m) => row.nonce !== null && this.memberNonces.get(m.accountId) === row.nonce);
    const corp = this.corps.get(corpId);
    if (!corp || !member || member.corpId !== corpId || member.role !== 'head')
      return row.result = { state: 'rejected', code: 'E_FORBIDDEN' };
    if (order.price !== corpBuildPrice(corpId, order)) return row.result = { state: 'rejected', code: 'E_CORP_PRICE' };
    const updated = updateCorpInfrastructure(corpId, member.accountId, member.role, corp.influence,
      this.infrastructureStates.get(corpId) ?? null, now, order,
      { members: [...this.members.values()].filter((m) => m.corpId === corpId && m.role !== 'recruit').length, battles });
    corp.influence = updated.influence;
    this.infrastructureStates.set(corpId, updated.state);
    this.audit.push(...updated.audit);
    row.result = updated.result.ok ? { state: 'applied' } : { state: 'rejected', code: updated.result.code };
    // Feed observation cannot undo an already committed payment receipt.
    await this.publish(corpLevelNews(corpId, corp.name, updated.audit)).catch(() => undefined);
    return structuredClone(row.result);
  }
  private revokeBuildMembership(accountId: string): void {
    const nonce = this.memberNonces.get(accountId);
    if (nonce) for (const ticket of this.buildTickets.values()) if (ticket.nonce === nonce) ticket.nonce = null;
    this.memberNonces.delete(accountId);
  }

  monumentsOf(ids: readonly string[]): Promise<string[]> {
    if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== 'string')) return Promise.resolve([]);
    return Promise.resolve(ids.filter((id) => this.corps.has(id) && publicCorpFacilities(this.infrastructureStates.get(id) ?? null, Date.now()).monument));
  }
  private readonly infrastructureStates = new Map<string, CorpInfrastructureState>();
  private readonly showcases = new Map<string, string[]>();

  /** CORP-1: the public feed the corporation's own facts go to (founded, reached a level)
   *  — the memory twin of the Postgres store writing them in the same transaction.
   *  CORP-6: `results` — the AvA outcomes the played-battle requirement counts; without
   *  them the corporation has played none. */
  constructor(
    private readonly feed?: Pick<AvaFeedStore, 'append'>,
    private readonly results?: Pick<AvaResultStore, 'statsForCorp'>,
  ) {}

  async infrastructure(corpId: string, actor: string, now: number, order?: CorpBuildOrder): Promise<CorpInfrastructureResult> {
    // Played battles only grow: read them before the step below.
    const battles = (await this.results?.statsForCorp(corpId))?.matches ?? 0;
    // No await between the authorization read and commit: one event-loop operation.
    const member = this.members.get(actor);
    const corp = this.corps.get(corpId);
    if (!corp || !member || member.corpId !== corpId || member.role === 'recruit' || (order && member.role !== 'head')) {
      return { ok: false, code: 'E_FORBIDDEN' };
    }
    let members = 0;
    for (const m of this.members.values()) if (m.corpId === corpId && m.role !== 'recruit') members += 1;
    const updated = updateCorpInfrastructure(corpId, actor, member.role, corp.influence, this.infrastructureStates.get(corpId) ?? null, now, order, { members, battles });
    corp.influence = updated.influence;
    this.infrastructureStates.set(corpId, updated.state);
    this.audit.push(...updated.audit);
    const result = structuredClone(updated.result);
    await this.publish(corpLevelNews(corpId, corp.name, updated.audit));
    return result;
  }

  private async publish(entries: readonly CorpFeedEntry[]): Promise<void> {
    for (const entry of entries) await this.feed?.append(entry);
  }

  private readonly corps = new Map<string, CorpRecord>();
  /** `accountId → membership` — the map key IS the one-corp-per-account invariant. */
  private readonly members = new Map<string, CorpMembership>();
  private readonly audit: CorpAuditEntry[] = [];
  /** AvA readiness (AVA-3): corp-flag `corpId → {since, formats}` (formats: CORP-7),
   *  player-flag `accountId → {corpId, since}`. */
  private readonly corpReady = new Map<string, { since: number; formats: number[] }>();
  private readonly playerReady = new Map<string, { corpId: string; since: number }>();

  createCorp(
    name: string,
    headAccountId: string,
    headLogin: string,
    at: number = Date.now(),
    emblemId?: CorpEmblemId,
  ): Promise<{ ok: true; corpId: string } | { ok: false; code: 'E_NAME_TAKEN' | 'E_IN_CORP' }> {
    if (this.members.has(headAccountId)) return Promise.resolve({ ok: false, code: 'E_IN_CORP' });
    const key = name.toLowerCase();
    for (const corp of this.corps.values()) {
      if (corp.name.toLowerCase() === key)
        return Promise.resolve({ ok: false, code: 'E_NAME_TAKEN' });
    }
    const corpId = randomUUID();
    this.corps.set(corpId, { corpId, name, influence: 0, ...(emblemId ? { emblemId } : {}) });
    this.members.set(headAccountId, {
      corpId,
      accountId: headAccountId,
      login: headLogin,
      role: 'head',
    });
    return this.publish([corpFoundedNews(corpId, name, at)]).then(() => ({ ok: true as const, corpId }));
  }

  setEmblem(corpId: string, actor: string, emblemId: CorpEmblemId, at: number): Promise<{ ok: true } | { ok: false; code: 'E_FORBIDDEN' }> {
    const corp = this.corps.get(corpId), member = this.members.get(actor);
    if (!corp || member?.corpId !== corpId || member.role !== 'head')
      return Promise.resolve({ ok: false, code: 'E_FORBIDDEN' });
    if (corp.emblemId !== emblemId) {
      this.corps.set(corpId, { ...corp, emblemId });
      this.audit.push({ corpId, actor, at, action: 'emblem', detail: emblemId });
    }
    return Promise.resolve({ ok: true });
  }

  getCorp(corpId: string): Promise<CorpRecord | null> {
    const corp = this.corps.get(corpId);
    return Promise.resolve(corp ? { ...corp, ...publicCorpFacilities(this.infrastructureStates.get(corpId) ?? null, Date.now(), this.showcases.get(corpId)) } : null);
  }

  async setShowcase(corpId: string, actor: string, medalIds: readonly string[], at: number): Promise<CorpShowcaseResult> {
    const stats = await this.results?.statsForCorp(corpId) ?? { wins: 0, matches: 0 };
    // No awaits between checking the current head, validating, and committing the list.
    const member = this.members.get(actor);
    if (!this.corps.has(corpId) || member?.corpId !== corpId || member.role !== 'head') return { ok: false, code: 'E_FORBIDDEN' };
    const capacity = corpFacilities(this.infrastructureStates.get(corpId) ?? null, at).showcaseSlots;
    const error = validateShowcase(medalIds, capacity, stats);
    if (error) return { ok: false, code: error };
    if (JSON.stringify(this.showcases.get(corpId) ?? []) !== JSON.stringify(medalIds)) {
      this.showcases.set(corpId, [...medalIds]);
      await this.appendAudit({ corpId, actor, at, action: 'showcase', detail: JSON.stringify(medalIds) });
    }
    return { ok: true };
  }

  listCorps(): Promise<CorpSummary[]> {
    const list = [...this.corps.values()].map((corp) => ({
      ...corp,
      ...publicCorpFacilities(this.infrastructureStates.get(corp.corpId) ?? null, Date.now(), this.showcases.get(corp.corpId)),
      members: [...this.members.values()].filter(
        (m) => m.corpId === corp.corpId && m.role !== 'recruit',
      ).length,
    }));
    list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return Promise.resolve(list);
  }

  membershipOf(accountId: string): Promise<CorpMembership | null> {
    const row = this.members.get(accountId);
    return Promise.resolve(row ? { ...row } : null);
  }

  membersOf(corpId: string): Promise<CorpMembership[]> {
    return Promise.resolve(
      [...this.members.values()].filter((m) => m.corpId === corpId).map((m) => ({ ...m })),
    );
  }

  addMember(
    corpId: string,
    accountId: string,
    login: string,
    role: CorpRole,
  ): Promise<{ ok: true } | { ok: false; code: 'E_IN_CORP' }> {
    if (this.members.has(accountId)) return Promise.resolve({ ok: false, code: 'E_IN_CORP' });
    this.members.set(accountId, { corpId, accountId, login, role });
    return Promise.resolve({ ok: true });
  }

  setRole(corpId: string, accountId: string, role: CorpRole): Promise<void> {
    const row = this.members.get(accountId);
    if (row && row.corpId === corpId) row.role = role;
    return Promise.resolve();
  }

  removeMember(corpId: string, accountId: string): Promise<void> {
    const row = this.members.get(accountId);
    if (row && row.corpId === corpId) {
      this.revokeBuildMembership(accountId);
      this.members.delete(accountId);
      this.playerReady.delete(accountId); // leaving the corp revokes the consent (AVA-3)
    }
    return Promise.resolve();
  }

  swapHead(corpId: string, fromAccountId: string, toAccountId: string): Promise<void> {
    const from = this.members.get(fromAccountId);
    const to = this.members.get(toAccountId);
    if (!from || !to || from.corpId !== corpId || to.corpId !== corpId) return Promise.resolve();
    if (from.role !== 'head') return Promise.resolve();
    from.role = 'officer';
    to.role = 'head';
    return Promise.resolve();
  }

  removeCorp(corpId: string): Promise<void> {
    this.corps.delete(corpId);
    this.infrastructureStates.delete(corpId);
    this.showcases.delete(corpId);
    this.corpReady.delete(corpId);
    for (const [accountId, row] of this.members) {
      if (row.corpId === corpId) {
        this.revokeBuildMembership(accountId);
      this.members.delete(accountId);
        this.playerReady.delete(accountId);
      }
    }
    return Promise.resolve();
  }

  adjustRating(corpId: string, delta: number, start: number): Promise<void> {
    const corp = this.corps.get(corpId);
    if (corp) corp.rating = (corp.rating ?? start) + delta;
    return Promise.resolve();
  }

  addInfluence(corpId: string, delta: number): Promise<void> {
    const corp = this.corps.get(corpId);
    if (corp && delta > 0) corp.influence += delta;
    return Promise.resolve();
  }

  spendInfluence(
    corpId: string,
    cost: number,
  ): Promise<{ ok: true } | { ok: false; code: 'E_INSUFFICIENT' }> {
    const corp = this.corps.get(corpId);
    if (!corp || cost <= 0 || corp.influence < cost) {
      return Promise.resolve({ ok: false, code: 'E_INSUFFICIENT' });
    }
    corp.influence -= cost;
    return Promise.resolve({ ok: true });
  }

  setCorpReady(corpId: string, since: number, formats: readonly number[]): Promise<void> {
    if (this.corps.has(corpId)) {
      const entry = this.corpReady.get(corpId);
      this.corpReady.set(corpId, { since: entry?.since ?? since, formats: [...formats] });
    }
    return Promise.resolve();
  }

  clearCorpReady(corpId: string): Promise<void> {
    this.corpReady.delete(corpId);
    return Promise.resolve();
  }

  async listReadyCorps(): Promise<Array<CorpSummary & { readySince: number; formats: number[] }>> {
    const all = await this.listCorps();
    return all.flatMap((c) => {
      const entry = this.corpReady.get(c.corpId);
      return entry ? [{ ...c, readySince: entry.since, formats: [...entry.formats] }] : [];
    });
  }

  readyFormatsOf(corpId: string): Promise<number[] | null> {
    const entry = this.corpReady.get(corpId);
    return Promise.resolve(entry ? [...entry.formats] : null);
  }

  setPlayerReady(accountId: string, corpId: string, since: number): Promise<void> {
    const existing = this.playerReady.get(accountId);
    this.playerReady.set(accountId, existing?.corpId === corpId ? existing : { corpId, since });
    return Promise.resolve();
  }

  clearPlayerReady(accountId: string): Promise<void> {
    this.playerReady.delete(accountId);
    return Promise.resolve();
  }

  readyPlayersOf(corpId: string): Promise<string[]> {
    return Promise.resolve(
      [...this.playerReady.entries()]
        .filter(([, v]) => v.corpId === corpId)
        .map(([accountId]) => accountId)
        .sort(),
    );
  }

  appendAudit(entry: CorpAuditEntry): Promise<void> {
    if (!entry.eventId || !this.audit.some((row) => row.eventId === entry.eventId)) this.audit.push({ ...entry });
    return Promise.resolve();
  }

  auditOf(corpId: string, limit = DEFAULT_AUDIT_LIMIT): Promise<CorpAuditEntry[]> {
    const rows = this.audit.filter((e) => e.corpId === corpId);
    return Promise.resolve(
      rows
        .slice(-limit)
        .reverse()
        .map((e) => ({ ...e })),
    );
  }
}

/** In-memory corp-arsenal rental store (ARS-6): one item on rent to at most one war
 *  at a time, an exactly-once close per (matchup, item). */
export class MemoryCorpRentStore implements CorpRentStore {
  private readonly active = new Map<string, CorpRent>(); // itemId -> row

  activeForCorp(corpId: string): Promise<CorpRent[]> {
    return Promise.resolve([...this.active.values()].filter((r) => r.corpId === corpId).map((r) => ({ ...r })));
  }

  rent(entry: CorpRent): Promise<boolean> {
    if (this.active.has(entry.itemId)) return Promise.resolve(false);
    this.active.set(entry.itemId, { ...entry });
    return Promise.resolve(true);
  }
  rentWithLimit(entry: CorpRent, limit: number): Promise<'ok' | 'limit' | 'rented'> {
    if (this.active.has(entry.itemId)) return Promise.resolve('rented');
    if (!Number.isSafeInteger(limit) || limit < 1 || [...this.active.values()].filter((r) => r.corpId === entry.corpId && r.matchupId === entry.matchupId).length >= limit) return Promise.resolve('limit');
    this.active.set(entry.itemId, { ...entry });
    return Promise.resolve('ok');
  }

  activeForMatchup(matchupId: string): Promise<CorpRent[]> {
    return Promise.resolve(
      [...this.active.values()].filter((r) => r.matchupId === matchupId).map((r) => ({ ...r })),
    );
  }

  activeForAccount(matchupId: string, accountId: string): Promise<CorpRent[]> {
    return Promise.resolve(
      [...this.active.values()]
        .filter((r) => r.matchupId === matchupId && r.accountId === accountId)
        .map((r) => ({ ...r })),
    );
  }

  pendingMatchups(): Promise<string[]> {
    return Promise.resolve([...new Set([...this.active.values()].map((r) => r.matchupId))].sort());
  }

  closeRent(matchupId: string, itemId: string): Promise<boolean> {
    const row = this.active.get(itemId);
    if (!row || row.matchupId !== matchupId) return Promise.resolve(false);
    this.active.delete(itemId);
    return Promise.resolve(true);
  }
}
