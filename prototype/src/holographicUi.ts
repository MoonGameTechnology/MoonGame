/** Presentation adapter for the existing HUD. Commands and windows keep their hosts. */
import { t } from '../../localization/runtime';
import { esc } from './format';
import { rgba } from '../../packages/client/src/holoDraw';
import { holoIcon, skinIcon, type HoloIcon } from './holographicIcons';
import { holographicTheme } from '../../packages/client/src/theme';
import { holographyOn, motionOn, glowOn } from './graphicsPrefs';
import {
  placeFleetPanel,
  supportsHolography,
  type HoloPoint,
  type HoloRect,
} from './holographicLayout';

interface HolographicHost {
  commands: HTMLElement;
  top: HTMLElement;
  side: HTMLElement;
  exit(): void;
  details(): void;
  dismiss(): void;
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
  let enabled = false;
  let signature = '';
  let width = 1280;
  let height = 720;
  let topBottom = 84;
  let panelSize = { width: 292, height: 340 };
  let inspector: HoloRect | null = null;
  let lastSelection = '';
  let lastPosition = '';
  let pointerInside = false;
  let keyboardInside = false;
  let keyboardInput = false;
  let placement: ReturnType<typeof placeFleetPanel> | null = null;
  let marker: HoloPoint | null = null;

  const measureChrome = (): void => {
    topBottom = host.top.getBoundingClientRect().bottom;
    const nav = navigation?.getBoundingClientRect();
    if (nav && nav.width > 0)
      document.body.style.setProperty('--holo-nav-end', `${Math.ceil(nav.right + 8)}px`);
    const r = host.side.getBoundingClientRect();
    inspector =
      r.width > 0 && r.height > 0
        ? { x: r.left, y: r.top, width: r.width, height: r.height }
        : null;
  };
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(measureChrome).observe(host.top);
    new ResizeObserver(measureChrome).observe(host.side);
    if (navigation) new ResizeObserver(measureChrome).observe(navigation);
    new ResizeObserver((entries) => {
      const e = entries[entries.length - 1];
      if (!e) return;
      const r = e.borderBoxSize?.[0];
      if (r && r.inlineSize > 0 && r.blockSize > 0)
        panelSize = { width: r.inlineSize, height: r.blockSize };
    }).observe(host.commands);
  }
  document.getElementById('holo-back')?.addEventListener('click', host.exit);
  host.commands.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'touch') pointerInside = true;
  });
  host.commands.addEventListener('pointerleave', () => {
    pointerInside = false;
  });
  host.commands.addEventListener('pointerdown', () => {
    keyboardInput = false;
    keyboardInside = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') keyboardInput = true;
  });
  host.commands.addEventListener('focusin', () => {
    keyboardInside = keyboardInput;
  });
  host.commands.addEventListener('focusout', (e) => {
    if (!host.commands.contains(e.relatedTarget as Node | null)) keyboardInside = false;
  });
  // Intercept only new presentation buttons, before the existing command delegate.
  host.commands.addEventListener('click', (e) => {
    const action = (e.target as Element).closest<HTMLElement>('[data-holo-action]')?.dataset
      .holoAction;
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
      if (w !== width || h !== height) {
        placement = null;
        lastPosition = '';
      }
      width = w;
      height = h;
      enabled = next;
      document.body.classList.toggle('holo-available', supported);
      document.body.classList.toggle('holo-ui', next);
      document.body.classList.toggle('holo-in-match', next && inMatch);
      document.body.classList.toggle('holo-still', !motionOn());
      document.body.classList.toggle('holo-no-glow', !glowOn());
      if (!next) {
        host.commands.style.removeProperty('left');
        host.commands.style.removeProperty('top');
        host.commands.style.removeProperty('max-height');
        placement = null;
        lastPosition = '';
      }
      measureChrome();
    },
    positionCommands(anchor: HoloPoint | null, key: string, inspectorOpen: boolean): void {
      if (!enabled || !host.commands.classList.contains('show')) {
        placement = null;
        marker = null;
        return;
      }
      const changed = key !== lastSelection;
      lastSelection = key;
      marker = anchor;
      if (
        !changed &&
        placement &&
        (pointerInside || keyboardInside) &&
        panelSize.width === placement.width &&
        panelSize.height === placement.height
      )
        return;
      const area = {
        x: 14,
        y: topBottom + 58,
        width: width - 28,
        height: Math.max(100, height - topBottom - 138),
      };
      placement = placeFleetPanel(
        anchor ?? { x: width / 2, y: height / 2 },
        panelSize,
        area,
        inspectorOpen && inspector ? [inspector] : [],
      );
      const pos = `${Math.round(placement.x)}|${Math.round(placement.y)}|${Math.round(area.height)}`;
      if (pos === lastPosition) return;
      lastPosition = pos;
      host.commands.style.left = `${Math.round(placement.x)}px`;
      host.commands.style.top = `${Math.round(placement.y)}px`;
      host.commands.style.maxHeight = `${Math.round(area.height)}px`;
    },
    drawLeader(ctx: CanvasRenderingContext2D): void {
      if (
        !enabled ||
        !placement?.anchorVisible ||
        !marker ||
        !host.commands.classList.contains('show')
      )
        return;
      // The pointer follows the visible fleet even while the interactive panel is held still.
      const x = Math.max(placement.x, Math.min(placement.x + placement.width, marker.x));
      const y = Math.max(placement.y + 18, Math.min(placement.y + placement.height - 18, marker.y));
      const dx = x - marker.x;
      const dy = y - marker.y;
      const length = Math.hypot(dx, dy);
      if (length < 16 || length > 260) return;
      ctx.save();
      ctx.strokeStyle = rgba(holographicTheme.cyan, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(marker.x + (dx / length) * 15, marker.y + (dy / length) * 15);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.restore();
    },
  };
}
