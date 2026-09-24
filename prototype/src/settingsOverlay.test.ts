import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale, t } from '../../localization/runtime';
import {
  settingsBoxHtml,
  initSettings,
  PALETTES,
  SETTINGS_TABS,
  type SettingsView,
  type SettingsHost,
} from './settingsOverlay';

// REFM-22: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));

const viewOf = (over: Partial<SettingsView> = {}): SettingsView => ({
  sweepOpacity: 1,
  ownPings: true,
  glow: true,
  starfield: true,
  motion: true,
  fps: false,
  soundOn: true,
  volume: 0.5,
  youColor: '#00ffcc',
  neutralColor: '#446677',
  palette: 'classic',
  ...over,
});

/** Окно без DOM: разметка строкой, элементы ищутся по id внутри неё. */
function fakeWin() {
  let handler: ((ev: unknown) => void) | null = null;
  let html = '';
  let renderCount = 0;
  const classes = new Set<string>();
  const nodes = new Map<
    string,
    {
      checked: boolean;
      value: string;
      textContent: string;
      hidden: boolean;
      attributes: Record<string, string>;
      on: Record<string, () => void>;
      dataset: Record<string, string>;
    }
  >();
  const make = () => ({
    checked: false,
    value: '',
    textContent: '',
    hidden: false,
    attributes: {} as Record<string, string>,
    on: {} as Record<string, () => void>,
    dataset: {} as Record<string, string>,
    addEventListener(type: string, h: () => void) {
      this.on[type] = h;
    },
    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    },
  });
  const el = {
    get innerHTML() {
      return html;
    },
    set innerHTML(value: string) {
      html = value;
      renderCount++;
      nodes.clear();
    },
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    addEventListener: (_t: string, h: (ev: unknown) => void) => {
      handler = h;
    },
    querySelector: (sel: string) => {
      const id = sel.replace(/^#/, '');
      if (!el.innerHTML.includes(`id="${id}"`)) return null;
      if (!nodes.has(id)) {
        const node = make();
        const position = el.innerHTML.indexOf(`id="${id}"`);
        const tag = el.innerHTML.slice(position, el.innerHTML.indexOf('>', position));
        node.hidden = /\shidden(?:\s|$)/.test(tag);
        nodes.set(id, node);
      }
      return nodes.get(id) as never;
    },
    querySelectorAll: (sel: string) => {
      // Кнопки вкладок — из разметки, как в живом окне: вкладки, которой нет, нет и тут.
      if (sel.includes('data-settab')) {
        return [...el.innerHTML.matchAll(/data-settab="([a-z]+)"/g)].map(([, id]) => {
          const key = `tab:${id}`;
          if (!nodes.has(key)) {
            const n = make() as never as { dataset: Record<string, string> };
            n.dataset.settab = id!;
            nodes.set(key, n as never);
          }
          return nodes.get(key) as never;
        });
      }
      if (!sel.includes('data-pal')) return [];
      return PALETTES.map((p) => {
        const key = `pal:${p.id}`;
        if (!nodes.has(key)) {
          const n = make() as never as { dataset: Record<string, string> };
          n.dataset.pal = p.id;
          nodes.set(key, n as never);
        }
        return nodes.get(key) as never;
      });
    },
  };
  return {
    el: el as unknown as HTMLElement,
    html: () => el.innerHTML,
    renderCount: () => renderCount,
    shown: () => classes.has('show'),
    node: (id: string) => nodes.get(id),
    fire: (id: string, type = 'change') => nodes.get(id)?.on[type]?.(),
    firePalette: (pal: string) => nodes.get(`pal:${pal}`)?.on.click?.(),
    /** Нажать вкладку. Узлы строятся при отрисовке — тут их только находим. */
    tab: (id: string) => nodes.get(`tab:${id}`)?.on.click?.(),
    /** Клавиша на кнопке вкладки. */
    tabKey: (id: string, key: string) => {
      let prevented = false;
      const handler = nodes.get(`tab:${id}`)?.on.keydown as unknown as
        | ((e: { key: string; preventDefault(): void }) => void)
        | undefined;
      handler?.({ key, preventDefault: () => (prevented = true) });
      return prevented;
    },
    /** Какая вкладка выбрана по разметке. */
    selected: () => /data-settab="([a-z]+)" aria-controls="set-panel" aria-selected="true"/.exec(el.innerHTML)?.[1],
    backdrop: () => handler?.({ target: el }),
  };
}

