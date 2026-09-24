/**
 * Комиксы глав Sector Zero (решение владельца 2026-09-24): короткий комикс, когда игрок
 * ПЕРВЫЙ раз начинает главу (`intro`), и когда первый раз её проходит (`outro`). Арт
 * делает владелец отдельно; здесь — только правило «когда показывать» и проверка реестра,
 * общие обоим клиентам. Картинки подключает хозяин (`prototype/src/comicArt.ts`).
 *
 * Показ — ОДИН раз на профиль, отметка живёт в профиле ({@link SectorZeroProgress.comicsSeen})
 * и переезжает с ним через облако: на новом устройстве тот же комикс второй раз не
 * всплывёт. Нет арта — нет и комикса: пустой реестр значит, что игра идёт как раньше.
 */
import type { SectorZeroProgress } from './sectorZeroProgress';

/** Когда комикс показывается: перед первым забегом главы и после первой победы в ней. */
export const COMIC_MOMENTS = ['intro', 'outro'] as const;
export type ComicMoment = (typeof COMIC_MOMENTS)[number];

/** Одна панель: картинка (адрес, который отдала сборка) и подписи — КЛЮЧИ локали. Текст
 *  не вшивается в картинку: подпись из локали работает и на английском. */
export interface ComicPanel {
  image: string;
  captions?: readonly string[];
}

/** `id главы (карты) → момент → панели по порядку`. */
export type ComicRegistry = Readonly<
  Record<string, Readonly<Partial<Record<ComicMoment, readonly ComicPanel[]>>>>
>;

/** Имя отметки в профиле: `pve-1:intro`. */
export const comicId = (chapter: string, moment: ComicMoment): string => `${chapter}:${moment}`;

/** Форма отметки — то, что профиль примет из хранилища (правленый мусор отбрасывается). */
export const COMIC_ID = /^[a-z0-9-]+:(intro|outro)$/;

/** Панели к показу — или `null`: комикса нет, он пуст или уже показан этому профилю. */
export function comicDue(
  progress: Pick<SectorZeroProgress, 'comicsSeen'>,
  registry: ComicRegistry,
  chapter: string,
  moment: ComicMoment,
): readonly ComicPanel[] | null {
  const panels = registry[chapter]?.[moment];
  if (!panels || panels.length === 0) return null;
  return progress.comicsSeen.includes(comicId(chapter, moment)) ? null : panels;
}

/** Отметить комикс показанным. Чистая и идемпотентная: повтор отдаёт тот же профиль. */
export function markComicSeen<P extends Pick<SectorZeroProgress, 'comicsSeen'>>(
  progress: P,
  id: string,
): P {
  return progress.comicsSeen.includes(id)
    ? progress
    : { ...progress, comicsSeen: [...progress.comicsSeen, id] };
}

/**
 * Что в реестре не так — пустой список значит «можно в сборку». Ловит то, что иначе
 * всплыло бы у игрока: комикс чужой главы (его никто не покажет), пустой комикс, панель
 * без картинки и подпись, которой нет в локалях (игрок увидел бы голый ключ).
 */
export function comicProblems(
  registry: ComicRegistry,
  chapters: readonly string[],
  hasKey: (key: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const [chapter, moments] of Object.entries(registry)) {
    if (!chapters.includes(chapter)) {
      out.push(`${chapter}: такой главы нет`);
      continue;
    }
    for (const [moment, panels] of Object.entries(moments)) {
      const at = `${chapter}:${moment}`;
      if (!(COMIC_MOMENTS as readonly string[]).includes(moment)) {
        out.push(`${at}: такого момента нет`);
        continue;
      }
      if (!panels || panels.length === 0) {
        out.push(`${at}: нет ни одной панели`);
        continue;
      }
      panels.forEach((panel, i) => {
        if (!panel.image) out.push(`${at} #${i + 1}: нет картинки`);
        for (const key of panel.captions ?? [])
          if (!hasKey(key)) out.push(`${at} #${i + 1}: подписи «${key}» нет в локалях`);
      });
    }
  }
  return out;
}
