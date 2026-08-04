/**
 * Плавающее окно чата (desktop only, REFM-12) — подвижный и растягиваемый оверлей
 * поверх карты, живущий рядом с вкладкой «Сообщения», но со своей геометрией,
 * своими настройками и своим кэшем в localStorage (`vd.chat.v1`).
 *
 * Форма та же, что у остальных REFM-экранов: всё, что только считает, — обычная
 * экспортируемая функция (её можно проверить без DOM), а `initChat(host)` берёт
 * зависимости явно. Здесь это особенно окупается: геометрия перетаскивания —
 * чистая арифметика с якорями противоположных краёв, и до выноса её нельзя было
 * проверить ничем, кроме мышки.
 *
 * Что осталось в `main.ts`: словарь каналов (`COALITION`/`CH_SESSION`/`CH_GLOBAL`
 * делит с вкладкой «Сообщения»), журнал сообщений и `convoLineHtml` — окно
 * получает их хуками, а не тянет обратно.
 */
import { t } from '../../localization/runtime';
import { esc } from './format';

/** Сообщение сессии в том виде, в каком его читает окно (структурно — `SessionMsg`
 *  из `main.ts`; здесь описано узко, чтобы модуль не зависел от хоста). */
export interface ChatMessage {
  at: number;
  from: string;
  to: string;
  text: string;
  sys: boolean;
  realAt?: number;
}

/** Набор штампов строки (структурно — `StampOpts` из `main.ts`). */
export interface ChatStamp {
  day?: boolean;
  time?: boolean;
  real?: boolean;
}

/** Вкладка окна: групповая комната или личка. */
export interface ChatTab {
  key: string;
  label: string;
  icon: string;
}

/** Пользовательские настройки окна — целиком уезжают в localStorage. */
export interface ChatCfg {
  fontPx: number;
  transparency: number;
  censor: boolean;
  color: string;
  showDay: boolean;
  showTime: boolean;
  showReal: boolean;
}

/** Положение и размер в CSS-пикселях. */
export interface ChatGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Активный жест: режим, задетый край и снимок геометрии, от которого тянем. */
export interface ChatDrag {
  mode: 'move' | 'resize';
  dir: string;
  px: number;
  py: number;
  gx: number;
  gy: number;
  gw: number;
  gh: number;
}

export const CHAT_STORE_KEY = 'vd.chat.v1';

/** Нижние границы окна: уже/ниже него интерфейс перестаёт быть пригодным. */
export const CHAT_MIN_W = 220;
export const CHAT_MIN_H = 150;
/** Верхняя граница по вертикали: заголовок обязан оставаться доступен под топ-баром. */
export const CHAT_TOP_Y = 46;
/** Толщина зоны захвата края под ресайз, в пикселях. */
export const CHAT_EDGE = 7;
/** Пределы шрифта ленты. */
export const CHAT_FONT_MIN = 8;
export const CHAT_FONT_MAX = 42;

export const DEFAULT_CHAT_CFG: ChatCfg = {
  fontPx: 13,
  transparency: 8,
  censor: false,
  color: '',
  showDay: true,
  showTime: true,
  showReal: false,
};

export const DEFAULT_CHAT_GEOM: ChatGeom = { x: 12, y: 0, w: 360, h: 300 };

/**
 * Наивная чистка брани для необязательного тумблера «цензура»: слово целиком
 * заменяется звёздочками той же длины, чтобы строка не переехала.
 *
 * Границы слова заданы через `\p{L}\p{N}`, а не через `\b`: `\b` в JS считает
 * «словом» только ASCII, поэтому вокруг кириллицы он срабатывает где попало.
 * Без этой оговорки «hello» превращалось в «****o», а «scrapbook» — в «s****book».
 */
export const CHAT_BADWORDS = ['идиот', 'дурак', 'тупой', 'damn', 'hell', 'crap'];

/** Экранирование метасимволов: словарь — константа, но добавить в него `c++`
 *  однажды захотят, и тогда без этого регулярка молча сломается. */
