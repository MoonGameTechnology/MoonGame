/**
 * Проводка наград героя Sector Zero — статический сторож, как соседние (`comicWiring`): меню
 * и окно наград живут на DOM. Окно модальное, поэтому показывается только при открытом меню;
 * здесь — что повтор главы, который проходит меню насквозь, не оставляет его поверх карты
 * новой попытки (нашёл `smoke:sector-zero`: окно забирало все щелчки забега).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SHELL = readFileSync(new URL('./sectorZeroShell.ts', import.meta.url), 'utf8');
/** Тело `openSectorZero` — до следующего объявления верхнего уровня. */
const openBody = /export function openSectorZero\([\s\S]*?\n\}\n/.exec(SHELL)?.[0] ?? '';

describe('награды героя Sector Zero — проводка', () => {
  it('окно наград видно только при открытом меню', () => {
    expect(SHELL).toContain('initHeroRewards(data, () => sectorZeroMenu?.isOpen() === true)');
  });

  it('повтор главы уходит в забег раньше, чем меню покажет награды', () => {
    const replay = openBody.indexOf('if (replay && sectorZeroMenu.isOpen())');
    const resume = openBody.indexOf('heroReceipts?.resume();');
    expect(replay).toBeGreaterThan(0);
    expect(resume).toBeGreaterThan(replay);
    expect(openBody.slice(replay, resume)).toMatch(/launchSectorRun\(\);\s+return;/);
  });
});
