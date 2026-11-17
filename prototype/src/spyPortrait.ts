/**
 * Портрет шпиона во вкладке «Шпионаж»: одно из десяти нарисованных лиц
 * (`spyPortraitArt.ts`, заказ владельца 2026-11-17) и галочки уровня в правом верхнем
 * углу (заказ 2026-11-10). Лицо выбирается по номеру позывного, так что один шпион везде
 * выглядит одинаково; позывных больше десяти, и на 11-м лица идут по кругу. Скругление
 * кадра — `border-radius` у `.spy-photo` (`styles/12-spies.css`).
 */
import { SPY_FACES } from './spyPortraitArt';

/** Галочки уровня (0–3) в правом верхнем углу портрета (кадр 96×96). */
function levelMarks(level: number): string {
  let out = '';
  for (let i = 0; i < level; i++) {
    const x = 84 - i * 16;
    out +=
      `<circle cx="${x}" cy="12" r="7.5" fill="#0f2a1c" stroke="#5fe39a" stroke-width="1.5"/>` +
      `<path d="M${x - 3.9} 12.3l2.7 2.8 5.1-5.7" fill="none" stroke="#5fe39a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return out;
}

/** Номер лица для позывного `callsign`. */
export const spyFaceIndex = (callsign: number): number =>
  ((Math.floor(callsign) % SPY_FACES.length) + SPY_FACES.length) % SPY_FACES.length;

/**
 * Лица для списка живых шпионов (позывные в порядке `id`): каждому — своё по позывному,
 * а при совпадении с уже взятым — следующее свободное, как правило 3 `spyRoster.ts`
 * выдаёт позывные. Так два живых шпиона не ходят с одним лицом, пока их не больше десяти.
 */
export function spyFaceIndexes(callsigns: readonly number[]): number[] {
  const taken = new Set<number>();
  return callsigns.map((c) => {
    let idx = spyFaceIndex(c);
    for (let i = 0; i < SPY_FACES.length && taken.has(idx); i++) idx = (idx + 1) % SPY_FACES.length;
    taken.add(idx);
    return idx;
  });
}

/** Портрет: лицо `face` (из `spyFaceIndexes`) и уровень `level` (галочки). */
export function spyPortraitSvg(face: number, level: number): string {
  return (
    `<svg class="spy-photo" viewBox="0 0 96 96" aria-hidden="true">` +
    SPY_FACES[spyFaceIndex(face)]!() +
    levelMarks(Math.max(0, Math.min(3, Math.floor(level)))) +
    `</svg>`
  );
}

/** Значок кнопки «Шпионы» на карточке мира: силуэт в шляпе цветом текста. */
export const SPY_GLYPH_SVG =
  `<svg class="spy-glyph" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">` +
  `<ellipse cx="12" cy="8.6" rx="8" ry="1.4"/><path d="M8 8.6c0-3.6 1.8-5 4-5s4 1.4 4 5z"/>` +
  `<ellipse cx="12" cy="12.4" rx="3.4" ry="3.6"/><path d="M4 22c0-5 3.6-7.4 8-7.4s8 2.4 8 7.4z"/></svg>`;
