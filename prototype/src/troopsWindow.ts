/** A separate transfer dialog; game orders still go through the fleet dispatcher. */
export function initTroopsWindow(host: {
  root: HTMLElement;
  command(event: Event): void;
  cancel(): void;
}) {
  const { root } = host;
  const content = root.querySelector<HTMLElement>('.troops-content')!;
  const fleet = root.querySelector<HTMLElement>('.troops-fleet')!;
  const closeButton = root.querySelector<HTMLButtonElement>('[data-cmd="tcancel"]')!;
  let lastHtml = '';
  let opener: HTMLElement | null = null;
  root.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.target === root) host.cancel();
    else if (!(event.target instanceof HTMLInputElement)) host.command(event);
  });
  root.addEventListener('change', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.dataset.cmd === 'tset') host.command(event);
  });
  root.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'range') return;
    const number = input.closest('.trow')?.querySelector<HTMLInputElement>('input[type="number"]');
    if (number) number.value = input.value;
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') event.stopPropagation();
    const tab = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const direction = event.key === 'Home' ? 'load' : event.key === 'End' ? 'unload'
        : tab.dataset.direction === 'load' ? 'unload' : 'load';
      root.querySelector<HTMLButtonElement>(`[data-direction="${direction}"]`)?.click();
      root.querySelector<HTMLButtonElement>(`[data-direction="${direction}"]`)?.focus();
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = [...root.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]),input:not([disabled])')];
    const edge = event.shiftKey ? buttons[0] : buttons.at(-1);
    if (document.activeElement === edge) {
      event.preventDefault();
      (event.shiftKey ? buttons.at(-1) : buttons[0])?.focus();
    }
  });
  return {
    isOpen: (): boolean => !root.hidden,
    close: (): void => host.cancel(),
    render(html: string, fleetName = ''): void {
      const opening = root.hidden && !!html;
      const closing = !root.hidden && !html;
      const focusedInside = closing && root.contains(document.activeElement);
      if (opening) opener = document.activeElement as HTMLElement | null;
      if (root.hidden !== !html) root.hidden = !html;
      if (fleet.textContent !== fleetName) fleet.textContent = fleetName;
      if (html !== lastHtml) {
        // Do not replace a native slider under an active touch/pointer drag.
        if (content.querySelector('input:active')) return;
        const scrollTop = content.querySelector<HTMLElement>('.tlist')?.scrollTop ?? 0;
        const active = document.activeElement as HTMLButtonElement | HTMLInputElement | null;
        const focused = active && content.contains(active) ? { dataset: { ...active.dataset }, type: active.type } : null;
        content.innerHTML = html;
        lastHtml = html;
        const list = content.querySelector<HTMLElement>('.tlist');
        if (list) list.scrollTop = scrollTop;
        if (focused)
          [...content.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input')].find((button) =>
            button.type === focused.type && ['cmd', 'group', 'n', 'dir', 'first', 'direction'].every((key) => button.dataset[key] === focused.dataset[key]),
          )?.focus({ preventScroll: true });
      }
      if (opening) closeButton.focus({ preventScroll: true });
      if (closing) {
        if (focusedInside) {
          const previous = opener;
          // Both command and selection rendering can replace the launcher on close.
          queueMicrotask(() => {
            if (!root.hidden || (document.activeElement !== document.body && !root.contains(document.activeElement))) return;
            const target = previous?.isConnected ? previous :
              [...document.querySelectorAll<HTMLButtonElement>('[data-cmd="troops"]')]
                .find((button) => !button.disabled && button.getClientRects().length > 0);
            target?.focus({ preventScroll: true });
          });
        }
        opener = null;
      }
    },
  };
}
