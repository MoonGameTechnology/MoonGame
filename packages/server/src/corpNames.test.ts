import { describe, expect, it, vi } from 'vitest';
import { blockedPublicName } from '@void/protocol';
import { CORP_NAME_COUNT, generatedCorpName } from './corpNames';
import { CorpService } from './corpService';
import { MemoryCorpStore } from './store';

describe('server-generated corporation names', () => {
  it('the full curated namespace is unique, bounded and passes public-name policy', () => {
    const names = Array.from({ length: CORP_NAME_COUNT }, (_, i) => generatedCorpName(i));
    expect(names.length).toBeGreaterThanOrEqual(1000);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(24);
      expect(name).toMatch(/^[\p{L}]+ [\p{L}]+$/u);
      expect(blockedPublicName(name)).toBe(false);
    }
    for (const bad of [-1, CORP_NAME_COUNT, 0.5, NaN])
      expect(() => generatedCorpName(bad)).toThrow();
  });

  it('ignores the old APK name and atomically claims another catalogue name on collision', async () => {
    const store = new MemoryCorpStore();
    const service = new CorpService({ store, nameIndex: () => CORP_NAME_COUNT - 1 });
    const a = await service.create(
      { accountId: 'a', login: 'Alice' },
      'Client Provided Name',
      'falcon',
    );
    const b = await service.create({ accountId: 'b', login: 'Bob' }, undefined, 'wolf');
    if (!a.ok || !b.ok) throw Error('fixture');
    expect(await store.getCorp(a.corpId)).toMatchObject({
      name: generatedCorpName(CORP_NAME_COUNT - 1),
      emblemId: 'falcon',
    });
    expect(await store.getCorp(b.corpId)).toMatchObject({
      name: generatedCorpName(0),
      emblemId: 'wolf',
    });
    expect(await store.auditOf(b.corpId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'create', detail: generatedCorpName(0) }),
      ]),
    );
  });

  it('bounds collision retries, never retries an ambiguous persistence failure', async () => {
    const store = new MemoryCorpStore();
    const create = vi
      .spyOn(store, 'createCorp')
      .mockResolvedValue({ ok: false, code: 'E_NAME_TAKEN' });
    const service = new CorpService({ store, nameIndex: () => 0 });
    expect(await service.create({ accountId: 'a', login: 'Alice' })).toEqual({
      ok: false,
      code: 'E_NAME_TAKEN',
    });
    expect(create).toHaveBeenCalledTimes(16);
    expect(new Set(create.mock.calls.map((call) => call[0])).size).toBe(16);
    create.mockClear().mockRejectedValue(new Error('ambiguous commit'));
    await expect(service.create({ accountId: 'a', login: 'Alice' })).rejects.toThrow(
      'ambiguous commit',
    );
    expect(create).toHaveBeenCalledTimes(1);
  });
});
