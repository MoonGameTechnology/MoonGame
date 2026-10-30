/**
 * Проводка окна настроек (REFM-248): хаб → «Ещё» → Настройки и кнопка на рельсе.
 *
 * Само окно (вкладки, разметка, нажатия) — `settingsOverlay.ts` (REFM-22). Настройками оно не
 * владеет: каждая живёт там, где её читают (графика — `graphicsPrefs.ts`, режим совместимости
 * канваса — `canvasCompatibility.ts`, цвета сторон — `mapPalette.ts`, развёртка радара —
 * `mapRadar.ts`), а окно только показывает снимок и отдаёт изменение обратно. Здесь — то, что
 * раньше стояло в `main.ts` вокруг окна: снимок для окна и его двери обратно, прозрачность окон
 * ПК, диагностика рендера карты и окно согласия на push. Всё, чем владеет игра (свои пинги,
 * звук, темп, экран, нижняя панель телефона, единица дохода, канвас и счётчик кадров), модуль
 * получает хуками.
 */
import type { PhoneItemId } from '../../decisions/phoneNav';
import type { RateUnit } from '../../decisions/rateUnit';
import { sharpnessMatters } from '../../decisions/mapSharpness';
import {
  canvasCompatibilityActive,
  canvasCompatibilityRequested,
  setCanvasCompatibility,
} from './canvasCompatibility';
import {
  glowOn,
  mapSharpOn,
  motionOn,
  pcUi,
  setGlowFx,
  setMapSharp,
  setMotion,
  setShowFps,
  setStarfield,
  setUiScale,
  setWindowOpacity,
  showFpsOn,
  starfieldOn,
  uiScalePct,
  windowAlpha,
  windowOpacityPct,
} from './graphicsPrefs';
import { hubAuthorizedBase } from './hubScreen';
import { cam } from './mapCamera';
import { backgroundContextEvents, bgx, mapContextEvents } from './mapLayer';
import { neutralColor, rivalPaletteId, setSideColors, youColor } from './mapPalette';
import { setSweepOpacity, sweepOpacity } from './mapRadar';
import { initPush } from './pushSetup';
import { blackBoxSessions } from './renderBlackBox';
import { initSettings } from './settingsOverlay';
import { serverMatchId } from './netSession';
import { COLOR } from './sideColors';
import type { SoundApi } from './sound';
import { currentBuild } from './updater';

declare const __SECTOR_ZERO_ONLY__: boolean;

/** Канвас карты и счётчики кадра — для диагностики рендера. */
export interface RenderProbe {
  canvas: HTMLCanvasElement;
  cx: CanvasRenderingContext2D;
  vw: number;
  vh: number;
  dpr: number;
  frameErrors: number;
  fps: number;
}

/** Что окну настроек даёт игра. */
export interface SettingsViewHost {
  ownPings(): boolean;
  setOwnPings(on: boolean): void;
  sound: SoundApi;
  /** Клавиши скорости (дев-настройка ПК). */
  speedKeys(): boolean;
  screenDpr(): number;
  mobile(): boolean;
  phoneBar(): readonly PhoneItemId[];
  setPhoneBar(bar: readonly PhoneItemId[]): void;
  rateUnit(): RateUnit;
  setRateUnit(unit: RateUnit): void;
  /** Пересчитать раскладку экрана: чёткость карты меняет плотность пикселей канваса. */
  resize(): void;
  probe(): RenderProbe;
}

let game: SettingsViewHost;
let root: HTMLElement;
let settings: ReturnType<typeof initSettings>;
/** Push-уведомления (UIX-4.4) — у владельца, `pushSetup.ts`: вопрос о согласии, worker, подписка
 *  и виды. В архиве площадки сервера нет — и push нет. */
export let push: ReturnType<typeof initPush> | null = null;

/** On-demand diagnostics: no pixel readbacks (those alter canvas heuristics),
 * no world/account state (of a match only its map preset and size), and no automatic
 * upload. Attributes are requests, not proof of which raster backend WebView actually
 * selected.
 */
function mapRenderingReport(): string {
  const { canvas, cx, vw, vh, dpr, frameErrors, fps } = game.probe();
  const rect = canvas.getBoundingClientRect();
  const active = canvasCompatibilityActive();
  const requested = canvasCompatibilityRequested();
  return JSON.stringify(
    {
      schema: 1,
      build: currentBuild(),
      userAgent: navigator.userAgent,
      compatibility: { active, requested, restartPending: active !== requested },
      viewport: {
        width: vw,
        height: vh,
        devicePixelRatio: window.devicePixelRatio,
        renderDpr: dpr,
        visualScale: window.visualViewport?.scale ?? null,
      },
      canvas: {
        width: canvas.width,
        height: canvas.height,
        cssWidth: rect.width,
        cssHeight: rect.height,
        attributes: cx.getContextAttributes?.() ?? null,
        contextLost: cx.isContextLost?.() ?? null,
        events: { ...mapContextEvents },
      },
      background: {
        attributes: bgx.getContextAttributes?.() ?? null,
        contextLost: bgx.isContextLost?.() ?? null,
        events: { ...backgroundContextEvents },
      },
      frameErrors,
      estimatedFps: Math.round(fps),
      cameraScale: cam.scale,
      // Этот запуск и прошлые: остановки кадров, чьи они, последний снимок перед обрывом.
      blackBox: blackBoxSessions(),
    },
    null,
    2,
  );
}

