import { describe, expect, it } from 'vitest';
import { composeGameDataBundle } from '@void/shared-core';
import { FRAGMENTS, shippedGameData } from './gameData';

/**
 * The fragment names `composeGameDataBundle` actually asks its reader for — the
 * authoritative list, DERIVED from the composer at runtime instead of copied next to
 * it. A hand-written second list is precisely what these tests exist to police: the
 * browser's `FRAGMENTS` map is the client's copy of that list, and when the two drift
 * the loader does NOT fail. Every catalogue field in `schemas.ts` carries
 * `.default({})` (`rewards` — `.prefault({})`), so a fragment the client fails to
 * supply comes back `undefined`, zod substitutes an empty record, and
 * `shippedGameData()` hands the app a perfectly valid bundle with the content
 * silently missing. That was AUD-1: 11 of 18 fragments reached the browser and the
 * whole hero + ship-module stack was empty in production.
 */
function fragmentsRequestedByComposer(): string[] {
  const asked: string[] = [];
  composeGameDataBundle((name) => {
    asked.push(name);
    // The composer dereferences `manifest.version`; every other fragment it only
    // forwards, so `undefined` is enough to walk the whole list.
    return name === 'manifest.json' ? { version: '0.0.0-probe' } : undefined;
  });
  return asked;
}

describe('shipped game data — the browser fragment list', () => {
  it('lists exactly the fragments the shared composer reads', () => {
    expect(Object.keys(FRAGMENTS).sort()).toEqual(fragmentsRequestedByComposer().sort());
  });

  // The key-set check above is not sufficient on its own: an entry whose VALUE is
  // missing keeps the key and still starves the loader, which is the same silent
  // empty-catalogue outcome by another route. Assert what the loader will actually
  // receive, not merely what the map is labelled with.
  it('resolves every one of those fragments to real content, not undefined', () => {
    const starved = fragmentsRequestedByComposer().filter((name) => FRAGMENTS[name] == null);
    expect(starved).toEqual([]);
  });

  // The damage the two structural checks are there to prevent, asserted directly and
  // without naming catalogues one by one: every record-shaped catalogue in the composed
  // bundle must carry entries. Deriving the list from the bundle keeps a newly added
  // catalogue covered for free. `version` (string) and `resources` (array) are skipped
  // — they are required by the schema, so a missing fragment throws instead of
  // defaulting, and they defend themselves.
  it('composes catalogues that are actually populated', () => {
    const data = shippedGameData() as unknown as Record<string, unknown>;

    const empty = Object.entries(data)
      .filter(([, value]) => typeof value === 'object' && value !== null && !Array.isArray(value))
      .filter(([, value]) => Object.keys(value as object).length === 0)
      .map(([key]) => key);

    expect(empty).toEqual([]);
  });
});
