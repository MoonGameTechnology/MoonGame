/**
 * Клавиши полосы вкладок (шаблон WAI-ARIA tabs): стрелки ходят по кругу, Home и End
 * ведут к краям, прочие клавиши вкладку не меняют.
 */

/** Индекс вкладки после клавиши `key` или `null`, если клавиша не про вкладки. */
export function tabKeyIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index - 1 + count) % count;
  return null;
}