function reEscape(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Компилируется один раз на модуль, а не на каждое сообщение в каждой перерисовке.
const BADWORD_RE = CHAT_BADWORDS.map(
  (w) => new RegExp(`(?<![\\p{L}\\p{N}])${reEscape(w)}(?![\\p{L}\\p{N}])`, 'giu'),
);

export function censorText(text: string): string {
  let out = text;
  for (const re of BADWORD_RE) out = out.replace(re, (m) => '*'.repeat(m.length));
  return out;
}

/** Потолок размера окна — половина экрана, но не ниже минимума. */
export function chatBounds(vw: number, vh: number): { maxW: number; maxH: number } {
  return {
    maxW: Math.max(CHAT_MIN_W, Math.floor(vw / 2)),
    maxH: Math.max(CHAT_MIN_H, Math.floor(vh / 2)),
  };
}

/** Загнать геометрию в границы экрана: размер — в вилку, положение — так, чтобы
 *  заголовок оставался достижим. Чистая: возвращает НОВЫЙ объект. */
export function clampGeom(geom: ChatGeom, vw: number, vh: number): ChatGeom {
  const { maxW, maxH } = chatBounds(vw, vh);
  const w = Math.max(CHAT_MIN_W, Math.min(geom.w, maxW));
  const h = Math.max(CHAT_MIN_H, Math.min(geom.h, maxH));
  return {
    w,
    h,
    x: Math.max(0, Math.min(geom.x, Math.max(0, vw - w))),
    y: Math.max(CHAT_TOP_Y, Math.min(geom.y, Math.max(CHAT_TOP_Y, vh - 40))),
  };
}

/** Геометрия окна при первом открытии: паркуемся в левый нижний угол. */
export function initialGeom(vw: number, vh: number): ChatGeom {
  const w = Math.min(DEFAULT_CHAT_GEOM.w, Math.max(CHAT_MIN_W, Math.floor(vw / 2)));
  const h = Math.min(DEFAULT_CHAT_GEOM.h, Math.max(CHAT_MIN_H, Math.floor(vh / 2)));
  return { w, h, x: 12, y: Math.max(CHAT_TOP_Y, vh - h - 12) };
}

/** Разобранный кэш настроек. `placed` = в кэше была геометрия, значит первое
 *  открытие возьмёт её, а не парковку по умолчанию. */
export interface ChatCache {
  cfg: ChatCfg;
  geom: ChatGeom;
  pinned: boolean;
  placed: boolean;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Разбор кэша из localStorage — ВАЛИДИРУЮЩИЙ.
 *
 * Содержимое localStorage — внешние данные (A05/A08): его правит кто угодно с
 * консолью, оно переживает смену версии формата и портится само. Раньше сюда шёл
 * `Object.assign(chatGeom, v.geom)` без проверки, поэтому запись вида
 * `{"geom":{"w":"abc"}}` давала `Math.min('abc', maxW)` → NaN → `style.width =
 * 'NaNpx'`, и окно схлопывалось при открытии. Теперь любое поле не того типа
 * (или NaN/Infinity) молча заменяется значением по умолчанию.
 *
 * Возвращает `null`, если кэша нет или он вообще не JSON.
 */
export function parseChatCache(raw: string | null): ChatCache | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null; // не JSON — как будто кэша нет
  }
  if (typeof v !== 'object' || v === null) return null;
  const box = v as { cfg?: unknown; geom?: unknown; pinned?: unknown };
  const c = (typeof box.cfg === 'object' && box.cfg !== null ? box.cfg : {}) as Record<
    string,
    unknown
  >;
  const g = typeof box.geom === 'object' && box.geom !== null ? (box.geom as Record<string, unknown>) : null;
  return {
    cfg: {
      // Шрифт и прозрачность зажимаются здесь же: кэш с fontPx: 1e9 иначе
      // растянул бы ленту на весь экран до первой правки в настройках.
      fontPx: Math.max(
        CHAT_FONT_MIN,
        Math.min(CHAT_FONT_MAX, finiteOr(c.fontPx, DEFAULT_CHAT_CFG.fontPx)),
      ),
      transparency: Math.max(0, Math.min(100, finiteOr(c.transparency, DEFAULT_CHAT_CFG.transparency))),
      censor: boolOr(c.censor, DEFAULT_CHAT_CFG.censor),
      color: typeof c.color === 'string' ? c.color : DEFAULT_CHAT_CFG.color,
      showDay: boolOr(c.showDay, DEFAULT_CHAT_CFG.showDay),
      showTime: boolOr(c.showTime, DEFAULT_CHAT_CFG.showTime),
      showReal: boolOr(c.showReal, DEFAULT_CHAT_CFG.showReal),
    },
    geom: g
      ? {
          x: finiteOr(g.x, DEFAULT_CHAT_GEOM.x),
          y: finiteOr(g.y, DEFAULT_CHAT_GEOM.y),
          w: finiteOr(g.w, DEFAULT_CHAT_GEOM.w),
          h: finiteOr(g.h, DEFAULT_CHAT_GEOM.h),
        }
      : { ...DEFAULT_CHAT_GEOM },
    pinned: boolOr(box.pinned, false),
    placed: g !== null,
  };
}

