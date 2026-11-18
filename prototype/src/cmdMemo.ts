/**
 * Памятка плитки приказа на телефоне (заказ владельца 2026-11-17). В листе телефона ряд
 * команд — плитки с одной иконкой; удержание плитки показывает окно с названием приказа,
 * его описанием и, у серой плитки, причиной, почему сейчас нельзя. Отпускание закрывает
 * окно, и приказ после памятки НЕ выполняется: удержание — это вопрос «что это», а не
 * нажатие. Правила места и времени — `decisions/cmdMemo.ts`.
 *
 * Окно живёт на `body`, а не в ряду: ряд перерисовывает свою разметку, как только она
 * поменялась (`cmdBar.ts`), и стёр бы окно посреди удержания.
 */
import { t } from '../../localization/runtime';
import { CMD_MEMO_HOLD_MS, CMD_MEMO_SLOP_PX, cmdMemoPlacement } from '../../decisions/cmdMemo';

/** Плитки — в листе телефона вне режима черновика приказа: там у кнопок свои подписи. */
function tileOf(target: EventTarget | null): HTMLButtonElement | null {
  const el = target instanceof Element ? target.closest('button[data-cmd]') : null;
  if (!(el instanceof HTMLButtonElement) || !el.dataset.label) return null;
  return el.closest('body.mobile-ui #mobile-sheet:not(.order-mode) #cmdbar') ? el : null;
}

/** Повесить удержание на ряд команд `bar`. */
export function initCmdMemo(bar: HTMLElement): void {
  // Окно рождается при первом удержании: на ПК и до первой памятки его нет вовсе.
  let memoEl: HTMLDivElement | null = null;
  const memoBox = (): HTMLDivElement => {
    if (!memoEl) {
      memoEl = document.createElement('div');
      memoEl.className = 'cmd-memo';
      memoEl.setAttribute('role', 'status');
      memoEl.hidden = true;
      document.body.appendChild(memoEl);
    }
    return memoEl;
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  let held: HTMLButtonElement | null = null;
  let start = { x: 0, y: 0 };
  let swallowClick = false;

  const hide = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    held = null;
    if (memoEl) memoEl.hidden = true;
  };

  const show = (tile: HTMLButtonElement): void => {
    if (!tile.isConnected) return hide();
    const why = tile.getAttribute('aria-disabled') === 'true' ? tile.dataset.why : undefined;
    const memo = memoBox();
    memo.replaceChildren();
    const title = document.createElement('b');
    title.textContent = tile.dataset.label ?? '';
    memo.appendChild(title);
    if (tile.dataset.hint) {
      const text = document.createElement('span');
      text.textContent = tile.dataset.hint;
      memo.appendChild(text);
    }
    if (why) {
      const reason = document.createElement('span');
      reason.className = 'cmd-memo-why';
      reason.textContent = t(why);
      memo.appendChild(reason);
    }
    const place = cmdMemoPlacement(tile.getBoundingClientRect(), bar.getBoundingClientRect(), window.innerWidth, window.innerHeight);
    memo.style.left = `${place.left}px`;
    memo.style.width = `${place.width}px`;
    memo.style.bottom = `${place.bottom}px`;
    memo.style.setProperty('--arrow-x', `${place.arrowX}px`);
    memo.hidden = false;
    swallowClick = true;
  };

  bar.addEventListener('pointerdown', (ev) => {
    hide();
    const tile = tileOf(ev.target);
    if (!tile || ev.button > 0) return;
    held = tile;
    start = { x: ev.clientX, y: ev.clientY };
    swallowClick = false;
    timer = setTimeout(() => {
      if (held === tile) show(tile);
    }, CMD_MEMO_HOLD_MS);
  });
  bar.addEventListener('pointermove', (ev) => {
    if (!held) return;
    const moved = Math.hypot(ev.clientX - start.x, ev.clientY - start.y);
    if (moved > CMD_MEMO_SLOP_PX) hide();
  });
  // Отпускание закрывает окно; клик, что придёт следом, погасит перехват ниже, если окно
  // успело показаться (`swallowClick`).
  bar.addEventListener('pointerup', hide);
  bar.addEventListener('pointercancel', () => {
    swallowClick = false;
    hide();
  });
  // Приказ после памятки не выполняется: клик гасится до делегата ряда.
  bar.addEventListener(
    'click',
    (ev) => {
      if (!swallowClick) return;
      swallowClick = false;
      ev.stopImmediatePropagation();
      ev.preventDefault();
    },
    true,
  );
  // Системное меню долгого нажатия (копировать, выделить) на плитке не нужно.
  bar.addEventListener('contextmenu', (ev) => {
    if (tileOf(ev.target)) ev.preventDefault();
  });
}
