/**
 * Лента сообщений сессии — у одного владельца (REFM-214, первый PR): реплики чата, служебные
 * строки дипломатии, метки коалиции, счётчик непрочитанного и отправка своей реплики.
 *
 * Лента {@link sessionMessages} и счётчик {@link unreadMsgs} жили `let`'ами в `main.ts`, и
 * писали их окно сообщений, сеть (метки и реплики от сервера), реакция на события мира и
 * разница дипломатии между снимками. Теперь `main.ts` читает их живыми привязками
 * (`export let`), а пишут только двери модуля: присвоить мимо владельца не даст компилятор,
 * а дописать в ленту в обход — сторож в `messageLog.test.ts`.
 *
 * Лента — сессионный журнал прототипа, а не часть мира: на симуляцию она не влияет, поэтому
 * в `GameState` её нет. Стойки живут в ядре (`state.diplomacy`), окно ведёт их через
 * `diplomacy.declare`. `to` — ключ разговора: id места (личка) или групповой канал
 * (`COALITION`, `CH_SESSION`). `ping` (только коалиция) несёт провинцию — метку на карте;
 * `pingId` (только сеть) — серверный id, по которому `ping.removed` найдёт свою строку.
 *
 * Окно дипломатии, плавающий чат, часы мира и сетевой клиент живут в `main.ts`; модуль
 * получает их хуками {@link initMessageLog} — импорт оттуда был бы циклом.
 */
import { t } from '../../localization/runtime';
import type {
  MultiplayerChatMessage,
  MultiplayerClient,
  MultiplayerPing,
} from '../../packages/client/src/index';
import { CH_GLOBAL, CH_SESSION, COALITION, type SessionMsg } from './conversations';
import { relayIntake } from './relayIntake';

/** Сколько последних строк держит лента. */
const LOG_CAP = 300;

/** Что ленте нужно от игры. Окна, часы мира и сеть живут в `main.ts`. */
export interface MessageLogHost {
  /** Время мира — штамп своей строки. */
  now(): number;
  /** Место игрока: автор своей строки и чья реплика не зажигает значок. */
  me(): string;
  /** Лента изменилась: перерисовать открытый тред окна дипломатии и плавающий чат. */
  changed(): void;
  /** Сетевой клиент, если матч сетевой: свою реплику тогда несёт сервер. */
  chat(): Pick<MultiplayerClient, 'sendChat'> | null;
  note(text: string): void;
  /** Имя провинции — подпись метки, у которой своей нет. */
  provinceName(loc: string): string;
}

let game: MessageLogHost;

/** Лента сессии: последние {@link LOG_CAP} строк, старые уходят первыми. */
export let sessionMessages: SessionMsg[] = [];
/** Непрочитанное: значок ✉ на рейле, «Ещё» телефона и гамбургере. */
export let unreadMsgs = 0;

export function initMessageLog(host: MessageLogHost): void {
  game = host;
}

function add(m: SessionMsg): void {
  sessionMessages.push(m);
  if (sessionMessages.length > LOG_CAP) sessionMessages.shift();
  game.changed();
}

/** Своя строка ленты: реплика в соло, служебная строка дипломатии (`sys`, от собеседника),
 *  метка в соло (`ping`). Штамп — время мира. */
export function pushMsg(
  to: string,
  text: string,
  sys: boolean,
  from = game.me(),
  ping?: string,
): void {
  add({ at: game.now(), from, to, text, sys, ping, realAt: Date.now() });
}

/** Метка от сервера — союзника или эхо своей (её прячут от врагов, решает сервер).
 *  `node` — провинция метки: маркеры прототипа привязаны к провинции, и метку без неё
 *  показать нечем. Что брать, решает `relayIntake.ts` (REFM-148): личность строки
 *  назначает сервер, эхо и повтор при входе её не удваивают. */
export function takePing(ping: MultiplayerPing, node: string | null): void {
  const intake = relayIntake({
    known: sessionMessages.some((m) => m.pingId === ping.id),
    showable: !!node,
  });
  if (intake !== 'add' || !node) return; // `!node` — сужение типа, решает intake
  add({
    at: ping.createdAt,
    from: ping.owner,
    to: COALITION,
    text: ping.label ?? t('chat.ping.mark', { node: game.provinceName(node) }),
    sys: false,
    ping: node,
    pingId: ping.id,
    realAt: Date.now(),
  });
}

/** Сервер снял метку: строка уходит по серверному id, а не по тексту или автору. */
export function dropPing(pingId: string): void {
  sessionMessages = sessionMessages.filter((m) => m.pingId !== pingId);
  game.changed();
}

/** Реплика от сервера (получателей решает сервер, как туман). Своя ложится отсюда же — из
 *  эха; серверный id отличает живую реплику от повтора при входе. Групповая строка несёт
 *  ключ канала в `to`, личка — настоящего адресата: тред из (from, to) выводит
 *  `conversations.ts`, как и в соло. */
export function takeChat(m: MultiplayerChatMessage): void {
  const known = sessionMessages.some((x) => x.chatId === m.id);
  if (relayIntake({ known, showable: true }) !== 'add') return;
  const to =
    m.channel === 'session' ? CH_SESSION : m.channel === 'coalition' ? COALITION : (m.to ?? m.from);
  add({ at: m.at, from: m.from, to, text: m.text, sys: false, chatId: m.id, realAt: Date.now() });
  if (m.from !== game.me()) unreadMsgs++;
}

/** Заменить ленту целиком — снятие своей метки в соло (`pingUi.ts`). Перерисовку зовёт
 *  сам `pingUi` (`onFeedChanged`), когда закроет попап метки. */
export function replaceMessages(next: SessionMsg[]): void {
  sessionMessages = next;
}

/** Событие дипломатии, которое игрок должен прочитать: значок +1. */
export function markUnread(): void {
  unreadMsgs++;
}

/** Игрок открыл вкладку сообщений: значок гаснет. */
export function readMessages(): void {
  unreadMsgs = 0;
}

/** Своя реплика в разговор `key` (групповой канал или id места = личка). В сети её
 *  ретранслирует сервер, и в ленту она ляжет эхом ({@link takeChat}) — у всех одна и та же
 *  строка со штампом сервера. В соло — сразу в ленту. */
export function dispatchChat(key: string, text: string): void {
  const net = game.chat();
  if (net) {
    if (key === CH_GLOBAL) {
      game.note(t('comms.global.soon'));
      return;
    }
    if (key === CH_SESSION) net.sendChat('session', text);
    else if (key === COALITION) net.sendChat('coalition', text);
    else net.sendChat('dm', text, key);
    return;
  }
  pushMsg(key, text, false);
}
