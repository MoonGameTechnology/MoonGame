/**
 * Кнопки удержания в DOM: подтверждение необратимого и автоповтор «±».
 *
 * Правила (что делает удержание, когда клик съедается, как разгоняется повтор) — в
 * `decisions/holdAction.ts`; общая жизнь нажатия — в `decisions/holdPress.ts`. Здесь
 * только браузерная проводка: таймеры, указатель, клавиши и полоса заполнения.
 *
 * Подтверждение: кнопка несёт `data-hold="<ключ>"` и разметку `holdConfirmHtml`. Ключ
 * уникален в своём окне: окно может перерисоваться посреди удержания, и полоса
 * переезжает на новую кнопку с тем же ключом.
 *
 * Повтор: кнопка несёт `data-repeat`. Повтор жмёт кнопку заново, находя её по тем же
 * `data-*`, потому что окно перерисовывается после каждого шага.
 */
import { t } from '../../localization/runtime';
import {
  HOLD_CONFIRM_MS,
  holdConfirmClick,
  repeatDelay,
} from '../../decisions/holdAction';
import {
  IDLE,
  mature,
  moveAway,
  press,
  release,
  type HoldState,
} from '../../decisions/holdPress';
import { esc } from './format';
import { movedTooFar } from './tipPlacement';

/** Внутренность кнопки подтверждения: подпись и вопрос с подсказкой «держите». */
export function holdConfirmHtml(label: string, ask: string): string {
  return (
    `<span class="hold-label">${esc(label)}</span>` +
    `<span class="hold-ask">${esc(ask)}<small>${esc(t('hint.hold-confirm', { n: HOLD_CONFIRM_MS / 1000 }))}</small></span>`
  );
}

/**
 * Что окно делает с кнопкой подтверждения. Короткий тап и клик без нажатия окно
 * разбирает своим обработчиком, как раньше: первый показывает вопрос, второй по
 * показанному вопросу исполняет. Удержание только добавляет третий путь, а короткий тап
 * по показанному вопросу съедает (`holdConfirmClick`).
 */
export interface HoldConfirmHooks {
  /** Вопрос уже показан. */
  armed(btn: HTMLElement): boolean;
  /** Исполнить. Кнопка может быть уже снята перерисовкой: её `data-*` читаются. */
  confirm(btn: HTMLElement): void;
}

const CONFIRM = '[data-hold]';
const REPEAT = '[data-repeat]';

function holdKey(btn: HTMLElement): string {
  return btn.dataset.hold ?? '';
}

function usable(el: HTMLElement | null): el is HTMLElement {
  return !!el && !(el as HTMLButtonElement).disabled;
}

/** Подтверждение удержанием на всех `[data-hold]` внутри `root`. */
export function bindHoldConfirm(root: HTMLElement, hooks: HoldConfirmHooks): void {
  if (typeof window === 'undefined') return; // тесты окон без браузера
  let st: HoldState = IDLE;
  let fromPress = false;
  let btn: HTMLElement | null = null;
  let startedAt = 0;
  let timer: number | null = null;
  let watch: MutationObserver | null = null;

  const paint = (el: HTMLElement): void => {
    el.style.setProperty('--hold-ms', `${HOLD_CONFIRM_MS}ms`);
    el.style.setProperty('--hold-at', `${Math.round(startedAt - performance.now())}ms`);
    el.classList.add('holding');
  };
  const unpaint = (): void => {
    btn?.classList.remove('holding');
    const key = btn ? holdKey(btn) : '';
    if (key) root.querySelector<HTMLElement>(`[data-hold="${CSS.escape(key)}"]`)?.classList.remove('holding');
  };
  const stop = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    watch?.disconnect();
    watch = null;
    unpaint();
  };
  const start = (el: HTMLElement, at: { x: number; y: number }): void => {
    stop();
    st = press(at);
    fromPress = true;
    btn = el;
    startedAt = performance.now();
    paint(el);
    // Окно перерисовалось посреди удержания: полоса переезжает на новую кнопку.
    watch = new MutationObserver(() => {
      if (!btn || btn.isConnected) return;
      const again = root.querySelector<HTMLElement>(`[data-hold="${CSS.escape(holdKey(btn))}"]`);
      if (again) {
        btn = again;
        paint(again);
      }
    });
    watch.observe(root, { childList: true, subtree: true });
    timer = window.setTimeout(() => {
      timer = null;
      st = mature(st);
      const done = btn;
      stop();
      if (st.matured && done) hooks.confirm(done);
    }, HOLD_CONFIRM_MS);
  };
  const end = (): void => {
    if (!fromPress) return;
    st = release(st);
    stop();
    // Завершающий клик приходит в той же задаче, что и отпускание; дальше право его
    // съесть пропадает, иначе пропал бы следующий честный тап.
    window.setTimeout(() => {
      st = IDLE;
      fromPress = false;
    }, 0);
  };

  root.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const el = (ev.target as HTMLElement).closest<HTMLElement>(CONFIRM);
    if (usable(el) && root.contains(el)) start(el, { x: ev.clientX, y: ev.clientY });
  });
  window.addEventListener('pointermove', (ev) => {
    if (timer === null || !st.from) return;
    if (movedTooFar(st.from, { x: ev.clientX, y: ev.clientY })) {
      st = moveAway(st);
      stop();
    }
  });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  root.addEventListener('keydown', (ev) => {
    if ((ev.key !== 'Enter' && ev.key !== ' ') || ev.repeat) return;
    const el = (ev.target as HTMLElement).closest<HTMLElement>(CONFIRM);
    if (!usable(el)) return;
    start(el, { x: 0, y: 0 });
    st = { ...st, from: null }; // клавиатура: указатель не снимает удержание
  });
  root.addEventListener('keyup', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') end();
  });
  root.addEventListener(
    'click',
    (ev) => {
      const el = (ev.target as HTMLElement).closest<HTMLElement>(CONFIRM);
      if (!el) return;
      const armed = hooks.armed(el);
      const outcome = holdConfirmClick({ matured: st.matured, fromPress, armed });
      st = { ...st, matured: false };
      // «Показать вопрос» и «исполнить по второму клику» делает обработчик окна; здесь
      // съедается то, что ему не положено: хвост удержания и короткий тап по вопросу.
      if (outcome === 'eat' || (outcome === 'arm' && armed)) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
    },
    true, // раньше обработчика окна
  );
}

