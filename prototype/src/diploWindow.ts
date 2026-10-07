/**
 * Окно дипломатии и связи — у одного владельца (REFM-214, второй PR): ростер мест с
 * сортировкой и фильтрами, полоса расположения бота, кнопки стоек и договора карт,
 * карточка места и своя карточка, вкладка и журнал разведки, вкладка сообщений с
 * составлением реплики и метки, разница дипломатии между снимками сервера.
 *
 * Всё это жило в `main.ts` пятью кусками. Состояние окна (открыто ли, вкладка, сортировка,
 * раскрытая строка, фильтры) теперь пишут только функции модуля: `main.ts` читает
 * {@link diploOpen} и {@link diploTab} живыми привязками (`export let`), а открывает и
 * закрывает окно дверями {@link openDiplo} и {@link closeDiplo}. Журнал разведки пишет
 * одна дверь {@link pushSpyLog}.
 *
 * Ленту сообщений модуль не держит: ею владеет `messageLog.ts` (первый PR кирпича), окно
 * её только читает и пишет через двери владельца.
 *
 * Разница снимков {@link diffNetDiplomacy} досказывает дипломатию, пропущенную в обрыве
 * связи. Когда её звать, решает вход (`decisions/netWelcome.ts`, правило 6): живые новости
 * приезжают событиями дельты, как в соло.
 *
 * Мир, место игрока, имена, цвета сторон, приказы, камера, метки на карте, досье аккаунта
 * и плавающий чат живут в `main.ts`; модуль получает их хуками {@link initDiploWindow} —
 * импорт оттуда был бы циклом.
 */
import { espionageShown } from '../../decisions/sectorZeroTools';
import { t, tData } from '../../localization/runtime';
import {
  getOffer,
  getStance,
  isForkSite,
  type Action,
  type DiplomaticStance,
  type GameState,
  type IntelGrant,
} from '../../packages/shared-core/src/index';
import { isOrdnanceFleet } from '../../packages/shared-core/src/state/ordnance';
import { COALITION, initConversations, type StampOpts } from './conversations';
import { diploIntent } from './diploClick';
import { diploDelivery } from './diploDelivery';
import { diffDiplomacy, STANCES } from './diploEvents';
import { clockHM, esc, fmtEta, gameDay, gameStamp, kfmt, resLine } from './format';
import {
  botFavour,
  data,
  declareWar,
  FAVOUR_BASE,
  FAVOUR_EMBARGO,
  FAVOUR_WAR,
  hasMapShare,
  hasMapShareOffer,
  HOUR,
  shareMap,
  spyOn,
  STANCE_RANK,
} from './game';
import { grantLeftMs, pushSpyEntry, SPY_COST, type SpyEntry } from './intel';
import { selPlanet } from './interaction';
import { dispatchChat, markUnread, pushMsg, readMessages, sessionMessages } from './messageLog';
import { offerAffordance, offerClass, offerDisabled, offerMark } from './offerAffordance';
import { pingRoute } from './relayIntake';
import { seatBadgeOf, seatKind } from './seatBadge';
import { factionBonusLine } from './setupScreen';
import { houseDisplayName } from './setupSeats';

/** Что окну нужно от игры. Мир, имена, цвета, приказы и карта живут в `main.ts`. */
export interface DiploWindowHost {
  /** Мир, который видит игрок (в сети — снимок сервера). */
  state(): GameState;
  /** Место игрока. */
  me(): string;
  /** Идёт сетевая партия: правду о местах держит сервер. */
  net(): boolean;
  /** Сетевой клиент поднят: метку ставит сервер (`pingRoute`). */
  online(): boolean;
  /** Имена мест: позывной человека или дом бота. */
  names(): Readonly<Record<string, string>>;
  /** Запасной признак бота для сценариев соло: место ведёт локальный ИИ. */
  localAi(id: string): boolean;
  /** Места матча по порядку: фракция своего места, пока её не проштамповал старт. */
  seats: ReadonlyArray<{ id: string; faction: string }>;
  /** Сколько очков нужно для победы на этой карте. */
  scoreLimit(): number;
  /** Счёт боёв партии: уничтожено и потеряно. */
  killStats(): { destroyed: number; lost: number };
  /** Цвет стороны на карте. */
  ownerColor(owner: string): string;
  /** Цвет чипа стойки, из той же палитры. */
  stanceCol(st: DiplomaticStance): string;
  /** Мои живые окна разведки. */
  myIntel(): IntelGrant[];
  /** Имя провинции. */
  placeName(id: string): string;
  /** Строка ленты событий. */
  note(text: string): void;
  /** Приказ игрока: в сети — серверу, в соло — миру. */
  playerOrder(action: Action): boolean;
  /** Подсказка при первом открытии окна. */
  maybeIntro(id: string): void;
  /** Забег Sector Zero прячет инструменты основной игры, шпионаж в их числе. */
  sectorZeroToolsHidden(): boolean;
  /** Метка провинции через сервер. */
  sendProvincePing(loc: string, label: string): void;
  /** Перелететь к миру, оставив выбор игрока. */
  focusWorld(id: string): void;
  /** Перелететь к миру из текста метки и выбрать его. */
  jumpToPing(id: string): void;
  /** Досье аккаунта: чужое по логину, без логина — своё. */
  openProfile(login?: string): void;
  /** Перерисовать плавающий чат, если он открыт. */
  refreshChat(): void;
}

