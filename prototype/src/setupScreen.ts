/**
 * Экран настройки схватки — у одного владельца (REFM-212): состояние сетапа (карта, роли
 * мест, команды, родной мир, совет учёных, дом игрока, темп), его разметка, `openSetup`,
 * `buildSetupConfig` и обработчики экрана.
 *
 * Состояние жило `let`'ами в `main.ts`, и писал его не только экран: гид по первому матчу
 * готовил свою партию тремя присвоениями, а сетевой вход и опрос мест ставили карту,
 * сетевой режим и сбрасывали выбранный мир. Теперь они зовут двери модуля
 * ({@link prepareGuidedSetup}, {@link enterNetSetup}, {@link updateNetOffer}), а `main.ts`
 * читает то, что ему нужно (карту, роли мест, темп, сетевой режим), как живые привязки
 * (`export let`) — присвоить мимо владельца не даст компилятор.
 *
 * Места матча, позывной, прокачка командующего, часы, опрос мест, экраны входа и хаба и сам
 * старт схватки живут в `main.ts`; модуль получает их хуками {@link initSetupScreen} —
 * импорт оттуда был бы циклом. Корень экрана и окно совета модуль поднимает сам и отдаёт
 * живыми привязками ({@link setupEl}, {@link sciWin}): их прячут старт партии, реестр слоёв
 * Back и вход в сеть.
 */
import { t, tData } from '../../localization/runtime';
import {
  reconcileSelection,
  startEnabled as netStartEnabled,
  type EntryOffer,
} from '../../decisions/entrySetup';
import { nearestHit } from '../../decisions/pointerPick';
import { joinHref } from '../../decisions/seatJoin';
import { esc } from './format';
import {
  data,
  MAP,
  PLAYABLE_FACTIONS,
  SECTOR_TYPES,
  START_CANDIDATES,
  type SeatConfig,
  type SetupConfig,
} from './game';
import { DEFAULT_HEROES, type HeroLoadout } from './heroes';
import { isFrontier, mapPreset, MAP_IDS, type MapId } from './mapCatalog';
import { metaGrant, type MetaState } from './meta';
import { mapWorldName } from './planetName';
import { resetSandboxConfig } from './sandbox';
import { initSciPick, sciCouncilRowHtml } from './sciPick';
import { SNAP_REACH, drawOrder, lanes, mapViewBox, viewBoxPoint } from './setupMap';
import { setupRivalsHtml } from './setupRivals';
import {
  assignSeats,
  factionBonuses,
  houseDisplayName,
  houseNameFor,
  isAiSeat as isAiRole,
  nextSeatRole,
  rivalCount,
  seatFactionIds as seatSeatFactionIds,
  type SeatRole,
} from './setupSeats';
import { DEFAULT_SHIP_LOADOUTS, type ShipLoadout } from './ships';
import { askReplace, saveSolo } from './soloCheckpoint';
import { branchLabel } from './techTree';

/** Что экрану нужно от игры. Места, позывной, часы, экраны и старт партии живут в `main.ts`. */
export interface SetupScreenHost {
  /** Места матча по порядку: имя дома и цвет строки. */
  seats: ReadonlyArray<{ id: string; name: string; faction: string; color: string }>;
  /** Позывной из поля входа — имя главного героя. */
  nick(): string;
  /** Прокачка командующего: её грант едет в матч снимком. */
  meta(): MetaState;
  /** Идёт сетевая партия: её часы ведёт сервер. */
  net(): boolean;
  /** Остановить локальный мир под экраном. */
  halt(): void;
  /** Погасить опрос мест сетевой партии. */
  stopNetPoll(): void;
  showConnect(show: boolean): void;
  openHub(): void;
  /** Старт схватки по собранной настройке. */
  startMatch(setup: SetupConfig): void;
}

// Дев-сборка: инструменты песочницы на экране настройки (флаг сборщика, как в `main.ts`).
declare const __PLAYER_BUILD__: boolean;

let game: SetupScreenHost;

const $ = (id: string) => document.getElementById(id) as HTMLElement;

export let setupMapId: MapId = 'nexus';
const setupPreset = () => mapPreset(setupMapId);
const setupSeatCount = () => setupPreset().starts.length;

