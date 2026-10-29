import type { ArsenalItem, PlayerArsenal } from '@void/shared-core';
import { arsenalSnapshotOf } from './arsenal';
import type { ArsenalStore, AvaChallengeStore, AvaRosterStore, CorpRentStore, CorpStore } from './store';

/**
 * ARS-6 — corp-warehouse rentals: a head/officer hands a corp-owned item to a
 * ROSTERED fighter for one AvA war, before the matchup locks. The corp never loses
 * ownership (no `ArsenalStore.transfer` — a corp-owned item is simply a row whose
 * `accountId` IS the corp's id, ARS-1..2's existing shape reused verbatim); this
 * service only tracks WHO currently has USE of it (`CorpRentStore`) and merges that
 * into the fighter's ARS-3 snapshot (`avaOrchestrator.corpRentalOf`) at launch.
 *
 * War end (`returnWar`) closes every active rental for the matchup exactly once —
 * the item is never "returned" as a data operation (it never left `corp_arsenal`),
 * and the audit records the war. CORP-11 warehouse loans return without wear;
 * loans issued before that benefit retain their original wear rule.
 */

export type CorpArsenalErrorCode =
  | 'E_FORBIDDEN'
  | 'E_NOT_CORP_ITEM'
  | 'E_NO_MATCHUP'
  | 'E_NOT_PARTY'
  | 'E_ROSTER_LOCKED'
  | 'E_NOT_ROSTERED'
  | 'E_CORP_WAREHOUSE_REQUIRED'
  | 'E_CORP_WAREHOUSE_LIMIT'
  | 'E_ALREADY_RENTED';

export type CorpArsenalFail = { ok: false; code: CorpArsenalErrorCode };

/** The acting account, as resolved from the session (never from the payload) —
 *  the same shape `CorpActor`/`MedalService` already use. */
export interface CorpArsenalActor {
  accountId: string;
  login: string;
}

export interface CorpArsenalServiceDeps {
  corpStore: CorpStore;
  arsenalStore: ArsenalStore;
  rentStore: CorpRentStore;
  challengeStore: AvaChallengeStore;
  rosterStore: AvaRosterStore;
  now?: () => number;
}

export class CorpArsenalService {
  private readonly corps: CorpStore;
  private readonly arsenal: ArsenalStore;
  private readonly rentals: CorpRentStore;
  private readonly challenges: AvaChallengeStore;
  private readonly roster: AvaRosterStore;
  private readonly now: () => number;

  constructor(deps: CorpArsenalServiceDeps) {
    this.corps = deps.corpStore;
    this.arsenal = deps.arsenalStore;
    this.rentals = deps.rentStore;
    this.challenges = deps.challengeStore;
    this.roster = deps.rosterStore;
    this.now = deps.now ?? ((): number => Date.now());
  }

  /** Accepted members see their own stock and own roster only. */
  async warehouse(who: CorpArsenalActor, corpId: string, matchupId?: string) {
    const member = await this.corps.membershipOf(who.accountId);
    if (!member || member.corpId !== corpId || member.role === 'recruit') return { ok: false as const, code: 'E_FORBIDDEN' as const };
    const corp = await this.corps.getCorp(corpId);
    if (!corp) return { ok: false as const, code: 'E_FORBIDDEN' as const };
    let fighters: Array<{ accountId: string; login: string }> = [];
    let open = false;
    if (matchupId) {
      const match = await this.challenges.getChallenge(matchupId);
      if (!match) return { ok: false as const, code: 'E_NO_MATCHUP' as const };
      const side = match.challengerCorp === corpId ? 'challenger' : match.targetCorp === corpId ? 'target' : null;
      if (!side) return { ok: false as const, code: 'E_NOT_PARTY' as const };
      open = match.status === 'accepted' && typeof match.pauseEndsAt === 'number' && match.pauseEndsAt > this.now();
      const roster = await this.roster.rosterOf(matchupId);
      fighters = (await this.corps.membersOf(corpId)).filter((m) => m.role !== 'recruit' && roster.some((r) => r.side === side && r.accountId === m.accountId)).map(({ accountId, login }) => ({ accountId, login }));
    }
    const rentals = await this.rentals.activeForCorp(corpId);
    const items = (await this.arsenal.listOf(corpId)).map((item) => ({
      itemId: item.itemId, kind: item.kind, defId: item.defId, durability: item.durability,
      busy: rentals.some((r) => r.itemId === item.itemId),
      borrower: rentals.find((r) => r.itemId === item.itemId && r.matchupId === matchupId)?.accountId ?? null,
    }));
    return { ok: true as const, warehouse: { capacity: corp.warehouseItems ?? 0, used: rentals.filter((r) => r.matchupId === matchupId).length,
      canLend: open && (member.role === 'head' || member.role === 'officer'), fighters, items } };
  }

