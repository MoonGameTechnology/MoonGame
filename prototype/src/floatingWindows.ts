/** Local window geometry. Never reads selection, camera or simulation state. */
import { t } from '../../localization/runtime';
import type { HoloPoint } from './holographicLayout';

const WINDOWS = [
  ['holo-selection-window', '', '.phead,.holo-command-head,.chlabel'],
  ['tech', '.twbox', '.lw-head'],
  ['buildwin', '.twbox', '.lw-head'],
  ['steward', '.twbox', '.lw-head'],
  ['scipick', '.twbox', '.lw-head'],
  ['logwin', '.lwbox', '.lw-head'],
  ['market', '.mkbox', '.lw-head'],
  ['constructor', '.cnbox', '.cn-head'],
  ['diplo', '.dpbox', '.dp-head'],
  ['playercard', '.pcbox', '.pc-head'],
  ['settings', '.setbox', '.pc-head'],
  ['codex', '.cxbox', '.cx-head'],
  ['codexhub', '.chbox', '.ch-head'],
  ['rescard', '.rc-box', '.rc-head'],
  ['recap', '.rcbox', '.rc-head'],
  ['splitdlg', '.sbox', '.shead'],
  ['warprompt', '.wpbox', '.wp-head'],
  ['intro', '.inbox', '.in-head'],
  ['corp', '.corpbox', '.corphd'],
  ['emblempick', '.ep-box', '.ep-head'],
  ['pingpanel', '', '.lw-head'],
  ['pingmenu', '.pm-box', '.pm-head'],
] as const;

/** Keep the complete window reachable; oversized content scrolls inside its frame. */
export function fitWindowPosition(
  p: HoloPoint, size: { width: number; height: number }, viewport: { width: number; height: number },
): HoloPoint {
  const clamp = (n: number, max: number): number => Math.max(12, Math.min(n, Math.max(12, max)));
  return {
    x: clamp(p.x, viewport.width - size.width - 12),
    y: clamp(p.y, viewport.height - size.height - 12),
  };
}

interface WindowEntry {
  id: string;
  root: HTMLElement;
  box: string;
  handles: string;
  node: HTMLElement | null;
  point?: HoloPoint;
  size?: { width: number; height: number };
  visible: boolean;
  dirty: boolean;
}

