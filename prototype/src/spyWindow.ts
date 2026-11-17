/**
 * Вкладка «Шпионаж» (заказ владельца 2026-11-10): своё окно во вторичном меню рядом с
 * «Дипломатией» и «Сообщениями».
 *
 *  1. Список шпионов: фото с галочками уровня, имя, где он, чем занят, таймер и одна
 *     кнопка — «Дать задание» свободному, «Отменить задание» занятому (`spyRoster.ts`).
 *  2. «Дать задание»: окно с фото и именем шпиона сверху и карточками заданий одного
 *     размера, от безобидного к агрессивному (`spyTasks.ts`).
 *  3. Задание выбрано: окна пропадают, игрок выбирает мир на карте. Пока идёт выбор,
 *     сверху висит полоса с кнопкой «Отменить выдачу». Тап по миру спрашивает «Отправить
 *     шпиона?»: «Да» отдаёт приказ, «Нет» возвращает к выбору мира.
 *  4. С карточки мира окно открывается с уже выбранным миром: задания, невозможные на нём,
 *     серые, а после задания сразу идёт вопрос, без выбора на карте.
 *
 * Под списком остались окна разведки и журнал донесений (SPY-20), жившие раньше во
 * вкладке «Шпионаж» окна дипломатии. Правила шпионажа целиком в ядре: окно гасит только
 * заведомо отвергнутое и показывает отказ ядра, если тот всё же пришёл.
 */
import {
  coalitionOf,
  identifiedNodes,
  MISSION_HOURS,
  SPY_OP_COST,
  spyKnownOwner,
  spyRoster as spiesOf,
  spyTravelMs,
  type Action,
  type GameState,
  type IntelGrant,
} from '../../packages/shared-core/src/index';
import { cancelSpy, spyOn } from '../../decisions/actions';
import { pushSpyRecord, spyOpGlyph, spyRecordOf, type SpyRecord } from '../../decisions/spyArchive';
import { spyRoster, type RosterRow, type SpyRecordView, type SpyDoing } from '../../decisions/spyRoster';
import { SPY_JOURNEY_EVENTS, spyJourneyKey } from '../../decisions/spyJourney';
import { SPY_TASKS, taskBlock, type SpyTask, type TaskBlock } from '../../decisions/spyTasks';
import { oddsPct } from '../../decisions/spyOdds';
import { espionageShown } from '../../decisions/sectorZeroTools';
import { t } from '../../localization/runtime';
import { esc, gameStamp } from './format';
import { liveTimerHtml, patchLiveTimers, type LiveFormats } from './liveTimers';
import { spyFaceIndexes, spyPortraitSvg } from './spyPortrait';
import { spyOddsFor } from './worldCard';
import { ctx } from './game';
import { data } from './gameData';

/** Что окну нужно от игры. */
export interface SpyWindowHost {
  state(): GameState;
  me(): string;
  placeName(id: string): string;
  note(text: string): void;
  playerOrder(action: Action): boolean;
  myIntel(): IntelGrant[];
  sectorZeroToolsHidden(): boolean;
  focusWorld(id: string): void;
}

let game: SpyWindowHost;

/** Уровень шпиона (0–3, галочки на фото) по его опыту. Порог задаёт ветка ядра «уровни
 *  опыта шпионов»; до неё у каждого шпиона 0 галочек. */
const spyLevel = (_xp: number): number => 0;

/** Таймеры окна — целые часы вверх. */
const HOUR = 3_600_000;
const LIVE: LiveFormats = { hceil: (ms) => t('fmt.hours', { n: Math.ceil(ms / HOUR) }) };

/** Шаг окна: список, карточки заданий, выбор мира на карте. */
type Step = { kind: 'closed' } | { kind: 'roster' } | { kind: 'tasks'; spy: number } | { kind: 'pick'; spy: number; task: SpyTask };
let step: Step = { kind: 'closed' };
/** Плитка, выбранная на телефоне в окне заданий; `null` — по умолчанию (`tileTask`). */
let tileSel: SpyTask | null = null;
/** Мир, с карточки которого открыто окно (правило 4); `null` — открыто из меню. */
let target: string | null = null;
/** Открытый вопрос «Да / Нет». */
let ask: { kind: 'send'; spy: number; task: SpyTask; planetId: string } | { kind: 'cancel'; spy: number } | null = null;

// --- данные ------------------------------------------------------------------

