import { describe, expect, it } from 'vitest';
import * as archive from './soloSaveMigrationArchive';
import { SOLO_MIGRATIONS } from './soloSaveMigration';

// The archive only holds the older pairs; the chain is read in `soloSaveMigration.ts`. A pair
// left in the archive but out of the chain would silently strand every save of its release.
describe('the archived solo save pairs', () => {
  const pairs = new Set<unknown>(Object.values(archive));

  it('are all in the chain, ahead of every live pair', () => {
    expect(pairs.size).toBeGreaterThan(0);
    expect(new Set(SOLO_MIGRATIONS.slice(0, pairs.size))).toEqual(pairs);
  });

  it('end where the live file picks the chain up', () => {
    const last = SOLO_MIGRATIONS[pairs.size - 1]!;
    const next = SOLO_MIGRATIONS[pairs.size]!;
    expect(pairs.has(next)).toBe(false);
    expect([next.fromRules, next.fromData, next.fromDataHash]).toEqual([
      last.toRules,
      last.toData,
      last.toDataHash,
    ]);
  });
});