// Single-player setup screen state: per-seat role (seat 0 is always you) + your
// chosen homeworld. Seats 2-10 toggle 'ai'/'off'; an 'ai' seat spawns a rival.
const freshSetupSlots = (): SeatRole[] =>
  game.seats
    .slice(0, setupSeatCount())
    .map((_, i) => (i === 0 ? 'human' : isFrontier(setupMapId) || i === 1 ? 'ai' : 'off'));
// Свежие места сеет `initSetupScreen`: их список — места хоста.
export let setupSlots: SeatRole[] = [];
// Team battle (2v2 etc.): when on, seats fight in sides — same side ALLIED (win
// together, no friendly fire), across sides at WAR from the first hour. Seat 0 (you)
// is always side A; the default when enabling pairs you with seat 1 vs seats 2-3.
// Off ⇒ classic free-for-all. See newGame's team-aware diplomacy seeding.
let setupTeams = false;
// «?» над местами: раскрыто ли правило соперников (UIX-8.2). Только вид, в матч не идёт.
let setupHelp = false;
const DEFAULT_TEAM_SIDES: ReadonlyArray<'A' | 'B'> = [
  'A',
  'A',
  'B',
  'B',
  'A',
  'A',
  'B',
  'B',
  'A',
  'B',
];
let setupSeatTeam: Array<'A' | 'B'> = [...DEFAULT_TEAM_SIDES];
let setupStart: string = START_CANDIDATES[0] ?? MAP[0]!.id;
let setupScientists: string[] = []; // the human's chosen research-leader council (≤2), picked at setup
let setupFaction = 'azure'; // H3: the house the HUMAN plays; AI seats take the remaining ones
// Chosen time-flow multiplier for the launched match (×1/×2/×5/×10/×50/×100). ×1 = today's
// normal play pace; the launch maps it onto the speedbar (applyTimeSpeed). ×100 is a
// single-player-only sandbox pace — in net mode the server owns the clock, so this list
// (and the in-match pace chips) only ever affect the local sim (see `frame()`'s `!NET` guard).
const SETUP_SPEEDS = [1, 2, 5, 10, 50, 100];
export let setupSpeed = 10;

// Pick your homeworld on a mini-map and choose how many AI rivals join, then
// launch a fresh local match. Seat 1 is always you; seats 2-10 toggle AI/off.
// Switch every rival OFF for a solo sandbox — the core never ends a one-player
// match, so it's a peaceful space to read descriptions and learn the interface.
export let setupEl: HTMLElement;
let setupMapEl: HTMLElement;
let setupSlotsEl: HTMLElement;
let setupFactionsEl: HTMLElement;
let setupSpeedEl: HTMLElement;
let setupHintEl: HTMLElement;
/** Правая колонка сетапа — боты, команды, скорость времени. В сетевом матче это
 *  решения сервера, а не игрока, поэтому там она прячется целиком. */
let soloColEl: HTMLElement | null;
let setupGoEl: HTMLButtonElement;

// The player's division templates / hero roster / ship blueprints. Pre-match loadout
// EDITORS were removed (modules unlock via tech in-match, so freezing a loadout before
// the match is incoherent — loadout now happens in-match: ships at build time, heroes
// in the capital). These default rosters still seed the match via buildSetupConfig.
const setupHeroes: HeroLoadout[] = DEFAULT_HEROES.map((h) => ({
  name: h.name,
  grade: h.grade,
  abilities: [...h.abilities],
}));

/** The hero's display name — the главный hero shows the player's callsign (nick),
 *  falling back to its localized preset name only while the nick field is empty. */
function heroName(h: HeroLoadout): string {
  return h.grade === 'main' ? game.nick().trim() || tData(h.name) : h.name;
}

const setupShips: ShipLoadout[] = DEFAULT_SHIP_LOADOUTS.map((l) => ({
  hull: l.hull,
  modules: [...l.modules],
}));

// Loadout is chosen in-match now (ships at build time under tech-unlocks, heroes in the
// capital), so the pre-match «Производство» / Герои / Дивизии editors and their inventory chrome
// were removed. `setupTemplates` / `setupHeroes` / `setupShips` above keep seeding the
// match with the default rosters via buildSetupConfig.