/** Шпионы игрока: реестр ядра или стартовая сеть в столице (`spyRoster` ядра, SPY-23). */
function mySpies(): SpyRecordView[] {
  return spiesOf(game.state(), game.me());
}
const spyById = (id: number) => mySpies().find((s) => s.id === id);
const rows = (): RosterRow[] => spyRoster(mySpies());
const xpOf = (id: number) => spiesOf(game.state(), game.me()).find((s) => s.id === id)?.xp ?? 0;

function nameOf(id: number): string {
  const row = rows().find((r) => r.id === id);
  return row ? t(`spy.callsign.${row.callsign}`) : '';
}
const taskName = (task: SpyDoing) => t(`spy.task.${task}.name`);
const costOf = (task: SpyTask) => (SPY_OP_COST as Readonly<Record<string, number>>)[task] ?? 0;

/** Почему задание `task` нельзя дать шпиону `spy` на мире `planetId`. */
function blockOf(task: SpyTask, spy: number, planetId: string | null): TaskBlock {
  const s = game.state();
  const me = game.me();
  // SPY-24: the card greys what the core would refuse, so it reads the owner as the player
  // knows it — a world in the fog is unknown until a spy of theirs has been there.
  const known = planetId && s.planets[planetId] ? spyKnownOwner(s, me, planetId, identifiedNodes(s, me, data)) : null;
  const owner = known?.owner;
  const world = planetId && s.planets[planetId]
    ? {
        owner,
        coalitionMate: !!owner && !!coalitionOf(s, me)?.members.includes(owner),
        ownerOut: !!owner && s.players[owner]?.status !== 'active',
      }
    : null;
  return taskBlock(task, world, me, !!planetId && spyById(spy)?.location === planetId);
}

// --- разметка ----------------------------------------------------------------

function statusText(r: RosterRow): string {
  if (r.status === 'travel' && r.task) return t('spy.status.travel', { task: taskName(r.task) });
  if (r.status === 'work' && r.task) return taskName(r.task);
  return t(`spy.status.${r.status}`);
}

function placeText(r: RosterRow): string {
  const at = esc(game.placeName(r.location));
  return r.status === 'travel' || r.status === 'return' ? `→ ${at}` : at;
}

/** Лицо каждого шпиона списка: по позывному, без повторов среди живых (`spyPortrait.ts`). */
function faceOf(spy: number): number {
  const list = rows();
  return spyFaceIndexes(list.map((r) => r.callsign))[list.findIndex((r) => r.id === spy)] ?? 0;
}

/** Доля пройденного пути или дела, целые проценты; `null` — полосы нет. */
function progressOf(r: RosterRow): number | null {
  if (r.until === null || r.since === null) return null;
  const done = (game.state().time - r.since) / (r.until - r.since);
  return Math.max(0, Math.min(100, Math.floor(done * 100)));
}

/**
 * Строка шпиона: фото, имя над строкой «занятие · место» с точкой цвета занятия, таймер и
 * одна кнопка; по низу — полоса хода пути или задания.
 */
function rowHtml(r: RosterRow): string {
  const btn =
    r.action === 'assign'
      ? `<button class="b btn-main sp-act" data-spy-assign="${r.id}">${t('spy.btn.assign')}</button>`
      : r.action === 'cancel'
        ? `<button class="b btn-second sp-act" data-spy-cancel="${r.id}">${t('spy.btn.cancel')}</button>`
        : '';
  const place = r.status === 'recruit' ? '' : `<span class="sp-place">${placeText(r)}</span>`;
  const pct = progressOf(r);
  return (
    `<div class="sp-row sp-st-${r.status}" data-spy-row="${r.id}">` +
    spyPortraitSvg(faceOf(r.id), spyLevel(xpOf(r.id))) +
    `<b class="sp-name">${esc(t(`spy.callsign.${r.callsign}`))}</b>` +
    `<span class="sp-line"><i class="sp-dot"></i><span class="sp-doing">${esc(statusText(r))}</span>${place}</span>` +
    (r.until !== null ? `<span class="sp-time">⏳ ${liveTimerHtml(r.until, 'hceil')}</span>` : '') +
    btn +
    (pct !== null ? `<i class="sp-bar" style="width:${pct}%"></i>` : '') +
    `</div>`
  );
}

