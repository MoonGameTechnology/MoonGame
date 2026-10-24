/**
 * ONB-1 · Browser adapter for the spotlight engine (`./spotlight`).
 *
 * Turns a data-described chain into a live overlay over the HUD: four dim
 * panels frame the target (a cut-out built from solid rects — the element
 * stays visible and clickable through the gap), a ring outlines it, and a hint
 * bubble with a «шаг k из n» counter, «Далее/Понятно» and «Пропустить обучение»
 * floats beside it. A `requestAnimationFrame` loop calls `refresh()` so the
 * highlight tracks a panel that re-renders/scrolls and `state` steps advance on
 * their own. All chrome text goes through `t()` (RU/EN).
 *
 * The overlay sits ABOVE the HUD but BELOW critical modals (z-index 50; see the
 * `#spotlight` block in build.mjs). For `tap` steps the panels swallow clicks so
 * «Далее» is the only way on; for `action`/`state` steps the panels are
 * click-through so the player operates the real HUD to advance.
 */
import { t } from '../../localization/runtime';
import {
  SpotlightTour,
  frameRects,
  placeBubble,
  type Rect,
  type SpotlightHost,
  type SpotlightStep,
  type SpotlightView,
  type TourEnd,
} from './spotlight';
import { overlayMode, pressCue } from './tourGate';
import { esc } from './format';
import type { GestureAnim, MapGesture } from '../../decisions/mapGestures';

interface Overlay {
  root: HTMLElement;
  dim: HTMLElement[]; // 4 framing panels
  ring: HTMLElement;
  bubble: HTMLElement;
  arrow: HTMLElement;
  count: HTMLElement;
  copy: HTMLElement;
  /** Плитки жестов под строкой шага (UIX-8.1). */
  gest: HTMLElement;
  /** Жест нажатия над запертой целью (`tourGate.ts`, правило 6). */
  press: HTMLElement;
  next: HTMLButtonElement;
  skip: HTMLButtonElement;
  /** Этапное обучение (полигон, TRN-2): пропустить этап и свернуть подсказку. */
  skipStage: HTMLButtonElement;
  fold: HTMLButtonElement;
  reveal: HTMLButtonElement;
  /** Кнопка «Подсказка» — открывает свёрнутую подсказку. Живёт ВНЕ `root`: свёрнутый
   *  оверлей скрыт целиком, а кнопка должна оставаться на экране. */
  chip: HTMLButtonElement;
}

let overlay: Overlay | null = null;

/**
 * RESIL-2 · Один кадр живой подсветки: что делать, если `refresh()` бросил.
 *
 * `refresh()` ходит в чужой код — селекторы HUD, предикат `when()` шага, отрисовку, — и
 * до этого кирпича его исключение убивало не тур, а ЦИКЛ: `requestAnimationFrame`
 * стоял ПОСЛЕ падающего вызова, поэтому следующего кадра уже не было никогда. Оверлей при
 * этом оставался на экране — и `tap`-шаг продолжал глотать нажатия. Из трёх возможных
 * исходов (замереть, продолжать, закрыть) происходил худший.
 *
 * Выбран третий: **закрыть тур**. Обучение необязательно, а экран игроку нужен — держать
 * его в заложниках у сломавшейся подсказки нельзя. «Продолжать» означало бы кадр за
 * кадром ловить то же исключение (шестьдесят строк в консоли в секунду) при неверной
 * подсветке; «замереть» — тот же захваченный экран, только осознанно.
 *
 * Функция отдельная и экспортируется РАДИ ПРОВЕРЯЕМОСТИ: в репозитории нет jsdom, а
 * правило обязано держаться тестом, а не обещанием. Браузерного здесь ничего нет —
 * `requestAnimationFrame` приходит третьим аргументом.
 */
export function tourFrame(
  refresh: () => void,
  onBroken: (err: unknown) => void,
  again: () => void,
): void {
  try {
    refresh();
  } catch (err) {
    onBroken(err);
    return; // следующий кадр не планируется: тур закрывается, цикл кончился
  }
  again();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
}