export function initFloatingWindows() {
  // Chat already owns its move/resize/pin gestures and persisted geometry.
  const entries: WindowEntry[] = WINDOWS.flatMap(([id, box, handles]) => {
    const root = document.getElementById(id);
    return root ? [{ id, root, box, handles, node: null, visible: false, dirty: true }] : [];
  });
  const previous = new WeakMap<HTMLElement, { left: string; top: string; leftPriority: string; topPriority: string }>();
  let enabled = false;
  let viewport = { width: 1280, height: 720 };
  let drag: { entry: WindowEntry; id: number; start: HoloPoint; origin: HoloPoint } | null = null;
  let releasedRoot: HTMLElement | null = null;
  const observer = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver((changes) => {
        for (const change of changes) {
          const entry = entries.find((x) => x.node === change.target);
          if (entry) entry.dirty = true;
        }
      }) : null;
  const restore = (entry: WindowEntry): void => {
    const node = entry.node;
    if (!node) return;
    observer?.unobserve(node);
    node.classList.remove('holo-floating-window');
    node.style.removeProperty('--holo-window-room');
    delete node.dataset.holoWindow;
    const old = previous.get(node);
    if (old) {
      for (const key of ['left', 'top'] as const) {
        if (old[key]) node.style.setProperty(key, old[key], old[`${key}Priority`]);
        else node.style.removeProperty(key);
      }
    }
    for (const h of node.querySelectorAll<HTMLElement>('.holo-drag-handle')) {
      h.classList.remove('holo-drag-handle');
      h.removeAttribute('tabindex');
      h.removeAttribute('title');
      h.removeAttribute('aria-label');
    }
    entry.node = null;
  };
  const apply = (entry: WindowEntry): void => {
    if (!entry.node || !entry.point || !entry.size) return;
    const point = fitWindowPosition(entry.point, entry.size, viewport);
    entry.point = point;
    entry.node.style.setProperty('left', `${Math.round(point.x)}px`, 'important');
    entry.node.style.setProperty('top', `${Math.round(point.y)}px`, 'important');
    entry.node.style.setProperty('--holo-window-room', `${Math.max(80, viewport.height - point.y - 12)}px`);
  };
  const finish = (): void => {
    const active = drag;
    drag = null;
    document.body.classList.remove('holo-window-dragging');
    if (active) {
      // Capturing on the stable overlay retargets the generated click to its backdrop.
      // Consume that click so releasing a title never closes a dialog or issues an order.
      releasedRoot = active.entry.root;
      requestAnimationFrame(() => { if (releasedRoot === active.entry.root) releasedRoot = null; });
    }
    if (active?.entry.root.hasPointerCapture?.(active.id)) active.entry.root.releasePointerCapture(active.id);
  };
  const entryFor = (target: Element): WindowEntry | undefined => {
    const node = target.closest<HTMLElement>('[data-holo-window]');
    return entries.find((entry) => entry.node === node);
  };
  document.addEventListener('pointerdown', (e) => {
    releasedRoot = null;
    if (!enabled || e.button !== 0 || !e.isPrimary) return;
    const target = e.target as Element;
    if (!target.closest('.holo-drag-handle') ||
      target.closest('button,input,select,textarea,a,[contenteditable],[data-act]')) return;
    const entry = entryFor(target);
    if (!entry?.node || !entry.point) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    drag = { entry, id: e.pointerId, start: { x: e.clientX, y: e.clientY }, origin: { ...entry.point } };
    entry.root.setPointerCapture?.(e.pointerId);
    document.body.classList.add('holo-window-dragging');
  }, true);
  document.addEventListener('click', (e) => {
    const root = releasedRoot;
    releasedRoot = null;
    if (root && e.target instanceof Node && (e.target === root || root.contains(e.target))) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    drag.entry.point = {
      x: drag.origin.x + e.clientX - drag.start.x,
      y: drag.origin.y + e.clientY - drag.start.y,
    };
    apply(drag.entry);
  }, true);
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
    document.addEventListener(event, (e) => { if (drag?.id === e.pointerId) finish(); }, true);
  window.addEventListener('blur', finish);
  document.addEventListener('keydown', (e) => {
    if (!enabled || !(e.target instanceof HTMLElement) || !e.target.classList.contains('holo-drag-handle')) return;
    const direction: Record<string, HoloPoint> = {
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
    };
    const delta = direction[e.key];
    const entry = entryFor(e.target);
    if (!delta || !entry?.point) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const step = e.shiftKey ? 30 : 10;
    entry.point = { x: entry.point.x + delta.x * step, y: entry.point.y + delta.y * step };
    apply(entry);
  }, true);

  return {
    sync(active: boolean, width: number, height: number): void {
      if (!active) {
        if (enabled) { finish(); entries.forEach(restore); }
        enabled = false;
        return;
      }
      const resized = width !== viewport.width || height !== viewport.height;
      enabled = true;
      viewport = { width, height };
      for (const entry of entries) {
        const node = entry.box ? entry.root.querySelector<HTMLElement>(entry.box) : entry.root;
        const visible = entry.root.classList.contains('show') ||
          (!!entry.root.style.display && entry.root.style.display !== 'none');
        if (!node || !visible) {
          if (drag?.entry === entry) finish();
          entry.visible = false;
          continue;
        }
        if (entry.node !== node) {
          restore(entry);
          entry.node = node;
          previous.set(node, {
            left: node.style.left, top: node.style.top,
            leftPriority: node.style.getPropertyPriority('left'), topPriority: node.style.getPropertyPriority('top'),
          });
          const r = node.getBoundingClientRect();
          entry.point ??= { x: r.left, y: r.top };
          node.classList.add('holo-floating-window');
          node.dataset.holoWindow = entry.id;
          observer?.observe(node);
          entry.dirty = true;
        }
        if (entry.dirty || resized || !entry.visible) {
          const r = node.getBoundingClientRect();
          entry.size = { width: r.width, height: r.height };
          // Growing/shrinking information must never drag a window after the fleet.
          // Only a user gesture or viewport resize clamps the remembered position.
          if (resized || !entry.visible || !entry.point) apply(entry);
          else {
            node.style.setProperty('left', `${Math.round(entry.point.x)}px`, 'important');
            node.style.setProperty('top', `${Math.round(entry.point.y)}px`, 'important');
            node.style.setProperty('--holo-window-room', `${Math.max(80, height - entry.point.y - 12)}px`);
          }
          entry.dirty = false;
        }
        for (const header of node.querySelectorAll<HTMLElement>(entry.handles)) {
          header.classList.add('holo-drag-handle');
          header.tabIndex = 0;
          header.title = t('hud.window.move');
          header.setAttribute('aria-label', t('hud.window.move'));
        }
        entry.visible = true;
      }
    },
  };
}
