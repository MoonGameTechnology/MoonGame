import { expect, it } from 'vitest';
import { hashGameDataBundle, hashJson } from '../../packages/shared-core/src/index';
import { SOLO_MIGRATIONS } from '../../decisions/soloSaveMigration';
import { data } from './gameData';
import { kernel } from './protoKernel';

// A catalogue change without its pair would leave every local skirmish of the previous
// release unreadable: the newest pair must target the exact shipped catalogue.
it('the newest solo save migration targets the exact shipped catalogue and module graph', () => {
  const migration = SOLO_MIGRATIONS.at(-1)!;
  expect(data.version).toBe(migration.toData);
  expect(hashGameDataBundle(data)).toBe(migration.toDataHash);
  expect(hashJson({ data, modules: kernel.manifest })).toBe(migration.toRules);
});
