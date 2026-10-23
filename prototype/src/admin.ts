/**
 * ADM-1 — пульт администратора: ОТДЕЛЬНЫЙ клиент, не часть игры.
 *
 * Отдельный он не из вкусовщины. Игровой клиент — это то, что раздаётся людям; всё,
 * что в нём есть, у них есть тоже, включая разметку и обработчики админских кнопок.
 * Прав от этого не появится (решает сервер), но поверхность, которую надо держать в
 * голове при каждой правке HUD, вырастет. Здесь же одна страница на четыре запроса,
 * и она не знает про карту, флот и локальное сохранение игрока ничего.
 *
 * Три правила, по которым он устроен.
 *
 * 1. **Личность — обычная сессия, полномочие — на сервере.** Вход тем же
 *    `POST /auth/login`, что у игрока; «я администратор» подтверждает `GET /admin/whoami`.
 *    Клиент НИЧЕГО не решает про права: если бы он прятал кнопку сам, скрытая кнопка
 *    и была бы всей защитой.
 * 2. **Сессия живёт в `sessionStorage`, а не в `localStorage`.** Пропуск с правом
 *    снимать людей с мест не должен переживать закрытие вкладки на чужом ноутбуке.
 *    Перезагрузку переживает — иначе пультом нельзя пользоваться.
 * 3. **Состав перечитывается после каждого действия и сам по таймеру.** Кик по
 *    устаревшему списку — это снятый не тот человек; сервер от этого защищён (кик
 *    адресован ПОЗЫВНОМУ, а не креслу), но показывать несуществующий состав всё
 *    равно нельзя.
 *
 * Здесь же объявления ленты новостей (CORP-2): форма на двух языках и список с кнопкой
 * «Снять». Список, как и состав, перечитывается после каждого действия.
 */
import { LOCALE, t, localizeStaticDom } from '../../localization/runtime';
import { resolveBase } from '../../decisions/serverAddress';
import { NEWS_KIND_LABEL, parseNewsAnnouncement } from '../../decisions/newsFeed';
import { NEWS_ANNOUNCEMENT_KINDS, type NewsAnnouncement } from '../../packages/protocol/src/news';
import { detach } from './detach';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Ключ сессии в `sessionStorage` (правило 2). */
const SESSION_KEY = 'vd.admin.session';
/** Как часто сам обновляется состав, мс. */
const REFRESH_MS = 5000;

interface SeatRow {
  playerId: string;
  name: string;
  faction: string;
  nick: string | null;
  seated: boolean;
  connected: boolean;
}
interface Roster {
  matchId: string;
  day: number;
  ended: boolean;
  entryOpen: boolean;
  seats: SeatRow[];
}
interface MatchRow {
  matchId: string;
}
interface MatchLists {
  available?: MatchRow[];
  active?: MatchRow[];
  archived?: MatchRow[];
}

interface AdminSession {
  base: string;
  token: string;
}
let session: AdminSession | null = null;
let authGeneration = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** Адрес сервера: поле, если его заполнили, иначе тот хост, что отдал эту страницу. */
function base(typed = el<HTMLInputElement>('a-server').value): string | null {
  const step = resolveBase(typed.trim() || location.origin, location.protocol === 'https:');
  return step.kind === 'ok' ? step.base.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:') : null;
}

function say(key: string, vars?: Record<string, string | number>): void {
  el('a-status').textContent = t(key, vars);
}

