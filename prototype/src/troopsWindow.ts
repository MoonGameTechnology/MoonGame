/** A separate transfer dialog; game orders still go through the fleet dispatcher. */
export function initTroopsWindow(host: {
  root: HTMLElement;
  command(event: MouseEvent): void;
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
    else host.command(event);
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') event.stopPropagation();
    if (event.key !== 'Tab') return;
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
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
        const scrollTop = content.querySelector<HTMLElement>('.tlist')?.scrollTop ?? 0;
        const active = document.activeElement as HTMLButtonElement | null;
        const focused = active && content.contains(active) ? { ...active.dataset } : null;
        content.innerHTML = html;
        lastHtml = html;
        const list = content.querySelector<HTMLElement>('.tlist');
        if (list) list.scrollTop = scrollTop;
        if (focused)
          [...content.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
            ['cmd', 'group', 'n', 'dir', 'first'].every((key) => button.dataset[key] === focused[key]),
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
