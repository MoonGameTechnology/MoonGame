/**
 * Обозреватель партий и «Мои партии» хаба — у одного владельца (REFM-217, второй PR).
 * Обозреватель отвечает на «куда пойти играть»: три вкладки ленты сервера
 * (`GET /matches`), фильтр «Доступных», архив и строки с «Войти». «Мои партии» на
 * главном экране хаба отвечают на «где я уже играю» и читают ту же ленту.
 *
 * Лента, открытая вкладка и выбор фильтра — состояние модуля, снаружи его не видно.
 * Переспрашивают ленту двери {@link refreshMatches} (вход в обозреватель) и
 * {@link refreshMyMatches} (заход домой в хаб); заход в партию со строки ведёт в
 * `matchJoin.ts`. Заранее, пока открыто приветствие, список не тянут.
 *
 * Строку статуса экрана подключения, адрес сервера и хаб модуль получает хуком
 * {@link initMatchBrowser}: они принадлежат `main.ts`, а импорт оттуда был бы циклом.
 * Позывного и пароля на странице нет (UIX-17.1): их поля — спрятанные носители состояния,
 * значения приходят со входа и читаются через `resolveServer`. Поле адреса стоит в
 * карточке «Сервер не отвечает» и видно только при сбое (`browserFallback.ts`, правило 4).
 */
import { splitCorporateMatches, type MatchPageTab } from '../../decisions/corporateMatches';
import { matchNumberButton } from './matchNumberButton';
import { LOCALE, t, tData } from '../../localization/runtime';
import { isAvaMatchId } from '../../packages/protocol/src/ava';
import { fallbackFor, showServerRow, type Fallback } from '../../decisions/browserFallback';
import { matchNumberText, parseMatchNumber } from '../../decisions/matchNumber';
import { filterControls, seatPips, tabCounts, type FilterControls } from '../../decisions/matchesPage';
import { pollLine, pollTick, type PollPhase } from '../../decisions/matchPoll';
import { archiveUrl, matchesUrl, queryOutcome } from '../../decisions/matchQuery';
import { HUB_MY_MATCHES, myMatches } from '../../decisions/myMatches';
import { tokenFor } from '../../decisions/sessionStore';
import { probeAuthMode } from './accountSession';
import { archiveEffect, type ArchiveEffect } from './archiveOutcome';
import { detach } from './detach';
import { getPlatform } from './platform/host';
import { esc } from './format';
import {
  clampFilter,
  mapsOf,
  matchesFilter,
  playerBounds,
  restoreFilter,
  serializeFilter,
  FILTER_STORE_KEY,
  type FilterState,
} from './matchFilter';
import { openSessionTab } from './matchJoin';
import { inviteMatches } from '../../decisions/friendInvite';
import type { InviteMatch } from './friendsScreen';
import { isMatchDescriptionOpen, openMatchDescription, type DescriptionAction } from './matchDescription';
import { cardFacts, type CardPlace } from '../../decisions/matchCard';
import { fmtJoinWindow, joinWindow, rowAction, type MatchRules, type MatchTab } from './matchRow';
import { openSetup } from './setupScreen';
import { canCreateOnlineMatch, forgetMatchCreation, initMatchCreation, refreshMatchCreation } from './matchCreation';

/** Что обозревателю нужно от игры. Живёт в `main.ts`. */
export interface MatchBrowserHost {
  /** Адрес сервера и позывной; `null` — строка статуса уже сказала, чего не хватает. */
  resolveServer(): { base: string; nick: string } | null;
  /** Строка статуса экрана подключения. */
  status(text: string): void;
  /** Что в ней сейчас: «сервер не ответил» обозреватель читает отсюда. */
  statusText(): string;
  /** Открыт ли экран подключения: фоновый переопрос тикает только под ним. */
  connectShown(): boolean;
  /** Строка под хабом: удача или беда копирования адреса партии. */
  hubNote(text: string): void;
  /** Вкладка хаба: пустые «Мои партии» и «ещё N» ведут на `games`, в обозреватель. */
  hubTab(tab: string): void;
  /** Подпись карты в строке партии. */
  mapLabel(mapId: string | undefined): string;
  /** Уйти из текущего матча перед одиночной партией. */
  leaveMatch(): void;
}