/** Build the overlay DOM once and cache it (hidden until a tour runs). */
function ensureOverlay(): Overlay {
  if (overlay) return overlay;
  const root = el('div', 'sl-root');
  root.id = 'spotlight';
  const dim = [0, 1, 2, 3].map(() => el('div', 'sl-dim'));
  const ring = el('div', 'sl-ring');
  const bubble = el('div', 'sl-bubble');
  const arrow = el('div', 'sl-arrow');
  const count = el('div', 'sl-count');
  const copy = el('div', 'sl-copy');
  const gest = el('div', 'sl-gest');
  const press = el('div', 'sl-press');
  press.innerHTML = PRESS_SVG;
  const btns = el('div', 'sl-btns');
  const skip = el('button', 'sl-skip');
  skip.type = 'button';
  const next = el('button', 'sl-next');
  next.type = 'button';
  const skipStage = el('button', 'sl-skip-stage');
  skipStage.type = 'button';
  const fold = el('button', 'sl-fold');
  fold.type = 'button';
  const reveal = el('button', 'sl-reveal');
  reveal.type = 'button';
  btns.append(skip, skipStage, fold, reveal, next);
  bubble.append(arrow, count, copy, gest, btns);
  root.append(...dim, ring, press, bubble);
  const chip = el('button', 'sl-chip');
  chip.type = 'button';
  chip.id = 'spotlight-chip';
  chip.style.display = 'none';
  document.body.append(root, chip);
  overlay = { root, dim, ring, bubble, arrow, count, copy, gest, press, next, skip, skipStage, fold, reveal, chip };
  return overlay;
}

function place(node: HTMLElement, r: Rect): void {
  node.style.left = `${r.left}px`;
  node.style.top = `${r.top}px`;
  node.style.width = `${r.width}px`;
  node.style.height = `${r.height}px`;
}

const HIDDEN: Rect = { left: 0, top: 0, width: 0, height: 0 };

// --- Анимации жестов (UIX-8.1) ---------------------------------------------------------
// Рисунки — SVG без текста, движение — CSS (`#spotlight .sl-g` в build.mjs). Каждый рисунок
// и без движения показывает жест: при «уменьшить движение» анимация стоит на этом кадре.
// Курсор стоит на месте через `<g transform>`, а CSS двигает сам путь: CSS-`transform` на
// элементе заменил бы его атрибут, и курсор прыгнул бы в угол рисунка.
const CURSOR = 'M0 0v14l3.6-3.4 2.6 5.8 2.2-1-2.6-5.6H11z';
const GESTURE_SVG: Record<GestureAnim, string> = {
  pinch:
    '<path class="tr" d="M18 27l8-5M46 13l-8 5"/>' +
    '<circle class="f fa" cx="26" cy="22" r="5"/><circle class="f fb" cx="38" cy="18" r="5"/>',
  swipe: '<path class="tr" d="M16 20h32"/><circle class="f m" cx="16" cy="20" r="5"/>',
  'double-tap':
    '<circle class="rp r1" cx="32" cy="20" r="7"/><circle class="rp r2" cx="32" cy="20" r="7"/>' +
    '<circle class="f" cx="32" cy="20" r="5"/>',
  hold:
    '<circle class="ring" cx="32" cy="20" r="11" pathLength="100"/><circle class="f" cx="32" cy="20" r="5"/>',
  wheel:
    '<rect class="body" x="24" y="5" width="16" height="30" rx="8"/>' +
    '<path class="tr" d="M32 5v10"/><rect class="f wh" x="30.5" y="9" width="3" height="6" rx="1.5"/>',
  drag: `<path class="tr" d="M14 26h34"/><g transform="translate(14 14)"><path class="cur m" d="${CURSOR}"/></g>`,
  'double-click':
    '<circle class="rp r1" cx="30" cy="16" r="6"/><circle class="rp r2" cx="30" cy="16" r="6"/>' +
    `<path class="cur" transform="translate(30 16)" d="${CURSOR}"/>`,
  'shift-box':
    '<rect class="box" x="12" y="7" width="34" height="24" vector-effect="non-scaling-stroke"/>' +
    `<g transform="translate(12 7)"><path class="cur m" d="${CURSOR}"/></g>`,
};

