/**
 * Конверсации — вкладка сообщений: список чатов слева, открытая переписка справа
 * (REFM-15).
 *
 * Каналы двух родов. Групповые (`coalition` / `session` / `global`) собирают всё,
 * адресованное каналу; ключ-место (seat id) — это личка между вами и им, в обе
 * стороны. `GROUP_CHANNELS` — то единственное место, где это различие живёт.
 *
 * Сам журнал сообщений (`sessionMessages`) модулю НЕ принадлежит: его пишет сеть и
 * читает ещё плавающее окно чата, поэтому он остаётся у хоста и приходит хуком
 * `messages()`. Модуль владеет только тем, что относится к вкладке: какая переписка
 * открыта (`open`/`current`) и как всё это выглядит.
 *
 * Форма REFM: разметка чистая и тестируемая, состояние — значение, DOM не трогается
 * вовсе (вкладку рисует хозяин, вставляя возвращённые строки).
 */
import { getStance, type GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { esc } from './format';

/** Сообщение сессии. `ping` (только коалиция) несёт id провинции → кликабельный
 *  маркер карты; `pingId` (только сеть) — серверный id, чтобы `ping.removed` нашёл
 *  свою строку; `chatId` дедупит живое эхо против реплея при входе. */
export type SessionMsg = {
  at: number;
  from: string;
  to: string;
  text: string;
  sys: boolean;
  ping?: string;
  pingId?: string;
  chatId?: string;
  realAt?: number;
};

/** Какие поля отметки времени показывать (чат передаёт свои переключатели). */
export type StampOpts = { day?: boolean; time?: boolean; real?: boolean; realAt?: number };

export const COALITION = 'coalition';
export const CH_SESSION = 'session'; // все в этом матче
export const CH_GLOBAL = 'global'; // кросс-сессионное лобби (заглушка до общего сервера)
/** Групповые комнаты против личек — различие, на котором держится маршрутизация. */
export const GROUP_CHANNELS = new Set([COALITION, CH_SESSION, CH_GLOBAL]);

/** Что вкладке нужно от экрана матча. */
export interface ConversationsHost {
  /** Состояние матча (читается заново на каждую отрисовку — оно заменяется, не мутируется). */
  state(): GameState;
  /** Чьё это место: место, за которое вы играете. */
  me(): string;
  /** Журнал сообщений сессии — им владеет хост (пишет сеть, читает ещё окно чата). */
  messages(): SessionMsg[];
  /** Имя места для показа (уже с фолбэком на id). */
  nameOf(id: string): string;
  /** Места, с которыми вообще возможна дипломатия/переписка. */
  seats(): string[];
  /** Значок и тег места — словарь хоста, общий с ростером дипломатии. */
  seatBadge(id: string): { icon: string; tag: string };
  /** Отметка времени сообщения — форматтер хоста, общий с лентой дипломатии. */
  fmtStamp(at: number, opts?: StampOpts): string;
  /** Политический цвет стороны — тот же, которым покрашена карта. */
  ownerColor(id: string): string;
}

/** Собрать вкладку. Возвращает разметку её частей и управление тем, что открыто. */
export function initConversations(host: ConversationsHost): {
  listHtml: () => string;
  threadHtml: () => string;
  feedInnerHtml: (key?: string) => string;
  messagesOf: (key: string) => SessionMsg[];
  lineHtml: (m: SessionMsg, stamp?: StampOpts) => string;
  coalition: () => string[];
  open: (key: string) => void;
  current: () => string;
} {
  let convoOpen = COALITION; // открытая переписка (seat id или групповой канал)

  /** Your coalition: you + everyone you're at `alliance` with. */
  function coalitionMembers(): string[] {
    const me = host.me();
    return [
      me,
      ...host.seats().filter((id) => id !== me && getStance(host.state(), me, id) === 'alliance'),
    ];
  }
  /** Messages in a conversation: a group channel (coalition / session / global) collects
   *  everything addressed to it; a seat id = the 1:1 DM between you and them (either dir). */
  function convoMessages(key: string): SessionMsg[] {
    const me = host.me();
    const sessionMessages = host.messages();
    if (GROUP_CHANNELS.has(key)) return sessionMessages.filter((m) => m.to === key);
    return sessionMessages.filter(
      (m) =>
        !GROUP_CHANNELS.has(m.to) &&
        ((m.from === me && m.to === key) || (m.from === key && m.to === me)),
    );
  }
  function convoLast(key: string): SessionMsg | undefined {
    const ms = convoMessages(key);
    return ms[ms.length - 1];
  }
  function fromName(id: string): string {
    return id === host.me() ? t('chat.you') : host.nameOf(id);
  }
  /** A chat sender's name. Another live seat's name is clickable — it opens that
   *  player's card (with the diplomacy actions); your own name and system senders
   *  stay plain. */
  function nickHtml(id: string): string {
    const name = esc(fromName(id));
    if (id === host.me() || !host.state().players[id]) return `<b>${name}</b>`;
    return `<b class="dp-nick" data-nickseat="${esc(id)}" title="${t('chat.open-card')}">${name}</b>`;
  }
  /** One message line. A ping renders as a clickable marker that flies the camera.
   *  `stamp` overrides which time fields show (the chat passes its cached toggles);
   *  omitted → the default `Day N · HH:MM` used by the diplomacy feed. */
  function convoLineHtml(m: SessionMsg, stamp?: StampOpts): string {
    const stampTxt = host.fmtStamp(m.at, stamp && { ...stamp, realAt: m.realAt });
    if (m.ping) {
      return (
        `<div class="dp-line ping" data-ping="${esc(m.ping)}"><span class="dp-when">${stampTxt}</span>` +
        `📍 ${nickHtml(m.from)} ${esc(m.ping)}: ${esc(m.text)}<span class="dp-jump">${t('chat.jump')}</span></div>`
      );
    }
    if (m.sys)
      return `<div class="dp-line sys"><span class="dp-when">${stampTxt}</span>${esc(m.text)}</div>`;
    return `<div class="dp-line${m.from === host.me() ? ' me' : ''}"><span class="dp-when">${stampTxt}</span>${nickHtml(m.from)}<b>:</b> ${esc(m.text)}</div>`;
  }
  function convoFeedInnerHtml(key: string): string {
    const msgs = convoMessages(key);
    if (msgs.length) return msgs.map((m) => convoLineHtml(m)).join('');
    const hint =
      key === COALITION
        ? t('chat.coalition.empty')
        : key === CH_SESSION
          ? t('chat.session.note')
          : t('chat.empty');
    return `<div class="dp-empty">${hint}</div>`;
  }
  /** Left column: the match-wide session channel + the coalition channel pinned on
   *  top, then a DM per participant (most-recently-active first). Selecting one
   *  opens its thread on the right. Session here is what makes the NET chat fully
   *  reachable from a PHONE — the floating chat window is desktop-only. */
  function convoListHtml(): string {
    const dms = host
      .seats()
      .filter((id) => id !== host.me())
      .sort(
        (a, b) =>
          (convoLast(b)?.at ?? -1) - (convoLast(a)?.at ?? -1) ||
          host.nameOf(a).localeCompare(host.nameOf(b)),
      );
    const sessLast = convoLast(CH_SESSION);
    const sessPrev = sessLast
      ? esc((sessLast.from === host.me() ? t('chat.you') + ': ' : '') + sessLast.text)
      : t('chat.members', { n: Object.keys(host.state().players).length });
    const sess =
      `<button class="dp-cv coal${convoOpen === CH_SESSION ? ' on' : ''}" data-convo="${CH_SESSION}">` +
      `<span class="dp-cv-ic" style="color:var(--cyan)">△</span>` +
      `<span class="dp-cv-nm">${t('chat.tab.session')}<em>${sessPrev}</em></span></button>`;
    const coal =
      `<button class="dp-cv coal${convoOpen === COALITION ? ' on' : ''}" data-convo="${COALITION}">` +
      `<span class="dp-cv-ic" style="color:var(--amber)">⚡</span>` +
      `<span class="dp-cv-nm">${t('chat.tab.coalition')}<em>${t('chat.members', { n: coalitionMembers().length })}</em></span></button>`;
    const items = dms
      .map((id) => {
        const last = convoLast(id);
        const prev = last
          ? esc(
              (last.from === host.me() ? t('chat.you') + ': ' : '') +
                (last.ping ? '📍 ' + last.ping : last.text),
            )
          : '—';
        return (
          `<button class="dp-cv${convoOpen === id ? ' on' : ''}" data-convo="${id}">` +
          `<span class="dp-cv-ic" style="color:${host.ownerColor(id)}">${host.seatBadge(id).icon}</span>` +
          `<span class="dp-cv-nm">${esc(host.nameOf(id))}<em>${prev}</em></span></button>`
        );
      })
      .join('');
    return `<div class="dp-cvlist">${sess}${coal}${items}</div>`;
  }
  /** Right column: header, the open conversation's messages, and the composer (with a
   *  ping button in the coalition channel). */
  function convoThreadHtml(): string {
    const isCoal = convoOpen === COALITION;
    const title =
      convoOpen === CH_SESSION
        ? t('chat.head.session', { n: Object.keys(host.state().players).length })
        : isCoal
          ? t('chat.head.coalition', { n: coalitionMembers().length })
          : `${host.seatBadge(convoOpen).icon} ${esc(host.nameOf(convoOpen))}`;
    const pingBtn = isCoal ? `<button class="dp-ping" title="${t('chat.ping')}">📍</button>` : '';
    // The composer is networked (chat.send relay): dispatchChat routes it — NET sends
    // to the server (rendered from the echo), solo appends locally.
    const compose = `<div class="dp-compose">${pingBtn}<input id="dp-text" maxlength="160" placeholder="${t('chat.input.ph')}" autocomplete="off"><button class="dp-send">▶</button></div>`;
    return (
      `<div class="dp-thread">` +
      `<div class="dp-thhead">${title}</div>` +
      `<div class="dp-feed" id="dp-feed">${convoFeedInnerHtml(convoOpen)}</div>` +
      compose +
      `</div>`
    );
  }
  return {
    listHtml: convoListHtml,
    threadHtml: convoThreadHtml,
    feedInnerHtml: (key?: string) => convoFeedInnerHtml(key ?? convoOpen),
    messagesOf: convoMessages,
    lineHtml: convoLineHtml,
    coalition: coalitionMembers,
    open: (key: string) => {
      convoOpen = key;
    },
    current: () => convoOpen,
  };
}
