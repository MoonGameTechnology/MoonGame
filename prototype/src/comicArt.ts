/**
 * Арт комиксов глав Sector Zero (решение владельца 2026-09-24): рисует владелец, здесь
 * картинки только подключаются. Порядок — `prototype/art/comics/README.md`:
 *
 *   1. панели лежат в `prototype/art/comics/<глава>/<момент>-<n>.webp`
 *      (`pve-1/intro-1.webp`, …; момент — `intro` или `outro`);
 *   2. каждая импортируется здесь и вписывается в `CHAPTER_COMICS` по порядку;
 *   3. подписи — КЛЮЧИ `sector-zero.comic.<глава>.<момент>.<n>` в `/localization` (ru + en).
 *
 * Сборка раскладывает картинки сама: в архиве площадки — отдельными файлами в `assets/`
 * (игрок качает их, только когда комикс показывают), в однофайловых сборках — внутрь
 * HTML, как рендеры кораблей (`shipArt.ts`). Реестр и папку сверяет `comicArt.test.ts`:
 * чужая глава, панель без картинки, подпись без перевода и файл, который лежит, но не
 * подключён, роняют гейт, а не доезжают до игрока.
 *
 * Пусто — значит комиксов пока нет, и игра идёт как раньше.
 */
import type { ComicRegistry, ComicTaskTriggers } from '../../decisions/chapterComics';
import training1Intro1 from '../art/comics/training-1/intro-1.webp';
import pve1Intro1 from '../art/comics/pve-1/intro-1.webp';
import pve1Task1 from '../art/comics/pve-1/task-1.webp';

// Страницы владельца (`art/comics/sector-zero/`, PR #1341): текст нарисован на самой
// странице по-русски, поэтому подписей из локали у них нет.
export const CHAPTER_COMICS: ComicRegistry = {
  // «Протокол допуска» — перед учебным полигоном.
  'training-1': { intro: [{ image: training1Intro1 }] },
  'pve-1': {
    // Инструктаж — перед первой экспедицией.
    intro: [{ image: pve1Intro1 }],
    // Отлёт с учёным — когда задача спасения впервые выполнена.
    task: [{ image: pve1Task1 }],
  },
};

/** После какой задачи главы играет её комикс `task`. Триггером может быть и шаг главной
 *  цепочки главы (`decisions/chapterChain.ts`): у главы IV это встреча с союзником (§6.8). */
export const COMIC_TASK_TRIGGERS: ComicTaskTriggers = {
  'pve-1': 'mission.rescue-scientist',
  'pve-4': 'chain.contact',
};
