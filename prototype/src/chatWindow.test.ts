import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import {
  CHAT_FONT_MAX,
  CHAT_MIN_H,
  CHAT_MIN_W,
  CHAT_TOP_Y,
  DEFAULT_CHAT_CFG,
  DEFAULT_CHAT_GEOM,
  censorText,
  chatBounds,
  clampGeom,
  discoverTabs,
  edgeAt,
  feedInnerHtml,
  geomStyle,
  initChat,
  initialGeom,
  moveGeom,
  parseChatCache,
  resizeCursor,
  resizeGeom,
  settingsHtml,
  tabLabel,
  windowHtml,
  type ChatCfg,
  type ChatDrag,
  type ChatGeom,
  type ChatMessage,
  type ChatTab,
} from './chatWindow';

// Как и в остальных REFM-тестах: под Node нет языка браузера, рантайм свалился бы
// в EN и подписи разъехались бы с ожиданиями.
beforeAll(() => setLocale('ru'));

const VW = 1600;
const VH = 900;

function cfg(over: Partial<ChatCfg> = {}): ChatCfg {
  return { ...DEFAULT_CHAT_CFG, ...over };
}
function geom(over: Partial<ChatGeom> = {}): ChatGeom {
  return { ...DEFAULT_CHAT_GEOM, y: 400, ...over };
}
function drag(over: Partial<ChatDrag> = {}): ChatDrag {
  return { mode: 'resize', dir: 'se', px: 0, py: 0, gx: 200, gy: 200, gw: 400, gh: 300, ...over };
}
function msg(over: Partial<ChatMessage> = {}): ChatMessage {
  return { at: 0, from: 'p1', to: 'session', text: 'привет', sys: false, ...over };
}

describe('чат — цензура', () => {
  it('заменяет ругательство звёздочками той же длины', () => {
    expect(censorText('ты дурак')).toBe('ты *****');
    expect(censorText('what the hell')).toBe('what the ****');
  });

  it('не трогает безобидное слово, внутри которого лежит запрещённое', () => {
    // Ровно этим болел исходный код: регулярка шла без границ слова, поэтому
    // «hello» превращалось в «****o», а «scrapbook» — в «s****book».
    expect(censorText('hello there')).toBe('hello there');
    expect(censorText('my scrapbook')).toBe('my scrapbook');
    expect(censorText('shell')).toBe('shell');
  });

  it('границы слова работают и для кириллицы (\\b в JS её не видит)', () => {
    expect(censorText('дураками')).toBe('дураками');
    expect(censorText('придурак')).toBe('придурак');
    expect(censorText('дурак!')).toBe('*****!');
    expect(censorText('(тупой)')).toBe('(*****)');
  });

  it('регистр не спасает', () => {
    expect(censorText('ДУРАК')).toBe('*****');
    expect(censorText('Hell')).toBe('****');
  });

  it('чистый текст возвращается как есть', () => {
    expect(censorText('добрый вечер, союзник')).toBe('добрый вечер, союзник');
  });
});

