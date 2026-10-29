/**
 * FRIENDS-1 — вкладка «Друзья» в хабе: список, входящие заявки, поиск по позывному.
 *
 * Тот же раздел труда, что у всех REFM-экранов: разметка ЧИСТАЯ и проверяется тестом
 * (`friendsPanelHtml`, `sortRows`, `presenceText`), а хоста трогает только
 * `initFriends(host)` через явные хуки — без модульного состояния `main.ts`.
 *
 * Правила живут на СЕРВЕРЕ (`friendService.ts`): кого можно позвать, кто может
 * принять, сколько друзей влезает. Здесь их копии нет и быть не должно — экран
 * показывает то, что прислали, и отправляет намерение. Ровно поэтому у кнопок нет
 * своих предикатов: «Принять» стоит там, где сервер сказал `incoming`.
 *
 * Присутствие приходит с сервера уже решённым (`kind`), потому что «в матче» знает
 * только живой сервер. Клиент лишь превращает его в слово — и в этом переводе есть
 * одно честное «не знаю»: `unknown` (сервер перезапускался и метки не помнит) — это
 * НЕ «офлайн», и говорить «был(а) давно» здесь было бы выдумкой.
 *
 * FRIENDS-2 — «Войти к другу», «Позвать» и «Скрывать мои партии». Номер партии друга
 * приходит в присутствии `match` только тогда, когда друг его не скрыл: прячет СЕРВЕР, а
 * экран просто не получает, что прятать. «Войти» ведёт обычной дверью входа по номеру
 * (`joinMatch`), со всеми проверками сервера; «Позвать» — в свою идущую партию
 * (`decisions/friendInvite.ts`), и сервер ещё раз проверит, что место в ней у вас есть.
 */
import { t } from '../../localization/runtime';
import { esc } from './format';
import { detach } from './detach';
import { inviteStep } from '../../decisions/friendInvite';
import { matchNumberText } from '../../decisions/matchNumber';

/** Присутствие ровно в тех формах, которые сервер умеет доказать. */
export interface FriendPresence {
  kind: 'match' | 'online' | 'seen' | 'unknown';
  /** Игровой день матча (только `match`). */
  day?: number;
  /** Сколько миллисекунд назад видели (только `seen`). */
  agoMs?: number;
  /** Партия друга (только `match`, и только если он её не скрыл) — куда ведёт «Войти». */
  matchId?: string;
}

/** Приглашение в партию, пришедшее от друга (FRIENDS-2). */
export interface FriendInvite {
  fromId: string;
  fromLogin: string;
  matchId: string;
}

/** Своя идущая партия, в которую можно позвать: номер и подпись для выбора. */
export interface InviteMatch {
  matchId: string;
  label: string;
}

/** Выбор партии для приглашения: кого зовём и куда можно. */
export interface InvitePick {
  accountId: string;
  matches: readonly InviteMatch[];
}

