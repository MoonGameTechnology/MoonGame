import { getStance, type Action, type GameState } from '@void/shared-core';
import type { ChatMessage } from '@void/protocol';

const BOT_REPLY_VARIANTS = {
  'bot-chat.greeting': ['bot-chat.greeting', 'bot-chat.greeting.casual', 'bot-chat.greeting.short'],
  'bot-chat.help': ['bot-chat.help', 'bot-chat.help.casual', 'bot-chat.help.short'],
  'bot-chat.english-only': [
    'bot-chat.english-only',
    'bot-chat.english-only.casual',
    'bot-chat.english-only.short',
  ],
  'bot-chat.trade': ['bot-chat.trade', 'bot-chat.trade.casual', 'bot-chat.trade.short'],
  'bot-chat.alliance-refused': [
    'bot-chat.alliance-refused',
    'bot-chat.alliance-refused.casual',
    'bot-chat.alliance-refused.short',
  ],
  'bot-chat.peace-current': [
    'bot-chat.peace-current',
    'bot-chat.peace-current.casual',
    'bot-chat.peace-current.short',
  ],
  'bot-chat.peace-accepted': [
    'bot-chat.peace-accepted',
    'bot-chat.peace-accepted.casual',
    'bot-chat.peace-accepted.short',
  ],
  'bot-chat.pact-current': [
    'bot-chat.pact-current',
    'bot-chat.pact-current.casual',
    'bot-chat.pact-current.short',
  ],
  'bot-chat.pact-accepted': [
    'bot-chat.pact-accepted',
    'bot-chat.pact-accepted.casual',
    'bot-chat.pact-accepted.short',
  ],
  'bot-chat.war-current': [
    'bot-chat.war-current',
    'bot-chat.war-current.casual',
    'bot-chat.war-current.short',
  ],
  'bot-chat.war-confirmed': [
    'bot-chat.war-confirmed',
    'bot-chat.war-confirmed.casual',
    'bot-chat.war-confirmed.short',
  ],
  'bot-chat.negotiation-refused': [
    'bot-chat.negotiation-refused',
    'bot-chat.negotiation-refused.casual',
    'bot-chat.negotiation-refused.short',
  ],
  'bot-chat.negotiation-failed': [
    'bot-chat.negotiation-failed',
    'bot-chat.negotiation-failed.casual',
    'bot-chat.negotiation-failed.short',
  ],
} as const;
type BotReplyBaseKey = keyof typeof BOT_REPLY_VARIANTS;
export const BOT_REPLY_KEYS = Object.values(BOT_REPLY_VARIANTS).flat();
export type BotReplyKey = (typeof BOT_REPLY_KEYS)[number];

type Intent =
  'greeting' | 'peace' | 'pact' | 'war' | 'trade' | 'alliance' | 'help' | 'english-only';
// The adapter still supports catalog validation for both locales; bot speech
// always selects English, independently of the recipient's interface language.
export type BotReplyLocale = 'ru' | 'en';

/** A small English command grammar, not a general language detector. Foreign
 * scripts, common foreign words and unknown prose receive an English request.
 * No translation or inferred consent: only explicit English orders can act. */