/** Какого края окна касается указатель (`n`/`s`/`e`/`w` и углы, либо пусто). */
export function edgeAt(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): string {
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  let d = '';
  if (y <= CHAT_EDGE) d += 'n';
  else if (y >= rect.height - CHAT_EDGE) d += 's';
  if (x <= CHAT_EDGE) d += 'w';
  else if (x >= rect.width - CHAT_EDGE) d += 'e';
  return d;
}

export function resizeCursor(d: string): string {
  if (d === 'n' || d === 's') return 'ns-resize';
  if (d === 'e' || d === 'w') return 'ew-resize';
  if (d === 'ne' || d === 'sw') return 'nesw-resize';
  if (d === 'nw' || d === 'se') return 'nwse-resize';
  return '';
}

/** Перемещение: окно едет за указателем от снимка, взятого в начале жеста. */
export function moveGeom(drag: ChatDrag, dx: number, dy: number): ChatGeom {
  return { x: drag.gx + dx, y: drag.gy + dy, w: drag.gw, h: drag.gh };
}

/**
 * Растягивание. Края, противоположные тянущемуся, стоят на месте: потянув за `w`
 * или `n`, двигаем именно этот край, а дальний остаётся — коробка растёт К
 * указателю, а не от него. Поэтому у западного и северного краёв размер зажимается
 * ДО вычисления новой координаты (иначе на упоре в минимум окно поехало бы вбок).
 */
export function resizeGeom(drag: ChatDrag, dx: number, dy: number, vw: number, vh: number): ChatGeom {
  const { maxW, maxH } = chatBounds(vw, vh);
  const d = drag.dir;
  const out: ChatGeom = { x: drag.gx, y: drag.gy, w: drag.gw, h: drag.gh };
  if (d.includes('e')) out.w = drag.gw + dx;
  if (d.includes('s')) out.h = drag.gh + dy;
  if (d.includes('w')) {
    const nw = Math.max(CHAT_MIN_W, Math.min(drag.gw - dx, maxW));
    out.x = drag.gx + (drag.gw - nw);
    out.w = nw;
  }
  if (d.includes('n')) {
    const nh = Math.max(CHAT_MIN_H, Math.min(drag.gh - dy, maxH));
    out.y = drag.gy + (drag.gh - nh);
    out.h = nh;
  }
  return out;
}