let game: MatchBrowserHost;
const $ = (id: string) => document.getElementById(id) as HTMLElement;
/** Имя партии в строке. Битву корпораций называет её номер: с CORP-8 её играют на обычных
 *  картах, и имя карты битву больше не выдаёт. */
const matchName = (m: Pick<MatchRow, 'matchId' | 'mapId'>): string =>
  isAvaMatchId(m.matchId) ? t('map.ava') : game.mapLabel(m.mapId);
let srvInput: HTMLInputElement;

export interface MatchRow {
  matchId: string;
  mapId: string;
  rules: MatchRules;
  days: number;
  players: { seated: number; capacity: number };
  status: string;
  archiveExpiresAt?: number;
  /** Entry window (SES-2.3/2.4): can a NEW player still take a free seat here, and how
   *  long is left. Absent on an older server ⇒ treat as always open. */
  entryOpen?: boolean;
  entryClosesInMs?: number;
  /** Game mode (BRW-1): the preset id the session runs, and whether the server judged
   *  it PvP or PvE. Either may be absent; what the card says about them is decided in
   *  `decisions/matchCard.ts`. */
  modeId?: string;
  kind?: 'pvp' | 'pve';
}

let matchLists: Record<MatchTab, MatchRow[]> | null = null;
/** Прошлый запрос ленты кончился неудачей. Отдельно от строки статуса: её гасит карточка
 *  «Сервер не отвечает» (`browserFallback.ts`, правило 5), а признак беды должен пережить
 *  переключение вкладок — иначе карточка с адресом пропала бы посреди набора. */
let loadFailed = false;
let listShown = false;
let activeTab: MatchPageTab = 'available';
/** Выбор фильтров (BRW-3). Живёт в модуле, поэтому тихий переопрос раз в десять секунд
 *  его не сбрасывает — перерисовка читает то же состояние. Между заходами он лежит в
 *  `localStorage` рядом с `void.server`/`void.nick`; `null` — ещё не восстанавливали. */
let matchFilter: FilterState | null = null;
/** Таймер тихого переопроса заведён (`startPoll`). */
let pollStarted = false;

export async function refreshMatches(quiet = false): Promise<void> {
  startPoll();
  const srv = game.resolveServer();
  if (!srv) { forgetMatchCreation(); return; }
  const permission = refreshMatchCreation();
  // Что переопрос пишет в строку статуса — `matchPoll.ts` (REFM-153): тихий фоновый
  // не мигает «загрузкой» над уже показанным списком, но о беде молчать не имеет
  // права — эту строку читает `renderMatches` как признак «сервер не ответил».
  const line = (phase: PollPhase): void => {
    const upd = pollLine(phase, quiet);
    if (upd.kind === 'clear') game.status('');
    else if (upd.kind === 'text') game.status(t(upd.key));
  };
  line('start');
  line((await loadMatchLists(srv)) ? 'loaded' : 'failed');
  await permission;
  if (!isMatchDescriptionOpen()) renderMatches();
}

/**
 * Забрать ленту матчей в `matchLists`. Возвращает, удалось ли.
 *
 * Отдельно от `refreshMatches`, потому что СТРОКА СТАТУСА тут ни при чём: её пишет
 * обозреватель, и писать в неё, когда игрок смотрит на хаб, нельзя — это ровно тот
 * вред, от которого предостерегает правило 1 `matchPoll.ts` (фоновая неудача штампует
 * «сервер недоступен» поверх экрана, где про сервер не спрашивали). Хабу нужна лента,
 * а не строка, поэтому он зовёт эту половину (ADDR-4).
 */
