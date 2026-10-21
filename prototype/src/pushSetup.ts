/**
 * Подписка на push-уведомления на странице (UIX-4.4, часть 2): согласие, service worker,
 * подписка у сервера и выключатели видов. Правила — `decisions/pushNotice.ts`; worker —
 * `pushWorker.ts`; приёмник подписки — `packages/server/src/pushApi.ts`.
 *
 * - **Согласие — после первой спокойной своей новости в сетевой партии, а не на старте.**
 *   Свой вопрос игры идёт ПЕРВЫМ, системный — только по нажатию «Включить»: браузер,
 *   получив отказ, второй раз спросить не даст, и тратить его на холодный вопрос нельзя.
 *   Ответ любым словом запоминается: вопрос не возвращается, включить можно в настройках.
 * - **Только там, где push правда работает:** браузер умеет, страница открыта с того же
 *   сервера, что принимает подписку (worker живёт на её origin), и есть вход в аккаунт.
 * - **Виды хранит сервер** (`kinds` в подписке): браузер обязан показать каждый пришедший
 *   push, поэтому выключенный вид отсекается до отправки. Локально — только копия для
 *   настроек и для следующей подписки.
 * - **Тексты — на выбранной локали**: страница передаёт их worker'у при каждом запуске с
 *   живой подпиской и при включении.
 */
import { t } from '../../localization/runtime';
import {
  isAskMoment,
  kindsFrom,
  pushSettingsState,
  pushTexts,
  shouldAskPush,
  TEXTS_MESSAGE,
  toggleKind,
  vapidKeyBytes,
  type PushKind,
  type PushPermission,
  type PushSettingsState,
} from '../../decisions/pushNotice';
import { readRaw, writeRaw } from './prefs';

const ASKED_KEY = 'vd.push.asked';
const KINDS_KEY = 'vd.push.kinds';
const WORKER_URL = '/sw.js';
/** Сколько ждать службу push браузера. Недоступная служба не отвечает вовсе, и без срока
 *  выключатель остался бы заблокированным навсегда. Ответ игрока на системный вопрос этим
 *  сроком не ограничен. */
const SUBSCRIBE_MS = 20_000;

/** Обещание со сроком: не успело — отказ. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Что модулю нужно от игры. */
export interface PushHost {
  /** Адрес сервера и сессия аккаунта, или `null` — входа нет. */
  authorizedBase(): Promise<{ base: string; token: string } | null>;
  /** Окно вопроса о согласии (`#pushask`). */
  askRoot(): HTMLElement;
  /** Состояние подписки сменилось — перерисовать то, что его показывает. */
  changed(): void;
}

/** Что показать во вкладке «Уведомления». */
export interface PushView {
  state: PushSettingsState;
  kinds: readonly PushKind[];
  /** Последняя попытка включить не удалась. */
  failed: boolean;
}

export interface PushControl {
  /** Вкладка настроек; `undefined` — браузер push не умеет, вкладки нет. */
  view(): PushView | undefined;
  /** Пакет событий сетевой партии: не пора ли спросить согласие. */
  onEvents(events: readonly { type: string; payload: unknown }[], seat: string): void;
  setEnabled(on: boolean): Promise<void>;
  setKind(kind: PushKind, on: boolean): Promise<void>;
  /** Перечитать вход и подписку (окно настроек открылось). */
  refresh(): Promise<void>;
  /** Открыт ли вопрос о согласии. */
  asking(): boolean;
  /** Закрыть вопрос как «Не сейчас» (Back, Esc). */
  dismiss(): void;
}