export function botChatIntent(text: string): { intent: Intent; locale: 'en' } {
  const normalized = text.normalize('NFKC').toLowerCase().trim();
  const foreignScript = Array.from(normalized).some(
    (letter) => /\p{L}/u.test(letter) && !/\p{Script=Latin}/u.test(letter),
  );
  const words = normalized
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const foreignWords =
    /(?:^|\s)(?:hola|bonjour|bonsoir|salut|ciao|buongiorno|hallo|guten|merhaba|selam|privet|davai|spasibo|gracias|quiero|paz|guerra|merci|paix|frieden|krieg|danke|bitte|grazie|alleanza|obrigado|olá|você|pacto)(?:\s|$)/u;
  if (foreignScript || foreignWords.test(words)) return { intent: 'english-only', locale: 'en' };
  const englishWords =
    /(?:^|\s)(?:i|you|we|he|she|hello|hi|hey|yo|sup|what|whats|how|hows|where|when|why|please|pls|plz|can|could|would|the|and|is|are|my|thanks|thank|gg|gl|hf|nice|trade|buy|sell|market|alliance|coalition|peace|pact|war|stop|make|offer|declare|help|oof|lol|brb|afk|ok|okay|yep|nah|sorry|sry|dude|bro|mate|wanna|gotta|need|want|u|r|ty|np)(?:\s|$)/;
  if (!englishWords.test(words)) return { intent: 'english-only', locale: 'en' };
  // Quoted commands and questions are conversation, never consent to an order.
  if (/["'«»“”‘’‹›„‟‚‛`?؟()[\]{}<>]/.test(normalized)) return { intent: 'help', locale: 'en' };
  const command = /^\/(peace|pact|war)$/.exec(normalized);
  if (command) return { intent: command[1] as 'peace' | 'pact' | 'war', locale: 'en' };
  let intent: Intent = 'help';
  if (/^(?:i )?declare war(?: on you)?$/.test(words)) intent = 'war';
  else if (/^(?:make peace|let us make peace|i offer peace|stop the war)$/.test(words))
    intent = 'peace';
  else if (/^(?:offer pact|let us make a pact)$/.test(words)) intent = 'pact';
  else if (/\b(?:alliance|coalition)\b/.test(words)) intent = 'alliance';
  else if (/\b(?:trade|buy|sell|market)\b/.test(words)) intent = 'trade';
  else if (/^(?:hello|hi|hey|yo|sup)(?: |$)/.test(words)) intent = 'greeting';
  return { intent, locale: 'en' };
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++)
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
  return hash;
}

const SOCIAL_PERIOD_MS = 90 * 60_000;
const SOCIAL_WINDOW_MS = 5 * 60_000;
export const BOT_REPLY_DELAY_MIN_MS = 12_000;
export const BOT_REPLY_DELAY_MAX_MS = 45_000;

/** Stable, separate wall-clock availability per bot; no polling or world-time
 * dependence, and restarting the host does not open a fresh availability window. */
export function botSocialAvailable(botId: string, wall: number): boolean {
  if (!Number.isFinite(wall)) return false;
  const phase = stableHash('availability:' + botId) % SOCIAL_PERIOD_MS;
  const elapsed = (((wall - phase) % SOCIAL_PERIOD_MS) + SOCIAL_PERIOD_MS) % SOCIAL_PERIOD_MS;
  return elapsed < SOCIAL_WINDOW_MS;
}

export function botReplyDelayMs(message: Pick<ChatMessage, 'id' | 'from' | 'to'>): number {
  const seed = JSON.stringify(['delay', message.to, message.from, message.id]);
  return (
    BOT_REPLY_DELAY_MIN_MS +
    (stableHash(seed) % (BOT_REPLY_DELAY_MAX_MS - BOT_REPLY_DELAY_MIN_MS + 1))
  );
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
  /** Scheduling seams for isolated tests; production hosts use the sparse defaults. */
  availability?: (botId: string, wall: number) => boolean;
  replyDelay?: (message: Readonly<ChatMessage>) => number;
  /** Stable diagnostic only; chat text, names and credentials stay out of logs. */
  onError?: (code: 'E_BOT_REPLY') => void;
}

const PAIR_COOLDOWN_MIN_MS = 2 * 60_000;
const PAIR_COOLDOWN_SPREAD_MS = 3 * 60_000;
const BOT_COOLDOWN_MS = 2 * 60_000;
const ROOM_WINDOW_MS = 60_000;
const ROOM_REPLIES_MAX = 12;
const COOLDOWN_KEYS_MAX = 256;
interface PendingReply {
  timer: ReturnType<typeof setTimeout> | null;
}

/** Bounded local responder for accepted HUMAN DMs to dedicated persistent bots.
 * Exactly one pending timer/work item per room; no polling, external requests,
 * generated peers or recursive replies. Chat remains the ordinary ephemeral relay. */
export function createBotSocial(options: BotSocialOptions): {
  onMessage(message: Readonly<ChatMessage>): void;
  stop(): void;
  drain(): Promise<void>;
} {
  const now = options.now ?? Date.now;
  const available = options.availability ?? botSocialAvailable;
  const replyDelay = options.replyDelay ?? botReplyDelayMs;
  const pairAt = new Map<string, number>();
  const botAt = new Map<string, number>();
  let roomAt: number[] = [];
  let pending: PendingReply | null = null;
  let stopped = false;
  let inFlight: Promise<void> = Promise.resolve();
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
    if (!current() || !available(bot, now())) return;
    const { intent, locale } = botChatIntent(message.text);
    let key: BotReplyBaseKey =
      intent === 'english-only'
        ? 'bot-chat.english-only'
        : intent === 'greeting'
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
    if (current()) {
      const variants = BOT_REPLY_VARIANTS[key];
      const variant = stableHash(JSON.stringify(['reply', bot, message.id])) % variants.length;
      options.room.sendServerChat(bot, human, options.render(variants[variant]!, locale));
    }
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
      if (!Number.isFinite(wall) || !available(message.to, wall)) return;
      const pair = JSON.stringify([message.from, message.to]);
      const pairCooldown =
        PAIR_COOLDOWN_MIN_MS + (stableHash(pair) % (PAIR_COOLDOWN_SPREAD_MS + 1));
      if (
        wall - (pairAt.get(pair) ?? -Infinity) < pairCooldown ||
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
        inFlight = answer(accepted, admissionRevision)
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
      }, replyDelay(accepted));
    },
    stop() {
      stopped = true;
      if (pending?.timer) clearTimeout(pending.timer);
      pending = null;
      pairAt.clear();
      botAt.clear();
      roomAt = [];
    },
    // stop() revokes further consent; wait for a durable action already submitted.
    drain: () => inFlight,
  };
}
