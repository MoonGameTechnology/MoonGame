import { describe, expect, it } from 'vitest';

import { COMIC_MOMENTS, type ComicRegistry } from './chapterComics';
import { ALBUM_MOMENTS, albumEpisode, comicAlbum } from './comicAlbum';

const page = (image: string) => ({ image });
const REGISTRY: ComicRegistry = {
  'training-1': { intro: [page('t-in')], outro: [page('t-out')] },
  'pve-1': {
    outro: [page('1-out')],
    intro: [page('1-in')],
    task: [page('1-task')],
    echo: [page('1-echo')],
    'echo-record': [page('1-echo')],
  },
  'pve-5': { captive: [page('5-c1'), page('5-c2'), page('5-c3')] },
};
const CHAPTERS = ['training-1', 'pve-1', 'pve-2', 'pve-5'];

describe('альбом комиксов (заказ владельца 2026-10-12)', () => {
  it('новый профиль: всё в альбоме, ничего не открыто', () => {
    const view = comicAlbum({ comicsSeen: [] }, REGISTRY, CHAPTERS);
    expect(view.open).toBe(0);
    expect(view.total).toBe(9);
    expect(view.chapters.every((c) => c.episodes.every((e) => !e.open))).toBe(true);
  });

  it('главы — в порядке маршрута, глава без комиксов пропущена', () => {
    const view = comicAlbum({ comicsSeen: [] }, REGISTRY, CHAPTERS);
    expect(view.chapters.map((c) => c.chapter)).toEqual(['training-1', 'pve-1', 'pve-5']);
  });

  it('эпизоды главы — по сюжету, а не по порядку реестра; Эхо — один раз', () => {
    const view = comicAlbum({ comicsSeen: [] }, REGISTRY, CHAPTERS);
    expect(view.chapters[1]!.episodes.map((e) => e.moment)).toEqual([
      'intro',
      'task',
      'echo',
      'outro',
    ]);
  });

  it('открыто то, что игрок уже видел; страницы считаются, а не эпизоды', () => {
    const view = comicAlbum(
      { comicsSeen: ['pve-1:intro', 'pve-1:echo', 'pve-5:captive'] },
      REGISTRY,
      CHAPTERS,
    );
    expect(view.open).toBe(5);
    const pve1 = view.chapters[1]!.episodes;
    expect(pve1.filter((e) => e.open).map((e) => e.id)).toEqual(['pve-1:intro', 'pve-1:echo']);
  });

  it('архивная запись Эхо без обычной версии — тоже эпизод «echo»', () => {
    const view = comicAlbum(
      { comicsSeen: ['pve-1:echo'] },
      { 'pve-1': { 'echo-record': [page('rec')] } },
      ['pve-1'],
    );
    expect(view.chapters[0]!.episodes).toEqual([
      { id: 'pve-1:echo', chapter: 'pve-1', moment: 'echo', panels: [page('rec')], open: true },
    ]);
  });

  it('страницы отдаются только открытого эпизода', () => {
    const view = comicAlbum({ comicsSeen: ['pve-5:captive'] }, REGISTRY, CHAPTERS);
    expect(albumEpisode(view, 'pve-5:captive')).toHaveLength(3);
    expect(albumEpisode(view, 'pve-1:intro')).toBeNull();
    expect(albumEpisode(view, 'pve-9:intro')).toBeNull();
  });

  it('в порядке альбома есть каждый момент комикса, кроме второй версии Эхо', () => {
    expect([...ALBUM_MOMENTS].sort()).toEqual(
      COMIC_MOMENTS.filter((m) => m !== 'echo-record').sort(),
    );
  });
});
