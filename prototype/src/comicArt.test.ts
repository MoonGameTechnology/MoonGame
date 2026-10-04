/**
 * Сторож арта комиксов глав (решение владельца 2026-09-24). Арт рисует владелец и
 * приносит файлами — поэтому ошибки подключения ловятся здесь, в гейте, а не у игрока:
 * комикс чужой главы, подпись без перевода, картинка, которая лежит в папке, но не
 * подключена (или подключена, но лежит не там), и имя файла, которое площадка не примет.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  COMIC_MOMENTS,
  STORY_FACTS,
  TRIGGERED_MOMENTS,
  comicProblems,
} from '../../decisions/chapterComics';
import { ru } from '../../localization/ru';
import { en } from '../../localization/en';
import {
  PVE_MISSION_COUNT,
  pveChapter,
  pveModeId,
  pveState,
} from '../../packages/client/src/gameData';
import type { GameState, MapObjective } from '../../packages/shared-core/src/index';
import { chapterChain } from '../../decisions/chapterChain';
import { shippedGameData } from '../../data/bundle';
import trainingMap from '../../data/maps/training-1.json';
import { advance, setMatchMode } from './game';
import { CHAPTER_COMICS, COMIC_TRIGGERS } from './comicArt';

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

const MISSIONS = Array.from({ length: PVE_MISSION_COUNT }, (_, i) => pveChapter(i).id);

afterEach(() => setMatchMode(undefined));

/** Мир главы с первого шага часов, как в забеге: штурм заведён (`state.pve`), и цепочка
 *  главы с контрактом операции уже видна. */
function chapterStart(chapter: string): { state: GameState; objectives: MapObjective[] } | null {
  const i = MISSIONS.indexOf(chapter);
  if (i < 0) return null;
  const state = pveState(shippedGameData(), i);
  setMatchMode(pveModeId(i));
  return { state: advance(state, state.time + 1).state, objectives: pveChapter(i).objectives };
}

/** Чем глава может звать комикс по событиям: её задачи, шаги главной цепочки (главы IV–VI) и
 *  факты мира, которые её мир умеет записать: разрыв сети — там, где у Роя есть улей, а у
 *  контракта операции очаги (глава V). */
function triggersOf(chapter: string): string[] {
  const start = chapterStart(chapter);
  if (!start) return [];
  const { state } = start;
  const chain = chapterChain(state, 'p1', 1, shippedGameData()) ?? [];
  const facts = state.pve?.home && state.operation?.production.length ? [...STORY_FACTS] : [];
  return [...start.objectives.map((o) => o.id), ...chain.map((st) => st.key), ...facts];
}

describe('комиксы глав — реестр и папка арта', () => {
  // Полигон «Протокол допуска» — тоже глава для комикса: его вступление играет перед ним.
  const chapters = [trainingMap.id, ...MISSIONS];

  it('реестр чист: главы настоящие, панели с картинкой, подписи есть в обеих локалях', () => {
    expect(chapters.length).toBeGreaterThan(0);
    const hasKey = (k: string): boolean => k in ru && k in en;
    expect(comicProblems(CHAPTER_COMICS, chapters, hasKey)).toEqual([]);
  });

  it('в папке только арт и инструкция; имена — латиница, цифры и дефис (требование 1.22)', () => {
    const name = new RegExp(`^[a-z0-9-]+/(${COMIC_MOMENTS.join('|')})(-en)?-\\d+\\.webp$`);
    const odd = artFiles().filter((f) => f !== 'README.md' && !name.test(f));
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

  it('у комикса по событиям есть триггер, и он есть в главе', () => {
    for (const [chapter, moments] of Object.entries(CHAPTER_COMICS))
      for (const moment of TRIGGERED_MOMENTS) {
        if (!moments[moment]) continue;
        const trigger = COMIC_TRIGGERS[chapter]?.[moment];
        expect(trigger, `${chapter}:${moment}: нет триггера`).toBeTruthy();
        expect(triggersOf(chapter)).toContain(trigger);
      }
  });

  it('каждый триггер — задача, шаг цепочки или факт мира своей главы (арт может прийти позже)', () => {
    for (const [chapter, moments] of Object.entries(COMIC_TRIGGERS))
      for (const trigger of Object.values(moments))
        expect(triggersOf(chapter), chapter).toContain(trigger);
  });

  it('инструкция для художника лежит рядом с артом', () => {
    expect(artFiles()).toContain('README.md');
  });
});