/** Сетевой режим экрана настройки (ENTRY-2). `null` — обычная одиночная схватка.
 *
 *  Экран ОДИН на оба режима намеренно: игрок просил «как в одиночке, но в сетевой», и
 *  второй экран с той же картой и теми же карточками разошёлся бы с первым на первой же
 *  правке. Меняется не разметка, а источник данных: кандидаты приходят от сервера, а не
 *  из `START_CANDIDATES`, занятые миры видны и не выбираются, правая колонка (боты,
 *  команды, скорость времени) скрыта — в сетевом матче это не твои решения. */
export let netSetup: { matchId: string; offer: EntryOffer } | null = null;

/** Стартовые миры, которые сейчас предлагает экран. */
function setupCandidateIds(): string[] {
  if (!netSetup) return [...setupPreset().starts];
  return netSetup.offer.worlds.flatMap((w) => (w.planetId ? [w.planetId] : []));
}

/** Кресло, которое достанется вместе с этим миром (только в сетевом режиме). */
function slotForWorld(planetId: string): string | null {
  return netSetup?.offer.worlds.find((w) => w.planetId === planetId)?.slot ?? null;
}

/** Занят ли этот мир живым игроком. */
function worldTaken(planetId: string): boolean {
  return netSetup?.offer.worlds.find((w) => w.planetId === planetId)?.taken === true;
}

function renderSetupMap(): void {
  // Рамка, трассы без повторов и порядок рисования — в `setupMap.ts` (REFM-45):
  // там же правило «каждое ребро один раз» и «кандидаты рисуются последними».
  const MAP = setupPreset().nodes;
  const box = mapViewBox(MAP, 60);
  setupMapEl.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
  const order = drawOrder(MAP, setupCandidateIds());
  let svg = '';
  for (const l of lanes(MAP)) {
    svg += `<line x1="${l.from.x}" y1="${l.from.y}" x2="${l.to.x}" y2="${l.to.y}" stroke="#1d3640" stroke-width="3"/>`;
  }
  for (const n of order.plain) {
    if (n.sector === 'black_hole') {
      svg += `<circle cx="${n.x}" cy="${n.y}" r="140" fill="#03030a" stroke="#8764ce" stroke-width="20"><title>${esc(t('setup.map.hole'))}</title></circle>`;
      continue;
    }
    if (n.sector === 'pirate_base' || n.sector === 'neutral_base') {
      svg += `<rect x="${n.x - 20}" y="${n.y - 20}" width="40" height="40" fill="${SECTOR_TYPES[n.sector]!.color}"><title>${esc(tData(SECTOR_TYPES[n.sector]!.name))}</title></rect>`;
      continue;
    }
    const planet = n.sector === 'planet';
    svg += `<circle cx="${n.x}" cy="${n.y}" r="${planet ? 16 : 11}" fill="${planet ? '#2c5460' : '#1b2d34'}" stroke="#33555f" stroke-width="2"/>`;
  }
  for (const n of order.candidates) {
    const picked = n.id === setupStart;
    // Занятый мир ОСТАЁТСЯ на карте и гаснет (`entrySetup.ts`, правило 2): карта — это
    // расклад матча, и дырка на месте соперника читалась бы как «там пусто».
    const taken = worldTaken(n.id);
    const fill = taken
      ? 'rgba(120,140,146,.12)'
      : picked
        ? 'rgba(58,209,122,.35)'
        : 'rgba(53,214,230,.16)';
    const stroke = taken ? '#4a6169' : picked ? '#3ad17a' : '#35d6e6';
    // У занятого мира — подпись прямо на кружке: цвет один читают мельком и не всегда
    // верно, а «занято» отвечает на вопрос сразу.
    svg +=
      `<circle class="cand${taken ? ' taken' : ''}" data-cand="${n.id}"` +
      `${taken ? ' data-taken="1"' : ''} cx="${n.x}" cy="${n.y}" r="${picked ? 30 : 22}" ` +
      `fill="${fill}" stroke="${stroke}" stroke-width="${picked ? 6 : 4}">` +
      `${taken ? `<title>${esc(t('seatpick.taken'))}</title>` : ''}</circle>`;
  }
  setupMapEl.innerHTML = svg;
}

/** H3 — which house each seat plays: seat 0 (you) = `setupFaction`, then the four
 *  passive houses rotate in stable order across the remaining seats. */