/** Хост-зависимости окна — всё, что оно читает из живого матча. */
export interface ChatHost {
  /** Элемент окна (`#chatwin`). */
  root(): HTMLElement | null;
  /** Вьюпорт в CSS-пикселях (`VW`/`VH`). */
  viewport(): { w: number; h: number };
  /** Окно только для десктопа: на телефоне не открывается вовсе. */
  isMobile(): boolean;
  /** Три постоянные групповые комнаты — подписи и иконки делает хост (там живёт `t()`). */
  groupTabs(): ChatTab[];
  /** Групповая комната или личка. */
  isGroup(key: string): boolean;
  /** Весь журнал сессии — по нему находятся уже существующие личные переписки. */
  messages(): ChatMessage[];
  /** Место, за которым играешь. */
  me(): string;
  /** Есть ли такое место в матче прямо сейчас. */
  seatExists(id: string): boolean;
  /** Имя и значок места. */
  seatLabel(id: string): string;
  seatIcon(id: string): string;
  /** Сообщения одного канала — фильтрует хост. */
  convoMessages(key: string): ChatMessage[];
  /** Отрисовка одной строки (делится с вкладкой «Сообщения»). */
  lineHtml(m: ChatMessage, stamp: ChatStamp): string;
  /** Отправка: в сети — реле сервера с эхом, в соло — локальная дозапись. */
  dispatch(key: string, text: string): void;
  /** Тап по нику открывает карточку места. */
  openSeatCard(id: string): void;
  /**
   * Тап по строке-пингу уводит камеру к отмеченной провинции.
   *
   * Нужен именно хуком: строки рисует общий `convoLineHtml`, поэтому пинг выглядит
   * кликабельным (глобальный CSS `.dp-line.ping{cursor:pointer}`) в ОБОИХ местах —
   * и в панели «Депеши», и здесь. Но обработчик прыжка исторически висел только на
   * `#diplo`, а `#chatwin` — независимый узел, события до него не всплывают: в окне
   * чата клик по пингу молча не делал ничего. Коалиционная вкладка — как раз тот
   * канал, куда пинги и падают, так что задет основной сценарий.
   */
  jumpToPing(planetId: string): void;
}

/** Вкладки окна: постоянные комнаты, затем по вкладке на каждую существующую личку
 *  (плюс открытая — чтобы только что начатая переписка не пропала из ряда). */
export function discoverTabs(
  host: Pick<ChatHost, 'groupTabs' | 'isGroup' | 'messages' | 'me' | 'seatExists' | 'seatLabel' | 'seatIcon'>,
  openTab: string,
): ChatTab[] {
  const base = [...host.groupTabs()];
  const me = host.me();
  const dm = new Set<string>();
  for (const m of host.messages()) {
    if (host.isGroup(m.to)) continue;
    if (m.from === me) dm.add(m.to);
    else if (m.to === me) dm.add(m.from);
  }
  if (!host.isGroup(openTab)) dm.add(openTab);
  for (const id of dm) {
    if (host.seatExists(id)) base.push({ key: id, label: host.seatLabel(id), icon: host.seatIcon(id) });
  }
  return base;
}

export function tabLabel(tabs: ChatTab[], key: string, fallback: string): string {
  return tabs.find((c) => c.key === key)?.label ?? fallback;
}

/** Лента канала. Пустой канал читается как «здесь пока пусто», а не как дыра. */
export function feedInnerHtml(
  msgs: ChatMessage[],
  channelLabel: string,
  cfg: ChatCfg,
  lineHtml: (m: ChatMessage, stamp: ChatStamp) => string,
): string {
  if (!msgs.length) {
    return `<div class="cw-empty">${t('chat.win.empty', { ch: esc(channelLabel) })}<br>${t('chat.win.empty.hint')}</div>`;
  }
  const stamp: ChatStamp = { day: cfg.showDay, time: cfg.showTime, real: cfg.showReal };
  return msgs.map((m) => lineHtml(cfg.censor ? { ...m, text: censorText(m.text) } : m, stamp)).join('');
}

/** Всплывающая панель настроек, вылетающая вправо: размер (в одну строку), шрифт,
 *  цвет (пока по подписке), цензура, прозрачность и тумблеры штампов. */
