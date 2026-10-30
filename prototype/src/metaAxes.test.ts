import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTOR_ZERO_PROGRESS_KEY } from '../../decisions/sectorZeroProgress';

/**
 * PVR-3.1 — account XP stays outside the deterministic simulation. Commander
 * power trees were retired; Sector Zero retains its separate progression profile.
 * Legacy profile and match-start behavior is covered by `meta.test.ts`.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string): string => readFileSync(path.join(root, p), 'utf8');

/** Слова оси аккаунта. Их появление в контракте ядра и есть слияние осей. */
const ACCOUNT_AXIS = /\baccountXp\b|\baccountLevel\b/;

describe('PVR-3.1 — ось аккаунта не доезжает до детерминированного ядра', () => {
  it('контракт старта матча её не несёт: ни `MatchConfig`, ни `Context`', () => {
    const src = read('packages/shared-core/src/action/types.ts');
    expect(ACCOUNT_AXIS.test(src)).toBe(false);
  });

  it('состояние матча её не несёт', () => {
    const src = read('packages/shared-core/src/state/gameState.ts');
    expect(ACCOUNT_AXIS.test(src)).toBe(false);
  });

  it('шипнутый каталог данных её не несёт — иначе уровень пейсил бы силу через данные', () => {
    const src = read('packages/shared-core/src/data/schemas.ts');
    expect(ACCOUNT_AXIS.test(src)).toBe(false);
  });
});

describe('PVR-3.1 — карьера командующего остаётся чистой проекцией', () => {
  const meta = read('prototype/src/meta.ts');

  it('модуль XP и статистики не импортирует сервер или игровые эффекты', () => {
    expect(meta.match(/^import\s/m)).toBeNull();
  });
});

describe('PVR-3.1 — Sector Zero не смешивается с карьерой командующего', () => {
  it('дом забега Sector Zero не пересекается с домом карьеры', () => {
    expect(SECTOR_ZERO_PROGRESS_KEY.startsWith('vd.meta.')).toBe(false);
    expect(SECTOR_ZERO_PROGRESS_KEY).toBe('sector-zero.progress.v1');
  });

  it('прогресс забега не читает карьеру командующего', () => {
    const progress = read('decisions/sectorZeroProgress.ts');
    expect(progress.includes('vd.meta')).toBe(false);
  });
});
