/**
 * Сторож карточки узла в Академии (AUD-22) — статический, как соседние сторожа экрана
 * подготовки: он живёт на DOM, и поднимать его в vitest значило бы проверять мок.
 *
 * Что держит: «изучен ли узел» и «каких предпосылок не хватает» экран берёт из решения
 * `sectorSkillCard` (`decisions/sectorZeroProgress.ts`), а не считает по списку купленного.
 * Врождённый узел — награда у героя со старта — в `hero.skills` не лежит, и счёт по списку
 * снова повесил бы на него цену, а на его детей замок, хотя покупка их пропускает.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const PREP = readFileSync(new URL('./sectorZeroPreparation.ts', import.meta.url), 'utf8');

describe('AUD-22 — Академия читает изученное из решения', () => {
  it('карточка узла строится через sectorSkillCard, а не по hero.skills', () => {
    expect(PREP).toContain('sectorSkillCard(heroId, hero, id, data)');
    expect(PREP).not.toMatch(/hero\.skills\.includes\(/);
  });
});

describe('PVR-4.7 — босс Роя не герой Академии', () => {
  it('ростер Академии отбрасывает архетип-босса: его не нанимают и не открывают', () => {
    expect(PREP).toMatch(/Object\.entries\(data\.heroes\)\s*\.filter\(\(\[, def\]\) => !def\.boss\)/);
  });
});