/** Окна разведки и журнал донесений — как было во вкладке дипломатии (SPY-UX, SPY-20). */
function intelHtml(): string {
  const windows = game
    .myIntel()
    .sort((a, b) => a.until - b.until)
    .map(
      (g) =>
        `<div class="in-row" data-iw="${esc(g.target)}"><span class="in-k">🗝</span>` +
        `<b>${esc(t('log.spy.what.world', { at: game.placeName(g.target) }))}</b>` +
        `<span class="in-t">⏳ ${liveTimerHtml(g.until, 'hceil')}</span><span class="in-go">↪</span></div>`,
    )
    .join('');
  const log = spyLog
    .map(
      (e) =>
        `<div class="in-log"${e.planetId ? ` data-iw="${esc(e.planetId)}"` : ''}>` +
        `<span class="in-k">${spyOpGlyph(e.op)}</span> ${gameStamp(e.at)} · ${esc(e.text)}` +
        `${e.planetId ? ' <span class="in-go">↪</span>' : ''}</div>`,
    )
    .join('');
  // Пустой раздел не рисуется: без окон остаётся одна строка-подсказка, журнал появляется
  // с первой записью.
  return (
    (windows
      ? `<div class="in-sec">${t('spy.windows.title')}</div>${windows}`
      : `<div class="in-empty">${t('spy.windows.empty')}</div>`) +
    (log ? `<div class="in-sec">${t('spy.log.title')}</div>${log}` : '')
  );
}

function rosterHtml(): string {
  const list = rows();
  const head = target ? t('spy.win.target', { at: game.placeName(target) }) : t('spy.win.title');
  const free = list.filter((r) => r.action === 'assign').length;
  const count = list.length ? `<span class="sp-count">${t('spy.win.free', { n: free, m: list.length })}</span>` : '';
  return (
    `<div class="dpbox spbox"><div class="dp-head"><b class="sp-title">${esc(head)}</b>${count}` +
    `<button class="dp-close btn-x" data-spy-close>✕</button></div>` +
    `<div class="dp-list sp-list">` +
    (list.length ? list.map(rowHtml).join('') : `<div class="in-empty">${t('spy.empty')}</div>`) +
    (target ? '' : intelHtml()) +
    `</div></div>`
  );
}

/** Разведка и контрразведка тихие; остальные операции ядро считает агрессивными. */
const isHot = (task: SpyTask): boolean => task !== 'relocate' && task !== 'counter' && task !== 'recon';
const glyphOf = (task: SpyTask): string => (task === 'relocate' ? '🧭' : spyOpGlyph(task));

function cardHtml(task: SpyTask, spy: number): string {
  const block = blockOf(task, spy, target);
  const cost = costOf(task);
  const price = cost > 0 ? t('spy.task.cost', { c: cost }) : t('spy.task.free');
  const time = task === 'relocate' ? '' : ` · ${t('spy.task.hours', { n: MISSION_HOURS })}`;
  return (
    `<button class="sp-card"${isHot(task) ? ' data-hot' : ''} data-spy-task="${task}"${block ? ' disabled' : ''}>` +
    `<span class="sp-glyph" aria-hidden="true">${glyphOf(task)}</span>` +
    `<b>${esc(taskName(task))}</b>` +
    `<span class="sp-desc">${esc(t(`spy.task.${task}.desc`))}</span>` +
    `<span class="sp-cost">${block ? esc(t(`spy.block.${block}`)) : `${price}${time}`}</span>` +
    `</button>`
  );
}

/**
 * Телефон (заказ владельца 2026-11-17): восемь плиток 4×2 — значок, короткое имя, цена.
 * Тап выбирает задание, панель ниже даёт описание, цену, срок и кнопку дальше. Задание,
 * невозможное на выбранном мире, выбрать можно: панель скажет почему, кнопка погашена.
 * На ПК плиток не видно (CSS), там карточки с описаниями.
 */
function tileTask(spy: number): SpyTask {
  if (tileSel) return tileSel;
  return (['recon', ...SPY_TASKS] as SpyTask[]).find((task) => !blockOf(task, spy, target)) ?? 'recon';
}

