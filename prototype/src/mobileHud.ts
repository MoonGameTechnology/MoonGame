/** Phone presentation of the real selection/command hosts; no copied game actions. */
import { t } from '../../localization/runtime';
import { esc } from './format';
import { INFO_ICON } from './infoIcon';
import type { TapPick } from '../../decisions/tapCycle';
import type { CardTab } from '../../decisions/worldFleetTabs';

export interface MobileChoice extends TapPick {
  title: string;
  sub: string;
}

export function mobileOrderBar(title: string, target: string | null, picking = false): string {
  return (
    `<div class="mobile-order-copy"><b>${esc(title)}</b><span>${esc(
      picking ? t('hud.mobile.pick-hint') : t('hud.mobile.target-hint'),
    )}</span>${picking ? '' : `<strong>${esc(target ?? t('hud.mobile.target-none'))}</strong>`}</div>` +
    `<button data-cmd="mobile-cancel" class="btn-second warning">${esc(t('hud.mobile.cancel'))}</button>` +
    `<button data-cmd="${picking ? 'pick' : 'mobile-send'}" class="btn-main"${!picking && !target ? ' disabled' : ''}>${esc(picking ? t('hud.mobile.ready') : t('hud.mobile.send'))}</button>`
  );
}

interface MobileHudHost {
  side: HTMLElement;
  commands: HTMLElement;
  dismiss(): void;
  choose(pick: TapPick): void;
  ping(): void;
  summary(): void;
  /** Досье по ключу `data-desc` — для метки в шапке листа (очки победы мира). */
  describe(key: string): void;
  resized(): void;
  /** Вкладка «Флот» / «Мир» карточки своего мира со своим флотом (UIX-7.1). */
  tab(tab: CardTab): void;
}

/** Кнопки шапки мира, которые лист поднимает в нижнюю полосу (UIX-10.10): «Построить» и ник
 *  хозяина. Это копии: тап жмёт кнопку боковой панели, подпись берётся с неё же. */
const LIFTED = ['openbuild', 'seat'] as const;

function liftedButton(act: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn-second';
  b.dataset.mobile = 'lift';
  b.dataset.lift = act;
  return b;
}

const liftedSource = (side: HTMLElement, act: string) =>
  side.querySelector<HTMLButtonElement>(`.pacts [data-act="${act}"]`);

