/** Phone presentation of the real selection/command hosts; no copied game actions. */
import { t } from '../../localization/runtime';
import { esc } from './format';
import type { TapPick } from './tapCycle';

export interface MobileChoice extends TapPick {
  title: string;
  sub: string;
}

export function mobileOrderBar(title: string, target: string | null, picking = false): string {
  return (
    `<div class="mobile-order-copy"><b>${esc(title)}</b><span>${esc(
      picking ? t('hud.mobile.pick-hint') : t('hud.mobile.target-hint'),
    )}</span>${picking ? '' : `<strong>${esc(target ?? t('hud.mobile.target-none'))}</strong>`}</div>` +
    `<button data-cmd="mobile-cancel">${esc(t('hud.mobile.cancel'))}</button>` +
    `<button data-cmd="${picking ? 'pick' : 'mobile-send'}" class="mobile-primary"${!picking && !target ? ' disabled' : ''}>${esc(picking ? t('hud.mobile.ready') : t('hud.mobile.send'))}</button>`
  );
}

interface MobileHudHost {
  side: HTMLElement;
  commands: HTMLElement;
  dismiss(): void;
  choose(pick: TapPick): void;
  ping(): void;
  summary(): void;
  resized(): void;
}

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
  close.className = 'mobile-close';
  close.dataset.mobile = 'close';
  close.textContent = '×';
  head.appendChild(grab);
  head.appendChild(close);
  const choices = document.createElement('div');
  choices.className = 'mobile-choices';
  const quick = document.createElement('div');
  quick.className = 'mobile-quick';
  const detailButton = document.createElement('button');
  detailButton.type = 'button';
  detailButton.dataset.mobile = 'details';
  const pingButton = document.createElement('button');
  pingButton.type = 'button';
  pingButton.dataset.mobile = 'ping';
  const summaryButton = document.createElement('button');
  summaryButton.type = 'button';
  summaryButton.dataset.mobile = 'summary';
  quick.appendChild(detailButton);
  quick.appendChild(summaryButton);
  quick.appendChild(pingButton);
  sheet.appendChild(head);
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
  const setText = (el: HTMLElement, text: string): void => {
    if (el.textContent !== text) el.textContent = text;
  };
  const expand = (next: boolean): void => {
    expanded = next;
    sheet.classList.toggle('expanded', expanded);
    grab.setAttribute('aria-expanded', String(expanded));
    detailButton.setAttribute('aria-expanded', String(expanded));
    setText(detailButton, expanded ? t('hud.mobile.collapse') : t('hud.mobile.details'));
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
    else if (action === 'summary') {
      expand(true);
      host.summary();
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
    expanded: (): boolean => active && expanded,
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
    update(key: string, mode: boolean, more: boolean, list: MobileChoice[]): void {
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
        sub = host.side.querySelector('.ptitle > span')?.textContent ?? '';
      }
      choiceList = list;
      const choosing = list.length > 0;
      const html = list
        .map(
          (c, i) =>
            `<button type="button" data-mobile="choose" data-index="${i}"><i aria-hidden="true">${c.kind === 'fleet' ? '△' : '◎'}</i><span><b>${esc(c.title)}</b><small>${esc(c.sub)}</small></span><i aria-hidden="true">›</i></button>`,
        )
        .join('');
      if (html !== choicesHtml) {
        choices.innerHTML = html;
        choicesHtml = html;
      }
      sheet.hidden = !key && !mode && !choosing;
      sheet.classList.toggle('choosing', choosing);
      sheet.classList.toggle('order-mode', mode);
      sheet.classList.toggle('more-open', more);
      sheet.classList.toggle('has-commands', host.commands.classList.contains('show'));
      head.hidden = mode;
      choices.hidden = !choosing;
      quick.hidden = mode || choosing;
      grab.disabled = choosing;
      setText(caption, choosing ? t('hud.mobile.choose') : title);
      setText(subtitle, choosing ? t('hud.mobile.choose-hint') : sub);
      grab.setAttribute('aria-label', `${title} — ${t('hud.mobile.details')}`);
      close.setAttribute('aria-label', t('card.close'));
      setText(detailButton, expanded ? t('hud.mobile.collapse') : t('hud.mobile.details'));
      setText(pingButton, t('side.world.ping'));
      setText(summaryButton, t('hud.mobile.summary'));
      summaryButton.hidden =
        !expanded || !host.side.querySelector('[data-act="fleetinfo"], [data-act="planetinfo"]');
      pingButton.hidden =
        !host.side.querySelector('[data-act="ping"]') || !key.startsWith('planet:');
    },
  };
}
