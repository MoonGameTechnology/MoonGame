import { describe, expect, it } from 'vitest';
import { ARCHIVED_SOLO_MIGRATIONS } from './soloSaveMigrationPairsArchive';
import { SOLO_MIGRATIONS } from './soloSaveMigrationPairs';

/** Архив закрыт: он кончается каталогом 0.1.80, а полный список начинается с него целиком. */
describe('архив пар соло-сохранения', () => {
  it('закрыт на каталоге 0.1.80 и открывает полный список', () => {
    expect(ARCHIVED_SOLO_MIGRATIONS.at(-1)!.toData).toBe('0.1.80');
    expect(SOLO_MIGRATIONS.slice(0, ARCHIVED_SOLO_MIGRATIONS.length)).toEqual(
      ARCHIVED_SOLO_MIGRATIONS,
    );
  });
});