/** Запрос с сессией. `null` — до сервера не дошли (это НЕ то же, что отказ). */
async function call(
  path: string,
  init: RequestInit = {},
  server = base(),
): Promise<{ status: number; body: unknown } | null> {
  if (!server) return null;
  // The field may change while a request or the refresh timer is pending. A bearer
  // belongs only to its issuing server, never to the current contents of the field.
  if (session && session.base !== server) {
    signOut();
    return null;
  }
  try {
    const res = await fetch(`${server}${path}`, {
      ...init,
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(session ? { authorization: `Bearer ${session.token}` } : {}),
      },
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return null;
  }
}

/** Вход: сессия, затем подтверждение полномочия (правило 1). */
async function signIn(): Promise<void> {
  signOut();
  const generation = authGeneration;
  const server = base();
  if (!server) return say('admin.err.server');
  const login = el<HTMLInputElement>('a-login').value.trim();
  const password = el<HTMLInputElement>('a-pass').value;
  el<HTMLInputElement>('a-pass').value = '';
  say('admin.signing');
  const auth = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login, password }),
  }, server);
  if (generation !== authGeneration || server !== base()) return;
  if (!auth) return say('admin.err.server');
  if (auth.status !== 200) return say('admin.err.creds');
  const token = (auth.body as { token?: unknown } | null)?.token;
  if (typeof token !== 'string' || !token) return say('admin.err.creds');
  session = { base: server, token };
  await confirmAuthority();
}

/** Подтвердить полномочие и открыть пульт — или честно сказать, что прав нет.
 *  Позывной берётся из ОТВЕТА, а не из поля ввода: после перезагрузки страницы поле
 *  пустое, а сессия жива, и «вы вошли как » без имени выглядело бы поломкой. */
async function confirmAuthority(): Promise<void> {
  const checking = session;
  if (!checking) return;
  const who = await call('/admin/whoami');
  if (session !== checking || base() !== checking.base) return;
  if (!who) return say('admin.err.server');
  if (who.status !== 200) {
    // 403 «не администратор» и 404 «администраторов на хосте нет вовсе» — для
    // вошедшего человека это одно и то же: командовать он не может.
    signOut();
    return say('admin.err.no-authority');
  }
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(checking));
  el('a-gate').style.display = 'none';
  el('a-panel').style.display = 'block';
  el('a-who').textContent = t('admin.who', {
    login: (who.body as { login?: string } | null)?.login ?? '',
  });
  say('admin.ready');
  await loadMatches();
  await loadNews();
  if (session !== checking) return; // пока читались списки, сессию сняли или сменили сервер
  if (timer === null)
    timer = setInterval(() => detach('пульт: обновление состава', loadRoster()), REFRESH_MS);
}

function signOut(): void {
  session = null;
  authGeneration++;
  sessionStorage.removeItem(SESSION_KEY);
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  el('a-panel').style.display = 'none';
  el('a-gate').style.display = 'block';
  say('admin.signed-out');
}

/** Список партий — тот же публичный `GET /matches`, что у игрока. */
async function loadMatches(): Promise<void> {
  const res = await call('/matches');
  const select = el<HTMLSelectElement>('a-match');
  const previous = select.value;
  select.textContent = '';
  const lists = (res?.body ?? {}) as MatchLists;
  const ids = [
    ...new Set(
      [...(lists.available ?? []), ...(lists.active ?? []), ...(lists.archived ?? [])].map(
        (m) => m.matchId,
      ),
    ),
  ];
  for (const id of ids) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id;
    select.append(option);
  }
  if (ids.length === 0) {
    say('admin.match.none');
    el('a-roster').textContent = '';
    return;
  }
  select.value = ids.includes(previous) ? previous : (ids[0] ?? '');
  await loadRoster();
}

/** Что показывать в колонке «состояние» у одного кресла. */
function seatState(seat: SeatRow): string {
  if (!seat.nick) return t('admin.state.free');
  if (!seat.seated) return t('admin.state.claimed');
  return t(seat.connected ? 'admin.state.online' : 'admin.state.offline');
}

async function loadRoster(): Promise<void> {
  const matchId = el<HTMLSelectElement>('a-match').value;
  if (!matchId) return;
  const res = await call(`/admin/matches/${encodeURIComponent(matchId)}/roster`);
  if (!res) return say('admin.err.server');
  if (res.status === 404) return say('admin.err.no-match');
  if (res.status !== 200) return say('admin.err.no-authority');
  render(res.body as Roster);
}

