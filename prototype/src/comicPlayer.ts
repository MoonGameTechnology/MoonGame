/**
 * Проигрыватель комикса главы (решение владельца 2026-09-24): панель за панелью поверх
 * всего экрана. КОГДА показывать, решает `decisions/chapterComics.ts`; ЧТО — реестр арта
 * (`comicArt.ts`); здесь только показ.
 *
 * Комикс никогда не запирает игру: «Пропустить» есть всегда, «назад» и Escape закрывают
 * его через общую лестницу слоёв (`BACK_LAYERS` в `main.ts`), а панель, чья картинка не
 * пришла, показывает подписи на тёмном фоне — или, если подписей нет, пролистывается сама.
 * Движение (наезд и проявление панели) — только CSS, при reduced motion его нет.
 */
import { t } from '../../localization/runtime';
import type { ComicPanel } from '../../decisions/chapterComics';

/** Чем кончается комикс: перед забегом — «В бой», после победы — «К итогам». */
export type ComicFinish = 'battle' | 'results';

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

  function close(): void {
    if (!done) return;
    const resolve = done;
    done = null;
    root.style.display = 'none';
    img.removeAttribute('src');
    resolve();
  }

  function show(i: number): void {
    at = i;
    const panel = panels[i]!;
    root.classList.remove('no-art', 'comic-in');
    img.src = panel.image;
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
          : 'sector-zero.comic.to-results',
    );
    // Перезапуск проявления: класс снимается и ставится в следующем кадре раскладки.
    void root.offsetWidth;
    root.classList.add('comic-in');
    const upcoming = panels[i + 1];
    if (upcoming) new Image().src = upcoming.image; // следующая панель — заранее
  }

  function advance(): void {
    if (!done) return;
    if (at + 1 < panels.length) show(at + 1);
    else close();
  }

  img.addEventListener('error', () => {
    if (!done || !img.getAttribute('src')) return;
    if (panels[at]?.captions?.length) root.classList.add('no-art');
    else advance();
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
      next.focus({ preventScroll: true });
      return closed;
    },
    isOpen: () => done !== null,
    skip: close,
  };
}
