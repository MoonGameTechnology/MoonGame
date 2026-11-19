/**
 * Игровой выпадающий список вместо системного (заказ владельца 2026-11-19). Нативный
 * `<select>` остаётся в разметке и хранит выбор: его `change` слушают те же обработчики, что и
 * раньше, а клавиатура (Tab, стрелки) работает с ним как прежде. Нажатия по полю он больше не
 * принимает (`pointer-events: none`, `16-game-select.css`) — иначе телефон открыл бы окно
 * Android, а ПК — окно системы. Нажатие ловит один слушатель на документе и открывает список
 * игры у самого поля; место — `decisions/selectPopup.ts`.
 *
 * Поле, которому нужен системный список, помечается `data-native-select`.
 */
import { selectPopupPlacement } from '../../decisions/selectPopup';

const SKIP = '[data-native-select]';

/** Поле под точкой нажатия: живое, видимое, не отключённое. */
function selectAt(x: number, y: number): HTMLSelectElement | null {
  for (const select of Array.from(document.querySelectorAll<HTMLSelectElement>('select'))) {
    if (select.disabled || select.matches(SKIP)) continue;
    const r = select.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return select;
  }
  return null;
}

/** Повесить игровой список на все `<select>` документа. Зовётся один раз на старте. */
export function initGameSelect(): void {
  let open: { select: HTMLSelectElement; scrim: HTMLElement; list: HTMLElement; watch: number } | null =
    null;

  const close = (refocus: boolean): void => {
    if (!open) return;
    const { select, scrim, list, watch } = open;
    open = null;
    cancelAnimationFrame(watch);
    select.removeAttribute('data-gsel-open');
    scrim.remove();
    list.remove();
    if (refocus && select.isConnected) select.focus({ preventScroll: true });
  };

  const choose = (select: HTMLSelectElement, index: number): void => {
    close(true);
    if (select.selectedIndex === index) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const show = (select: HTMLSelectElement): void => {
    close(false);
    const options = Array.from(select.options);
    const scrim = document.createElement('div');
    scrim.className = 'gsel-scrim';
    const list = document.createElement('div');
    list.className = 'gsel-pop';
    list.setAttribute('role', 'listbox');
    const label = select.getAttribute('aria-label') ?? select.closest('label')?.textContent?.trim();
    if (label) list.setAttribute('aria-label', label);
    options.forEach((option, index) => {
      if (option.hidden) return;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'gsel-opt';
      row.setAttribute('role', 'option');
      const on = index === select.selectedIndex;
      row.setAttribute('aria-selected', String(on));
      row.classList.toggle('on', on);
      row.disabled = option.disabled;
      row.textContent = option.textContent ?? '';
      row.addEventListener('click', () => choose(select, index));
      list.appendChild(row);
    });
    const place = selectPopupPlacement(
      select.getBoundingClientRect(),
      list.childElementCount,
      window.innerWidth,
      window.innerHeight,
    );
    list.style.left = `${place.left}px`;
    list.style.width = `${place.width}px`;
    list.style.maxHeight = `${place.maxHeight}px`;
    if (place.top !== undefined) list.style.top = `${place.top}px`;
    if (place.bottom !== undefined) list.style.bottom = `${place.bottom}px`;
    // Касание мимо закрывает список и дальше не идёт: под ним окно игры, и то же касание
    // нажало бы его кнопку.
    scrim.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      close(false);
    });
    document.body.append(scrim, list);
    // Окно с полем не перерисовывается, пока список открыт (`productionRefresh.ts`).
    select.setAttribute('data-gsel-open', '');
    const current = list.querySelector<HTMLButtonElement>('.gsel-opt.on') ?? list.querySelector('button');
    current?.focus({ preventScroll: true });
    current?.scrollIntoView({ block: 'nearest' });
    // Окно с полем закрыли или перерисовали (Back, смена мира) — список уходит вместе с ним.
    const follow = (): void => {
      if (!open) return;
      const r = select.getBoundingClientRect();
      if (!select.isConnected || r.width <= 0) return close(false);
      open.watch = requestAnimationFrame(follow);
    };
    open = { select, scrim, list, watch: requestAnimationFrame(follow) };
  };

  // `click`, а не `pointerdown`: палец, который начал прокрутку окна с поля, списка не открывает.
  document.addEventListener(
    'click',
    (ev) => {
      if (open || ev.button > 0) return;
      const select = selectAt(ev.clientX, ev.clientY);
      if (!select) return;
      ev.preventDefault();
      ev.stopPropagation();
      show(select);
    },
    true,
  );

  // Escape и стрелки — внутри открытого списка; Escape не доходит до окон под ним.
  document.addEventListener(
    'keydown',
    (ev) => {
      if (!open) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        close(true);
        return;
      }
      if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      const rows = Array.from(open.list.querySelectorAll<HTMLButtonElement>('.gsel-opt:not(:disabled)'));
      const at = rows.indexOf(document.activeElement as HTMLButtonElement);
      const next = rows[Math.min(rows.length - 1, Math.max(0, at + (ev.key === 'ArrowDown' ? 1 : -1)))];
      ev.preventDefault();
      next?.focus();
    },
    true,
  );
  window.addEventListener('resize', () => close(false));
}
