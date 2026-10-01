/**
 * «Доделанный интерфейс» — ПРОТОТИП для владельца (заказ 2026-10-01: «прототип с
 * доделанным интерфейсом, за основу бери нынешний»).
 *
 * Слой поверх нынешнего интерфейса: включается классом `body.ui-next` и снимается им же,
 * поэтому одна и та же партия смотрится «было / стало» без перезагрузки. Что он делает —
 * правки из `docs/ui-research.md`, по номерам:
 *
 *  1. Текст не мельче 12 px, на телефоне цели нажатия от 44 px (`ui-next.css` + сторож ниже).
 *  2. ПК: интерфейс растёт с окном — зум = высота окна / 864 в пределах 1..2, поверх него
 *     «Размер интерфейса» 80–150 % из настроек.
 *  3. Телефон: нижняя панель «Карта · Производство · Наука · События · Ещё»; скорость —
 *     одна кнопка с текущим значением, ряд скоростей раскрывается по нажатию.
 *  4. Видно, что изменилось: доход в час под ресурсом и на телефоне, «+N»/«−N» у плашки.
 *  5. Подписи без сокращений; мир на карте по имени, а не по координате (`main.ts`).
 *  8. Вводная «впервые» не запирает окно — она прижата к низу и не перекрывает его.
 *  9. ПК: клавиши (T, B, L, M, H, Tab, Пробел, 1–4) и подписи значков рельсы.
 * 10. Хаб: одна главная дверь, режимы списком с одной строкой отличия, пять вкладок.
 * 11. Один шрифт текста на обеих платформах, без КАПС с разрядкой.
 *
 * Слой ничего не решает за игру: каждая его кнопка нажимает НАСТОЯЩУЮ кнопку нынешнего
 * интерфейса (рельсы, скорости, сохранения), поэтому правила, звуки и счётчики те же.
 */
import { t } from '../../localization/runtime';

/** Что слою нужно от игры сверх DOM. */
export interface UiNextHost {
  /** Идёт ли партия (а не хаб, вход или настройка матча). */
  inMatch(): boolean;
  /** Закрыть всё, что лежит поверх карты, кроме карточки выбора. */
  toMap(): void;
  /** Камера к столице. */
  home(): void;
  /** Выделить следующий свой флот и показать его. */
  nextFleet(): void;
}

const PREF = 'vd.uinext';
const SCALE_PREF = 'vd.uiscale';

export function uiNextOn(): boolean {
  return typeof document !== 'undefined' && document.body.classList.contains('ui-next');
}

function readPref(): boolean {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('ui') : null;
  if (q === 'next') return true;
  if (q === 'now') return false;
  try {
    return localStorage.getItem(PREF) === '1';
  } catch {
    return false;
  }
}

/** «Размер интерфейса» на ПК: множитель 0,8..1,5 поверх автоматического масштаба. */
export function uiScale(): number {
  try {
    const v = Number(localStorage.getItem(SCALE_PREF));
    return v >= 0.8 && v <= 1.5 ? v : 1;
  } catch {
    return 1;
  }
}

export function setUiScale(v: number): void {
  const next = Math.min(1.5, Math.max(0.8, Math.round(v * 10) / 10));
  try {
    localStorage.setItem(SCALE_PREF, String(next));
  } catch {
    /* без хранилища — до перезагрузки */
  }
  scaleApply?.();
}

let scaleApply: (() => void) | null = null;

const isPhone = (): boolean => document.body.classList.contains('mobile-ui');
const isPc = (): boolean => document.body.classList.contains('holo-ui');
const $ = (id: string): HTMLElement | null => document.getElementById(id);
const shown = (el: Element | null): boolean =>
  !!el && el instanceof HTMLElement && el.style.display !== 'none' && !el.hidden;