let game: DiploWindowHost;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Total count across a stack of units (ships, garrison or landing troops). */
const sumUnits = (stacks: ReadonlyArray<{ count: number }>): number =>
  stacks.reduce((a, s) => a + s.count, 0);

export let diploOpen = false;
export let diploTab: 'diplo' | 'msgs' | 'intel' = 'diplo';
let diploSort: 'name' | 'worlds' | 'stance' = 'stance';
let diploExpanded: string | null = null; // participant row showing its action buttons
// Roster filters (alongside sort): show only seats matching the picked stance(s) and
// type(s). Empty set = no constraint from that category. They AND across categories,
// OR within one. A stance filter excludes your own seat (you have no self-stance).
const diploStanceFilter = new Set<DiplomaticStance>();
const diploTypeFilter = new Set<'human' | 'ai'>();

// SPY-UX: сессионный журнал исходов шпионажа (моих и контрразведки по мне) — питает
// вкладку «Шпионаж» в дипломатии. Хранит уже локализованную строку.
const spyLog: SpyEntry[] = [];
export function pushSpyLog(text: string): void {
  pushSpyEntry(spyLog, { at: game.state().time, text });
  if (diploOpen && diploTab === 'intel') renderDiplo();
}

// --- player card (tap the top-left crest) ------------------------------------
/** Your dossier in this session: faction, worlds, fleets, score, and the treasury.
 *  Opened by tapping the crest in the top-left corner. */
function playerCardHtml(): string {
  const s = game.state();
  const ME = game.me();
  const NAME = game.names();
  const SCORE_LIMIT = game.scoreLimit();
  const killStats = game.killStats();
  const pl = s.players[ME];
  const name = NAME[ME] ?? houseDisplayName(pl?.name ?? ME);
  // H3: the LIVE faction (chosen at setup, stamped on the player) — name + its passive.
  const fid = pl?.faction ?? game.seats.find((m) => m.id === ME)?.faction ?? '';
  const fdef = data.factions[fid];
  const bonus = factionBonusLine(fid);
  const faction = fdef ? `${tData(fdef.name)}${bonus ? ` · ${bonus}` : ''}` : fid || '—';
  const worlds = Object.values(s.planets).filter((p) => p.owner === ME && !isForkSite(p)).length;
  // Total units you command: ships + carried troops across your fleets, plus every
  // garrison on your worlds.
  let units = 0;
  for (const f of Object.values(s.fleets))
    if (f.owner === ME && !isOrdnanceFleet(f, data))
      units += sumUnits(f.units) + sumUnits(f.landing ?? []);
  for (const pp of Object.values(s.planets)) if (pp.owner === ME) units += sumUnits(pp.garrison);
  const score = Math.round(s.match?.scores?.[ME]?.total ?? 0);
  const need = Math.max(0, SCORE_LIMIT - score);
  const col = game.ownerColor(ME);
  const row = (k: string, v: string) =>
    `<div class="pc-row"><span class="pc-k">${k}</span><span class="pc-v">${v}</span></div>`;
  return (
    `<div class="pc-head"><span class="pc-dia" style="background:${col};box-shadow:0 0 10px ${col}"></span>` +
    `<b>${esc(name)}</b><span class="pc-tag">${t('card.commander')}</span></div>` +
    `<div class="pc-stats">` +
    row(t('card.faction'), esc(faction)) +
    row(t('card.worlds'), String(worlds)) +
    row(t('card.units'), String(units)) +
    row(
      t('card.score'),
      `${score} / ${SCORE_LIMIT}${need === 0 ? ' · ★ ' + t('card.score.goal') : ''}`,
    ) +
    `</div><div class="pc-sec">${t('card.combat')}</div><div class="pc-stats">` +
    row(t('card.kills'), kfmt(killStats.destroyed)) +
    row(t('card.losses'), kfmt(killStats.lost)) +
    // This card is the MATCH dossier (it dies with the session); the career one
    // lives in the account. One tap between them instead of two similar screens.
    `</div><button class="pc-dossier">${t('card.dossier')}</button>` +
    `<button class="pc-close">${t('card.close')}</button>`
  );
}
export function openPlayerCard(): void {
  const el = document.getElementById('playercard');
  if (!el) return;
  delete el.dataset.seat; // your own dossier — the seat-card handler must stay dormant
  el.innerHTML = `<div class="pcbox">${playerCardHtml()}</div>`;
  el.classList.add('show');
}
/** Another player's card, opened by tapping their name in a chat line: their stance,
 *  worlds, a bot's favour meter, and the same diplomacy actions as the roster row.
 *  Reuses the #playercard overlay; `dataset.seat` tells its click handler which seat
 *  the stance/spy/message buttons target. */