/** Жест нажатия над целью: палец на касании, курсор на мыши (выбирает CSS по указателю). */
const PRESS_SVG =
  '<svg viewBox="0 0 48 48" aria-hidden="true">' +
  '<circle class="rp" cx="24" cy="24" r="10"/>' +
  '<circle class="finger" cx="24" cy="24" r="9"/>' +
  `<g transform="translate(24 24)"><path class="cur" d="${CURSOR}"/></g></svg>`;

function gestureTile(g: MapGesture): string {
  return (
    `<figure class="sl-g" data-anim="${g.anim}">` +
    `<svg viewBox="0 0 64 40" aria-hidden="true">${GESTURE_SVG[g.anim]}</svg>` +
    `<figcaption><b>${esc(t(g.name))}</b><span>${esc(t(g.does))}</span></figcaption></figure>`
  );
}

function paint(o: Overlay, view: SpotlightView | null): void {
  const dossierOpen = !view?.step.inDialog && document.getElementById('codex')?.classList.contains('show');
  // Map destinations must stay tappable even when a battle toast arrives above them.
  o.root.classList.toggle('sl-map', !!view && !view.collapsed && !dossierOpen && !!view.step.anchor);
  if (!view) {
    o.root.style.display = 'none';
    o.chip.style.display = 'none';
    return;
  }
  // Свёрнутая подсказка: оверлея нет вовсе (экран свободен), остаётся кнопка
  // «Подсказка». Шаг при этом засчитывается по делу — движок продолжает опрос.
  o.chip.style.display = view.collapsed ? 'block' : 'none';
  o.chip.textContent = t('onb.tour.reopen');
  if (view.collapsed) {
    o.root.style.display = 'none';
    return;
  }
  // The build/ship dossier (#codex) sits BELOW the spotlight (z46 < z50) so its own
  // "Построить здесь" button stays reachable through a tap-through step — but that
  // also means the tour's ring + bubble would otherwise float on top of the open
  // dossier, two windows visually stacked with neither fully readable (worse on a
  // small phone screen). Hide the spotlight's chrome for as long as the dossier is
  // up; the tour's step/state machine keeps polling underneath untouched, and the
  // very next frame after the dossier closes repaints normally.
  if (dossierOpen) {
    o.root.style.display = 'none';
    return;
  }
  o.root.style.display = 'block';
  o.root.dataset.step = view.step.id;
  const vp = { width: window.innerWidth, height: window.innerHeight };
  // Что можно нажимать на этом шаге — `tourGate.ts`: модально («Далее» — единственный
  // ход), заперто на цели (нажимается только подсвеченное окно) или свободно. Запертым
  // шаг остаётся только пока цель НАЙДЕНА: в кадре без прямоугольника запертый экран
  // запер бы игрока насмерть.
  const mode = overlayMode(view.step, !!view.target);
  o.root.classList.toggle('sl-passthrough', mode === 'free');
  o.root.classList.toggle('sl-gate', mode === 'gate');
  // Шаг «попробуй руками»: тело подсказки не должно ловить жест — без цели она стоит по
  // центру карты, то есть там же, где игрок крутит колесо (`tourGate.ts`, правило 5).
  o.root.classList.toggle('sl-hands', mode === 'free' && !!view.step.hands);

  if (view.target) {
    const frame = frameRects(view.target, vp, 6);
    o.dim.forEach((d, i) => {
      const r = frame[i];
      if (r) place(d, r); // frameRects yields exactly one rect per dim panel
    });
    o.ring.style.display = 'block';
    place(o.ring, {
      left: view.target.left - 6,
      top: view.target.top - 6,
      width: view.target.width + 12,
      height: view.target.height + 12,
    });
  } else {
    // No target: one full-screen dim (panel 0), the rest collapsed, no ring.
    const full = o.dim[0];
    if (full) place(full, { left: 0, top: 0, width: vp.width, height: vp.height });
    o.dim.slice(1).forEach((d) => place(d, HIDDEN));
    o.ring.style.display = 'none';
  }

  o.count.textContent = view.stage
    ? t('onb.tour.stage', {
        k: view.stage.index + 1,
        n: view.stage.count,
        title: t(view.step.stageTitle ?? `training.stage.${view.stage.id}`),
      })
    : t('onb.tour.step', { k: view.index + 1, n: view.count });
  o.copy.textContent = t(view.step.copy);
  // Плитки собираются заново только при смене набора: кадр перерисовывается 60 раз в
  // секунду, и пересборка каждый кадр начинала бы анимацию жеста с нуля.
  const gestures = view.step.gestures ?? [];
  const sig = gestures.map((g) => `${g.anim}:${t(g.name)}`).join(' ');
  if (o.gest.dataset.sig !== sig) {
    o.gest.dataset.sig = sig;
    o.gest.innerHTML = gestures.map(gestureTile).join('');
  }
  o.gest.style.display = gestures.length ? 'grid' : 'none';
  // Жест нажатия — над серединой запертой цели (`tourGate.ts`, правило 6).
  if (view.target && pressCue(mode)) {
    o.press.style.display = 'block';
    o.press.style.left = `${view.target.left + view.target.width / 2}px`;
    o.press.style.top = `${view.target.top + view.target.height / 2}px`;
  } else o.press.style.display = 'none';
  // Action/state steps have no «Далее» — the player advances by doing the thing.
  o.next.style.display = view.step.advance.on === 'tap' ? 'inline-block' : 'none';
  o.next.textContent = view.index + 1 >= view.count ? t('onb.tour.got-it') : t('onb.tour.next');
  o.skip.textContent = t('onb.tour.skip');
  // Пропустить этап и свернуть — только у этапного обучения (полигон): прежние туры
  // остаются такими, какими их знают игроки.
  o.skipStage.style.display = view.stage ? 'inline-block' : 'none';
  o.skipStage.textContent = t('onb.tour.skip-stage');
  o.fold.style.display = view.stage || view.step.collapsible ? 'inline-block' : 'none';
  o.fold.textContent = t('onb.tour.collapse');
  o.reveal.style.display = view.step.reveal ? 'inline-block' : 'none';
  o.reveal.textContent = t('onb.tour.reveal');
  o.reveal.onclick = view.step.reveal ?? null;

  // Measure the bubble, then position it (and its arrow) next to the target.
  const b = o.bubble.getBoundingClientRect();
  const size = { width: b.width || 280, height: b.height || 120 };
  // Canvas fleets orbit continuously: the ring follows them, but the controls must
  // stay still so the player can press Show/Hide/Skip.
  const pos =
    !!view.step.anchor ||
    topAnchored(view, mode) ||
    (!view.target && view.step.collapsible && mode === 'free')
      ? { left: Math.max(8, (vp.width - size.width) / 2), top: TOP_GAP, arrow: 'none' as const }
      : placeBubble(view.target, vp, size, view.step.placement ?? 'auto');
  o.bubble.style.left = `${pos.left}px`;
  o.bubble.style.top = `${pos.top}px`;
  o.arrow.dataset.dir = pos.arrow;
  o.arrow.style.display = pos.arrow === 'none' ? 'none' : 'block';
}

