import { describe, expect, it } from 'vitest';
import { PORTABLE_RUN_VERSION, type PortableRunSave } from './portableRun';
import { checkSeal, cloudSeal, LOCAL_SEAL, sealProgress } from './profileSeal';
import { RUN_SAVE_VERSION, type RunSave } from './runSave';
import {
  parseSealedPortableRun,
  parseSealedRunSave,
  sealedRunProfileSeed,
  serializeSealedPortableRun,
  serializeSealedRunSave,
} from './runSeal';

const seed = 'profile-seed-1';
const run = {
  v: RUN_SAVE_VERSION,
  mode: 'sector_zero',
  difficulty: 'normal',
  sectorZeroAttempt: 4,
  sectorZeroMission: 1,
  shipLoadouts: { scout: ['engine'] },
  state: {
    time: 42,
    winner: null,
    players: {
      p1: { resources: { metal: 100 }, technologies: { completed: ['boon_shield'] } },
    },
  },
} satisfies RunSave;
const portable: PortableRunSave = {
  v: PORTABLE_RUN_VERSION,
  mode: 'sector_zero',
  difficulty: 'normal',
  wave: 3,
  attempt: 4,
  boons: ['boon_shield'],
  map: 'sector-zero-2',
};

const edit = (raw: string, patch: Record<string, unknown>): string =>
  JSON.stringify({ ...(JSON.parse(raw) as object), ...patch });