describe('чат — границы и зажим геометрии', () => {
  it('окно не шире и не выше половины экрана', () => {
    const { maxW, maxH } = chatBounds(VW, VH);
    expect(maxW).toBe(800);
    expect(maxH).toBe(450);
    const g = clampGeom(geom({ w: 5000, h: 5000 }), VW, VH);
    expect(g.w).toBe(800);
    expect(g.h).toBe(450);
  });

  it('на крошечном экране побеждает НИЖНЯЯ граница, а не половина', () => {
    // Половина от 300×200 — это 150×100, что уже мельче минимума: окно, ужатое
    // до такого, перестаёт быть окном. Минимум должен пересилить.
    const { maxW, maxH } = chatBounds(300, 200);
    expect(maxW).toBe(CHAT_MIN_W);
    expect(maxH).toBe(CHAT_MIN_H);
    const g = clampGeom(geom({ w: 50, h: 50 }), 300, 200);
    expect(g.w).toBe(CHAT_MIN_W);
    expect(g.h).toBe(CHAT_MIN_H);
  });

  it('окно не уезжает за правый край', () => {
    const g = clampGeom(geom({ x: 99999, w: 400 }), VW, VH);
    expect(g.x).toBe(VW - 400);
  });

  it('заголовок не прячется под топ-баром и не уходит ниже экрана', () => {
    expect(clampGeom(geom({ y: -500 }), VW, VH).y).toBe(CHAT_TOP_Y);
    expect(clampGeom(geom({ y: 99999 }), VW, VH).y).toBe(VH - 40);
  });

  it('зажим ЧИСТЫЙ — исходный объект не мутируется', () => {
    const src = geom({ w: 5000 });
    const out = clampGeom(src, VW, VH);
    expect(src.w).toBe(5000);
    expect(out).not.toBe(src);
  });

  it('первое открытие паркует окно в левом нижнем углу', () => {
    const g = initialGeom(VW, VH);
    expect(g.x).toBe(12);
    expect(g.y).toBe(VH - g.h - 12);
    expect(clampGeom(g, VW, VH)).toEqual(g); // парковка сразу внутри границ
  });
});

describe('чат — арифметика жеста', () => {
  it('перетаскивание сдвигает окно ровно на пройденное указателем', () => {
    expect(moveGeom(drag({ mode: 'move' }), 30, -50)).toEqual({ x: 230, y: 150, w: 400, h: 300 });
  });

  it('юго-восточный угол растит окно, левый верхний остаётся на месте', () => {
    const g = resizeGeom(drag({ dir: 'se' }), 100, 60, VW, VH);
    expect(g).toEqual({ x: 200, y: 200, w: 500, h: 360 });
  });

  it('западный край едет к указателю, а ВОСТОЧНЫЙ стоит', () => {
    // Тянем левый край на 100 влево: ширина +100, а правая кромка (x + w) не двигается.
    const before = drag({ dir: 'w' });
    const g = resizeGeom(before, -100, 0, VW, VH);
    expect(g.w).toBe(500);
    expect(g.x).toBe(100);
    expect(g.x + g.w).toBe(before.gx + before.gw); // дальний край не шелохнулся
  });

  it('северный край едет к указателю, а ЮЖНЫЙ стоит', () => {
    const before = drag({ dir: 'n' });
    const g = resizeGeom(before, 0, -80, VW, VH);
    expect(g.h).toBe(380);
    expect(g.y).toBe(120);
    expect(g.y + g.h).toBe(before.gy + before.gh);
  });

  it('упор в минимум по западному краю НЕ уводит окно вбок', () => {
    // Утянув левый край далеко вправо, окно упирается в минимальную ширину.
    // Дальний край обязан остаться на месте — иначе окно поползёт за указателем.
    const before = drag({ dir: 'w' });
    const g = resizeGeom(before, 10000, 0, VW, VH);
    expect(g.w).toBe(CHAT_MIN_W);
    expect(g.x + g.w).toBe(before.gx + before.gw);
  });

  it('упор в потолок по северному краю тоже держит дальний край', () => {
    const before = drag({ dir: 'n', gy: 500, gh: 300 });
    const g = resizeGeom(before, 0, -10000, VW, VH);
    expect(g.h).toBe(chatBounds(VW, VH).maxH);
    expect(g.y + g.h).toBe(800);
  });

  it('угол тянет обе оси разом', () => {
    const g = resizeGeom(drag({ dir: 'nw' }), -40, -40, VW, VH);
    expect(g.w).toBe(440);
    expect(g.h).toBe(340);
    expect(g.x).toBe(160);
    expect(g.y).toBe(160);
  });

  it('край, за который не тянут, не меняется', () => {
    const g = resizeGeom(drag({ dir: 'e' }), 50, 999, VW, VH);
    expect(g.h).toBe(300); // вертикаль не задействована
    expect(g.y).toBe(200);
  });
});

