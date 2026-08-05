/**
 * Вьюпорт и звёздный фон галактики (REFM-24).
 *
 * Две вещи, которые стоит проверять тестом, а не глазами:
 *
 *  · **потолок плотности пикселей.** Канва 2D упирается в fill-rate, а цена кадра растёт
 *    как DPR²: телефон с 3× (обычное дело на Android) рисовал бы вдевятеро больше
 *    пикселей без видимой разницы на расстоянии вытянутой руки — это причина №1, по
 *    которой в АПК проседал FPS. Потолок 2× остаётся чётким на retina.
 *  · **что считать телефоном.** По одной ширине ЛАНДШАФТНЫЙ телефон (широкий, но низкий,
 *    палец вместо мыши) проваливался в десктопную раскладку, которая живёт на hover.
 *    Поэтому короткий вьюпорт с грубым указателем — тоже телефон.
 *
 * Фон (звёзды и туманности) детерминирован: он раскладывается синусами от индекса, а не
 * `Math.random()`, поэтому одна и та же картинка выходит в каждом запуске и её можно
 * запечь в статический слой. Значения нормализованы 0..1 — привязка к экрану происходит
 * при отрисовке, так что смена размера окна фон не пересобирает.
 *
 * Форма REFM: `STARS` и `NEBULAE` экспортируются ПОД ТЕМИ ЖЕ именами, поэтому их чтения
 * в рендере не изменились — переехало только объявление.
 */

/** Потолок плотности пикселей. Выше — только цена кадра (см. шапку модуля). */
export const MAX_DPR = 2;

/** Уже телефон по ширине. */
export const PHONE_W = 720;

/** Низкий вьюпорт: с грубым указателем это ландшафтный телефон, а не маленькое окно ПК. */
export const SHORT_H = 520;

/** Плотность пикселей с потолком. Мусор от окружения (0, NaN) читается как 1×. */
export function capDpr(raw: number): number {
  return Math.min(raw || 1, MAX_DPR);
}

/** Телефонная раскладка: узко ИЛИ низко под палец. Десктопная раскладка зависит от
 *  hover, поэтому ошибиться в эту сторону дороже, чем в обратную. */
export function isMobileViewport(w: number, h: number, coarsePointer: boolean): boolean {
  return w < PHONE_W || (coarsePointer && h < SHORT_H);
}

/** Замер вьюпорта. */
export interface ViewportMetrics {
  /** Ширина и высота в CSS-пикселях — на них стоят и раскладка, и проекция карты. */
  w: number;
  h: number;
  dpr: number;
  mobile: boolean;
}

/** Снять замер с окна. Вне браузера (тесты, сборка) — рабочий стол 1280×720. */
export function measureViewport(win: Window | undefined = globalThis.window): ViewportMetrics {
  if (!win) return { w: 1280, h: 720, dpr: 1, mobile: false };
  const w = win.innerWidth;
  const h = win.innerHeight;
  const coarse = win.matchMedia?.('(pointer: coarse)').matches ?? false;
  return { w, h, dpr: capDpr(win.devicePixelRatio), mobile: isMobileViewport(w, h, coarse) };
}

/** Дробная часть синуса — дешёвый детерминированный «шум» по индексу. */
const noise = (i: number, mul: number, amp: number): number =>
  (((Math.sin(i * mul) * amp) % 1) + 1) % 1;

/** Звезда фона: нормализованные координаты, яркость и фаза мерцания. */
export interface Star {
  x: number;
  y: number;
  b: number;
  phase: number;
}

/** Туманность: нормализованный центр, радиус в пикселях карты, цвет и фаза дрейфа. */
export interface Nebula {
  x: number;
  y: number;
  r: number;
  color: string;
  phase: number;
}

/** Слабые звёздные точки — рисуются тусклыми векторными штрихами. */
export function makeStars(n: number): Star[] {
  return Array.from({ length: n }, (_, i) => ({
    x: noise(i, 12.9898, 43758.5453),
    y: noise(i, 78.233, 12543.1234),
    b: 0.12 + noise(i, 3.71, 9281.77) * 0.45,
    phase: i * 0.37,
  }));
}

/** Туманности глубокого космоса: два цвета через одну, чтобы фон не был одноцветным. */
export function makeNebulae(n: number): Nebula[] {
  return Array.from({ length: n }, (_, i) => ({
    x: noise(i, 21.771, 36137.13),
    y: noise(i, 9.317, 21891.41),
    r: 160 + noise(i, 15.913, 11923.71) * 180,
    color: i % 2 ? '#8f6dff' : '#35d6e6',
    phase: i * 1.7,
  }));
}

export const STARS: readonly Star[] = makeStars(280);
export const NEBULAE: readonly Nebula[] = makeNebulae(5);
