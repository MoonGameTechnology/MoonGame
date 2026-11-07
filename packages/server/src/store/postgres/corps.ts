/** Postgres: корпорации и аренда корпоративных построек (SLIM-5). */
import { scopedPool } from '../../corporateScopedPool';
import {
  isCorpEmblemId,
  type CorpEmblemId,
  type CorpBuildOrder,
  type CorpInfrastructureResult,
  type CorpInfrastructureState,
  type CorpShowcaseResult,
} from '@void/protocol';
import { corpBuildPrice, updateCorpInfrastructure } from '../../corpConstruction';
import { corpFoundedNews, corpLevelNews } from '../../corpNews';
import { corpFacilities, publicCorpFacilities, validateShowcase } from '../../corpFacilities';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  type CorpAuditEntry,
  type CorpMembership,
  type CorpRecord,
  type CorpRent,
  type CorpRentStore,
  type CorpRole,
  type CorpStore,
  type CorpSummary,
  DEFAULT_AUDIT_LIMIT,
} from '../types';
import { FEED_INSERT, feedValues } from './ava';

interface CorpMemberRow {
  corp_id: string;
  account_id: string;
  login: string;
  role: string;
}

function memberOf(row: CorpMemberRow): CorpMembership {
  return {
    corpId: row.corp_id,
    accountId: row.account_id,
    login: row.login,
    role: row.role as CorpRole, // the store only ever writes CorpRole values
  };
}

type CorpFacilityRow = { infrastructure: CorpInfrastructureState | null; showcase: string[] };