function seatFactionIds(): string[] {
  // Раздача и нумерация домов — в `setupSeats.ts` (REFM-44): твой первый, остальные
  // по кругу в стабильном порядке, со второго круга имя получает номер.
  return seatSeatFactionIds(setupFaction, Object.keys(data.factions), setupSeatCount());
}
function seatHouseName(fid: string, fallback: string, index: number): string {
  return houseNameFor(
    data.factions[fid]?.name ?? fallback,
    index,
    Object.keys(data.factions).length,
  );
}
/** A faction's passive-bonus readout, straight from the data (economy or units). */
export function factionBonusLine(fid: string): string {
  const BONUS_KEY = {
    economy: 'setup.bonus.economy',
    damage: 'setup.bonus.damage',
    speed: 'setup.bonus.speed',
    radar: 'setup.bonus.radar',
  } as const;
  return factionBonuses(data.factions[fid]?.passives)
    .map((b) => t(BONUS_KEY[b.kind], { n: b.pct }))
    .join(' · ');
}

function renderSetupSlots(): void {
  // The faction picker (H3): four houses, each a pure passive bonus — pick yours.
  // Lives in its own container (#setupfactions, the left setup column); the team
  // toggle + seat rows fill #setupslots (the right column).
  let f2 = `<div class="fph">${t('setup.faction.note')}</div><div class="fpick">`;
  // Только ДОМА: каталог фракций несёт ещё Рой и легаси-`vanguard`, и перебор каталога
  // давал сыграть за Улей в обычной партии (баг, замечен владельцем 2026-09-23).
  for (const fid of PLAYABLE_FACTIONS) {
    const f = data.factions[fid];
    if (!f) continue;
    const on = fid === setupFaction;
    f2 +=
      `<button class="fchip${on ? ' on' : ''}" data-fpick="${fid}"><b>${esc(tData(f.name))}</b>` +
      `<span>${factionBonusLine(fid)}</span></button>`;
  }
  f2 += `</div>`;
  setupFactionsEl.innerHTML = f2;
  // Над местами — сколько соперников и одна строка правила; подробности — под «?»
  // (UIX-8.2: инструкция в восемь строк стояла над картой и дублировала подсказки).
  // Team-battle toggle: sides fight as allies. Only meaningful with ≥2 rivals (a 2v2
  // needs three AI seats on); shown always so the player can arm it before adding them.
  // Sector Zero — режим со своей дверью на хабе, а не настройка этой схватки (UIX-15.1).
  let h =
    setupRivalsHtml(rivalCount(setupSlots), setupHelp) +
    `<div class="tmrow"><button class="tmtog${setupTeams ? ' on' : ''}" data-teamtog="1">` +
    `${setupTeams ? '⚔ ' + t('setup.teams.on') : t('setup.teams.off')}</button>` +
    (setupTeams ? `<span class="tmhint">${t('setup.teams.note')}</span>` : '') +
    `</div>`;
  if (isFrontier(setupMapId)) {
    const count = rivalCount(setupSlots);
    setupSlotsEl.innerHTML = `<label>${t('setup.bots.count')} <input id="setup-bot-count" type="number" min="0" max="${setupSeatCount() - 1}" value="${count}" /></label>`;
    return;
  }
  const fids = seatFactionIds();
  // A/B side chip for a seat (you are locked to A; AI seats toggle side).
  const teamChip = (i: number, locked: boolean): string => {
    const side = setupSeatTeam[i]!;
    return `<button class="tmchip s${side}${locked ? ' lock' : ''}" data-teamseat="${i}"${locked ? ' disabled' : ''}>${side}</button>`;
  };
  for (let i = 0; i < setupSeatCount(); i++) {
    const m = game.seats[i]!;
    const role = setupSlots[i]!;
    const house = esc(houseDisplayName(seatHouseName(fids[i]!, m.name, i)));
    if (i === 0) {
      h +=
        `<div class="srow"><span class="dot" style="background:${m.color};color:${m.color}"></span>` +
        `<span class="nm">${house}</span>` +
        (setupTeams ? teamChip(0, true) : '') +
        `<span class="you">${t('comms.you')}</span></div>`;
    } else {
      // Кнопка строки гоняет место по кругу «выкл → слабый → сильный» (AIDIFF-1) —
      // подпись называет ИМЕННО то, что будет играть, а не «вкл/выкл»: иначе выбранная
      // сложность не видна, и игрок не знает, кого позвал.
      const aiOn = isAiRole(role);
      const strong = role === 'ai-strong';
      const label = strong ? t('setup.ai.strong') : aiOn ? t('setup.ai.weak') : t('setup.off');
      h +=
        `<div class="srow ${aiOn ? '' : 'off'}"><span class="dot" style="background:${m.color};color:${m.color}"></span>` +
        `<span class="nm">${house}</span>` +
        (setupTeams && aiOn ? teamChip(i, false) : '') +
        `<button class="stog ${aiOn ? 'ai' : ''}${strong ? ' strong' : ''}" data-slot="${i}" title="${esc(t('setup.ai.hint'))}">${label}</button></div>`;
    }
  }
  setupSlotsEl.innerHTML = h;
}

