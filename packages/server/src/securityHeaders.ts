/**
 * Заголовки безопасной доставки клиента (SE-7.1, OWASP A05).
 *
 * Игра уезжает игроку ОДНИМ html-файлом, который отдаёт этот же сервер (`indexHtml` в
 * `wsServer.ts`). Значит и политику доставки ставит он: до сих пор документ уходил без
 * единого заголовка безопасности — ни CSP, ни HSTS, ни `nosniff`. XSS в таком документе
 * не ограничен ничем: внедрённый скрипт исполняется, читает `localStorage` (там лежит
 * сейв и позывной) и отправляет куда угодно.
 *
 * 1. **CSP строится на ХЕШАХ, а не на `'unsafe-inline'`.** Сборка кладёт в документ ровно
 *    один `<script>` и один `<style>` инлайном, внешних ресурсов нет вовсе (иконка —
 *    `data:`-URI). Поэтому политике не нужен ни `unsafe-inline`, ни nonce: хеш считается
 *    из того же текста, который уходит игроку, и ЧУЖОЙ скрипт под него не подойдёт.
 *    Nonce потребовал бы генерации на запрос и ломал бы кэш; хеш неизменен для сборки.
 * 2. **`default-src 'none'` — белый список, а не чёрный.** Всё, что документу правда
 *    нужно, перечислено поимённо: свои картинки и `data:`-иконка, свой шрифт, свои
 *    соединения. Остальное (объекты, фреймы, воркеры) запрещено молча и навсегда.
 * 3. **`connect-src` пускает `wss:`, а не только `'self'`.** Клиент умеет подключаться к
 *    ЧУЖОМУ серверу по ссылке `?join=wss://…` — это поддержанный вход, и `'self'` его бы
 *    убил. Плейнтекстный `ws:` при этом не разрешён: он и так не работает со страницы
 *    по https (mixed content), а в политике его отсутствие — ещё и явный запрет.
 * 4. **HSTS только там, где документ правда ушёл по HTTPS.** На `http://localhost` этот
 *    заголовок браузер запомнит для всего `localhost` и сломает разработчику любой
 *    другой локальный проект по http. Признак берётся у вызывающего (он знает про свой
 *    TLS и про `X-Forwarded-Proto` от прокси), а не угадывается здесь.
 * 5. **`frame-ancestors` настраивается.** По умолчанию `'none'`: игру никто не
 *    встраивает, и кликджекинг запрещён. Площадка-портал (Яндекс Игры, блок `YAG`)
 *    показывает игру в своём iframe — там придётся перечислить её origin, и лучше это
 *    будет один параметр, чем вырезание заголовка целиком.
 * 6. **COEP НЕ ставится, и это решение.** `require-corp` здесь ничего не защищает
 *    (кросс-оригинных подресурсов нет вовсе — их уже запретил `default-src 'none'`),
 *    зато ломает встраивание и требует согласованности с будущей площадкой. Выгода
 *    нулевая, цена — отложенная поломка.
 * 7. **Не-HTML ответы получают свою, короткую политику.** JSON API нечего исполнять,
 *    поэтому ему достаточно `default-src 'none'` + `nosniff` + запрет встраивания:
 *    браузер не должен «додумать» тип ответа и прочитать его как скрипт.
 *
 * Чего здесь НЕТ: `require-trusted-types-for 'script'` (SE-7.1 остаётся 🔶). Прототип
 * рисует интерфейс через `innerHTML` в полутора сотнях мест — Trusted Types уронит его
 * на первом же кадре. Это отдельная работа по клиенту, а не заголовок.
 */
import { createHash } from 'node:crypto';

/** Хеши инлайновых блоков документа — по одному на `<script>` и `<style>`. */
export interface InlineHashes {
  scripts: string[];
  styles: string[];
}

const TAG_RE = (tag: 'script' | 'style'): RegExp =>
  new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');

/** `'sha256-…'` в том виде, в каком его читает CSP. */
function sha256(body: string): string {
  return `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
}

/**
 * Хеши всех инлайновых блоков документа. Считаются из ТОГО ЖЕ текста, который уйдёт
 * игроку, поэтому политика не может разъехаться со сборкой: пересобрали клиент —
 * пересчитались хеши. Пустой блок пропускается: хешировать нечего, а `''` в политике
 * разрешил бы любой пустой скрипт.
 */
export function inlineHashes(html: string): InlineHashes {
  const of = (tag: 'script' | 'style'): string[] => {
    const out: string[] = [];
    for (const m of html.matchAll(TAG_RE(tag))) {
      const body = m[1] ?? '';
      if (body.trim() !== '') out.push(sha256(body));
    }
    return out;
  };
  return { scripts: of('script'), styles: of('style') };
}

/** Из чего собирается политика. Всё известно вызывающему — модуль ничего не угадывает. */
export interface SecurityHeaderOptions {
  /** Хеши инлайновых блоков документа (правило 1). */
  inline?: InlineHashes;
  /** Ушёл ли документ по HTTPS — от этого зависит HSTS (правило 4). */
  https?: boolean;
  /** Кому разрешено встраивать документ; по умолчанию никому (правило 5). */
  frameAncestors?: readonly string[];
}

const PERMISSIONS = [
  'geolocation=()',
  'camera=()',
  'microphone=()',
  'payment=()',
  'usb=()',
  'serial=()',
  'midi=()',
  'display-capture=()',
].join(', ');

/** Год — рекомендация OWASP; `preload` сознательно не ставим: это обязательство, которое
 *  снимается месяцами, и брать его за игру, живущую на одном домене, не за что. */
const HSTS = 'max-age=31536000; includeSubDomains';

/** Заголовки для HTML-документа игры (правила 1–6). */
export function securityHeaders(options: SecurityHeaderOptions = {}): Record<string, string> {
  const scripts = options.inline?.scripts ?? [];
  const styles = options.inline?.styles ?? [];
  const ancestors = options.frameAncestors?.length ? options.frameAncestors.join(' ') : "'none'";
  const csp = [
    "default-src 'none'",
    `script-src ${scripts.join(' ') || "'none'"}`,
    `style-src ${styles.join(' ') || "'none'"}`,
    "img-src 'self' data:",
    "font-src 'self' data:",
    // Правило 3: свой origin плюс любой wss — ссылка `?join=` ведёт на чужой сервер.
    "connect-src 'self' wss:",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${ancestors}`,
    "object-src 'none'",
    "worker-src 'none'",
  ].join('; ');
  return {
    'content-security-policy': csp,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': PERMISSIONS,
    'cross-origin-opener-policy': 'same-origin-allow-popups',
    'cross-origin-resource-policy': 'same-origin',
    ...(options.https ? { 'strict-transport-security': HSTS } : {}),
  };
}

/** Заголовки для не-HTML ответов — API и метрик (правило 7). */
export function apiSecurityHeaders(https = false): Record<string, string> {
  return {
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...(https ? { 'strict-transport-security': HSTS } : {}),
  };
}
