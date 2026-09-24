/**
 * Оверлей настроек — витрина клиентских предпочтений (REFM-22).
 *
 * Всё здесь client-only и чисто косметическое: на сервер не уходит, симуляции не
 * касается. Радарная механика (обнаружение контактов) не меняется ни при одной
 * настройке — прозрачность развёртки красит картинку, а не то, что игрок ВИДИТ.
 *
 * Модуль ничем не владеет: каждая настройка живёт там, где её читают (графика — в
 * `graphicsPrefs.ts`, цвета — в `sideColors.ts`, звук — в `sound.ts`, развёртка и метки —
 * в `main.ts`). Здесь только форма: как это показать и куда отдать изменение. Поэтому
 * разметка полностью чистая — её можно проверить, не открывая браузер.
 */
import { t } from '../../localization/runtime';
import { controlsFor } from '../../decisions/controls';

/** Снимок всех настроек на момент отрисовки. */
export interface SettingsView {
  /** Прозрачность радарной развёртки, 0..1. */
  sweepOpacity: number;
  /** Показывать ли СВОИ метки на карте (чужие видны всегда). */
  ownPings: boolean;
  glow: boolean;
  starfield: boolean;
  /** Непрерывное «дыхание» слоёв карты. Выкл замораживает их, но не прячет. */
  motion: boolean;
  /** Запрошенный режим карты и режим, выбранный при запуске, могут отличаться. */
  renderCompatibility?: boolean;
  renderCompatibilityActive?: boolean;
  renderCompatibilitySupported?: boolean;
  fps: boolean;
  soundOn: boolean;
  /** Громкость звука, 0..1. */
  volume: number;
  youColor: string;
  neutralColor: string;
  /** Выбранная палитра соперников (`classic` | `warm` | `cvd`). */
  palette: string;
  /** Интерфейс телефона: в «Управлении» — только жесты, клавиш у пальца нет. */
  touchOnly?: boolean;
}

/** Палитры соперников: id и ключ подписи. Порядок — порядок кнопок. */
export const PALETTES: ReadonlyArray<{ id: string; key: string }> = [
  { id: 'classic', key: 'settings.palette.classic' },
  { id: 'warm', key: 'settings.palette.warm' },
  { id: 'cvd', key: 'settings.palette.colorblind' },
];

const onOff = (v: boolean): string => (v ? t('settings.on') : t('settings.off'));
const pct = (v: number): number => Math.round(v * 100);
const renderCompatibilityPending = (view: SettingsView): string =>
  (view.renderCompatibility ?? false) !== (view.renderCompatibilityActive ?? false)
    ? t('settings.gfx.render-compat.pending')
    : '';

/** Строка-тумблер: подпись с пояснением слева, переключатель и его состояние справа. */
function switchRow(id: string, label: string, hint: string, on: boolean, status = ''): string {
  return (
    `<div class="set-row">` +
    `<div class="set-lbl">${label}<span class="set-sub">${hint}</span>${status}</div>` +
    `<div class="set-ctl"><label class="set-switch"><input id="set-${id}" type="checkbox"${on ? ' checked' : ''} aria-label="${label}"><span class="sw-track"></span><span class="sw-knob"></span></label>` +
    `<span id="set-${id}-val" class="set-val">${onOff(on)}</span></div>` +
    `</div>`
  );
}

/** Строка-ползунок в процентах. `aria` — отдельная подпись для скринридера, когда
 *  видимая («Развёртка радара») менее точна, чем то, чем ползунок управляет
 *  («Прозрачность развёртки»). По умолчанию совпадает с видимой. */
function rangeRow(id: string, label: string, hint: string, value: number, aria = label): string {
  const v = pct(value);
  return (
    `<div class="set-row">` +
    `<div class="set-lbl">${label}${hint ? `<span class="set-sub">${hint}</span>` : ''}</div>` +
    `<div class="set-ctl"><input id="set-${id}" type="range" min="0" max="100" step="5" value="${v}" aria-label="${aria}">` +
    `<span id="set-${id}-val" class="set-val">${v}%</span></div>` +
    `</div>`
  );
}

/** Вкладки окна (UX-SET-1, заказ владельца 2026-09-23: «разнеси по вкладкам звук,
 *  графику и т. д.»). Справка по управлению жила отдельно и раньше — таблица клавиш
 *  длинная и в общем списке прятала под собой кнопку «Готово» (UX-KEYS-1). */
export type SettingsTab = 'sound' | 'graphics' | 'map' | 'controls';