function renderSetup(): void {
  const mapSelect = $('setup-map-id') as HTMLSelectElement;
  mapSelect.value = setupMapId;
  mapSelect.disabled = !!netSetup;
  $('setup-map-info').textContent = t(
    setupMapId === 'frontier-100'
      ? 'setup.map.frontier-legacy-info'
      : isFrontier(setupMapId)
        ? 'setup.map.frontier-info'
        : 'setup.map.nexus-info',
  );
  const homeSelect = $('setup-home-id') as HTMLSelectElement;
  // Дом — по имени, как его подпишет карта партии, а не по коду «C0R1» (UIX-5.2); значение
  // опции остаётся id.
  const homeName = (id: string): string => mapWorldName(setupMapId, setupPreset().nodes, id);
  homeSelect.innerHTML = setupCandidateIds()
    .map(
      (id) =>
        `<option value="${esc(id)}"${worldTaken(id) ? ' disabled' : ''}>${esc(homeName(id))}${worldTaken(id) ? ' · ' + esc(t('seatpick.taken')) : ''}</option>`,
    )
    .join('');
  homeSelect.value = setupStart;
  renderSetupMap();
  renderSetupSlots();
  renderSetupCouncil();
  // Seat 1 (you) is always in, so the match can always launch — including with ZERO
  // rivals: a calm solo sandbox to read descriptions, learn the UI and test in peace
  // (the core never ends a one-player match — victory needs ≥2 active sides).
  // Сетевой режим (ENTRY-2): решения — в `decisions/entrySetup.ts`, здесь только показ.
  // Правая колонка скрыта: боты, команды и скорость времени в сетевом матче не твои
  // решения, а сервера. Кнопка заперта, пока не выбран СВОБОДНЫЙ мир — пустой выбор
  // отправил бы игрока на сервер без места, и тот посадил бы куда-нибудь.
  if (soloColEl) soloColEl.style.display = netSetup ? 'none' : '';
  if (netSetup) {
    const free = netSetup.offer.free;
    const ready = netStartEnabled(slotForWorld(setupStart), netSetup.offer.worlds);
    setupGoEl.disabled = !ready;
    setupGoEl.textContent = t('seatpick.go');
    setupHintEl.textContent =
      free === 0
        ? t('seatpick.none-free')
        : ready
          ? t('setup.home.pick', { home: homeName(setupStart) })
          : t('setup.map-hint');
    for (const c of Array.from(setupSpeedEl.querySelectorAll('[data-spd]')))
      c.classList.toggle('on', Number((c as HTMLElement).dataset.spd) === setupSpeed);
    return;
  }
  const rivals = rivalCount(setupSlots);
  setupGoEl.disabled = false;
  setupGoEl.textContent = rivals === 0 ? t('setup.start.solo') : t('setup.start');
  setupHintEl.textContent = t(rivals === 0 ? 'setup.home.solo' : 'setup.home.pick', {
    home: homeName(setupStart),
  });
  for (const c of Array.from(setupSpeedEl.querySelectorAll('[data-spd]')))
    c.classList.toggle('on', Number((c as HTMLElement).dataset.spd) === setupSpeed);
}

