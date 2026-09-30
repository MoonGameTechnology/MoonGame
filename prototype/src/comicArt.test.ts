/**
 * Сторож арта комиксов глав (решение владельца 2026-09-24). Арт рисует владелец и
 * приносит файлами — поэтому ошибки подключения ловятся здесь, в гейте, а не у игрока:
 * комикс чужой главы, подпись без перевода, картинка, которая лежит в папке, но не
 * подключена (или подключена, но лежит не там), и имя файла, которое площадка не примет.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { comicProblems } from '../../decisions/chapterComics';
import { ru } from '../../localization/ru';
import { en } from '../../localization/en';
import { PVE_MISSION_COUNT, pveChapter, pveState } from '../../packages/client/src/gameData';
import { chapterChain } from '../../decisions/chapterChain';
import { shippedGameData } from '../../data/bundle';
import trainingMap from '../../data/maps/training-1.json';
import { CHAPTER_COMICS, COMIC_TASK_TRIGGERS } from './comicArt';

const ART = fileURLToPath(new URL('../art/comics/', import.meta.url));
const REGISTRY_SRC = readFileSync(new URL('./comicArt.ts', import.meta.url), 'utf8');

/** Все файлы папки арта, пути относительно неё (`pve-1/intro-1.webp`). */
function artFiles(dir = ART, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) =>
    statSync(dir + name).isDirectory()
      ? artFiles(`${dir}${name}/`, `${prefix}${name}/`)
      : [`${prefix}${name}`],
  );
}

/** Чем глава может звать комикс `task`: её задачи и шаги главной цепочки (глава IV). */
function triggersOf(chapter: string): string[] {
  const i = Array.from({ length: PVE_MISSION_COUNT }, (_, n) => pveChapter(n).id).indexOf(chapter);
  if (i < 0) return [];
  const chain = chapterChain(pveState(shippedGameData(), i), 'p1', 1) ?? [];
  return [...pveChapter(i).objectives.map((o) => o.id), ...chain.map((st) => st.key)];
}

describe('комиксы глав — реестр и папка арта', () => {
  // Полигон «Протокол допуска» — тоже глава для комикса: его вступление играет перед ним.
  const chapters = [
    trainingMap.id,
    ...Array.from({ length: PVE_MISSION_COUNT }, (_, i) => pveChapter(i).id),
  ];

  it('реестр чист: главы настоящие, панели с картинкой, подписи есть в обеих локалях', () => {
    expect(chapters.length).toBeGreaterThan(0);
    const hasKey = (k: string): boolean => k in ru && k in en;
    expect(comicProblems(CHAPTER_COMICS, chapters, hasKey)).toEqual([]);
  });

  it('в папке только арт и инструкция; имена — латиница, цифры и дефис (требование 1.22)', () => {
    const odd = artFiles().filter(
      (f) =>
        f !== 'README.md' &&
        !/^[a-z0-9-]+\/(intro|outro|task|echo|echo-record)(-en)?-\d+\.webp$/.test(f),
    );
    expect(odd, 'файлы вне схемы <глава>/<момент>-<n>.webp').toEqual([]);
  });

  it('каждая картинка папки подключена в реестр — и наоборот', () => {
    const files = artFiles().filter((f) => f.endsWith('.webp'));
    const imported = [...REGISTRY_SRC.matchAll(/from '\.\.\/art\/comics\/([^']+)'/g)].map(
      (m) => m[1],
    );
    expect(
      files.filter((f) => !imported.includes(f)),
      'лежат, но не подключены',
    ).toEqual([]);
    expect(
      imported.filter((f) => !files.includes(f!)),
      'подключены, но не лежат',
    ).toEqual([]);
  });

  it('у комикса `task` есть задача-триггер, и она есть в главе', () => {
    for (const [chapter, moments] of Object.entries(CHAPTER_COMICS)) {
      if (!moments.task) continue;
      const task = COMIC_TASK_TRIGGERS[chapter];
      expect(task, `${chapter}: нет задачи-триггера`).toBeTruthy();
      expect(triggersOf(chapter)).toContain(task);
    }
  });

  it('каждый триггер — задача или шаг цепочки своей главы (арт может прийти позже)', () => {
    for (const [chapter, task] of Object.entries(COMIC_TASK_TRIGGERS))
      expect(triggersOf(chapter), chapter).toContain(task);
  });

  it('инструкция для художника лежит рядом с артом', () => {
    expect(artFiles()).toContain('README.md');
  });
});
