/** Потолок кадров клиента: экран остаётся хозяином rAF, часы мира не меняются. */
export const FRAME_RATES = ['30', '60', '90', '120', 'auto'] as const;
export type FrameRate = (typeof FRAME_RATES)[number];
export const DEFAULT_FRAME_RATE: FrameRate = '60';

export function isFrameRate(value: unknown): value is FrameRate {
  return FRAME_RATES.some((mode) => mode === value);
}

export function frameRateOf(value: unknown): FrameRate {
  return isFrameRate(value) ? value : DEFAULT_FRAME_RATE;
}

export interface FrameSlot {
  mode: FrameRate;
  at: number;
  nextAt: number;
}

/**
 * `null` — этот rAF пропускаем. Срок идёт от предыдущего срока, а не от фактического
 * кадра: иначе 60 на экране 90 Гц превращается в 45. После фона не догоняем кадры.
 * Допуск — только от погрешности timestamp; он не накапливается в сроке.
 */
export function nextFrameSlot(
  previous: FrameSlot | null,
  now: number,
  mode: FrameRate,
): FrameSlot | null {
  const period = mode === 'auto' ? 0 : 1000 / Number(mode);
  const tolerance = 0.1;
  if (
    !previous ||
    previous.mode !== mode ||
    mode === 'auto' ||
    now < previous.at ||
    now - previous.at >= 1000
  )
    return { mode, at: now, nextAt: now + period };
  if (now + tolerance < previous.nextAt) return null;
  const slots = Math.floor((now + tolerance - previous.nextAt) / period) + 1;
  return { mode, at: now, nextAt: previous.nextAt + slots * period };
}