/** Вкладки по порядку кнопок; первая — та, на которой окно открывается. Каждая настройка
 *  живёт ровно в одной вкладке (сторож в тесте), иначе её было бы две правды на экране. */
export const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTab; key: string }> = [
  { id: 'sound', key: 'settings.snd.title' },
  { id: 'graphics', key: 'settings.gfx.title' },
  { id: 'map', key: 'settings.tab.map' },
  { id: 'controls', key: 'settings.controls.title' },
];

const DEFAULT_TAB: SettingsTab = SETTINGS_TABS[0]!.id;

/** Вкладка по её id из разметки; чужое значение — вкладка по умолчанию. */
function tabOf(id: string | undefined): SettingsTab {
  return SETTINGS_TABS.find((x) => x.id === id)?.id ?? DEFAULT_TAB;
}

/** «Управление» (UX-KEYS-1): что нажать → что будет. Таблица и её сторож —
 *  `decisions/controls.ts`. */
function controlsHtml(view: SettingsView): string {
  return `<dl class="set-keys">${controlsFor(!!view.touchOnly)
    .map((row) => `<div><dt>${t(row.keys)}</dt><dd>${t(row.does)}</dd></div>`)
    .join('')}</dl>`;
}

/** Окно настроек целиком. Чистая функция от снимка — ни DOM, ни хранилища. */
export function settingsBoxHtml(
  view: SettingsView,
  renderingReportAvailable = false,
  tab: SettingsTab = DEFAULT_TAB,
): string {
  // Кнопки вкладок — по образцу WAI-ARIA «tabs»: в Tab-обходе только выбранная
  // (остальные — стрелками), панель подписана своей вкладкой.
  const tabs = SETTINGS_TABS.map(
    ({ id, key }) =>
      `<button type="button" role="tab" id="set-tab-${id}" data-settab="${id}" aria-controls="set-panel"` +
      ` aria-selected="${tab === id}" tabindex="${tab === id ? 0 : -1}"${tab === id ? ' class="on"' : ''}>${t(key)}</button>`,
  ).join('');
  return (
    `<div class="setbox">` +
    `<div class="pc-head"><span class="pc-dia" style="background:var(--cyan)"></span><b>${t('settings.title')}</b><span class="pc-tag">${t('settings.tag')}</span></div>` +
    `<div class="set-tabs" role="tablist" aria-label="${t('settings.title')}">${tabs}</div>` +
    `<div class="set-panel" id="set-panel" role="tabpanel" aria-labelledby="set-tab-${tab}">${tabHtml(view, tab, renderingReportAvailable)}</div>` +
    `<button class="pc-close" id="set-close" type="button">${t('settings.done')}</button>` +
    `</div>`
  );
}

function tabHtml(view: SettingsView, tab: SettingsTab, renderingReportAvailable: boolean): string {
  switch (tab) {
    case 'sound':
      return soundHtml(view);
    case 'graphics':
      return graphicsHtml(view, renderingReportAvailable);
    case 'map':
      return mapHtml(view);
    case 'controls':
      return controlsHtml(view);
  }
}

/** «Звук» (SND-1): тумблер синтезированных откликов и громкость. */
function soundHtml(view: SettingsView): string {
  return (
    switchRow('snd', t('settings.snd.ui'), t('settings.snd.ui.hint'), view.soundOn) +
    rangeRow('snd-vol', t('settings.snd.vol'), '', view.volume)
  );
}

/** «Карта»: развёртка радара, свои метки и цвета сторон — всё, чем окрашена карта. */
function mapHtml(view: SettingsView): string {
  const palettes =
    PALETTES.map(
      (p) =>
        `<button type="button" class="set-pal${view.palette === p.id ? ' on' : ''}" data-pal="${p.id}">${t(p.key)}</button>`,
    ).join('') +
    `<button type="button" class="set-pal" id="set-colreset" title="${t('settings.colors.reset')}">⟲</button>`;
  return (
    rangeRow(
      'sweep',
      t('settings.sweep'),
      t('settings.sweep.hint'),
      view.sweepOpacity,
      t('settings.sweep.opacity'),
    ) +
    switchRow('ownpings', t('settings.own-pins'), t('settings.own-pins.hint'), view.ownPings) +
    `<div class="pc-sec">${t('settings.colors.title')}</div>` +
    `<div class="set-row">` +
    `<div class="set-lbl">${t('settings.colors.own')}<span class="set-sub">${t('settings.colors.own.hint')}</span></div>` +
    `<div class="set-ctl"><input id="set-colyou" type="color" value="${view.youColor}" aria-label="${t('settings.colors.own')}"></div>` +
    `</div>` +
    `<div class="set-row">` +
    `<div class="set-lbl">${t('settings.colors.neutral')}<span class="set-sub">${t('settings.colors.neutral.hint')}</span></div>` +
    `<div class="set-ctl"><input id="set-colneutral" type="color" value="${view.neutralColor}" aria-label="${t('settings.colors.neutral')}"></div>` +
    `</div>` +
    `<div class="set-row">` +
    `<div class="set-lbl">${t('settings.colors.palette')}<span class="set-sub">${t('settings.colors.palette.hint')}</span></div>` +
    `<div class="set-ctl set-pals">${palettes}</div>` +
    `</div>`
  );
}