export function settingsHtml(geom: ChatGeom, cfg: ChatCfg, vw: number, vh: number): string {
  const { maxW, maxH } = chatBounds(vw, vh);
  const chk = (on: boolean): string => (on ? ' checked' : '');
  return (
    `<div class="cw-set">` +
    `<h4>${t('settings.title')}</h4>` +
    `<div class="cw-srow"><label>${t('chat.win.size')}</label>` +
    `<input type="number" data-cset="h" min="${CHAT_MIN_H}" max="${maxH}" value="${geom.h}">` +
    `<input type="number" data-cset="w" min="${CHAT_MIN_W}" max="${maxW}" value="${geom.w}"></div>` +
    `<div class="cw-srow"><label>${t('chat.win.font')}</label><input type="number" data-cset="font" min="${CHAT_FONT_MIN}" max="${CHAT_FONT_MAX}" value="${cfg.fontPx}"></div>` +
    `<div class="cw-srow"><label>${t('chat.win.color')}</label><input type="color" data-cset="color" value="#7fe7ff" disabled><span class="cw-sub">🔒 ${t('chat.win.color.premium')}</span></div>` +
    `<div class="cw-srow"><label>${t('chat.win.censor')}</label><input type="checkbox" data-cset="censor"${chk(cfg.censor)}></div>` +
    `<div class="cw-srow"><label>${t('chat.win.opacity')}</label><input type="range" data-cset="opacity" min="0" max="100" value="${cfg.transparency}"><span class="cw-opval">${cfg.transparency}%</span></div>` +
    `<div class="cw-shdr">${t('chat.win.stamp')}</div>` +
    `<div class="cw-srow"><label>${t('chat.win.stamp.day')}</label><input type="checkbox" data-cset="showDay"${chk(cfg.showDay)}></div>` +
    `<div class="cw-srow"><label>${t('chat.win.stamp.time')}</label><input type="checkbox" data-cset="showTime"${chk(cfg.showTime)}></div>` +
    `<div class="cw-srow"><label>${t('chat.win.stamp.real')}</label><input type="checkbox" data-cset="showReal"${chk(cfg.showReal)}></div>` +
    `</div>`
  );
}

/** Разметка окна целиком. Собирается только по действию (открытие / вкладка /
 *  кнопка), никогда не по кадру: геометрия и лента потом правятся на месте. */
export function windowHtml(o: {
  tabs: ChatTab[];
  openTab: string;
  channelLabel: string;
  pinned: boolean;
  min: boolean;
  settingsOpen: boolean;
  geom: ChatGeom;
  cfg: ChatCfg;
  vw: number;
  vh: number;
  feedHtml: string;
}): string {
  const tabs = o.tabs
    .map(
      (c) =>
        `<button class="cw-tab${c.key === o.openTab ? ' on' : ''}" data-cwtab="${esc(c.key)}" title="${esc(c.label)}">${c.icon} ${esc(c.label)}</button>`,
    )
    .join('');
  return (
    `<div class="cw-head" data-cwhead title="${o.pinned ? '' : t('chat.win.drag')}">` +
    `<span class="cw-title">${t('chat.win.title', { ch: esc(o.channelLabel) })}</span>` +
    `<button class="cw-btn${o.pinned ? ' on' : ''}" data-cwact="pin" title="${t('chat.win.pin')}">📎</button>` +
    `<button class="cw-btn${o.settingsOpen ? ' on' : ''}" data-cwact="settings" title="${t('chat.win.settings')}">⚙</button>` +
    `<button class="cw-btn" data-cwact="min" title="${o.min ? t('chat.win.expand') : t('chat.win.collapse')}">${o.min ? '▢' : '—'}</button>` +
    `</div>` +
    `<div class="cw-tabs">${tabs}</div>` +
    `<div class="cw-feed" id="cw-feed">${o.feedHtml}</div>` +
    `<div class="cw-compose"><input id="cw-text" type="text" maxlength="240" placeholder="${t('chat.input.ph')}" autocomplete="off"><button class="cw-send" data-cwact="send" title="${t('chat.win.send')}">▶</button></div>` +
    (o.settingsOpen ? settingsHtml(o.geom, o.cfg, o.vw, o.vh) : '')
  );
}

