import { expect, it } from 'vitest';
import { hashGameDataBundle, hashJson } from '../../packages/shared-core/src/index';
import { MINING_SOLO_MIGRATION as migration } from '../../decisions/soloSaveMigration';
import { data } from './gameData';
import { kernel } from './protoKernel';

it('the mining save migration targets the exact shipped catalogue and module graph', () => {
  expect(data.version).toBe(migration.toData);
  expect(hashGameDataBundle(data)).toBe(migration.toDataHash);
  expect(hashJson({ data, modules: kernel.manifest })).toBe(migration.toRules);
});
