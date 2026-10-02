/**
 * Нижняя панель телефона в партии (UIX-3.1): разметка, нажатия и подсветка.
 *
 * Что стоит в панели и в «Ещё», что подсвечено и куда ведёт нажатие, решает
 * `decisions/phoneNav.ts`; здесь только DOM. Пункты нажимают НАСТОЯЩИЕ кнопки рельсы: она на
 * телефоне спрятана, но окна, вводные «впервые» и выход с вопросом в забеге остаются её.
 */
import { t } from '../../localization/runtime';
import { esc } from './format';
import {
  activePhoneTab,
  PHONE_MORE,
  PHONE_TABS,
  phoneBadges,
  phoneMoreItems,
  phoneTabs,
  phoneTabTap,
  type PhoneMoreId,
  type PhoneSection,
} from '../../decisions/phoneNav';

interface PhoneNavHost {
  /** Убрать окна над картой; выделение, обучение и сама партия остаются. */
  toMap(): void;
  /** Открыто ли окно раздела. */
  windowOpen(tab: 'production' | 'science' | 'events'): boolean;
}

/** Линейные значки разделов, 24×24, цветом подписи. */
const ICON: Record<PhoneSection, string> = {
  map: '<path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5V4l-6 2.5L9 4Z"/><path d="M9 4v13M15 6.5v13"/>',
  production:
    '<path d="M4 20h16M6 20V10l4 2.5V10l4 2.5V10l4 2.5V20"/><path d="M8 16h1.5M12 16h1.5M16 16h1.5"/>',
  science:
    '<circle cx="12" cy="12" r="1.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/>' +
    '<ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/>' +
    '<ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)"/>',
  events: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  more: '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
};

/** Знак плитки «Ещё» — одноцветный символ, как у кнопок рельсы. */
const GLYPH: Record<PhoneMoreId, string> = {
  diplomacy: '⬡',
  mail: '✉',
  pings: '⌖',
  market: '⇄',
  trader: '⚖',
  corporation: '⬢',
  steward: '☾',
  dossier: '☣',
  codex: '?',
  settings: '⚙',
  save: '⤓',
  abandon: '⚑',
  exit: '⌂',
};

/** Есть ли кнопка сейчас: игра прячет недоступные инлайновым `display:none`. */
function present(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector);
  return el !== null && el.style.display !== 'none' && !el.hidden;
}

export function initPhoneNav(host: PhoneNavHost) {
  const nav = document.createElement('nav');
  nav.id = 'phone-nav';
  nav.setAttribute('aria-label', t('hud.sections'));
  nav.innerHTML = PHONE_TABS.map(
    (tab) =>
      `<button type="button" data-phone-tab="${tab.id}">` +
      `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[tab.id]}</svg>` +
      `<span>${esc(t(tab.label))}</span><b class="phone-badge" hidden></b></button>`,
  ).join('');
  const more = document.createElement('section');
  more.id = 'phone-more';
  more.hidden = true;
  more.setAttribute('role', 'dialog');
  more.setAttribute('aria-label', t('hud.tools'));
  document.body.appendChild(nav);
  document.body.appendChild(more);

  const buttons = new Map<PhoneSection, HTMLElement>();
  for (const b of Array.from(nav.querySelectorAll<HTMLElement>('[data-phone-tab]')))
    buttons.set(b.dataset.phoneTab as PhoneSection, b);
  let enabled = false;
  let shownTabs = '';
  let active: PhoneSection | null = null;
  let unread = 0;
  const badgeText = new Map<PhoneSection, string>();

  const open = (tab: PhoneSection): boolean =>
    tab === 'more' ? !more.hidden : tab !== 'map' && host.windowOpen(tab);

  const renderMore = (): void => {
    const mail = unread > 0 ? `<b class="phone-badge">${esc(String(unread))}</b>` : '';
    more.innerHTML =
      `<div class="phone-more-panel"><div class="phone-more-head"><b>${esc(t('hud.tools'))}</b>` +
      `<button type="button" data-phone-close="1" aria-label="${esc(t('card.close'))}">×</button></div>` +
      `<div class="phone-more-grid">` +
      phoneMoreItems(present)
        .map(
          (item) =>
            `<button type="button" data-phone-more="${item.id}"><i aria-hidden="true">${GLYPH[item.id]}</i>` +
            `<span>${esc(t(item.label))}</span>${item.id === 'mail' ? mail : ''}</button>`,
        )
        .join('') +
      `</div></div>`;
  };
  const closeMore = (): void => {
    more.hidden = true;
  };
  const press = (selector: string | null | undefined): void => {
    if (selector) document.querySelector<HTMLElement>(selector)?.click();
  };

  nav.addEventListener('click', (ev) => {
    const tab = (ev.target as Element).closest<HTMLElement>('[data-phone-tab]')?.dataset
      .phoneTab as PhoneSection | undefined;
    if (!tab) return;
    const next = phoneTabTap(tab, activePhoneTab(open));
    closeMore();
    host.toMap();
    if (next === 'more') {
      renderMore();
      more.hidden = false;
    } else if (next) press(PHONE_TABS.find((x) => x.id === next)?.opens);
    sync(enabled);
  });
  more.addEventListener('click', (ev) => {
    const target = ev.target as Element;
    // Тап мимо панели (по затемнению) и ✕ закрывают лист.
    if (target === more || target.closest('[data-phone-close]')) {
      closeMore();
      sync(enabled);
      return;
    }
    const id = target.closest<HTMLElement>('[data-phone-more]')?.dataset.phoneMore;
    const item = PHONE_MORE.find((x) => x.id === id);
    if (!item) return;
    closeMore();
    host.toMap();
    press(item.opens);
    sync(enabled);
  });

  const setBadge = (tab: PhoneSection, text: string): void => {
    if (badgeText.get(tab) === text) return;
    badgeText.set(tab, text);
    const badge = buttons.get(tab)?.querySelector<HTMLElement>('.phone-badge');
    if (!badge) return;
    badge.textContent = text;
    badge.hidden = !text;
  };

  /** Кадр: включена ли панель (телефон в партии), какие разделы есть и какой подсвечен. */
  function sync(on: boolean): void {
    enabled = on;
    if (!on) {
      closeMore();
      return;
    }
    const tabs = phoneTabs(present).map((tab) => tab.id);
    const key = tabs.join('|');
    if (key !== shownTabs) {
      shownTabs = key;
      for (const [id, b] of buttons) b.hidden = !tabs.includes(id);
      nav.dataset.tabs = String(tabs.length);
    }
    const now = activePhoneTab(open);
    if (now !== active) {
      active = now;
      for (const [id, b] of buttons) {
        b.classList.toggle('on', id === now);
        if (id === now) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
      }
    }
  }

  return {
    sync,
    /** Числа значков: бои и непрочитанные письма — те же, что у кнопок рельсы. */
    badges(battles: number, letters: number): void {
      const changed = letters !== unread;
      unread = letters;
      const text = phoneBadges(battles, letters, !more.hidden);
      setBadge('events', text.events);
      setBadge('more', text.more);
      if (changed && !more.hidden) renderMore();
    },
    /** Открыт ли лист «Ещё» — ступень лестницы «Назад». */
    moreOpen: (): boolean => !more.hidden,
    closeMore,
  };
}