async function loadMatchLists(srv: { base: string; nick: string }): Promise<boolean> {
  // Identity mode first (SES-2.5): accounts servers get the password row shown
  // BEFORE the player clicks «Войти» on a row — no surprise prompt mid-join.
  await probeAuthMode(srv.base);
  try {
    // Личность — тем же способом, что и у запроса мест (`fetchSeats`, `matchJoin.ts`): на хосте с
    // учётками это сессионный JWT в заголовке, `?nick=` там не смотрят. Без него сервер
    // видел анонима, вкладка «мои матчи» приходила пустой, и вернуться в собственную
    // партию из интерфейса было нечем — полный матч уходит и из «Доступных».
    const pass = tokenFor(localStorage, srv.base, srv.nick);
    const res = await fetch(
      matchesUrl(srv.base, srv.nick),
      pass ? { headers: { authorization: `Bearer ${pass}` } } : {},
    );
    if (queryOutcome(res) !== 'ok') throw new Error('http ' + res.status);
    matchLists = (await res.json()) as Record<MatchTab, MatchRow[]>;
    // PTM-1.2: список партий дошёл до игрока — раз за загрузку; лента потом опрашивается.
    if (!listShown) {
      listShown = true;
      getPlatform().analytics.emit('match_list_shown', {
        available: matchLists.available?.length ?? 0,
        mine: matchLists.active?.length ?? 0,
      });
    }
    localStorage.setItem('void.server', srv.base);
    localStorage.setItem('void.nick', srv.nick);
    loadFailed = false;
    return true;
  } catch {
    matchLists = null;
    loadFailed = true;
    return false;
  }
}

async function toggleArchive(id: string, restore: boolean): Promise<void> {
  const srv = game.resolveServer();
  if (!srv) return;
  // Адреса и разбор исхода — `matchQuery.ts` (REFM-150): всё уходящее в адрес
  // экранируется, а «сервер ОТВЕТИЛ отказом» и «до сервера не дошли» — разные беды.
  // Что из этого следует для экрана — `archiveOutcome.ts` (REFM-157): удача это
  // молчаливая перерисовка (строка меняет ВКЛАДКУ, и список — единственный честный
  // ответ), отказ называет действие, которое не прошло, а обрыв связи действий не
  // различает: беда в канале, а не в кнопке.
  const op = restore ? 'restore' : 'archive';
  const apply = async (effect: ArchiveEffect): Promise<void> => {
    if (effect.kind === 'refresh') await refreshMatches();
    else game.status(t(effect.key));
  };
  try {
    const pass = tokenFor(localStorage, srv.base, srv.nick);
    const res = await fetch(archiveUrl(srv.base, id, srv.nick, restore), {
      method: 'POST',
      ...(pass ? { headers: { authorization: `Bearer ${pass}` } } : {}),
    });
    await apply(archiveEffect(op, queryOutcome(res) === 'refused' ? 'refused' : 'ok'));
  } catch {
    await apply(archiveEffect(op, 'unreachable'));
  }
}

/** Запомнить выбор между заходами — рядом с `void.server` / `void.nick`. */
function saveMatchFilter(): void {
  if (matchFilter) localStorage.setItem(FILTER_STORE_KEY, serializeFilter(matchFilter));
}

/**
 * Отрисовать панель фильтров ПО ЛЕНТЕ (BRW-3). Галочки карт и границы ползунка берутся
 * из самой ленты (`matchFilter.ts`, правило 6) — каталога карт в read-model нет. Что
 * значит выбор, решает тот же модуль; какие контролы вообще нужны — `matchesPage.ts`,
 * правило 3. Здесь только разметка и обработчики.
 */
function renderFilterPanel(rows: MatchRow[], f: FilterState): FilterControls {
  const maps = mapsOf(rows);
  const bounds = playerBounds(rows);
  const show = filterControls({
    maps: maps.length,
    players: bounds,
    kinds: rows.some((r) => r.kind !== undefined),
  });
  $('mf-mode').style.display = show.mode ? '' : 'none';
  $('mf-mapbox').style.display = show.maps ? '' : 'none';
  $('mf-players').style.display = show.players ? '' : 'none';
  for (const b of Array.from(document.querySelectorAll('#mf-mode .mfbtn')))
    b.classList.toggle('active', (b as HTMLElement).dataset.mode === f.mode);
  const btn = $('mf-map');
  btn.textContent =
    f.maps.size === 0
      ? t('browser.filter.map.all')
      : t('browser.filter.map.some', { n: f.maps.size });
  const menu = $('mf-maps');
  menu.textContent = '';
  for (const id of maps) {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = f.maps.has(id);
    box.addEventListener('change', () => {
      if (box.checked) f.maps.add(id);
      else f.maps.delete(id);
      saveMatchFilter();
      renderMatches();
    });
    label.appendChild(box);
    // Имя карты — то же, что в заголовке строки: «duel-1» в галочке игроку ничего не говорит.
    label.appendChild(document.createTextNode(game.mapLabel(id)));
    menu.appendChild(label);
  }
  const lo = $('mf-min') as HTMLInputElement;
  const hi = $('mf-max') as HTMLInputElement;
  for (const [input, value] of [
    [lo, f.players.min],
    [hi, f.players.max],
  ] as const) {
    input.min = String(bounds.min);
    input.max = String(bounds.max);
    input.value = String(value);
  }
  // Два бегунка на одной дорожке: между ними — выбранный диапазон. Концы могут стоять
  // наоборот (`matchFilter.ts`, правило 4), полоса считается от меньшего к большему.
  const span = bounds.max - bounds.min || 1;
  const at = (v: number): string => String((v - bounds.min) / span);
  const dual = $('mf-dual');
  dual.style.setProperty('--lo', at(Math.min(f.players.min, f.players.max)));
  dual.style.setProperty('--hi', at(Math.max(f.players.min, f.players.max)));
  $('mf-range').textContent = t('browser.filter.range', {
    min: Math.min(f.players.min, f.players.max),
    max: Math.max(f.players.min, f.players.max),
  });
  return show;
}

