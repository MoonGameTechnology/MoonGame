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
 * Поля адреса и позывного стоят на экране обозревателя; модуль только прячет их строки
 * в сборке игрока, а значения читает через `resolveServer`.
 */
import { t, tData } from '../../localization/runtime';
import { clearStatusLine, fallbackFor, showServerRow } from '../../decisions/browserFallback';
import { shareAddress } from '../../decisions/matchAddress';
import { pollLine, pollTick, type PollPhase } from '../../decisions/matchPoll';
import { archiveUrl, httpBase, matchesUrl, queryOutcome } from '../../decisions/matchQuery';
import { HUB_MY_MATCHES, myMatches } from '../../decisions/myMatches';
import { tokenFor } from '../../decisions/sessionStore';
import { probeAuthMode } from './accountSession';
import { archiveEffect, type ArchiveEffect } from './archiveOutcome';
import { detach } from './detach';
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
import {
  fmtJoinWindow,
  joinWindow,
  modeLabel,
  rowAction,
  ruleSummary,
  type MatchRules,
  type MatchTab,
} from './matchRow';
import { openSetup } from './setupScreen';

declare const __PLAYER_BUILD__: boolean;

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
let srvInput: HTMLInputElement;
let nickInput: HTMLInputElement;

export interface MatchRow {
  matchId: string;
  mapId: string;
  rules: MatchRules;
  days: number;
  players: { seated: number; capacity: number };
  status: string;
  /** Entry window (SES-2.3/2.4): can a NEW player still take a free seat here, and how
   *  long is left. Absent on an older server ⇒ treat as always open. */
  entryOpen?: boolean;
  entryClosesInMs?: number;
  /** Game mode (BRW-1): the preset id the session runs, and whether the server judged
   *  it PvP or PvE. Either may be absent — see rule 5 in `matchRow.ts`. */
  modeId?: string;
  kind?: 'pvp' | 'pve';
}

let matchLists: Record<MatchTab, MatchRow[]> | null = null;
let activeTab: MatchTab = 'available';
/** Выбор фильтров (BRW-3). Живёт в модуле, поэтому тихий переопрос раз в десять секунд
 *  его не сбрасывает — перерисовка читает то же состояние. Между заходами он лежит в
 *  `localStorage` рядом с `void.server`/`void.nick`; `null` — ещё не восстанавливали. */
let matchFilter: FilterState | null = null;

