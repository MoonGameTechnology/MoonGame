/**
 * Проигрыватель комикса главы (решение владельца 2026-09-24): панель за панелью поверх
 * всего экрана. КОГДА показывать, решает `decisions/chapterComics.ts`; ЧТО — реестр арта
 * (`comicArt.ts`); здесь только показ.
 *
 * Комикс никогда не запирает игру: «Пропустить» есть всегда, «назад» и Escape закрывают
 * его через общую лестницу слоёв (`BACK_LAYERS` в `main.ts`), а панель, чья картинка не
 * пришла, показывает подписи на тёмном фоне — или, если подписей нет, пролистывается сама.
 * Движение (наезд и проявление панели) — только CSS, при reduced motion его нет.
 *
 * Каждая страница висит {@link COMIC_HOLD_MS} (решение владельца 2026-09-27): кнопки
 * «Дальше» и «Пропустить» появляются только потом, а нажатие по панели до этого ничего не
 * листает — страницу успевают прочитать. «Назад»/Escape закрывают комикс и во время паузы.
 */
import { LOCALE, t } from '../../localization/runtime';
import type { ComicPanel } from '../../decisions/chapterComics';

/** Сколько страница держится до появления кнопок. */
export const COMIC_HOLD_MS = 5000;

/** Чем кончается комикс: перед забегом — «В бой», после победы — «К итогам», посреди
 *  забега — «Продолжить». */
export type ComicFinish = 'battle' | 'results' | 'resume';

export interface ComicPlayer {
  /** Показать панели; промис разрешается, когда игрок комикс закрыл (досмотрел или
   *  пропустил). Пустой список или уже открытый комикс — разрешается сразу. */
  play(panels: readonly ComicPanel[], finish: ComicFinish): Promise<void>;
  isOpen(): boolean;
  /** Закрыть — то же, что «Пропустить». */
  skip(): void;
}

/** Узлы оверлея `#comic` (разметка — `build.mjs`); хост отдаёт их сам, как соседним экранам. */
export interface ComicNodes {
  root: HTMLElement;
  img: HTMLImageElement;
  caption: HTMLElement;
  count: HTMLElement;
  next: HTMLButtonElement;
  skip: HTMLButtonElement;
}

export function initComicPlayer({
  root,
  img,
  caption,
  count,
  next,
  skip,
}: ComicNodes): ComicPlayer {
  let panels: readonly ComicPanel[] = [];
  let finish: ComicFinish = 'results';
  let at = 0;
  let done: (() => void) | null = null;
  let holding = false;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;

  function hold(on: boolean): void {
    holding = on;
    next.hidden = on;
    skip.hidden = on;
  }

  function close(): void {
    if (!done) return;
    const resolve = done;
    done = null;
    clearTimeout(holdTimer);
    hold(false);
    root.style.display = 'none';
    img.removeAttribute('src');
    resolve();
  }

  function show(i: number): void {
    at = i;
    const panel = panels[i]!;
    root.classList.remove('no-art', 'comic-in');
    img.src = LOCALE === 'en' && panel.imageEn ? panel.imageEn : panel.image;
    const lines = (panel.captions ?? []).map((key) => {
      const p = document.createElement('p');
      p.textContent = t(key);
      return p;
    });
    caption.replaceChildren(...lines);
    caption.hidden = lines.length === 0;
    count.textContent = `${i + 1} / ${panels.length}`;
    const last = i === panels.length - 1;
    next.textContent = t(
      !last
        ? 'sector-zero.comic.next'
        : finish === 'battle'
          ? 'sector-zero.comic.to-battle'
          : finish === 'results'
            ? 'sector-zero.comic.to-results'
            : 'sector-zero.comic.resume',
    );
    // Перезапуск проявления: класс снимается и ставится в следующем кадре раскладки.
    void root.offsetWidth;
    root.classList.add('comic-in');
    hold(true);
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      hold(false);
      next.focus({ preventScroll: true });
    }, COMIC_HOLD_MS);
    const upcoming = panels[i + 1];
    if (upcoming)
      new Image().src = LOCALE === 'en' && upcoming.imageEn ? upcoming.imageEn : upcoming.image;
  }

  function advance(): void {
    if (!done || holding) return;
    if (at + 1 < panels.length) show(at + 1);
    else close();
  }

  img.addEventListener('error', () => {
    if (!done || !img.getAttribute('src')) return;
    if (panels[at]?.captions?.length) root.classList.add('no-art');
    else {
      hold(false); // пустую панель без подписей держать незачем
      advance();
    }
  });
  next.addEventListener('click', advance);
  skip.addEventListener('click', close);
  // Нажатие по самой панели листает дальше — как в любой читалке комиксов.
  root.addEventListener('click', (ev) => {
    if (!(ev.target as Element).closest('button')) advance();
  });
  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowRight') advance();
  });

  return {
    play(list, how) {
      if (done || list.length === 0) return Promise.resolve();
      panels = list;
      finish = how;
      const closed = new Promise<void>((resolve) => (done = resolve));
      root.style.display = 'flex';
      show(0);
      root.focus({ preventScroll: true });
      return closed;
    },
    isOpen: () => done !== null,
    skip: close,
  };
}