/** Переключить вкладку страницы и перерисовать её. */
function openTab(tab: MatchPageTab): void {
  activeTab = tab;
  for (const b of Array.from(document.querySelectorAll('.mtab')))
    b.classList.toggle('active', (b as HTMLElement).dataset.tab === tab);
  renderMatches();
}

/**
 * Пустое место вместо списка: сообщение и путь дальше (`browserFallback.ts`, правило 1).
 * «Сервер не отвечает» говорит карточка с адресом над списком, здесь — только путь.
 */
function renderEmpty(el: HTMLElement, plan: Extract<Fallback, { kind: 'empty' }>): void {
  let html = plan.message === 'browser.server-down' ? '' : `<div class="mempty">${t(plan.message)}</div>`;
  if (plan.next === 'solo')
    html +=
      `<div class="msolo"><button class="mbtn btn-second" id="msolo-go">▶ ${t('browser.solo')}</button>` +
      `<div class="msolo-sub">${t('browser.solo.hint')}</div></div>`;
  if (plan.next === 'available')
    html += `<div class="msolo"><button class="mbtn btn-second" id="mfind-go">${t('browser.find')}</button></div>`;
  el.innerHTML = html;
  document.getElementById('msolo-go')?.addEventListener('click', () => {
    game.leaveMatch();
    openSetup('hub');
  });
  document.getElementById('mfind-go')?.addEventListener('click', () => openTab('available'));
}

/** Куда встаёт карточка партии и что ей нужно от владельца. */
interface CardOptions {
  /** Вкладка ленты: от неё зависят главная кнопка, места, скорость, окно входа и архив. */
  source: MatchTab;
  /** `mrow` в обозревателе, `hm-row` в хабе: по ним строки находят тесты и харнесы. */
  anchor: 'mrow' | 'hm-row';
  /** Куда сказать, что номер скопирован. */
  notice(text: string): void;
  /** «В архив» / «Восстановить» в «Описании» — только у обозревателя, как и раньше. */
  archive: boolean;
}

/**
 * Карточка партии (UIX-10.4): имя карты с пометками и день, где решают — места, скорость и
 * окно входа; под ними главная кнопка, номер и «Описание». Что писать, решает
 * `decisions/matchCard.ts`; разметка одна у обозревателя и «Моих партий» хаба.
 */