function render(roster: Roster): void {
  el('a-meta').textContent = [
    t('admin.day', { n: roster.day }),
    t(roster.ended ? 'admin.ended' : roster.entryOpen ? 'admin.entry.open' : 'admin.entry.closed'),
  ].join(' · ');

  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const key of ['admin.col.seat', 'admin.col.player', 'admin.col.state', 'admin.col.act']) {
    const th = document.createElement('th');
    th.textContent = t(key);
    head.append(th);
  }
  table.append(head);

  for (const seat of roster.seats) {
    const tr = document.createElement('tr');
    const cell = (text: string): HTMLTableCellElement => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
      return td;
    };
    cell(`${seat.name} · ${seat.faction}`);
    cell(seat.nick ?? '—');
    cell(seatState(seat));
    const act = cell('');
    if (seat.nick) {
      const button = document.createElement('button');
      button.className = 'kick';
      button.textContent = t('admin.kick');
      const nick = seat.nick;
      button.onclick = () => detach('пульт: исключение игрока', kick(roster.matchId, nick));
      act.append(button);
    }
    table.append(tr);
  }
  const host = el('a-roster');
  host.textContent = '';
  host.append(table);
}

async function kick(matchId: string, nick: string): Promise<void> {
  if (!confirm(t('admin.kick.confirm', { nick }))) return;
  const res = await call(`/admin/matches/${encodeURIComponent(matchId)}/kick`, {
    method: 'POST',
    body: JSON.stringify({ nick }),
  });
  if (!res) return say('admin.err.server');
  if (res.status === 409) {
    if ((res.body as { error?: unknown } | null)?.error === 'E_BOT_SEAT_LOCKED')
      say('admin.err.bot-seat-locked');
    else say('admin.err.not-seated');
  } else if (res.status === 404) {
    say('admin.err.no-match');
  } else if (res.status !== 200) {
    say('admin.err.no-authority');
  } else {
    const seat = (res.body as { playerId?: string } | null)?.playerId ?? '';
    say('admin.kick.done', { nick, seat });
  }
  // Правило 3: состав перечитывается ВСЕГДА, даже после отказа — именно расхождение
  // с сервером и было причиной отказа.
  await loadRoster();
}

// --- объявления ленты (CORP-2) ---------------------------------------------------------

const stamp = (at: number): string =>
  new Date(at).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' });

/** Объявления — свежие сверху, истёкшие тоже: их видно, пока их не сняли. */
async function loadNews(): Promise<void> {
  const res = await call('/admin/news');
  if (!res) return say('admin.err.server');
  // Нет маршрута или полномочия — списка нет; о полномочии уже сказал вход.
  if (res.status !== 200) {
    el('a-news-list').textContent = '';
    return;
  }
  const raw = (res.body as { announcements?: unknown } | null)?.announcements;
  renderNews(Array.isArray(raw) ? raw.flatMap((a) => parseNewsAnnouncement(a) ?? []) : []);
}

function renderNews(list: readonly NewsAnnouncement[]): void {
  const host = el('a-news-list');
  host.textContent = '';
  if (list.length === 0) {
    host.textContent = t('admin.news.none');
    return;
  }
  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const key of ['admin.news.col.at', 'admin.news.col.title', 'admin.news.until', 'admin.col.act']) {
    const th = document.createElement('th');
    th.textContent = t(key);
    head.append(th);
  }
  table.append(head);
  const now = Date.now();
  for (const a of list) {
    const tr = document.createElement('tr');
    const cell = (text: string): HTMLTableCellElement => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
      return td;
    };
    cell(stamp(a.at));
    cell([t(NEWS_KIND_LABEL[a.kind]), ...(a.pinned ? [t('news.pinned')] : []), a.title.ru].join(' · '));
    cell(a.until === null ? t('admin.news.forever') : a.until <= now ? t('admin.news.expired') : stamp(a.until));
    const button = document.createElement('button');
    button.className = 'kick';
    button.textContent = t('admin.news.remove');
    button.onclick = () => detach('пульт: снятие объявления', removeNews(a));
    cell('').append(button);
    table.append(tr);
  }
  host.append(table);
}