/** Отступ подсказки от верхнего края: ниже строки ресурсов. */
const TOP_GAP = 72;

/**
 * Подсказка этапного обучения без цели на шаге «сделай сам» встаёт к верхнему краю, а не
 * в центр (TRN-2, §14.4: «на телефоне подсказка не перекрывает свою цель»). Цель такого
 * шага — сама карта: игрок ведёт флот или берёт мир, а подсказка по центру закрыла бы
 * ровно то место, куда он смотрит. Прежние туры центрируются, как раньше.
 */
export function topAnchored(view: Pick<SpotlightView, 'target' | 'stage'>, mode: string): boolean {
  return !view.target && !!view.stage && mode === 'free';
}

/** A live handle on a running tour — feed it player actions, or stop it early. */
export interface RunningTour {
  /** Report a game action so an `action` step can advance. */
  notifyAction(type: string): void;
  /** Force-stop (as if «Пропустить»). */
  stop(): void;
  readonly active: boolean;
  readonly holdsClock: boolean;
  /** Этап текущего шага: по нему сценарий полигона (TRN-3) вводит силы противника. */
  readonly stage: string | undefined;
}

let current: SpotlightTour | null = null;

/** Is the target wholly on screen, inside the scrolling panel that holds it? */
function onScreen(node: Element, r: DOMRect): boolean {
  let top = 0;
  let bottom = innerHeight;
  for (let e = node.parentElement; e; e = e.parentElement) {
    const overflow = getComputedStyle(e).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') {
      const box = e.getBoundingClientRect();
      top = Math.max(top, box.top);
      bottom = Math.min(bottom, box.bottom);
      break;
    }
  }
  return r.top >= top && r.bottom <= bottom;
}