/** Инлайновые стили окна: положение, размер, прозрачность, кегль ленты. Прозрачность
 *  гасит И заливку, И рамку — не `opacity` элемента, иначе поблёкли бы и текст, и
 *  панель настроек. */
export function geomStyle(
  geom: ChatGeom,
  cfg: ChatCfg,
  min: boolean,
): { left: string; top: string; width: string; height: string; background: string; borderColor: string } {
  const k = 1 - cfg.transparency / 100;
  return {
    left: geom.x + 'px',
    top: geom.y + 'px',
    width: geom.w + 'px',
    height: min ? 'auto' : geom.h + 'px',
    background: `rgba(3,14,18,${(0.82 * k).toFixed(3)})`,
    borderColor: `rgba(53,214,230,${k.toFixed(3)})`,
  };
}

/**
 * Что окно отдаёт наружу — ровно те пять вещей, которые у него спрашивает `main.ts`:
 * кнопка на рейле (`toggle`), реестр закрываемых слоёв Back/Escape (`isOpen`/`close`),
 * приход нового сообщения (`refreshIfVisible`) и смена размера вьюпорта.
 */
export interface ChatWindow {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  /** Новое сообщение: перекрасить ленту, только если она сейчас видна (окно открыто
   *  и не свёрнуто). Свёрнутое окно ленты не показывает — красить нечего. */
  refreshIfVisible: () => void;
  /** Вьюпорт изменился (поворот, ресайз): потолок в половину экрана поехал —
   *  пережать геометрию и применить её, не пересобирая разметку. */
  onViewportResize: () => void;
}

/**
 * Собрать окно. Вызывается один раз на старте: восстанавливает кэш, вешает
 * делегированные обработчики на `#chatwin` и глобальные — на жест перетаскивания.
 */