function seatCardHtml(id: string): string {
  const s = game.state();
  const ME = game.me();
  const NAME = game.names();
  const bdg = seatBadge(id);
  const col = game.ownerColor(id);
  const st = getStance(s, ME, id);
  const favBar = isAiSeat(id) ? favourBarHtml(id) : '';
  const row = (k: string, v: string) =>
    `<div class="pc-row"><span class="pc-k">${k}</span><span class="pc-v">${v}</span></div>`;
  return (
    `<div class="pc-head"><span class="pc-dia" style="background:${col};box-shadow:0 0 10px ${col}"></span>` +
    `<b>${esc(NAME[id] ?? id)}</b><span class="pc-tag">${esc(bdg.tag)}</span></div>` +
    `<div class="pc-stats">` +
    row(
      t('card.stances'),
      `<span class="dp-stance" style="color:${game.stanceCol(st)};border-color:${game.stanceCol(st)}">${stanceRu(st)}</span>`,
    ) +
    row(t('card.worlds'), String(worldsOf(id))) +
    `</div>` +
    (favBar ? `<div class="pc-stats">${favBar}</div>` : '') +
    `<div class="pc-sec">${t('card.diplomacy')}</div>` +
    seatDiploActionsHtml(id) +
    (!isAiSeat(id) ? `<button class="pc-dossier">${t('card.dossier')}</button>` : '') +
    `<button class="pc-close">${t('card.close')}</button>`
  );
}
export function openSeatCard(id: string): void {
  if (id === game.me() || !game.state().players[id]) return void openPlayerCard();
  const el = document.getElementById('playercard');
  if (!el) return;
  el.dataset.seat = id;
  el.innerHTML = `<div class="pcbox">${seatCardHtml(id)}</div>`;
  el.classList.add('show');
}
/** Repaint the open seat card after a diplomacy action, plus any other surface that
 *  shows the same stance (the roster / the floating chat feed). */
function refreshSeatCard(id: string): void {
  const el = document.getElementById('playercard');
  if (el && el.dataset.seat === id) el.innerHTML = `<div class="pcbox">${seatCardHtml(id)}</div>`;
  if (diploOpen) renderDiplo();
  game.refreshChat();
}

// --- session diplomacy & comms menu ------------------------------------------
// Opened from the left rail (Diplomacy / Dispatches). Two tabs: the participant
// roster (icon = human vs AI, sortable by name / provinces / stance, with stance
// actions) and the session message log. Stances run through the core's
// `diplomacy.declare`; messages are a client-side session log (SessionMsg).
const STANCE_RU: Record<DiplomaticStance, string> = {
  war: 'diplo.stance.war',
  peace: 'diplo.stance.peace',
  pact: 'diplo.stance.pact',
  alliance: 'diplo.stance.alliance',
};
/** Localized stance label (canonical Russian msgid → the locale translates). */
export function stanceRu(st: DiplomaticStance): string {
  return t(STANCE_RU[st]);
}

export function worldsOf(id: string): number {
  let n = 0;
  for (const p of Object.values(game.state().planets)) if (p.owner === id && !isForkSite(p)) n++;
  return n;
}
/** A seat the AI drives. Everyone else (ME, or another human in net play) is human —
 *  this drives the roster's human/AI icon and whether a proposal is auto-decided. */
export function isAiSeat(id: string): boolean {
  // The authoritative flag lives in state (Player.ai, seeded by newGame). The local
  // AI_PLAYERS set stays only as a local-mode fallback for installed scenarios; in
  // NET play the server state is the single source — a human-claimed seat is human.
  return game.state().players[id]?.ai === true || (!game.net() && game.localAi(id));
}
/** Seats taking part in the match, in the fixed seat order. */
export function diploSeats(): string[] {
  return Object.keys(game.state().players);
}
/** Message stamp. Defaults to «День N, ЧЧ:ММ» (game day + game time, `gameStamp`); the
 *  chat passes toggles to add/drop fields and append the real wall-clock. */
export function fmtStamp(at: number, opts?: StampOpts): string {
  const o = opts ?? { day: true, time: true };
  const p2 = (n: number) => String(n).padStart(2, '0');
  const parts: string[] = [];
  // День и время суток — `format.ts` (REFM-136): счёт дней с единицы и остатки суток/часа
  // одинаковы во всех четырёх местах, где игрок читает игровое время.
  if (o.day && o.time) parts.push(gameStamp(at));
  else if (o.day) parts.push(t('hud.day', { d: gameDay(at) }));
  else if (o.time) parts.push(clockHM(at));
  if (o.real && o.realAt != null) {
    const dt = new Date(o.realAt);
    parts.push(`⌚${p2(dt.getHours())}:${p2(dt.getMinutes())}`);
  }
  return parts.join(' ');
}

/** Live diplomacy reaches a NET client as events (the server's fog passes them to both
 *  sides, BF-15/16) and goes through `handleEvents`, as in solo. Events lost while the
 *  socket was down are not replayed, so a reconnect diffs the stance map AND the offer
 *  ledger of the last and the fresh snapshot for pairs with ME and surfaces changes
 *  through the note/DM path. WHEN to diff is `netWelcome.ts`'s call (rule 6).
 *  Returns true when something shifted — the CALLER re-renders the roster after
 *  it assigns the new state (rendering here would paint from the old `s`). */
export function diffNetDiplomacy(prev: GameState, next: GameState): boolean {
  const NAME = game.names();
  const events = diffDiplomacy(prev, next, game.me());
  for (const ev of events) {
    const who = NAME[ev.other] ?? ev.other;
    const stance = stanceRu(ev.stance);
    // Куда уходит событие и какими словами — `diploDelivery.ts` (REFM-174): война зовётся
    // своим текстом, сдвиг и ВХОДЯЩЕЕ предложение идут в ленту, в тред и в счётчик
    // непрочитанных, а своё ИСХОДЯЩЕЕ — только в ленту.
    const d = diploDelivery(ev.kind, ev.stance, ev.other);
    game.note(d.noteNeedsStance ? t(d.noteKey, { who, stance }) : t(d.noteKey, { who }));
    if (d.message) pushMsg(ev.other, t(d.message.key, { stance }), true, d.message.from);
    if (d.unread) markUnread();
  }
  // Перерисовку ростера решает вызывающий — ОДИН раз на всю пачку, а не на событие.
  return events.length > 0;
}