/** Опубликовать объявление из формы. Срок вводят по часам этого компьютера — по ним и
 *  считается момент; прошедший срок сервер не примет, поэтому он ловится здесь. */
async function publishNews(): Promise<void> {
  const value = (id: string): string => el<HTMLInputElement>(id).value.trim();
  const titleRu = value('a-news-title-ru');
  if (!titleRu) return say('admin.news.need-title');
  const untilText = value('a-news-until');
  const until = untilText ? new Date(untilText).getTime() : null;
  if (until !== null && !(until > Date.now())) return say('admin.news.bad-until');
  const typed = el<HTMLSelectElement>('a-news-kind').value;
  const res = await call('/admin/news', {
    method: 'POST',
    body: JSON.stringify({
      kind: NEWS_ANNOUNCEMENT_KINDS.find((k) => k === typed) ?? 'tech',
      pinned: el<HTMLInputElement>('a-news-pin').checked,
      until,
      title: { ru: titleRu, en: value('a-news-title-en') },
      body: { ru: value('a-news-body-ru'), en: value('a-news-body-en') },
    }),
  });
  if (!res) return say('admin.err.server');
  if (res.status === 400) return say('admin.news.bad');
  if (res.status !== 201) return say('admin.err.no-authority');
  for (const id of ['a-news-title-ru', 'a-news-title-en', 'a-news-body-ru', 'a-news-body-en', 'a-news-until'])
    el<HTMLInputElement>(id).value = '';
  el<HTMLInputElement>('a-news-pin').checked = false;
  say('admin.news.published');
  await loadNews();
}

async function removeNews(a: NewsAnnouncement): Promise<void> {
  if (!confirm(t('admin.news.remove.confirm', { title: a.title.ru }))) return;
  const res = await call(`/admin/news/${encodeURIComponent(a.id)}/remove`, { method: 'POST' });
  if (!res) return say('admin.err.server');
  if (res.status === 404) say('admin.news.gone');
  else if (res.status !== 200) say('admin.err.no-authority');
  else say('admin.news.removed');
  await loadNews();
}

localizeStaticDom();
// Вход висит на ОТПРАВКЕ формы, а не на клике по кнопке: так работает и Enter в поле
// пароля, и менеджер паролей, который сам заполняет пару и жмёт отправку.
el<HTMLFormElement>('a-gate').onsubmit = (e: Event): void => {
  e.preventDefault();
  detach('пульт: вход', signIn());
};
el('a-signout').onclick = () => signOut();
el('a-refresh').onclick = () => {
  detach('пульт: список матчей', loadMatches());
  detach('пульт: объявления', loadNews());
};
el<HTMLFormElement>('a-news-form').onsubmit = (e: Event): void => {
  e.preventDefault();
  detach('пульт: публикация объявления', publishNews());
};
el<HTMLSelectElement>('a-match').onchange = () => detach('пульт: состав матча', loadRoster());

// Перезагрузка страницы не должна означать повторный вход (правило 2).
const saved = sessionStorage.getItem(SESSION_KEY);
if (saved) {
  try {
    const parsed = JSON.parse(saved) as Partial<AdminSession> | null;
    if (typeof parsed?.base === 'string' && base(parsed.base) === parsed.base &&
        typeof parsed.token === 'string' && parsed.token) {
      session = { base: parsed.base, token: parsed.token };
      el<HTMLInputElement>('a-server').value = parsed.base;
      detach('пульт: проверка сохранённого доступа', confirmAuthority());
    } else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Old tokens carried no server binding. Require a fresh sign-in rather than
    // sending one to whichever origin happens to host the admin page now.
    sessionStorage.removeItem(SESSION_KEY);
  }
}