export async function refreshMatches(quiet = false): Promise<void> {
  const srv = game.resolveServer();
  if (!srv) return;
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
  renderMatches();
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
    localStorage.setItem('void.server', srv.base);
    localStorage.setItem('void.nick', srv.nick);
    return true;
  } catch {
    matchLists = null;
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
    const res = await fetch(archiveUrl(srv.base, id, srv.nick, restore), { method: 'POST' });
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
 * значит выбор, решает тот же модуль; здесь только разметка и обработчики.
 */
function renderFilterPanel(rows: MatchRow[], f: FilterState): void {
  for (const b of Array.from(document.querySelectorAll('#mf-mode .mfbtn')))
    b.classList.toggle('active', (b as HTMLElement).dataset.mode === f.mode);
  const btn = $('mf-map');
  btn.textContent =
    f.maps.size === 0
      ? t('browser.filter.map.all')
      : t('browser.filter.map.some', { n: f.maps.size });
  const menu = $('mf-maps');
  menu.textContent = '';
  for (const id of mapsOf(rows)) {
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
    label.appendChild(document.createTextNode(id));
    menu.appendChild(label);
  }
  const bounds = playerBounds(rows);
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
  $('mf-range').textContent = t('browser.filter.range', { min: f.players.min, max: f.players.max });
}

function renderMatches(): void {
  const el = $('mlist');
  const failed = game.statusText() === t('acc.server-down');
  $('match-create').style.display =
    matchLists && !failed && activeTab === 'available' ? '' : 'none';
  // Что показать вместо списка — `browserFallback.ts` (REFM-151): никогда не тупик
  // (соло предлагается всегда — это путь без сервера), «сервер не ответил» и «ещё не
  // спрашивали» — разные сообщения, у сборки игрока свои тексты, а строка адреса
  // всплывает ровно пока список не загрузился.
  const состояние = { loaded: !!matchLists, failed, playerBuild: __PLAYER_BUILD__ };
  if (__PLAYER_BUILD__) {
    // The player screen is ONLY the three tabs + the list. The hidden server row
    // resurfaces exactly while the list can't be loaded (an APK has no useful page
    // origin — the player types the host's address once, then it hides again), and
    // the status line is not duplicated under the list's own message.
    const srvRow = srvInput.closest('.cfield') as HTMLElement | null;
    if (srvRow) srvRow.style.display = showServerRow(true, состояние.loaded) ? '' : 'none';
    if (clearStatusLine(true, failed)) game.status('');
  }
  // Never a dead end: whatever the server says (unreachable / empty list), the dev
  // client offers the path that ALWAYS works — a solo skirmish offline. The player
  // build offers it too, with its own wording: it has no «Обновить список» to point at.
  const soloCard = (msg: string): void => {
    el.innerHTML =
      `<div class="mempty">${msg}</div>` +
      `<div class="msolo"><button class="mbtn btn-second" id="msolo-go">▶ ${t('browser.solo')}</button>` +
      `<div class="msolo-sub">${t('browser.solo.hint')}</div></div>`;
    document.getElementById('msolo-go')?.addEventListener('click', () => {
      game.leaveMatch();
      openSetup('hub');
    });
  };
  const все = matchLists?.[activeTab] ?? [];
  // Фильтр — это ПОИСК сессии, поэтому он живёт только на «Доступных» (решение владельца,
  // `matchFilter.ts`, правило 1): свои матчи на двух других вкладках он не трогает, и
  // панель там не показывается. Состояние приводится к сегодняшней ленте на каждой
  // перерисовке (правило 7) — иначе сохранённая галочка на ушедшей карте вычистила бы
  // список, не показавшись в панели.
  let rows = все;
  let hiddenByFilter = 0;
  if (activeTab === 'available') {
    matchFilter = matchFilter
      ? clampFilter(matchFilter, все)
      : restoreFilter(localStorage.getItem(FILTER_STORE_KEY), все);
    rows = все.filter((m) => matchesFilter(m, matchFilter as FilterState));
    hiddenByFilter = все.length - rows.length;
  }
  const план = fallbackFor({ ...состояние, rows: rows.length, hiddenByFilter });
  // Панель нужна только там, где есть что фильтровать: без загруженной ленты она
  // предлагала бы крутить контролы вместо того, чтобы починить связь.
  const панель = $('mfilter');
  панель.style.display = activeTab === 'available' && план.kind !== 'empty' ? '' : 'none';
  if (activeTab === 'available' && план.kind !== 'empty')
    renderFilterPanel(все, matchFilter as FilterState);
  if (план.kind === 'empty') {
    soloCard(t(план.message));
    return;
  }
  if (план.kind === 'filtered') {
    // Правило 6 `browserFallback.ts`: это НЕ тупик — путь у игрока прямо над списком,
    // поэтому одно сообщение и никакой кнопки «в соло».
    el.innerHTML = `<div class="mempty">${t(план.message)}</div>`;
    return;
  }
  el.textContent = '';
  for (const m of rows) {
    const row = document.createElement('div');
    row.className = 'mrow';
    const info = document.createElement('div');
    info.className = 'minfo';
    // Entry window (SES-2.4): on «Доступные», show how long a newcomer may still take a
    // seat — the server already drops fully-closed sessions from this tab, so an open
    // countdown reassures, a soon-to-close one nudges. Unbounded (dev / old server) or
    // other tabs: omitted. Own «Активные»/«Архив» rows don't gate a reconnect, so no
    // window there.
    const win = joinWindow(m, activeTab);
    let windowLine = '';
    if (win.kind === 'closed') {
      windowLine = ` · <span class="mwin shut">${t('acc.join-closed')}</span>`;
    } else if (win.kind === 'open') {
      windowLine = ` · <span class="mwin${win.soon ? ' soon' : ''}">${t('browser.join-window', { dur: fmtJoinWindow(win.left) })}</span>`;
    }
    // Режим партии (BRW-4): значок вида + имя пресета. Имя приходит НЕ со строки —
    // сервер шлёт только id, а человеческое имя даёт `tData()` по тому же слагу
    // (`pve_waves` → `data.pve-waves`). Что именно печатать, решает `modeLabel()`:
    // значка нет, пока сервер сам не назвал вид, а без `modeId` строки нет вовсе.
    const mode = modeLabel(m);
    let modeLine = '';
    if (mode.kind === 'shown') {
      const badge =
        mode.badge === 'pve'
          ? `<span class="mmode pve">${t('browser.mode.pve')}</span> `
          : mode.badge === 'pvp'
            ? `<span class="mmode pvp">${t('browser.mode.pvp')}</span> `
            : '';
      modeLine = `${badge}${esc(tData(mode.modeId))} · `;
    }
    info.innerHTML =
      `<div class="mname">${esc(game.mapLabel(m.mapId))} <span class="mid">${esc(m.matchId)}</span></div>` +
      `<div class="mmeta">${modeLine}${t('browser.day', { n: m.days })} · ${t('browser.players', { s: m.players.seated, c: m.players.capacity })} · ` +
      `${esc(ruleSummary(m.rules))} · ${m.status === 'ended' ? t('browser.finished') : t('browser.running')}${windowLine}</div>`;
    row.appendChild(info);
    const btns = document.createElement('div');
    btns.className = 'mbtns';
    const join = document.createElement('button');
    join.className = 'mbtn btn-second';
    // «Войти» на партии, где ты уже сидишь, обещает не то: место занято тобой, и речь
    // о возвращении, а не о вступлении.
    const seated = activeTab === 'active';
    join.textContent = t(seated ? 'browser.resume' : 'browser.join');
    join.addEventListener('click', () => openSessionTab(m.matchId, seated));
    btns.appendChild(join);
    const action = rowAction(activeTab);
    if (action) {
      const restore = action === 'restore';
      const arch = document.createElement('button');
      arch.className = 'mbtn btn-quiet';
      arch.textContent = restore ? t('browser.restore') : t('browser.archive');
      arch.addEventListener('click', () =>
        detach('обозреватель: архив партии', toggleArchive(m.matchId, restore)),
      );
      btns.appendChild(arch);
    }
    row.appendChild(btns);
    el.appendChild(row);
  }
}

/**
 * «Мои партии» на главном экране хаба (ADDR-4).
 *
 * Обозреватель отвечает на «куда пойти играть», этот список — на «где я уже играю и куда
 * вернуться». Какие партии сюда попадают, в каком порядке и что значит пустота — решает
 * `decisions/myMatches.ts`; здесь только разметка, адрес и переходы.
 *
 * Адрес строится на адресе СЕРВЕРА (`shareAddress`, правило 7 `matchAddress.ts`): в APK
 * страница приходит с локального сервера Capacitor, и адрес из `location.origin` привёл
 * бы получателя в его собственный телефон.
 */
function renderMyMatches(serverHttp: string): void {
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
  for (const m of view.rows) {
    const addr = serverHttp ? shareAddress(serverHttp, m.matchId) : '';
    const card = document.createElement('div');
    card.className = 'hub-card hm-row';
    card.innerHTML =
      `<div class="hc-ic">${m.status === 'ended' ? '◼' : '▶'}</div>` +
      `<div class="hm-body">` +
      // Идентификатора в заголовке нет намеренно: он целиком стоит ниже, В АДРЕСЕ —
      // а `m-<uuid>` в заголовке отъедал три строки и вытеснял то, ради чего сюда
      // смотрят (какая партия, какой день, сколько игроков).
      `<div class="hc-t">${esc(game.mapLabel(m.mapId))}</div>` +
      `<div class="hc-s">${t('browser.day', { n: m.days })} · ` +
      `${t('browser.players', { s: m.players.seated, c: m.players.capacity })} · ` +
      `${m.status === 'ended' ? t('browser.finished') : t('browser.running')}</div>` +
      (addr ? `<div class="hm-addr">${esc(addr)}</div>` : '') +
      `</div>`;
    const btns = document.createElement('div');
    btns.className = 'hm-btns';
    const open = document.createElement('button');
    open.className = 'mbtn btn-second';
    // Лента хаба — это СВОИ партии (`myMatches` читает `lists.active`), поэтому здесь
    // всегда возвращение.
    open.textContent = t('browser.resume');
    open.addEventListener('click', () => openSessionTab(m.matchId, true));
    btns.appendChild(open);
    if (addr) {
      const copy = document.createElement('button');
      copy.className = 'mbtn btn-quiet';
      copy.textContent = t('hub.mine.copy');
      copy.addEventListener('click', () => {
        // Буфер обмена может быть недоступен (нет разрешения, небезопасный контекст) —
        // тогда честно зовём скопировать из строки: адрес в ней и написан, целиком.
        void (navigator.clipboard?.writeText(addr) ?? Promise.reject(new Error('no clipboard')))
          .then(() => {
            game.hubNote(t('hub.mine.copied'));
          })
          .catch(() => {
            game.hubNote(t('hub.mine.copy-manual'));
          });
      });
      btns.appendChild(copy);
    }
    card.appendChild(btns);
    el.appendChild(card);
  }
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
      (document.querySelector('.mtab[data-tab="active"]') as HTMLElement | null)?.click();
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
  renderMyMatches(srv ? httpBase(srv.base) : '');
}

/** Положить готовую ленту и показать «Доступные», без похода на сервер. Ею харнес размеров
 *  (`sizetest.mjs`) мерит обозреватель: сервера там нет. */
export function showLists(lists: Record<MatchTab, MatchRow[]>): void {
  matchLists = lists;
  activeTab = 'available';
  renderMatches();
}

/** Подключить обозреватель к игре: хуки и обработчики контролов. Зовётся до загрузочного
 *  блока `main.ts`: тот открывает хаб, а заход домой переспрашивает «Мои партии». */
export function initMatchBrowser(host: MatchBrowserHost): void {
  game = host;
  srvInput = $('csrv') as HTMLInputElement;
  nickInput = $('cnick') as HTMLInputElement;
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

  for (const btn of Array.from(document.querySelectorAll('.mtab'))) {
    btn.addEventListener('click', () => {
      activeTab = ((btn as HTMLElement).dataset.tab as MatchTab) ?? 'available';
      for (const b of Array.from(document.querySelectorAll('.mtab'))) {
        b.classList.toggle('active', b === btn);
      }
      renderMatches();
    });
  }

  // "Обновить список" reloads the read-model; per-row "Войти"/"В архив" act on a match.
  $('cgo').addEventListener('click', () => detach('обозреватель: список партий', refreshMatches()));

  // Player build: the match screen is ONLY the tabs + list (Доступные/Активные/Архив).
  // The callsign comes from the welcome/hub identity step and the server from the page
  // origin, so their rows are noise here — hidden, NOT removed: the inputs stay in the
  // DOM as the state carriers resolveServer() reads. The server row resurfaces from
  // renderMatches only while the list can't be loaded (see there). With no «Обновить
  // список» button, the open screen keeps itself fresh instead: a quiet 10s re-poll
  // plus an immediate reload when the player edits the server address.
  if (__PLAYER_BUILD__) {
    const browseEl = $('cbrowse');
    const hide = (n: Element | null): void => {
      if (n) (n as HTMLElement).style.display = 'none';
    };
    hide(browseEl.querySelector('.csub'));
    hide(nickInput.closest('.cfield'));
    hide(srvInput.closest('.cfield'));
    hide($('cgo').closest('.crow'));
    srvInput.addEventListener('change', () =>
      detach('обозреватель: список партий', refreshMatches()),
    );
    setInterval(() => {
      // Уместен ли переопрос прямо сейчас — `matchPoll.ts` (REFM-153): тикает только
      // список НА ЭКРАНЕ. Поверх закрытого оверлея (матч / ставка) и на приветственном
      // шаге фоновая неудача написала бы «сервер недоступен» в чужую строку статуса.
      const shown = (n: HTMLElement): boolean => n.style.display !== 'none';
      if (pollTick({ overlay: game.connectShown(), browser: shown(browseEl) }) === 'skip') return;
      detach('обозреватель: тихий переопрос списка', refreshMatches(true));
    }, 10_000);
  }
}