export interface FriendRow {
  accountId: string;
  login: string;
  kind: 'friend' | 'incoming' | 'outgoing';
  presence: FriendPresence;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Цвет-точка статуса: в матче — янтарь, онлайн — свой цвет, остальное — серо. */
const DOT: Record<FriendPresence['kind'], string> = {
  match: 'am',
  online: 'on',
  seen: 'off',
  unknown: 'off',
};

/** «В матче · день 2» / «онлайн» / «был(а) 3 ч назад» / «нет данных». */
export function presenceText(p: FriendPresence): string {
  if (p.kind === 'match') return t('friends.presence.match', { n: p.day ?? 1 });
  if (p.kind === 'online') return t('friends.presence.online');
  if (p.kind === 'unknown') return t('friends.presence.unknown');
  const ago = p.agoMs ?? 0;
  if (ago >= DAY) return t('friends.presence.seen-days', { n: Math.floor(ago / DAY) });
  if (ago >= HOUR) return t('friends.presence.seen-hours', { n: Math.floor(ago / HOUR) });
  return t('friends.presence.seen-min', { n: Math.max(1, Math.floor(ago / 60_000)) });
}

/**
 * Порядок списка: входящие заявки — ВВЕРХ (они требуют действия), дальше друзья по
 * «живости» (в матче → онлайн → давно), и только потом свои исходящие. Сортировка
 * отделена от разметки, потому что это и есть решение экрана: что игрок увидит
 * первым, когда список не влезет.
 */
const GROUP: Record<FriendRow['kind'], number> = { incoming: 0, friend: 1, outgoing: 2 };
const LIVE: Record<FriendPresence['kind'], number> = { match: 0, online: 1, seen: 2, unknown: 3 };

export function sortRows(rows: readonly FriendRow[]): FriendRow[] {
  return [...rows].sort(
    (a, b) =>
      GROUP[a.kind] - GROUP[b.kind] ||
      LIVE[a.presence.kind] - LIVE[b.presence.kind] ||
      (a.login < b.login ? -1 : a.login > b.login ? 1 : 0),
  );
}

/** Одна строка списка. Кнопки — только те, что имеют смысл для этого вида ребра. */
function rowHtml(r: FriendRow, pick: InvitePick | null): string {
  const id = esc(r.accountId);
  const join =
    r.kind === 'friend' && r.presence.kind === 'match' && r.presence.matchId
      ? `<button class="fr-b ok" data-fr-act="join" data-fr-match="${esc(r.presence.matchId)}">${t('friends.act.join')}</button>`
      : '';
  const invite =
    r.kind === 'friend'
      ? `<button class="fr-b" data-fr-act="invite" data-fr-id="${id}">${t('friends.act.invite')}</button>`
      : '';
  const acts =
    r.kind === 'incoming'
      ? `<button class="fr-b ok" data-fr-act="accept" data-fr-id="${esc(r.accountId)}">${t('friends.act.accept')}</button>` +
        `<button class="fr-b" data-fr-act="drop" data-fr-id="${esc(r.accountId)}">${t('friends.act.decline')}</button>`
      : r.kind === 'outgoing'
        ? `<span class="fr-wait">${t('friends.sent')}</span>` +
          `<button class="fr-b btn-x" data-fr-act="drop" data-fr-id="${esc(r.accountId)}" title="${t('friends.act.cancel')}">✕</button>`
        : join +
          invite +
          `<button class="fr-b btn-x" data-fr-act="drop" data-fr-id="${esc(r.accountId)}" title="${t('friends.act.remove')}">✕</button>`;
  // Присутствие видно только у друзей: сервер не говорит, где играет тот, кто ещё не
  // принял заявку, поэтому у исходящей строки подписи нет — «заявка отправлена» уже рядом.
  const sub =
    r.kind === 'incoming'
      ? t('friends.incoming')
      : r.kind === 'outgoing'
        ? ''
        : presenceText(r.presence);
  const picker =
    pick && pick.accountId === r.accountId
      ? `<div class="fr-pick"><span>${t('friends.invite.pick', { who: esc(r.login) })}</span>` +
        pick.matches
          .map(
            (m) =>
              `<button class="fr-b" data-fr-act="invite-to" data-fr-id="${id}" data-fr-match="${esc(m.matchId)}">${esc(m.label)}</button>`,
          )
          .join('') +
        `</div>`
      : '';
  return (
    `<div class="fr-row${r.kind === 'incoming' ? ' req' : ''}">` +
    `<i class="fr-dot ${r.kind === 'incoming' ? 'am' : DOT[r.presence.kind]}"></i>` +
    `<button type="button" class="fr-txt pf-player-link" data-profile="${esc(r.login)}"><b>${esc(r.login)}</b><span>${sub}</span></button>` +
    `<span class="fr-acts">${acts}</span>` +
    `</div>` +
    picker
  );
}

/** Приглашение от друга: кто, в какую партию, «Войти» и «✕». */
function inviteHtml(i: FriendInvite): string {
  return (
    `<div class="fr-row req">` +
    `<i class="fr-dot am"></i>` +
    `<span class="fr-txt"><b>${esc(i.fromLogin)}</b><span>${t('friends.invite.from', { n: esc(matchNumberText(i.matchId)) })}</span></span>` +
    `<span class="fr-acts">` +
    `<button class="fr-b ok" data-fr-act="join" data-fr-match="${esc(i.matchId)}">${t('friends.act.join')}</button>` +
    `<button class="fr-b btn-x" data-fr-act="dismiss" data-fr-id="${esc(i.fromId)}" title="${t('friends.act.dismiss')}">✕</button>` +
    `</span></div>`
  );
}

/** «Скрывать мои партии от друзей» — настройка аккаунта, её хранит сервер. */
function privacyHtml(hide: boolean): string {
  return (
    `<label class="fr-priv"><input type="checkbox" id="fr-hide"${hide ? ' checked' : ''}>` +
    `<span><b>${t('friends.privacy.hide')}</b><span>${t('friends.privacy.hide.hint')}</span></span></label>`
  );
}

/**
 * Тело вкладки. `signedIn === false` — не «пустой список», а другое состояние:
 * друзья живут на аккаунте, поэтому гостю показывается причина, а не пустота,
 * которую он не сможет наполнить.
 */
export function friendsPanelHtml(
  rows: readonly FriendRow[],
  opts: {
    signedIn: boolean;
    note?: string;
    invites?: readonly FriendInvite[];
    hideMatches?: boolean;
    pick?: InvitePick | null;
  } = { signedIn: true },
): string {
  if (!opts.signedIn) {
    return (
      `<div class="hub-empty"><span class="he-ic">☍</span>${t('friends.guest.title')}<br>` +
      `<span style="font-size:var(--fs-caption);color:var(--dim)">${t('friends.guest.sub')}</span></div>`
    );
  }
  const search =
    `<form class="fr-find" id="fr-find">` +
    `<input id="fr-q" class="fr-q" maxlength="24" autocomplete="off" placeholder="${t('friends.search.ph')}">` +
    `<button class="fr-b ok" type="submit">${t('friends.act.add')}</button>` +
    `</form>`;
  const note = opts.note ? `<div class="fr-note">${esc(opts.note)}</div>` : '';
  const pick = opts.pick ?? null;
  const invites = (opts.invites ?? []).map(inviteHtml).join('');
  const list = rows.length
    ? sortRows(rows)
        .map((r) => rowHtml(r, pick))
        .join('')
    : `<div class="hub-empty"><span class="he-ic">☍</span>${t('friends.empty.title')}<br>` +
      `<span style="font-size:var(--fs-caption);color:var(--dim)">${t('friends.empty.sub')}</span></div>`;
  return (
    search +
    note +
    `<div class="fr-list">${invites}${list}</div>` +
    privacyHtml(opts.hideMatches ?? false)
  );
}

/** Что вкладке нужно от хаба. */
export interface FriendsHost {
  openPlayer?(login: string): void;
  /** Панель вкладки (`#hp-friends`) — она же делегат кликов. */
  root(): HTMLElement;
  /** База + токен сессии, или `null` — гость (друзья привязаны к аккаунту). */
  authorizedBase(): Promise<{ base: string; token: string } | null>;
  /** Свои идущие партии — куда можно позвать друга (FRIENDS-2). */
  myMatches?(): readonly InviteMatch[];
  /** Войти в партию по номеру — той же дверью, что поле «Номер партии». */
  joinMatch?(matchId: string): void;
}

/** Человекочитаемая причина отказа сервера — по СТАБИЛЬНОМУ коду, а не по тексту. */
function failText(code: string): string {
  switch (code) {
    case 'E_NO_ACCOUNT':
      return t('friends.err.no-account');
    case 'E_SELF':
      return t('friends.err.self');
    case 'E_EXISTS':
      return t('friends.err.exists');
    case 'E_LIMIT':
      return t('friends.err.limit');
    case 'E_RATE_LIMITED':
      return t('friends.err.too-fast');
    case 'E_NOT_SEATED':
      return t('friends.err.not-seated');
    default:
      return t('friends.err.generic');
  }
}

export function initFriends(host: FriendsHost): { refresh: () => Promise<void> } {
  let rows: FriendRow[] = [];
  let invites: FriendInvite[] = [];
  let hideMatches = false;
  let pick: InvitePick | null = null;
  let note = '';
  let signedIn = true;

  function paint(): void {
    host.root().innerHTML = friendsPanelHtml(rows, { signedIn, note, invites, hideMatches, pick });
  }

  /** Одно место, где экран говорит с сервером. Любой сбой — тихий: список остаётся
   *  прежним, потому что «не дозвонились» это не «друзей не стало». */
  async function call(path: string, body?: unknown): Promise<string | null> {
    const auth = await host.authorizedBase();
    if (!auth) {
      signedIn = false;
      return 'E_GUEST';
    }
    signedIn = true;
    try {
      const res = await fetch(`${auth.base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${auth.token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const parsed = (await res.json().catch(() => null)) as {
        rows?: unknown;
        invites?: unknown;
        hideMatches?: unknown;
        error?: unknown;
      } | null;
      if (!res.ok) return typeof parsed?.error === 'string' ? parsed.error : 'E_HTTP';
      if (Array.isArray(parsed?.rows)) rows = parsed.rows as FriendRow[];
      if (Array.isArray(parsed?.invites)) invites = parsed.invites as FriendInvite[];
      if (typeof parsed?.hideMatches === 'boolean') hideMatches = parsed.hideMatches;
      return null;
    } catch {
      return 'E_OFFLINE';
    }
  }

  async function refresh(): Promise<void> {
    const err = await call('/friends');
    if (err === 'E_GUEST') rows = [];
    paint();
  }

  host.root().addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = host.root().querySelector('#fr-q') as HTMLInputElement | null;
    const callsign = input?.value.trim() ?? '';
    if (!callsign) return;
    detach(
      'друзья: заявка в друзья',
      (async () => {
        const err = await call('/friends/request', { callsign });
        note = err ? failText(err) : t('friends.sent.ok', { who: callsign });
        if (!err) await call('/friends');
        paint();
      })(),
    );
  });

  /** Отправить приглашение: ответ сервера — в строку заметки. */
  function sendInvite(accountId: string, matchId: string): void {
    pick = null;
    const who = rows.find((r) => r.accountId === accountId)?.login ?? '';
    detach(
      'друзья: приглашение в партию',
      (async () => {
        const err = await call(`/friends/${encodeURIComponent(accountId)}/invite`, { matchId });
        note = err ? failText(err) : t('friends.invite.sent', { who });
        paint();
      })(),
    );
  }

  host.root().addEventListener('change', (ev) => {
    const box = ev.target as HTMLInputElement;
    if (box.id !== 'fr-hide') return;
    const hide = box.checked;
    detach(
      'друзья: скрывать мои партии',
      (async () => {
        const err = await call('/friends/privacy', { hideMatches: hide });
        if (err) note = failText(err);
        else hideMatches = hide;
        paint(); // при отказе галочка вернётся к тому, что знает сервер
      })(),
    );
  });

  host.root().addEventListener('click', (ev) => {
    const player = (ev.target as HTMLElement).closest('[data-profile]') as HTMLElement | null;
    if (player?.dataset.profile) { host.openPlayer?.(player.dataset.profile); return; }
    const btn = (ev.target as HTMLElement).closest('[data-fr-act]') as HTMLElement | null;
    if (!btn) return;
    const id = btn.dataset.frId;
    const act = btn.dataset.frAct;
    const matchId = btn.dataset.frMatch;
    if (act === 'join' && matchId) {
      host.joinMatch?.(matchId);
      return;
    }
    if (act === 'invite' && id) {
      const step = inviteStep(host.myMatches?.() ?? []);
      if (step.kind === 'send') sendInvite(id, step.match.matchId);
      else {
        note = step.kind === 'none' ? t('friends.invite.none') : '';
        pick = step.kind === 'pick' && pick?.accountId !== id ? { accountId: id, matches: step.matches } : null;
        paint();
      }
      return;
    }
    if (act === 'invite-to' && id && matchId) {
      sendInvite(id, matchId);
      return;
    }
    if (act === 'dismiss' && id) {
      invites = invites.filter((i) => i.fromId !== id);
      paint();
      detach(
        'друзья: отклонить приглашение',
        call(`/friends/invites/${encodeURIComponent(id)}/dismiss`, {}).then(() => undefined),
      );
      return;
    }
    if (!id || (act !== 'accept' && act !== 'drop')) return;
    detach(
      'друзья: ответ на заявку',
      (async () => {
        const err = await call(`/friends/${encodeURIComponent(id)}/${act}`, {});
        note = err ? failText(err) : '';
        await call('/friends'); // перечитываем список целиком: сервер — источник правды
        paint();
      })(),
    );
  });

  return { refresh };
}