/** Player-driven stance change toward `target`. Escalation (toward war) is
 *  unilateral; warming the relation up files an OFFER the target must answer with
 *  the same declaration (consent — game.ts diplomacyModule). A bot answers on the
 *  spot by its favour meter; a human sees the offer in their roster (NET: the offer
 *  ledger rides the fogged delta) and taps the highlighted stance to accept. */
function proposeStance(target: string, to: DiplomaticStance): void {
  const s = game.state();
  const ME = game.me();
  if (target === ME || !s.players[target]) return;
  if (getStance(s, ME, target) === to) return;
  if (to === 'alliance' && isAiSeat(target)) {
    game.note(t('comms.bots-no-coalition'));
    return;
  }
  // diplomacy.declare escalates / files the offer / commits a matching counter-offer;
  // feedback comes back uniformly via handleEvents (solo and NET alike).
  game.playerOrder(declareWar(ME, target, to));
}

/** MAPSHARE-1: один тап — предложить, принять или расторгнуть. Что именно, решает
 *  ядро по текущему состоянию договора; клиент лишь называет сторону и «включить/нет». */
function toggleMapShare(target: string): void {
  const s = game.state();
  const ME = game.me();
  if (target === ME || !s.players[target]) return;
  game.playerOrder(shareMap(ME, target, !hasMapShare(s, ME, target)));
}

export function openDiplo(tab: 'diplo' | 'msgs' | 'intel'): void {
  diploOpen = true;
  diploTab = tab;
  renderDiplo();
  document.getElementById('diplo')?.classList.add('show');
}
export function closeDiplo(): void {
  diploOpen = false;
  document.getElementById('diplo')?.classList.remove('show');
}

/** Значок и ГОТОВАЯ подпись места — `seatBadge.ts` (REFM-202). Подпись приходит текстом,
 *  а не ключом: раньше отсюда выходил ключ, и три места печатали его напрямую, минуя
 *  `t()`, — игрок видел буквально «comms.you» вместо «ВЫ». */
export function seatBadge(id: string): { icon: string; tag: string } {
  return seatBadgeOf(seatKind(id === game.me(), isAiSeat(id)));
}

/** Does a seat pass the active roster filters? Stance filter never matches ME (no
 *  self-stance); an empty category imposes no constraint. */
function diploPasses(id: string): boolean {
  const ME = game.me();
  if (diploStanceFilter.size) {
    if (id === ME || !diploStanceFilter.has(getStance(game.state(), ME, id))) return false;
  }
  if (diploTypeFilter.size && !diploTypeFilter.has(isAiSeat(id) ? 'ai' : 'human')) return false;
  return true;
}
/** A bot's approval-of-you meter (game.ts botDiplomacyModule). A bot only ever sits at
 *  ≤ FAVOUR_BASE, so a full bar = its passive-friendly baseline; your aggression drains it
 *  past the embargo tick (won't trade on the market) and then the war tick (declares war).
 *  Only shown for AI seats — humans have no favour meter. */
function favourBarHtml(bot: string): string {
  const f = botFavour(game.state(), bot, game.me());
  const pct = clamp(f / FAVOUR_BASE, 0, 1) * 100;
  const embPct = (FAVOUR_EMBARGO / FAVOUR_BASE) * 100;
  const warPct = (FAVOUR_WAR / FAVOUR_BASE) * 100;
  const tier = f < FAVOUR_WAR ? 'war' : f < FAVOUR_EMBARGO ? 'embargo' : 'ok';
  const label =
    tier === 'war'
      ? t('comms.favour.brink')
      : tier === 'embargo'
        ? t('comms.favour.embargo')
        : t('comms.favour.friendly');
  const title = t('comms.favour.note', {
    f: Math.round(f),
    base: FAVOUR_BASE,
    label,
    emb: FAVOUR_EMBARGO,
    war: FAVOUR_WAR,
  });
  return (
    `<div class="dp-fav ${tier}" title="${esc(title)}">` +
    `<span class="dp-fav-cap">☺</span>` +
    `<div class="dp-fav-track"><div class="dp-fav-fill" style="width:${pct.toFixed(1)}%"></div>` +
    `<span class="dp-fav-tick emb" style="left:${embPct.toFixed(1)}%"></span>` +
    `<span class="dp-fav-tick war" style="left:${warPct.toFixed(1)}%"></span></div>` +
    `<span class="dp-fav-lbl">${label}</span></div>`
  );
}
/** Live stolen-intel readout for one seat (under its expanded actions): the
 *  treasury window prints the victim's actual resources, a fleets window says the
 *  map shows them, planet windows list the scanned worlds. Empty when nothing lives. */
