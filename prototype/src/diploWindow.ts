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
import { espionageShown, victoryPointsShown } from '../../decisions/sectorZeroTools';
import { t, tData } from '../../localization/runtime';
import {
  coalitionCapacity,
  coalitionOf,
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
import { clockHM, esc, fmtEta, gameDay, gameStamp, kfmt } from './format';
import {
  botFavour,
  data,
  declareWar,
  declineOffer,
  FAVOUR_BASE,
  FAVOUR_EMBARGO,
  FAVOUR_WAR,
  hasMapShare,
  hasMapShareOffer,
  HOUR,
  shareMap,
  STANCE_RANK,
} from './game';
import { grantLeftMs, myAgents, pushSpyEntry, SPY_COST, type SpyEntry } from './intel';
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
  /** Ник игрока в кресле (сеть); `undefined` — неизвестен: соло, бот, старый сервер. */
  seatNick(id: string): string | undefined;
  /** Переспросить ники у сервера (сам решает, пора ли). */
  refreshNicks(): void;
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
    // В забеге Sector Zero очков нет (`victoryPointsShown`).
    (victoryPointsShown(game.sectorZeroToolsHidden())
      ? row(
          t('card.score'),
          `${score} / ${SCORE_LIMIT}${need === 0 ? ' · ★ ' + t('card.score.goal') : ''}`,
        )
      : '') +
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
  game.refreshNicks(); // кто-то мог сесть в партию, пока окно было закрыто
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
/** Live stolen-intel readout for one seat (under its expanded actions): the worlds
 *  of theirs under a recon window (SPY-8). Empty when nothing lives. */
function intelRowHtml(target: string): string {
  const s = game.state();
  const bits: string[] = [];
  for (const g of game.myIntel()) {
    if (s.planets[g.target]?.owner !== target) continue;
    const left = fmtEta(grantLeftMs(g, s.time) / HOUR);
    bits.push(t('comms.intel.world', { id: esc(game.placeName(g.target)), left }));
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
/**
 * COAL-1: почему союз с местом сейчас невозможен — ключ подсказки или null. Боты не
 * вступают в коалиции; член чужой коалиции сначала выходит из неё; полная коалиция
 * никого не принимает. Ядро отобьёт то же самое, кнопка лишь не обещает лишнего.
 */
function allianceBar(id: string): string | null {
  if (isAiSeat(id)) return 'comms.bots-no-coalition';
  const s = game.state();
  const ME = game.me();
  if (getStance(s, ME, id) === 'alliance') return null;
  const mine = coalitionOf(s, ME);
  const theirs = coalitionOf(s, id);
  if (mine && theirs && mine.id !== theirs.id) return 'err.coalition-other';
  const joining = mine ?? theirs;
  if (joining && joining.members.length >= coalitionCapacity(s)) return 'err.coalition-full';
  return null;
}
/** Кнопки стоек и договора карт для места — общие у ростера, карточки и лички. */
function stanceButtonsHtml(id: string): string {
  const s = game.state();
  const ME = game.me();
  const NAME = game.names();
  const st = getStance(s, ME, id);
  return (
    STANCES.map((sk) => {
      const barKey = sk === 'alliance' ? allianceBar(id) : null;
      const barred = barKey !== null;
      // Чей ход — `offerAffordance.ts` (REFM-201), та же формула, что у кнопки карт.
      // ЗДЕСЬ подавитель — запрет: предложить коалицию боту нельзя вовсе, поэтому и
      // аффорданса быть не должно. Текущая стойка помечается ОТДЕЛЬНО (`sk === st`).
      const aff = offerAffordance(barred, getOffer(s, id, ME) === sk, getOffer(s, ME, id) === sk);
      const mark = offerMark(aff);
      const cls = offerClass('dp-act', sk === st, aff);
      const label = mark ? `${mark} ${stanceRu(sk)}` : stanceRu(sk);
      const title =
        barKey === 'comms.bots-no-coalition'
          ? t('comms.bots-no-coalition')
          : barKey === 'err.coalition-other'
            ? t('err.coalition-other')
            : barKey === 'err.coalition-full'
              ? t('err.coalition-full')
              : aff === 'accept'
                ? t('comms.offer.incoming', { who: NAME[id] ?? id })
                : aff === 'waiting'
                  ? t('comms.offer.sent')
                  : '';
      return `<button class="${cls}" data-stance="${sk}" data-seat="${id}" style="--sc:${game.stanceCol(sk)}"${offerDisabled(aff, barred) ? ' disabled' : ''}${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    }).join('') + mapShareBtnHtml(id)
  );
}
/**
 * COAL-1: дипломатия внутри лички. Входящее предложение — карточка с «принять» и
 * «отказаться», своё — пометка «ждём ответа»; ниже кнопки нового предложения.
 */
function threadDiploHtml(id: string): string {
  const s = game.state();
  const ME = game.me();
  if (!s.players[id] || id === ME) return '';
  const who = esc(game.names()[id] ?? id);
  const cards: string[] = [];
  const incoming = (what: string, accept: string, kind: 'stance' | 'map'): string =>
    `<div class="dp-offer in"><span>${t('diplo.offer.in', { who, what })}</span>` +
    accept +
    `<button class="dp-dec" data-decline="${kind}" data-seat="${id}">✕ ${t('diplo.offer.decline')}</button></div>`;
  const inSt = getOffer(s, id, ME);
  if (inSt) {
    // Союз сверх вместимости или с членом чужой коалиции ядро отобьёт: кнопка гаснет
    // с той же причиной, что и кнопка союза в ростере.
    const bar = inSt === 'alliance' ? allianceBar(id) : null;
    const barAttr = bar ? ` disabled title="${esc(t(bar))}"` : '';
    cards.push(
      incoming(
        stanceRu(inSt),
        `<button class="dp-act dp-acc" data-stance="${inSt}" data-seat="${id}" style="--sc:${game.stanceCol(inSt)}"${barAttr}>✓ ${t('diplo.offer.accept')}</button>`,
        'stance',
      ),
    );
  }
  if (hasMapShareOffer(s, id, ME) && !hasMapShare(s, ME, id)) {
    cards.push(
      incoming(
        t('comms.mapshare'),
        `<button class="dp-map dp-acc" data-mapseat="${id}">✓ ${t('diplo.offer.accept')}</button>`,
        'map',
      ),
    );
  }
  const outSt = getOffer(s, ME, id);
  if (outSt)
    cards.push(
      `<div class="dp-offer out">⏳ ${t('diplo.offer.out', { what: stanceRu(outSt) })}</div>`,
    );
  if (hasMapShareOffer(s, ME, id)) {
    cards.push(
      `<div class="dp-offer out">⏳ ${t('diplo.offer.out', { what: t('comms.mapshare') })}</div>`,
    );
  }
  return (
    `<div class="dp-tdip">${cards.join('')}` +
    `<div class="dp-propose"><span>${t('diplo.offer.make')}</span>${stanceButtonsHtml(id)}</div></div>`
  );
}
/** COAL-1: отказ от предложения места — стойки или обмена картами. */
function declineFrom(seat: string, kind: string | undefined): void {
  const ME = game.me();
  if (kind === 'map') game.playerOrder(shareMap(ME, seat, false));
  else game.playerOrder(declineOffer(ME, seat));
}
function seatDiploActionsHtml(id: string): string {
  return (
    `<div class="dp-actions">` +
    stanceButtonsHtml(id) +
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
        diploNameHtml(id, NAME[id] ?? id, bdg.tag) +
        `<span class="dp-w" title="${t('comms.provinces')}">⬣ ${w}</span>` +
        stanceTag +
        favBar +
        `</div>` +
        actions
      );
    })
    .join('');
}

/** Имя в строке дипломатии. Ник живого игрока известен (сеть) — он идёт первым и
 *  открывает профиль, а имя дома уходит в подпись; без ника строка как прежде. */
function diploNameHtml(id: string, house: string, tag: string): string {
  const nick = isAiSeat(id) ? undefined : game.seatNick(id);
  if (!nick) return `<span class="dp-name">${esc(house)} <em>${tag}</em></span>`;
  return (
    `<span class="dp-name"><button class="dp-prof" data-prof="${esc(id)}" title="${t('diplo.profile')}">${esc(nick)}</button>` +
    ` <em>${esc(house)} · ${tag}</em></span>`
  );
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
  threadDiploHtml,
});

/** SPY-UX (плейтест, вариант 1): весь шпионаж в одном месте — сеть агентов, активные
 *  окна интела с таймерами и сессионный журнал попыток. Агента отправляют с карточки
 *  чужого мира (SPY-8: цель шпиона — мир), вкладка ведёт к ней подсказкой. */
function intelTabHtml(): string {
  const s = game.state();
  const ME = game.me();
  const rows = game
    .myIntel()
    .sort((a, b) => a.until - b.until)
    .map((g) => {
      const left = Math.max(0, Math.ceil((g.until - s.time) / HOUR));
      const label = t('log.spy.what.world', { at: game.placeName(g.target) });
      return (
        `<div class="in-row" data-iw="${esc(g.target)}"><span class="in-k">🗝</span><b>${esc(label)}</b>` +
        `<span class="in-t">⏳ ${t('fmt.hours', { n: left })}</span><span class="in-go">↪</span></div>`
      );
    })
    .join('');
  // SPY-6: сеть агентов — сколько свободно и когда вернутся остальные; агент на задании
  // (SPY-8) называет мир, к которому ушёл.
  const net = myAgents(s, ME);
  const agents = net.away
    .map((a) => {
      // SPY-11: a counter-intelligence agent is away until recalled — no countdown.
      const guard = a.op === 'counter';
      const left = guard ? '' : `⏳ ${t('fmt.hours', { n: Math.max(0, Math.ceil((a.until - s.time) / HOUR)) })}`;
      const what = a.lost
        ? t('spy.agent.lost')
        : a.planetId
          ? t(a.posted ? 'spy.agent.post' : 'spy.agent.mission', { at: game.placeName(a.planetId) })
          : t('spy.agent.busy');
      return `<div class="in-row"><span class="in-k">${a.lost ? '✖' : guard ? '🛡' : '🕵'}</span><b>${esc(what)}</b><span class="in-t">${left}</span></div>`;
    })
    .join('');
  const log = [...spyLog]
    .reverse()
    .map((e) => `<div class="in-log">${gameStamp(e.at)} · ${esc(e.text)}</div>`)
    .join('');
  return (
    `<div class="dp-list in-list">` +
    `<div class="in-hint">${t('spy.note', { c: SPY_COST })}</div>` +
    `<div class="in-sec">${t('spy.agents.title', { free: net.free, total: net.total })}</div>` +
    agents +
    `<div class="in-sec">${t('spy.windows.title')}</div>` +
    (rows || `<div class="in-empty">${t('spy.windows.empty')}</div>`) +
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
    `<div class="dp-head"><b>${t('diplo.win.title')}</b>${tabBtn('diplo', t('diplo.tab.diplomacy'))}${tabBtn('msgs', t('diplo.tab.messages'))}${spyTab ? tabBtn('intel', t('diplo.tab.espionage')) : ''}<button class="dp-close btn-x">✕</button></div>` +
    body +
    `</div>`;
  if (diploTab === 'msgs') scrollFeedToEnd();
}
/** COAL-1: после дипломатического пакета — список чатов и карточки предложений в
 *  открытой личке, не трогая поле ввода (полу-набранная реплика переживает). */
export function refreshThreadDiplo(): void {
  if (!diploOpen || diploTab !== 'msgs') return;
  // Список может сам сменить открытый канал (распалась коалиция → общий чат). Тогда
  // перерисовывается вся вкладка: иначе шапка и поле ввода остались бы от старого
  // канала, и реплика для союзников ушла бы в общий чат.
  const was = conversations.current();
  const listHtml = conversations.listHtml();
  if (conversations.current() !== was) return renderDiplo();
  const list = document.querySelector('#diplo .dp-cvlist');
  if (list) list.outerHTML = listHtml;
  const box = document.querySelector('#diplo .dp-tdip');
  if (box) box.outerHTML = threadDiploHtml(conversations.current());
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
        // Логин — ник кресла: имя игрока в мире у сетевой партии — имя дома, и по нему
        // профиль открывался бы пустым.
        const login = seat ? (game.seatNick(seat) ?? game.state().players[seat]?.name) : undefined;
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
        refreshSeatCard(seat);
        return;
      }
      if (intent?.kind === 'message') {
        playerCardEl.classList.remove('show');
        delete playerCardEl.dataset.seat;
        openDiplo('msgs'); // hand off to the full message thread
        conversations.open(intent.seat);
        renderDiplo();
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
      // Ник в строке — профиль игрока, а не раскрытие строки под ним.
      const prof = (tg.closest('.dp-prof') as HTMLElement | null)?.dataset.prof;
      if (prof) {
        const nick = game.seatNick(prof);
        if (nick) game.openProfile(prof === game.me() ? undefined : nick);
        return;
      }
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
      // COAL-1: «отказаться» в карточке предложения внутри лички.
      const dec = tg.closest('[data-decline]') as HTMLElement | null;
      if (dec?.dataset.seat) {
        declineFrom(dec.dataset.seat, dec.dataset.decline);
        renderDiplo();
        return;
      }
      // Тот же разбор, что и у карточки игрока (`diploClick.ts`, REFM-139) — а перерисовку
      // здесь делает окно целиком. Письмо ниже: перед ним стоит окно интела, и порядок
      // ветвей сохранён (правило 3).
      const intent = diploIntent(tg);
      if (intent && intent.kind !== 'message') {
        if (intent.kind === 'stance') proposeStance(intent.seat, intent.stance as DiplomaticStance);
        else if (intent.kind === 'map') toggleMapShare(intent.seat);
        renderDiplo();
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
        return;
      }
      const convo = (tg.closest('.dp-cv') as HTMLElement | null)?.dataset.convo;
      if (convo) {
        conversations.open(convo);
        renderDiplo();
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