/** Стекло окон ПК и планшета берёт альфу из переменной на `body` (`holographic.css`). */
function applyWindowOpacity(): void {
  document.body.style.setProperty('--holo-window-alpha', String(windowAlpha(windowOpacityPct())));
}

/** Окно настроек; вход и подписка перечитываются — вкладка «Уведомления» покажет их свежими. */
export function openSettings(): void {
  settings.open();
  push?.refresh().catch(() => undefined); // не вышло перечитать — вкладка покажет прошлое
}

export function initSettingsView(host: SettingsViewHost): void {
  game = host;
  root = document.getElementById('settings') as HTMLElement;
  applyWindowOpacity();
  const snd = host.sound;
  settings = initSettings({
    root: () => root,
    view: () => ({
      sweepOpacity,
      ownPings: game.ownPings(),
      glow: glowOn(),
      starfield: starfieldOn(),
      motion: motionOn(),
      renderCompatibility: canvasCompatibilityRequested(),
      renderCompatibilityActive: canvasCompatibilityActive(),
      renderCompatibilitySupported: /Android/i.test(navigator.userAgent),
      fps: showFpsOn(),
      soundOn: snd.enabled(),
      volume: snd.volume(),
      youColor,
      neutralColor,
      palette: rivalPaletteId,
      touchOnly: !pcUi(),
      speedKeys: game.speedKeys(),
      ...(document.body.classList.contains('holo-available')
        ? { windowOpacity: windowOpacityPct() / 100 }
        : {}),
      // Чёткость карты есть у экрана, которому есть что понижать (`decisions/mapSharpness.ts`).
      ...(sharpnessMatters(game.screenDpr()) ? { mapSharp: mapSharpOn() } : {}),
      // Размер интерфейса — множитель зума ПК (`holographicUi.ts`), у телефона его нет.
      ...(pcUi() ? { uiScale: uiScalePct() / 100 } : {}),
      // Нижняя панель есть там, где телефонная раскладка (UIX-3.3); настраивают её и с хаба.
      ...(game.mobile() ? { phoneBar: game.phoneBar() } : {}),
      // Push (UIX-4.4): вкладка есть там, где браузер умеет уведомления.
      ...(push?.view() ? { push: push.view()! } : {}),
      // В сборке одного Sector Zero скорость всегда за минуту забега — выбирать там нечего.
      ...(__SECTOR_ZERO_ONLY__ ? {} : { rateUnit: game.rateUnit() }),
      // Номер сетевой партии — его копируют и отправляют друзьям (FRIENDS-2).
      ...(serverMatchId() ? { matchId: serverMatchId()! } : {}),
    }),
    setSweepOpacity,
    setWindowOpacity: (v) => {
      setWindowOpacity(Math.round(v * 100));
      applyWindowOpacity();
    },
    // Новый зум подхватит `holographic.sync` на ближайшем кадре.
    setUiScale: (v) => setUiScale(Math.round(v * 100)),
    setOwnPings: (v) => game.setOwnPings(v),
    setGlow: setGlowFx,
    setStarfield: setStarfield,
    setMapSharp: (v) => {
      setMapSharp(v);
      game.resize();
    },
    setMotion: setMotion,
    setRenderCompatibility: setCanvasCompatibility,
    renderingReport: mapRenderingReport,
    setFps: setShowFps,
    setSound: (v) => snd.setEnabled(v),
    setVolume: (v) => snd.setVolume(v),
    previewSound: () => snd.play('tap'),
    setColors: (you, neutral, palette) => setSideColors(you, neutral, palette),
    resetColors: () => setSideColors(COLOR.p1!, COLOR.null!, 'classic'),
    setPhoneBar: (bar) => game.setPhoneBar(bar),
    setRateUnit: (unit) => game.setRateUnit(unit),
    copyMatchId: async () => {
      const id = serverMatchId();
      if (!id || !navigator.clipboard) return false;
      return navigator.clipboard.writeText(id).then(
        () => true,
        () => false,
      );
    },
    setPush: async (on) => push?.setEnabled(on),
    setPushKind: async (kind, on) => push?.setKind(kind, on),
  });
  // Окно согласия встаёт ПОСЛЕ окна настроек: `changed` перерисовывает его.
  push = __SECTOR_ZERO_ONLY__
    ? null
    : initPush({
        authorizedBase: hubAuthorizedBase,
        askRoot: () => document.getElementById('pushask') as HTMLElement,
        changed: () => {
          if (root.classList.contains('show')) settings.render();
        },
      });
  (document.getElementById('hub-settings') as HTMLElement).addEventListener('click', openSettings);
  (document.getElementById('hub-gear') as HTMLElement).addEventListener('click', openSettings);
  // Rail: settings are reachable mid-match too, not only from the hub's «Ещё» tab.
  document.getElementById('rail-settings')?.addEventListener('click', openSettings);
}
