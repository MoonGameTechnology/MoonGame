/**
 * Альбом комиксов Sector Zero (заказ владельца 2026-10-12): вкладка меню, где можно снова
 * посмотреть уже открытые страницы. Открытой страница считается тогда же, когда комикс
 * перестаёт показываться сам, — по отметке профиля `comicsSeen` ({@link comicId}). Поэтому
 * альбом переезжает с профилем через облако и не открывает ничего, чего игрок не видел.
 *
 * Здесь только «что лежит в альбоме и что из этого открыто»; картинки и подписи глав
 * подставляет хозяин.
 */
import { comicId, type ComicMoment, type ComicPanel, type ComicRegistry } from './chapterComics';
import type { SectorZeroProgress } from './sectorZeroProgress';

/** Порядок эпизодов внутри главы — по сюжету: начало, сцены по событиям, финал. `echo-record`
 *  здесь нет: это та же сцена знакомства с Эхо, что и `echo`, с той же отметкой просмотра. */
export const ALBUM_MOMENTS: readonly ComicMoment[] = [
  'intro',
  'task',
  'echo',
  'network',
  'captive',
  'refuge',
  'rescued',
  'outro',
];

/** Эпизод альбома — один комикс (одна или несколько страниц подряд). */
export interface AlbumEpisode {
  /** Отметка профиля, она же адрес эпизода в альбоме: `pve-1:intro`. */
  id: string;
  chapter: string;
  moment: ComicMoment;
  panels: readonly ComicPanel[];
  open: boolean;
}

export interface AlbumChapter {
  chapter: string;
  episodes: AlbumEpisode[];
}

export interface ComicAlbumView {
  /** Главы в порядке `chapters`; глава без комиксов в альбом не попадает. */
  chapters: AlbumChapter[];
  /** Открыто страниц и всего страниц в альбоме. */
  open: number;
  total: number;
}

/** Панели эпизода: у сцены Эхо — обычная версия, а нет её — архивная запись. */
function episodePanels(
  registry: ComicRegistry,
  chapter: string,
  moment: ComicMoment,
): readonly ComicPanel[] {
  const moments = registry[chapter] ?? {};
  const panels = moments[moment] ?? (moment === 'echo' ? moments['echo-record'] : undefined);
  return panels ?? [];
}

/** Альбом профиля: все эпизоды реестра по главам и сюжету, с отметкой «открыт». */
export function comicAlbum(
  progress: Pick<SectorZeroProgress, 'comicsSeen'>,
  registry: ComicRegistry,
  chapters: readonly string[],
): ComicAlbumView {
  const seen = new Set(progress.comicsSeen);
  let open = 0;
  let total = 0;
  const out: AlbumChapter[] = [];
  for (const chapter of chapters) {
    const episodes: AlbumEpisode[] = [];
    for (const moment of ALBUM_MOMENTS) {
      const panels = episodePanels(registry, chapter, moment);
      if (panels.length === 0) continue;
      const id = comicId(chapter, moment);
      const isOpen = seen.has(id);
      total += panels.length;
      if (isOpen) open += panels.length;
      episodes.push({ id, chapter, moment, panels, open: isOpen });
    }
    if (episodes.length > 0) out.push({ chapter, episodes });
  }
  return { chapters: out, open, total };
}

/** Панели открытого эпизода по его id — или `null`: такого нет или он ещё закрыт. Хозяин
 *  берёт панели отсюда, а не из разметки, так что правленая кнопка закрытую страницу не
 *  покажет. */
export function albumEpisode(view: ComicAlbumView, id: string): readonly ComicPanel[] | null {
  for (const chapter of view.chapters)
    for (const episode of chapter.episodes)
      if (episode.id === id) return episode.open ? episode.panels : null;
  return null;
}
