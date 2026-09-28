/**
 * Графические настройки клиента — косметика и режим верстки (REFM-21).
 *
 * Всё здесь client-only: на сервер не уходит, симуляции не касается. Значения живут в
 * `localStorage` через общее правило чтения/записи (`prefs.ts`, REFM-16), поэтому
 * отсутствие ключа честно означает «значение по умолчанию», а не «выключено».
 *
 * Почему тумблер свечения — это не просто «не рисовать диски». `blitGlow` слушался
 * настройки и раньше, а вот два десятка `cx.shadowBlur = n` по всему рендеру — нет. На
 * мобильных GPU попиксельное размытие едва ли не самая дорогая операция канвы, поэтому
 * «Свечение и ореолы: выкл» убирало картинку, но не стоимость кадра. `fxBlur` — тот
 * единственный кран, через который теперь проходят ВСЕ размытия.
 *
 * Форма REFM: имена функций сохранены (`fxBlur`, `pcUi`), поэтому их вызовы в рендере не
 * изменились — переехало только объявление.
 */
import { readBool, readRaw, writeBool, writeRaw } from './prefs';
import { breath, type Breath } from './pulseFx';

/**
 * Свечение и ореолы: мягкие диски вокруг миров, флотов и границ, широкие полосы рамки и
 * волны голограммы. По умолчанию — ПО УСТРОЙСТВУ: на сенсорном (телефон, планшет) выкл,
 * с мышью вкл. Замер 2026-09-24 (жалоба владельца «сильно подтормаживает на телефоне»):
 * на телефоне голографическая карта включена всегда, и свечение её рамки и волны — это
 * 15 широких обводок с градиентом в режиме `screen` на кадр; без них кадр возвращается к
 * 60 даже без замедления процессора, с ними — ~50, а на слабом процессоре кадр тянется
 * к 100 мс. Явный тумблер игрока перекрывает умолчание в обе стороны — как у движения.
 */
export function defaultGlowFx(coarsePointer: boolean): boolean {
  return !coarsePointer;
}
function systemCoarsePointer(): boolean {
  // matchMedia нет в node (тесты, харнессы) — там честный ответ «устройство с мышью».
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}
let glowFx = readBool('void.glowFx', defaultGlowFx(systemCoarsePointer()));
export const glowOn = (): boolean => glowFx;
export function setGlowFx(v: boolean): void {
  glowFx = v;
  writeBool('void.glowFx', v);
}

/** Единственный кран для `cx.shadowBlur`. Выключенное свечение обнуляет ВСЕ размытия —
 *  и картинку, и их цену в кадре (см. шапку модуля). */
export function fxBlur(n: number): number {
  return glowFx ? n : 0;
}

/**
 * Движение: непрерывное «дыхание» живых слоёв карты (метка контакта, свечение владельца,
 * двигатели флота, луч обстрела, кольцо плана — `pulseFx`).
 *
 * ПО УМОЛЧАНИЮ БЕРЁТСЯ ИЗ СИСТЕМЫ. `prefers-reduced-motion: reduce` — это заявленная
 * потребность человека (вестибулярные расстройства, укачивание), а не предпочтение
 * оформления, поэтому она уважается ДО того, как игрок откроет настройки. Явный тумблер
 * потом перекрывает системный ответ в обе стороны.
 *
 * Выключенное движение НЕ убирает слой, а замораживает его в СЕРЕДИНЕ размаха
 * (`Breath.base`): информация остаётся на экране, уходит только колебание. Убрать слой
 * значило бы отнять у игрока сигнал вместо того, чтобы отнять качание — именно этой
 * ошибкой чаще всего и заканчивается «поддержка reduced motion».
 *
 * Побочная выгода на телефоне: замороженный слой не пересчитывает синус каждый кадр на
 * каждом живом объекте — дешевле и по CPU, и по батарее.
 */
function systemPrefersReducedMotion(): boolean {
  // matchMedia нет в node (тесты, харнессы) — там честный ответ «система молчит».
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
let motion = readBool('void.motion', !systemPrefersReducedMotion());
export const motionOn = (): boolean => motion;
export function setMotion(v: boolean): void {
  motion = v;
  writeBool('void.motion', v);
}

/** Единственный кран для дыхания слоёв — аналог {@link fxBlur} для движения.
 *  Выключено → середина размаха, то есть слой виден и неподвижен. */
export function fxBreath(now: number, b: Breath): number {
  return motion ? breath(now, b) : b.base;
}

/** Глубокий космос: дрейфующие туманности и звёздные точки, запечённые в статический
 *  слой. Выкл оставляет плоскую заливку и сетку. По умолчанию ВКЛ.
 *  Переключение обязано пересобрать запечённый слой — флаг входит в его сигнатуру. */
let starfield = readBool('void.starfield', true);
export const starfieldOn = (): boolean => starfield;
export function setStarfield(v: boolean): void {
  starfield = v;
  writeBool('void.starfield', v);
}

/** Счётчик кадров в углу. По умолчанию ВЫКЛ (dev-режим и рассинхрон включают его сами). */
let showFps = readBool('void.showFps', false);
export const showFpsOn = (): boolean => showFps;
export function setShowFps(v: boolean): void {
  showFps = v;
  writeBool('void.showFps', v);
}

/**
 * Непрозрачность окон голографического интерфейса (ПК и планшет) — ползунок «Графики»,
 * заказ владельца 2026-09-27: «от максимального до непрозрачного». Хранится процентом
 * ползунка (0..100), в стекло окон уходит альфой {@link windowAlpha}.
 *
 * Самое прозрачное стекло — не пустое (`WINDOW_ALPHA_MIN`): окно без фона — это текст,
 * висящий над картой, и размытие под ним его уже не спасает. По умолчанию — 90%, то есть
 * альфа .93: то самое стекло (.94), что было до ползунка, с точностью до его шага.
 */
const WINDOW_ALPHA_MIN = 0.3;
export const WINDOW_OPACITY_DEFAULT = 90;
const clampPct = (v: number): number => Math.max(0, Math.min(100, v));

/** Альфа стекла окон по проценту ползунка. */
export function windowAlpha(pct: number): number {
  const p = Number.isFinite(pct) ? clampPct(pct) : WINDOW_OPACITY_DEFAULT;
  return Math.round((WINDOW_ALPHA_MIN + ((1 - WINDOW_ALPHA_MIN) * p) / 100) * 1000) / 1000;
}

/** Процент из хранилища; ключа нет или там не число — значение по умолчанию. */
function readWindowOpacity(): number {
  const raw = readRaw('void.windowOpacity');
  const n = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? clampPct(n) : WINDOW_OPACITY_DEFAULT;
}
let windowOpacity = readWindowOpacity();
export const windowOpacityPct = (): number => windowOpacity;
export function setWindowOpacity(pct: number): void {
  windowOpacity = Number.isFinite(pct) ? clampPct(pct) : WINDOW_OPACITY_DEFAULT;
  writeRaw('void.windowOpacity', String(windowOpacity));
}

/** Медиа-запрос ПК-раскладки — тот же, на котором висит ПК-часть CSS. */
const PC_FINE =
  typeof matchMedia !== 'undefined'
    ? matchMedia('(min-width:900px) and (hover:hover) and (pointer:fine)')
    : null;

/** Правда только в ПК-раскладке. Настольный ввод отделён от телефонного интерфейса
 *  и старого планшетного ввода. */
export function pcUi(): boolean {
  return PC_FINE?.matches ?? false;
}
