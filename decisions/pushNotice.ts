/**
 * Push-уведомления у клиента (UIX-4.4, часть 2): что показать, куда вести по тапу, когда
 * спросить согласие и какие виды слать. Сервер присылает ключ и голые id
 * (`packages/server/src/pushRule.ts`), а слова собирает клиент: у сервера нет локали
 * игрока.
 *
 * 1. **Текст без имён** (решение владельца 2026-10-20). Service worker не знает ни мира, ни
 *    данных игры: ему нечем превратить `w17` в имя планеты. Поэтому уведомление говорит
 *    только «что случилось», а «где» игрок увидит, открыв игру.
 * 2. **Слова кладёт страница, worker их только подставляет.** Тексты по ключам страница
 *    передаёт worker'у на выбранной локали ({@link pushTexts}); своей копии локали у
 *    worker'а нет. Текста нет — показывается сам ключ, как и везде (опечатка видна).
 * 3. **Чужое тело push не доверяется.** Неизвестный ключ, мусор вместо числа или id с
 *    посторонними знаками — общий текст {@link GENERIC_KEY} и вход в игру без партии.
 *    Показать что-то обязательно: браузер требует уведомление на каждый push.
 * 4. **Тап открывает партию** — её постоянный адрес `/game/<id>` (`matchAddress.ts`).
 * 5. **Согласие спрашивается после первой своей новости, а не на старте**: игрок в
 *    сетевой партии со входом в аккаунт, браузер умеет push, разрешение ещё не спрошено и
 *    сам игрок вопрос не закрывал. «Своя новость» — то, за что сервер шлёт push, кроме
 *    начала боя: окно поверх нападения закрыло бы игроку сам бой. Спрашиваем на спокойной
 *    новости — готовой постройке, готовом исследовании, итоге своего боя.
 * 6. **Виды — четыре выключателя**: нападение, итог боя, постройка, исследование. Порядок
 *    списка всегда {@link PUSH_KINDS}, повторов нет — так их принимает сервер.
 */

/** Виды push и их порядок — тот же список, что у сервера (`store/types.ts`). */
export const PUSH_KINDS = ['attacked', 'battle', 'built', 'researched'] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

/** Подпись выключателя вида в настройках. */
export const PUSH_KIND_LABEL: Record<PushKind, string> = {
  attacked: 'push.kind.attacked',
  battle: 'push.kind.battle',
  built: 'push.kind.built',
  researched: 'push.kind.researched',
};

/** Ключи, которыми сервер называет новость (`pushRule.ts`). */
export const PUSH_NOTICE_KEYS = [
  'push.attacked',
  'push.battle-won',
  'push.battle-lost',
  'push.built',
  'push.researched',
] as const;
export type PushNoticeKey = (typeof PUSH_NOTICE_KEYS)[number];

/** Общий текст для тела, которое не удалось разобрать (правило 3). */
export const GENERIC_KEY = 'push.generic';
/** «Ещё N» в теле уведомления; `{n}` подставляет worker. */
export const MORE_KEY = 'push.more';

/** Все ключи, тексты которых странице нужно передать worker'у (правило 2). */
export const PUSH_TEXT_KEYS: readonly string[] = [...PUSH_NOTICE_KEYS, GENERIC_KEY, MORE_KEY];

/** Тип сообщения, которым страница передаёт worker'у тексты. */
export const TEXTS_MESSAGE = 'push-texts';

/** Тексты по ключам на выбранной локали — их страница отдаёт worker'у. */
export function pushTexts(t: (key: string) => string): Record<string, string> {
  return Object.fromEntries(PUSH_TEXT_KEYS.map((k) => [k, t(k)]));
}

/** Разобранное тело push. */
export interface PushPayload {
  key: PushNoticeKey | typeof GENERIC_KEY;
  /** Партия, в которую ведёт тап; `''` — просто открыть игру. */
  matchId: string;
  more: number;
}

const MATCH_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Тело push → то, что можно показать (правило 3). Не бросает. */
export function parsePushPayload(raw: unknown): PushPayload {
  const p = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const known = (PUSH_NOTICE_KEYS as readonly unknown[]).includes(p.key);
  const matchId = typeof p.matchId === 'string' && MATCH_ID.test(p.matchId) ? p.matchId : '';
  const more =
    typeof p.more === 'number' && Number.isInteger(p.more) && p.more > 0 && p.more < 1e6
      ? p.more
      : 0;
  return known
    ? { key: p.key as PushNoticeKey, matchId, more }
    : { key: GENERIC_KEY, matchId, more: 0 };
}

