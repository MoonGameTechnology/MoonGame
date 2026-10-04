/**
 * Комиксы глав Sector Zero (решение владельца 2026-09-24): короткий комикс, когда игрок
 * ПЕРВЫЙ раз начинает главу (`intro`), и когда первый раз её проходит (`outro`). Между ними —
 * страницы по событиям главы: ключевая задача (`task`) и сюжетные сцены главы VI (§8.9 каталога
 * карт, PVR-8.6). Арт делает владелец отдельно; здесь — только правило «когда показывать» и
 * проверка реестра, общие обоим клиентам. Картинки подключает хозяин (`prototype/src/comicArt.ts`).
 *
 * Показ — ОДИН раз на профиль, отметка живёт в профиле ({@link SectorZeroProgress.comicsSeen})
 * и переезжает с ним через облако: на новом устройстве тот же комикс второй раз не
 * всплывёт. Нет арта — нет и комикса: пустой реестр значит, что игра идёт как раньше.
 */
import type { SectorZeroProgress } from './sectorZeroProgress';
import type { GameState, PlayerId } from '../packages/shared-core/src/index';

/** Когда комикс показывается: перед первым забегом главы, после первой победы в ней и по
 *  событиям забега ({@link TRIGGERED_MOMENTS}). `echo`/`echo-record` — знакомство с Эхо
 *  главы I, его зовёт хозяин по {@link echoComicMoment}. */
export const COMIC_MOMENTS = [
  'intro',
  'outro',
  'task',
  'echo',
  'echo-record',
  'refuge',
  'rescued',
] as const;
export type ComicMoment = (typeof COMIC_MOMENTS)[number];

/**
 * Моменты, которые играют, когда в забеге впервые засчитан их триггер — задача главы или шаг
 * её главной цепочки (`decisions/chapterChain.ts`); какой, говорит таблица хозяина
 * ({@link ComicTriggers}). `task` — ключевая задача главы; `refuge` и `rescued` — сцены главы VI:
 * «Последний приют» по эпизоду доков и «Мы пришли за людьми» по основной эвакуации (§8.9).
 */
export const TRIGGERED_MOMENTS = ['task', 'refuge', 'rescued'] as const;
export type TriggeredMoment = (typeof TRIGGERED_MOMENTS)[number];

/** Одна страница: картинка и необязательные подписи — КЛЮЧИ локали. У утверждённых
 *  страниц владельца русские реплики нарисованы внутри картинки. */
export interface ComicPanel {
  image: string;
  /** Английская версия страницы с нарисованными репликами, если уже подготовлена. */
  imageEn?: string;
  captions?: readonly string[];
}

/** `id главы (карты) → момент → панели по порядку`. */
export type ComicRegistry = Readonly<
  Record<string, Readonly<Partial<Record<ComicMoment, readonly ComicPanel[]>>>>
>;

/** `id главы → момент → id задачи или шага цепочки`, после которого этот момент играет. */
export type ComicTriggers = Readonly<
  Record<string, Readonly<Partial<Record<TriggeredMoment, string>>>>
>;

/** Имя отметки в профиле: `pve-1:intro`. */
export const comicId = (chapter: string, moment: ComicMoment): string =>
  `${chapter}:${moment === 'echo-record' ? 'echo' : moment}`;

/** Форма отметки — то, что профиль примет из хранилища (правленый мусор отбрасывается).
 *  Моменты — из {@link COMIC_MOMENTS}: новый момент не потеряет отметку при загрузке. */
export const COMIC_ID = new RegExp(
  `^[a-z0-9-]+:(${COMIC_MOMENTS.filter((m) => m !== 'echo-record').join('|')})$`,
);

/** Эхо (§ «Кто это?»): только после спасения Учёного и прибытия живого корабля.
 *  Уже освобождённая колония показывает запись; старое выполнение не сбрасывается.
 *  Обе версии делят одну отметку просмотра. Вызывать только для главы I. */
export function echoComicMoment(
  state: GameState,
  me: PlayerId,
  scientistAvailable: boolean,
  echoCompleted: boolean,
): 'echo' | 'echo-record' | null {
  if (!scientistAvailable || !state.planets.home_b) return null;
  if (echoCompleted || state.planets.home_b.owner === me) return 'echo-record';
  const arrived = Object.values(state.fleets).some(
    (f) =>
      f.owner === me && f.location === 'home_b' && !f.movement && f.units.some((u) => u.count > 0),
  );
  return arrived ? 'echo' : null;
}

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

/** Моменты по событиям к показу: триггер засчитан (есть в `complete`), а комикс есть и ещё
 *  не показан. Порядок — {@link TRIGGERED_MOMENTS}: сцены одного кадра идут по сюжету. */
export function comicsTriggered(
  progress: Pick<SectorZeroProgress, 'comicsSeen'>,
  registry: ComicRegistry,
  triggers: ComicTriggers,
  chapter: string,
  complete: readonly string[],
): TriggeredMoment[] {
  return TRIGGERED_MOMENTS.filter((moment) => {
    const trigger = triggers[chapter]?.[moment];
    return (
      trigger !== undefined &&
      complete.includes(trigger) &&
      comicDue(progress, registry, chapter, moment) !== null
    );
  });
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