// Where the Setup screen's Back button returns to — the surface that opened it, so
// arriving from the hub goes back to the hub, not the raw identity card.
let setupReturn: 'welcome' | 'hub' = 'welcome';
// --- scientist council picker: choose your 2 research leaders BEFORE the start-point ----
// Окно живёт в `sciPick.ts` (REFM-18); здесь только проводка. Список выбранных —
// `setupScientists` — принадлежит сетапу (его читает старт матча), поэтому ходит хуками.
export let sciWin: HTMLElement;
let setupCouncilEl: HTMLElement;
function renderSetupCouncil(): void {
  setupCouncilEl.innerHTML = sciCouncilRowHtml(setupScientists, data);
}
let sciPick: ReturnType<typeof initSciPick>;
const openSciPick = (): void => sciPick.open();

export function openSetup(from: 'welcome' | 'hub' = 'welcome'): void {
  saveSolo();
  if (!game.net()) game.halt();
  setupReturn = from;
  // Каждый заход начинается ОДИНОЧНЫМ: сетевой режим ставит `openSeatPicker`
  // сразу после этого вызова. Иначе брошенный сетевой заход утёк бы в следующую
  // одиночную схватку — тот же довод, что у чистого выбора в `seatJoin.ts`.
  netSetup = null;
  game.stopNetPoll();
  setupSlots = freshSetupSlots();
  setupTeams = false; // a fresh setup opens on the classic free-for-all
  setupSeatTeam = [...DEFAULT_TEAM_SIDES];
  setupStart = setupPreset().starts[0]!;
  // Re-consecrate the council each time setup opens, PRE-SEEDED with the recommended
  // newbie pair (командование «Куратор» + генералист «Полимат»): the first permanent
  // choice a new player faces must never be a wall of empty slots + a disabled button —
  // one tap continues, swapping is optional. Guarded by presence so data edits degrade.
  setupScientists = ['overseer', 'polymath'].filter((id) => data.scientists[id]);
  // A lively default: ×1 wall-clock reads as a FROZEN screen to a newcomer, so the
  // setup opens on the last chosen multiplier (first launch: ×10). True real time
  // stays one tap away — the ×1 chip.
  const savedSpeed = Number(localStorage.getItem('void.setupSpeed'));
  setupSpeed = SETUP_SPEEDS.includes(savedSpeed) ? savedSpeed : 10;
  game.showConnect(false);
  setupEl.style.display = 'flex';
  $('setup-start').style.display = '';
  // SANDBOX — fenced hook. Each setup opens with the practice tools reset + unticked.
  if (!__PLAYER_BUILD__) {
    resetSandboxConfig();
    const sbx = $('setupsandbox') as HTMLInputElement | null;
    if (sbx) sbx.checked = false;
  }
  renderSetup();
  openSciPick(); // consecrate your 2 research leaders before picking the start point
}

export function buildSetupConfig(): SetupConfig {
  // Seats play the HOUSES assigned at setup (H3): you = setupFaction, AI = the rest.
  // Seat name follows the house (its canonical data name); color stays per-seat.
  const fids = seatFactionIds();
  // Кто реально играет и с какого мира стартует — `setupSeats.ts` (REFM-160): место 0
  // всегда твоё, AI-места забирают кандидатов по порядку мимо выключенных, свой мир из
  // кандидатов уже исключён, а закончившиеся кандидаты останавливают раздачу.
  const seats: SeatConfig[] = assignSeats(
    setupSeatCount(),
    setupSlots,
    setupStart,
    setupPreset().starts,
  ).map(({ index: i, start }) => {
    const m = game.seats[i]!;
    return {
      id: m.id,
      name: seatHouseName(fids[i]!, m.name, i),
      faction: fids[i]!,
      start,
      ai: i !== 0,
      ...(setupTeams ? { team: setupSeatTeam[i] } : {}),
    };
  });
  // Carry the player's division templates + hero roster into the match (deep-cloned),
  // plus the meta-progression grant (snapshot — no live account reads mid-match).
  return {
    mapId: setupMapId,
    meta: metaGrant(game.meta()),
    seats,
    ...(setupScientists.length ? { scientists: [...setupScientists] } : {}),
    heroes: setupHeroes.map((h) => ({
      name: heroName(h),
      grade: h.grade,
      abilities: [...h.abilities],
    })),
    ships: setupShips.map((l) => ({ hull: l.hull, modules: [...l.modules] })),
  };
}