function tilesHtml(spy: number): string {
  const sel = tileTask(spy);
  const tiles = SPY_TASKS.map((task) => {
    const cls = `sp-tile${task === sel ? ' sp-on' : ''}${blockOf(task, spy, target) ? ' sp-off' : ''}`;
    return (
      `<button class="${cls}"${isHot(task) ? ' data-hot' : ''} data-spy-sel="${task}" aria-pressed="${task === sel}">` +
      `<span class="sp-glyph" aria-hidden="true">${glyphOf(task)}</span>` +
      `<span class="sp-tn">${esc(t(`spy.task.${task}.short`))}</span>` +
      `<span class="sp-tp">${t('spy.task.cost', { c: costOf(task) })}</span></button>`
    );
  }).join('');
  const block = blockOf(sel, spy, target);
  const cost = costOf(sel);
  const chips =
    `<span class="sp-chip">${cost > 0 ? t('spy.task.cost', { c: cost }) : t('spy.task.free')}</span>` +
    (sel === 'relocate' ? '' : `<span class="sp-chip">${t('spy.task.hours', { n: MISSION_HOURS })}</span>`);
  return (
    `<div class="sp-tiles">${tiles}</div>` +
    `<div class="sp-detail"${isHot(sel) ? ' data-hot' : ''}>` +
    `<div class="sp-dh"><span aria-hidden="true">${glyphOf(sel)}</span><b>${esc(taskName(sel))}</b>` +
    `<span class="sp-tag">${t(isHot(sel) ? 'spy.task.kind.hot' : 'spy.task.kind.quiet')}</span></div>` +
    `<p class="sp-dd">${esc(t(`spy.task.${sel}.desc`))}</p>` +
    (block ? `<p class="sp-why">${esc(t(`spy.block.${block}`))}</p>` : `<div class="sp-chips">${chips}</div>`) +
    `<button class="b btn-main sp-go" data-spy-go="${sel}"${block ? ' disabled' : ''}>${t(target ? 'spy.btn.send' : 'spy.btn.pick-world')}</button>` +
    `</div>`
  );
}

/** Окно «Дать задание»: фото, имя и занятие шпиона в шапке, ниже карточки заданий. */
function tasksHtml(spy: number): string {
  const sub = target ? t('spy.win.target', { at: game.placeName(target) }) : statusText(rows().find((r) => r.id === spy)!);
  return (
    `<div class="dpbox spbox"><div class="dp-head sp-head-who"><button class="b btn-second sp-back" data-spy-back>‹</button>` +
    spyPortraitSvg(faceOf(spy), spyLevel(xpOf(spy))) +
    `<span class="sp-who"><b class="sp-title">${esc(nameOf(spy))}</b><span class="sp-sub">${esc(sub)}</span></span>` +
    `<button class="dp-close btn-x" data-spy-close>✕</button></div>` +
    `<div class="sp-cards">${SPY_TASKS.map((task) => cardHtml(task, spy)).join('')}</div>` +
    tilesHtml(spy) +
    `</div>`
  );
}

function askHtml(): string {
  if (!ask) return '';
  const name = esc(nameOf(ask.spy));
  if (ask.kind === 'cancel') {
    return `<div class="sp-ask"><p>${t('spy.ask.cancel', { name })}</p>${askButtons()}</div>`;
  }
  const odds = spyOddsFor(ask.planetId, ask.task);
  const facts = [
    tripText(ask.spy, ask.planetId),
    costOf(ask.task) > 0 ? t('spy.task.cost', { c: costOf(ask.task) }) : '',
    odds ? t('side.scan.odds', { s: oddsPct(odds.success), r: oddsPct(odds.risk) }) : '',
  ].filter(Boolean);
  return (
    `<div class="sp-ask"><p>${t('spy.ask.send', { name, at: esc(game.placeName(ask.planetId)), task: esc(taskName(ask.task)) })}</p>` +
    (facts.length ? `<p class="sp-facts">${facts.join(' · ')}</p>` : '') +
    askButtons() +
    `</div>`
  );
}
/** Сколько шпион пробудет в пути до мира, игровыми часами вверх; пусто — он уже там. */
function tripText(spy: number, planetId: string): string {
  const s = game.state();
  const rules = ctx(s.time, s);
  const ms = spyTravelMs(s, rules, game.me(), spy, planetId);
  if (!ms) return '';
  const hourMs = HOUR / (rules.config?.timeScale ?? 1);
  return t('spy.ask.trip', { n: Math.max(1, Math.ceil(ms / hourMs)) });
}
const askButtons = () =>
  `<div class="sp-yesno"><button class="b" data-spy-yes>${t('spy.ask.yes')}</button>` +
  `<button class="b btn-second" data-spy-no>${t('spy.ask.no')}</button></div>`;

