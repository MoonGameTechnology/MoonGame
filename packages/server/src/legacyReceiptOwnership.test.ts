import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { legacyReceiptOwnership, type LegacyReceiptRow } from './legacyReceiptOwnership';
import { metaEconomyFingerprint as fp, metaSettlementReceiptKey, type MatchRewardFacts } from './metaEconomy';
const accountId = 'synthetic-owner';
const facts: MatchRewardFacts = { matchId: 'match', accountId, kind: 'stage', stage: 1, participation: true,
  seasonFacts: { recon: 3, logistics: 1, defense: 0, objectives: 2 }, occurredAt: 7 * 86400000 };
const factsKey = `reward-facts:${JSON.stringify(['match', accountId])}:stage:1`;
const settlementKey = metaSettlementReceiptKey(facts);
const dayKey = `meta:season-day:${fp([accountId, fp(['active-day', 6])])}`;
const fixture = (): LegacyReceiptRow[] => [
  { receipt_key: factsKey, fingerprint: createHash('sha256').update(JSON.stringify(facts)).digest('hex'), response: JSON.parse(JSON.stringify(facts)), account_ids: null },
  { receipt_key: settlementKey, fingerprint: fp(facts), response: { ok: true, receipt: { id: settlementKey, kind: 'settlement', at: 7 * 86400000 } }, account_ids: null },
  { receipt_key: dayKey, fingerprint: fp({ day: 6 }), response: { ok: true, receipt: { id: dayKey, kind: 'season-day', at: 7 * 86400000 } }, account_ids: null },
];
describe('legacy ownership reconstructed from exact original identities', () => {
  it('proves delivery facts, their settlement and active-day ownership without mutating receipts', () => {
    const rows = fixture(); const before = JSON.stringify(rows);
    expect([...legacyReceiptOwnership(rows, [accountId, 'another-player'])]).toEqual(rows.map(row => [row.receipt_key, accountId]));
    expect(JSON.stringify(rows)).toBe(before);
  });
  it.each(['key', 'payload', 'owner', 'unknown'])('refuses incomplete or mismatched evidence: %s', mode => {
    const rows = fixture();
    if (mode === 'key') rows[1]!.receipt_key += 'tampered';
    if (mode === 'payload') rows[2]!.fingerprint = fp({ day: 800 });
    if (mode === 'unknown') rows.push({ receipt_key: 'opaque', fingerprint: 'unknown', response: {}, account_ids: null });
    expect(() => legacyReceiptOwnership(rows, mode === 'owner' ? ['another-player'] : [accountId])).toThrow('E_ERASURE_LEGACY_RECEIPTS');
  });
  it('does not use unverified fact envelopes as proof of settlement ownership', () => {
    const rows = fixture(); rows[0]!.fingerprint = fp('different original payload');
    expect(() => legacyReceiptOwnership(rows, [accountId])).toThrow('E_ERASURE_LEGACY_RECEIPTS');
  });
});
