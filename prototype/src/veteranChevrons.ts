/**
 * Вид шевронов ветерана (решение — `decisions/veteranMark.ts`). Один цвет на все места —
 * золото медали: плитка, карточка корабля и ярлык флота на карте говорят одним знаком.
 */
import { esc } from './format';

/** Цвет шеврона — тот же тёплый золотой, что у медалей и трюма десанта. */
export const VETERAN_GOLD = '#f0c46a';

/** Столбик из `grade` шевронов остриём вверх (SVG), как нашивки на рукаве. */
export function chevronsSvg(grade: number): string {
  const n = Math.max(1, Math.floor(grade));
  const h = n * 4 + 3;
  const lines = Array.from({ length: n }, (_, i) => {
    const y = h - 2 - i * 4;
    return `<polyline points="1,${y} 5,${y - 3} 9,${y}"/>`;
  }).join('');
  return `<svg class="vet-chev" width="10" height="${h}" viewBox="0 0 10 ${h}" aria-hidden="true" fill="none" stroke="${VETERAN_GOLD}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${lines}</svg>`;
}

/** Метка ветерана для плитки/карточки: шевроны + подпись для подсказки и чтеца. */
export function veteranTag(mark: { grade: number; title: string }, cls: string): string {
  return `<span class="${cls}" title="${esc(mark.title)}" aria-label="${esc(mark.title)}">${chevronsSvg(mark.grade)}</span>`;
}

/** Один шеврон на канвасе — у ярлыка флота на карте. `(x, y)` — центр. */
export function drawChevron(cx: CanvasRenderingContext2D, x: number, y: number): void {
  cx.save();
  cx.strokeStyle = VETERAN_GOLD;
  cx.lineWidth = 2;
  cx.lineCap = 'round';
  cx.lineJoin = 'round';
  cx.beginPath();
  cx.moveTo(x - 4, y + 2.5);
  cx.lineTo(x, y - 2.5);
  cx.lineTo(x + 4, y + 2.5);
  cx.stroke();
  cx.restore();
}