function matchCard(m: MatchRow, o: CardOptions): HTMLElement {
  const place: CardPlace = o.source === 'available' ? 'available' : 'own';
  const facts = cardFacts(m, place);
  const card = document.createElement('div');
  card.className = `${o.anchor} mcard ${place}`;
  // Полный номер остаётся в подсказке; кнопка в ряду копирует его целиком.
  card.dataset.match = m.matchId;
  card.title = m.matchId;
  // Пометки — только то, чего в имени карты нет (правила 1, 2 и 5). Имя режима приходит НЕ
  // со строки: сервер шлёт id, человеческое имя даёт `tData()` по тому же слагу
  // (`pve_waves` → `data.pve-waves`). Идущий матч — обычное состояние, помечен завершённый.
  let tags = '';
  if (facts.pve) tags += `<span class="mmode pve">${t('browser.mode.pve')}</span>`;
  if (facts.modeId) tags += `<span class="mmodename">${esc(tData(facts.modeId))}</span>`;
  if (facts.capitals) tags += `<span class="mtag">${t('browser.capitals')}</span>`;
  if (m.status === 'ended') tags += `<span class="mended">${t('browser.finished')}</span>`;
  let meta = `<span>${t('browser.day', { n: m.days })}</span>`;
  if (facts.seats) meta += seatsHtml(m.players);
  if (facts.speed) {
    const speed = `×${m.rules.timeScale ?? 1}`;
    meta += `<span title="${esc(`${t('browser.description.speed')} ${speed}`)}">${speed}</span>`;
  }
  meta += windowHtml(m, o.source);
  const info = document.createElement('div');
  info.className = 'minfo';
  info.innerHTML = `<div class="mname"><b>${esc(matchName(m))}</b>${tags}</div><div class="mmeta">${meta}</div>`;
  card.appendChild(info);
  const btns = document.createElement('div');
  btns.className = 'mbtns';
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'mbtn btn-second mgo';
  // «Войти» на партии, где ты уже сидишь, обещает не то: место занято тобой, и речь
  // о возвращении, а не о вступлении.
  const seated = o.source !== 'available';
  go.textContent = t(m.status === 'ended' ? 'browser.view-map' : seated ? 'browser.resume' : 'browser.join');
  go.addEventListener('click', () => openSessionTab(m.matchId, seated));
  btns.appendChild(go);
  // Номер — в том же ряду: отдельной строкой он один занимал 50 px высоты.
  btns.appendChild(matchNumberButton(m.matchId, o.notice));
  btns.appendChild(descriptionButton(m, o.archive ? archiveAction(m, o.source) : undefined));
  card.appendChild(btns);
  return card;
}

/** Места: точками, пока их не больше восьми (`matchesPage.ts`, правило 2), словами — в подсказке. */
function seatsHtml(p: MatchRow['players']): string {
  const pips = seatPips(p.seated, p.capacity);
  const label = esc(t('browser.seats', { s: p.seated, c: p.capacity }));
  return (
    `<span class="mseats" title="${label}" aria-label="${label}">` +
    (pips ? pips.map((on) => (on ? '<i class="on"></i>' : '<i></i>')).join('') : '') +
    `<b>${p.seated}/${p.capacity}</b></span>`
  );
}

/**
 * Окно входа (SES-2.4) и срок архива. На «Доступных» видно, сколько новичок ещё может занять
 * место: полностью закрытые сессии сервер оттуда уже убрал, так что отсчёт успокаивает, а
 * близкий конец подгоняет. Без границы (dev, старый сервер) и на своих вкладках — пусто:
 * возвращение окном не ограничено.
 */
function windowHtml(m: MatchRow, source: MatchTab): string {
  const win = joinWindow(m, source);
  let html = '';
  if (win.kind === 'closed') html = `<span class="mwin shut">${t('acc.join-closed')}</span>`;
  else if (win.kind === 'open')
    html = `<span class="mwin${win.soon ? ' soon' : ''}">${t('browser.join-window', { dur: fmtJoinWindow(win.left) })}</span>`;
  if (m.status === 'ended' && m.archiveExpiresAt !== undefined) {
    const date = new Date(m.archiveExpiresAt).toLocaleString(LOCALE, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    html += `<span class="mwin">${esc(t('browser.archive-until', { date }))}</span>`;
  }
  return html;
}

/** «В архив» / «Восстановить» (`rowAction`): нужны редко, поэтому живут в «Описании», а не
 *  третьей кнопкой на карточке. Чужие и завершённые партии их не получают. */
function archiveAction(m: MatchRow, source: MatchTab): DescriptionAction | undefined {
  const action = rowAction(source, m.status);
  if (!action) return undefined;
  const restore = action === 'restore';
  return {
    label: t(restore ? 'browser.restore' : 'browser.archive'),
    run: () => detach('обозреватель: архив партии', toggleArchive(m.matchId, restore)),
  };
}

/** «Описание». На телефоне это значок «i» в углу карточки: подписью рядом с главной кнопкой и
 *  номером оно не влезало в ряд (стили — `05-entry-setup.css`); имя держат подсказка и
 *  `aria-label`. С 700px видна подпись. */
function descriptionButton(match: MatchRow, action?: DescriptionAction): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mbtn btn-quiet mdescription';
  const label = t('browser.description');
  button.title = label;
  button.ariaLabel = label;
  button.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.01"/></svg>' +
    `<span class="mlabel">${esc(label)}</span>`;
  button.addEventListener('click', () => openMatchDescription(match, matchName(match), action));
  return button;
}