  /** Hand a corp-owned item to a rostered fighter for one war. Head/officer only;
   *  the item must belong to the acting corp; the matchup must still be in its
   *  roster window (ACCEPTED, not yet LOCKED — "до лока"); the target must already
   *  be rostered on the corp's own side; the item must not already be on rent
   *  anywhere. Fail-secure: any check failing changes nothing. */
  async rentOut(
    who: CorpArsenalActor,
    corpId: string,
    itemId: string,
    matchupId: string,
    targetAccountId: string,
  ): Promise<{ ok: true } | CorpArsenalFail> {
    const actor = await this.corps.membershipOf(who.accountId);
    if (!actor || actor.corpId !== corpId || (actor.role !== 'head' && actor.role !== 'officer')) {
      return { ok: false, code: 'E_FORBIDDEN' };
    }
    const item = await this.arsenal.get(itemId);
    if (!item || item.accountId !== corpId) return { ok: false, code: 'E_NOT_CORP_ITEM' };
    const matchup = await this.challenges.getChallenge(matchupId);
    if (!matchup) return { ok: false, code: 'E_NO_MATCHUP' };
    const side =
      matchup.challengerCorp === corpId ? 'challenger' : matchup.targetCorp === corpId ? 'target' : null;
    if (!side) return { ok: false, code: 'E_NOT_PARTY' };
    if (matchup.status !== 'accepted' || typeof matchup.pauseEndsAt !== 'number' || matchup.pauseEndsAt <= this.now()) return { ok: false, code: 'E_ROSTER_LOCKED' };
    const roster = await this.roster.rosterOf(matchupId);
    const rostered = roster.some((r) => r.accountId === targetAccountId && r.side === side);
    if (!rostered) return { ok: false, code: 'E_NOT_ROSTERED' };
    const target = await this.corps.membershipOf(targetAccountId);
    if (!target || target.corpId !== corpId || target.role === 'recruit') return { ok: false, code: 'E_NOT_ROSTERED' };
    const warehouse = (await this.corps.getCorp(corpId))?.warehouseItems ?? 0;
    if (!warehouse) return { ok: false, code: 'E_CORP_WAREHOUSE_REQUIRED' };
    const rented = await this.rentals.rentWithLimit({
      itemId,
      corpId,
      matchupId,
      accountId: targetAccountId,
      rentedAt: this.now(),
      unworn: true,
    }, warehouse);
    if (rented !== 'ok') return { ok: false, code: rented === 'limit' ? 'E_CORP_WAREHOUSE_LIMIT' : 'E_ALREADY_RENTED' };
    await this.corps.appendAudit({
      corpId,
      at: this.now(),
      actor: who.accountId,
      action: 'rent',
      target: targetAccountId,
      detail: itemId,
    });
    return { ok: true };
  }

  /** ARS-3 snapshot merge point: what THIS account has on rent for THIS matchup,
   *  in `PlayerArsenal` shape (union-ready with the personal snapshot). Empty when
   *  nothing's rented — the orchestrator then merges nothing. */
  async rentedArsenalOf(accountId: string, matchupId: string): Promise<PlayerArsenal> {
    const rows = await this.rentals.activeForAccount(matchupId, accountId);
    if (rows.length === 0) return { hulls: [], modules: [] };
    const items: ArsenalItem[] = [];
    for (const row of rows) {
      const item = await this.arsenal.get(row.itemId);
      if (item) items.push(item);
    }
    return arsenalSnapshotOf(items);
  }

  /** War end (ARS-0.3): every active rental for the matchup returns to the corp
   *  warehouse exactly once — protected loans have no wear; legacy loans tick
   *  durability. Records one audit line per item. Safe to call on a matchup
   *  with no rentals (no-op) and safe to replay (each item closes at most once). */
  returnWar(matchupId: string): Promise<number> {
    return this.returnRentals(matchupId, 1);
  }

  /** CORP-5: a cancelled battle (short roster, no map) never ran, so everything handed
   *  out for it goes back to the warehouse WITHOUT wear. A sweep rather than a hook on
   *  the cancel: the cancel happens in the corporations process, the rentals live in the
   *  game database, and a handout that raced the cancel still lands on the next pass.
   *  Safe to replay — each item closes at most once. */
  async returnCancelled(): Promise<number> {
    let returned = 0;
    let failure: unknown;
    for (const matchupId of await this.rentals.pendingMatchups()) {
      try {
        const matchup = await this.challenges.getChallenge(matchupId);
        if (matchup?.status === 'cancelled') returned += await this.returnRentals(matchupId, 0);
      } catch (error) {
        failure ??= error; // one stuck matchup must not hold back the others
      }
    }
    if (failure !== undefined) throw failure;
    return returned;
  }

  private async returnRentals(matchupId: string, wear: number): Promise<number> {
    const rows = await this.rentals.activeForMatchup(matchupId);
    if (this.rentals.completeReturn && this.rentals.pendingReturnAudits && this.rentals.markReturnAudited) {
      let returned = 0;
      for (const row of rows) {
        if (await this.rentals.completeReturn(matchupId, row.itemId, this.now(), row.unworn ? 0 : wear)) returned++;
      }
      for (const entry of await this.rentals.pendingReturnAudits(matchupId)) {
        await this.corps.appendAudit(entry);
        await this.rentals.markReturnAudited(entry.eventId!);
      }
      return returned;
    }
    let returned = 0;
    for (const row of rows) {
      if (!(await this.rentals.closeRent(matchupId, row.itemId))) continue; // already closed (replay)
      if (wear > 0 && !row.unworn) await this.arsenal.wear(row.itemId, wear);
      await this.corps.appendAudit({
        corpId: row.corpId,
        at: this.now(),
        actor: 'system', // server-driven return, no acting human (same convention as AvaService.refund)
        action: 'rent_return',
        target: row.accountId,
        detail: row.itemId,
      });
      returned += 1;
    }
    return returned;
  }
}