/** Та же кнопка после перерисовки: совпадают все `data-*`. */
function sameButton(root: ParentNode, was: HTMLElement): HTMLElement | null {
  const attrs = Array.from(was.attributes).filter((a) => a.name.startsWith('data-'));
  return (
    Array.from(root.querySelectorAll<HTMLElement>(REPEAT)).find((el) =>
      attrs.every((a) => el.getAttribute(a.name) === a.value),
    ) ?? null
  );
}

let repeatInstalled = false;

/** Автоповтор на всех `[data-repeat]` документа; второй вызов ничего не делает. */
function installHoldRepeat(): void {
  if (repeatInstalled || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  repeatInstalled = true;
  let st: HoldState = IDLE;
  let btn: HTMLElement | null = null;
  let timer: number | null = null;
  let steps = 0;
  let synthetic = false;

  const stop = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  const tick = (): void => {
    timer = null;
    if (!btn) return;
    const el = btn.isConnected ? btn : sameButton(document, btn);
    if (!usable(el)) return;
    btn = el;
    st = mature(st);
    if (!st.matured && steps === 0) return;
    steps++;
    synthetic = true;
    try {
      el.click();
    } finally {
      synthetic = false;
    }
    timer = window.setTimeout(tick, repeatDelay(steps + 1));
  };
  const end = (): void => {
    if (!btn) return;
    st = release(st);
    stop();
    btn = null;
    window.setTimeout(() => {
      st = IDLE;
    }, 0);
  };

  document.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const el = (ev.target as HTMLElement).closest<HTMLElement>(REPEAT);
    if (!usable(el)) return;
    stop();
    st = press({ x: ev.clientX, y: ev.clientY });
    btn = el;
    steps = 0;
    timer = window.setTimeout(tick, repeatDelay(1));
  });
  document.addEventListener('pointermove', (ev) => {
    if (!btn || !st.from) return;
    if (movedTooFar(st.from, { x: ev.clientX, y: ev.clientY })) {
      st = moveAway(st);
      stop();
    }
  });
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  document.addEventListener(
    'click',
    (ev) => {
      if (synthetic) return;
      if (!(ev.target as HTMLElement).closest?.(REPEAT)) return;
      if (!st.matured) return;
      // Повтор уже прошёл шагами: отпускание не добавляет лишний.
      st = { ...st, matured: false };
      ev.preventDefault();
      ev.stopImmediatePropagation();
    },
    true,
  );
}

// Повтор делегирован документу, поэтому ставится при загрузке модуля, а не окном: «±»
// деления флота, десанта и заказа кораблей живут в разных окнах, и ни одно не должно
// помнить, что повтор надо включить.
installHoldRepeat();
