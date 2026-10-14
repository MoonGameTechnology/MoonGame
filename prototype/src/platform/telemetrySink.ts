/**
 * Сток продуктовых событий веб-адаптера (PTM-1.1, `docs/playtest-telemetry-roadmap.md`).
 *
 * Копит события и отправляет пакетом раз в несколько секунд — по запросу на событие
 * сервер утонул бы, а игрок заплатил бы батареей. Закрытие вкладки (`pagehide`) уходит
 * через `sendBeacon`: только его браузер гарантированно доносит из уходящей страницы.
 * У маяка нет заголовков, поэтому этот последний пакет анонимный — сервер свяжет его с
 * остальными по `install`.
 *
 * Аналитика — наблюдатель, а не участник: ни одна ошибка сети, хранилища или сериализации
 * не доходит до игры. Повтор — один, и только для пакета, который не дошёл; дальше он
 * теряется. Очередь ограничена: офлайн-вкладка не копит события бесконечно.
 *
 * Всё, что трогает браузер, приходит снаружи ({@link TelemetrySinkDeps}), поэтому модуль
 * тестируется без браузера и без сети.
 */
import { TELEMETRY_MAX_EVENTS, TELEMETRY_VERSION, type TelemetryEvent } from '../../../packages/protocol/src/telemetry';
import type { TelemetryTarget } from '../../../decisions/telemetryEndpoint';
import type { PlatformEvent } from './types';

export interface TelemetrySinkDeps {
  /** Адрес приёмника; `null` — слать некуда (адрес не разобрался). */
  endpoint: () => string | null;
  /** Сессия игрока, если он вошёл: тогда сервер добавит псевдоним. */
  token: () => string | null;
  install: string;
  session: string;
  build: string;
  now: () => number;
  /** Случайный id для события. */
  newId: () => string;
  /** Обычная отправка; `true` — сервер принял (2xx). Никогда не отклоняется. */
  post: (url: string, body: string, token: string | null) => Promise<boolean>;
  /** `navigator.sendBeacon`. */
  beacon: (url: string, body: string) => boolean;
  later: (fn: () => void, ms: number) => void;
}

export interface TelemetrySink {
  emit(event: PlatformEvent, props?: Record<string, string | number | boolean>): void;
  /** Отправить накопленное сейчас (таймер). */
  flush(): Promise<void>;
  /** Страница уходит: всё оставшееся — маяком. */
  pageHide(): void;
}

/** Пауза между пакетами. */
export const TELEMETRY_FLUSH_MS = 5_000;
/** Потолок очереди: дальше новые события отбрасываются. */
export const TELEMETRY_QUEUE_MAX = 200;

export function createTelemetrySink(deps: TelemetrySinkDeps): TelemetrySink {
  let queue: TelemetryEvent[] = [];
  let armed = false;
  let sending = false;

  const body = (events: TelemetryEvent[]): string =>
    JSON.stringify({
      v: TELEMETRY_VERSION,
      install: deps.install,
      session: deps.session,
      build: deps.build,
      events,
    });

  const arm = (): void => {
    if (armed || queue.length === 0) return;
    armed = true;
    deps.later(() => {
      armed = false;
      flush().catch(() => undefined);
    }, TELEMETRY_FLUSH_MS);
  };

  async function send(url: string, events: TelemetryEvent[]): Promise<boolean> {
    try {
      return await deps.post(url, body(events), deps.token());
    } catch {
      return false;
    }
  }

  async function flush(): Promise<void> {
    if (sending) return;
    const url = deps.endpoint();
    if (url === null) {
      queue = [];
      return;
    }
    sending = true;
    try {
      while (queue.length > 0) {
        const events = queue.splice(0, TELEMETRY_MAX_EVENTS);
        // Один повтор — и всё: сеть, которая не пускает дважды, не пустит и в третий раз.
        if (!(await send(url, events)) && !(await send(url, events))) break;
      }
    } finally {
      sending = false;
      arm();
    }
  }

  return {
    emit(event, props) {
      if (queue.length >= TELEMETRY_QUEUE_MAX) return;
      const ev: TelemetryEvent = { id: deps.newId(), e: event, t: deps.now() };
      if (props !== undefined) ev.p = props;
      queue.push(ev);
      arm();
    },
    flush,
    pageHide() {
      const url = deps.endpoint();
      if (url === null) return;
      try {
        while (queue.length > 0) deps.beacon(url, body(queue.splice(0, TELEMETRY_MAX_EVENTS)));
      } catch {
        /* маяк не принял — страница уже уходит, игре до этого дела нет */
      }
    },
  };
}

/** Случайный id: 16 байт в hex. `getRandomValues` есть и без https (APK, LAN), в
 *  отличие от `randomUUID`. */
function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const INSTALL_KEY = 'void.telemetry.install';

/** Установка — одна на профиль браузера. Хранилище закрыто → новая на каждую загрузку:
 *  хуже для подсчёта возвратов, но игра от этого не страдает. */
function installId(): string {
  try {
    const known = localStorage.getItem(INSTALL_KEY);
    if (known && /^[0-9a-f]{32}$/.test(known)) return known;
    const fresh = randomId();
    localStorage.setItem(INSTALL_KEY, fresh);
    return fresh;
  } catch {
    return randomId();
  }
}

/** Сток для настоящей страницы: адрес, сессия и отправка — из браузера. */
export function createBrowserTelemetrySink(opts: {
  /** Читается на каждой отправке: игрок мог сменить сервер на экране входа. */
  target: () => TelemetryTarget | null;
  token: (base: string) => string | null;
  build: string;
}): TelemetrySink {
  return createTelemetrySink({
    endpoint: () => opts.target()?.url ?? null,
    token: () => {
      const target = opts.target();
      return target === null ? null : opts.token(target.base);
    },
    install: installId(),
    session: randomId(),
    build: opts.build,
    now: () => Date.now(),
    newId: randomId,
    post: (url, body, token) =>
      fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body,
        credentials: 'omit',
      }).then(
        (res) => res.ok,
        () => false,
      ),
    beacon: (url, body) => navigator.sendBeacon(url, body),
    later: (fn, ms) => {
      setTimeout(fn, ms);
    },
  });
}