function intelRowHtml(target: string): string {
  const s = game.state();
  const bits: string[] = [];
  for (const g of game.myIntel()) {
    const left = fmtEta(grantLeftMs(g, s.time) / HOUR);
    if (g.kind === 'treasury' && g.target === target) {
      const r = s.players[target]?.resources ?? {};
      const bag = resLine(
        Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.floor(v as number)])),
      );
      bits.push(t('comms.intel.treasury', { bag: bag || '—', left }));
    } else if (g.kind === 'fleets' && g.target === target) {
      bits.push(t('comms.intel.fleets', { left }));
    } else if (g.kind === 'planet' && s.planets[g.target]?.owner === target) {
      bits.push(t('comms.intel.world', { id: esc(game.placeName(g.target)), left }));
    }
  }
  if (!bits.length) return '';
  return `<div class="dp-intel">🕵 ${bits.join(' · ')}</div>`;
}
/** The diplomacy affordances for one other seat `id`: stance proposals (with the
 *  consent state — их предложение ✓ / наше ⏳), the two spy buttons, and the DM
 *  button, followed by the live intel row. Shared by the roster's expanded row and
 *  the player card opened from a chat nick, so both stay in lockstep. */
/**
 * MAPSHARE-1 — кнопка договора об обмене картами. Отдельная от лестницы стоек, потому
 * что и сам договор отдельный: его заключают и при мире, и при пакте, и он не делает
 * союзником. Те же аффордансы согласия, что у смягчения стойки: их предложение — «✓»
 * (тап принимает), моё — «⏳» (ждём их), действующий договор — активная кнопка (тап
 * расторгает). При войне заключить нельзя — ядро отобьёт, поэтому и кнопка заперта.
 */