function wired(over: Partial<SettingsHost> = {}, view: SettingsView = viewOf()) {
  const win = fakeWin();
  const calls: Array<[string, unknown]> = [];
  let previews = 0;
  const api = initSettings({
    root: () => win.el,
    view: () => view,
    setSweepOpacity: (v) => calls.push(['sweep', v]),
    setOwnPings: (v) => calls.push(['ownpings', v]),
    setGlow: (v) => calls.push(['glow', v]),
    setStarfield: (v) => calls.push(['starfield', v]),
    setMotion: (v) => calls.push(['motion', v]),
    setFps: (v) => calls.push(['fps', v]),
    setSound: (v) => calls.push(['snd', v]),
    setVolume: (v) => calls.push(['vol', v]),
    previewSound: () => previews++,
    setColors: (y, n, p) => calls.push(['colors', [y, n, p]]),
    resetColors: () => calls.push(['reset', true]),
    ...over,
  });
  return { api, win, calls, previews: () => previews };
}

describe('настройки — разметка', () => {
  it('«Управление»: на ПК — клавиши и жесты, на телефоне — только жесты (UX-KEYS-1)', () => {
    const pc = settingsBoxHtml(viewOf(), false, 'controls');
    const phone = settingsBoxHtml(viewOf({ touchOnly: true }), false, 'controls');
    // Отдельная вкладка: на первой таблицы нет, настроек на «Управлении» — тоже.
    expect(settingsBoxHtml(viewOf())).not.toContain('class="set-keys"');
    expect(pc).not.toContain('id="set-sweep"');
    expect(pc).toContain('data-settab="controls" aria-controls="set-panel" aria-selected="true"');
    expect(pc).toContain('class="set-keys"');
    expect(pc).toContain(t('controls.box.keys'));
    expect(phone).not.toContain(t('controls.box.keys'));
    expect(phone).toContain(t('controls.long-press.keys'));
  });

  // UX-SET-1 (заказ владельца 2026-09-23): звук, графика, карта и управление — вкладками,
  // и первой открывается «Звук».
  it('вкладки: Звук · Графика · Карта · Управление, первой — «Звук»', () => {
    expect(SETTINGS_TABS.map((x) => x.id)).toEqual(['sound', 'graphics', 'map', 'controls']);
    const html = settingsBoxHtml(viewOf());
    expect(html).toContain('data-settab="sound" aria-controls="set-panel" aria-selected="true"');
    for (const { key } of SETTINGS_TABS) expect(html).toContain(`>${t(key)}</button>`);
  });

  const HOME: Record<string, readonly string[]> = {
    sound: ['set-snd', 'set-snd-vol'],
    graphics: ['set-glow', 'set-starfield', 'set-motion', 'set-fps'],
    map: ['set-sweep', 'set-ownpings', 'set-colyou', 'set-colneutral', 'set-colreset'],
    controls: [],
  };

  it('каждая настройка живёт ровно в одной вкладке, «Готово» — во всех', () => {
    const view = viewOf({ renderCompatibilitySupported: true });
    const all = Object.values(HOME).flat();
    for (const { id: tab } of SETTINGS_TABS) {
      const html = settingsBoxHtml(view, false, tab);
      expect(html).toContain('id="set-close"');
      for (const id of all) expect(html.includes(`id="${id}"`)).toBe(HOME[tab]!.includes(id));
    }
    // Совместимость отрисовки — графика, палитры — карта.
    expect(settingsBoxHtml(view, false, 'graphics')).toContain('id="set-render-compat"');
    expect(settingsBoxHtml(view, false, 'map')).toContain('data-pal="classic"');
    expect(settingsBoxHtml(view, false, 'sound')).not.toContain('data-pal=');
  });

  it('панель подписана выбранной вкладкой, в Tab-обходе — только она', () => {
    const html = settingsBoxHtml(viewOf(), false, 'map');
    expect(html).toContain('role="tabpanel" aria-labelledby="set-tab-map"');
    expect(html).toContain('id="set-tab-map" data-settab="map" aria-controls="set-panel" aria-selected="true" tabindex="0"');
    expect(html).toContain('id="set-tab-sound" data-settab="sound" aria-controls="set-panel" aria-selected="false" tabindex="-1"');
  });

  it('состояние тумблера отражено и в галочке, и в подписи', () => {
    const on = settingsBoxHtml(viewOf({ glow: true }), false, 'graphics');
    const off = settingsBoxHtml(viewOf({ glow: false }), false, 'graphics');
    expect(on).toMatch(/id="set-glow" type="checkbox" checked/);
    expect(off).not.toMatch(/id="set-glow" type="checkbox" checked/);
    expect(on).not.toBe(off);
  });

  it('проценты показываются целыми — и в значении ползунка, и в подписи', () => {
    const html = settingsBoxHtml(viewOf({ sweepOpacity: 0.37 }), false, 'map');
    expect(html).toContain('value="37"');
    expect(html).toContain('37%');
  });

  // Тумблера компактного режима тут больше нет: плотная подача стала единственной,
  // поэтому окно настроек не должно снова обзавестись строкой-призраком.
  it('строки компактного режима в окне нет вовсе', () => {
    for (const { id } of SETTINGS_TABS) expect(settingsBoxHtml(viewOf(), true, id)).not.toContain('set-compact');
  });

  it('устаревший интерфейс нельзя вернуть через настройки', () => {
    for (const { id } of SETTINGS_TABS) expect(settingsBoxHtml(viewOf(), true, id)).not.toContain('set-holography');
  });

  it('совместимость отрисовки предлагается только при поддержке', () => {
    expect(settingsBoxHtml(viewOf(), false, 'graphics')).not.toContain('id="set-render-compat"');
    expect(
      settingsBoxHtml(viewOf({ renderCompatibilitySupported: false, renderCompatibility: true }), false, 'graphics'),
    ).not.toContain('id="set-render-compat"');
    const html = settingsBoxHtml(viewOf({ renderCompatibilitySupported: true }), false, 'graphics');
    expect(html).toContain('id="set-render-compat" type="checkbox"');
    expect(html).toContain(t('settings.gfx.render-compat'));
    expect(html).toContain(t('settings.gfx.render-compat.hint'));
  });

  it.each([
    [false, false, false],
    [true, true, false],
    [true, false, true],
    [false, true, true],
  ])('запрошено %s, активно %s: ожидание перезапуска %s', (requested, active, pending) => {
    const html = settingsBoxHtml(
      viewOf({
        renderCompatibilitySupported: true,
        renderCompatibility: requested,
        renderCompatibilityActive: active,
      }),
      false,
      'graphics',
    );
    expect(html.includes('id="set-render-compat" type="checkbox" checked')).toBe(requested);
    expect(html.includes(t('settings.gfx.render-compat.pending'))).toBe(pending);
  });

  it('технический отчёт необязателен и свёрнут до нажатия кнопки', () => {
    expect(settingsBoxHtml(viewOf(), false, 'graphics')).not.toContain('id="set-render-report"');
    const html = settingsBoxHtml(viewOf(), true, 'graphics');
    expect(html).toContain('id="set-render-report"');
    expect(html).toContain('aria-expanded="false" aria-controls="set-render-report-panel"');
    expect(html).toContain('id="set-render-report-panel" hidden');
    expect(html).toMatch(/<textarea[^>]*id="set-render-report-text"[^>]*readonly[^>]*><\/textarea>/);
  });

  it('выбранная палитра подсвечена, остальные — нет', () => {
    const html = settingsBoxHtml(viewOf({ palette: 'warm' }), false, 'map');
    expect(html).toContain('class="set-pal on" data-pal="warm"');
    expect(html).toContain('class="set-pal" data-pal="classic"');
  });

  it('цвета сторон приходят в поля выбора цвета', () => {
    const html = settingsBoxHtml(viewOf({ youColor: '#123456', neutralColor: '#abcdef' }), false, 'map');
    expect(html).toContain('value="#123456"');
    expect(html).toContain('value="#abcdef"');
  });

  it('громкость показана в процентах, а не долей', () => {
    expect(settingsBoxHtml(viewOf({ volume: 0.8 }))).toContain('80%');
  });
});