/** «Графика»: свечение, звёзды, движение, счётчик кадров, совместимость отрисовки. */
function graphicsHtml(view: SettingsView, renderingReportAvailable: boolean): string {
  return (
    switchRow('glow', t('settings.gfx.glow'), t('settings.gfx.glow.hint'), view.glow) +
    switchRow(
      'starfield',
      t('settings.gfx.starfield'),
      t('settings.gfx.starfield.hint'),
      view.starfield,
    ) +
    switchRow('motion', t('settings.gfx.motion'), t('settings.gfx.motion.hint'), view.motion) +
    switchRow('fps', t('settings.gfx.fps'), t('settings.gfx.fps.hint'), view.fps) +
    (view.renderCompatibilitySupported
      ? switchRow(
          'render-compat',
          t('settings.gfx.render-compat'),
          t('settings.gfx.render-compat.hint'),
          view.renderCompatibility ?? false,
          `<span id="set-render-compat-pending" class="set-sub" role="status">${renderCompatibilityPending(view)}</span>`,
        )
      : '') +
    (renderingReportAvailable
      ? `<div class="set-row"><button type="button" class="set-pal" id="set-render-report" aria-expanded="false" aria-controls="set-render-report-panel">${t('settings.gfx.render-report')}</button>` +
        `<div id="set-render-report-panel" hidden><div class="set-lbl"><span class="set-sub">${t('settings.gfx.render-report.hint')}</span></div>` +
        `<textarea id="set-render-report-text" class="set-render-report-text" readonly spellcheck="false" rows="8" aria-label="${t('settings.gfx.render-report')}"></textarea></div></div>`
      : '')
  );
}

/** Что оверлей берёт у клиента. Настройками он не владеет — только показывает и отдаёт. */
export interface SettingsHost {
  /** Окно (`#settings`). */
  root(): HTMLElement;
  /** Снимок всех настроек на момент отрисовки. */
  view(): SettingsView;
  setSweepOpacity(v: number): void;
  setOwnPings(v: boolean): void;
  setGlow(v: boolean): void;
  setStarfield(v: boolean): void;
  setMotion(v: boolean): void;
  setRenderCompatibility?(on: boolean): void;
  /** Локальный технический отчёт; читается только по запросу игрока. */
  renderingReport?(): string;
  setFps(v: boolean): void;
  setSound(v: boolean): void;
  setVolume(v: number): void;
  /** Короткий отклик: включил звук или двигаешь громкость — слышно, что именно вышло. */
  previewSound(): void;
  /** Цвета сторон меняются втроём (свой / нейтральный / палитра) — одним вызовом. */
  setColors(you: string, neutral: string, palette: string): void;
  /** Вернуть цвета к заводским. */
  resetColors(): void;
}