function mapShareBtnHtml(id: string): string {
  // Чей ход — `offerAffordance.ts` (REFM-201). ЗДЕСЬ подавитель — действующий договор:
  // висящее предложение при нём уже прошлое, и «✓ принять» предложило бы заключить
  // заключённое. Война же только ЗАПИРАЕТ кнопку, не гася пометок (так было и до выноса).
  const s = game.state();
  const ME = game.me();
  const NAME = game.names();
  const live = hasMapShare(s, ME, id);
  const atWar = !live && getStance(s, ME, id) === 'war';
  const aff = offerAffordance(live, hasMapShareOffer(s, id, ME), hasMapShareOffer(s, ME, id));
  const mark = offerMark(aff);
  const label = mark ? `${mark} ${t('comms.mapshare')}` : t('comms.mapshare');
  const title = atWar
    ? t('comms.mapshare.war')
    : live
      ? t('comms.mapshare.drop')
      : aff === 'accept'
        ? t('comms.offer.incoming', { who: NAME[id] ?? id })
        : aff === 'waiting'
          ? t('comms.offer.sent')
          : t('comms.mapshare.hint');
  const cls = offerClass('dp-map', live, aff);
  return `<button class="${cls}" data-mapseat="${id}"${offerDisabled(aff, atWar) ? ' disabled' : ''} title="${esc(title)}">🗺 ${label}</button>`;
}
function seatDiploActionsHtml(id: string): string {
  const s = game.state();
  const ME = game.me();
  const NAME = game.names();
  const st = getStance(s, ME, id);
  return (
    `<div class="dp-actions">` +
    STANCES.map((sk) => {
      const barred = sk === 'alliance' && isAiSeat(id); // боты не вступают в коалиции
      // Чей ход — `offerAffordance.ts` (REFM-201), та же формула, что у кнопки карт.
      // ЗДЕСЬ подавитель — запрет: предложить коалицию боту нельзя вовсе, поэтому и
      // аффорданса быть не должно. Текущая стойка помечается ОТДЕЛЬНО (`sk === st`).
      const aff = offerAffordance(barred, getOffer(s, id, ME) === sk, getOffer(s, ME, id) === sk);
      const mark = offerMark(aff);
      const cls = offerClass('dp-act', sk === st, aff);
      const label = mark ? `${mark} ${stanceRu(sk)}` : stanceRu(sk);
      const title = barred
        ? t('comms.bots-no-coalition')
        : aff === 'accept'
          ? t('comms.offer.incoming', { who: NAME[id] ?? id })
          : aff === 'waiting'
            ? t('comms.offer.sent')
            : '';
      return `<button class="${cls}" data-stance="${sk}" data-seat="${id}" style="--sc:${game.stanceCol(sk)}"${offerDisabled(aff, barred) ? ' disabled' : ''}${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    }).join('') +
    mapShareBtnHtml(id) +
    (espionageShown(game.sectorZeroToolsHidden())
      ? `<button class="dp-spy" data-spy="treasury" data-seat="${id}" title="${t('comms.spy.treasury', { c: SPY_COST })}">🕵 ${t('log.spy.kind.treasury')}</button>` +
        `<button class="dp-spy" data-spy="fleets" data-seat="${id}" title="${t('comms.spy.fleets', { c: SPY_COST })}">🕵 ${t('spy.op.fleets')}</button>`
      : '') +
    `<button class="dp-msg" data-msgseat="${id}">✉</button></div>` +
    intelRowHtml(id)
  );
}
function diploRowsHtml(): string {
  const s = game.state();
  const ME = game.me();
  const NAME = game.names();
  const others = diploSeats().filter((id) => id !== ME);
  const byName = (a: string, b: string) => (NAME[a] ?? a).localeCompare(NAME[b] ?? b);
  if (diploSort === 'name') others.sort(byName);
  else if (diploSort === 'worlds') others.sort((a, b) => worldsOf(b) - worldsOf(a) || byName(a, b));
  else
    others.sort(
      (a, b) => STANCE_RANK[getStance(s, ME, a)] - STANCE_RANK[getStance(s, ME, b)] || byName(a, b),
    );
  const ordered = [ME, ...others].filter(diploPasses);
  // Keep the expansion in sync with visibility: if a filter (or a stance/capture change
  // that re-renders) hides the expanded seat, drop the expansion — otherwise the row
  // re-opens itself when that seat later re-enters the list.
  if (diploExpanded && !ordered.includes(diploExpanded)) diploExpanded = null;
  if (!ordered.length) return `<div class="dp-empty">${t('comms.filter.empty')}</div>`;
  return ordered
    .map((id) => {
      const bdg = seatBadge(id);
      const col = game.ownerColor(id);
      const w = worldsOf(id);
      const isMe = id === ME;
      const st = isMe ? null : getStance(s, ME, id);
      const stanceTag = isMe
        ? `<span class="dp-tag">${t('comms.you')}</span>`
        : `<span class="dp-stance" style="color:${game.stanceCol(st!)};border-color:${game.stanceCol(st!)}">${stanceRu(st!)}</span>`;
      // Bots (AI seats) carry a favour meter toward you; humans/you don't.
      const favBar = !isMe && isAiSeat(id) ? favourBarHtml(id) : '';
      const expanded = diploExpanded === id && !isMe;
      const actions = expanded ? seatDiploActionsHtml(id) : '';
      return (
        `<div class="dp-row${expanded ? ' open' : ''}${isMe ? ' me' : ''}"${isMe ? '' : ` data-seat="${id}"`}>` +
        `<span class="dp-ic" style="color:${col}">${bdg.icon}</span>` +
        `<span class="dp-name">${esc(NAME[id] ?? id)} <em>${bdg.tag}</em></span>` +
        `<span class="dp-w" title="${t('comms.provinces')}">⬣ ${w}</span>` +
        stanceTag +
        favBar +
        `</div>` +
        actions
      );
    })
    .join('');
}

// --- conversations (messages tab: list of chats + the open thread) -----------
// The tab lives in `conversations.ts` (REFM-15); here it only gets the host state it
// cannot reach on its own. The message log lives in `messageLog.ts` (REFM-214) — the
// net writes it through that owner's doors, the tab and the floating chat only read it.
export const conversations = initConversations({
  state: () => game.state(),
  me: () => game.me(),
  messages: () => sessionMessages,
  nameOf: (id) => game.names()[id] ?? id,
  seats: diploSeats,
  seatBadge,
  fmtStamp,
  ownerColor: (owner) => game.ownerColor(owner),
});

/** SPY-UX (плейтест, вариант 1): весь шпионаж в одном месте — активные окна интела
 *  с таймерами, операции по каждому противнику (те же .dp-spy обработчики, что и в
 *  ростере) и сессионный журнал попыток. Разведка мира остаётся на карточке планеты
 *  (нужна цель) — вкладка ведёт к ней подсказкой. */
function intelTabHtml(): string {
  const s = game.state();
  const ME = game.me();
  const NAME = game.names();
  const grantLabel = (g: IntelGrant): string =>
    g.kind === 'treasury'
      ? t('log.spy.what.treasury', { who: NAME[g.target] ?? g.target })
      : g.kind === 'fleets'
        ? t('log.spy.what.fleets', { who: NAME[g.target] ?? g.target })
        : t('log.spy.what.world', { at: game.placeName(g.target) });
  const rows = game
    .myIntel()
    .sort((a, b) => a.until - b.until)
    .map((g) => {
      const left = Math.max(0, Math.ceil((g.until - s.time) / HOUR));
      const jump = g.kind === 'planet' ? ` data-iw="${esc(g.target)}"` : '';
      return (
        `<div class="in-row"${jump}><span class="in-k">🗝</span><b>${esc(grantLabel(g))}</b>` +
        `<span class="in-t">⏳ ${t('fmt.hours', { n: left })}</span>${g.kind === 'planet' ? '<span class="in-go">↪</span>' : ''}</div>`
      );
    })
    .join('');
  const ops = Object.keys(s.players)
    .filter((id) => id !== ME)
    .map(
      (id) =>
        `<div class="in-row"><b>${esc(NAME[id] ?? id)}</b>` +
        `<button class="dp-spy" data-spy="treasury" data-seat="${id}">🕵 ${t('log.spy.kind.treasury')}</button>` +
        `<button class="dp-spy" data-spy="fleets" data-seat="${id}">🕵 ${t('spy.op.fleets')}</button></div>`,
    )
    .join('');
  const log = [...spyLog]
    .reverse()
    .map((e) => `<div class="in-log">${gameStamp(e.at)} · ${esc(e.text)}</div>`)
    .join('');
  return (
    `<div class="dp-list in-list">` +
    `<div class="in-hint">${t('spy.note', { c: SPY_COST })}</div>` +
    `<div class="in-sec">${t('spy.windows.title')}</div>` +
    (rows || `<div class="in-empty">${t('spy.windows.empty')}</div>`) +
    `<div class="in-sec">${t('spy.ops.title')}</div>` +
    (ops || `<div class="in-empty">${t('spy.ops.empty')}</div>`) +
    `<div class="in-sec">${t('spy.log.title')}</div>` +
    (log || `<div class="in-empty">${t('spy.log.empty')}</div>`) +
    `</div>`
  );
}
export function renderDiplo(): void {
  const el = document.getElementById('diplo');
  if (!el) return;
  // Вкладки «Шпионаж» в забеге Sector Zero нет: открытая до забега не переживает вход в него.
  const spyTab = espionageShown(game.sectorZeroToolsHidden());
  if (!spyTab && diploTab === 'intel') diploTab = 'diplo';
  const tabBtn = (k: 'diplo' | 'msgs' | 'intel', label: string) =>
    `<button class="dp-tab${diploTab === k ? ' on' : ''}" data-tab="${k}">${label}</button>`;
  const sortBtn = (k: typeof diploSort, label: string) =>
    `<button class="dp-sortb${diploSort === k ? ' on' : ''}" data-sort="${k}">${label}</button>`;
  const stChip = (k: DiplomaticStance) =>
    `<button class="dp-fchip${diploStanceFilter.has(k) ? ' on' : ''}" data-fstance="${k}" style="--sc:${game.stanceCol(k)}">${stanceRu(k)}</button>`;
  const tyChip = (k: 'human' | 'ai', label: string) =>
    `<button class="dp-fchip ty${diploTypeFilter.has(k) ? ' on' : ''}" data-ftype="${k}">${label}</button>`;
  const anyFilter = diploStanceFilter.size || diploTypeFilter.size;
  const filterRow =
    `<div class="dp-filters"><span>${t('diplo.filter')}:</span>` +
    STANCES.map(stChip).join('') +
    `<span class="dp-fsep"></span>${tyChip('human', '☻ ' + t('diplo.filter.human'))}${tyChip('ai', '⌬ ' + t('diplo.filter.ai'))}` +
    (anyFilter
      ? `<button class="dp-fclear" data-fclear="1">${t('diplo.filter.reset')}</button>`
      : '') +
    `</div>`;
  const body =
    diploTab === 'diplo'
      ? `<div class="dp-sorts"><span>${t('diplo.sort')}:</span>${sortBtn('name', t('diplo.sort.name'))}${sortBtn('worlds', t('diplo.sort.provinces'))}${sortBtn('stance', t('diplo.sort.stance'))}</div>` +
        filterRow +
        `<div class="dp-list">${diploRowsHtml()}</div>`
      : diploTab === 'intel'
        ? intelTabHtml()
        : `<div class="dp-convo">${conversations.listHtml()}${conversations.threadHtml()}</div>`;
  el.innerHTML =
    `<div class="dpbox">` +
    `<div class="dp-head"><b>${t('diplo.win.title')}</b>${tabBtn('diplo', t('diplo.tab.diplomacy'))}${tabBtn('msgs', t('diplo.tab.messages'))}${spyTab ? tabBtn('intel', t('diplo.tab.espionage')) : ''}<button class="dp-close">✕</button></div>` +
    body +
    `</div>`;
  if (diploTab === 'msgs') scrollFeedToEnd();
}
/** Patch just the open thread's feed (so a new line doesn't wipe a half-typed reply). */
export function renderDiploFeed(): void {
  const feed = document.getElementById('dp-feed');
  if (!feed) return;
  feed.innerHTML = conversations.feedInnerHtml();
  feed.scrollTop = feed.scrollHeight;
}
function scrollFeedToEnd(): void {
  const feed = document.getElementById('dp-feed');
  if (feed) feed.scrollTop = feed.scrollHeight;
}

function toggleSet<T>(set: Set<T>, v: T): void {
  if (set.has(v)) set.delete(v);
  else set.add(v);
}
function sendDiploMsg(): void {
  const input = document.getElementById('dp-text') as HTMLInputElement | null;
  const text = input?.value.trim();
  if (!text) return;
  dispatchChat(conversations.current(), text); // NET: server relay + echo; solo: local append
  if (input) {
    input.value = '';
    input.focus();
  }
}
/** Ping the selected province into the coalition channel — also a clickable map
 *  marker. The composer text becomes the marker's short description. */
function pingSelected(): void {
  if (!selPlanet || !game.state().planets[selPlanet]) {
    game.note(t('chat.ping.need-province'));
    return;
  }
  const input = document.getElementById('dp-text') as HTMLInputElement | null;
  const desc = (input?.value.trim() ?? '').slice(0, 80);
  if (pingRoute(game.net(), game.online()) === 'server') {
    // The server is authoritative for pings: it stamps the marker and relays a
    // `ping.added` back to us + allies — that echo is what adds it (see onPingAdded).
    game.sendProvincePing(selPlanet, desc);
  } else {
    pushMsg(
      COALITION,
      desc || t('chat.ping.mark', { node: game.placeName(selPlanet) }),
      false,
      game.me(),
      selPlanet,
    );
  }
  if (input) {
    input.value = '';
    input.focus();
  }
}

/** Поднять окно: хуки игры и обработчики окна, карточки и кнопок полосы. Зовётся из
 *  `main.ts` один раз. */
export function initDiploWindow(host: DiploWindowHost): void {
  game = host;
  const playerCardEl = document.getElementById('playercard');
  if (playerCardEl) {
    playerCardEl.addEventListener('click', (e) => {
      const tg = e.target as HTMLElement;
      // Match dossier → career dossier: close this card, open the profile sheet.
      if (tg.closest('.pc-dossier')) {
        const seat = playerCardEl.dataset.seat;
        const login = seat ? game.state().players[seat]?.name : undefined;
        playerCardEl.classList.remove('show');
        delete playerCardEl.dataset.seat;
        game.openProfile(login);
        return;
      }
      if (tg.id === 'playercard' || tg.closest('.pc-close')) {
        playerCardEl.classList.remove('show');
        delete playerCardEl.dataset.seat;
        return;
      }
      // Diplomacy actions on a seat card (opened from a chat nick). They run through the
      // same intents as the roster; we repaint the card (and the roster / chat feed) after.
      const seat = playerCardEl.dataset.seat;
      if (!seat) return;
      // ЧТО попросил игрок — `diploClick.ts` (REFM-139), общий с окном дипломатии; ЧТО
      // перерисовать после — дело экрана, и здесь это сама карточка (правило 1).
      const intent = diploIntent(tg);
      if (intent && intent.kind !== 'message') {
        if (intent.kind === 'stance') proposeStance(intent.seat, intent.stance as DiplomaticStance);
        else if (intent.kind === 'map') toggleMapShare(intent.seat);
        else game.playerOrder(spyOn(game.me(), intent.seat, intent.what as 'treasury' | 'fleets'));
        refreshSeatCard(seat);
        return;
      }
      if (intent?.kind === 'message') {
        playerCardEl.classList.remove('show');
        delete playerCardEl.dataset.seat;
        openDiplo('msgs'); // hand off to the full message thread
        conversations.open(intent.seat);
        renderDiplo();
        document.getElementById('dp-text')?.focus();
      }
    });
  }

  // Session menu: the rail's Diplomacy / Dispatches buttons open the roster / message log.
  document.getElementById('rail-diplo')?.addEventListener('click', () => {
    openDiplo('diplo');
    game.maybeIntro('diplomacy');
  });
  document.getElementById('rail-msgs')?.addEventListener('click', () => {
    readMessages(); // reading the tab clears the badge
    openDiplo('msgs');
  });

  const diploEl = document.getElementById('diplo');
  if (diploEl) {
    diploEl.addEventListener('click', (e) => {
      const tg = e.target as HTMLElement;
      if (tg.id === 'diplo' || tg.closest('.dp-close')) return closeDiplo();
      const tab = (tg.closest('.dp-tab') as HTMLElement | null)?.dataset.tab;
      if (tab) {
        diploTab = tab as 'diplo' | 'msgs' | 'intel';
        renderDiplo();
        return;
      }
      const sort = (tg.closest('.dp-sortb') as HTMLElement | null)?.dataset.sort;
      if (sort) {
        diploSort = sort as typeof diploSort;
        renderDiplo();
        return;
      }
      const fstance = (tg.closest('.dp-fchip[data-fstance]') as HTMLElement | null)?.dataset
        .fstance;
      if (fstance) {
        toggleSet(diploStanceFilter, fstance as DiplomaticStance);
        renderDiplo();
        return;
      }
      const ftype = (tg.closest('.dp-fchip[data-ftype]') as HTMLElement | null)?.dataset.ftype;
      if (ftype) {
        toggleSet(diploTypeFilter, ftype as 'human' | 'ai');
        renderDiplo();
        return;
      }
      if (tg.closest('.dp-fclear')) {
        diploStanceFilter.clear();
        diploTypeFilter.clear();
        renderDiplo();
        return;
      }
      // Тот же разбор, что и у карточки игрока (`diploClick.ts`, REFM-139) — а перерисовку
      // здесь делает окно целиком. Письмо ниже: между ним и шпионом стоит окно интела, и
      // порядок ветвей сохранён (правило 3).
      const intent = diploIntent(tg);
      if (intent && intent.kind !== 'message') {
        if (intent.kind === 'stance') proposeStance(intent.seat, intent.stance as DiplomaticStance);
        else if (intent.kind === 'map') toggleMapShare(intent.seat);
        else game.playerOrder(spyOn(game.me(), intent.seat, intent.what as 'treasury' | 'fleets'));
        renderDiplo(); // the intel row (or the rejection note) reflects the outcome
        return;
      }
      const iw = (tg.closest('[data-iw]') as HTMLElement | null)?.dataset.iw;
      if (iw) {
        closeDiplo(); // карта должна быть видна — перелетаем к миру из окна интела
        game.focusWorld(iw);
        return;
      }
      if (intent?.kind === 'message') {
        conversations.open(intent.seat);
        diploTab = 'msgs';
        renderDiplo();
        document.getElementById('dp-text')?.focus();
        return;
      }
      const convo = (tg.closest('.dp-cv') as HTMLElement | null)?.dataset.convo;
      if (convo) {
        conversations.open(convo);
        renderDiplo();
        document.getElementById('dp-text')?.focus();
        return;
      }
      if (tg.closest('.dp-ping')) return pingSelected();
      const nick = (tg.closest('[data-nickseat]') as HTMLElement | null)?.dataset.nickseat;
      if (nick) return openSeatCard(nick);
      const ping = (tg.closest('.dp-line.ping') as HTMLElement | null)?.dataset.ping;
      if (ping) return game.jumpToPing(ping);
      if (tg.closest('.dp-send')) return sendDiploMsg();
      const row = tg.closest('.dp-row') as HTMLElement | null;
      if (row?.dataset.seat) {
        diploExpanded = diploExpanded === row.dataset.seat ? null : row.dataset.seat;
        renderDiplo();
      }
    });
    // Enter sends the composed message.
    diploEl.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' && (ke.target as HTMLElement).id === 'dp-text') {
        e.preventDefault();
        sendDiploMsg();
      }
    });
  }
}