export function initChat(host: ChatHost, sessionTab: string): ChatWindow {
  let open = false;
  let min = false; // свёрнуто до заголовка
  let pinned = false; // положение и размер заперты
  let settingsOpen = false;
  let placed = false; // окно уже парковали или восстанавливали?
  let tab = sessionTab;
  let cfg: ChatCfg = { ...DEFAULT_CHAT_CFG };
  let geom: ChatGeom = { ...DEFAULT_CHAT_GEOM };
  let drag: ChatDrag | null = null;

  const vp = (): { w: number; h: number } => host.viewport();

  const save = (): void => {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(CHAT_STORE_KEY, JSON.stringify({ cfg, geom, pinned }));
    } catch {
      /* хранилище выключено или заполнено — настройки просто не переживут перезагрузку */
    }
  };

  const load = (): void => {
    let raw: string | null;
    try {
      if (typeof localStorage === 'undefined') return;
      raw = localStorage.getItem(CHAT_STORE_KEY);
    } catch {
      return; // доступ к хранилищу запрещён
    }
    const cached = parseChatCache(raw);
    if (!cached) return;
    cfg = cached.cfg;
    geom = cached.geom;
    pinned = cached.pinned;
    placed = cached.placed;
  };

  const applyGeom = (): void => {
    const win = host.root();
    if (!win) return;
    Object.assign(win.style, geomStyle(geom, cfg, min));
    const feed = win.querySelector('#cw-feed') as HTMLElement | null;
    if (feed) feed.style.fontSize = cfg.fontPx + 'px';
  };

  const tabsNow = (): ChatTab[] => discoverTabs(host, tab);

  const feedHtmlNow = (): string => {
    const label = tabLabel(tabsNow(), tab, host.seatLabel(tab));
    return feedInnerHtml(host.convoMessages(tab), label, cfg, host.lineHtml);
  };

  const renderFeed = (): void => {
    const win = host.root();
    const feed = win?.querySelector('#cw-feed') as HTMLElement | null;
    if (!feed) return;
    feed.innerHTML = feedHtmlNow();
    feed.scrollTop = feed.scrollHeight;
  };

  const render = (): void => {
    const win = host.root();
    if (!win) return;
    win.classList.toggle('open', open);
    win.classList.toggle('min', min);
    win.classList.toggle('pinned', pinned);
    if (!open) {
      win.innerHTML = '';
      return;
    }
    const tabs = tabsNow();
    const { w: vw, h: vh } = vp();
    win.innerHTML = windowHtml({
      tabs,
      openTab: tab,
      channelLabel: tabLabel(tabs, tab, host.seatLabel(tab)),
      pinned,
      min,
      settingsOpen,
      geom,
      cfg,
      vw,
      vh,
      feedHtml: feedInnerHtml(host.convoMessages(tab), tabLabel(tabs, tab, host.seatLabel(tab)), cfg, host.lineHtml),
    });
    applyGeom();
    const feed = win.querySelector('#cw-feed') as HTMLElement | null;
    if (feed) feed.scrollTop = feed.scrollHeight;
  };

  const focusInput = (): void => {
    const win = host.root();
    (win?.querySelector('#cw-text') as HTMLInputElement | null)?.focus?.();
  };

  const doOpen = (): void => {
    if (host.isMobile()) return;
    open = true;
    min = false;
    const { w: vw, h: vh } = vp();
    if (!placed) {
      geom = initialGeom(vw, vh);
      placed = true;
      save();
    }
    geom = clampGeom(geom, vw, vh);
    render();
    focusInput();
  };

  const doClose = (): void => {
    open = false;
    min = false;
    render();
  };

  const send = (): void => {
    const win = host.root();
    const input = win?.querySelector('#cw-text') as HTMLInputElement | null;
    const text = input?.value.trim();
    if (!text) return;
    host.dispatch(tab, text);
    if (input) {
      input.value = '';
      input.focus?.();
    }
  };

  /** Зеркалить перетаскивание обратно в поля размера, пока открыты настройки. */
  const syncSizeInputs = (): void => {
    const win = host.root();
    const w = win?.querySelector('[data-cset="w"]') as HTMLInputElement | null;
    const h = win?.querySelector('[data-cset="h"]') as HTMLInputElement | null;
    if (w) w.value = String(geom.w);
    if (h) h.value = String(geom.h);
  };

  load(); // восстановить настройки до того, как окно можно будет открыть

  const win = host.root();
  if (win) {
    // Начало жеста: тяга у любого края растягивает, тяга за заголовок двигает.
    // Скрепка (📎) запирает и то, и другое. Интерактивные элементы не участвуют.
    win.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('button, input, .cw-tab, .cw-set')) return;
      if (pinned) return;
      const pe = e as PointerEvent;
      const rect = win.getBoundingClientRect();
      const dir = min ? '' : edgeAt(rect, pe.clientX, pe.clientY); // свёрнутое не тянется, заголовок всё равно двигает
      const onHead = !!target.closest('[data-cwhead]');
      if (!dir && !onHead) return;
      e.preventDefault();
      drag = {
        mode: dir ? 'resize' : 'move',
        dir,
        px: pe.clientX,
        py: pe.clientY,
        gx: geom.x,
        gy: geom.y,
        gw: geom.w,
        gh: geom.h,
      };
    });

    // Курсор при наведении: стрелка растягивания у края (если не заперто и не свёрнуто).
    win.addEventListener('pointermove', (e) => {
      if (drag) return; // активный жест владеет курсором
      const pe = e as PointerEvent;
      const dir = !pinned && !min ? edgeAt(win.getBoundingClientRect(), pe.clientX, pe.clientY) : '';
      win.style.cursor = resizeCursor(dir);
    });

    win.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const nick = (target.closest('[data-nickseat]') as HTMLElement | null)?.dataset.nickseat;
      if (nick) return host.openSeatCard(nick);
      // Порядок — как в панели «Депеши» (ник выигрывает у пинга), чтобы одна и та же
      // строка вела себя одинаково на обеих поверхностях.
      const ping = (target.closest('.dp-line.ping') as HTMLElement | null)?.dataset.ping;
      if (ping) return host.jumpToPing(ping);
      const picked = (target.closest('[data-cwtab]') as HTMLElement | null)?.dataset.cwtab;
      if (picked) {
        tab = picked;
        render();
        focusInput();
        return;
      }
      const act = (target.closest('[data-cwact]') as HTMLElement | null)?.dataset.cwact;
      if (act === 'pin') {
        pinned = !pinned;
        save();
        render();
      } else if (act === 'settings') {
        settingsOpen = !settingsOpen;
        render();
      } else if (act === 'min') {
        min = !min;
        render();
      } else if (act === 'send') {
        send();
      }
    });

    win.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' && (ke.target as HTMLElement).id === 'cw-text') {
        e.preventDefault();
        send();
      }
    });

    // Живые настройки: размер/шрифт/прозрачность правят стиль на месте (без пересборки
    // → без потери фокуса); штампы и цензура перерисовывают только ленту. Всё кэшируется.
    win.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const k = target.dataset.cset;
      if (!k) return;
      const { w: vw, h: vh } = vp();
      if (k === 'w') {
        geom = clampGeom({ ...geom, w: Number(target.value) || geom.w }, vw, vh);
        applyGeom();
      } else if (k === 'h') {
        geom = clampGeom({ ...geom, h: Number(target.value) || geom.h }, vw, vh);
        applyGeom();
      } else if (k === 'font') {
        cfg.fontPx = Math.max(
          CHAT_FONT_MIN,
          Math.min(CHAT_FONT_MAX, Number(target.value) || cfg.fontPx),
        );
        applyGeom();
      } else if (k === 'opacity') {
        cfg.transparency = Math.max(0, Math.min(100, Number(target.value) || 0));
        applyGeom();
        const lbl = win.querySelector('.cw-opval');
        if (lbl) lbl.textContent = cfg.transparency + '%';
      } else if (k === 'censor') {
        cfg.censor = target.checked;
        renderFeed();
      } else if (k === 'showDay') {
        cfg.showDay = target.checked;
        renderFeed();
      } else if (k === 'showTime') {
        cfg.showTime = target.checked;
        renderFeed();
      } else if (k === 'showReal') {
        cfg.showReal = target.checked;
        renderFeed();
      }
      save();
    });
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const pe = e as PointerEvent;
      const dx = pe.clientX - drag.px;
      const dy = pe.clientY - drag.py;
      const { w: vw, h: vh } = vp();
      geom = clampGeom(
        drag.mode === 'move' ? moveGeom(drag, dx, dy) : resizeGeom(drag, dx, dy, vw, vh),
        vw,
        vh,
      );
      applyGeom();
      if (drag.mode === 'resize' && settingsOpen) syncSizeInputs();
    });
    const endDrag = (): void => {
      if (drag) save(); // закэшировать новую геометрию по завершении жеста
      drag = null;
    };
    window.addEventListener('pointerup', endDrag);
    // pointercancel — не роскошь: система забирает указатель на системном жесте, при
    // потере фокуса окна или на прерванном касании, и `pointerup` тогда НЕ приходит.
    // Без этого жест оставался бы активным, и окно ездило бы за курсором навсегда.
    window.addEventListener('pointercancel', endDrag);
  }

  return {
    open: doOpen,
    close: doClose,
    toggle: () => (open ? doClose() : doOpen()),
    isOpen: () => open,
    refreshIfVisible: () => {
      if (open && !min) renderFeed();
    },
    onViewportResize: () => {
      if (!open) return;
      const { w: vw, h: vh } = vp();
      geom = clampGeom(geom, vw, vh);
      applyGeom();
    },
  };
}
