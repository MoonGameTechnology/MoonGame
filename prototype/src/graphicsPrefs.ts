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
 * Форма REFM: имена функций сохранены (`fxBlur`, `pcUi`, `compactUi`), поэтому их вызовы
 * в рендере не изменились — переехало только объявление.
 */
import { readBool, writeBool } from './prefs';

/** Свечение и ореолы: мягкие диски вокруг миров, флотов и границ. По умолчанию ВКЛ. */
let glowFx = readBool('void.glowFx', true);
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

/** Компактный режим меню (только ПК): плотнее отступы, мельче типографика. По умолчанию
 *  ВЫКЛ. Едет классом на `body` — саму панель переверстывает CSS, разметка не меняется. */
let compactPanel = readBool('void.compactPanel', false);
export const compactPanelOn = (): boolean => compactPanel;
export function setCompactPanel(v: boolean): void {
  compactPanel = v;
  writeBool('void.compactPanel', v);
}

/** Повесить/снять класс компактного режима. Зовётся на старте и при переключении. */
export function applyCompactPanel(doc: Document = document): void {
  doc.body.classList.toggle('compact-panel', compactPanel);
}

/** Медиа-запрос ПК-раскладки — тот же, на котором висит ПК-часть CSS. */
const PC_FINE =
  typeof matchMedia !== 'undefined'
    ? matchMedia('(min-width:900px) and (hover:hover) and (pointer:fine)')
    : null;

/** Правда только в ПК-раскладке. Любая ПК-подстройка на стороне JS ОБЯЗАНА ехать на этом
 *  гейте — мобильная сборка заморожена. */
export function pcUi(): boolean {
  return PC_FINE?.matches ?? false;
}

/** Компактная подача включена И мы на ПК. Сокращение строк на стороне JS должно идти по
 *  тому же гейту, что и CSS: иначе телефон с включённой настройкой получил бы ПК-тексты
 *  под телефонной вёрсткой. */
export function compactUi(): boolean {
  return compactPanel && pcUi();
}