describe('чат — попадание в край и курсор', () => {
  const rect = { left: 100, top: 100, width: 400, height: 300 };

  it('центр окна — не край', () => {
    expect(edgeAt(rect, 300, 250)).toBe('');
  });

  it('каждая сторона опознаётся', () => {
    expect(edgeAt(rect, 300, 102)).toBe('n');
    expect(edgeAt(rect, 300, 398)).toBe('s');
    expect(edgeAt(rect, 102, 250)).toBe('w');
    expect(edgeAt(rect, 498, 250)).toBe('e');
  });

  it('углы дают обе оси', () => {
    expect(edgeAt(rect, 102, 102)).toBe('nw');
    expect(edgeAt(rect, 498, 398)).toBe('se');
    expect(edgeAt(rect, 498, 102)).toBe('ne');
    expect(edgeAt(rect, 102, 398)).toBe('sw');
  });

  it('курсор соответствует направлению, а неизвестное — пустая строка', () => {
    expect(resizeCursor('n')).toBe('ns-resize');
    expect(resizeCursor('e')).toBe('ew-resize');
    expect(resizeCursor('ne')).toBe('nesw-resize');
    expect(resizeCursor('se')).toBe('nwse-resize');
    expect(resizeCursor('')).toBe('');
  });
});

describe('чат — кэш настроек (внешние данные, A05/A08)', () => {
  it('пустой и не-JSON кэш читаются как «кэша нет»', () => {
    expect(parseChatCache(null)).toBeNull();
    expect(parseChatCache('')).toBeNull();
    expect(parseChatCache('{не json')).toBeNull();
    expect(parseChatCache('"строка"')).toBeNull();
    expect(parseChatCache('null')).toBeNull();
  });

  it('нормальный кэш восстанавливается целиком', () => {
    const raw = JSON.stringify({
      cfg: { fontPx: 20, transparency: 40, censor: true, showReal: true },
      geom: { x: 50, y: 60, w: 500, h: 400 },
      pinned: true,
    });
    const c = parseChatCache(raw)!;
    expect(c.cfg.fontPx).toBe(20);
    expect(c.cfg.censor).toBe(true);
    expect(c.cfg.showReal).toBe(true);
    expect(c.geom).toEqual({ x: 50, y: 60, w: 500, h: 400 });
    expect(c.pinned).toBe(true);
    expect(c.placed).toBe(true);
  });

  it('строка вместо числа НЕ доезжает до геометрии', () => {
    // Именно это ломало окно: Object.assign клал 'abc' в chatGeom.w, дальше
    // Math.min('abc', maxW) давало NaN, и style.width становился 'NaNpx' —
    // окно схлопывалось при открытии.
    const c = parseChatCache(JSON.stringify({ geom: { w: 'abc', h: null, x: [], y: {} } }))!;
    expect(c.geom).toEqual(DEFAULT_CHAT_GEOM);
    for (const v of Object.values(c.geom)) expect(Number.isFinite(v)).toBe(true);
    // и зажим после такого кэша даёт нормальные числа, а не NaN
    const g = clampGeom(c.geom, VW, VH);
    for (const v of Object.values(g)) expect(Number.isFinite(v)).toBe(true);
  });

  it('NaN и Infinity в кэше тоже отбиваются', () => {
    // JSON.stringify превращает их в null — проверяем обе формы записи.
    const c = parseChatCache('{"geom":{"w":null,"h":null},"cfg":{"fontPx":null}}')!;
    expect(c.geom.w).toBe(DEFAULT_CHAT_GEOM.w);
    expect(c.cfg.fontPx).toBe(DEFAULT_CHAT_CFG.fontPx);
  });

  it('запредельный шрифт зажимается, а не растягивает ленту на весь экран', () => {
    expect(parseChatCache('{"cfg":{"fontPx":1e9}}')!.cfg.fontPx).toBe(CHAT_FONT_MAX);
    expect(parseChatCache('{"cfg":{"fontPx":-5}}')!.cfg.fontPx).toBe(8);
  });

  it('прозрачность держится в 0..100', () => {
    expect(parseChatCache('{"cfg":{"transparency":500}}')!.cfg.transparency).toBe(100);
    expect(parseChatCache('{"cfg":{"transparency":-500}}')!.cfg.transparency).toBe(0);
  });

  it('нечисловой pinned и посторонние поля игнорируются', () => {
    const c = parseChatCache('{"pinned":"да","junk":1}')!;
    expect(c.pinned).toBe(false);
    expect(c.placed).toBe(false); // геометрии не было → парковка по умолчанию
  });

  it('кэш без геометрии не помечает окно размещённым', () => {
    expect(parseChatCache('{"cfg":{"censor":true}}')!.placed).toBe(false);
  });
});