export function initMobileHud(host: MobileHudHost) {
  const sheet = document.createElement('section');
  sheet.id = 'mobile-sheet';
  sheet.hidden = true;
  const head = document.createElement('header');
  head.className = 'mobile-sheet-head';
  const grab = document.createElement('button');
  grab.type = 'button';
  grab.className = 'mobile-grab';
  grab.dataset.mobile = 'details';
  grab.innerHTML = '<i aria-hidden="true"></i>';
  const caption = document.createElement('b');
  const subtitle = document.createElement('span');
  grab.appendChild(caption);
  grab.appendChild(subtitle);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'mobile-close btn-x';
  close.dataset.mobile = 'close';
  close.textContent = '×';
  // «Сведения» — значок «i» в шапке рядом с ✕ (UIX-10.5, заказ владельца 2026-11-06: «Сведения
  // так же через восклицательный знак можно поместить на отметку»): тот же рисунок, что у
  // «Описания» карточки партии. Нижний ряд под ним кнопки больше не держит, и свёрнутый лист
  // флота стал на этот ряд ниже. Раскрытый лист значок подсвечивает: второй тап сворачивает.
  const info = document.createElement('button');
  info.type = 'button';
  info.className = 'mobile-info btn-second';
  info.dataset.mobile = 'details';
  info.innerHTML = INFO_ICON;
  // Метки карточки рядом с именем (`.phead .pbadge`: развитость и очки победы мира): шапка
  // карточки на телефоне скрыта, и метки переезжают сюда. Тап — досье метки, как у фишек мира.
  const BADGE_SLOTS = 2;
  const badges = Array.from({ length: BADGE_SLOTS }, (_, i) => {
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'mobile-badge';
    badge.dataset.mobile = 'badge';
    badge.dataset.index = String(i);
    badge.hidden = true;
    return badge;
  });
  head.appendChild(grab);
  for (const badge of badges) head.appendChild(badge);
  head.appendChild(info);
  head.appendChild(close);
  // Вкладки «Флот» / «Мир» (UIX-7.1): видны, только когда выбор — свой мир с одним своим
  // флотом; какая из них открыта, решает выбор, а не разметка.
  const tabs = document.createElement('div');
  tabs.className = 'mobile-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.hidden = true;
  const tabButton = (tab: CardTab): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.mobile = 'tab';
    b.dataset.tab = tab;
    tabs.appendChild(b);
    return b;
  };
  const fleetTab = tabButton('fleet');
  const worldTab = tabButton('world');
  const choices = document.createElement('div');
  choices.className = 'mobile-choices';
  const quick = document.createElement('div');
  quick.className = 'mobile-quick';
  // «Характеристики» и «Метка» — вторичные кнопки карточки (UIX-11.1): главная у неё приказ
  // «Курс» в ряду команд. Ряд виден, только пока в нём есть кнопка (UIX-10.5).
  const pingButton = document.createElement('button');
  pingButton.type = 'button';
  pingButton.className = 'btn-second';
  pingButton.dataset.mobile = 'ping';
  const summaryButton = document.createElement('button');
  summaryButton.type = 'button';
  summaryButton.className = 'btn-second';
  summaryButton.dataset.mobile = 'summary';
  const lifted = LIFTED.map(liftedButton);
  quick.appendChild(summaryButton);
  for (const b of lifted) quick.appendChild(b);
  quick.appendChild(pingButton);
  sheet.appendChild(head);
  sheet.appendChild(tabs);
  sheet.appendChild(choices);
  sheet.appendChild(quick);
  const sideHome = document.createComment('phone selection home');
  const cmdHome = document.createComment('phone command home');
  host.side.parentNode!.insertBefore(sideHome, host.side);
  host.commands.parentNode!.insertBefore(cmdHome, host.commands);
  document.body.appendChild(sheet);
  let active = false;
  let expanded = false;
  let selected = '';
  let choiceList: MobileChoice[] = [];
  let choicesHtml = '';
  let start: { x: number; y: number } | null = null;
  let swiped = false;
  let height = 0;
  let panelNode: ChildNode | null = null;
  let title = '';
  let sub = '';
  let marks: { text: string; key: string; label: string }[] = [];
  // Лист пишется каждый кадр (`update`), а запись того же значения не бесплатна: узел с
  // заново записанным `hidden` браузер заново стилизует, а с заново записанным текстом —
  // ещё и перекладывает. Поэтому пишется только сменившееся.
  const setText = (el: HTMLElement, text: string): void => {
    if (el.textContent !== text) el.textContent = text;
  };
  const setHidden = (el: HTMLElement, hidden: boolean): void => {
    if (el.hidden !== hidden) el.hidden = hidden;
  };
  const setAttr = (el: HTMLElement, name: string, value: string): void => {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  };
  const expand = (next: boolean): void => {
    expanded = next;
    sheet.classList.toggle('expanded', expanded);
    grab.setAttribute('aria-expanded', String(expanded));
    info.setAttribute('aria-expanded', String(expanded));
    info.classList.toggle('on', expanded);
    const label = expanded ? t('hud.mobile.collapse') : t('hud.mobile.details');
    info.setAttribute('aria-label', label);
    info.setAttribute('title', label);
  };
  // Only the handle owns sheet swipes. Scrolling content always stays native.
  grab.addEventListener('pointerdown', (ev) => {
    start = { x: ev.clientX, y: ev.clientY };
    swiped = false;
    grab.setPointerCapture(ev.pointerId);
  });
  grab.addEventListener('pointerup', (ev) => {
    if (
      start &&
      Math.abs(ev.clientY - start.y) > 28 &&
      Math.abs(ev.clientY - start.y) > Math.abs(ev.clientX - start.x)
    ) {
      expand(ev.clientY < start.y);
      swiped = true;
    }
    start = null;
  });
  grab.addEventListener('pointercancel', () => {
    start = null;
    swiped = false;
  });
  sheet.addEventListener('click', (ev) => {
    const button = (ev.target as Element).closest<HTMLButtonElement>('[data-mobile]');
    if (!button) return;
    const action = button.dataset.mobile;
    if (action === 'details') {
      if (!swiped) expand(!expanded);
      swiped = false;
    } else if (action === 'close') host.dismiss();
    else if (action === 'ping') host.ping();
    else if (action === 'lift') liftedSource(host.side, button.dataset.lift!)?.click();
    else if (action === 'badge') {
      const mark = marks[Number(button.dataset.index)];
      if (mark?.key) host.describe(mark.key);
    }
    else if (action === 'summary') {
      expand(true);
      host.summary();
    } else if (action === 'tab') {
      const tab = button.dataset.tab;
      if ((tab === 'fleet' || tab === 'world') && button.getAttribute('aria-selected') !== 'true')
        host.tab(tab);
    } else if (action === 'choose') {
      const pick = choiceList[Number(button.dataset.index)];
      if (pick) host.choose(pick);
    }
  });
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver((entries) => {
      const entry = entries[0];
      const next = entry?.borderBoxSize?.[0]?.blockSize ?? sheet.getBoundingClientRect().height;
      if (!active || sheet.hidden || Math.abs(next - height) < 1) return;
      height = next;
      host.resized();
    }).observe(sheet);
  }

  return {
    // A guide may poll before the next frame installs the new selection. The old
    // sheet being expanded must not count as the new fleet's details being open.
    expanded: (key?: string): boolean => active && expanded && (key === undefined || key === selected),
    collapse: (): void => expand(false),
    sync(enabled: boolean): void {
      if (enabled === active) return;
      active = enabled;
      document.body.classList.toggle('mobile-ui', enabled);
      if (enabled) {
        sheet.insertBefore(host.commands, quick);
        sheet.insertBefore(host.side, quick);
        selected = '';
        panelNode = null;
      } else {
        // The desktop adapter may already have claimed these hosts on this resize.
        if (host.side.parentNode === sheet)
          sideHome.parentNode!.insertBefore(host.side, sideHome.nextSibling);
        if (host.commands.parentNode === sheet)
          cmdHome.parentNode!.insertBefore(host.commands, cmdHome.nextSibling);
        sheet.hidden = true;
        expand(false);
      }
    },
    update(
      key: string,
      mode: boolean,
      more: boolean,
      list: MobileChoice[],
      tab: CardTab | null = null,
    ): void {
      if (!active) return;
      if (key !== selected) {
        selected = key;
        expand(false);
        requestAnimationFrame(host.resized);
      }
      if (host.side.style.display !== 'none' && panelNode !== host.side.firstChild) {
        panelNode = host.side.firstChild;
        title =
          host.side.querySelector('.ptitle > :first-child')?.textContent?.replace(/ ▸$/, '') ?? '';
        marks = [...host.side.querySelectorAll<HTMLElement>('.phead .pbadge')]
          .slice(0, BADGE_SLOTS)
          .map((m) => {
            const text = m.textContent ?? '';
            return { text, key: m.dataset.desc ?? '', label: m.getAttribute('aria-label') ?? text };
          });
      }
      // Подпись читается каждый кадр, а не на пересборке листа: живой отсчёт в ней (высадка,
      // `.pn-timer`) патчится на месте, и снимок с пересборки застыл бы на первой цифре.
      if (host.side.style.display !== 'none')
        sub = host.side.querySelector('.ptitle > span')?.textContent ?? '';
      choiceList = list;
      const choosing = list.length > 0;
      const html = list
        .map(
          (c, i) =>
            `<button type="button" data-mobile="choose" data-index="${i}"><i aria-hidden="true">${c.kind === 'strike' ? '✳' : c.kind === 'squadron' ? '◇' : c.kind === 'fleet' ? '△' : '◎'}</i><span><b>${esc(c.title)}</b><small>${esc(c.sub)}</small></span><i aria-hidden="true">›</i></button>`,
        )
        .join('');
      if (html !== choicesHtml) {
        choices.innerHTML = html;
        choicesHtml = html;
      }
      setHidden(sheet, !key && !mode && !choosing);
      sheet.classList.toggle('choosing', choosing);
      sheet.classList.toggle('order-mode', mode);
      sheet.classList.toggle('more-open', more);
      sheet.classList.toggle('has-commands', host.commands.classList.contains('show'));
      // Эскадра в полёте (UIX-10.5, заказ владельца «кнопки приказов тоже у авиации сделать»):
      // свёрнутый лист показывает ряд приказов её карточки, как ряд команд у флота. Кнопки те
      // же, что в карточке, — стиль листа прячет остальное (`mobile-console.css`). Чужой
      // эскадре приказывать нечего: без ряда лист остаётся одной шапкой.
      sheet.classList.toggle(
        'aloft',
        key.startsWith('strike:') && !!host.side.querySelector('.aloft-acts'),
      );
      setHidden(head, mode);
      setHidden(tabs, mode || choosing || !tab);
      if (!tabs.hidden) {
        setText(fleetTab, t('hud.mobile.tab.fleet'));
        setText(worldTab, t('hud.mobile.tab.world'));
        setAttr(fleetTab, 'aria-selected', String(tab === 'fleet'));
        setAttr(worldTab, 'aria-selected', String(tab === 'world'));
      }
      setHidden(choices, !choosing);
      setHidden(info, choosing);
      if (grab.disabled !== choosing) grab.disabled = choosing;
      setText(caption, choosing ? t('hud.mobile.choose') : title);
      setText(subtitle, choosing ? t('hud.mobile.choose-hint') : sub);
      badges.forEach((badge, i) => {
        const mark = marks[i];
        setText(badge, mark?.text ?? '');
        setHidden(badge, choosing || !mark?.text);
        if (mark) setAttr(badge, 'aria-label', mark.label);
      });
      setAttr(grab, 'aria-label', `${title} — ${t('hud.mobile.details')}`);
      setAttr(close, 'aria-label', t('card.close'));
      const infoLabel = expanded ? t('hud.mobile.collapse') : t('hud.mobile.details');
      setAttr(info, 'aria-label', infoLabel);
      setAttr(info, 'title', infoLabel);
      setText(pingButton, t('side.world.ping'));
      setText(summaryButton, t('hud.mobile.summary'));
      const noSummary = !expanded || !host.side.querySelector('[data-act="fleetinfo"]');
      const noPing = !host.side.querySelector('[data-act="ping"]') || !key.startsWith('planet:');
      setHidden(summaryButton, noSummary);
      setHidden(pingButton, noPing);
      let noLift = true;
      for (const b of lifted) {
        const src = key.startsWith('planet:') ? liftedSource(host.side, b.dataset.lift!) : null;
        setText(b, src?.textContent ?? '');
        setHidden(b, !src);
        if (src) noLift = false;
      }
      setHidden(quick, mode || choosing || (noSummary && noPing && noLift));
    },
  };
}
