import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTOR_ZERO_PROGRESS_KEY } from '../../decisions/sectorZeroProgress';

/**
 * PVR-3.1 — СТРАЖ трёх осей прогрессии.
 *
 * `docs/account-level.md` §6 обещал код-тест, который рвёт связку win→XP→level→power
 * там, где её видно. Обещание существовало, теста не было — а без него правило
 * «уровень аккаунта никогда не сила» держалось только на честном слове, при том что
 * в репозитории ОДНОВРЕМЕННО живёт дерево командующего (`meta.ts`), которое силу
 * именно даёт, и чья шапка обещала, что серверный аккаунт его подхватит.
 *
 * Тест держит границу, а не стиль: он падает ровно тогда, когда две оси начинают
 * сливаться. Разбор решения — `account-level.md` §1.1.
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

describe('PVR-3.1 — дерево командующего остаётся СВОЕЙ осью', () => {
  const meta = read('prototype/src/meta.ts');

  it('оно не читает серверный счётчик опыта аккаунта — модуль ЧИСТ по построению', () => {
    // `CommanderStore.xpOf` — единственный аккаунтный XP на сервере. Прочитай его
    // дерево, дающее силу, — и «уровень аккаунта не даёт силы» станет ложью.
    // Проверяется не упоминание (комментарий про границу полезен), а ИМПОРТ: у чистого
    // модуля их ноль, и дотянуться до чужого стора ему физически нечем.
    expect(meta.match(/^import\s/m)).toBeNull();
  });

  it('и не объявляет себя осью аккаунта в шапке', () => {
    // Шапка называла его «the account-level tech trees» — ровно та формулировка, из
    // которой выросло противоречие. Ссылаться на `account-level.md` ниже по файлу
    // можно и нужно: запрещено присваивать себе ЧУЖУЮ ось, а не знать о ней.
    const header = meta.slice(0, meta.indexOf('*/'));
    expect(/account[- ]level tech tree/i.test(header)).toBe(false);
  });
});

describe('PVR-3.1 — у трёх осей три РАЗНЫХ дома', () => {
  it('дом забега Sector Zero не пересекается с домом дерева командующего', () => {
    expect(SECTOR_ZERO_PROGRESS_KEY.startsWith('vd.meta.')).toBe(false);
    expect(SECTOR_ZERO_PROGRESS_KEY).toBe('sector-zero.progress.v1');
  });

  it('прогресс забега не читает дерево командующего', () => {
    const progress = read('decisions/sectorZeroProgress.ts');
    expect(progress.includes('vd.meta')).toBe(false);
  });

  it('решение записано и живёт в одном доме — `account-level.md` §1.1', () => {
    const doc = read('docs/account-level.md');
    expect(doc).toContain('### 1.1 Три оси прогрессии');
    // Долг закрыт: документ больше не отправляет читателя за резолюцией в другой файл.
    expect(doc.includes('требуют отдельной резолюции `PVR-3.1`')).toBe(false);
  });
});
