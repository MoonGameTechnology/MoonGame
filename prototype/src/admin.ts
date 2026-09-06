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
 */
import { t, localizeStaticDom } from '../../localization/runtime';

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

let token: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** Адрес сервера: поле, если его заполнили, иначе тот хост, что отдал эту страницу. */
function base(): string {
  const typed = el<HTMLInputElement>('a-server').value.trim();
  return (typed || location.origin).replace(/\/+$/, '');
}

function say(key: string, vars?: Record<string, string | number>): void {
  el('a-status').textContent = t(key, vars);
}

/** Запрос с сессией. `null` — до сервера не дошли (это НЕ то же, что отказ). */
async function call(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetch(`${base()}${path}`, {
      ...init,
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return null;
  }
}

/** Вход: сессия, затем подтверждение полномочия (правило 1). */
async function signIn(): Promise<void> {
  const login = el<HTMLInputElement>('a-login').value.trim();
  const password = el<HTMLInputElement>('a-pass').value;
  say('admin.signing');
  const auth = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login, password }),
  });
  if (!auth) return say('admin.err.server');
  if (auth.status !== 200) return say('admin.err.creds');
  token = (auth.body as { token?: string } | null)?.token ?? null;
  if (!token) return say('admin.err.creds');
  await confirmAuthority();
}

/** Подтвердить полномочие и открыть пульт — или честно сказать, что прав нет.
 *  Позывной берётся из ОТВЕТА, а не из поля ввода: после перезагрузки страницы поле
 *  пустое, а сессия жива, и «вы вошли как » без имени выглядело бы поломкой. */
async function confirmAuthority(): Promise<void> {
  const who = await call('/admin/whoami');
  if (!who) return say('admin.err.server');
  if (who.status !== 200) {
    // 403 «не администратор» и 404 «администраторов на хосте нет вовсе» — для
    // вошедшего человека это одно и то же: командовать он не может.
    token = null;
    sessionStorage.removeItem(SESSION_KEY);
    return say('admin.err.no-authority');
  }
  sessionStorage.setItem(SESSION_KEY, token ?? '');
  el('a-gate').style.display = 'none';
  el('a-panel').style.display = 'block';
  el('a-who').textContent = t('admin.who', {
    login: (who.body as { login?: string } | null)?.login ?? '',
  });
  say('admin.ready');
  await loadMatches();
  if (timer === null) timer = setInterval(() => void loadRoster(), REFRESH_MS);
}

function signOut(): void {
  token = null;
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
      button.onclick = () => void kick(roster.matchId, nick);
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
    say('admin.err.not-seated');
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

localizeStaticDom();
// Вход висит на ОТПРАВКЕ формы, а не на клике по кнопке: так работает и Enter в поле
// пароля, и менеджер паролей, который сам заполняет пару и жмёт отправку.
el<HTMLFormElement>('a-gate').onsubmit = (e: Event): void => {
  e.preventDefault();
  void signIn();
};
el('a-signout').onclick = () => signOut();
el('a-refresh').onclick = () => void loadMatches();
el<HTMLSelectElement>('a-match').onchange = () => void loadRoster();

// Перезагрузка страницы не должна означать повторный вход (правило 2).
const saved = sessionStorage.getItem(SESSION_KEY);
if (saved) {
  token = saved;
  void confirmAuthority();
}