/** What a tour needs from the map beyond the HUD. */
export interface TourMap {
  /** Every frame a map point is marked (`step.anchor`): keep it pressable (ONB-14). */
  keepClear(mark: Rect): void;
}

/**
 * Start a data-described tour over the live HUD. Returns a handle whose
 * `notifyAction` the host wires to its action funnel. A new tour supersedes any
 * running one. `onEnd` fires with how it finished (completed / skipped / stopped).
 */
export function startTour(
  steps: readonly SpotlightStep[],
  onEnd?: TourEnd,
  map?: TourMap,
): RunningTour {
  const o = ensureOverlay();
  current?.skip(); // one tour at a time

  // A highlighted target can sit inside a scrollable panel (the world/fleet sheet)
  // below the fold — the player would have to guess a scroll is needed to even SEE
  // the ring. Scroll it into view once per step (not every frame, or a `behavior:
  // 'smooth'` scroll would never settle): `scrollIntoView` only actually moves a
  // genuinely scrollable ancestor (the app's own body/window never scroll — fixed
  // single-viewport layout), so this is a no-op for fixed HUD targets like #cmdbar.
  // A panel that is still opening or re-rendering can cut that smooth scroll short (the
  // fleet console right after a ship is picked): for the first seconds of a step a
  // target left outside its panel is scrolled again, at once. Later the player may
  // scroll the panel freely.
  let scrolledFor: string | null = null;
  let scrollStart = 0;
  let scrollCheck = 0;
  const host: SpotlightHost = {
    locate: (sel) => {
      const node = Array.from(document.querySelectorAll(sel)).find((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (!node) return null;
      const r = node.getBoundingClientRect();
      // A detached / display:none node reports a zero box — treat as absent.
      if (r.width === 0 && r.height === 0) return null;
      const now = performance.now();
      if (scrolledFor !== sel) {
        scrolledFor = sel;
        scrollStart = scrollCheck = now;
        node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (now - scrollStart < 3000 && now - scrollCheck > 500) {
        scrollCheck = now;
        if (!onScreen(node, r)) node.scrollIntoView({ block: 'nearest' });
      }
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    },
    render: (view) => {
      paint(o, view);
      // Folded, or hidden over an open dossier: nothing is marked on screen then.
      if (view?.target && view.step.anchor && o.root.style.display === 'block')
        map?.keepClear(view.target);
    },
  };

  let running = true;
  const tour = new SpotlightTour(steps, host, (result) => {
    running = false;
    if (current === tour) current = null;
    onEnd?.(result);
  });
  current = tour;

  o.next.onclick = () => tour.tap();
  o.skip.onclick = () => tour.skip();
  o.skipStage.onclick = () => tour.skipStage();
  o.fold.onclick = () => tour.collapse();
  o.chip.onclick = () => tour.reopen();

  /** Снять тур, что бы ни сломалось, и главное — УБРАТЬ оверлей с экрана (RESIL-2). */
  const abort = (err: unknown): void => {
    console.error('[spotlight] кадр подсветки упал — закрываю тур:', err);
    try {
      tour.skip(); // штатный путь: позовёт `onEnd` и снимет `running`
    } catch (stubborn) {
      console.error('[spotlight] закрыть тур штатно тоже не вышло:', stubborn);
    } finally {
      running = false;
      if (current === tour) current = null;
      o.root.style.display = 'none'; // экран отпущен даже если движок в непонятном виде
    }
  };

  const frame = (): void => {
    if (!running) return;
    tourFrame(
      () => tour.refresh(),
      abort,
      () => requestAnimationFrame(frame),
    );
  };
  tour.start();
  if (running) requestAnimationFrame(frame);

  return {
    notifyAction: (type) => tour.notifyAction(type),
    stop: () => tour.skip(),
    get active() {
      return running;
    },
    get holdsClock() {
      return tour.holdsClock;
    },
    get stage() {
      return tour.stage;
    },
  };
}
