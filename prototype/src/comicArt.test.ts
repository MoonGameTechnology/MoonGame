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
import { PVE_MISSION_COUNT, pveChapter } from '../../packages/client/src/gameData';
import { CHAPTER_COMICS } from './comicArt';

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

describe('комиксы глав — реестр и папка арта', () => {
  const chapters = Array.from({ length: PVE_MISSION_COUNT }, (_, i) => pveChapter(i).id);

  it('реестр чист: главы настоящие, панели с картинкой, подписи есть в обеих локалях', () => {
    expect(chapters.length).toBeGreaterThan(0);
    const hasKey = (k: string): boolean => k in ru && k in en;
    expect(comicProblems(CHAPTER_COMICS, chapters, hasKey)).toEqual([]);
  });

  it('в папке только арт и инструкция; имена — латиница, цифры и дефис (требование 1.22)', () => {
    const odd = artFiles().filter(
      (f) => f !== 'README.md' && !/^[a-z0-9-]+\/(intro|outro)-\d+\.webp$/.test(f),
    );
    expect(odd, 'файлы вне схемы <глава>/<intro|outro>-<n>.webp').toEqual([]);
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

  it('инструкция для художника лежит рядом с артом', () => {
    expect(artFiles()).toContain('README.md');
  });
});