// --- отрисовка ---------------------------------------------------------------

let drawn = '';
let drawnBar = '';

function render(): void {
  const win = document.getElementById('spywin');
  const bar = document.getElementById('spypick');
  if (!win || !bar) return;
  const html = step.kind === 'roster' ? rosterHtml() : step.kind === 'tasks' ? tasksHtml(step.spy) : '';
  // Вопрос «Да / Нет» всегда в окне: во время выбора мира окно держит только его.
  const full = html + askHtml();
  win.classList.toggle('show', full !== '');
  if (full !== drawn) win.innerHTML = drawn = full;
  bar.classList.toggle('show', step.kind === 'pick' && ask === null);
  const barHtml =
    step.kind === 'pick'
      ? `<span>${t('spy.pick.title', { task: esc(taskName(step.task)), name: esc(nameOf(step.spy)) })}</span>` +
        `<button class="b btn-second" data-spy-pick-cancel>${t('spy.pick.cancel')}</button>`
      : '';
  if (barHtml !== drawnBar) bar.innerHTML = drawnBar = barHtml;
  patchLiveTimers(win, game.state().time, LIVE);
}

/** Открыть список шпионов; `planetId` — мир карточки, с которой его открыли (правило 4). */
export function openSpyWindow(planetId: string | null = null): void {
  if (!espionageShown(game.sectorZeroToolsHidden())) return;
  target = planetId;
  step = { kind: 'roster' };
  ask = null;
  render();
}

export function closeSpyWindow(): void {
  step = { kind: 'closed' };
  ask = null;
  target = null;
  render();
}

/** Идёт ли выбор мира для задания: тап по карте тогда принадлежит окну. */
export function spyPicking(): boolean {
  return step.kind === 'pick' && ask === null;
}

/** Тап по карте во время выбора мира: мир под пальцем или `null`, если мимо. */
export function spyPickTap(planetId: string | null): void {
  if (step.kind !== 'pick' || ask) return;
  if (!planetId) return;
  const block = blockOf(step.task, step.spy, planetId);
  if (block) return game.note(t(`spy.block.${block}`));
  ask = { kind: 'send', spy: step.spy, task: step.task, planetId };
  render();
}

/** Двери для `main.ts`: кадр (`live` — открытому окну нужна перерисовка по таймеру) и две ступени лестницы «Назад» (BACK-1): выбор мира на
 *  карте (полоса сверху) и само окно. «Назад» на любой из них закрывает выдачу задания. */
export const spyWindow = {
  live: () => step.kind !== 'closed',
  pickOpen: () => step.kind === 'pick',
  winOpen: () => step.kind === 'roster' || step.kind === 'tasks',
  close: () => closeSpyWindow(),
  refresh: () => refreshSpyWindow(),
  archive: () => spyArchive(),
  restore: (records?: readonly SpyRecord[]) => restoreSpyArchive(records),
};

/** Перерисовка по таймеру (`liveWindows.ts`): пересборка только при перемене. */
export function refreshSpyWindow(): void {
  if (step.kind === 'closed') return;
  if (!espionageShown(game.sectorZeroToolsHidden())) return closeSpyWindow();
  render();
}

// --- журнал донесений (SPY-20) -------------------------------------------------

// Архив донесений шпионажа (моих и контрразведки по мне): новые сверху, правила —
// `decisions/spyArchive.ts`. Событие `type`/`payload` даёт записи мир и вид операции.
let spyLog: SpyRecord[] = [];
export function pushSpyLog(text: string, type = '', payload: Record<string, unknown> = {}): void {
  spyLog = pushSpyRecord(spyLog, spyRecordOf(type, payload, game.state().time, text));
  refreshSpyWindow();
}
/** Строка ленты и журнала о пути своего шпиона (`decisions/spyJourney.ts`); `null` —
 *  событие не о моём шпионе или не о пути. */
export function spyJourneyLine(type: string, p: Record<string, unknown>): string | null {
  const key = spyJourneyKey(type, p, game.me());
  if (!key) return null;
  const id = typeof p.spyId === 'number' ? p.spyId : 0;
  const task = p.kind ?? p.op;
  return t(key, {
    who: nameOf(id) || t('log.spy.who'),
    at: typeof p.planetId === 'string' ? game.placeName(p.planetId) : '',
    task: typeof task === 'string' ? taskName(task as SpyDoing) : '',
  });
}
/** Отправка и путь своего шпиона — в ленту `note` и в журнал; `true`, если событие об этом
 *  (тогда лента дальше его не разбирает). SPY-8: на операцию — с её длительностью. */
