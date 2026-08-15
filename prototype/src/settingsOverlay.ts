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

/** Снимок всех настроек на момент отрисовки. */
export interface SettingsView {
  /** Прозрачность радарной развёртки, 0..1. */
  sweepOpacity: number;
  /** Показывать ли СВОИ метки на карте (чужие видны всегда). */
  ownPings: boolean;
  glow: boolean;
  starfield: boolean;
  fps: boolean;
  soundOn: boolean;
  /** Громкость звука, 0..1. */
  volume: number;
  youColor: string;
  neutralColor: string;
  /** Выбранная палитра соперников (`classic` | `warm` | `cvd`). */
  palette: string;
}

/** Палитры соперников: id и ключ подписи. Порядок — порядок кнопок. */
export const PALETTES: ReadonlyArray<{ id: string; key: string }> = [
  { id: 'classic', key: 'settings.palette.classic' },
  { id: 'warm', key: 'settings.palette.warm' },
  { id: 'cvd', key: 'settings.palette.colorblind' },
];

const onOff = (v: boolean): string => (v ? t('settings.on') : t('settings.off'));
const pct = (v: number): number => Math.round(v * 100);

/** Строка-тумблер: подпись с пояснением слева, переключатель и его состояние справа. */
function switchRow(id: string, label: string, hint: string, on: boolean): string {
  return (
    `<div class="set-row">` +
    `<div class="set-lbl">${label}<span class="set-sub">${hint}</span></div>` +
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

/** Окно настроек целиком. Чистая функция от снимка — ни DOM, ни хранилища. */
export function settingsBoxHtml(view: SettingsView): string {
  const palettes =
    PALETTES.map(
      (p) =>
        `<button type="button" class="set-pal${view.palette === p.id ? ' on' : ''}" data-pal="${p.id}">${t(p.key)}</button>`,
    ).join('') +
    `<button type="button" class="set-pal" id="set-colreset" title="${t('settings.colors.reset')}">⟲</button>`;
  return (
    `<div class="setbox">` +
    `<div class="pc-head"><span class="pc-dia" style="background:var(--cyan)"></span><b>${t('settings.title')}</b><span class="pc-tag">${t('settings.tag')}</span></div>` +
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
    `</div>` +
    `<div class="pc-sec">${t('settings.gfx.title')}</div>` +
    switchRow('glow', t('settings.gfx.glow'), t('settings.gfx.glow.hint'), view.glow) +
    switchRow(
      'starfield',
      t('settings.gfx.starfield'),
      t('settings.gfx.starfield.hint'),
      view.starfield,
    ) +
    switchRow('fps', t('settings.gfx.fps'), t('settings.gfx.fps.hint'), view.fps) +
    // SND-1: секция «Звук» — тумблер синтезированных откликов + громкость.
    `<div class="pc-sec">${t('settings.snd.title')}</div>` +
    switchRow('snd', t('settings.snd.ui'), t('settings.snd.ui.hint'), view.soundOn) +
    rangeRow('snd-vol', t('settings.snd.vol'), '', view.volume) +
    `<button class="pc-close" id="set-close" type="button">${t('settings.done')}</button>` +
    `</div>`
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

  function render(): void {
    const v = host.view();
    host.root().innerHTML = settingsBoxHtml(v);

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
    toggle('fps', host.setFps);
    toggle('snd', host.setSound, (on) => {
      if (on) host.previewSound(); // включил — сразу слышно, ЧТО включил
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
      render();
      host.root().classList.add('show');
    },
    render,
  };
}
