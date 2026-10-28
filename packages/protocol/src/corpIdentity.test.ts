import { describe, expect, it } from 'vitest';
import { CORP_EMBLEMS, corpEmblemId, isCorpEmblemId } from './corpIdentity';

describe('corporate insignia contract', () => {
  it('has exactly twenty distinct safe identifiers', () => {
    expect(CORP_EMBLEMS).toHaveLength(20);
    expect(new Set(CORP_EMBLEMS).size).toBe(20);
    for (const id of CORP_EMBLEMS) expect(isCorpEmblemId(id)).toBe(true);
  });

  it('legacy records have stable defaults; a saved selection overrides the default', () => {
    const first = corpEmblemId('persistent-corporation');
    expect(corpEmblemId('persistent-corporation')).toBe(first);
    expect(CORP_EMBLEMS).toContain(first);
    expect(corpEmblemId('persistent-corporation', 'phoenix')).toBe('phoenix');
    const defaults = new Set(Array.from({ length: 100 }, (_, i) => corpEmblemId(`corp-${i}`)));
    expect(defaults.size).toBe(20);
  });

  it('never treats remotely supplied paths, markup or object keys as a mark', () => {
    for (const value of [
      null,
      {},
      [],
      '__proto__',
      'constructor',
      '<svg>',
      'https://evil.test/icon.svg',
      'FALCON',
    ]) {
      expect(isCorpEmblemId(value)).toBe(false);
      expect(corpEmblemId('legacy', value)).toBe(corpEmblemId('legacy'));
    }
  });
});