/** Заголовок и строка уведомления из сохранённых текстов (правила 1–2). */
export function pushNoticeText(
  payload: PushPayload,
  texts: Readonly<Record<string, string>>,
): { title: string; body: string } {
  const title = texts[payload.key] || payload.key;
  const more = texts[MORE_KEY] || MORE_KEY;
  return { title, body: payload.more > 0 ? more.replace('{n}', String(payload.more)) : '' };
}

/** Куда ведёт тап (правило 4): адрес партии внутри смонтированного клиента. */
export function pushOpenPath(payload: PushPayload, root = ''): string {
  return payload.matchId ? `${root}/game/${encodeURIComponent(payload.matchId)}` : `${root}/`;
}

/** Событие мира, как его видит клиент. */
interface WorldEvent {
  type: string;
  payload: unknown;
}

const has = (list: unknown, who: string): boolean => Array.isArray(list) && list.includes(who);

/** Есть ли в пакете спокойная своя новость — момент спросить согласие (правило 5). */
export function isAskMoment(events: readonly WorldEvent[], me: string): boolean {
  return events.some((e) => {
    const p = (e.payload && typeof e.payload === 'object' ? e.payload : {}) as Record<
      string,
      unknown
    >;
    switch (e.type) {
      case 'battle.resolved':
        return has(p.winners, me) || has(p.losers, me);
      case 'building.constructed':
      case 'building.upgraded':
        return p.owner === me;
      case 'technology.researched':
        return p.playerId === me;
      default:
        return false; // и начало боя: окно поверх нападения закрыло бы сам бой
    }
  });
}

/** Разрешение браузера на уведомления (`Notification.permission`). */
export type PushPermission = 'default' | 'granted' | 'denied';

/** Что знает клиент, решая, спросить ли согласие (правило 5). */
export interface PushAskState {
  /** Браузер умеет push, а страница открыта с того же сервера, что принимает подписку. */
  supported: boolean;
  /** Сетевая партия со входом в аккаунт: push привязан к аккаунту. */
  signedIn: boolean;
  /** Разрешение браузера на уведомления. */
  permission: PushPermission;
  /** Игрок уже отвечал на вопрос (любым ответом). */
  answered: boolean;
}

/** Спросить ли согласие сейчас (правило 5). */
export function shouldAskPush(state: PushAskState, news: boolean): boolean {
  return (
    news && state.supported && state.signedIn && state.permission === 'default' && !state.answered
  );
}

/** Выключатель вида в списке разрешённых, порядок — {@link PUSH_KINDS} (правило 6). */
export function toggleKind(
  kinds: readonly PushKind[],
  kind: PushKind,
  on: boolean,
): PushKind[] {
  return PUSH_KINDS.filter((k) => (k === kind ? on : kinds.includes(k)));
}

/** Сохранённые виды из хранилища; мусор — все виды. */
export function kindsFrom(raw: unknown): PushKind[] {
  if (!Array.isArray(raw)) return [...PUSH_KINDS];
  return PUSH_KINDS.filter((k) => raw.includes(k));
}

/** Что показать в настройках уведомлений. */
export type PushSettingsState =
  /** Браузер не умеет push или страница открыта не с сервера — вкладки нет. */
  | 'unsupported'
  /** Нет входа в аккаунт: включать нечего. */
  | 'guest'
  /** Игрок запретил уведомления в браузере: включить можно только там. */
  | 'blocked'
  | 'off'
  | 'on';

export function pushSettingsState(s: {
  supported: boolean;
  signedIn: boolean;
  permission: PushPermission;
  subscribed: boolean;
}): PushSettingsState {
  if (!s.supported) return 'unsupported';
  if (!s.signedIn) return 'guest';
  if (s.permission === 'denied') return 'blocked';
  return s.subscribed && s.permission === 'granted' ? 'on' : 'off';
}

/** VAPID-ключ сервера (base64url) → байты для `PushManager.subscribe`. */
export function vapidKeyBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const bin = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
