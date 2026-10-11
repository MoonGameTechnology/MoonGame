/**
 * Экран загрузки карты (REFM-241): заставка с прогрессом и цитатой, «Отмена» входа и
 * подготовка карты по заданиям, пока заставка закрывает холст.
 *
 * Модуль решает, КОГДА готовить карту (первый вход в матч, новая карта, смена окна посреди
 * подготовки) и что показать на заставке. ЧТО готовить — рецепт рисования (фон, выпечка,
 * местность) — приходит хуком `jobs`: это зона карты, и её правят, не трогая заставку.
 *
 * Подготовку `mapPreparation` и признак входа `mapWasEntered` снаружи только читают. Новую
 * подготовку заказывает дверь `needMapPreparation`, заставку снимает `hideMapLoading`, в меню
 * уводит `leaveLoadingMap`. Вход в матч, ключ окна, задания, сброс выпечки при сбое и уход в
 * меню модуль получает хуками `initMapLoading(host)`.
 */
import { t } from '../../localization/runtime';
import { MapPreparation, type PreparationJob } from './mapPreparation';

/** Что заставке нужно от игры. */
export interface MapLoadingHost {
  /** Игрок в матче: локальном или сетевом после допуска. */
  entered(): boolean;
  /** Ключ окна: размер, плотность пикселей, голограмма. Сменился посреди подготовки — заново. */
  viewport(): string;
  /** Задания подготовки карты по порядку — рецепт рисования. */
  jobs(): PreparationJob[];
  /** Подготовка упала: карта забывает выпечку и рисуется обычным путём. */
  failed(): void;
  /** Уйти в меню тем же путём, что кнопка HUD. */
  leave(): void;
}

let game: MapLoadingHost;
let canvas: HTMLElement;
let screen: HTMLElement;
let bar: HTMLProgressElement;
let status: HTMLElement;
let percent: HTMLElement;
let quote: HTMLElement;
let cancel: HTMLElement;

/** Подготовка карты за заставкой. Снаружи только читают: кадр ждёт её готовности. */
export const mapPreparation = new MapPreparation();
let mapNeedsPreparation = true;
/** Игрок уже вошёл в эту карту, и заставка второй раз не встаёт. Снаружи только читают. */
export let mapWasEntered = false;
let mapLoadingViewport = '';
let mapQuoteIndex = 0;

/** Подключить заставку `#maploading`: «Отмена» и перехват клавиш на время подготовки. */
export function initMapLoading(host: MapLoadingHost): void {
  game = host;
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  canvas = $('map');
  screen = $('maploading');
  bar = $('maploading-progress') as HTMLProgressElement;
  status = $('maploading-status');
  percent = $('maploading-percent');
  quote = $('maploading-quote');
  cancel = $('maploading-cancel');
  cancel.addEventListener('click', leaveLoadingMap);
  window.addEventListener(
    'keydown',
    (e) => {
      if (!mapPreparation.active || e.key === 'Escape') return;
      // The focused exit button stays usable; no map shortcuts reach the hidden HUD.
      if ((e.key === 'Enter' || e.key === ' ') && e.target === cancel) {
        e.stopImmediatePropagation();
        return; // retain the native button activation, but no map shortcut
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
}

/** Новая карта или новый матч: при следующем входе карта готовится заново. */
export function needMapPreparation(): void {
  mapNeedsPreparation = true;
}

export function hideMapLoading(): void {
  mapPreparation.cancel();
  screen.style.display = 'none';
  canvas.removeAttribute('aria-busy');
  if (document.activeElement === cancel) canvas.focus({ preventScroll: true });
}

export function leaveLoadingMap(): void {
  hideMapLoading();
  game.leave();
}

/** Begin only after admission and the viewport adapters have framed the real map. */
export function prepareEnteringMap(): boolean {
  if (!game.entered()) {
    if (mapPreparation.active) hideMapLoading();
    mapWasEntered = false;
    return false;
  }
  const viewport = game.viewport();
  if (
    !mapWasEntered ||
    mapNeedsPreparation ||
    (mapPreparation.active && viewport !== mapLoadingViewport)
  ) {
    const restarting = mapPreparation.active;
    mapWasEntered = true;
    mapNeedsPreparation = false;
    mapLoadingViewport = viewport;
    screen.style.display = 'flex';
    canvas.setAttribute('aria-busy', 'true');
    if (!restarting) {
      const quotes = [
        t('map-loading.quote.fleet'),
        t('map-loading.quote.frontier'),
        t('map-loading.quote.silence'),
      ];
      quote.textContent = quotes[mapQuoteIndex++ % quotes.length]!;
      cancel.focus({ preventScroll: true });
    }
    void mapPreparation
      .start(game.jobs(), (done, total, label) => {
        bar.max = total;
        bar.value = done;
        percent.textContent = t('map-loading.progress', { n: Math.round((done * 100) / total) });
        if (status.textContent !== label) status.textContent = label;
      })
      .catch((error) => {
        console.warn('map preparation failed', error);
        game.failed();
        hideMapLoading(); // ordinary rendering retains its existing error handling
      });
  }
  return mapPreparation.active && !mapPreparation.ready;
}
