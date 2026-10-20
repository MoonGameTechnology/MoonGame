/**
 * Service worker push-уведомлений (UIX-4.4, часть 2). Сборка кладёт его отдельным файлом
 * `dist/sw.js` (`build.mjs`), сервер отдаёт по `/sw.js` (`wsServer.ts`, опция
 * `serviceWorker`). Больше он ничего не делает: ни кэша страницы, ни перехвата запросов.
 *
 * Что показать и куда вести — `decisions/pushNotice.ts`. Своей локали у worker'а нет:
 * тексты по ключам присылает страница (`pushSetup.ts`), worker хранит их в Cache Storage
 * и подставляет. Браузер требует уведомление на КАЖДЫЙ push, поэтому даже нечитаемое тело
 * показывается общим текстом.
 */
import {
  parsePushPayload,
  PUSH_TEXT_KEYS,
  pushNoticeText,
  pushOpenPath,
  TEXTS_MESSAGE,
} from '../../decisions/pushNotice';

const TEXT_CACHE = 'vd-push-texts';
/** Ключ записи в Cache Storage — не адрес на сервере: по нему никто не ходит. */
const TEXT_URL = '/__push-texts';
const MAX_TEXT = 200;

/** Ровно то, что нужно от глобала worker'а: lib `webworker` прототип не подключает. */
interface WindowClientLike {
  url: string;
  focus(): Promise<unknown>;
}
interface WorkerScope {
  location: { origin: string };
  registration: {
    scope: string;
    showNotification(title: string, options: { body: string; tag: string; data: unknown }): Promise<void>;
  };
  clients: {
    claim(): Promise<void>;
    matchAll(o: { type: 'window'; includeUncontrolled: boolean }): Promise<WindowClientLike[]>;
    openWindow(url: string): Promise<unknown>;
  };
  skipWaiting(): Promise<void>;
  addEventListener(type: string, listener: (event: never) => void): void;
}
interface ExtendableEvent {
  waitUntil(p: Promise<unknown>): void;
}
const sw = self as unknown as WorkerScope;

/** Тексты от страницы: только известные ключи и только строки разумной длины. */
function cleanTexts(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, string> = {};
  for (const key of PUSH_TEXT_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.length <= MAX_TEXT) out[key] = v;
  }
  return out;
}

async function storedTexts(): Promise<Record<string, string>> {
  try {
    const hit = await (await caches.open(TEXT_CACHE)).match(TEXT_URL);
    return (hit && cleanTexts(await hit.json())) || {};
  } catch {
    return {};
  }
}

/** Корень, куда смонтирован клиент (`/` или `/dev/`), — из области регистрации. */
const root = (): string => new URL(sw.registration.scope).pathname.replace(/\/$/, '');

sw.addEventListener('install', (event: ExtendableEvent) => event.waitUntil(sw.skipWaiting()));
sw.addEventListener('activate', (event: ExtendableEvent) => event.waitUntil(sw.clients.claim()));

sw.addEventListener('message', (event: ExtendableEvent & { data: unknown }) => {
  const data = event.data as { type?: unknown; texts?: unknown } | null;
  if (data?.type !== TEXTS_MESSAGE) return;
  const texts = cleanTexts(data.texts);
  if (!texts) return;
  event.waitUntil(
    caches.open(TEXT_CACHE).then((c) => c.put(TEXT_URL, new Response(JSON.stringify(texts)))),
  );
});

sw.addEventListener('push', (event: ExtendableEvent & { data: { json(): unknown } | null }) => {
  let raw: unknown;
  try {
    raw = event.data?.json() ?? null;
  } catch {
    raw = null; // не JSON — покажем общий текст
  }
  const payload = parsePushPayload(raw);
  event.waitUntil(
    storedTexts().then((texts) => {
      const { title, body } = pushNoticeText(payload, texts);
      // Одна партия — одно уведомление: свежая новость заменяет прошлую, а не копится.
      return sw.registration.showNotification(title, {
        body,
        tag: payload.matchId || 'void-dominion',
        data: { path: pushOpenPath(payload, root()) },
      });
    }),
  );
});

sw.addEventListener(
  'notificationclick',
  (event: ExtendableEvent & { notification: { data: unknown; close(): void } }) => {
    event.notification.close();
    const data = event.notification.data as { path?: unknown } | null;
    const path = typeof data?.path === 'string' && data.path.startsWith('/') ? data.path : '/';
    const url = new URL(path, sw.location.origin).href;
    event.waitUntil(
      sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((open) => {
        // Игра уже открыта на этой партии — достаточно вывести её вперёд.
        const same = open.find((c) => c.url === url);
        return same ? same.focus() : sw.clients.openWindow(url);
      }),
    );
  },
);