/** Собрать оверлей. `open()` зовут и хаб, и рельса матча. */
export function initSettings(host: SettingsHost): { open: () => void; render: () => void } {
  const q = <T extends HTMLElement>(id: string): T | null => host.root().querySelector<T>(`#${id}`);

  /** Подписать значение рядом с контролом, если оно на месте. */
  const label = (id: string, text: string): void => {
    const el = q(`${id}-val`);
    if (el) el.textContent = text;
  };

  let tab: SettingsTab = DEFAULT_TAB;

  /** Открыть вкладку и вернуть фокус на её кнопку: перерисовка снесла прежнюю. */
  const select = (next: SettingsTab): void => {
    tab = next;
    render();
    host.root().querySelector<HTMLElement>(`[data-settab="${tab}"]`)?.focus();
  };

  function render(): void {
    const v = host.view();
    host.root().innerHTML = settingsBoxHtml(v, typeof host.renderingReport === 'function', tab);
    for (const b of Array.from(host.root().querySelectorAll<HTMLElement>('[data-settab]'))) {
      b.addEventListener('click', () => select(tabOf(b.dataset.settab)));
      // Стрелки ходят по кругу, Home/End — к краям (образец WAI-ARIA «tabs»).
      b.addEventListener('keydown', (e: KeyboardEvent) => {
        const at = SETTINGS_TABS.findIndex((x) => x.id === tab);
        const n = SETTINGS_TABS.length;
        const to =
          e.key === 'ArrowRight' ? (at + 1) % n
          : e.key === 'ArrowLeft' ? (at + n - 1) % n
          : e.key === 'Home' ? 0
          : e.key === 'End' ? n - 1
          : -1;
        if (to < 0) return;
        e.preventDefault();
        select(SETTINGS_TABS[to]!.id);
      });
    }

    // Тумблеры: каждый пишет настройку и тут же обновляет свою подпись — иначе значение
    // рядом с переключателем разъедется с ним до следующей перерисовки.
    const toggle = (id: string, apply: (on: boolean) => void, after?: (on: boolean) => void) => {
      const el = q<HTMLInputElement>(`set-${id}`);
      el?.addEventListener('change', () => {
        apply(el.checked);
        label(`set-${id}`, onOff(el.checked));
        after?.(el.checked);
      });
    };
    toggle('ownpings', host.setOwnPings);
    toggle('glow', host.setGlow);
    toggle('starfield', host.setStarfield);
    toggle('motion', host.setMotion);
    toggle('fps', host.setFps);
    toggle('snd', host.setSound, (on) => {
      if (on) host.previewSound(); // включил — сразу слышно, ЧТО включил
    });

    const compatibility = q<HTMLInputElement>('set-render-compat');
    if (host.setRenderCompatibility) {
      compatibility?.addEventListener('change', () => {
        host.setRenderCompatibility?.(compatibility.checked);
        // Хранилище может отклонить запись: показываем фактически сохранённый выбор.
        const current = host.view();
        compatibility.checked = current.renderCompatibility ?? false;
        label('set-render-compat', onOff(compatibility.checked));
        const pending = q('set-render-compat-pending');
        if (pending) pending.textContent = renderCompatibilityPending(current);
      });
    }

    const reportButton = q('set-render-report');
    const reportPanel = q('set-render-report-panel');
    const reportText = q<HTMLTextAreaElement>('set-render-report-text');
    reportButton?.addEventListener('click', () => {
      if (!reportPanel || !reportText) return;
      const show = reportPanel.hidden;
      // Сведения о среде остаются текстом, даже если содержат HTML-разметку.
      if (show) reportText.value = host.renderingReport?.() ?? '';
      reportPanel.hidden = !show;
      reportButton.setAttribute('aria-expanded', String(show));
    });

    const sweep = q<HTMLInputElement>('set-sweep');
    sweep?.addEventListener('input', () => {
      const value = Number(sweep.value) / 100;
      host.setSweepOpacity(value);
      label('set-sweep', `${pct(value)}%`);
    });

    const vol = q<HTMLInputElement>('set-snd-vol');
    vol?.addEventListener('input', () => {
      const value = Number(vol.value) / 100;
      host.setVolume(value);
      label('set-snd-vol', `${pct(value)}%`);
      host.previewSound(); // живой предпросмотр уровня
    });

    const you = q<HTMLInputElement>('set-colyou');
    const neutral = q<HTMLInputElement>('set-colneutral');
    you?.addEventListener('input', () =>
      host.setColors(you.value, host.view().neutralColor, host.view().palette),
    );
    neutral?.addEventListener('input', () =>
      host.setColors(host.view().youColor, neutral.value, host.view().palette),
    );
    for (const b of Array.from(host.root().querySelectorAll<HTMLElement>('.set-pal[data-pal]'))) {
      b.addEventListener('click', () => {
        const v2 = host.view();
        host.setColors(v2.youColor, v2.neutralColor, b.dataset.pal ?? 'classic');
        render(); // выбранная палитра подсвечивается — перерисовываем
      });
    }
    q('set-colreset')?.addEventListener('click', () => {
      host.resetColors();
      render();
    });
    q('set-close')?.addEventListener('click', () => host.root().classList.remove('show'));
  }

  host.root().addEventListener('click', (e) => {
    if (e.target === host.root()) host.root().classList.remove('show'); // тап по фону → закрыть
  });

  return {
    open: () => {
      tab = DEFAULT_TAB; // окно открывается на первой вкладке, а не там, где его закрыли
      render();
      host.root().classList.add('show');
    },
    render,
  };
}