/** Браузер умеет push, и страница открыта сервером, а не с диска. */
function browserSupports(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    location.protocol.startsWith('http') &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

const permission = (): PushPermission =>
  typeof Notification === 'undefined' ? 'denied' : Notification.permission;

export function initPush(host: PushHost): PushControl {
  const supported = browserSupports();
  let signedIn = false;
  let subscribed = false;
  let failed = false;
  let asking = false;
  let kinds: PushKind[] = (() => {
    try {
      return kindsFrom(JSON.parse(readRaw(KINDS_KEY) ?? 'null'));
    } catch {
      return kindsFrom(null);
    }
  })();

  /** Сессия, если сервер подписки — тот же origin, что отдал страницу и worker. */
  const session = async (): Promise<{ base: string; token: string } | null> => {
    const auth = await host.authorizedBase().catch(() => null);
    if (!auth) return null;
    try {
      return new URL(auth.base, location.href).origin === location.origin ? auth : null;
    } catch {
      return null;
    }
  };

  const post = async (
    auth: { base: string; token: string },
    path: string,
    body?: unknown,
  ): Promise<boolean> => {
    const res = await fetch(`${auth.base}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return res.ok;
  };

  const registration = async (): Promise<ServiceWorkerRegistration | undefined> =>
    navigator.serviceWorker.getRegistration(WORKER_URL).catch(() => undefined);

  const sendTexts = (reg: ServiceWorkerRegistration): void => {
    (reg.active ?? reg.waiting ?? reg.installing)?.postMessage({
      type: TEXTS_MESSAGE,
      texts: pushTexts(t),
    });
  };

  async function refresh(): Promise<void> {
    if (!supported) return;
    signedIn = (await session()) !== null;
    const reg = await registration();
    const sub = await reg?.pushManager.getSubscription().catch(() => null);
    subscribed = !!sub && permission() === 'granted';
    if (reg && subscribed) sendTexts(reg); // локаль могла смениться с прошлого запуска
    host.changed();
  }

  /** Подписаться у браузера и у сервера с текущими видами. */
  async function enable(): Promise<boolean> {
    if ((await Notification.requestPermission()) !== 'granted') return false;
    const auth = await session();
    if (!auth) return false;
    const key = await fetch(`${auth.base}/push/key`);
    if (!key.ok) return false;
    const { publicKey } = (await key.json()) as { publicKey?: unknown };
    if (typeof publicKey !== 'string') return false;
    await navigator.serviceWorker.register(WORKER_URL);
    const reg = await within(navigator.serviceWorker.ready, SUBSCRIBE_MS);
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await within(
        reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKeyBytes(publicKey) as Uint8Array<ArrayBuffer>,
        }),
        SUBSCRIBE_MS,
      ));
    sendTexts(reg);
    return post(auth, '/push/subscribe', { ...sub.toJSON(), kinds });
  }

  async function setEnabled(on: boolean): Promise<void> {
    failed = false;
    try {
      if (on) {
        failed = !(await enable());
      } else {
        const auth = await session();
        await (await registration())?.pushManager
          .getSubscription()
          .then((sub) => sub?.unsubscribe());
        if (auth) await post(auth, '/push/unsubscribe');
      }
    } catch {
      failed = on;
    }
    await refresh();
  }

  async function setKind(kind: PushKind, on: boolean): Promise<void> {
    kinds = toggleKind(kinds, kind, on);
    writeRaw(KINDS_KEY, JSON.stringify(kinds));
    if (!subscribed) return;
    try {
      const auth = await session();
      const sub = await (await registration())?.pushManager.getSubscription();
      if (auth && sub) failed = !(await post(auth, '/push/subscribe', { ...sub.toJSON(), kinds }));
    } catch {
      failed = true;
    }
    host.changed();
  }

  // Вопрос о согласии: свои кнопки, системный запрос — только по «Включить».
  const ask = host.askRoot();
  const close = (): void => {
    ask.classList.remove('show');
    writeRaw(ASKED_KEY, '1');
  };
  ask.querySelector('#pushask-no')?.addEventListener('click', close);
  ask.querySelector('#pushask-yes')?.addEventListener('click', () => {
    close();
    setEnabled(true).catch(() => undefined); // отказ уже показан во вкладке настроек
  });

  function onEvents(events: readonly { type: string; payload: unknown }[], seat: string): void {
    if (asking || !isAskMoment(events, seat)) return;
    asking = true; // пока сверяем вход — и потом, один раз за запуск, даже без ответа
    // Вход сверяется здесь, а не на старте: в сетевую партию игрок входит уже после него.
    session().then((auth) => {
      signedIn = auth !== null;
      const answered = !!readRaw(ASKED_KEY);
      if (!shouldAskPush({ supported, signedIn, permission: permission(), answered }, true)) {
        asking = false;
        return;
      }
      ask.classList.add('show');
      ask.querySelector<HTMLElement>('#pushask-yes')?.focus();
    }, () => (asking = false));
  }

  refresh().catch(() => undefined); // нет ответа — вкладка покажет «выключено»

  return {
    view: () =>
      supported
        ? {
            state: pushSettingsState({ supported, signedIn, permission: permission(), subscribed }),
            kinds,
            failed,
          }
        : undefined,
    onEvents,
    setEnabled,
    setKind,
    refresh,
    asking: () => ask.classList.contains('show'),
    dismiss: close,
  };
}
