import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import {
  settingsBoxHtml,
  initSettings,
  PALETTES,
  type SettingsView,
  type SettingsHost,
} from './settingsOverlay';

// REFM-22: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));

const viewOf = (over: Partial<SettingsView> = {}): SettingsView => ({
  sweepOpacity: 1,
  ownPings: true,
  compact: false,
  showCompactRow: true,
  glow: true,
  starfield: true,
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
  const classes = new Set<string>();
  const nodes = new Map<
    string,
    {
      checked: boolean;
      value: string;
      textContent: string;
      on: Record<string, () => void>;
      dataset: Record<string, string>;
    }
  >();
  const make = () => ({
    checked: false,
    value: '',
    textContent: '',
    on: {} as Record<string, () => void>,
    dataset: {} as Record<string, string>,
    addEventListener(type: string, h: () => void) {
      this.on[type] = h;
    },
  });
  const el = {
    innerHTML: '',
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
      if (!nodes.has(id)) nodes.set(id, make() as never);
      return nodes.get(id) as never;
    },
    querySelectorAll: (sel: string) => {
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
    shown: () => classes.has('show'),
    node: (id: string) => nodes.get(id),
    fire: (id: string, type = 'change') => nodes.get(id)?.on[type]?.(),
    firePalette: (pal: string) => nodes.get(`pal:${pal}`)?.on.click?.(),
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
    setCompact: (v) => calls.push(['compact', v]),
    setGlow: (v) => calls.push(['glow', v]),
    setStarfield: (v) => calls.push(['starfield', v]),
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
  it('окно несёт все секции и кнопку закрытия', () => {
    const html = settingsBoxHtml(viewOf());
    for (const id of [
      'set-sweep',
      'set-ownpings',
      'set-glow',
      'set-starfield',
      'set-fps',
      'set-snd',
      'set-snd-vol',
      'set-close',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('состояние тумблера отражено и в галочке, и в подписи', () => {
    const on = settingsBoxHtml(viewOf({ glow: true }));
    const off = settingsBoxHtml(viewOf({ glow: false }));
    expect(on).toMatch(/id="set-glow" type="checkbox" checked/);
    expect(off).not.toMatch(/id="set-glow" type="checkbox" checked/);
    expect(on).not.toBe(off);
  });

  it('проценты показываются целыми — и в значении ползунка, и в подписи', () => {
    const html = settingsBoxHtml(viewOf({ sweepOpacity: 0.37 }));
    expect(html).toContain('value="37"');
    expect(html).toContain('37%');
  });

  it('строка компактного режима есть только в ПК-раскладке', () => {
    expect(settingsBoxHtml(viewOf({ showCompactRow: true }))).toContain('id="set-compact"');
    expect(settingsBoxHtml(viewOf({ showCompactRow: false }))).not.toContain('id="set-compact"');
  });

  it('выбранная палитра подсвечена, остальные — нет', () => {
    const html = settingsBoxHtml(viewOf({ palette: 'warm' }));
    expect(html).toContain('class="set-pal on" data-pal="warm"');
    expect(html).toContain('class="set-pal" data-pal="classic"');
  });

  it('цвета сторон приходят в поля выбора цвета', () => {
    const html = settingsBoxHtml(viewOf({ youColor: '#123456', neutralColor: '#abcdef' }));
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
    const node = w.win.node('set-glow')!;
    node.checked = false;
    w.win.fire('set-glow');
    expect(w.calls).toContainEqual(['glow', false]);
    expect(w.win.node('set-glow-val')?.textContent).toBeTruthy(); // подпись не осталась пустой
  });

  it('каждый тумблер зовёт СВОЙ сеттер', () => {
    const w = wired();
    w.api.open();
    for (const id of ['ownpings', 'glow', 'starfield', 'fps']) {
      const n = w.win.node(`set-${id}`)!;
      n.checked = true;
      w.win.fire(`set-${id}`);
    }
    expect(w.calls.map(([k]) => k)).toEqual(['ownpings', 'glow', 'starfield', 'fps']);
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
    w.win.firePalette('warm');
    expect(w.calls).toContainEqual(['colors', ['#111111', '#222222', 'warm']]);
  });

  it('сброс цветов — отдельное намерение', () => {
    const w = wired();
    w.api.open();
    w.win.node('set-colreset');
    w.win.fire('set-colreset', 'click');
    expect(w.calls).toContainEqual(['reset', true]);
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