/** Гид по первому матчу (ONB-2) готовит свою партию: «Нексус» без соперников и
 *  предсказуемый родной мир. Остальной выбор экрана гид не трогает. */
export function prepareGuidedSetup(): void {
  setupMapId = 'nexus';
  setupSlots = ['human', 'off', 'off', 'off']; // no rivals — a safe, calm sandbox
  setupStart = setupPreset().starts[0]!; // a deterministic homeworld
}

/** Сетевой вход (ENTRY-2): экран уже открыт `openSetup('hub')`, карта и места пришли от
 *  сервера. Опрос мест заводит вызывающий. */
export function enterNetSetup(matchId: string, mapId: MapId | undefined, offer: EntryOffer): void {
  setupMapId = mapPreset(mapId).id;
  netSetup = { matchId, offer };
  // Стартовый мир не подставляем: правило 4 `entrySetup.ts` — кнопка заперта, пока
  // игрок сам не ткнул в свободный мир. Иначе выбор превратился бы в пожелание.
  setupStart = '';
  renderSetup();
}

/** Свежий список мест от опроса. Занятый выбранный мир СБРАСЫВАЕТ выбор, а не переезжает
 *  на соседний (`reconcileSelection`). Если экран уже не сетевой, ответ опоздал — его
 *  отбрасывают. */
export function updateNetOffer(matchId: string, offer: EntryOffer): void {
  if (!netSetup) return;
  netSetup = { matchId, offer };
  const fate = reconcileSelection(slotForWorld(setupStart), netSetup.offer.worlds);
  if (fate.kind === 'lost') {
    setupStart = '';
    renderSetup();
    setupHintEl.textContent = t('seatpick.lost');
    return;
  }
  renderSetup();
}

/** Поднять экран: хуки игры, элементы, окно совета и обработчики. Зовётся из `main.ts`
 *  один раз. */