describe('чат — вкладки', () => {
  const GROUP: ChatTab[] = [
    { key: 'session', label: 'Сессия', icon: '△' },
    { key: 'global', label: 'Общий', icon: '🌐' },
    { key: 'coalition', label: 'Коалиция', icon: '⬡' },
  ];
  const groups = new Set(['session', 'global', 'coalition']);
  function host(messages: ChatMessage[], seats = ['p1', 'p2', 'p3']) {
    return {
      groupTabs: () => GROUP,
      isGroup: (k: string) => groups.has(k),
      messages: () => messages,
      me: () => 'p1',
      seatExists: (id: string) => seats.includes(id),
      seatLabel: (id: string) => `имя-${id}`,
      seatIcon: () => '◆',
    };
  }

  it('без личек остаются только три групповые комнаты', () => {
    expect(discoverTabs(host([msg()]), 'session').map((c) => c.key)).toEqual([
      'session',
      'global',
      'coalition',
    ]);
  });

  it('личка появляется вкладкой — и когда пишешь ты, и когда пишут тебе', () => {
    const tabs = discoverTabs(
      host([msg({ from: 'p1', to: 'p2' }), msg({ from: 'p3', to: 'p1' })]),
      'session',
    );
    expect(tabs.map((c) => c.key)).toEqual(['session', 'global', 'coalition', 'p2', 'p3']);
  });

  it('чужая переписка мимо тебя вкладки не создаёт', () => {
    const tabs = discoverTabs(host([msg({ from: 'p2', to: 'p3' })]), 'session');
    expect(tabs.map((c) => c.key)).toEqual(['session', 'global', 'coalition']);
  });

  it('только что открытая личка держится в ряду, даже пока в ней пусто', () => {
    const tabs = discoverTabs(host([]), 'p2');
    expect(tabs.map((c) => c.key)).toContain('p2');
  });

  it('выбывшее из матча место вкладку не получает', () => {
    const tabs = discoverTabs(host([msg({ from: 'p1', to: 'p9' })], ['p1', 'p2']), 'session');
    expect(tabs.map((c) => c.key)).not.toContain('p9');
  });

  it('подпись вкладки берётся из ряда, а неизвестный ключ отдаёт запасную', () => {
    const tabs = discoverTabs(host([msg({ from: 'p1', to: 'p2' })]), 'session');
    expect(tabLabel(tabs, 'p2', 'нет')).toBe('имя-p2');
    expect(tabLabel(tabs, 'кого-нет', 'запасная')).toBe('запасная');
  });
});

