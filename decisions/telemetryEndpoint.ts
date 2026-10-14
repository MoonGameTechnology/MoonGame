/**
 * Куда клиент шлёт продуктовые события (PTM-1.1, `docs/playtest-telemetry-roadmap.md`).
 *
 * Туда же, где играет: приёмник живёт на игровом сервере, и адрес берётся по тому же
 * правилу, что у поля «сервер» на экране входа. Запомненный адрес — первым (игрок уже
 * заходил на чужой сервер), иначе ТОТ ЖЕ origin, что у страницы: на https это сам сайт, у
 * страницы, отданной прототип-сервером, — его порт, у файла и APK без порта — `:8788`.
 * Разбор набранного общий с экраном входа ({@link socketBase}), поэтому `https://`,
 * голый хост и лишний путь превращаются в адрес одинаково в обоих местах.
 *
 * `null` — адрес не разобрался: событиям некуда ехать, и это не повод мешать игре.
 */
import { httpBase } from './matchQuery';
import { socketBase } from './serverAddress';

export interface PageLocation {
  protocol: string;
  host: string;
  hostname: string;
  port: string;
}

/** Сервер событий: `base` — адрес сокета (по нему же лежит сессия игрока), `url` — приёмник. */
export interface TelemetryTarget {
  base: string;
  url: string;
}

export function telemetryTarget(stored: string | null, page: PageLocation): TelemetryTarget | null {
  const https = page.protocol === 'https:';
  const typed =
    stored ??
    (https
      ? `wss://${page.host}`
      : page.port
        ? `ws://${page.host}`
        : `ws://${page.hostname || '127.0.0.1'}:8788`);
  const base = socketBase(typed, https);
  return base === null ? null : { base, url: `${httpBase(base)}/telemetry` };
}
