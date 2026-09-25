/**
 * Кнопка языка со списком (заказ владельца 2026-09-25). Что показать и когда менять язык —
 * `decisions/localeMenu.ts`; здесь только DOM: кнопка раскрывает список под собой,
 * закрывает его тап мимо, Escape и сам выбор.
 */
import { localeChanges, localeOptions } from '../../decisions/localeMenu';
import type { LocaleId } from '../../localization/index';
import { LOCALE_LABEL } from '../../localization/index';

export interface LocaleMenuHost {
  current: () => LocaleId;
  /** Сменить язык: сохранить выбор и перезагрузить страницу. */
  pick: (id: LocaleId) => void;
}

let open: { list: HTMLElement; button: HTMLElement } | null = null;

function close(): void {
  if (!open) return;
  open.list.remove();
  open.button.setAttribute('aria-expanded', 'false');
  open = null;
}

document.addEventListener('pointerdown', (e) => {
  if (!open) return;
  const target = e.target as Node;
  if (!open.list.contains(target) && !open.button.contains(target)) close();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && open) {
    const button = open.button;
    close();
    button.focus({ preventScroll: true });
  }
});

/** Подключить кнопку: подпись — текущий язык, клик раскрывает список. */
export function mountLocaleMenu(button: HTMLElement, host: LocaleMenuHost): void {
  button.innerHTML = `<span class="lm-globe" aria-hidden="true">🌐</span><span class="lm-cur">${LOCALE_LABEL[host.current()]}</span><span class="lm-car" aria-hidden="true">▾</span>`;
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (open?.button === button) return close();
    close();
    const list = document.createElement('div');
    list.className = 'locmenu';
    list.setAttribute('role', 'listbox');
    for (const option of localeOptions(host.current())) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'lm-item' + (option.current ? ' on' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.current));
      item.dataset.locale = option.id;
      item.innerHTML = `<span class="lm-tick" aria-hidden="true">${option.current ? '✓' : ''}</span>${option.label}`;
      item.addEventListener('click', () => {
        close();
        if (localeChanges(host.current(), option.id)) host.pick(option.id);
      });
      list.append(item);
    }
    document.body.append(list);
    // Список встаёт под кнопкой, прижатый к её правому краю, и не вылезает за экран.
    const r = button.getBoundingClientRect();
    list.style.top = `${Math.round(r.bottom + 6)}px`;
    list.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
    list.style.minWidth = `${Math.round(r.width)}px`;
    button.setAttribute('aria-expanded', 'true');
    open = { list, button };
    list.querySelector<HTMLElement>('.lm-item.on')?.focus({ preventScroll: true });
  });
}