describe('настройки — окно и обработчики', () => {
  it('open() красит окно и показывает его', () => {
    const w = wired();
    expect(w.win.shown()).toBe(false);
    w.api.open();
    expect(w.win.shown()).toBe(true);
    expect(w.win.html()).toContain('setbox');
  });

  it('тумблер пишет настройку и тут же обновляет свою подпись', () => {
    const w = wired();
    w.api.open();
    w.win.tab('graphics');
    const node = w.win.node('set-glow')!;
    node.checked = false;
    w.win.fire('set-glow');
    expect(w.calls).toContainEqual(['glow', false]);
    expect(w.win.node('set-glow-val')?.textContent).toBeTruthy(); // подпись не осталась пустой
  });

  it('каждый тумблер зовёт СВОЙ сеттер', () => {
    const w = wired();
    w.api.open();
    for (const [tab, id] of [['map', 'ownpings'], ['graphics', 'glow'], ['graphics', 'starfield'], ['graphics', 'fps']]) {
      w.win.tab(tab!);
      const n = w.win.node(`set-${id}`)!;
      n.checked = true;
      w.win.fire(`set-${id}`);
    }
    expect(w.calls.map(([k]) => k)).toEqual(['ownpings', 'glow', 'starfield', 'fps']);
  });

  it('движение можно отключить без переключения на старый интерфейс', () => {
    const w = wired();
    w.api.open();
    w.win.tab('graphics');
    expect(w.win.node('set-holography')).toBeUndefined();
    w.win.node('set-motion')!.checked = false;
    w.win.fire('set-motion');
    expect(w.calls).toEqual([['motion', false]]);
  });

  it('совместимость обновляет сохранённое значение и ожидание без сброса остальных полей', () => {
    const view = viewOf({
      renderCompatibilitySupported: true,
      renderCompatibility: false,
      renderCompatibilityActive: false,
    });
    const changes: boolean[] = [];
    const w = wired(
      {
        setRenderCompatibility: (on) => {
          changes.push(on);
          view.renderCompatibility = on;
        },
      },
      view,
    );
    w.api.open();
    w.win.tab('graphics');
    const renders = w.win.renderCount();
    const fps = w.win.node('set-fps')!;
    fps.checked = true;
    const toggle = w.win.node('set-render-compat')!;
    toggle.checked = true;
    w.win.fire('set-render-compat');
    expect(changes).toEqual([true]);
    expect(toggle.checked).toBe(true);
    expect(w.win.node('set-render-compat-val')?.textContent).toBe(t('settings.on'));
    expect(w.win.node('set-render-compat-pending')?.textContent).toBe(
      t('settings.gfx.render-compat.pending'),
    );
    toggle.checked = false;
    w.win.fire('set-render-compat');
    expect(changes).toEqual([true, false]);
    expect(w.win.node('set-render-compat-val')?.textContent).toBe(t('settings.off'));
    expect(w.win.node('set-render-compat-pending')?.textContent).toBe('');
    expect(w.win.renderCount()).toBe(renders);
    expect(w.win.node('set-fps')).toBe(fps);
    expect(fps.checked).toBe(true);
  });

  it('не обещает изменение совместимости, если хозяин не смог сохранить настройку', () => {
    const w = wired(
      { setRenderCompatibility: () => undefined },
      viewOf({ renderCompatibilitySupported: true, renderCompatibility: false }),
    );
    w.api.open();
    w.win.tab('graphics');
    w.win.node('set-render-compat')!.checked = true;
    w.win.fire('set-render-compat');
    expect(w.win.node('set-render-compat')?.checked).toBe(false);
    expect(w.win.node('set-render-compat-val')?.textContent).toBe(t('settings.off'));
    expect(w.win.node('set-render-compat-pending')?.textContent).toBe('');
  });

  it('отчёт читается по запросу и остаётся текстом даже при HTML в содержимом', () => {
    const report = '</textarea><img src=x onerror=alert(1)><script>alert(2)</script>';
    let reads = 0;
    const w = wired({
      renderingReport: () => {
        reads++;
        return report;
      },
    });
    w.api.open();
    w.win.tab('graphics');
    const renders = w.win.renderCount();
    expect(reads).toBe(0);
    expect(w.win.node('set-render-report-panel')?.hidden).toBe(true);
    expect(w.win.node('set-render-report-text')?.value).toBe('');
    w.win.fire('set-render-report', 'click');
    expect(reads).toBe(1);
    expect(w.win.node('set-render-report-panel')?.hidden).toBe(false);
    expect(w.win.node('set-render-report')?.attributes['aria-expanded']).toBe('true');
    expect(w.win.node('set-render-report-text')?.value).toBe(report);
    expect(w.win.html()).not.toContain(report);
    w.win.fire('set-render-report', 'click');
    expect(reads).toBe(1);
    expect(w.win.node('set-render-report-panel')?.hidden).toBe(true);
    expect(w.win.node('set-render-report')?.attributes['aria-expanded']).toBe('false');
    expect(w.win.renderCount()).toBe(renders);
  });

  it('включение звука даёт короткий отклик, выключение — нет', () => {
    const w = wired();
    w.api.open();
    const n = w.win.node('set-snd')!;
    n.checked = true;
    w.win.fire('set-snd');
    expect(w.previews()).toBe(1);
    n.checked = false;
    w.win.fire('set-snd');
    expect(w.previews()).toBe(1); // выключил — играть нечего
  });

  it('ползунок развёртки отдаёт долю, а не проценты', () => {
    const w = wired();
    w.api.open();
    w.win.tab('map');
    const n = w.win.node('set-sweep')!;
    n.value = '40';
    w.win.fire('set-sweep', 'input');
    expect(w.calls).toContainEqual(['sweep', 0.4]);
  });

  it('громкость отдаётся долей и звучит предпросмотром', () => {
    const w = wired();
    w.api.open();
    const n = w.win.node('set-snd-vol')!;
    n.value = '60';
    w.win.fire('set-snd-vol', 'input');
    expect(w.calls).toContainEqual(['vol', 0.6]);
    expect(w.previews()).toBe(1);
  });

  it('выбор палитры сохраняет уже выбранные цвета', () => {
    const w = wired({}, viewOf({ youColor: '#111111', neutralColor: '#222222' }));
    w.api.open();
    w.win.tab('map');
    w.win.firePalette('warm');
    expect(w.calls).toContainEqual(['colors', ['#111111', '#222222', 'warm']]);
  });

  it('сброс цветов — отдельное намерение', () => {
    const w = wired();
    w.api.open();
    w.win.tab('map');
    w.win.node('set-colreset');
    w.win.fire('set-colreset', 'click');
    expect(w.calls).toContainEqual(['reset', true]);
  });

  it('нажатая вкладка открывается, окно снова открывается на «Звуке»', () => {
    const w = wired();
    w.api.open();
    expect(w.win.selected()).toBe('sound');
    w.win.tab('controls');
    expect(w.win.selected()).toBe('controls');
    expect(w.win.html()).toContain('class="set-keys"');
    w.win.fire('set-close', 'click');
    w.api.open();
    expect(w.win.selected()).toBe('sound');
  });

  it('стрелки ходят по вкладкам по кругу, Home/End — к краям, прочие клавиши не трогают', () => {
    const w = wired();
    w.api.open();
    expect(w.win.tabKey('sound', 'ArrowRight')).toBe(true);
    expect(w.win.selected()).toBe('graphics');
    w.win.tabKey('graphics', 'End');
    expect(w.win.selected()).toBe('controls');
    w.win.tabKey('controls', 'ArrowRight');
    expect(w.win.selected()).toBe('sound');
    w.win.tabKey('sound', 'ArrowLeft');
    expect(w.win.selected()).toBe('controls');
    w.win.tabKey('controls', 'Home');
    expect(w.win.selected()).toBe('sound');
    const renders = w.win.renderCount();
    expect(w.win.tabKey('sound', 'Enter')).toBe(false);
    expect(w.win.renderCount()).toBe(renders);
  });

  it('тап по фону закрывает окно', () => {
    const w = wired();
    w.api.open();
    w.win.backdrop();
    expect(w.win.shown()).toBe(false);
  });

  it('кнопка «готово» закрывает окно', () => {
    const w = wired();
    w.api.open();
    w.win.fire('set-close', 'click');
    expect(w.win.shown()).toBe(false);
  });
});