export function initSetupScreen(host: SetupScreenHost): void {
  game = host;
  setupEl = $('setup');
  setupMapEl = $('setupmap');
  setupSlotsEl = $('setupslots');
  setupFactionsEl = $('setupfactions');
  setupSpeedEl = $('setupspeed');
  setupHintEl = $('setuphint');
  soloColEl = document.getElementById('setup-solo-col');
  setupGoEl = $('setupgo') as HTMLButtonElement;
  setupSlots = freshSetupSlots();
  sciWin = $('scipick');
  setupCouncilEl = $('setupcouncil');
  sciPick = initSciPick({
    root: () => sciWin,
    body: () => $('scipickbody'),
    data: () => data,
    branchLabel,
    chosen: () => setupScientists,
    setChosen: (ids) => {
      setupScientists = ids;
      // Строка настройки идёт следом за КАЖДЫМ выбором, а не за закрытием окна: Back
      // закрывает окно мимо кода окна (лестница `BACK_LAYERS`), так что «дорисую при
      // закрытии» разошлось бы с состоянием ровно на этом пути.
      renderSetupCouncil();
    },
    onCancel: () => $('setupcancel').click(),
  });
  setupCouncilEl.addEventListener('click', openSciPick);

  $('setup-map-id').addEventListener('change', (ev) => {
    const id = (ev.target as HTMLSelectElement).value;
    if (netSetup || !MAP_IDS.some((value) => value === id)) return;
    setupMapId = mapPreset(id).id;
    setupSlots = freshSetupSlots();
    setupTeams = false;
    setupStart = setupPreset().starts[0]!;
    renderSetup();
  });
  $('setup-home-id').addEventListener('change', (ev) => {
    const id = (ev.target as HTMLSelectElement).value;
    if (!setupCandidateIds().includes(id) || worldTaken(id)) return;
    setupStart = id;
    renderSetup();
  });
  setupSlotsEl.addEventListener('change', (ev) => {
    const input = ev.target as HTMLInputElement;
    if (input.id !== 'setup-bot-count') return;
    const count = Math.max(0, Math.min(setupSeatCount() - 1, Math.floor(Number(input.value) || 0)));
    setupSlots = Array.from({ length: setupSeatCount() }, (_, i) =>
      i === 0 ? 'human' : i <= count ? 'ai' : 'off',
    );
    renderSetup();
  });

  setupMapEl.addEventListener('click', (ev) => {
    const direct = (ev.target as Element).closest('[data-cand]');
    let pick: string | null = direct?.getAttribute('data-cand') ?? null;
    if (!pick) {
      // The candidate circles are ~8px on a phone — a near miss still counts.
      // Перевод тапа в координаты viewBox и радиус снапа — `setupMap.ts` (REFM-126,
      // правила 4–5): SVG растянут с `preserveAspectRatio=meet`, и в экранных пикселях
      // снап промахивался бы тем сильнее, чем сильнее вытянуто окно. Ближайший кандидат —
      // `pointerPick.ts`, тот же поиск, что и на карте матча.
      const at = viewBoxPoint(
        setupMapEl.getBoundingClientRect(),
        (setupMapEl as unknown as SVGSVGElement).viewBox.baseVal,
        ev.clientX,
        ev.clientY,
      );
      if (at) {
        const hit = nearestHit(
          setupCandidateIds().flatMap((id) => {
            const n = setupPreset().nodes.find((m) => m.id === id);
            return n ? [n] : [];
          }),
          (n) => n,
          at.x,
          at.y,
          SNAP_REACH,
        );
        pick = hit?.id ?? null;
      }
    }
    if (!pick) return;
    // Занятый мир виден, но не выбирается (`entrySetup.ts`, правило 2). Молча
    // проигнорировать тап нельзя — это выглядит как непрожатая кнопка, поэтому говорим,
    // что случилось.
    if (worldTaken(pick)) {
      setupHintEl.textContent = t('seatpick.lost');
      return;
    }
    setupStart = pick;
    renderSetup();
  });
  setupFactionsEl.addEventListener('click', (ev) => {
    const fp = (ev.target as Element).closest('[data-fpick]');
    if (!fp) return;
    const pick = fp.getAttribute('data-fpick');
    if (pick && PLAYABLE_FACTIONS.includes(pick)) setupFaction = pick;
    renderSetup();
  });
  setupSlotsEl.addEventListener('click', (ev) => {
    if ((ev.target as Element).closest('[data-teamtog]')) {
      setupTeams = !setupTeams;
      renderSetup();
      return;
    }
    if ((ev.target as Element).closest('[data-setuphelp]')) {
      setupHelp = !setupHelp;
      renderSetup();
      return;
    }
    const ts = (ev.target as Element).closest('[data-teamseat]');
    if (ts) {
      const i = Number(ts.getAttribute('data-teamseat'));
      if (i > 0) setupSeatTeam[i] = setupSeatTeam[i] === 'A' ? 'B' : 'A'; // you (0) are locked to A
      renderSetup();
      return;
    }
    const t = (ev.target as Element).closest('[data-slot]');
    if (!t) return;
    const i = Number(t.getAttribute('data-slot'));
    setupSlots[i] = nextSeatRole(setupSlots[i]!); // выкл → слабый → сильный → выкл
    renderSetup();
  });
  setupSpeedEl.addEventListener('click', (ev) => {
    const t = (ev.target as Element).closest('[data-spd]');
    if (!t) return;
    setupSpeed = Number(t.getAttribute('data-spd'));
    localStorage.setItem('void.setupSpeed', String(setupSpeed));
    renderSetup();
  });
  setupGoEl.addEventListener('click', () => {
    // В сетевом режиме экран не запускает матч — он собирает выбор в адрес входа
    // (`seatJoin.ts`), а мир приходит от сервера. Тот же переход, что раньше делало окно
    // выбора дома: `location.href`, а не новая вкладка (её блокирует браузер).
    if (netSetup) {
      const slot = slotForWorld(setupStart);
      if (!slot) return; // кнопка и так заперта, но выбор мог протухнуть между рендерами
      location.href = joinHref(
        location.pathname,
        netSetup.matchId,
        slot,
        setupFaction || null,
        setupScientists,
      );
      return;
    }
    const sandbox = !__PLAYER_BUILD__ && ($('setupsandbox') as HTMLInputElement).checked;
    if (!sandbox && askReplace()) return;
    game.startMatch(buildSetupConfig());
  });
  $('setupcancel').addEventListener('click', () => {
    setupEl.style.display = 'none';
    if (setupReturn === 'hub') game.openHub();
    else game.showConnect(true);
  });
}
