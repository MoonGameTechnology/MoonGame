/**
 * Нижняя панель телефона в партии (UIX-3.1, своя раскладка — UIX-3.3): разметка, нажатия,
 * подсветка и запись раскладки.
 *
 * Что стоит в панели и в «Ещё», что подсвечено и куда ведёт нажатие, решает
 * `decisions/phoneNav.ts`; здесь только DOM и хранилище. Пункты нажимают НАСТОЯЩИЕ кнопки
 * рельсы: она на телефоне спрятана, но окна, вводные «впервые» и выход с вопросом в забеге
 * остаются её.
 */
import { t } from '../../localization/runtime';
import { esc } from './format';
import { phoneIcon } from './phoneIcons';
import { readRaw, writeRaw } from './prefs';
import {
  activePhoneTab,
  parsePhoneBar,
  phoneBadges,
  phoneItem,
  phoneMoreItems,
  phoneSectionLabel,
  phoneTabs,
  phoneTabTap,
  phoneTileBadge,
  serializePhoneBar,
  type PhoneBar,
  type PhoneCounts,
  type PhoneItemId,
  type PhoneMoreId,
  type PhoneSection,
} from '../../decisions/phoneNav';

/** Раскладка панели игрока (`serializePhoneBar`). */
const BAR_KEY = 'void.phone.bar';

interface PhoneNavHost {
  /** Убрать окна над картой; выделение, обучение и сама партия остаются. */
  toMap(): void;
  /** Открыто ли окно пункта. */
  windowOpen(id: PhoneItemId): boolean;
}

/** Есть ли кнопка сейчас: игра прячет недоступные инлайновым `display:none`. */
function present(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector);
  return el !== null && el.style.display !== 'none' && !el.hidden;
}

export function initPhoneNav(host: PhoneNavHost) {
  const nav = document.createElement('nav');
  nav.id = 'phone-nav';
  nav.setAttribute('aria-label', t('hud.sections'));
  const more = document.createElement('section');
  more.id = 'phone-more';
  more.hidden = true;
  more.setAttribute('role', 'dialog');
  more.setAttribute('aria-label', t('hud.tools'));
  document.body.appendChild(nav);
  document.body.appendChild(more);

  let bar: PhoneBar = parsePhoneBar(readRaw(BAR_KEY));
  let buttons = new Map<PhoneSection, HTMLElement>();
  let enabled = false;
  let shownTabs = '';
  let active: PhoneSection | null = null;
  let counts: PhoneCounts = {};
  const badgeText = new Map<PhoneSection, string>();

  const open = (tab: PhoneSection): boolean =>
    tab === 'more' ? !more.hidden : tab !== 'map' && host.windowOpen(tab);

  const renderMore = (): void => {
    const badge = (id: PhoneMoreId): string => {
      const text = phoneTileBadge(counts, id);
      return text ? `<b class="phone-badge">${esc(text)}</b>` : '';
    };
    more.innerHTML =
      `<div class="phone-more-panel"><div class="phone-more-head"><b>${esc(t('hud.tools'))}</b>` +
      `<button type="button" class="btn-x" data-phone-close="1" aria-label="${esc(t('card.close'))}">×</button></div>` +
      `<div class="phone-more-grid">` +
      phoneMoreItems(bar, present)
        .map(
          (item) =>
            `<button type="button" data-phone-more="${item.id}">${phoneIcon(item.id)}` +
            `<span>${esc(t(item.label))}</span>${badge(item.id)}</button>`,
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
    const next = phoneTabTap(tab, activePhoneTab(bar, open));
    closeMore();
    host.toMap();
    if (next === 'more') {
      renderMore();
      more.hidden = false;
    } else if (next && next !== 'map') press(phoneItem(next).opens);
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
    const item = phoneMoreItems(bar, () => true).find((x) => x.id === id);
    if (!item) return;
    closeMore();
    host.toMap();
    press(item.opens);
    sync(enabled);
  });

  /** Значки разделов по числам и раскладке; меняет только то, что изменилось. */
  const applyBadges = (): void => {
    const text = phoneBadges(bar, counts, !more.hidden);
    for (const [tab, button] of buttons) {
      const next = text[tab] ?? '';
      if (badgeText.get(tab) === next) continue;
      badgeText.set(tab, next);
      const badge = button.querySelector<HTMLElement>('.phone-badge');
      if (!badge) continue;
      badge.textContent = next;
      badge.hidden = !next;
    }
  };

  /** Кадр: включена ли панель (телефон в партии), какие разделы есть и какой подсвечен. */
  function sync(on: boolean): void {
    enabled = on;
    if (!on) {
      closeMore();
      return;
    }
    const tabs = phoneTabs(bar, present);
    const key = tabs.join('|');
    if (key !== shownTabs) {
      shownTabs = key;
      nav.innerHTML = tabs
        .map(
          (tab) =>
            `<button type="button" data-phone-tab="${tab}">${phoneIcon(tab)}` +
            `<span>${esc(t(phoneSectionLabel(tab)))}</span><b class="phone-badge" hidden></b></button>`,
        )
        .join('');
      buttons = new Map(
        Array.from(nav.querySelectorAll<HTMLElement>('[data-phone-tab]')).map((b) => [
          b.dataset.phoneTab as PhoneSection,
          b,
        ]),
      );
      active = null;
      badgeText.clear();
      applyBadges();
    }
    const now = activePhoneTab(bar, open);
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
      const changed = battles !== counts.events || letters !== counts.mail;
      counts = { events: battles, mail: letters };
      applyBadges();
      if (changed && !more.hidden) renderMore();
    },
    /** Раскладка панели — её показывает и меняет редактор в настройках. */
    bar: (): PhoneBar => bar,
    /** Новая раскладка: панель перестраивается сразу, запись переживает перезагрузку. */
    setBar(next: PhoneBar): void {
      bar = parsePhoneBar(serializePhoneBar(next));
      writeRaw(BAR_KEY, serializePhoneBar(bar));
      if (!more.hidden) renderMore();
      sync(enabled);
    },
    /** Открыт ли лист «Ещё» — ступень лестницы «Назад». */
    moreOpen: (): boolean => !more.hidden,
    closeMore,
  };
}
