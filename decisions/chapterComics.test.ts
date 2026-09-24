import { describe, expect, it } from 'vitest';

import { shippedGameData } from '../data/bundle';
import {
  comicDue,
  comicId,
  comicProblems,
  markComicSeen,
  type ComicRegistry,
} from './chapterComics';
import { freshSectorZeroProgress, parseSectorZeroProgress } from './sectorZeroProgress';

const data = shippedGameData();
const fresh = () => freshSectorZeroProgress(data, 'comics');
const PANELS = [{ image: 'a.webp', captions: ['k.1'] }, { image: 'b.webp' }];
const REGISTRY: ComicRegistry = { 'pve-1': { intro: PANELS } };

describe('комикс главы — когда показывать (решение владельца 2026-09-24)', () => {
  it('есть комикс и он не показан — отдаём его панели', () => {
    expect(comicDue(fresh(), REGISTRY, 'pve-1', 'intro')).toEqual(PANELS);
  });

  it('показан — больше не показываем: один раз на профиль', () => {
    const seen = markComicSeen(fresh(), comicId('pve-1', 'intro'));
    expect(comicDue(seen, REGISTRY, 'pve-1', 'intro')).toBeNull();
  });

  it('нет арта — нет и комикса: у главы без комикса и у пустого списка панелей', () => {
    expect(comicDue(fresh(), REGISTRY, 'pve-1', 'outro')).toBeNull();
    expect(comicDue(fresh(), REGISTRY, 'pve-2', 'intro')).toBeNull();
    expect(comicDue(fresh(), { 'pve-1': { intro: [] } }, 'pve-1', 'intro')).toBeNull();
  });

  it('отметка чистая и не дублируется', () => {
    const p = fresh();
    const once = markComicSeen(p, 'pve-1:intro');
    expect(p.comicsSeen).toEqual([]);
    expect(once.comicsSeen).toEqual(['pve-1:intro']);
    expect(markComicSeen(once, 'pve-1:intro')).toBe(once);
  });
});

describe('отметка «показан» живёт в профиле — и переживает облако', () => {
  it('новый профиль — ничего не показано', () => {
    expect(fresh().comicsSeen).toEqual([]);
  });

  it('сохранённая отметка читается обратно, мусор — нет', () => {
    const raw = JSON.stringify({
      ...fresh(),
      comicsSeen: ['pve-1:intro', 'pve-2:outro', 'pve-1:intro', 42, 'не-то', 'pve-1:credits'],
    });
    expect(parseSectorZeroProgress(raw, data).comicsSeen).toEqual(['pve-1:intro', 'pve-2:outro']);
  });

  it('старый профиль без поля читается как «ничего не показано»', () => {
    const { comicsSeen: _dropped, ...old } = fresh();
    expect(parseSectorZeroProgress(JSON.stringify(old), data).comicsSeen).toEqual([]);
  });
});

describe('реестр арта проверяется до того, как доедет до игрока', () => {
  const chapters = ['pve-1', 'pve-2'];
  const hasKey = (k: string) => k.startsWith('k.');

  it('исправный реестр — без замечаний', () => {
    expect(comicProblems(REGISTRY, chapters, hasKey)).toEqual([]);
  });

  it('ловит чужую главу, пустой комикс, пустую картинку и подпись без перевода', () => {
    const bad = {
      'pve-9': { intro: PANELS },
      'pve-2': { intro: [], outro: [{ image: '', captions: ['k.2', 'нет.ключа'] }] },
    } as ComicRegistry;
    expect(comicProblems(bad, chapters, hasKey)).toEqual([
      'pve-9: такой главы нет',
      'pve-2:intro: нет ни одной панели',
      'pve-2:outro #1: нет картинки',
      'pve-2:outro #1: подписи «нет.ключа» нет в локалях',
    ]);
  });

  it('ловит неизвестный момент — комикс, который никто никогда не покажет', () => {
    const odd = { 'pve-1': { credits: PANELS } } as unknown as ComicRegistry;
    expect(comicProblems(odd, chapters, hasKey)).toEqual(['pve-1:credits: такого момента нет']);
  });
});
