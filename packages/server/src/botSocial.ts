import { getStance, type Action, type GameState } from '@void/shared-core';
import type { ChatMessage } from '@void/protocol';

export const BOT_REPLY_KEYS = [
  'bot-chat.greeting',
  'bot-chat.help',
  'bot-chat.trade',
  'bot-chat.alliance-refused',
  'bot-chat.peace-current',
  'bot-chat.peace-accepted',
  'bot-chat.pact-current',
  'bot-chat.pact-accepted',
  'bot-chat.war-current',
  'bot-chat.war-confirmed',
  'bot-chat.negotiation-refused',
  'bot-chat.negotiation-failed',
] as const;
export type BotReplyKey = (typeof BOT_REPLY_KEYS)[number];

type Intent = 'greeting' | 'peace' | 'pact' | 'war' | 'trade' | 'alliance' | 'help';
export type BotReplyLocale = 'ru' | 'en';

/** Deliberately small command grammar. Merely mentioning a war (or negating it)
 * never declares one; unrecognised prose receives help and changes no game state. */
export function botChatIntent(text: string): { intent: Intent; locale: BotReplyLocale } {
  const normalized = text.normalize('NFKC');
  const locale = /[а-яё]/i.test(normalized) ? 'ru' : 'en';
  // Quoted commands and questions are conversation, never consent to an order.
  if (/["'«»“”‘’‹›„‟‚‛`?؟()[\]{}<>]/.test(normalized)) return { intent: 'help', locale };
  const command = /^\/(peace|pact|war|мир|пакт|война)$/i.exec(normalized.trim());
  if (command) {
    const word = command[1]!.toLowerCase();
    return {
      intent:
        word === 'peace' || word === 'мир'
          ? 'peace'
          : word === 'pact' || word === 'пакт'
            ? 'pact'
            : 'war',
      locale,
    };
  }
  const words = normalized
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let intent: Intent = 'help';
  if (/^(?:я )?объявляю (?:тебе )?войну$|^(?:i )?declare war(?: on you)?$/.test(words))
    intent = 'war';
  else if (
    /^(?:давай|предлагаю|заключим) мир$|^давай помиримся$|^давай без войны$|^(?:make peace|let us make peace|i offer peace|stop the war)$/.test(
      words,
    )
  )
    intent = 'peace';
  else if (
    /^(?:давай|предлагаю|заключим) пакт(?: о ненападении)?$|^(?:offer pact|let us make a pact)$/.test(
      words,
    )
  )
    intent = 'pact';
  else if (/\b(?:alliance|coalition)\b|(?:союз|коалици)/.test(words)) intent = 'alliance';
  else if (/\b(?:trade|buy|sell|market)\b|(?:торгов|купить|продать|рынок)/.test(words))
    intent = 'trade';
  else if (/^(?:привет|здравствуй|здравствуйте|салют|hello|hi|hey)(?: |$)/.test(words))
    intent = 'greeting';
  return { intent, locale };
}

interface BotSocialRoom {
  readonly state: GameState;
  /** MatchRoom increments this on kicks and account/session revocations. */
  readonly admissionRevision?: number;
  submitServerAction(
    playerId: string,
    action: Action,
    isCurrent?: () => boolean,
  ): Promise<{ ok: boolean; code?: string }>;
  sendServerChat(from: string, to: string, text: string): boolean;
}

export interface BotSocialOptions {
  room: BotSocialRoom;
  isBot(playerId: string): boolean;
  /** The host supplies presentation; server logic never imports locale catalogs. */
  render(key: BotReplyKey, locale: BotReplyLocale): string;
  /** Optional personality policy. Applied only to an outstanding friendly offer;
   * unilateral declarations still follow the core's ordinary rules. */
  behavior?: (
    botId: string,
    humanId: string,
    stance: 'peace' | 'pact',
    state: GameState,
  ) => boolean;
  now?: () => number;
  /** Stable diagnostic only; chat text, names and credentials stay out of logs. */
  onError?: (code: 'E_BOT_REPLY') => void;
}

const PAIR_COOLDOWN_MS = 15_000;
const BOT_COOLDOWN_MS = 5_000;
const ROOM_WINDOW_MS = 60_000;
const ROOM_REPLIES_MAX = 12;
const COOLDOWN_KEYS_MAX = 256;
const REPLY_DELAY_MS = 1_500;
interface PendingReply {
  timer: ReturnType<typeof setTimeout> | null;
}

/** Bounded local responder for accepted HUMAN DMs to dedicated persistent bots.
 * Exactly one pending timer/work item per room; no polling, external requests,
 * generated peers or recursive replies. Chat remains the ordinary ephemeral relay. */
export function createBotSocial(options: BotSocialOptions): {
  onMessage(message: Readonly<ChatMessage>): void;
  stop(): void;
} {
  const now = options.now ?? Date.now;
  const pairAt = new Map<string, number>();
  const botAt = new Map<string, number>();
  let roomAt: number[] = [];
  let pending: PendingReply | null = null;
  let stopped = false;
  const remember = (map: Map<string, number>, key: string, at: number): void => {
    map.delete(key);
    map.set(key, at);
    if (map.size > COOLDOWN_KEYS_MAX) map.delete(map.keys().next().value!);
  };
  const live = (human: string, bot: string): boolean =>
    !stopped &&
    options.isBot(bot) &&
    !options.isBot(human) &&
    options.room.state.match.status !== 'ended' &&
    options.room.state.players[human]?.status === 'active' &&
    options.room.state.players[bot]?.status === 'active';

  const answer = async (
    message: Readonly<ChatMessage>,
    admissionRevision: number | undefined,
  ): Promise<void> => {
    const human = message.from;
    const bot = message.to!;
    const current = (): boolean =>
      live(human, bot) && options.room.admissionRevision === admissionRevision;
    if (!current()) return;
    const { intent, locale } = botChatIntent(message.text);
    let key: BotReplyKey =
      intent === 'greeting'
        ? 'bot-chat.greeting'
        : intent === 'trade'
          ? 'bot-chat.trade'
          : intent === 'alliance'
            ? 'bot-chat.alliance-refused'
            : 'bot-chat.help';
    const submit = (actor: string, step: string, type: string, payload: Action['payload']) =>
      options.room.submitServerAction(
        actor,
        {
          id: `bot-social:${message.id}:${step}`,
          playerId: actor,
          type,
          payload,
          issuedAt: options.room.state.time,
        },
        current,
      );
    if (intent === 'peace' || intent === 'pact' || intent === 'war') {
      if (getStance(options.room.state, human, bot) === intent) {
        key =
          intent === 'peace'
            ? 'bot-chat.peace-current'
            : intent === 'pact'
              ? 'bot-chat.pact-current'
              : 'bot-chat.war-current';
      } else {
        // The authenticated sender explicitly asked for this declaration. Offer
        // and counter-offer go through the reducer and strict durable mailbox.
        const offered = await submit(human, 'offer', 'diplomacy.declare', {
          target: bot,
          stance: intent,
        });
        if (!current()) return;
        let changed = offered.ok && getStance(options.room.state, human, bot) === intent;
        if (offered.ok && !changed && intent !== 'war') {
          const accept = options.behavior?.(bot, human, intent, options.room.state) ?? true;
          const verdict = await submit(
            bot,
            'answer',
            accept ? 'diplomacy.declare' : 'diplomacy.decline',
            accept ? { target: human, stance: intent } : { target: human },
          );
          if (!current()) return;
          changed = verdict.ok && getStance(options.room.state, human, bot) === intent;
          key = changed
            ? intent === 'peace'
              ? 'bot-chat.peace-accepted'
              : 'bot-chat.pact-accepted'
            : verdict.ok && !accept
              ? 'bot-chat.negotiation-refused'
              : 'bot-chat.negotiation-failed';
        } else {
          key = changed
            ? intent === 'war'
              ? 'bot-chat.war-confirmed'
              : intent === 'peace'
                ? 'bot-chat.peace-accepted'
                : 'bot-chat.pact-accepted'
            : 'bot-chat.negotiation-failed';
        }
      }
    }
    // A shutdown/elimination while awaiting persistence must not speak for a dead bot.
    if (current()) options.room.sendServerChat(bot, human, options.render(key, locale));
  };

  return {
    onMessage(message) {
      if (
        stopped ||
        pending ||
        message.channel !== 'dm' ||
        !message.to ||
        !live(message.from, message.to)
      )
        return;
      const wall = now();
      const pair = JSON.stringify([message.from, message.to]);
      if (
        wall - (pairAt.get(pair) ?? -Infinity) < PAIR_COOLDOWN_MS ||
        wall - (botAt.get(message.to) ?? -Infinity) < BOT_COOLDOWN_MS
      )
        return;
      roomAt = roomAt.filter((at) => wall - at < ROOM_WINDOW_MS);
      if (roomAt.length >= ROOM_REPLIES_MAX) return;
      remember(pairAt, pair, wall);
      remember(botAt, message.to, wall);
      roomAt.push(wall);
      const work: PendingReply = { timer: null };
      pending = work;
      const accepted = Object.freeze({ ...message });
      const admissionRevision = options.room.admissionRevision;
      work.timer = setTimeout(() => {
        work.timer = null;
        void answer(accepted, admissionRevision)
          .catch(() => {
            try {
              options.onError?.('E_BOT_REPLY');
            } catch {
              /* diagnostics are best effort */
            }
          })
          .finally(() => {
            if (pending === work) pending = null;
          });
      }, REPLY_DELAY_MS);
    },
    stop() {
      stopped = true;
      if (pending?.timer) clearTimeout(pending.timer);
      pending = null;
      pairAt.clear();
      botAt.clear();
      roomAt = [];
    },
  };
}