export class PostgresCorpStore implements CorpStore {
  async prepareBuild(corpId: string, actor: string, now: number, order: CorpBuildOrder): Promise<import('@void/protocol').CorpBuildPreparation> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const member = await db.query<{ membership_nonce: string; role: string }>('SELECT membership_nonce,role FROM corp_members WHERE account_id=$1 AND corp_id=$2 FOR UPDATE', [actor, corpId]);
      const m = member.rows[0];
      if (m?.role !== 'head') { await db.query('ROLLBACK'); return { ok: false, code: 'E_FORBIDDEN' }; }
      const old = await db.query<{ ticket: import('@void/protocol').CorpBuildTicket }>('SELECT ticket FROM corp_build_payments WHERE corp_id=$1 AND head_membership=$2 AND request_key=$3', [corpId, m.membership_nonce, order.requestId]);
      if (old.rows[0]) {
        const t = old.rows[0].ticket;
        await db.query('COMMIT');
        return t.order.price === order.price && t.order.buildingId === order.buildingId && t.order.expectedLevel === order.expectedLevel
          ? { ok: true, ticket: t } : { ok: false, code: 'E_IDEMPOTENCY_CONFLICT' };
      }
      const result = await new PostgresCorpStore(scopedPool(db)).infrastructure(corpId, actor, now);
      const b = result.ok ? result.infrastructure.buildings.find((b) => b.id === order.buildingId) : undefined;
      let code: import('@void/protocol').CorpBuildError | null = !b?.next || b.level !== order.expectedLevel ? 'E_CORP_BUILD_LEVEL' : b.blocked;
      if (!order.requestId || !b?.next || order.price !== b.next.price) code = 'E_CORP_PRICE';
      if (code) { await db.query('COMMIT'); return { ok: false, code }; }
      const ticket = { id: randomUUID(), corpId, order: { ...order, requestId: undefined }, materials: { ...b!.next!.materials } };
      await db.query('INSERT INTO corp_build_payments(id,corp_id,head_membership,request_key,ticket) VALUES($1,$2,$3,$4,$5::jsonb)', [ticket.id, corpId, m.membership_nonce, order.requestId, JSON.stringify(ticket)]);
      await db.query('COMMIT');
      return { ok: true, ticket };
    } catch (e) { await db.query('ROLLBACK').catch(() => undefined); throw e; } finally { db.release(); }
  }
  async commitBuild(id: string, now: number): Promise<import('@void/protocol').CorpBuildSettlement> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      // Membership before receipt before corporation: same lock order as erase/disband.
      const peek = await db.query<{ head_membership: string | null }>('SELECT head_membership FROM corp_build_payments WHERE id=$1', [id]);
      const nonce = peek.rows[0]?.head_membership;
      const members = nonce ? await db.query<{ account_id: string; role: string; corp_id: string }>('SELECT account_id,role,corp_id FROM corp_members WHERE membership_nonce=$1 FOR UPDATE', [nonce]) : null;
      const row = (await db.query<{ ticket: import('@void/protocol').CorpBuildTicket; result: import('@void/protocol').CorpBuildSettlement | null; head_membership: string | null }>('SELECT ticket,result,head_membership FROM corp_build_payments WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row || row.result) { await db.query('COMMIT'); return row?.result ?? { state: 'unknown' }; }
      const m = members?.rows[0];
      let result: import('@void/protocol').CorpBuildSettlement;
      if (!m || row.head_membership !== nonce || m.role !== 'head' || m.corp_id !== row.ticket.corpId)
        result = { state: 'rejected', code: 'E_FORBIDDEN' };
      else if (row.ticket.order.price !== corpBuildPrice(row.ticket.corpId, row.ticket.order)) result = { state: 'rejected', code: 'E_CORP_PRICE' };
      else {
        const applied = await new PostgresCorpStore(scopedPool(db)).infrastructure(row.ticket.corpId, m.account_id, now, row.ticket.order);
        result = applied.ok ? { state: 'applied' } : { state: 'rejected', code: applied.code };
      }
      await db.query('UPDATE corp_build_payments SET result=$2::jsonb WHERE id=$1', [id, JSON.stringify(result)]);
      await db.query('COMMIT');
      return result;
    } catch (e) { await db.query('ROLLBACK').catch(() => undefined); throw e; } finally { db.release(); }
  }

  async monumentsOf(ids: readonly string[]): Promise<string[]> {
    if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== 'string')) return [];
    const result = await this.pool.query<{ id: string; infrastructure: CorpInfrastructureState | null }>('SELECT id,infrastructure FROM corps WHERE id=ANY($1::text[])', [ids]);
    return result.rows.filter((row) => publicCorpFacilities(row.infrastructure, Date.now()).monument).map((row) => row.id);
  }
  async infrastructure(
    corpId: string,
    actor: string,
    now: number,
    order?: CorpBuildOrder,
  ): Promise<CorpInfrastructureResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock membership first, like disband: role transfer/kick cannot race spending.
      const members = await client.query<{ role: CorpRole }>(
        `SELECT role FROM corp_members WHERE account_id = $1 AND corp_id = $2 FOR UPDATE`,
        [actor, corpId],
      );
      const role = members.rows[0]?.role;
      if (!role || role === 'recruit' || (order && role !== 'head')) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'E_FORBIDDEN' };
      }
      const corps = await client.query<{
        name: string;
        influence: string;
        infrastructure: CorpInfrastructureState | null;
      }>(`SELECT name, influence, infrastructure FROM corps WHERE id = $1 FOR UPDATE`, [corpId]);
      const corp = corps.rows[0];
      if (!corp) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'E_FORBIDDEN' };
      }
      // CORP-6: what the level requirements count — members without recruits and the AvA
      // battles the corporation played on either side.
      const standing = await client.query<{ members: number; battles: number }>(
        `SELECT
           (SELECT count(*) FROM corp_members WHERE corp_id = $1 AND role <> 'recruit')::int AS members,
           (SELECT count(*) FROM ava_results WHERE challenger_corp = $1 OR target_corp = $1)::int AS battles`,
        [corpId],
      );
      const updated = updateCorpInfrastructure(
        corpId,
        actor,
        role,
        Number(corp.influence),
        corp.infrastructure,
        now,
        order,
        { members: standing.rows[0]?.members ?? 0, battles: standing.rows[0]?.battles ?? 0 },
      );
      await client.query(
        `UPDATE corps SET influence = $2, infrastructure = $3::jsonb WHERE id = $1`,
        [corpId, updated.influence, JSON.stringify(updated.state)],
      );
      for (const entry of updated.audit) {
        await client.query(
          `INSERT INTO corp_audit (corp_id, at, actor, action, target, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
          [corpId, entry.at, entry.actor, entry.action, entry.target ?? null, entry.detail ?? null],
        );
      }
      // CORP-1: a reached corporation level is public news, committed with the level.
      for (const news of corpLevelNews(corpId, corp.name, updated.audit)) {
        await client.query(FEED_INSERT, feedValues(news));
      }
      await client.query('COMMIT');
      return updated.result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  constructor(private readonly pool: Pool) {}

  async createCorp(
    name: string,
    headAccountId: string,
    headLogin: string,
    at: number = Date.now(),
    emblemId?: CorpEmblemId,
  ): Promise<{ ok: true; corpId: string } | { ok: false; code: 'E_NAME_TAKEN' | 'E_IN_CORP' }> {
    // One transaction, two atomic claims: the corp_members PK is the one-corp-per-
    // account claim, the lower(name) unique index is the name claim. ON CONFLICT
    // probes the first without an exception; the second reports through the catch.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const corpId = randomUUID();
      const claim = await client.query(
        `INSERT INTO corp_members (account_id, corp_id, login, role)
         VALUES ($1, $2, $3, 'head')
         ON CONFLICT (account_id) DO NOTHING`,
        [headAccountId, corpId, headLogin],
      );
      if ((claim.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'E_IN_CORP' };
      }
      try {
        await client.query(`INSERT INTO corps (id, name, emblem_id) VALUES ($1, $2, $3)`, [corpId, name, emblemId ?? null]);
      } catch (error) {
        const conflict = error as { code?: unknown; constraint?: unknown };
        if (conflict.code !== '23505' || conflict.constraint !== 'corps_name_idx') throw error;
        await client.query('ROLLBACK');
        return { ok: false, code: 'E_NAME_TAKEN' };
      }
      // CORP-1: «founded» is public news, committed with the corporation itself.
      await client.query(FEED_INSERT, feedValues(corpFoundedNews(corpId, name, at)));
      await client.query('COMMIT');
      return { ok: true, corpId };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async getCorp(corpId: string): Promise<CorpRecord | null> {
    const r = await this.pool.query<CorpFacilityRow & { id: string; name: string; influence: string; emblem_id: string | null; rating: number | null }>(
      `SELECT id, name, influence, emblem_id, infrastructure, showcase, rating FROM corps WHERE id = $1`,
      [corpId],
    );
    const row = r.rows[0];
    return row ? { corpId: row.id, name: row.name, influence: Number(row.influence),
      ...(row.rating === null ? {} : { rating: Number(row.rating) }),
      ...publicCorpFacilities(row.infrastructure, Date.now(), row.showcase),
      ...(isCorpEmblemId(row.emblem_id) ? { emblemId: row.emblem_id } : {}) } : null;
  }

  async setEmblem(corpId: string, actor: string, emblemId: CorpEmblemId, at: number): Promise<{ ok: true } | { ok: false; code: 'E_FORBIDDEN' }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const allowed = await client.query<{ emblem_id: string | null }>(
        `SELECT c.emblem_id FROM corps c JOIN corp_members m ON m.corp_id=c.id
         WHERE c.id=$1 AND m.account_id=$2 AND m.role='head' FOR UPDATE OF c,m`, [corpId, actor]);
      if (!allowed.rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'E_FORBIDDEN' };
      }
      if (allowed.rows[0].emblem_id !== emblemId) {
        await client.query('UPDATE corps SET emblem_id=$2 WHERE id=$1', [corpId, emblemId]);
        await client.query(`INSERT INTO corp_audit (corp_id,at,actor,action,detail) VALUES ($1,$2,$3,'emblem',$4)`,
          [corpId, at, actor, emblemId]);
      }
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async listCorps(): Promise<CorpSummary[]> {
    const r = await this.pool.query<CorpFacilityRow & {
      id: string;
      name: string;
      influence: string;
      members: string;
      emblem_id: string | null;
      rating: number | null;
    }>(
      `SELECT c.id, c.name, c.influence, c.emblem_id, c.infrastructure, c.showcase, c.rating,
              count(m.account_id) FILTER (WHERE m.role <> 'recruit') AS members
       FROM corps c
       LEFT JOIN corp_members m ON m.corp_id = c.id
       GROUP BY c.id, c.name, c.influence
       ORDER BY lower(c.name)`,
    );
    return r.rows.map((row) => ({
      corpId: row.id,
      name: row.name,
      influence: Number(row.influence),
      ...(row.rating === null ? {} : { rating: Number(row.rating) }),
      members: Number(row.members),
      ...publicCorpFacilities(row.infrastructure, Date.now(), row.showcase),
      ...(isCorpEmblemId(row.emblem_id) ? { emblemId: row.emblem_id } : {}),
    }));
  }

  async setShowcase(corpId: string, actor: string, medalIds: readonly string[], at: number): Promise<CorpShowcaseResult> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const allowed = await db.query<CorpFacilityRow>(
        `SELECT c.infrastructure,c.showcase FROM corps c JOIN corp_members m ON m.corp_id=c.id
         WHERE c.id=$1 AND m.account_id=$2 AND m.role='head' FOR UPDATE OF c,m`, [corpId, actor]);
      const row = allowed.rows[0];
      if (!row) { await db.query('ROLLBACK'); return { ok: false, code: 'E_FORBIDDEN' }; }
      const stats = await db.query<{ wins: string; matches: string }>(
        `SELECT count(*) AS matches,count(*) FILTER(WHERE winner_corp=$1) AS wins FROM ava_results
         WHERE challenger_corp=$1 OR target_corp=$1`, [corpId]);
      const count = stats.rows[0]!;
      const error = validateShowcase(medalIds, corpFacilities(row.infrastructure, at).showcaseSlots, { wins: Number(count.wins), matches: Number(count.matches) });
      if (error) { await db.query('ROLLBACK'); return { ok: false, code: error }; }
      if (JSON.stringify(row.showcase) !== JSON.stringify(medalIds)) {
        await db.query('UPDATE corps SET showcase=$2::jsonb WHERE id=$1', [corpId, JSON.stringify(medalIds)]);
        await db.query(`INSERT INTO corp_audit(corp_id,at,actor,action,detail) VALUES($1,$2,$3,'showcase',$4)`, [corpId, at, actor, JSON.stringify(medalIds)]);
      }
      await db.query('COMMIT');
      return { ok: true };
    } catch (error) { await db.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { db.release(); }
  }

  async membershipOf(accountId: string): Promise<CorpMembership | null> {
    const r = await this.pool.query<CorpMemberRow>(
      `SELECT corp_id, account_id, login, role FROM corp_members WHERE account_id = $1`,
      [accountId],
    );
    return r.rows[0] ? memberOf(r.rows[0]) : null;
  }

  async membersOf(corpId: string): Promise<CorpMembership[]> {
    const r = await this.pool.query<CorpMemberRow>(
      `SELECT corp_id, account_id, login, role FROM corp_members WHERE corp_id = $1`,
      [corpId],
    );
    return r.rows.map(memberOf);
  }

  async addMember(
    corpId: string,
    accountId: string,
    login: string,
    role: CorpRole,
  ): Promise<{ ok: true } | { ok: false; code: 'E_IN_CORP' }> {
    const r = await this.pool.query(
      `INSERT INTO corp_members (account_id, corp_id, login, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id) DO NOTHING`,
      [accountId, corpId, login, role],
    );
    return (r.rowCount ?? 0) > 0 ? { ok: true } : { ok: false, code: 'E_IN_CORP' };
  }

  async setRole(corpId: string, accountId: string, role: CorpRole): Promise<void> {
    await this.pool.query(
      `UPDATE corp_members SET role = $3 WHERE corp_id = $1 AND account_id = $2`,
      [corpId, accountId, role],
    );
  }

  async removeMember(corpId: string, accountId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM corp_members WHERE corp_id = $1 AND account_id = $2`, [
        corpId,
        accountId,
      ]);
      // Leaving the corp revokes the AvA player-ready consent (AVA-3).
      await client.query(`DELETE FROM player_ready WHERE account_id = $1`, [accountId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async swapHead(corpId: string, fromAccountId: string, toAccountId: string): Promise<void> {
    // One transaction so there is never a window with zero or two heads.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const demoted = await client.query(
        `UPDATE corp_members SET role = 'officer'
         WHERE corp_id = $1 AND account_id = $2 AND role = 'head'`,
        [corpId, fromAccountId],
      );
      if ((demoted.rowCount ?? 0) > 0) {
        const promoted = await client.query(
          `UPDATE corp_members SET role = 'head' WHERE corp_id = $1 AND account_id = $2`,
          [corpId, toAccountId],
        );
        if ((promoted.rowCount ?? 0) === 0) {
          // The target left (or was kicked) between the service's membership check
          // and this transaction — roll the demotion back rather than commit a
          // headless corp. Net effect: a no-op, same as the memory adapter.
          await client.query('ROLLBACK');
          return;
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async removeCorp(corpId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Clear the corp's AvA readiness (its own flag + every member's consent) with it.
      await client.query(`DELETE FROM player_ready WHERE corp_id = $1`, [corpId]);
      await client.query(`DELETE FROM corp_ready WHERE corp_id = $1`, [corpId]);
      await client.query(`DELETE FROM corp_members WHERE corp_id = $1`, [corpId]);
      await client.query(`DELETE FROM corps WHERE id = $1`, [corpId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async adjustRating(corpId: string, delta: number, start: number): Promise<void> {
    await this.pool.query(`UPDATE corps SET rating = COALESCE(rating, $3) + $2 WHERE id = $1`, [corpId, delta, start]);
  }

  async addInfluence(corpId: string, delta: number): Promise<void> {
    if (delta <= 0) return;
    await this.pool.query(`UPDATE corps SET influence = influence + $2 WHERE id = $1`, [
      corpId,
      delta,
    ]);
  }

  async spendInfluence(
    corpId: string,
    cost: number,
  ): Promise<{ ok: true } | { ok: false; code: 'E_INSUFFICIENT' }> {
    if (cost <= 0) return { ok: false, code: 'E_INSUFFICIENT' };
    // The `influence >= cost` guard rides IN the UPDATE, so the check and the debit are
    // one atomic statement — two racing spends can't both pass and overdraw the balance.
    const r = await this.pool.query(
      `UPDATE corps SET influence = influence - $2 WHERE id = $1 AND influence >= $2`,
      [corpId, cost],
    );
    return (r.rowCount ?? 0) > 0 ? { ok: true } : { ok: false, code: 'E_INSUFFICIENT' };
  }

  async setCorpReady(corpId: string, since: number, formats: readonly number[]): Promise<void> {
    // Only a real corp joins the pool; keep the earliest `since`, take the new formats.
    await this.pool.query(
      `INSERT INTO corp_ready (corp_id, since, formats)
       SELECT $1, $2, $3::integer[] WHERE EXISTS (SELECT 1 FROM corps WHERE id = $1)
       ON CONFLICT (corp_id) DO UPDATE SET formats = EXCLUDED.formats`,
      [corpId, since, formats],
    );
  }

  async clearCorpReady(corpId: string): Promise<void> {
    await this.pool.query(`DELETE FROM corp_ready WHERE corp_id = $1`, [corpId]);
  }

  async listReadyCorps(): Promise<Array<CorpSummary & { readySince: number; formats: number[] }>> {
    const r = await this.pool.query<CorpFacilityRow & {
      id: string;
      name: string;
      influence: string;
      members: string;
      since: string;
      formats: number[];
      emblem_id: string | null;
      rating: number | null;
    }>(
      `SELECT c.id, c.name, c.influence, c.emblem_id, c.infrastructure, c.showcase, c.rating, r.since, r.formats,
              count(m.account_id) FILTER (WHERE m.role <> 'recruit') AS members
       FROM corp_ready r
       JOIN corps c ON c.id = r.corp_id
       LEFT JOIN corp_members m ON m.corp_id = c.id
       GROUP BY c.id, c.name, c.influence, r.since, r.formats
       ORDER BY lower(c.name)`,
    );
    return r.rows.map((row) => ({
      corpId: row.id,
      name: row.name,
      influence: Number(row.influence),
      ...(row.rating === null ? {} : { rating: Number(row.rating) }),
      members: Number(row.members),
      readySince: Number(row.since),
      formats: row.formats.map(Number),
      ...publicCorpFacilities(row.infrastructure, Date.now(), row.showcase),
      ...(isCorpEmblemId(row.emblem_id) ? { emblemId: row.emblem_id } : {}),
    }));
  }

  async readyFormatsOf(corpId: string): Promise<number[] | null> {
    const r = await this.pool.query<{ formats: number[] }>(
      `SELECT formats FROM corp_ready WHERE corp_id = $1`,
      [corpId],
    );
    return r.rows[0] ? r.rows[0].formats.map(Number) : null;
  }

  async setPlayerReady(accountId: string, corpId: string, since: number): Promise<void> {
    // Rebind to the current corp if the account moved; keep `since` when already set here.
    await this.pool.query(
      `INSERT INTO player_ready (account_id, corp_id, since) VALUES ($1, $2, $3)
       ON CONFLICT (account_id) DO UPDATE SET corp_id = EXCLUDED.corp_id,
         since = CASE WHEN player_ready.corp_id = EXCLUDED.corp_id THEN player_ready.since
                      ELSE EXCLUDED.since END`,
      [accountId, corpId, since],
    );
  }

  async clearPlayerReady(accountId: string): Promise<void> {
    await this.pool.query(`DELETE FROM player_ready WHERE account_id = $1`, [accountId]);
  }

  async readyPlayersOf(corpId: string): Promise<string[]> {
    const r = await this.pool.query<{ account_id: string }>(
      `SELECT account_id FROM player_ready WHERE corp_id = $1 ORDER BY account_id`,
      [corpId],
    );
    return r.rows.map((row) => row.account_id);
  }

  async appendAudit(entry: CorpAuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO corp_audit (corp_id, at, actor, action, target, detail, event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT(event_id) DO NOTHING`,
      [
        entry.corpId,
        entry.at,
        entry.actor,
        entry.action,
        entry.target ?? null,
        entry.detail ?? null,
        entry.eventId ?? null,
      ],
    );
  }

  async auditOf(corpId: string, limit = DEFAULT_AUDIT_LIMIT): Promise<CorpAuditEntry[]> {
    const r = await this.pool.query<{
      corp_id: string;
      at: string;
      actor: string;
      action: string;
      target: string | null;
      detail: string | null;
    }>(
      `SELECT corp_id, at, actor, action, target, detail
       FROM corp_audit WHERE corp_id = $1
       ORDER BY id DESC LIMIT $2`,
      [corpId, limit],
    );
    return r.rows.map((row) => ({
      corpId: row.corp_id,
      at: Number(row.at), // bigint arrives as a string
      actor: row.actor,
      action: row.action as CorpAuditEntry['action'],
      ...(row.target !== null ? { target: row.target } : {}),
      ...(row.detail !== null ? { detail: row.detail } : {}),
    }));
  }
}

interface CorpRentRow {
  item_id: string;
  corp_id: string;
  matchup_id: string;
  account_id: string;
  rented_at: string;
  unworn: boolean;
}

function corpRentOf(row: CorpRentRow): CorpRent {
  return {
    itemId: row.item_id,
    corpId: row.corp_id,
    matchupId: row.matchup_id,
    accountId: row.account_id,
    rentedAt: Number(row.rented_at),
    ...(row.unworn ? { unworn: true as const } : {}),
  };
}


export class PostgresCorpRentStore implements CorpRentStore {
  async activeForCorp(corpId: string): Promise<CorpRent[]> {
    const result = await this.pool.query<CorpRentRow>('SELECT * FROM corp_arsenal_rent WHERE corp_id=$1 ORDER BY rented_at,item_id', [corpId]);
    return result.rows.map(corpRentOf);
  }
  async completeReturn(
    matchupId: string,
    itemId: string,
    at: number,
    wear: number,
  ): Promise<boolean> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const removed = await db.query<CorpRentRow>(
        'DELETE FROM corp_arsenal_rent WHERE matchup_id=$1 AND item_id=$2 RETURNING *',
        [matchupId, itemId],
      );
      const row = removed.rows[0];
      if (!row) {
        await db.query('COMMIT');
        return false;
      }
      const updated = await db.query(
        'UPDATE arsenal SET durability=CASE WHEN durability IS NULL THEN NULL ELSE GREATEST(0,durability-$3) END WHERE item_id=$1 AND account_id=$2 RETURNING item_id',
        [itemId, row.corp_id, row.unworn ? 0 : wear],
      );
      if (updated.rowCount !== 1) throw Error('E_CORP_ITEM_MISSING');
      const eventId = JSON.stringify(['rent_return', matchupId, itemId]);
      const entry: CorpAuditEntry = {
        eventId,
        corpId: row.corp_id,
        at,
        actor: 'system',
        action: 'rent_return',
        target: row.account_id,
        detail: itemId,
      };
      await db.query(
        'INSERT INTO corp_return_audit(event_id,matchup_id,entry) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING',
        [eventId, matchupId, JSON.stringify(entry)],
      );
      await db.query('COMMIT');
      return true;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      db.release();
    }
  }
  async pendingReturnAudits(matchupId: string): Promise<CorpAuditEntry[]> {
    const result = await this.pool.query<{ entry: CorpAuditEntry }>(
      'SELECT entry FROM corp_return_audit WHERE matchup_id=$1 AND NOT delivered ORDER BY event_id',
      [matchupId],
    );
    return result.rows.map((row) => row.entry);
  }
  async markReturnAudited(eventId: string): Promise<void> {
    await this.pool.query('UPDATE corp_return_audit SET delivered=true WHERE event_id=$1', [
      eventId,
    ]);
  }
  async pendingMatchups(): Promise<string[]> {
    const result = await this.pool.query<{ matchup_id: string }>(
      `SELECT matchup_id FROM corp_arsenal_rent
       UNION SELECT matchup_id FROM corp_return_audit WHERE NOT delivered
       ORDER BY matchup_id`,
    );
    return result.rows.map((row) => row.matchup_id);
  }

  constructor(private readonly pool: Pool) {}

  async rent(entry: CorpRent): Promise<boolean> {
    const r = await this.pool.query(
      `INSERT INTO corp_arsenal_rent (item_id, corp_id, matchup_id, account_id, rented_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (item_id) DO NOTHING`,
      [entry.itemId, entry.corpId, entry.matchupId, entry.accountId, entry.rentedAt],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async rentWithLimit(entry: CorpRent, limit: number): Promise<'ok' | 'limit' | 'rented'> {
    if (!Number.isSafeInteger(limit) || limit < 1) return 'limit';
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify(['warehouse', entry.corpId, entry.matchupId])]);
      const held = await db.query('SELECT 1 FROM corp_arsenal_rent WHERE item_id=$1', [entry.itemId]);
      if (held.rowCount) { await db.query('ROLLBACK'); return 'rented'; }
      const used = await db.query<{ n: string }>('SELECT count(*) AS n FROM corp_arsenal_rent WHERE corp_id=$1 AND matchup_id=$2', [entry.corpId, entry.matchupId]);
      if (Number(used.rows[0]!.n) >= limit) { await db.query('ROLLBACK'); return 'limit'; }
      const inserted = await db.query(`INSERT INTO corp_arsenal_rent(item_id,corp_id,matchup_id,account_id,rented_at,unworn)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(item_id) DO NOTHING`,
        [entry.itemId, entry.corpId, entry.matchupId, entry.accountId, entry.rentedAt, entry.unworn === true]);
      await db.query('COMMIT');
      return inserted.rowCount ? 'ok' : 'rented';
    } catch (error) { await db.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { db.release(); }
  }

  async activeForMatchup(matchupId: string): Promise<CorpRent[]> {
    const r = await this.pool.query<CorpRentRow>(
      `SELECT item_id, corp_id, matchup_id, account_id, rented_at, unworn
       FROM corp_arsenal_rent WHERE matchup_id = $1 ORDER BY item_id`,
      [matchupId],
    );
    return r.rows.map(corpRentOf);
  }

  async activeForAccount(matchupId: string, accountId: string): Promise<CorpRent[]> {
    const r = await this.pool.query<CorpRentRow>(
      `SELECT item_id, corp_id, matchup_id, account_id, rented_at, unworn
       FROM corp_arsenal_rent WHERE matchup_id = $1 AND account_id = $2 ORDER BY item_id`,
      [matchupId, accountId],
    );
    return r.rows.map(corpRentOf);
  }

  async closeRent(matchupId: string, itemId: string): Promise<boolean> {
    // Exactly-once: the DELETE only ever removes the row once — a replayed
    // match-end's second attempt finds nothing and changes nothing.
    const r = await this.pool.query(
      `DELETE FROM corp_arsenal_rent WHERE matchup_id = $1 AND item_id = $2`,
      [matchupId, itemId],
    );
    return (r.rowCount ?? 0) > 0;
  }
}