describe('печать забега Sector Zero', () => {
  it('точный снимок и переносимый дескриптор переживают запись и разбор без поля печати', () => {
    const full = serializeSealedRunSave(run, seed);
    const compact = serializeSealedPortableRun(portable, seed);
    expect(checkSeal(full, `sector-zero.run.v1:${seed}`)).toBe('sealed');
    expect(checkSeal(compact, `sector-zero.portable.v1:${seed}`)).toBe('sealed');
    expect(parseSealedRunSave(full, seed)).toEqual(run);
    expect(parseSealedPortableRun(compact, seed)).toEqual(portable);
  });

  it('порядок ключей JSON и необязательные undefined не ломают честную запись', () => {
    const full = serializeSealedRunSave({ ...run, shipLoadouts: undefined }, seed);
    const reordered = JSON.stringify(
      Object.fromEntries(Object.entries(JSON.parse(full) as object).reverse()),
    );
    expect(parseSealedRunSave(reordered, seed)).toEqual({ ...run, shipLoadouts: undefined });
    const compact = serializeSealedPortableRun({ ...portable, boons: undefined }, seed);
    expect(parseSealedPortableRun(compact, seed)).toEqual({ ...portable, boons: undefined });
  });

  it('правка наград, победителя, попытки, усилений или главы полного снимка отвергается', () => {
    const sealed = serializeSealedRunSave(run, seed);
    for (const patch of [
      { state: { ...run.state!, players: { p1: { resources: { metal: 999999 } } } } },
      { state: { ...run.state!, winner: 'p1' } },
      { sectorZeroAttempt: 5 },
      {
        state: { ...run.state!, players: { p1: { technologies: { completed: ['boon_swarm'] } } } },
      },
      { sectorZeroMission: 2 },
      { shipLoadouts: { scout: ['engine', 'shield'] } },
    ]) {
      expect(parseSealedRunSave(edit(sealed, patch), seed)).toBeNull();
    }
  });

  it('правка волны, попытки, усилений и главы дескриптора отвергается', () => {
    const sealed = serializeSealedPortableRun(portable, seed);
    for (const patch of [
      { wave: 99 },
      { attempt: 5 },
      { boons: ['boon_shield', 'boon_swarm'] },
      { map: 'sector-zero-3' },
      { difficulty: 'weak' },
    ]) {
      expect(parseSealedPortableRun(edit(sealed, patch), seed)).toBeNull();
    }
  });

  it('снятая печать и неподписанное старое сохранение не принимаются', () => {
    const full = serializeSealedRunSave(run, seed);
    const compact = serializeSealedPortableRun(portable, seed);
    expect(parseSealedRunSave(edit(full, { seal: undefined }), seed)).toBeNull();
    expect(parseSealedPortableRun(edit(compact, { seal: undefined }), seed)).toBeNull();
    expect(parseSealedRunSave(JSON.stringify(run), seed)).toBeNull();
    expect(parseSealedPortableRun(JSON.stringify(portable), seed)).toBeNull();
  });

  it('снимок и дескриптор нельзя пересадить в другой профиль', () => {
    expect(parseSealedRunSave(serializeSealedRunSave(run, seed), 'profile-seed-2')).toBeNull();
    expect(
      parseSealedPortableRun(serializeSealedPortableRun(portable, seed), 'profile-seed-2'),
    ).toBeNull();
  });

  it('полный снимок несёт seed профиля внутри печати для восстановления без метаданных', () => {
    const raw = serializeSealedRunSave(run, seed);
    expect(JSON.parse(raw).profileSeed).toBe(seed);
    expect(sealedRunProfileSeed(raw)).toBe(seed);
    expect(parseSealedRunSave(raw, seed)).toEqual(run);
  });

  it('seed восстанавливается только из целого снимка, а не из неподписанной подсказки', () => {
    const raw = serializeSealedRunSave(run, seed);
    for (const value of [
      edit(raw, { profileSeed: 'forged-seed' }),
      edit(raw, { profileSeed: undefined }),
      edit(raw, { seal: undefined }),
      JSON.stringify({ ...run, profileSeed: seed }),
      sealProgress({ ...run, profileSeed: seed }, LOCAL_SEAL),
      serializeSealedPortableRun({ ...portable, ...run }, seed),
      serializeSealedRunSave({ ...run, v: 999 }, seed),
      null,
      undefined,
      '',
      '{broken',
      '[]',
    ]) {
      expect(sealedRunProfileSeed(value)).toBeNull();
    }
  });

  it('старые подписанные снимки без подсказки читаются с уже известным seed профиля', () => {
    const old = sealProgress(run, `sector-zero.run.v1:${seed}`);
    expect(parseSealedRunSave(old, seed)).toEqual(run);
    expect(sealedRunProfileSeed(old)).toBeNull();
  });

  it('домены полного снимка, дескриптора и профиля разделены даже при совместимой форме', () => {
    // Both underlying shape parsers would accept this body. Only the binding must reject it.
    const both = { ...run, ...portable };
    const full = serializeSealedRunSave(both, seed);
    const compact = serializeSealedPortableRun(both, seed);
    expect(parseSealedRunSave(full, seed)).not.toBeNull();
    expect(parseSealedPortableRun(compact, seed)).not.toBeNull();
    expect(parseSealedPortableRun(full, seed)).toBeNull();
    expect(parseSealedRunSave(compact, seed)).toBeNull();
    for (const binding of [LOCAL_SEAL, cloudSeal('p1')]) {
      const profile = sealProgress(both, binding);
      expect(parseSealedRunSave(profile, seed)).toBeNull();
      expect(parseSealedPortableRun(profile, seed)).toBeNull();
    }
  });

  it('целая печать не заменяет проверку версии и обязательных полей', () => {
    expect(parseSealedRunSave(serializeSealedRunSave({ ...run, v: 999 }, seed), seed)).toBeNull();
    expect(parseSealedRunSave(serializeSealedRunSave({ ...run, mode: '' }, seed), seed)).toBeNull();
    expect(
      parseSealedPortableRun(serializeSealedPortableRun({ ...portable, v: 999 }, seed), seed),
    ).toBeNull();
    expect(
      parseSealedPortableRun(serializeSealedPortableRun({ ...portable, wave: -1 }, seed), seed),
    ).toBeNull();
  });

  it('пустое и мусорное хранилище возвращает null без исключения', () => {
    for (const raw of [null, undefined, '', '{broken', 'null', '[]', '42', '"text"']) {
      expect(parseSealedRunSave(raw, seed)).toBeNull();
      expect(parseSealedPortableRun(raw, seed)).toBeNull();
    }
    for (const seal of [null, 123, 'broken']) {
      expect(
        parseSealedRunSave(edit(serializeSealedRunSave(run, seed), { seal }), seed),
      ).toBeNull();
      expect(
        parseSealedPortableRun(edit(serializeSealedPortableRun(portable, seed), { seal }), seed),
      ).toBeNull();
    }
  });
});
