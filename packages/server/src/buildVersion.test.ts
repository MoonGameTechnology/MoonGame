import { describe, expect, it } from 'vitest';
import { buildVersion } from './buildVersion';

describe('ZTP-1.1 · buildVersion', () => {
  it('reports the first 12 chars of a full commit sha, lowercased', () => {
    expect(buildVersion('70967CF0BDB897846D457E175C3D79DABAEA67BF')).toBe('70967cf0bdb8');
  });

  it('keeps a short sha as is', () => {
    expect(buildVersion('70967cf')).toBe('70967cf');
  });

  it('reports nothing when the variable is unset or empty (a from-source build)', () => {
    expect(buildVersion(undefined)).toBeUndefined();
    expect(buildVersion('')).toBeUndefined();
    expect(buildVersion('   ')).toBeUndefined();
  });

  it('never echoes a value that is not a commit id', () => {
    expect(buildVersion('main')).toBeUndefined();
    expect(buildVersion('/opt/moongame')).toBeUndefined();
    // A token-shaped value, assembled at runtime so secret scanners don't flag the fixture.
    expect(buildVersion(`ghp_${'0'.repeat(36)}`)).toBeUndefined();
    expect(buildVersion('abc12')).toBeUndefined(); // too short to be a sha
    expect(buildVersion('a'.repeat(41))).toBeUndefined();
  });
});
