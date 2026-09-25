/**
 * Ритм кольца цели задачи на карте забега (заказ владельца 2026-09-24: «сделай анимацию
 * кружка миссии на карте»).
 *
 * Кольцо и раньше «дышало» яркостью, но на загруженной карте это почти не читалось. Теперь
 * у него три слоя движения, и каждый говорит одно — «тебе сюда»:
 *  - пунктир бежит по кругу — кольцо живое, а не декор;
 *  - от кольца раз в {@link RIPPLE_MS} расходится волна, как сонар, — её видно краем глаза;
 *  - яркость и свечение дышат, как прежде.
 *
 * Часы — визуальные (`hologramTime` хоста): стоят на паузе и при отключённой анимации.
 * Без анимации (`motion = false`) кольцо неподвижно: пунктир на месте, волны нет, яркость
 * средняя — метка остаётся видимой, но не мигает.
 */

/** Период волны, мс. */
export const RIPPLE_MS = 2400;
/** Радиус самого кольца на карте, px. */
export const RING_R = 24;
/** Докуда расходится волна, px. */
export const RIPPLE_REACH = 26;
/** Скорость бега пунктира: мс часов на пиксель. */
const DASH_MS_PER_PX = 60;
/** Период дыхания яркости (как было до волны). */
const BREATH_MS = 520;

export interface MissionRingFrame {
  /** 0..1 — яркость и свечение кольца. */
  breath: number;
  /** Смещение пунктира (`lineDashOffset`), px. */
  dashOffset: number;
  /** Волна: радиус и прозрачность. `null` — волны нет (анимация выключена). */
  ripple: { r: number; alpha: number } | null;
}

export function missionRingFrame(clock: number, motion: boolean): MissionRingFrame {
  if (!motion) return { breath: 0.5, dashOffset: 0, ripple: null };
  const k = (((clock % RIPPLE_MS) + RIPPLE_MS) % RIPPLE_MS) / RIPPLE_MS;
  return {
    breath: 0.5 + 0.5 * Math.sin(clock / BREATH_MS),
    dashOffset: -clock / DASH_MS_PER_PX,
    // Волна гаснет к краю квадратично: у кольца она заметна, у предела — растворяется.
    ripple: { r: RING_R + k * RIPPLE_REACH, alpha: 0.6 * (1 - k) * (1 - k) },
  };
}