function renderMatches(): void {
  const el = $('mlist');
  const loaded = !!matchLists;
  // Беда связи — свой неудачный запрос или «сервер недоступен» от сетевого цикла: обрыв
  // сокета оставляет ленту в памяти, и новую партию над ней предлагать не надо.
  const failed = loadFailed || game.statusText() === t('acc.server-down');
  // Фильтр — это ПОИСК сессии, поэтому он сужает только «Доступные» (решение владельца,
  // `matchFilter.ts`, правило 1): свои матчи на двух других вкладках он не трогает, и
  // панель там не показывается. Состояние приводится к сегодняшней ленте на каждой
  // перерисовке (правило 7) — иначе сохранённая галочка на ушедшей карте вычистила бы
  // список, не показавшись в панели. Считается и с чужой вкладки: число на ярлыке
  // «Доступных» — после фильтра (`matchesPage.ts`, правило 1).
  const lists = splitCorporateMatches(matchLists);
  const available = lists?.available ?? [];
  const f = (matchFilter = matchFilter
    ? clampFilter(matchFilter, available)
    : restoreFilter(localStorage.getItem(FILTER_STORE_KEY), available));
  const found = available.filter((m) => matchesFilter(m, f));
  const counts = tabCounts(lists, found.length);
  for (const b of Array.from(document.querySelectorAll('.mtab'))) {
    const n = counts[(b as HTMLElement).dataset.tab as MatchPageTab];
    const badge = b.querySelector('.mcount');
    if (badge) badge.textContent = n === null ? '' : String(n);
  }
  const corporate = lists?.corporate ?? [];
  const все = activeTab === 'corporate' ? corporate.map(item => item.match) : lists?.[activeTab] ?? [];
  const rows = activeTab === 'available' ? found : все;
  const план = fallbackFor({
    loaded,
    failed,
    tab: activeTab,
    rows: rows.length,
    hiddenByFilter: все.length - rows.length,
  });
  // Карточка «Сервер не отвечает» с адресом — `browserFallback.ts`, правило 4. Она и есть
  // сообщение о беде, поэтому то же в строке статуса гасится (правило 5).
  const down = showServerRow({ loaded, failed });
  $('msrv').style.display = down ? '' : 'none';
  if (down && game.statusText() === t('acc.server-down')) game.status('');
  $('match-create').style.display = loaded && !failed && activeTab === 'available' && canCreateOnlineMatch() ? '' : 'none';
  // Вход по номеру — там же, где новая партия: только когда сервер ответил.
  $('mnum').style.display = loaded && !failed ? '' : 'none';
  // Панель нужна только там, где есть что фильтровать: без загруженной ленты она
  // предлагала бы крутить контролы вместо того, чтобы починить связь.
  const controls =
    activeTab === 'available' && план.kind !== 'empty' ? renderFilterPanel(available, f) : null;
  $('mfilter').style.display = controls?.any ? '' : 'none';
  if (план.kind === 'empty') {
    renderEmpty(el, план);
    return;
  }
  if (план.kind === 'filtered') {
    // Правило 6 `browserFallback.ts`: это НЕ тупик — путь у игрока под рукой, сброс
    // фильтра, поэтому одно сообщение и одна кнопка, без одиночной игры.
    el.innerHTML =
      `<div class="mempty">${t(план.message)}</div>` +
      `<div class="msolo"><button class="mbtn btn-second" id="mreset-go">${t('browser.filter.reset')}</button></div>`;
    document.getElementById('mreset-go')?.addEventListener('click', () => {
      matchFilter = restoreFilter(null, available);
      saveMatchFilter();
      renderMatches();
    });
    return;
  }
  el.textContent = '';
  const card = (m: MatchRow, source: MatchTab): HTMLElement =>
    matchCard(m, { source, anchor: 'mrow', notice: (text) => game.status(text), archive: true });
  if (activeTab === 'corporate')
    for (const { match, source } of corporate) el.appendChild(card(match, source));
  else for (const m of rows) el.appendChild(card(m, activeTab));
}

