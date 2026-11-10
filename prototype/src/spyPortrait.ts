/**
 * Портрет шпиона во вкладке «Шпионаж»: силуэт в шляпе на цветном фоне, свой у каждого
 * позывного, и галочки уровня в правом верхнем углу (заказ владельца 2026-11-10). Готового
 * арта шпионов нет («делай пока как сам можешь»), поэтому портрет рисуется SVG по номеру
 * позывного: те же черты у того же шпиона в каждом окне.
 */

/** Фон, пальто и шляпа: пары подобраны под тёмное стекло окон. */
const BACKS = ['#1d3b4f', '#3b2a4f', '#2f4a32', '#4f3424', '#24384f', '#4a2a35', '#2e4648', '#45402a'];
const COATS = ['#0d1418', '#1a1410', '#10151c', '#181018'];
const HATS = ['#0a0f12', '#221a12', '#121a22', '#1c1216'];

/** Черта по номеру позывного: разные множители, чтобы соседние номера не совпадали. */
const pick = <T,>(list: readonly T[], seed: number, k: number): T => list[(seed * k + k) % list.length]!;

/** Галочки уровня (0–3) в правом верхнем углу портрета. */
function levelMarks(level: number): string {
  let out = '';
  for (let i = 0; i < level; i++) {
    const x = 56 - i * 11;
    out +=
      `<circle cx="${x}" cy="8" r="5" fill="#0f2a1c" stroke="#5fe39a" stroke-width="1"/>` +
      `<path d="M${x - 2.6} 8.2l1.8 1.9 3.4-3.8" fill="none" stroke="#5fe39a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return out;
}

/** Портрет шпиона с позывным `seed` и уровнем `level` (галочки). */
export function spyPortraitSvg(seed: number, level: number): string {
  const back = pick(BACKS, seed, 1);
  const coat = pick(COATS, seed, 3);
  const hat = pick(HATS, seed, 5);
  const brim = 10 + (seed % 3) * 2; // поля шляпы: узкие, средние, широкие
  const glasses = seed % 4 === 1;
  const collar = seed % 2 === 0;
  return (
    `<svg class="spy-photo" viewBox="0 0 64 64" aria-hidden="true">` +
    `<rect width="64" height="64" rx="8" fill="${back}"/>` +
    `<path d="M10 64c0-14 9-21 22-21s22 7 22 21z" fill="${coat}"/>` +
    (collar ? `<path d="M25 44l7 9 7-9-7 3z" fill="#2a3b44"/>` : `<path d="M28 44h8l-4 8z" fill="#5a2a2a"/>`) +
    `<ellipse cx="32" cy="32" rx="9" ry="10.5" fill="#0b1013"/>` +
    (glasses ? `<rect x="25" y="30" width="14" height="3" rx="1.5" fill="#7fd6ff" opacity="0.8"/>` : '') +
    `<ellipse cx="32" cy="24" rx="${brim + 4}" ry="3" fill="${hat}"/>` +
    `<path d="M23 24c0-8 4-11 9-11s9 3 9 11z" fill="${hat}"/>` +
    `<rect x="23" y="20.5" width="18" height="2" fill="#3a4a52"/>` +
    levelMarks(Math.max(0, Math.min(3, Math.floor(level)))) +
    `</svg>`
  );
}

/** Значок кнопки «Шпионы» на карточке мира: силуэт в шляпе цветом текста. */
export const SPY_GLYPH_SVG =
  `<svg class="spy-glyph" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">` +
  `<ellipse cx="12" cy="8.6" rx="8" ry="1.4"/><path d="M8 8.6c0-3.6 1.8-5 4-5s4 1.4 4 5z"/>` +
  `<ellipse cx="12" cy="12.4" rx="3.4" ry="3.6"/><path d="M4 22c0-5 3.6-7.4 8-7.4s8 2.4 8 7.4z"/></svg>`;
