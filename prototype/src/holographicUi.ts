/** Presentation adapter for the existing HUD. Commands and windows keep their hosts. */
import { t } from '../../localization/runtime';
import { esc } from './format';
import { holoIcon, skinIcon, type HoloIcon } from './holographicIcons';
import { holographyOn, motionOn, glowOn } from './graphicsPrefs';
import { supportsHolography, selectionWindowPosition, type HoloPoint } from './holographicLayout';
import { initFloatingWindows } from './floatingWindows';

interface HolographicHost {
  commands: HTMLElement;
  top: HTMLElement;
  side: HTMLElement;
  exit(): void;
  details(): void;
  dismiss(): void;
  selectionKey(): string;
  selectionAnchor(): HoloPoint | null;
}

export function commandWindowHtml(
  commands: string,
  title: string,
  sub: string,
  details = true,
): string {
  return (
    `<div class="holo-command-head"><div><b>${esc(title)}</b><span>${esc(sub)}</span></div>` +
    `<button type="button" data-holo-action="close" class="holo-command-close" aria-label="${esc(t('card.close'))}">×</button></div>` +
    `<div class="holo-command-body">${commands}</div>` +
    (details
      ? `<button type="button" data-holo-action="details" class="holo-command-details">${esc(t('hud.command-details'))}</button>`
      : '')
  );
}

export function initHolographicUi(host: HolographicHost) {
  const navigation = document.querySelector<HTMLElement>('.holo-nav');
  const back = document.getElementById('holo-back');
  if (back) back.innerHTML = holoIcon('caret-left');
  // Replace only the decorative leading text, preserving labels, badges and listeners.
  const railIcons: Record<string, HoloIcon> = {
    'rail-diplo': 'handshake', 'rail-msgs': 'envelope-simple', 'rail-pings': 'broadcast',
    'rail-tech': 'atom', 'rail-constructor': 'hammer', 'rail-steward': 'moon',
    'rail-market': 'arrows-left-right', 'railcorp': 'hexagon', 'rail-chat': 'chat-circle-text',
    'rail-log': 'list-bullets', 'rail-help': 'question', 'rail-settings': 'sliders-horizontal',
    'rail-exit': 'sign-out',
  };
  for (const [id, icon] of Object.entries(railIcons)) {
    const button = document.getElementById(id);
    const leading = button?.firstChild;
    if (!button || !leading || leading.nodeType !== 3) continue;
    const markup = skinIcon(icon, esc(leading.textContent ?? ''));
    leading.remove();
    button.insertAdjacentHTML('afterbegin', markup);
  }
  const selection = document.createElement('div');
  selection.id = 'holo-selection-window';
  selection.style.display = 'none';
  const sideHome = document.createComment('selection information home');
  const commandHome = document.createComment('selection commands home');
  host.side.parentNode!.insertBefore(sideHome, host.side);
  host.commands.parentNode!.insertBefore(commandHome, host.commands);
  document.body.appendChild(selection);
  const windows = initFloatingWindows();
  let enabled = false;
  let inGame = false;
  let signature = '';
  let width = 1280;
  let height = 720;
  let selected = '';
  const measureChrome = (): void => {
    const nav = navigation?.getBoundingClientRect();
    if (nav && nav.width > 0)
      document.body.style.setProperty('--holo-nav-end', `${Math.ceil(nav.right + 8)}px`);
  };
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(measureChrome).observe(host.top);
    if (navigation) new ResizeObserver(measureChrome).observe(navigation);
  }
  document.getElementById('holo-back')?.addEventListener('click', host.exit);
  // Keep the real command delegate on its original, stable host.
  host.commands.addEventListener('click', (e) => {
    const action = (e.target as Element).closest<HTMLElement>('[data-holo-action]')?.dataset.holoAction;
    if (!action) return;
    e.stopImmediatePropagation();
    if (action === 'details') host.details();
    if (action === 'close') host.dismiss();
  });

  return {
    active: (): boolean => enabled,
    sync(w: number, h: number, coarse: boolean, inMatch: boolean): void {
      const supported = supportsHolography(w, h, coarse);
      const next = supported && holographyOn();
      const sig = `${w}|${h}|${supported}|${next}|${inMatch}|${motionOn()}|${glowOn()}`;
      if (sig === signature) return;
      signature = sig;
      width = w;
      height = h;
      inGame = inMatch;
      document.body.classList.toggle('holo-available', supported);
      document.body.classList.toggle('holo-ui', next);
      document.body.classList.toggle('holo-in-match', next && inMatch);
      document.body.classList.toggle('holo-still', !motionOn());
      document.body.classList.toggle('holo-no-glow', !glowOn());
      if (next !== enabled) {
        if (next) {
          selection.appendChild(host.commands);
          selection.appendChild(host.side);
          selected = '';
        } else {
          windows.sync(false, w, h);
          sideHome.parentNode!.insertBefore(host.side, sideHome.nextSibling);
          commandHome.parentNode!.insertBefore(host.commands, commandHome.nextSibling);
          selection.style.display = 'none';
        }
      }
      enabled = next;
      measureChrome();
    },
    layoutWindows(): void {
      if (enabled) {
        const info = host.side.style.display !== 'none';
        const commands = host.commands.classList.contains('show');
        selection.classList.toggle('has-info', info);
        selection.classList.toggle('has-commands', commands);
        selection.style.display = inGame && (info || commands) ? 'flex' : 'none';
        // The command header replaces the former dossier header; keep its live
        // orbit, damage and supply notes while removing the duplicate title.
        if (info && commands) {
          const caption = host.commands.querySelector<HTMLElement>('.holo-command-head span');
          const details = host.side.querySelector<HTMLElement>('.ptitle span')?.textContent;
          if (caption && details && caption.textContent !== details) caption.textContent = details;
        }
        const key = host.selectionKey();
        if (inGame && (info || commands) && key !== selected) {
          const anchor = host.selectionAnchor();
          if (anchor) {
            const box = selection.getBoundingClientRect();
            const top = host.top.getBoundingClientRect().bottom + 24;
            windows.openAt('holo-selection-window', selectionWindowPosition(anchor,
              { width: box.width, height: box.height }, { width, height }, top));
          }
          selected = key;
        }
        if (!key) selected = '';
      }
      // Window coordinates only respond to the user's drag/keys and viewport resize.
      windows.sync(enabled, width, height);
    },
  };
}
