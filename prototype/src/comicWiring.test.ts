/**
 * Проводка комиксов глав (решение владельца 2026-09-24) — статический сторож, как соседние:
 * `main.ts` живёт на DOM. Правило «когда показывать» держит `decisions/chapterComics.test.ts`,
 * реестр — `comicArt.test.ts`; здесь — что игра действительно зовёт комикс в обоих местах
 * и что он не запирает игрока.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
// Конец забега засчитывает его владелец (`sectorRun.ts`, REFM-210) и зовёт комиксы хуками.
const RUN = readFileSync(new URL('./sectorRun.ts', import.meta.url), 'utf8');
// Меню, вход и комиксы глав — у оболочки Sector Zero (REFM-211); запуск партии — в `main.ts`.
const SHELL = readFileSync(new URL('./sectorZeroShell.ts', import.meta.url), 'utf8');
/** Засчёт попытки — один раз на попытку, в кадровом такте журнала забега. */
const settleBlock = (): string =>
  /if \(sectorAttempt > 0 && clearedAttempt !== sectorAttempt\) \{[\s\S]*?\n {4}\}/.exec(
    RUN,
  )?.[0] ?? '';

describe('комиксы глав — проводка', () => {
  it('новый забег — из меню и с итогов — идёт через комикс главы', () => {
    expect(SHELL).toContain('start: () => launchSectorRun(),');
    expect(SHELL).toMatch(/sectorZeroMenu\.hide\(\);\n\s+launchSectorRun\(\);/);
    // Мимо комикса забег стартует только в дев-забеге (он не пишет профиль) и из самого
    // `launchSectorRun`: объявление + дев-вход + хук запуска, который оболочка зовёт ровно
    // один раз — после комикса.
    expect(MAIN.match(/\bstartPvEMatch\(/g)).toHaveLength(3);
    expect(MAIN).toContain('startRun: () => startPvEMatch(),');
    expect(MAIN).toContain('startDev: __PLAYER_BUILD__ ? undefined : () => startPvEMatch(true),');
    expect(SHELL.match(/\bgame\.startRun\(/g)).toHaveLength(1);
    expect(SHELL).toContain(
      "playChapterComic(pveChapter(nextSectorMission).id, 'intro', () => game.startRun());",
    );
  });

  it('финал главы — только после победы, один раз на попытку, поверх итогов', () => {
    expect(settleBlock()).toContain('if (won) game.chapterWon();');
    expect(MAIN).toContain(
      "chapterWon: () => playChapterComic(pveChapter(sectorMission).id, 'outro', () => {}),",
    );
  });

  it('отметка «показан» пишется в профиль, когда игрок комикс закрыл', () => {
    expect(SHELL).toContain(
      'saveSectorProgress(markComicSeen(sectorProgress, comicId(chapter, moment)));',
    );
  });

  it('комикс `task` зовётся и шагом главной цепочки главы (глава IV: встреча с союзником)', () => {
    expect(SHELL).toContain('...(chain ?? []).filter((st) => st.done).map((st) => st.key),');
    expect(MAIN).toContain('if (isSectorZeroRun()) playTaskComic(missions, chain);');
  });

  it('комиксы по событиям — каждый момент таблицы, сцены главы VI тоже, и раньше финала', () => {
    expect(SHELL).toMatch(
      /for \(const moment of comicsTriggered\(\s*sectorProgress,\s*comicArt\.registry,\s*COMIC_TRIGGERS,\s*chapter,\s*complete,?\s*\)\)\n\s+playChapterComic\(chapter, moment, \(\) => \{\}\);/,
    );
    // Победный кадр: сцена и задача встают в очередь раньше финала главы.
    const block = settleBlock();
    const scenes = block.indexOf('game.finalScenes();');
    expect(scenes).toBeGreaterThan(-1);
    expect(scenes).toBeLessThan(block.indexOf('game.chapterWon();'));
    expect(MAIN).toContain('finalScenes: () => playTaskComic(runMissionRows(), runChain()),');
  });

  it('«назад» и Escape закрывают комикс первым — он верхняя ступень лестницы', () => {
    const ladder = /const BACK_LAYERS: BackLayer\[\] = \[\n\s+\{ id: '([^']+)'/.exec(MAIN)?.[1];
    expect(ladder).toBe('comic');
  });
});