describe('чат — разметка', () => {
  const line = (m: ChatMessage): string => `<i>${m.text}</i>`;

  it('пустой канал читается как приглашение, а не как дыра', () => {
    const html = feedInnerHtml([], 'Сессия', cfg(), line);
    expect(html).toContain('cw-empty');
    expect(html).toContain('Сессия');
  });

  it('цензура применяется к ленте только при включённом тумблере', () => {
    const msgs = [msg({ text: 'ты дурак' })];
    expect(feedInnerHtml(msgs, 'Сессия', cfg({ censor: false }), line)).toContain('ты дурак');
    expect(feedInnerHtml(msgs, 'Сессия', cfg({ censor: true }), line)).toContain('ты *****');
  });

  it('цензура НЕ портит исходное сообщение — правится копия', () => {
    const original = msg({ text: 'ты дурак' });
    feedInnerHtml([original], 'Сессия', cfg({ censor: true }), line);
    expect(original.text).toBe('ты дурак'); // журнал сессии остался нетронут
  });

  it('тумблеры штампов доезжают до отрисовки строки', () => {
    let seen: unknown = null;
    feedInnerHtml([msg()], 'Сессия', cfg({ showDay: false, showReal: true }), (_m, stamp) => {
      seen = stamp;
      return '';
    });
    expect(seen).toEqual({ day: false, time: true, real: true });
  });

  it('имя канала в пустой ленте экранируется (ник живого игрока, CWE-79)', () => {
    const html = feedInnerHtml([], '<img src=x onerror=alert(1)>', cfg(), line);
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src=x');
  });

  it('ключ и подпись вкладки экранируются тоже', () => {
    const html = windowHtml({
      tabs: [{ key: '"><script>', label: '<b>злой</b>', icon: '◆' }],
      openTab: 'session',
      channelLabel: 'Сессия',
      pinned: false,
      min: false,
      settingsOpen: false,
      geom: geom(),
      cfg: cfg(),
      vw: VW,
      vh: VH,
      feedHtml: '',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('открытая вкладка подсвечена, закрытая — нет', () => {
    const tabs: ChatTab[] = [
      { key: 'session', label: 'Сессия', icon: '△' },
      { key: 'global', label: 'Общий', icon: '🌐' },
    ];
    const html = windowHtml({
      tabs,
      openTab: 'global',
      channelLabel: 'Общий',
      pinned: false,
      min: false,
      settingsOpen: false,
      geom: geom(),
      cfg: cfg(),
      vw: VW,
      vh: VH,
      feedHtml: '',
    });
    expect(html).toContain('data-cwtab="global"');
    expect(html).toMatch(/class="cw-tab on" data-cwtab="global"/);
    expect(html).toMatch(/class="cw-tab" data-cwtab="session"/);
  });

  it('панель настроек появляется только когда она открыта', () => {
    const base = {
      tabs: [] as ChatTab[],
      openTab: 'session',
      channelLabel: 'Сессия',
      pinned: false,
      min: false,
      geom: geom(),
      cfg: cfg(),
      vw: VW,
      vh: VH,
      feedHtml: '',
    };
    expect(windowHtml({ ...base, settingsOpen: false })).not.toContain('cw-set');
    expect(windowHtml({ ...base, settingsOpen: true })).toContain('cw-set');
  });

  it('свёрнутое окно предлагает развернуть, развёрнутое — свернуть', () => {
    const base = {
      tabs: [] as ChatTab[],
      openTab: 'session',
      channelLabel: 'Сессия',
      pinned: false,
      settingsOpen: false,
      geom: geom(),
      cfg: cfg(),
      vw: VW,
      vh: VH,
      feedHtml: '',
    };
    expect(windowHtml({ ...base, min: true })).toContain('▢');
    expect(windowHtml({ ...base, min: false })).toContain('—');
  });

  it('поля размера в настройках несут те же пределы, что и зажим', () => {
    const html = settingsHtml(geom(), cfg(), VW, VH);
    expect(html).toContain(`min="${CHAT_MIN_H}" max="450"`);
    expect(html).toContain(`min="${CHAT_MIN_W}" max="800"`);
  });
});

describe('чат — делегированные клики', () => {
  /** Node без DOM: окно только вешает слушатели, красит innerHTML и щупает classList —
   *  заглушки с этими тремя и хватает. `window`/`localStorage` под Node отсутствуют,
   *  поэтому глобальные слушатели жеста и кэш в `initChat` просто не заводятся. */
  function fakeRoot(): HTMLElement & { fire: (type: string, ev: unknown) => void } {
    const handlers: Record<string, (ev: unknown) => void> = {};
    const classes = new Set<string>();
    const el = {
      innerHTML: '',
      style: {} as Record<string, string>,
      classList: {
        toggle: (c: string, on?: boolean) => (on ? classes.add(c) : classes.delete(c)),
        contains: (c: string) => classes.has(c),
      },
      addEventListener: (type: string, h: (ev: unknown) => void) => {
        handlers[type] = h;
      },
      querySelector: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
      fire: (type: string, ev: unknown) => handlers[type]?.(ev),
    };
    return el as unknown as HTMLElement & { fire: (type: string, ev: unknown) => void };
  }

  /** Клик, чей `closest(sel)` отвечает только на тот селектор, по которому целимся. */
  function click(sel: string, dataset: Record<string, string>): unknown {
    return { target: { closest: (q: string) => (q === sel ? { dataset } : null) } };
  }

  function build(over: Record<string, unknown> = {}) {
    const root = fakeRoot();
    const calls: Array<[string, string]> = [];
    initChat(
      {
        root: () => root,
        viewport: () => ({ w: VW, h: VH }),
        isMobile: () => false,
        groupTabs: () => [{ key: 'session', label: 'Сессия', icon: '△' }],
        isGroup: (k: string) => k === 'session',
        messages: () => [],
        me: () => 'p1',
        seatExists: () => true,
        seatLabel: (id: string) => id,
        seatIcon: () => '◆',
        convoMessages: () => [],
        lineHtml: () => '',
        dispatch: (k: string, text: string) => calls.push(['dispatch', `${k}:${text}`]),
        openSeatCard: (id: string) => calls.push(['seatCard', id]),
        jumpToPing: (id: string) => calls.push(['jump', id]),
        ...over,
      } as never,
      'session',
    );
    return { root, calls };
  }

  it('клик по строке-пингу уводит камеру — та же реакция, что в «Депешах»', () => {
    // До выноса обработчик прыжка висел ТОЛЬКО на #diplo, а #chatwin — независимый
    // узел: события до него не всплывают, и пинг в плавающем чате был мёртв,
    // хотя выглядел кликабельным (общий CSS `.dp-line.ping{cursor:pointer}`).
    const { root, calls } = build();
    root.fire('click', click('.dp-line.ping', { ping: 'nexus' }));
    expect(calls).toEqual([['jump', 'nexus']]);
  });

  it('ник внутри строки выигрывает у пинга — порядок как в «Депешах»', () => {
    const { root, calls } = build();
    root.fire('click', {
      target: {
        closest: (q: string) =>
          q === '[data-nickseat]'
            ? { dataset: { nickseat: 'p2' } }
            : q === '.dp-line.ping'
              ? { dataset: { ping: 'nexus' } }
              : null,
      },
    });
    expect(calls).toEqual([['seatCard', 'p2']]);
  });

  it('клик мимо всего ничего не зовёт', () => {
    const { root, calls } = build();
    root.fire('click', { target: { closest: () => null } });
    expect(calls).toEqual([]);
  });
});

describe('чат — инлайновые стили', () => {
  it('свёрнутое окно отдаёт высоту содержимому', () => {
    expect(geomStyle(geom({ h: 300 }), cfg(), true).height).toBe('auto');
    expect(geomStyle(geom({ h: 300 }), cfg(), false).height).toBe('300px');
  });

  it('прозрачность гасит И заливку, И рамку', () => {
    const opaque = geomStyle(geom(), cfg({ transparency: 0 }), false);
    const clear = geomStyle(geom(), cfg({ transparency: 100 }), false);
    expect(opaque.background).toBe('rgba(3,14,18,0.820)');
    expect(opaque.borderColor).toBe('rgba(53,214,230,1.000)');
    expect(clear.background).toBe('rgba(3,14,18,0.000)');
    expect(clear.borderColor).toBe('rgba(53,214,230,0.000)');
  });

  it('положение и размер уходят в CSS-пиксели', () => {
    const st = geomStyle({ x: 10, y: 20, w: 300, h: 400 }, cfg(), false);
    expect([st.left, st.top, st.width]).toEqual(['10px', '20px', '300px']);
  });
});
