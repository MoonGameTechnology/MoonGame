/**
 * Прокручиваемая полоса вкладок после перерисовки: прежняя прокрутка возвращается, а
 * выбранная вкладка дотягивается в видимую часть (вынесено из `corpScreen.ts`).
 */
export function keepTabInView(tabs: HTMLElement | null, scrollLeft: number): void {
  if (!tabs) return;
  tabs.scrollLeft = scrollLeft;
  const selected = tabs.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!selected) return;
  const box = selected.getBoundingClientRect();
  const frame = tabs.getBoundingClientRect();
  if (box.left < frame.left) tabs.scrollLeft -= frame.left - box.left;
  else if (box.right > frame.right) tabs.scrollLeft += box.right - frame.right;
}
