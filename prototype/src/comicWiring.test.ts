/**
 * Проводка комиксов глав (решение владельца 2026-09-24) — статический сторож, как соседние:
 * `main.ts` живёт на DOM. Правило «когда показывать» держит `decisions/chapterComics.test.ts`,
 * реестр — `comicArt.test.ts`; здесь — что игра действительно зовёт комикс в обоих местах
 * и что он не запирает игрока.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

describe('комиксы глав — проводка', () => {
  it('новый забег — из меню и с итогов — идёт через комикс главы', () => {
    expect(MAIN).toContain('start: () => launchSectorRun(),');
    expect(MAIN).toMatch(/sectorZeroMenu\.hide\(\);\n\s+launchSectorRun\(\);/);
    // Мимо комикса забег стартует только в дев-забеге (он не пишет профиль) и из самого
    // `launchSectorRun`: объявление + дев-вход + один вызов после комикса.
    expect(MAIN.match(/\bstartPvEMatch\(/g)).toHaveLength(3);
    expect(MAIN).toContain(
      "playChapterComic(pveChapter(nextSectorMission).id, 'intro', () => startPvEMatch());",
    );
  });

  it('финал главы — только после победы, один раз на попытку, поверх итогов', () => {
    const block =
      /if \(sectorAttempt > 0 && clearedAttempt !== sectorAttempt\) \{[\s\S]*?\n {4}\}/.exec(
        MAIN,
      )?.[0] ?? '';
    expect(block).toContain(
      "if (won) playChapterComic(pveChapter(sectorMission).id, 'outro', () => {});",
    );
  });

  it('отметка «показан» пишется в профиль, когда игрок комикс закрыл', () => {
    expect(MAIN).toContain(
      'saveSectorProgress(markComicSeen(sectorProgress, comicId(chapter, moment)));',
    );
  });

  it('«назад» и Escape закрывают комикс первым — он верхняя ступень лестницы', () => {
    const ladder = /const BACK_LAYERS: BackLayer\[\] = \[\n\s+\{ id: '([^']+)'/.exec(MAIN)?.[1];
    expect(ladder).toBe('comic');
  });
});