/**
 * «Мои партии» на главном экране хаба (ADDR-4).
 *
 * Обозреватель отвечает на «куда пойти играть», этот список — на «где я уже играю и куда
 * вернуться». Какие партии сюда попадают, в каком порядке и что значит пустота — решает
 * `decisions/myMatches.ts`; карточка — та же, что у обозревателя.
 *
 * В карточке — НОМЕР партии, а не адрес (`matchNumber.ts`, плейтест 2026-10-17): его копируют
 * и вводят в поле «Номер партии» обозревателя.
 */
function renderMyMatches(): void {
  const el = document.getElementById('hub-mine');
  if (!el) return;
  const view = myMatches(matchLists, HUB_MY_MATCHES);
  // Правило 5: ленты нет — молчим. «У вас нет партий» поверх трёх идущих отправило бы
  // игрока заводить четвёртую. Молчит и заголовок: пустой раздел читается как поломка.
  $('hub-mine-sec').hidden = view.kind === 'unknown';
  if (view.kind === 'unknown') {
    el.textContent = '';
    return;
  }
  // Правило 6: пустота — нормальное начало, и она зовёт туда, где партии берут:
  // строка и «Начать партию» в обозреватель (UIX-10.1).
  if (view.kind === 'none') {
    el.innerHTML =
      `<div class="hub-card"><div class="hc-ic">◇</div><div><div class="hc-t">${t('hub.mine.empty')}</div>` +
      `<button type="button" class="hm-go">${t('hub.mine.start')}</button></div></div>`;
    el.querySelector('.hm-go')?.addEventListener('click', () => game.hubTab('games'));
    return;
  }
  el.textContent = '';
  // Та же карточка, что у обозревателя (UIX-10.4): лента хаба — это СВОИ партии
  // (`myMatches` читает `lists.active`), поэтому главная кнопка — возвращение.
  for (const m of view.rows)
    el.appendChild(
      matchCard(m, { source: 'active', anchor: 'hm-row', notice: (text) => game.hubNote(text), archive: false }),
    );
  if (view.more > 0) {
    // Правило 4: остаток — не строки, а один переход в обозреватель.
    const more = document.createElement('button');
    more.className = 'hm-more';
    more.type = 'button';
    more.textContent = t('hub.mine.more', { n: view.more });
    more.addEventListener('click', () => {
      // Остаток лежит на «Активных», а обозреватель открывается на «Доступных» — и своих
      // партий там нет ПО ПОСТРОЕНИЮ: сервер не кладёт в `available` матч, где у тебя уже
      // есть место (`MatchRegistry.list`). Без переключения вкладки «ещё 2» приводило бы
      // на заведомо пустой список — проверено вживую.
      const all = myMatches(matchLists, Number.MAX_SAFE_INTEGER);
      const rest = all.kind === 'list' ? all.rows.slice(view.rows.length) : [];
      const tab = rest.length && rest.every(m => isAvaMatchId(m.matchId)) ? 'corporate' : 'active';
      (document.querySelector(`.mtab[data-tab="${tab}"]`) as HTMLElement | null)?.click();
      game.hubTab('games');
    });
    el.appendChild(more);
  }
}

/** Переспросить ленту и перерисовать «Мои партии» (ADDR-4). Строку статуса обозревателя
 *  не трогает — этим и отличается `loadMatchLists` от `refreshMatches`. */
export async function refreshMyMatches(): Promise<void> {
  const srv = game.resolveServer();
  if (srv) await loadMatchLists(srv);
  renderMyMatches();
}

/** Войти в партию по номеру: своя — возвращение, чужая — выбор места, как у строки. Этой
 *  же дверью входят к другу и по приглашению (FRIENDS-2). */
export function joinByNumber(id: string): void {
  const seated = [...(matchLists?.active ?? []), ...(matchLists?.archived ?? [])]
    .some((m) => m.matchId === id);
  openSessionTab(id, seated);
}

/** Свои идущие партии, куда можно позвать друга (FRIENDS-2, `decisions/friendInvite.ts`). */
export function inviteTargets(): InviteMatch[] {
  return inviteMatches(matchLists?.active ?? []).map((m) => ({
    matchId: m.matchId,
    label: `${game.mapLabel(m.mapId)} · ${matchNumberText(m.matchId)}`,
  }));
}