const openWin = (id: string): boolean => {
  const el = $(id);
  if (!el) return false;
  if (el.classList.contains('show') || el.classList.contains('open')) return true;
  return !!el.style.display && el.style.display !== 'none';
};
const motionOff = (): boolean =>
  document.body.classList.contains('holo-still') ||
  (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/** Линейные значки нижней панели: 24×24, обводка цветом текста. */
const ICON: Record<string, string> = {
  map: '<path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5V4l-6 2.5L9 4Z"/><path d="M9 4v13M15 6.5v13"/>',
  prod: '<path d="M4 20h16M6 20V10l4 2.5V10l4 2.5V10l4 2.5V20"/><path d="M8 16h1.5M12 16h1.5M16 16h1.5"/>',
  tech: '<circle cx="12" cy="12" r="1.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)"/>',
  events: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  more: '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
};
const svg = (name: string): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

/** Пункты «Ещё»: какая настоящая кнопка нажимается и как пункт называется полностью. */
const MORE: readonly { src: string; key: string; glyph: string }[] = [
  { src: 'rail-diplo', key: 'rail.diplo.title', glyph: '⬡' },
  { src: 'rail-msgs', key: 'rail.msgs.title', glyph: '✉' },
  { src: 'rail-pings', key: 'rail.pings.label', glyph: '⌖' },
  { src: 'rail-market', key: 'rail.market.label', glyph: '⇄' },
  { src: 'rail-trader', key: 'rail.trader.label', glyph: '⚖' },
  { src: 'railcorp', key: 'rail.corp.title', glyph: '⬢' },
  { src: 'rail-steward', key: 'uinext.more.steward', glyph: '☾' },
  { src: 'rail-dossier', key: 'swarm.intel.title', glyph: '☣' },
  { src: 'rail-help', key: 'rail.help.title', glyph: '?' },
  { src: 'rail-settings', key: 'rail.settings.label', glyph: '⚙' },
  { src: '[data-solo-save]', key: 'solo.save.action', glyph: '⤓' },
  { src: 'rail-abandon', key: 'rail.abandon.title', glyph: '⚑' },
  { src: 'rail-exit', key: 'uinext.more.exit', glyph: '⌂' },
];
const source = (src: string): HTMLElement | null =>
  src.startsWith('[') ? document.querySelector<HTMLElement>(src) : $(src);

/** Подписи рельсы ПК без сокращений; клавиша — у тех, у кого она есть. */
const RAIL: readonly { id: string; key: string; kbd?: string }[] = [
  { id: 'rail-dossier', key: 'swarm.intel.title' },
  { id: 'rail-diplo', key: 'rail.diplo.title' },
  { id: 'rail-msgs', key: 'rail.msgs.title', kbd: 'M' },
  { id: 'rail-pings', key: 'rail.pings.label' },
  { id: 'rail-tech', key: 'rail.tech.label', kbd: 'T' },
  { id: 'rail-constructor', key: 'rail.constructor.label', kbd: 'B' },
  { id: 'rail-steward', key: 'uinext.more.steward' },
  { id: 'rail-market', key: 'rail.market.label' },
  { id: 'rail-trader', key: 'rail.trader.label' },
  { id: 'railcorp', key: 'rail.corp.title' },
  { id: 'rail-chat', key: 'rail.chat.label' },
  { id: 'rail-log', key: 'uinext.nav.events', kbd: 'L' },
  { id: 'rail-help', key: 'rail.help.title', kbd: 'F1' },
  { id: 'rail-settings', key: 'rail.settings.label' },
  { id: 'rail-abandon', key: 'rail.abandon.title' },
  { id: 'rail-exit', key: 'uinext.more.exit' },
];

/** Режимы хаба: строка отличия под названием (правка 10). */
const MODES: readonly { id: string; key: string; desc: string }[] = [
  { id: 'hub-solo', key: 'hub.solo', desc: 'uinext.hub.solo.desc' },
  { id: 'hub-play', key: 'uinext.hub.online', desc: 'uinext.hub.online.desc' },
  { id: 'hub-sector-zero', key: 'sector-zero.enter', desc: 'uinext.hub.sector-zero.desc' },
  { id: 'hub-proving-ground', key: 'hub.proving-ground', desc: 'uinext.hub.proving-ground.desc' },
];

/** Сокращения, которые остаются заглавными и в обычной строке. */
const KEEP_CAPS = new Set(['ИИ', 'ПКО', 'ПВО', 'ЛС', 'ОП']);

/**
 * Правки 5 и 11 на уровне строки: КАПС-заголовок («ИТОГ С МОДУЛЯМИ») — обычным регистром,
 * штамп журнала «> D1 00h ·» — словами («День 1, 00:00 ·»), «→» в конце кнопки — прочь.
 */
export function normText(text: string): string {
  let out = text;
  const stamp = /^>\s*D(\d+)\s+(\d\d)h\s*·\s*/.exec(out);
  if (stamp) out = `${t('uinext.log.stamp', { d: stamp[1]!, h: stamp[2]! })} · ${out.slice(stamp[0].length)}`;
  // Стрелка, приклеенная к кнопке («Построить ×1 →»), — след генерации (правка 11).
  out = out.replace(/\s+→\s*$/, '');
  if (/[А-ЯЁ]{4,}/.test(out)) {
    const first = /\p{L}/u.exec(out);
    const capital = !!first && first[0] !== first[0].toLowerCase();
    out = out.replace(/[А-ЯЁ]+/g, (w) => (KEEP_CAPS.has(w) ? w : w.toLowerCase()));
    if (capital && first) out = out.slice(0, first.index) + out[first.index]!.toUpperCase() + out.slice(first.index + 1);
  }
  return out;
}

/** Вводная «впервые» одной строкой с числом (правка 8): ключ короткой строки по заголовку. */
export const INTRO_HINT: Readonly<Record<string, string>> = {
  'onb.intro.async-delay.title': 'uinext.intro.async-delay',
  'onb.intro.ava.title': 'uinext.intro.ava',
  'onb.intro.constructor.title': 'uinext.intro.constructor',
  'onb.intro.corp.title': 'uinext.intro.corp',
  'onb.intro.diplomacy.title': 'uinext.intro.diplomacy',
  'onb.intro.hero.title': 'uinext.intro.hero',
  'onb.intro.market.title': 'uinext.intro.market',
  'onb.intro.retreat.title': 'uinext.intro.retreat',
  'onb.intro.steward.title': 'uinext.intro.steward',
  'onb.intro.tech.title': 'uinext.intro.tech',
};

export function installUiNext(host: UiNextHost): void {
  if (typeof document === 'undefined' || $('uin-nav')) return;
  const body = document.body;

  // --- переключатель «было / стало» ------------------------------------------------------
  /** Тексты, которые слой подменил: вернуть их, когда слой снимают. */
  const swapped = new Map<HTMLElement, string>();
  const swapText = (el: HTMLElement | null | undefined, text: string): void => {
    if (!el) return;
    if (!swapped.has(el)) swapped.set(el, el.textContent ?? '');
    if (el.textContent !== text) el.textContent = text;
  };
  const restoreText = (): void => {
    for (const [el, text] of swapped) el.textContent = text;
    swapped.clear();
  };
  const setOn = (on: boolean): void => {
    body.classList.toggle('ui-next', on);
    try {
      localStorage.setItem(PREF, on ? '1' : '0');
    } catch {
      /* без хранилища — до перезагрузки */
    }
    if (!on) {
      restoreText();
      closeMore();
      body.classList.remove('uin-speed-open');
      body.style.removeProperty('--uin-pcz');
      restoreAll();
    }
    enforceDue = true;
    applyScale();
    tick();
    // Раскладки игры (рельса, лист выбора, окна ПК) пересчитываются по resize.
    window.dispatchEvent(new Event('resize'));
  };
  (window as unknown as { voidUiNext?: (on: boolean) => void }).voidUiNext = setOn;
  window.addEventListener('message', (ev) => {
    const data = ev.data as { voidUiNext?: unknown; voidUiHome?: unknown } | null;
    if (data && typeof data.voidUiNext === 'boolean') setOn(data.voidUiNext);
    // Страница прототипа сменила размер экрана посреди партии: камера остаётся там,
    // куда смотрела на прежнем размере, — вернуть её к столице.
    if (data?.voidUiHome === true && host.inMatch()) host.home();
  });

  // --- 3. нижняя панель телефона ----------------------------------------------------------
  const nav = document.createElement('nav');
  nav.id = 'uin-nav';
  nav.setAttribute('aria-label', t('uinext.nav.aria'));
  const tabs: [string, string][] = [
    ['map', 'uinext.nav.map'],
    ['prod', 'rail.constructor.label'],
    ['tech', 'rail.tech.label'],
    ['events', 'uinext.nav.events'],
    ['more', 'hub.nav.more'],
  ];
  nav.innerHTML = tabs
    .map(
      ([id, key]) =>
        `<button type="button" data-uin="${id}">${svg(id)}<span>${t(key)}</span><b class="uin-badge" hidden></b></button>`,
    )
    .join('');
  body.appendChild(nav);

  const more = document.createElement('section');
  more.id = 'uin-more';
  more.setAttribute('role', 'dialog');
  more.setAttribute('aria-label', t('hub.nav.more'));
  more.hidden = true;
  body.appendChild(more);
  const renderMore = (): void => {
    more.innerHTML =
      `<div class="uin-more-head"><b>${t('hub.nav.more')}</b><button type="button" data-uin-close="1" aria-label="${t('card.close')}">✕</button></div>` +
      `<div class="uin-more-grid">` +
      MORE.filter((m) => {
        const el = source(m.src);
        return !!el && (m.src.startsWith('[') || el.style.display !== 'none');
      })
        .map((m) => {
          const badge = m.src === 'rail-msgs' ? $('msgbadge') : null;
          const n = badge && shown(badge) ? badge.textContent : '';
          return `<button type="button" data-uin-src="${m.src}"><i aria-hidden="true">${m.glyph}</i><span>${t(m.key)}</span>${n ? `<b class="uin-badge">${n}</b>` : ''}</button>`;
        })
        .join('') +
      `</div>`;
  };
  const closeMore = (): void => {
    more.hidden = true;
  };
  more.addEventListener('click', (ev) => {
    const el = ev.target as Element;
    if (el.closest('[data-uin-close]')) return closeMore();
    const pick = el.closest<HTMLElement>('[data-uin-src]');
    if (!pick) return;
    closeMore();
    host.toMap();
    source(pick.dataset.uinSrc ?? '')?.click();
  });

  /** Открыто ли окно вкладки — для подсветки активного пункта. */
  const tabOpen: Record<string, () => boolean> = {
    prod: () => openWin('constructor'),
    tech: () => openWin('tech'),
    events: () => openWin('logwin'),
    more: () => !more.hidden,
  };
  const open = (id: string): void => {
    const was = tabOpen[id]?.() ?? false;
    closeMore();
    host.toMap();
    if (was || id === 'map') return; // второе нажатие на открытую вкладку — к карте
    if (id === 'more') {
      renderMore();
      more.hidden = false;
      return;
    }
    const target = { prod: 'rail-constructor', tech: 'rail-tech', events: 'rail-log' }[id];
    if (target) $(target)?.click();
  };
  nav.addEventListener('click', (ev) => {
    const b = (ev.target as Element).closest<HTMLElement>('[data-uin]');
    if (b?.dataset.uin) open(b.dataset.uin);
  });

  // --- 3.2 скорость одной кнопкой -------------------------------------------------------
  const speed = document.createElement('button');
  speed.id = 'uin-speed';
  speed.type = 'button';
  speed.setAttribute('aria-expanded', 'false');
  body.appendChild(speed);
  speed.addEventListener('click', () => {
    const next = !body.classList.contains('uin-speed-open');
    body.classList.toggle('uin-speed-open', next);
    speed.setAttribute('aria-expanded', String(next));
  });
  // Выбор скорости сворачивает ряд обратно в кнопку.
  $('speedbar')?.addEventListener('click', (ev) => {
    if (!uiNextOn() || !isPhone()) return;
    if ((ev.target as Element).closest('button')) {
      body.classList.remove('uin-speed-open');
      speed.setAttribute('aria-expanded', 'false');
    }
  });
  const speedText = (): string => {
    const bar = $('speedbar');
    if (!bar) return '';
    const paused = $('spd-pause')?.classList.contains('on');
    const fast = $('spd-fast')?.classList.contains('on');
    const mult = bar.querySelector<HTMLElement>('.spd-mult-legacy .spdmini.on')?.textContent ?? '';
    return paused ? `‖ ${t('hud.run.pause')}` : `${fast ? '▶▶' : '▶'}${mult ? ' ' + mult : ''}`;
  };

  // --- 9. клавиши ПК ----------------------------------------------------------------------
  const typing = (el: EventTarget | null): boolean =>
    el instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
  const onMap = (): boolean => {
    const a = document.activeElement;
    return !a || a === body || a.id === 'map';
  };
  window.addEventListener('keydown', (e) => {
    if (!uiNextOn() || !isPc() || !host.inMatch() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (typing(e.target)) return;
    const click = (id: string): void => {
      e.preventDefault();
      $(id)?.click();
      flashKey(id);
    };
    const timeShown = shown($('spd-ctl')) && shown($('speedbar'));
    switch (e.code) {
      case 'KeyT':
        return click('holo-tech');
      case 'KeyB':
        return click('holo-constructor');
      case 'KeyL':
        return click('rail-log');
      case 'KeyM':
        return click('rail-msgs');
      case 'F1':
        return click('rail-help');
      case 'KeyH':
      case 'Home':
        e.preventDefault();
        host.home();
        return;
      case 'Tab':
        if (!onMap() || e.shiftKey) return;
        e.preventDefault();
        host.nextFleet();
        return;
      case 'Space':
        if (!timeShown || !onMap()) return;
        e.preventDefault();
        ($('spd-pause')?.classList.contains('on') ? $('spd-play') : $('spd-pause'))?.click();
        return;
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4': {
        if (!timeShown) return;
        const chips = [...document.querySelectorAll<HTMLElement>('#speedbar .spd-mult-pc .spdmini')];
        const chip = chips[Number(e.code.slice(5)) - 1];
        if (!chip) return;
        e.preventDefault();
        chip.click();
        return;
      }
    }
  });
  const flashKey = (id: string): void => {
    const el = $(id);
    if (!el || motionOff()) return;
    el.classList.remove('uin-key-hit');
    void el.offsetWidth;
    el.classList.add('uin-key-hit');
  };

  // Памятка клавиш: один раз при входе в партию на ПК, сама гаснет.
  const keys = document.createElement('aside');
  keys.id = 'uin-keys';
  keys.hidden = true;
  keys.innerHTML =
    `<b>${t('uinext.keys.title')}</b>` +
    [
      ['T', 'rail.tech.label'],
      ['B', 'rail.constructor.label'],
      ['L', 'uinext.nav.events'],
      ['H', 'uinext.keys.home'],
      ['Tab', 'uinext.keys.next-fleet'],
    ]
      .map(([k, key]) => `<span><kbd>${k}</kbd>${t(key!)}</span>`)
      .join('') +
    `<button type="button" aria-label="${t('card.close')}">✕</button>`;
  body.appendChild(keys);
  keys.querySelector('button')?.addEventListener('click', () => (keys.hidden = true));
  let keysShownFor = false;
  let keysTimer = 0;

  // --- 2. масштаб ПК ----------------------------------------------------------------------
  const applyScale = (): void => {
    if (!uiNextOn() || !isPc()) {
      body.style.removeProperty('--uin-pcz');
      return;
    }
    const auto = Math.min(2, Math.max(1, window.innerHeight / 864));
    const z = Math.min(2.4, Math.max(0.8, auto * uiScale()));
    const v = z.toFixed(3);
    if (body.style.getPropertyValue('--uin-pcz') !== v) {
      body.style.setProperty('--uin-pcz', v);
      window.dispatchEvent(new Event('resize'));
    }
  };
  scaleApply = applyScale;
  window.addEventListener('resize', applyScale);

  // --- 4. «+N» у плашек ресурсов ------------------------------------------------------------
  const last = new Map<string, number>();
  const acc = new Map<string, { sum: number; at: number }>();
  let wasInMatch = false;
  const float = (res: HTMLElement, delta: number): void => {
    const r = res.getBoundingClientRect();
    if (!r.width) return;
    const el = document.createElement('span');
    el.className = `uin-float ${delta > 0 ? 'up' : 'dn'}`;
    el.textContent = `${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta))}`;
    el.style.left = `${Math.round(r.left + r.width / 2)}px`;
    el.style.top = `${Math.round(r.bottom - 6)}px`;
    body.appendChild(el);
    res.classList.remove('uin-bump', 'uin-bump-dn');
    void res.offsetWidth;
    res.classList.add(delta > 0 ? 'uin-bump' : 'uin-bump-dn');
    setTimeout(() => el.remove(), 1400);
  };
  const fmt = (n: number): string => (n >= 10000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));
  const watchPurse = (now: number): void => {
    for (const res of document.querySelectorAll<HTMLElement>('#purse .res[data-res]')) {
      const key = res.dataset.res!;
      const v = Number(res.querySelector<HTMLElement>('b[data-n]')?.dataset.n);
      if (!Number.isFinite(v)) continue;
      const prev = last.get(key);
      last.set(key, v);
      if (prev === undefined) continue;
      const d = v - prev;
      const a = acc.get(key) ?? { sum: 0, at: now };
      if (d <= -1) {
        // Трата видна сразу: игрок только что нажал «Построить».
        float(res, d);
        acc.set(key, { sum: 0, at: now });
        continue;
      }
      a.sum += d;
      if (a.sum >= 1 && now - a.at >= 4000) {
        float(res, a.sum);
        a.sum = 0;
        a.at = now;
      }
      acc.set(key, a);
    }
  };

  // --- 1. сторож размеров -----------------------------------------------------------------
  /** Мельче 12 px текста не бывает; на телефоне кнопка меньше 44 px получает поле нажатия. */
  /** Подписи и строки, у которых слой поправил текст: вернуть их, когда слой снимают. */
  const origText = new Map<Text, string>();
  const checked = new WeakSet<Element>();
  const enforce = (): void => {
    const phone = isPhone();
    for (const el of document.querySelectorAll<HTMLElement>(
      'body > :not(canvas):not(script):not(style) *:not(svg *)',
    )) {
      if (checked.has(el) || !el.firstChild || el.offsetParent === null) continue;
      checked.add(el);
      let text = false;
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !n.textContent!.trim()) continue;
        text = true;
        const node = n as Text;
        const next = normText(node.data);
        if (next !== node.data) {
          if (!origText.has(node)) origText.set(node, node.data);
          node.data = next;
        }
      }
      if (text && parseFloat(getComputedStyle(el).fontSize) < 12) el.classList.add('uin-min');
      if (phone && el.tagName === 'BUTTON') {
        const r = el.getBoundingClientRect();
        if (
          r.width > 0 &&
          (r.height < 40 || r.width < 40) &&
          getComputedStyle(el).position === 'static' &&
          getComputedStyle(el, '::after').content === 'none'
        )
          el.classList.add('uin-tap');
      }
    }
  };
  const restoreAll = (): void => {
    for (const [node, data] of origText) if (node.isConnected) node.data = data;
    origText.clear();
    for (const el of document.querySelectorAll('.uin-min,.uin-tap')) {
      el.classList.remove('uin-min', 'uin-tap');
      checked.delete(el);
    }
  };
  let enforceDue = true;
  new MutationObserver(() => (enforceDue = true)).observe(body, { childList: true, subtree: true });

  // --- 10. хаб ---------------------------------------------------------------------------
  const hubDoor = document.createElement('button');
  hubDoor.id = 'uin-door';
  hubDoor.type = 'button';
  $('hub-play')?.parentElement?.insertBefore(hubDoor, $('hub-play'));
  hubDoor.addEventListener('click', () => {
    const go = hubDoor.dataset.go;
    if (go) $(go)?.click();
  });
  const modesHead = document.createElement('div');
  modesHead.className = 'hub-sec uin-modes-head';
  hubDoor.after(modesHead);
  const emptyMine = document.createElement('div');
  emptyMine.className = 'hub-card uin-mine-empty';
  $('hub-mine')?.after(emptyMine);
  emptyMine.addEventListener('click', (ev) => {
    if ((ev.target as Element).closest('button')) $('hub-solo')?.click();
  });
  /** Рейтинг и друзья уходят из нижней панели хаба в «Ещё». */
  const grid = document.querySelector('#hp-more .hub-grid');
  for (const [tab, glyph, key] of [
    ['rank', '▤', 'hub.nav.rank'],
    ['friends', '☍', 'hub.nav.friends'],
  ] as const) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'hub-tile uin-only';
    tile.innerHTML = `<span class="ht-ic">${glyph}</span><span>${t(key)}</span>`;
    tile.addEventListener('click', () => document.querySelector<HTMLElement>(`.hub-tab[data-hub="${tab}"]`)?.click());
    grid?.prepend(tile);
  }
  const hub = (): void => {
    // Главная дверь: продолжить партию → обучение для новичка → одиночная игра.
    const cont = $('hub-solo-continue');
    const nudge = $('onboard-nudge');
    const door =
      cont && !cont.hidden
        ? { go: 'hub-solo-continue', key: 'uinext.hub.continue', sub: 'uinext.hub.continue.sub' }
        : nudge && nudge.style.display !== 'none'
          ? { go: 'ob-start', key: 'uinext.hub.tutorial', sub: 'uinext.hub.tutorial.sub' }
          : { go: 'hub-solo', key: 'hub.solo', sub: 'uinext.hub.solo.desc' };
    if (hubDoor.dataset.go !== door.go) {
      hubDoor.dataset.go = door.go;
      hubDoor.innerHTML = `<b>${t(door.key)}</b><span>${t(door.sub)}</span>`;
    }
    body.classList.toggle('uin-door-tutorial', door.go === 'ob-start');
    body.classList.toggle('uin-door-continue', door.go === 'hub-solo-continue');
    if (!modesHead.textContent) modesHead.textContent = t('uinext.hub.modes');
    for (const m of MODES) {
      const b = $(m.id);
      if (!b) continue;
      swapText(b, t(m.key));
      if (b.dataset.uinDesc !== t(m.desc)) b.dataset.uinDesc = t(m.desc);
    }
    const mine = $('hub-mine');
    const empty = !mine || mine.children.length === 0;
    emptyMine.hidden = !empty;
    if (empty && !emptyMine.firstChild)
      emptyMine.innerHTML =
        `<div class="hc-ic">◇</div><div><div class="hc-t">${t('uinext.hub.mine.empty')}</div>` +
        `<div class="hc-s">${t('uinext.hub.mine.empty.sub')}</div>` +
        `<button type="button" class="uin-mine-go">${t('uinext.hub.mine.start')}</button></div>`;
    const digestSub = document.querySelector<HTMLElement>('#hp-home .hub-card .hc-s');
    swapText(digestSub, t('uinext.hub.digest.sub'));
  };

  // --- кадр слоя ------------------------------------------------------------------------
  const tick = (): void => {
    if (!uiNextOn()) {
      wasInMatch = false;
      return;
    }
    const match = host.inMatch();
    body.classList.toggle('uin-match', match);
    if (!match) {
      hub();
      last.clear();
      acc.clear();
      closeMore();
      keysShownFor = false;
      keys.hidden = true;
    } else {
      // Активная вкладка и счётчики.
      const active = tabOpen.prod!() ? 'prod' : tabOpen.tech!() ? 'tech' : tabOpen.events!() ? 'events' : !more.hidden ? 'more' : 'map';
      for (const b of nav.querySelectorAll<HTMLElement>('[data-uin]')) {
        const on = b.dataset.uin === active;
        if (b.classList.contains('on') !== on) {
          b.classList.toggle('on', on);
          b.setAttribute('aria-current', on ? 'page' : 'false');
        }
      }
      const alert = $('alertbadge');
      const evBadge = nav.querySelector<HTMLElement>('[data-uin="events"] .uin-badge')!;
      const n = alert && shown(alert) ? alert.textContent ?? '' : '';
      evBadge.hidden = !n;
      if (evBadge.textContent !== n) evBadge.textContent = n;
      const mail = $('msgbadge');
      const moreBadge = nav.querySelector<HTMLElement>('[data-uin="more"] .uin-badge')!;
      const m = mail && shown(mail) ? mail.textContent ?? '' : '';
      moreBadge.hidden = !m;
      if (moreBadge.textContent !== m) moreBadge.textContent = m;
      const label = speedText();
      if (speed.textContent !== label) speed.textContent = label;
      speed.hidden = !shown($('speedbar')) || !shown($('spd-ctl'));
      // ПК: подписи рельсы и клавиши у кнопок.
      if (isPc()) {
        for (const r of RAIL) {
          const lbl = $(r.id)?.querySelector<HTMLElement>('.rlbl');
          swapText(lbl, t(r.key));
          if (lbl && r.kbd && lbl.dataset.kbd !== r.kbd) lbl.dataset.kbd = r.kbd;
        }
      }
      swapText($('logwin')?.querySelector<HTMLElement>('.lw-head b') ?? null, t('uinext.nav.events'));
      swapText($('tech')?.querySelector<HTMLElement>('.lw-head b') ?? null, t('rail.tech.label'));
      if (isPc()) {
        const tech = $('holo-tech');
        const prod = $('holo-constructor');
        swapText(tech, t('rail.tech.label'));
        swapText(prod, t('rail.constructor.label'));
        if (tech) tech.dataset.kbd = 'T';
        if (prod) prod.dataset.kbd = 'B';
        if (!keysShownFor) {
          keysShownFor = true;
          keys.hidden = false;
          clearTimeout(keysTimer);
          keysTimer = window.setTimeout(() => (keys.hidden = true), 14000);
        }
      }
      if (!wasInMatch) {
        last.clear();
        acc.clear();
      }
      if (document.visibilityState === 'visible') watchPurse(performance.now());
    }
    wasInMatch = match;
    if (enforceDue) {
      enforceDue = false;
      enforce();
    }
  };
  setInterval(tick, 400);
  if (readPref()) setOn(true);
}
