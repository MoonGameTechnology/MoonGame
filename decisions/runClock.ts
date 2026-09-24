/**
 * Часы ЗАБЕГА — как игрок читает время в Sector Zero (решение владельца 2026-09-24).
 * Чистое решение обоих клиентов.
 *
 * Мир забега идёт в игровых часах, но на обычном темпе ▶ ({@link RUN_SPEED_NORMAL}) игровой
 * час длится 24 реальные секунды. Подпись «6 ч до волны» или «+13/ч» в таком мире врёт
 * игроку о том, сколько ему ждать: волна придёт через две с половиной минуты. Поэтому в
 * забеге время читается РЕАЛЬНЫМ — отсчёты в минутах и секундах, приток в минуту, — и
 * пересчитывается по ОБЫЧНОМУ темпу, а не по текущему: на ▶▶ те же таймеры просто идут
 * быстрее, а на паузе стоят. Иначе число прыгало бы при каждом переключении скорости.
 *
 * Время мира — миллисекунды (`HOUR` = 3 600 000), и ×1 — настенные часы: реальных
 * миллисекунд в отрезке ровно `gameMs / mult`.
 */
import { RUN_SPEED_NORMAL } from './runTempo';

/** Сколько реальных секунд занимает отрезок мира на темпе `mult`. */
export function runRealSeconds(gameMs: number, mult: number = RUN_SPEED_NORMAL): number {
  return Math.max(0, gameMs) / mult / 1000;
}

/**
 * Отсчёт «м:сс», от часа — «ч:мм:сс». Секунды округляются ВВЕРХ: пока до события
 * остаётся хоть доля секунды, на табло не «0:00» — иначе игрок видел бы ноль при ещё
 * не наступившей волне.
 */
export function runClockText(gameMs: number, mult: number = RUN_SPEED_NORMAL): string {
  const total = Math.ceil(runRealSeconds(gameMs, mult) - 1e-9);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h > 0 ? `${h}:${p2(m)}:${p2(sec)}` : `${m}:${p2(sec)}`;
}

/** Приток за реальную минуту на темпе `mult` из притока за игровой час. */
export function runPerMinute(perHour: number, mult: number = RUN_SPEED_NORMAL): number {
  return (perHour * mult) / 60;
}