export function tellSpyJourney(type: string, p: Record<string, unknown>, note: (text: string) => void): boolean {
  if (type !== 'espionage.sent' && !(SPY_JOURNEY_EVENTS as readonly string[]).includes(type)) return false;
  if (type === 'espionage.sent' && p.owner === game.me() && p.op !== 'relocate') {
    const at = game.placeName(String(p.planetId));
    note(t('log.spy.sent', { at, n: MISSION_HOURS }));
    pushSpyLog(t('log.spy.sent.short', { at }), type, p);
    return true;
  }
  const line = spyJourneyLine(type, p);
  if (line) {
    note(line);
    pushSpyLog(line, type, p);
  }
  return true;
}
/** Архив для сейва схватки. */
export function spyArchive(): SpyRecord[] {
  return [...spyLog];
}
/** Поставить архив: из сейва — его записи, в новой партии — пустой. */
export function restoreSpyArchive(records: readonly SpyRecord[] = []): void {
  spyLog = [...records];
}

// --- нажатия -----------------------------------------------------------------

function answer(yes: boolean): void {
  const q = ask;
  ask = null;
  if (!q) return;
  if (q.kind === 'cancel') {
    if (yes) game.playerOrder(cancelSpy(game.me(), q.spy));
    return render();
  }
  if (!yes) return render(); // «Нет» — назад к выбору мира (или к карточкам, если мир уже был)
  if (game.playerOrder(spyOn(game.me(), q.planetId, q.task, q.spy))) return closeSpyWindow();
  render();
}

function chooseTask(task: SpyTask, spy: number): void {
  if (target) {
    if (blockOf(task, spy, target)) return;
    ask = { kind: 'send', spy, task, planetId: target };
  } else {
    step = { kind: 'pick', spy, task };
  }
  render();
}

function onClick(e: Event): void {
  const tg = e.target as HTMLElement;
  const data = (sel: string, key: string) => (tg.closest(sel) as HTMLElement | null)?.dataset[key];
  if (tg.id === 'spywin' && !ask) return closeSpyWindow();
  if (tg.closest('[data-spy-close]')) return closeSpyWindow();
  if (tg.closest('[data-spy-yes]')) return answer(true);
  if (tg.closest('[data-spy-no]')) return answer(false);
  if (tg.closest('[data-spy-pick-cancel]')) return closeSpyWindow();
  if (tg.closest('[data-spy-back]')) {
    step = { kind: 'roster' };
    return render();
  }
  const assign = data('[data-spy-assign]', 'spyAssign');
  if (assign) {
    step = { kind: 'tasks', spy: Number(assign) };
    tileSel = null;
    return render();
  }
  const cancel = data('[data-spy-cancel]', 'spyCancel');
  if (cancel) {
    ask = { kind: 'cancel', spy: Number(cancel) };
    return render();
  }
  const sel = data('[data-spy-sel]', 'spySel');
  if (sel && step.kind === 'tasks' && (SPY_TASKS as readonly string[]).includes(sel)) {
    tileSel = sel as SpyTask;
    return render();
  }
  const task = data('[data-spy-task]', 'spyTask') ?? data('[data-spy-go]', 'spyGo');
  if (task && step.kind === 'tasks' && (SPY_TASKS as readonly string[]).includes(task)) {
    return chooseTask(task as SpyTask, step.spy);
  }
  const iw = data('[data-iw]', 'iw');
  if (iw) {
    closeSpyWindow(); // карта должна быть видна — перелетаем к миру из окна разведки
    game.focusWorld(iw);
  }
}

/** Кнопка «Шпионаж» во вторичном меню (рядом с «Сообщениями», `build.mjs`), окно и полоса
 *  выбора мира. */
export function initSpyWindow(host: SpyWindowHost): void {
  game = host;
  for (const id of ['spywin', 'spypick']) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      document.body.appendChild(el);
    }
    el.addEventListener('click', onClick);
  }
  document.getElementById('rail-spy')?.addEventListener('click', () => openSpyWindow());
}