/** Положить готовую ленту и показать «Доступные», без похода на сервер. Ею харнес размеров
 *  (`sizetest.mjs`) мерит обозреватель: сервера там нет. */
export function showLists(lists: Record<MatchTab, MatchRow[]>): void {
  matchLists = lists;
  openTab('available');
}

/** Подключить обозреватель к игре: хуки и обработчики контролов. Зовётся до загрузочного
 *  блока `main.ts`: тот открывает хаб, а заход домой переспрашивает «Мои партии». */
export function initMatchBrowser(host: MatchBrowserHost): void {
  game = host;
  initMatchCreation(() => game.resolveServer());
  srvInput = $('csrv') as HTMLInputElement;
  // Контролы фильтра (BRW-3). Обработчики вешаются ОДИН раз: живой пересчёт — это
  // перерисовка уже лежащей в памяти ленты, без похода на сервер.
  $('mf-mode').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.mfbtn') as HTMLElement | null;
    const mode = btn?.dataset.mode;
    if (!matchFilter || (mode !== 'all' && mode !== 'pvp' && mode !== 'pve')) return;
    matchFilter.mode = mode;
    saveMatchFilter();
    renderMatches();
  });
  $('mf-map').addEventListener('click', () => {
    const menu = $('mf-maps');
    menu.style.display = menu.style.display === 'none' ? '' : 'none';
  });
  for (const id of ['mf-min', 'mf-max']) {
    $(id).addEventListener('input', () => {
      if (!matchFilter) return;
      // Концы намеренно НЕ разводятся: перевёрнутый ползунок — законное состояние,
      // предикат меняет их местами сам (`matchFilter.ts`, правило 4).
      matchFilter.players = {
        min: Number(($('mf-min') as HTMLInputElement).value),
        max: Number(($('mf-max') as HTMLInputElement).value),
      };
      saveMatchFilter();
      renderMatches();
    });
  }

  // Вход по номеру партии: своя партия — возвращение, чужая — выбор места, как у строки.
  const numIn = $('mnum-in') as HTMLInputElement;
  $('mnum').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = parseMatchNumber(numIn.value);
    if (!id) {
      game.status(t('browser.number.bad'));
      return;
    }
    joinByNumber(id);
  });

  for (const btn of Array.from(document.querySelectorAll('.mtab')))
    btn.addEventListener('click', () =>
      openTab(((btn as HTMLElement).dataset.tab as MatchPageTab) ?? 'available'),
    );

  // Кнопки «Обновить список» нет (UIX-17.1): открытая страница освежается сама — тихий
  // переопрос раз в десять секунд (`startPoll`). «Подключиться» в карточке «Сервер не
  // отвечает» и правка адреса там же переспрашивают сразу; «Войти» в строке и «В архив» в её
  // «Описании» — про матч.
  const reload = (): void => detach('обозреватель: список партий', refreshMatches());
  $('cgo').addEventListener('click', reload);
  srvInput.addEventListener('change', reload);
}

/**
 * Завести тихий переопрос раз в десять секунд — при ПЕРВОМ открытии страницы, а не на
 * загрузке игры: тому, кто в «Матчи» не заходит (одиночная игра, Sector Zero), таймер не
 * нужен. Дальше он живёт до конца страницы и молчит, пока список не на экране.
 */
function startPoll(): void {
  if (pollStarted) return;
  pollStarted = true;
  const browseEl = $('cbrowse');
  setInterval(() => {
    if (isMatchDescriptionOpen()) return;
    // Уместен ли переопрос прямо сейчас — `matchPoll.ts` (REFM-153): тикает только
    // список НА ЭКРАНЕ. Поверх закрытого оверлея (матч / ставка) и на приветственном
    // шаге фоновая неудача написала бы «сервер недоступен» в чужую строку статуса; пока
    // игрок правит адрес, переопрос ждёт (правило 5) — запрос по недописанному адресу
    // кончился бы неудачей, и карточка мигнула бы посреди набора.
    const shown = (n: HTMLElement): boolean => n.style.display !== 'none';
    const tick = pollTick({
      overlay: game.connectShown(),
      browser: shown(browseEl),
      editing: document.activeElement === srvInput,
    });
    if (tick === 'skip') return;
    detach('обозреватель: тихий переопрос списка', refreshMatches(true));
  }, 10_000);
}
