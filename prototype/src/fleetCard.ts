/**
 * Карточка флота (REFM-224): что боковая панель показывает о выбранном флоте. Свой флот на
 * телефоне — карточка с корпусом, щитом, параметрами с надбавками, метками эффектов,
 * плитками состава, трюмом, маршрутом, ударом по миру и сводкой армии рядом; на ПК — окно
 * консолью (`fleetConsole.ts`). Чужой флот — та же карточка без приказов, неопознанный — одна
 * сигнатура. Здесь же паспорта мины, ракетной мины и летящей ракеты, карточка группы,
 * карточка эскадры в воздухе, всплывашка надбавок параметра и плитки юнитов: ими рисует
 * и гарнизон мира, поэтому плитки экспортируются.
 *
 * Правила того, ЧТО показать, живут в чистых модулях рядом (`fleetSummary.ts`,
 * `fleetEffects.ts`, `dockedActions.ts`, `repairOffer.ts`, `hangarPanel.ts`) и в решениях
 * `decisions/` (`statModifiers`, `landColumn`, `mineCard`, `missileCard`, `aloftCard`); здесь
 * только разметка. Мир на экране, своё место, имена, открытая сводка, окно консоли, видимые
 * мины, часы карты, имя флота, тип сектора, эскадра вылета и её база, флот листа и досье
 * живут в `main.ts`; модуль получает их хуками {@link initFleetCard}: импорт оттуда был бы
 * циклом.
 */
import type { visibleOrdnance } from '../../packages/shared-core/src/state/visibility';
import {
  COMBAT_UNIT_CAP,
  effectiveStats,
  estimateTravelHours,
  fleetBaseSpeed,
  getStance,
  missingHull,
  previewBattle,
  previewLossCount,
  type Fleet,
  type GameState,
  type Planet,
  type ShuttleStrike,
  type Squadron,
  type StrikeBase,
  type UnitStack,
} from '../../packages/shared-core/src/index';
import { isMineFleet } from '../../packages/shared-core/src/state/minefields';
import { isMissileFleet, isRocketMineFleet } from '../../packages/shared-core/src/state/ordnance';
import { t, tData } from '../../localization/runtime';
import { aloftCard, type AloftCard } from '../../decisions/aloftCard';
import { anchoredPopover } from '../../decisions/anchoredPopover';
import { fleetAloftPlaces, fleetHolds } from '../../decisions/fleetHolds';
import { ambushOf } from '../../decisions/forkAmbush';
import { landColumnShown } from '../../decisions/landColumn';
import { mineCard } from '../../decisions/mineCard';
import { minelayerOffer } from '../../decisions/minefields';
import { missileCard } from '../../decisions/missileCard';
import { holdsPatrol } from '../../decisions/patrolMarks';
import { rocketMineCard } from '../../decisions/rocketMineCard';
import { sovereignRepairCost } from '../../decisions/sectorZeroProgress';
import {
  fleetStatMods,
  fleetStatQueries,
  pctText,
  statSourceKey,
  type FleetStatMods,
  type StatBreakdown,
  type StatTone,
} from '../../decisions/statModifiers';
import { tileHp } from '../../decisions/unitTile';
import { veteranMark } from '../../decisions/veteranMark';
import { showsStarving } from './arrearsWarnings';
import { marchFlagged } from './chainComposer';
import {
  docked as fleetDocked,
  forecastShown,
  groundSummaryShown,
  strikeOffered,
} from './dockedActions';
import { unitTitle, type Dossier } from './dossiers';
import {
  columnTitleHtml,
  STAT_TERM,
  statGridHtml,
  statPopHtml,
  troopTableHtml,
  vitalsHtml,
  type ConsoleStat,
  type StatPopRow,
  type StatPopView,
  type StatView,
  type TroopRow,
  type VitalView,
} from './fleetConsole';
import { effectsShown, fleetEffects, pointDefenseTotal, type EffectTag } from './fleetEffects';
import { fleetHoldsHtml } from './fleetHoldView';
import { fleetSummary, hullPct, LIMP_PCT, stackPools } from './fleetSummary';
import { countdownHMS, displayUnit, esc, kfmt, resLine } from './format';
import {
  ctx,
  data,
  dockRepairCost,
  fleetAtOwnDock,
  FORCED_MARCH_MULT,
  instantRepairCost,
  traceHooks,
} from './game';
import { pcUi } from './graphicsPrefs';
import { troopsInputFor } from './groupOrders';
import {
  fleetHangar,
  hasHangar,
  planetHangar,
  transferOffer,
  type HangarView,
  type TransferOffer,
} from './hangarPanel';
import { heroDisplayName } from './heroStaff';
import { holoIcon } from './holographicIcons';
import { SOV_SVG, unitIcon, unitIconHtml } from './icons';
import { troopsPlan } from './interaction';
import type { SectorType } from './map';
import { squadronRelocateSpots } from './mapAim';
import { fleetKnown, fleetNode } from './mapFog';
import { ownerColor, youColor } from './mapPalette';
import { moduleIcon } from './moduleIcons';
import { actionButton, cardHeader as kitCardHeader, pcols } from './panelKit';
import { fleetWhere, groupTotals } from './panelSelect';
import { worldName } from './planetName';
import { isGroundUnit } from './planetSummary';
import { canDockRepair, canRepair } from './repairOffer';
import { HINT_KEY, MINE_MODES, MODE_KEY } from './rocketMinesUi';
import { isSectorZeroRun } from './sectorRun';
import { catalogPortraitHtml } from './shipArt';
import { splitOne, SQUADRON_KIND_KEY, squadronCallsignOf, squadronCards } from './squadronPanel';
import { termBody } from './termTip';
import { restRouteHours } from './travelEta';
import { unitGlyphSvg } from './unitGlyphs';
import { veteranTag } from './veteranChevrons';
import { hangarSectionHtml, unitRows } from './worldCard';
import { planet } from './worldQueries';

/** Что карточке нужно от игры. Мир, выбор, мины, часы и имена флотов — в `main.ts`. */
export interface FleetCardHost {
  /** Мир на экране. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Имена держав по месту. */
  names(): Record<string, string>;
  /** Флот, чья сводка армии открыта рядом с карточкой; `null` — ничья. */
  fleetInfoFor(): string | null;
  /** Флот, который окно показывает консолью ПК; `null` — консоли нет. */
  consoleFleet(): Fleet | null;
  /** Мины и ракеты, которые видит своё место. */
  mineView(): ReturnType<typeof visibleOrdnance>;
  /** Время, по которому карта рисует движущееся. */
  mapNow(): number;
  /** Имя флота: «Флот «ПОЗЫВНОЙ»», у крепости — «крепость». */
  fleetTitleOf(id: string): string;
  /** Тип сектора узла; `undefined` — узел не на карте. */
  sectorType(id: string): SectorType | undefined;
  /** Эскадра вылета той же формы, что в ангаре. */
  strikeSquadron(st: ShuttleStrike): Squadron;
  /** База вылета размеченным адресом — как у прицела из ангара. */
  strikeFrom(st: ShuttleStrike): { planetId: string } | { fleetId: string };
  /** Флот, которого касается лист: выбранный или осматриваемый; `null` — ничей. */
  panelFleet(): string | null;
  /** Досье объекта по ключу (`stat:atk`…); `null` — досье нет. */
  dossier(key: string): Dossier | null;
}

let game: FleetCardHost;

/** Подключить карточку флота к игре. */
export function initFleetCard(host: FleetCardHost): void {
  game = host;
}

const btn = actionButton;
const isGround = (u: string) => isGroundUnit(u, data);
/** Total count across a stack of units (ships, garrison or landing troops). */
const sumUnits = (stacks: ReadonlyArray<{ count: number }>): number =>
  stacks.reduce((a, s) => a + s.count, 0);
/** Имя места — то же, что у журнала и окон (`planetName.ts`, UIX-5.2). */
const placeName = (id: string): string => worldName(game.world(), id);
const sectorTypeOf = (id: string): SectorType | undefined => game.sectorType(id);
const fleetTitleOf = (id: string): string => game.fleetTitleOf(id);
const consoleFleet = (): Fleet | null => game.consoleFleet();
const mineView = (): ReturnType<typeof visibleOrdnance> => game.mineView();
const mapNow = (): number => game.mapNow();
const strikeSquadron = (st: ShuttleStrike): Squadron => game.strikeSquadron(st);
const strikeFrom = (st: ShuttleStrike): { planetId: string } | { fleetId: string } =>
  game.strikeFrom(st);
const panelFleet = (): string | null => game.panelFleet();
const objDossier = (key: string): Dossier | null => game.dossier(key);

function cardHeader(
  color: string,
  title: string,
  sub: string,
  titleAct?: string,
  badge?: string,
): string {
  return kitCardHeader(color, title, sub, {
    compact: pcUi(),
    ...(titleAct ? { titleAct } : {}),
    ...(badge ? { badge } : {}),
  });
}

/**
 * Карточка мины (SM-3.6, решение владельца 2026-09-30: «можно так же выделить и прочитать
 * характеристики»). Числа — `decisions/mineCard.ts`; приказов у мины нет, а чужую мину бьют
 * челноки или «Атакой» с карточки своего флота.
 */
function mineCardHtml(f: Fleet): string {
  const card = mineCard(f, data);
  const pct = card.hull.max > 0 ? Math.round((100 * card.hull.cur) / card.hull.max) : 0;
  return (
    cardHeader(ownerColor(f.owner), t('mine.card.title'), t('mine.card.sub', { n: card.charges })) +
    `<div class="row hullrow" data-desc="stat:hull"><span class="hico">♥</span><span class="hbar"><i style="width:${pct}%"></i></span><b>${kfmt(card.hull.cur)}/${kfmt(card.hull.max)}</b></div>` +
    `<div class="row"><b>💣 ${esc(t('mine.card.hit', { p: card.hitPct }))}</b></div>` +
    `<div class="hint">${esc(t('mine.card.rule'))}</div>`
  );
}

/** Карточка ракетной мины (SM-3.7a): что показать — `decisions/rocketMineCard.ts`. Режим и
 *  снятие — те же действия, что в окне носителя (`rocketMinesUi`), через `data-act`. */
function rocketMineCardHtml(f: Fleet): string {
  const ME = game.me();
  const card = rocketMineCard(f, mineView()?.controls?.[f.id], ME, data);
  if (!card) return '';
  const pct = card.hull.max > 0 ? Math.round((100 * card.hull.cur) / card.hull.max) : 0;
  const sub = card.mode ? t(MODE_KEY[card.mode]) : t(card.own ? 'mine.ready' : 'mine.detected');
  let html =
    cardHeader(ownerColor(f.owner), t('data.rocket-mine'), sub) +
    `<div class="row hullrow" data-desc="stat:hull"><span class="hico">♥</span><span class="hbar"><i style="width:${pct}%"></i></span><b>${kfmt(card.hull.cur)}/${kfmt(card.hull.max)}</b></div>` +
    `<div class="row"><b>📡 ${esc(t('mine.card.rocket', { radar: card.radar, sight: card.sight }))}</b></div>`;
  if (card.damage !== null)
    html += `<div class="row"><b>💥 ${esc(t('mine.card.rocket-hit', { damage: card.damage }))}</b></div>`;
  html += `<div class="hint">${esc(t('mine.card.rocket-rule'))}</div>`;
  if (card.own) {
    html += '<div class="row">';
    for (const mode of MINE_MODES)
      html += `<button class="chip" data-act="rmmode" data-arg="${mode}" aria-pressed="${card.mode === mode}" title="${esc(t(HINT_KEY[mode]))}">${esc(t(MODE_KEY[mode]))}</button>`;
    html += `<button class="chip" data-act="rmdisarm">${esc(t('mine.disarm'))}</button></div>`;
  }
  return html;
}

/** Карточка летящей ракеты (SM-3.7b): что показать — `decisions/missileCard.ts`. Приказов у
 *  ракеты нет, поэтому и кнопок нет: «невозможно контролировать» (решение владельца). */
function missileCardHtml(f: Fleet): string {
  const ME = game.me();
  const card = missileCard(f, mineView()?.warheads?.[f.id], ME, mapNow(), data);
  if (!card) return '';
  const pct = card.hull.max > 0 ? Math.round((100 * card.hull.cur) / card.hull.max) : 0;
  let html =
    cardHeader(
      ownerColor(f.owner),
      t('data.missile'),
      t('missile.card.eta', { in: countdownHMS(card.leftMs) }),
    ) +
    `<div class="row hullrow" data-desc="stat:hull"><span class="hico">♥</span><span class="hbar"><i style="width:${pct}%"></i></span><b>${kfmt(card.hull.cur)}/${kfmt(card.hull.max)}</b></div>` +
    `<div class="row"><b>💥 ${esc(t('missile.card.blast', { r: card.blast }))}</b></div>`;
  if (card.damage !== null)
    html += `<div class="row"><b>💥 ${esc(t('mine.card.rocket-hit', { damage: card.damage }))}</b></div>`;
  return html + `<div class="hint">${esc(t('missile.card.rule'))}</div>`;
}

/**
 * Осмотр объекта: краткая карточка слева, ОДНА подробная секция справа.
 *
 * Прежде подробности ВЫТЕСНЯЛИ карточку: тап по имени убирал и состав, и кнопки, и
 * игрок читал сводку, потеряв из виду то, о чём она. Обе половины живут рядом, поэтому
 * приказ остаётся под рукой, пока читаешь цифры. Пустая `detail` — обычная карточка без
 * обёрток: сетка (`#side.details-open`) нужна только когда справа правда что-то есть.
 */
function objectPanelHtml(brief: string, detail: string): string {
  return detail
    ? `<div class="object-brief">${brief}</div><div class="object-detail">${detail}</div>`
    : brief;
}

/** Side-panel: the multi-fleet TASK-GROUP card (Shift-frame selection). */
export function taskGroupPanelHtml(group: Fleet[]): string {
  const ME = game.me();
  const totals = groupTotals(group);
  let h = cardHeader(
    ownerColor(ME),
    t('side.group.title'),
    t('side.group.sub', { f: totals.fleets, s: totals.ships, tr: totals.troops }),
  );
  h += `<div class="hint">${t('side.group.hint')}</div>`;
  for (const f of group) {
    const where = fleetWhere(f);
    const loc =
      where.kind === 'orbit'
        ? where.at
        : where.kind === 'transit'
          ? `${where.from}→${where.to}`
          : where.kind === 'lane'
            ? `⟜ ${where.from}–${where.to}`
            : '—';
    const nShips = sumUnits(f.units);
    const nTr = sumUnits(f.landing ?? []);
    h += `<div class="row" style="color:${ownerColor(f.owner)}">▲ ${f.id} <span class="dim">${loc}</span> · ${nShips}${nTr ? '+' + nTr : ''}</div>`;
  }
  h += btn('cancel', '', t('side.group.clear'), true);
  return h;
}

/** Тайлы состава Bytro-стиля: силуэт-архетип в цвете стороны (наземные — портрет
 *  с подписью имени), счётчик, мини-бар корпуса стека и его числа
 *  «осталось/всего» (`decisions/unitTile.ts`, заказ владельца 2026-09-25). Тап по кораблю
 *  флота — карточка стека с отсеками и надетыми модулями (`shipCard.ts`), по наземному и
 *  по гарнизону мира — досье юнита. */
/** Даёт ли выслуга силу в этом матче — тот же конфиг, на котором считает ядро (VET-6). */
export function veteranPowerOn(): boolean {
  const s = game.world();
  return ctx(s.time, s).config?.veteranPower === true;
}
export function unitTileHtml(
  u: UnitStack,
  owner: string | null,
  open: string,
  named = false,
  color = ownerColor(owner),
): string {
  const s = game.world();
  if (u.count <= 0) return '';
  const def = data.units[u.unit];
  if (!def) return '';
  const name = unitTitle(u.unit);
  const eff = effectiveStats(def, u, data);
  const hp = tileHp(stackPools(u, data).hull); // тот же зажим остатка, что в сводке (REFM-37)
  const ground = def.domain === 'ground';
  const art = ground ? catalogPortraitHtml('u', u.unit, data, 'thumb') : '';
  const icon =
    art ||
    (ground
      ? `<span class="pt-ic">${unitIcon(u.unit, data)}</span>`
      : `<span class="pt-ic">${unitGlyphSvg(def, { unitId: u.unit, ownerFaction: owner ? s.players[owner]?.faction : undefined, color, shield: (eff.shield ?? 0) > 0 })}</span>`);
  // Наземные портреты сохраняют подпись; корабль узнаётся по силуэту, имя — в подсказке.
  // Окно флота на ПК (`named`) подписывает и корабли — так на макете владельца.
  const caption = ground || named ? `<span class="pt-n">${esc(name)}</span>` : '';
  // Installed modules at a glance (RULES-2.1 / SM-0.3): two cruisers with different
  // modules are separate stacks. Значками, как в конструкторе, — семипиксельные
  // подписи не читались; имя модуля — в подсказке, полная картина — в карточке.
  const modTags =
    u.modules && u.modules.length > 0
      ? `<span class="pt-mods">${u.modules
          .map((m) => {
            const mdef = data.modules[m];
            const mname = mdef ? tData(mdef.name) : m;
            return `<span class="pt-mod" title="${esc(mname)}" aria-label="${esc(mname)}">${moduleIcon(m)}</span>`;
          })
          .join('')}</span>`
      : '';
  // Ветеран — своя плитка (стеки разной выслуги не сливаются) с шевронами степени.
  const vet = veteranMark(u, data, veteranPowerOn());
  return `<button class="ptile${art ? ' with-art' : ''}${vet ? ' vet' : ''}" ${open} data-desc="u:${esc(u.unit)}" data-name="${esc(name)}" title="${esc(name)} — ${t('side.fleet.tile.hint')}">${icon}${vet ? veteranTag(vet, 'pt-vet') : ''}${caption}<span class="pt-c">×${u.count}</span>${modTags}<span class="pt-hp${hp.low ? ' low' : ''}"><i style="width:${hp.pct}%"></i></span><span class="pt-hpn">${kfmt(hp.cur)}/${kfmt(hp.max)}</span></button>`;
}
function fleetTilesHtml(f: Fleet, stacks: UnitStack[], named = false): string {
  const tiles = stacks
    .map((u, index) => {
      const def = data.units[u.unit];
      if (!def) return '';
      const open =
        def.domain === 'space'
          ? `data-shipcard="${esc(f.id)}|${index}"`
          : `data-codex="u:${esc(u.unit)}"`;
      return unitTileHtml(u, f.owner, open, named);
    })
    .join('');
  return tiles ? `<div class="ptiles">${tiles}</div>` : '';
}
/** Гарнизон мира — теми же плитками, что состав флота (заказ владельца 2026-09-25): тап —
 *  досье юнита, как у прежней строки. Пустой гарнизон называется словами, а не пропадает. */
export function garrisonTilesHtml(owner: string | null, stacks: UnitStack[]): string {
  const tiles = stacks.map((u) => unitTileHtml(u, owner, `data-codex="u:${esc(u.unit)}"`)).join('');
  return tiles
    ? `<div class="ptiles">${tiles}</div>`
    : `<div class="row dim">${esc(t('side.none'))}</div>`;
}

/** Сводка армии (тап по имени в шапке карточки): состав по архетипам, боевой вес
 *  с капом, пулы корпуса/щита, скорость с активными множителями, трюм, радар,
 *  содержание. Обратно — тем же тапом по имени или кнопкой «назад». */
function fleetSummaryHtml(f: Fleet): string {
  const s = game.world();
  const ME = game.me();
  // Всю арифметику считает `fleetSummary.ts` (REFM-37) — там же правила «огонь
  // ограничен линией боя», «радар — максимум, а не сумма» и зажим пулов.
  const sm = fleetSummary(f, data, s.time);
  const rows: string[] = [];
  const ARCH_LABEL: Record<string, string> = {
    scout: t('side.arch.scout'),
    combat: t('side.arch.combat'),
    transport: t('side.arch.transport'),
    flagship: t('side.arch.flagship'),
    swarm: t('side.arch.swarm'),
  };
  const comp = sm.composition
    .map(({ archetype, count }) => `${ARCH_LABEL[archetype] ?? archetype} ×${count}`)
    .join(' · ');
  rows.push(
    `<div class="row">${t('side.summary.composition')}: <b>${comp || t('side.none')}</b>${sm.troops ? ` · ${t('side.summary.troops')} ×${sm.troops}` : ''}</div>`,
  );
  // боевой вес: кап против полной суммы — видно, сколько стволов «за линией»
  rows.push(
    `<div class="row">⚔ ${t('side.summary.attack')}: <b>${sm.attack.capped}</b>${sm.attack.total > sm.attack.capped ? ` <span class="dim">(${t('side.summary.total')} ${sm.attack.total} — ${t('side.summary.firing-cap', { n: COMBAT_UNIT_CAP })})</span>` : ''}</div>`,
  );
  rows.push(`<div class="row">🛡 ${t('side.summary.defense')}: <b>${sm.defense}</b></div>`);
  rows.push(
    `<div class="row">♥ ${t('side.summary.hull')}: <b>${kfmt(sm.hull.cur)}/${kfmt(sm.hull.max)}</b>${sm.shield.max > 0 ? ` · ◈ ${t('side.summary.shield')}: <b>${kfmt(sm.shield.cur)}/${kfmt(sm.shield.max)}</b>` : ''}</div>`,
  );
  // скорость: база (мин по корпусам, лимп учтён) + активные множители
  const mults: string[] = [];
  if (marchFlagged(f.id)) mults.push(`⚡ ${t('side.summary.forced-march')} ×${FORCED_MARCH_MULT}`);
  if (sm.retreatHaste) mults.push(`⤺ ${t('side.summary.retreat-haste')} ×1.5`);
  rows.push(
    `<div class="row">⚡ ${t('side.summary.speed')}: <b>${sm.speed > 0 ? Math.round(sm.speed) : '—'}</b>${mults.length ? ` <span class="dim">${mults.join(' · ')}</span>` : ''} <span class="dim">· ${t('side.summary.speed.note')}</span></div>`,
  );
  if (f.owner === ME)
    rows.push(fleetHoldsHtml(fleetHolds(f, data, s.time, fleetAloftPlaces(s, f, data))));
  else if (sm.cargo)
    rows.push(
      `<div class="row">📦 ${t('side.summary.cargo')}: <b>${sm.cargo.used}/${sm.cargo.cap}</b></div>`,
    );
  if (sm.radar > 0)
    rows.push(`<div class="row">📡 ${t('side.summary.radar')}: <b>${sm.radar}</b></div>`);
  // UI-RES2: содержание флота — теми же чипами, что цена и выработка; суффикс «/д»
  // несёт сам чип, поэтому хвост «/день» из строки ушёл.
  const up = resLine(sm.upkeep, { per: 'd' });
  if (up) rows.push(`<div class="row dim">${t('side.summary.upkeep')}: ${up}</div>`);
  return (
    `<div class="sec detail-head">${t('side.summary.title')}</div>` +
    rows.join('') +
    `<div class="row">${btn('summaryback', '', t('side.summary.back'), true)}</div>`
  );
}

/** Side-panel: a single selected fleet — combat stats, orders, docking. */
/** Подпись метки эффекта: решение о наборе принимает `fleetEffects.ts`, текст — локаль. */
function effectTagText(tag: EffectTag): string {
  switch (tag.kind) {
    case 'in-battle':
      return `⚔️ ${t('effect.in-battle')}`;
    case 'forced-march':
      return `⚡ ${t('effect.forced-march')}`;
    case 'bombarding':
      return `⊗ ${t('effect.bombarding')}`;
    case 'patrol':
      return `🛩 ${t('effect.patrol')}`;
    case 'blackout':
      return `🌫 ${t('effect.blackout')}`;
    case 'hunger':
      return `🍽 ${t('effect.hunger')}`;
    case 'point-defense':
      return `🛡 ${t('effect.point-defense', { n: tag.n })}`;
  }
}

export function fleetPanelHtml(f: Fleet): string {
  const s = game.world();
  const ME = game.me();
  const NAME = game.names();
  // Мина (SM-3.6): свой короткий паспорт — заряды, доля за подрыв, прочность. Ракетная
  // (SM-3.7a) — радар, обзор и прочность, а хозяину ещё режим, удар и управление.
  if (isMineFleet(f, data))
    return isRocketMineFleet(f, data) ? rocketMineCardHtml(f) : mineCardHtml(f);
  // Ракета (SM-3.7b): приказов нет — прочность, остаток полёта, взрыв, а хозяину и удар.
  if (isMissileFleet(f, data)) return missileCardHtml(f);
  // Окно флота на ПК — консоль по макету владельца (`fleetConsole.ts`): те же куски
  // карточки, своя раскладка. Карточка ниже остаётся телефону, группе и чужому флоту.
  if (consoleFleet() === f) return fleetConsoleHtml(f);
  const nShips = sumUnits(f.units);
  const nTr = sumUnits(f.landing ?? []);
  // Пулы, залп и ход считает `fleetSummary.ts` — та же арифметика, что в сводке
  // армии (REFM-37/40): корпус и щит по ЭФФЕКТИВНОМУ hp (фитинг учтён), корабли и
  // десант вместе, остаток зажат по максимуму. Порог хромоты `LIMP_PCT` — то же
  // число, по которому ядро режет скорость, поэтому метка ⚠ зажигается ровно тогда,
  // когда флот действительно замедлился.
  const sm = fleetSummary(f, data, s.time);
  const hull = sm.hull;
  const pct = hullPct(hull);
  const hullTag = pct < LIMP_PCT ? ` · ⚠ ${t('side.fleet.hull-tag', { p: pct })}` : '';
  // Bytro-стиль: авто-имя соединения (слово + позывной), тап → сводка. Слово одно на
  // любой размер (SHU-4.1): «эскадра» и прочие авиационные ступени принадлежат челнокам.
  const fleetTitle = fleetTitleOf(f.id);
  let h = kitCardHeader(
    ownerColor(f.owner),
    fleetTitle,
    (pcUi()
      ? t('side.fleet.sub.pc', { s: nShips, tr: nTr })
      : t('side.fleet.sub', { s: nShips, tr: nTr })) +
      hullTag +
      fleetSubNotes(f, nTr),
    { compact: pcUi(), titleAct: 'fleetinfo', subLive: fleetLandingNote(f) },
  );
  // Тап по имени открыл сводку армии — она встаёт РЯДОМ с карточкой (`objectPanelHtml`),
  // а не вместо неё.
  const detail = game.fleetInfoFor() === f.id ? fleetSummaryHtml(f) : '';
  // Свой флот — числа С надбавками и цветом (`decisions/statModifiers.ts`, заказ
  // владельца 2026-09-27): технологии, фракция, аура героя, местность уже внутри;
  // зелёный — бафы, красный — дебафы перевесили; тап по числу — всплывашка источников.
  // У корпуса и щита цвет — по входящему урону. Чужой флот — голые суммы.
  const mods = fleetStatModsOf(f);
  const tone = (x: StatTone | undefined): string => (x && x !== 'neutral' ? ` class="${x}"` : '');
  // Тап по параметру открывает его всплывашку у ЛЮБОГО флота (UIX-9.4): у чужого в ней одно
  // правило, без строк надбавок, — но «АТК» и «Ⅹ» расшифрованы и у него.
  const key = ' role="button" tabindex="0"';
  const tap = (stat: string): string => ` data-stat="${stat}"`;
  // В строке корпуса живут кнопки ремонта, поэтому кнопкой для клавиатуры служит число,
  // а не вся строка: кнопка внутри кнопки — не кнопка ни для кого.
  if (hull.max > 0) {
    h += `<div class="row hullrow" data-desc="stat:hull"${tap('hull')}><span class="hico">♥</span><span class="hbar${pct < LIMP_PCT ? ' low' : ''}"><i style="width:${pct}%"></i></span><b${tone(mods?.incoming.tone)}${key}>${kfmt(hull.cur)}/${kfmt(hull.max)}</b>${fleetRepairChipsHtml(f)}</div>`;
    if (sm.shield.max > 0)
      h += `<div class="row hullrow" data-desc="stat:shield"${tap('shield')}><span class="hico">◈</span><span class="hbar sh"><i style="width:${hullPct(sm.shield)}%"></i></span><b${tone(mods?.incoming.tone)}${key}>${kfmt(sm.shield.cur)}/${kfmt(sm.shield.max)}</b></div>`;
  }
  if (f.owner === ME)
    h += fleetHoldsHtml(fleetHolds(f, data, s.time, fleetAloftPlaces(s, f, data)));
  h += fleetMinesRowHtml(f);
  // Aggregate combat weight — БОЕВОЙ вес, как его считает ядро: effectiveStats +
  // кап линии огня (топ-10 стволов). Скорость — базовая скорость флота (мин по
  // корпусам, лимп <30% учтён). У своего флота ход уже включает форс-марш, и метка
  // ×1.5 не пишется — её прочли бы как ещё один множитель поверх. У чужого — прежняя.
  const atk = shownFire(sm.attack.capped, mods);
  const def = shownFire(sm.defense, mods);
  const spd = mods ? mods.speed.value : sm.speed;
  const boosted = marchFlagged(f.id);
  const spdTxt =
    spd > 0
      ? boosted && !mods
        ? `${Math.round(spd)} ⚡×${FORCED_MARCH_MULT}`
        : String(Math.round(spd))
      : '—';
  // Fleet-card blurb removed (feedback: compact panel) — the header + stat chips carry it.
  h += `<div class="pstats"><span data-desc="stat:atk"${tone(mods?.fire.tone)}${tap('atk')}${key}>⚔ ${t('side.stat.atk')} ${atk}</span><span data-desc="stat:def"${tone(mods?.fire.tone)}${tap('def')}${key}>🛡 ${t('side.stat.def')} ${def}</span><span data-desc="stat:cap"${tap('cap')}${key}>Ⅹ ${Math.min(nShips, COMBAT_UNIT_CAP)}/${COMBAT_UNIT_CAP}</span><span data-desc="stat:spd"${tone(mods?.speed.tone)}${tap('spd')}${key}>⚡ ${t('side.stat.spd')} ${spdTxt}</span></div>`;

  h += fleetEffectsHtml(f, boosted, nTr);

  // Enemy fleet: show composition only if identified (known node). An
  // unidentified radar contact shows just the signature (ship count), not
  // the exact unit breakdown — fog of war hides the details.
  const enemyKnown = f.owner === ME || fleetKnown(f);
  if (enemyKnown) {
    h += nShips
      ? `<div class="sec">${t('side.fleet.ships')}</div>` + fleetTilesHtml(f, f.units)
      : '';
    if (nTr > 0)
      h += `<div class="sec">${t('side.fleet.troops')}</div>` + fleetTilesHtml(f, f.landing ?? []);
  } else if (nShips > 0) {
    // Radar contact: show only the signature (coarse size), not the composition
    h += `<div class="sec">${t('side.fleet.ships')}</div><div class="row dim">${t('side.fleet.signature', { n: nShips })}</div>`;
  }

  // UI-14: чужой флот тоже имеет обычную карточку и сводку по тапу на имя.
  // Постоянная сводка здесь показывала «Назад» без карточки, к которой можно вернуться.
  // Осмотр заканчивается ДО приказов: этот флот не попадает в набор управления.
  if (f.owner !== ME)
    return objectPanelHtml(
      h +
        `<div class="hint">${t('side.fleet.foreign.hint', { who: esc(NAME[f.owner] ?? f.owner) })}</div>`,
      detail,
    );

  // Artillery rules of engagement moved to the ☰ command bar («🔥 Режим огня»
  // button + popover menu) — the bottom sheet keeps information, not controls.

  h += fleetHangarHtml(f, false);

  // The player's projection hero rides here → name it and flag its fleet aura.
  const heroName = fleetHeroName(f);
  if (heroName !== null)
    h += `<div class="row"><b>♔ ${esc(heroName)}</b> <span class="dim">${t('side.fleet.hero-aura')}</span></div>`;

  // CC-2 auto-storm: the whole «Дежурный режим» section moved to the ☰ command
  // row («⚔ Авто-штурм» toggle) — SO-UI unloads the bottom sheet.

  h += fleetRouteHtml(f, boosted);

  const here = planet(f.location);
  // Что эта карточка ПРЕДЛАГАЕТ сделать — `dockedActions.ts` (REFM-200). Ошибка здесь
  // не падает, а предлагает: живая кнопка, на которую ядро ответит отказом, снаружи
  // выглядит как «ничего не произошло», а прогноз пустого боя читается как расклад.
  const docked = fleetDocked(!!here, !!f.movement, !!f.battleId);
  if (f.battleId) h += fleetBattleRowHtml(f.battleId);
  if (docked) {
    const cols: string[] = [];
    const forecast = fleetForecastHtml(f, here!);
    if (forecast) cols.push(forecast);
    // Ground army at your own world — СВОДКА, без кнопок: сама погрузка/выгрузка
    // переехала в ⇅-меню ряда команд (GRND-1), где есть выбор «кого и сколько».
    // Панель осталась информационной ровно как у стоячих приказов (SO-UI ниже).
    // Только на СВОЕЙ точке: на чужой сводка перечислила бы гарнизон противника.
    if (groundSummaryShown(here!.owner, ME)) {
      let ga = `<div class="sec">${t('side.ground.title')}</div>`;
      const rows = groundRowsAt(here!.garrison, f.landing ?? []);
      const loadingN = (f.loading ?? []).reduce((n, claim) => n + claim.count, 0);
      // Выгрузка идёт час, как погрузка: до срока войска ещё в трюме (`▸` справа).
      const unloadingN = (f.unloading ?? []).reduce((n, claim) => n + claim.count, 0);
      if (rows.length) {
        ga += `<div class="row dim">${t('side.ground.legend')}</div>`;
        for (const r of rows)
          ga += `<div class="row"><span class="bicon">${unitIconHtml(r.unit, data, youColor, 16, s.players[ME]?.faction)}</span>${esc(displayUnit(r.unit))} <b>${r.planet} ▸ ${r.aboard}</b></div>`;
      }
      if (loadingN) ga += `<div class="hint">${t('side.ground.loading', { n: loadingN })}</div>`;
      if (unloadingN)
        ga += `<div class="hint">${t('side.ground.unloading', { n: unloadingN })}</div>`;
      if (!rows.length && !loadingN && !unloadingN)
        ga += `<div class="row dim">${t('side.ground.empty')}</div>`;
      ga += `<div class="hint">${t('side.ground.via-cmd')}</div>`;
      cols.push(ga);
    }
    h += pcols(cols);
  }
  return objectPanelHtml(h, detail);
}

/** Хвост подзаголовка карточки флота: голод, орбита, бомбардировка. Высадку пишет
 *  {@link fleetLandingNote}: у неё живой отсчёт. */
function fleetSubNotes(f: Fleet, nTr: number): string {
  const s = game.world();
  const ME = game.me();
  // ECON-1: голодный десант — владелец в food-arrears бьёт на земле на −25%.
  // Правила пометок о долгах — `arrearsWarnings.ts` (REFM-89): только своё и только
  // там, где есть кому голодать.
  const hungry = showsStarving(f.owner === ME, nTr, s.players[ME]?.arrears)
    ? ` · 🍽 ${t('side.fleet.hunger')}`
    : '';
  return (
    hungry +
    (f.orbit === 'near' ? ' · ' + t('side.fleet.in-orbit') : '') +
    (f.bombarding ? ' · ⊗ ' + t('side.fleet.bombarding') : '')
  );
}

/** Высадка штурмом идёт по таймеру (решение владельца 2026-09-26): флот стоит до срока.
 *  В разметке только срок, отсчёт патчит `updatePanelLive` (`.pn-timer`). Цифры в самой
 *  подписи меняли разметку листа до десяти раз в секунду на быстрой скорости, лист
 *  пересобирался целиком, и кнопки «Бомбардировать» и «Штурм» под курсором мигали. */
function fleetLandingNote(f: Fleet): string {
  if (!f.assaultLanding) return '';
  const timer = `<span class="pn-timer" data-at="${f.assaultLanding.doneAt}">…</span>`;
  return ' · ⤓ ' + t('side.fleet.landing', { t: timer });
}

/** Кнопки ремонта у полосы корпуса. */
function fleetRepairChipsHtml(f: Fleet): string {
  const s = game.world();
  const ME = game.me();
  // ХП-бар Bytro-стиля + два ремонта: ECON-3а — экспресс за METAL у своего дока
  // (дешёвый, основной), и ненавязчивый платный за кредиты — где угодно вне боя
  // (цены — те же формулы, что в гейте).
  // Условия обеих кнопок — `repairOffer.ts` (REFM-90): общая часть «свой, вне боя, есть
  // что чинить» одна на два ремонта, а привязка к доку — только у экспресса за металл.
  const repairCost = instantRepairCost(f, data);
  const repairable = canRepair(f.owner === ME, !!f.battleId, repairCost);
  // В забеге Sector Zero платный ремонт — за Суверены со счёта профиля (заказ владельца
  // 2026-09-24), в остальной игре — за кредиты матча, как было.
  const premiumCost = isSectorZeroRun() ? sovereignRepairCost(missingHull(f, data)) : 0;
  // FORT-5.8: док открыт своему И СОЮЗНОМУ флоту. Союзность кнопка резолвит стойкой —
  // capability `diplomacy` живёт в ядре и требует `HandlerContext`, которого у рендера
  // нет; база самой capability — та же стойка, поэтому ответы сходятся. Правило «что
  // считается доком» при этом НЕ переписано: зовётся та же функция ядра.
  const atDock = canDockRepair(
    repairable,
    fleetAtOwnDock(f, s, data, (a, b) => getStance(s, a, b) === 'alliance'),
  );
  return (
    (atDock
      ? `<button class="chip-metal" data-act="dockrepair" data-arg="${f.id}" title="${t('side.fleet.repair.dock.title')}">🔧 <span class="rc-metal">${dockRepairCost(f, data)}❒</span></button>`
      : '') +
    (!repairable
      ? ''
      : premiumCost > 0
        ? `<button class="chip-sov" data-act="premiumrepair" data-arg="${f.id}" title="${t('side.fleet.repair.premium.title')}">🔧 <i>${SOV_SVG}</i><b>${premiumCost}</b></button>`
        : `<button class="chip-gold" data-act="instantrepair" data-arg="${f.id}" title="${t('side.fleet.repair.instant.title')}">🔧 ${repairCost}💰</button>`)
  );
}

/** Строка минного заградителя. SM-3.5: заградитель ставит поле там, где стоит; правило
 *  и отказы — в ядре. */
function fleetMinesRowHtml(f: Fleet): string {
  const s = game.world();
  const ME = game.me();
  const mines = minelayerOffer(f, s, data, ME);
  if (!mines) return '';
  return `<div class="row">💣 <button class="chip" data-act="laymines" data-arg="${f.id}"${mines.ready ? '' : ' disabled'} title="${t('side.fleet.mines.title')}">${
    mines.ready
      ? t('side.fleet.mines.lay')
      : mines.reason === 'installing'
        ? t('side.fleet.mines.installing', { in: countdownHMS(mines.readyInMs) })
        : mines.reason === 'cooldown'
          ? t('side.fleet.mines.cooldown', { in: countdownHMS(mines.readyInMs) })
          : t('side.fleet.mines.busy')
  }</button></div>`;
}

/** Active effects (RPG-style buffs/debuffs) — a compact row of tags showing what's
 *  currently affecting this fleet: combat, forced march, patrol, flak, blackout,
 *  hunger, bombardment, point defense, free flight, barrage focus.
 *  О чём карточка говорит и о чём МОЛЧИТ — `fleetEffects.ts` (REFM-197): долговые метки
 *  только на СВОЁМ флоте (иначе мои долги показались бы бедой противника), голод — лишь
 *  когда на борту есть десант, зональное ПВО не считает пустые стопки (они остаются
 *  в составе, но стволов у них нет) и не пишется нулём, а пустая полоса не рисуется
 *  совсем — заголовок без меток выглядит поломкой, а не спокойствием. */
function fleetEffectsHtml(f: Fleet, boosted: boolean, nTr: number): string {
  const s = game.world();
  const ME = game.me();
  const pd = pointDefenseTotal(f.units, (st) => {
    const def = data.units[st.unit];
    return def ? (effectiveStats(def, st, data).pointDefense ?? 0) : null;
  });
  const tags = fleetEffects(
    {
      owner: f.owner,
      inBattle: !!f.battleId,
      forcedMarch: boosted,
      bombarding: !!f.bombarding,
      // Корабль-база держит патруль (SHU-6.6) — у своего флота: чужие вылеты в состоянии
      // клиента не видны (`visibleState`), а метка без них соврала бы «не держит».
      patrol: f.owner === ME && holdsPatrol(s.strikes, f.hangar, { kind: 'fleet', id: f.id }, ME),
      troops: nTr,
      pointDefense: pd,
    },
    ME,
    s.players[ME]?.arrears ?? [],
  );
  if (!effectsShown(tags)) return '';
  let h = `<div class="sec">${t('effect.title')}</div><div class="row effects">`;
  for (const tag of tags) h += `<span class="effect-tag">${effectTagText(tag)}</span>`;
  return h + `</div>`;
}

/** ТРЮМ НОСИТЕЛЯ (SHU-2.1 + SHU-3.1). Ангар ПОРТА живёт в панели мира — челнок не
 *  летает во флоте, он стоит в космопорте и бьёт оттуда (SHU-1.2). Но «Шаттл» — вторая
 *  база челноков, она ездит вместе с флотом, и её трюм показывать больше негде: до этого
 *  кирпича шесть машин на борту не были видны игроку вообще. `compact` — окно флота на
 *  ПК: пустой трюм без вылетов там одна строка «ангар пуст», а не секция с заголовком. */
function fleetHangarHtml(f: Fleet, compact: boolean): string {
  const s = game.world();
  const ME = game.me();
  const hold = f.owner === ME ? fleetHangar(f, data, s) : null;
  if (!hasHangar(hold)) return '';
  const idle =
    hold.aloft === 0 && !hold.sortie && squadronCards(hold, { mine: true, data }).length === 0;
  let h =
    compact && idle
      ? `<div class="row dim fc-hangar">${esc(t('side.wing.empty'))}</div>`
      : hangarSectionHtml(hold, f.id, true);
  const offer = fleetWingOffer(f, hold);
  if (offer.load || offer.unload) {
    h +=
      `<div class="row">` +
      (offer.load ? btn('wingload', f.id, t('side.wing.load'), true) : '') +
      (offer.unload ? btn('wingunload', f.id, t('side.wing.unload'), true) : '') +
      `</div>`;
  }
  return h;
}

/** Перегрузка челноков между носителем и портом под ним. Предлагается, только когда
 *  пройдёт: носитель стоит у СВОЕГО мира и место есть с обеих сторон (правило 4 в
 *  `hangarPanel.ts`). Иначе кнопок нет — не серых, а нет: серая обещала бы действие,
 *  которого в этом месте не бывает. */
function fleetWingOffer(f: Fleet, hold: HangarView | null): TransferOffer {
  const s = game.world();
  const ME = game.me();
  const at = f.location ? s.planets[f.location] : undefined;
  return transferOffer(at ? planetHangar(at, data) : null, hold, {
    docked: !!at && !f.movement && at.owner === ME,
    mine: f.owner === ME,
  });
}

/** Рисовать ли колонку «Десант» окна флота (`decisions/landColumn.ts`). Спрашивают оба
 *  хозяина окна: лист рисует колонку, а ряд команд по тому же ответу ставит ⇅ к себе. */
export function fleetLandShown(f: Fleet): boolean {
  const s = game.world();
  const ME = game.me();
  const hold = f.owner === ME ? fleetHangar(f, data, s) : null;
  const wing = hasHangar(hold) ? fleetWingOffer(f, hold) : null;
  return landColumnShown({
    holds: fleetHolds(f, data, s.time, fleetAloftPlaces(s, f, data)),
    wingTransfer: !!wing && (wing.load || wing.unload),
  });
}

/** Имя героя-проекции на борту — его аура даёт флоту +5% атаки и обороны. */
function fleetHeroName(f: Fleet): string | null {
  const s = game.world();
  const NAME = game.names();
  if (!f.units.some((u) => u.count > 0 && data.units[u.unit]?.traits.includes('hero'))) return null;
  const hero = Object.values(s.heroes ?? {}).find((x) => x.owner === f.owner);
  return hero ? heroDisplayName(hero) : (NAME[f.owner] ?? f.owner);
}

/** Где флот идёт или сторожит: цель и ETA в пути, засада или точка на дуге. */
function fleetRouteHtml(f: Fleet, boosted: boolean): string {
  const s = game.world();
  if (f.movement) {
    // total travel-time estimate to the final destination (next-hop ETA from the
    // authoritative schedule + the remaining route at base speed). The ETA ticks
    // every frame, so it's a placeholder here (stable signature → no rebuild) and
    // patched in place by updatePanelLive() — keeps the panel's buttons put.
    const dest = f.movement.destination ?? f.movement.to;
    // Гибкое время в пути: остаток маршрута за текущим лейном пересчитывается с
    // учётом форс-марша (×1.5 с СЛЕДУЮЩЕГО лейна — текущий уже расписан
    // авторитетно в arrivesAt, его не трогаем). Выключил буст — оценка удлиняется.
    const rawRestH =
      dest !== f.movement.to ? estimateTravelHours(s, ctx(s.time), f.movement.to, dest, f) : 0;
    const restH = restRouteHours(rawRestH, boosted, FORCED_MARCH_MULT);
    return `<div class="row">${t('side.fleet.enroute', { dest: `<b>${esc(placeName(dest))}</b>` })} <b class="pn-eta" data-arrive="${f.movement.arrivesAt}" data-rest="${restH}">…</b>${boosted ? ' <span class="dim">⚡</span>' : ''}</div>`;
  }
  if (f.edge) {
    // ROADS-4: стоит ровно на развилке — засада, и строка говорит, что она сторожит.
    const ambush = ambushOf(s, f);
    if (ambush) {
      return `<div class="row">${t('side.fleet.ambush', { planet: `<b>${esc(placeName(ambush.province))}</b>`, exits: ambush.exits.map((x) => esc(placeName(x))).join(', ') })}</div>`;
    }
    const pct = Math.round(f.edge.t * 100);
    return `<div class="row">${t('side.fleet.on-lane', { lane: `<b>${esc(placeName(f.edge.from))}–${esc(placeName(f.edge.to))}</b>`, p: pct })}</div>`;
  }
  return '';
}

/** Карточка боя переехала в ОКНО (`battleScreen.ts`): там те же стороны, полосы корпуса,
 *  фаза, отсчёт раунда и отступление, но во весь экран и с доступом к ЧУЖОМУ бою —
 *  значок на карте открывает то же окно. Панель поэтому не дублирует расклад, а ведёт к
 *  нему одной кнопкой: две копии одного расклада неизбежно разъехались бы, и расходиться
 *  они стали бы молча. */
function fleetBattleRowHtml(battleId: string): string {
  return `<div class="row">${btn('openbattle', battleId, t('battle.win.open'), true)}</div>`;
}

/** Прогноз штурма мира под флотом. Пусто, если мир не чужой или биться некому. Кнопки
 *  удара — бомбардировка и штурм с места — живут в ряду команд (правило 3г `cmdPresence`,
 *  заказ владельца 2026-11-01): раньше они стояли здесь отдельным разделом «Удар» ниже
 *  ангара, вдали от остальных приказов. */
function fleetForecastHtml(f: Fleet, here: Planet): string {
  // enemy/neutral world you can act on — empty space is pass-through only
  // Нейтральная точка считается чужой: она не моя, и взять её можно.
  if (!strikeOffered(here.owner, f.owner, sectorTypeOf(here.id)?.capturable ?? false)) return '';
  // Combat forecast (ONB-6): «если атакую — что будет?» — the pure base-model
  // sim over the landing force vs the garrison the viewer SEES (the fleet is
  // docked here, so the world is identified — no fog leak). A forecast, not an
  // oracle: terrain/fortification/tech bonuses of the live fight are not folded
  // in — the hedge in the copy says so.
  const landing = f.landing ?? [];
  const garrison = here.garrison;
  if (!forecastShown(landing, garrison)) return '';
  const pv = previewBattle(landing, garrison, data);
  const verdict =
    pv.outcome === 'attacker'
      ? t('side.strike.forecast.attacker')
      : pv.outcome === 'defender'
        ? t('side.strike.forecast.defender')
        : t('side.strike.forecast.draw');
  return (
    `<div class="row dim">${t('side.strike.forecast', {
      v: `<b>${verdict}</b>`,
      r: pv.roundsEst,
      a: previewLossCount(pv.attacker),
      pa: Math.round(pv.attacker.damageFraction * 100),
      d: previewLossCount(pv.defender),
      pd: Math.round(pv.defender.damageFraction * 100),
    })}</div>` + `<div class="hint">${t('side.strike.forecast.hint')}</div>`
  );
}

/** Наземные части: тип, сколько в гарнизоне мира и сколько в трюме флота. */
function groundRowsAt(
  garrison: readonly UnitStack[],
  carried: readonly UnitStack[],
): Array<{ unit: string; planet: number; aboard: number }> {
  const groundHere = garrison.filter((st) => isGround(st.unit));
  const types: string[] = [];
  for (const st of [...groundHere, ...carried])
    if (isGround(st.unit) && !types.includes(st.unit)) types.push(st.unit);
  const cnt = (stacks: readonly UnitStack[], u: string): number =>
    stacks.reduce((n, st) => (st.unit === u ? n + st.count : n), 0);
  return types.map((unit) => ({ unit, planet: cnt(groundHere, unit), aboard: cnt(carried, unit) }));
}

/** Надбавки к параметрам СВОЕГО флота (`decisions/statModifiers.ts`). Разбор ядра стоит
 *  клона состояния, а панель собирается каждый кадр: ответ живёт, пока тот же флот и то
 *  же состояние, а при идущих часах — не дольше четверти секунды. Чужой флот — `null`:
 *  его технологии и герои не наше знание. */
let statModsMemo: {
  fleetId: string;
  state: GameState;
  at: number;
  mods: FleetStatMods | null;
} | null = null;
export function fleetStatModsOf(f: Fleet): FleetStatMods | null {
  const s = game.world();
  const ME = game.me();
  if (f.owner !== ME) return null;
  const now = performance.now();
  const memo = statModsMemo;
  if (memo && memo.fleetId === f.id && (memo.state === s || now - memo.at < 250)) return memo.mods;
  const actual = fleetBaseSpeed(f, data);
  // Номинальный ход — тот же расчёт ядра по целым корпусам: разница с фактическим и есть
  // хромота (правило 4 модели надбавок).
  const nominal = fleetBaseSpeed({ ...f, units: f.units.map(({ hp: _hp, ...st }) => st) }, data);
  const mods = fleetStatMods(traceHooks(s, fleetStatQueries(f, actual)), nominal);
  statModsMemo = { fleetId: f.id, state: s, at: now, mods };
  return mods;
}

/** Атака или защита так, как их показывают: с надбавками, когда они известны. Одна
 *  формула на карточку, консоль и всплывашку — иначе число в окне и в её шапке разойдутся. */
export function shownFire(raw: number, mods: FleetStatMods | null): number {
  return mods ? Math.round(raw * mods.fire.factor) : raw;
}

/** Окно флота консолью: шапка с корпусом и щитом, «Состав», «Десант», низ окна. «Приказы»
 *  рисует ряд команд (`renderCmdBar`), а раскладывает всё сетка окна (`holographic.css`). */
function fleetConsoleHtml(f: Fleet): string {
  const s = game.world();
  const ME = game.me();
  const nShips = sumUnits(f.units);
  const nTr = sumUnits(f.landing ?? []);
  const sm = fleetSummary(f, data, s.time);
  const mods = fleetStatModsOf(f);
  const boosted = marchFlagged(f.id);
  const node = fleetNode(f);
  // Шапку листа окно прячет, но её подзаголовок переезжает в шапку окна (`layoutWindows`):
  // здесь он такой, как на макете, — где флот и сколько в нём кораблей, плюс живые метки.
  const sub =
    [node ? placeName(node) : '', t('fleet.console.ships', { n: nShips })]
      .filter(Boolean)
      .join(' · ') + fleetSubNotes(f, nTr);
  // Шапка окна широкая: подзаголовку не нужно сжатие узкой карточки ПК (` · ` → `·`).
  const h = kitCardHeader(ownerColor(f.owner), fleetTitleOf(f.id), sub, {
    titleAct: 'fleetinfo',
    subLive: fleetLandingNote(f),
  });
  const detail = game.fleetInfoFor() === f.id ? fleetSummaryHtml(f) : '';

  // Щит показывается всегда, даже когда его нет: «нет» — тоже ответ (заказ владельца).
  const incoming = mods?.incoming.tone ?? 'neutral';
  const vitals: VitalView[] = [
    {
      stat: 'hull',
      label: t('dossier.stat.hull.name'),
      value: `${kfmt(sm.hull.cur)}/${kfmt(sm.hull.max)}`,
      pct: hullPct(sm.hull),
      low: hullPct(sm.hull) < LIMP_PCT,
      tone: incoming,
    },
    {
      stat: 'shield',
      label: t('dossier.stat.shield.name'),
      value:
        sm.shield.max > 0
          ? `${kfmt(sm.shield.cur)}/${kfmt(sm.shield.max)}`
          : t('fleet.console.shield.none'),
      // Щита нет — нет и полосы: пустая полоса читалась бы как «щит сбит».
      pct: sm.shield.max > 0 ? hullPct(sm.shield) : null,
      low: false,
      tone: sm.shield.max > 0 ? incoming : 'neutral',
    },
  ];
  let body = vitalsHtml(vitals, fleetRepairChipsHtml(f));

  // «Состав»: параметры с надбавками, метки эффектов, плитки кораблей с именами.
  const speed = mods ? mods.speed.value : sm.speed;
  const stats: StatView[] = [
    {
      stat: 'atk',
      icon: 'sword',
      label: t('dossier.stat.atk.name'),
      value: String(shownFire(sm.attack.capped, mods)),
      tone: mods?.fire.tone ?? 'neutral',
    },
    {
      stat: 'def',
      icon: 'shield',
      label: t('dossier.stat.def.name'),
      value: String(shownFire(sm.defense, mods)),
      tone: mods?.fire.tone ?? 'neutral',
    },
    {
      stat: 'cap',
      icon: 'stack',
      label: t('dossier.stat.cap.name'),
      value: `${Math.min(nShips, COMBAT_UNIT_CAP)}/${COMBAT_UNIT_CAP}`,
      tone: 'neutral',
    },
    {
      stat: 'spd',
      icon: 'lightning',
      label: t('dossier.stat.spd.name'),
      value: speed > 0 ? String(Math.round(speed)) : '—',
      tone: mods?.speed.tone ?? 'neutral',
    },
  ];
  const info = esc(t('fleet.console.composition.hint'));
  body +=
    `<section class="fc-comp">` +
    columnTitleHtml(
      t('fleet.console.composition'),
      `<span class="fc-info" title="${info}" aria-label="${info}">${holoIcon('info')}</span>`,
    ) +
    statGridHtml(stats) +
    fleetEffectsHtml(f, boosted, nTr) +
    fleetMinesRowHtml(f) +
    fleetTilesHtml(f, f.units, true) +
    fleetRouteHtml(f, boosted) +
    (f.battleId ? fleetBattleRowHtml(f.battleId) : '') +
    `</section>`;

  // «Десант»: трюм, кто где, ангар, погрузка и удар по миру под флотом.
  const here = planet(f.location);
  const docked = fleetDocked(!!here, !!f.movement, !!f.battleId);
  const ownWorld = !!here && docked && groundSummaryShown(here.owner, ME);
  const rows: TroopRow[] = groundRowsAt(ownWorld ? here!.garrison : [], f.landing ?? []).map(
    (r) => ({
      icon: unitIconHtml(r.unit, data, youColor, 16, s.players[ME]?.faction),
      name: displayUnit(r.unit),
      planet: ownWorld ? r.planet : null,
      aboard: r.aboard,
    }),
  );
  const troopsIn = troopsInputFor(f.id);
  let land =
    fleetHoldsHtml(fleetHolds(f, data, s.time, fleetAloftPlaces(s, f, data))) +
    troopTableHtml(rows, ownWorld) +
    fleetHangarHtml(f, true) +
    (troopsIn
      ? `<button type="button" class="fc-load${troopsPlan?.fleetId === f.id ? ' on' : ''}" data-cmd="troops" title="${esc(t('cmd.troops.hint'))}">${holoIcon('arrows-down-up')}<span>${esc(t('fleet.console.load'))}</span></button>`
      : '');
  if (here && docked) land += fleetForecastHtml(f, here);
  // Пустой трюм колонку не рисует (`fleetLandShown`): ⇅ тогда стоит в «Приказах».
  if (land && fleetLandShown(f)) body += `<section class="fc-land">${land}</section>`;

  // Низ окна: герой на борту и его вклад (слева); «Подробнее о флоте» ставит ряд команд.
  // Вклад — строка героя из разбора ядра: база ауры и пассивки рядом с ним одним числом.
  // Написанные «+5%» врали бы, стоило герою взять пассивку.
  const heroName = fleetHeroName(f);
  const heroPct = mods?.fire.sources.find((x) => x.source === 'hero')?.pct;
  body +=
    `<div class="fc-foot">` +
    (heroName !== null
      ? `<span class="fc-aura">${holoIcon('sun')}<b>${esc(heroName)}</b>` +
        (heroPct ? `<span>${esc(t('fleet.console.aura', { p: pctText(heroPct) }))}</span>` : '') +
        `</span>`
      : '') +
    `</div>`;
  return objectPanelHtml(h + `<div class="fconsole">${body}</div>`, detail);
}

/** Имя эскадры в воздухе — тот же позывной, что у её карточки в ангаре и над значком. */
export function strikeTitle(st: ShuttleStrike): string {
  return `${t(SQUADRON_KIND_KEY)} «${squadronCallsignOf(st.squadronId)}»`;
}

/** Имя базы в строке приказа: мир — по имени места, корабль — по имени флота. */
function strikeBaseName(base: StrikeBase): string {
  return base.kind === 'planet' ? placeName(base.id) : fleetTitleOf(base.id);
}

/** Чем занята эскадра (`aloftCard.ts`, правило 7) и что отсчитывает таймер. Ключи стоят
 *  литералами в каждой ветке: разбор гейта локализации видит только литеральные ключи. */
function aloftOrderText(card: AloftCard): { what: string; until: string } {
  const o = card.order;
  if (o.kind === 'fleet')
    return {
      what: t('side.aloft.order.strike', { name: fleetTitleOf(o.id) }),
      until: t('side.aloft.until.target'),
    };
  if (o.kind === 'planet')
    return {
      what: t('side.aloft.order.strike', { name: placeName(o.id) }),
      until: t('side.aloft.until.target'),
    };
  if (o.kind === 'land')
    return {
      what: t('side.aloft.order.land', { name: placeName(o.id) }),
      until: t('side.aloft.until.target'),
    };
  if (o.kind === 'patrol-out')
    return { what: t('side.aloft.order.patrol-out'), until: t('side.aloft.until.point') };
  if (o.kind === 'patrol')
    return { what: t('side.aloft.order.patrol'), until: t('side.aloft.until.patrol') };
  if (o.kind === 'relocate')
    return {
      what: t('side.aloft.order.relocate', { name: strikeBaseName(o.base) }),
      until: t('side.aloft.until.land'),
    };
  return {
    what: t('side.aloft.order.home', { name: strikeBaseName(o.base) }),
    until: t('side.aloft.until.land'),
  };
}

/**
 * КАРТОЧКА ЭСКАДРЫ В ВОЗДУХЕ (SHU-6.14) — заказ владельца 2026-10-11: «такие же космические
 * юниты: выделив, их можно разделить и изменить приказ». Что предлагать — `aloftCard.ts`;
 * здесь разметка. Кнопки те же, что у карточки в ангаре, и называются так же: игрок
 * узнаёт приказ по слову, а не по месту. Адрес — id вылета.
 */
export function aloftPanelHtml(st: ShuttleStrike): string {
  const ME = game.me();
  const sq = strikeSquadron(st);
  const card = aloftCard(st, {
    me: ME,
    data,
    relocate: squadronRelocateSpots(sq, strikeFrom(st), st).length > 0,
    split: splitOne(sq) !== null,
  });
  if (!card) return `<div class="hint">${t('side.empty')}</div>`;
  const cargo = card.cargo.reduce((n, c) => n + c.count, 0);
  const notes = [
    t('side.aloft.sub'),
    ...(cargo > 0 ? [t('side.wing.cargo', { n: cargo })] : []),
    ...(card.hull !== null ? [t('side.wing.hull', { p: card.hull })] : []),
  ];
  const text = aloftOrderText(card);
  // Отсчёт патчит `updatePanelLive` (`.pn-timer`): в разметке только срок, и панель не
  // перестраивается каждый кадр под пальцем. Поэтому внутри заглушка, а не сами цифры:
  // с цифрами разметка всё равно менялась бы вместе с ними.
  const timer = `<span class="pn-timer" data-at="${card.until}">…</span>`;
  let h = cardHeader(ownerColor(ME), strikeTitle(st), notes.join(' · '));
  h += `<div class="row"><b>${esc(text.what)}</b></div>`;
  h += `<div class="row dim">${esc(text.until)} ${timer}</div>`;
  h += unitRows(card.stacks);
  // Повернувшая домой бить снова не может (правило 3): без строки игрок искал бы кнопку.
  if (card.returning) h += `<div class="row dim">${esc(t('side.aloft.returning'))}</div>`;
  const buttons =
    (card.canStrike ? btn('aloftstrike', card.strikeId, t('side.wing.strike'), true) : '') +
    (card.canPatrol ? btn('aloftpatrol', card.strikeId, t('side.wing.patrol'), true) : '') +
    (card.canRelocate ? btn('aloftrelocate', card.strikeId, t('side.wing.relocate'), true) : '') +
    (card.canSplit ? btn('aloftsplit', card.strikeId, t('side.wing.split'), true) : '') +
    (card.hold !== null
      ? btn(
          'wingkeep',
          card.strikeId,
          card.hold ? t('side.wing.keep.off') : t('side.wing.keep'),
          true,
        )
      : '') +
    (card.canRecall ? btn('wingrecall', card.strikeId, t('side.wing.recall'), true) : '');
  return buttons ? `${h}<div class="row">${buttons}</div>` : h;
}

// --- Всплывашка надбавок: тап по параметру флота (заказ владельца 2026-09-27) ----------
// Узел один на оба листа — консоль ПК и карточку телефона: параметры в обоих несут
// `data-stat`, всплывашка встаёт у нажатого (`anchoredPopover.ts`). Лист пересобирается
// каждый кадр, поэтому держится не узел, а пара «флот + параметр»: ушёл флот из листа
// или параметр из разметки — всплывашка закрывается сама, висеть над пустым местом ей
// не на чем.
let statPopEl: HTMLElement;
let side: HTMLElement;
let statPop: { fleetId: string; stat: ConsoleStat } | null = null;
let lastStatPopHtml = '';

/** Тап по параметру: открыть его всплывашку, повторный тап по нему же — закрыть. */
export function toggleStatPop(stat: ConsoleStat): void {
  const id = panelFleet();
  const same = statPop?.fleetId === id && statPop?.stat === stat;
  statPop = id && !same ? { fleetId: id, stat } : null;
  renderStatPop();
}

export function closeStatPop(): void {
  statPop = null;
  renderStatPop();
}

/** Что показать про параметр. Числа — те же, что в окне (`shownFire`, ход из модели),
 *  строки — источники из ядра. Без ответа ядра остаётся одно правило параметра: строк,
 *  которых ядро не назвало, всплывашка не выдумывает. */
export function statPopModel(f: Fleet, stat: ConsoleStat): StatPopView {
  const s = game.world();
  const d = objDossier(`stat:${stat}`);
  // Правило — статья словаря со ссылками: термины в ней раскрываются следующей подсказкой.
  const head = { title: d?.name ?? '', desc: termBody(STAT_TERM[stat]) };
  const mods = fleetStatModsOf(f);
  const sm = fleetSummary(f, data, s.time);
  const plain = (value: string): StatPopView => ({
    ...head,
    value,
    tone: 'neutral',
    rows: [],
    total: null,
    plain: true,
  });
  const rows = (b: StatBreakdown): StatPopRow[] =>
    b.sources.map((x) => ({ label: t(statSourceKey(x.source)), pct: x.pct }));
  const total = (b: StatBreakdown): number => (b.factor - 1) * 100;
  if (stat === 'atk' || stat === 'def') {
    const raw = stat === 'atk' ? sm.attack.capped : sm.defense;
    const value = String(shownFire(raw, mods));
    if (!mods) return plain(value);
    return {
      ...head,
      value,
      tone: mods.fire.tone,
      base: String(raw),
      rows: rows(mods.fire),
      total: total(mods.fire),
    };
  }
  if (stat === 'spd') {
    const spd = mods ? mods.speed.value : sm.speed;
    if (!mods || spd <= 0) return plain(spd > 0 ? String(Math.round(spd)) : '—');
    return {
      ...head,
      value: String(Math.round(spd)),
      tone: mods.speed.tone,
      base: String(Math.round(mods.speed.base)),
      rows: rows(mods.speed),
      total: total(mods.speed),
    };
  }
  if (stat === 'hull' || stat === 'shield') {
    const pool = stat === 'hull' ? sm.hull : sm.shield;
    const value =
      pool.max > 0 ? `${kfmt(pool.cur)}/${kfmt(pool.max)}` : t('fleet.console.shield.none');
    if (!mods || pool.max <= 0) return plain(value);
    return {
      ...head,
      value,
      tone: mods.incoming.tone,
      sub: t('stat.pop.incoming'),
      rows: rows(mods.incoming),
      total: total(mods.incoming),
      lessIsBetter: true,
    };
  }
  return plain(`${Math.min(sumUnits(f.units), COMBAT_UNIT_CAP)}/${COMBAT_UNIT_CAP}`);
}

/** Держит всплывашку в согласии с листом: зовётся каждым `renderPanel`. */
export function renderStatPop(): void {
  const s = game.world();
  const pop = statPop;
  const f = pop && panelFleet() === pop.fleetId ? s.fleets[pop.fleetId] : undefined;
  const anchor =
    pop && f && side.style.display !== 'none'
      ? side.querySelector<HTMLElement>(`[data-stat="${pop.stat}"]`)
      : null;
  if (!pop || !f || !anchor) {
    statPop = null;
    if (lastStatPopHtml) {
      statPopEl.classList.remove('show');
      statPopEl.replaceChildren();
      lastStatPopHtml = '';
    }
    return;
  }
  const html = statPopHtml(statPopModel(f, pop.stat));
  if (html !== lastStatPopHtml) {
    statPopEl.innerHTML = html;
    lastStatPopHtml = html;
  }
  statPopEl.classList.add('show');
  const a = anchor.getBoundingClientRect();
  // Высота — по содержимому, а не по уже наложенному пределу: иначе всплывашка,
  // однажды зажатая у края, так и осталась бы зажатой после прокрутки листа.
  const border = statPopEl.offsetHeight - statPopEl.clientHeight;
  const at = anchoredPopover(
    { left: a.left, top: a.top, width: a.width, height: a.height },
    { width: statPopEl.offsetWidth, height: statPopEl.scrollHeight + border },
    { width: innerWidth, height: innerHeight },
  );
  statPopEl.style.left = `${Math.round(at.left)}px`;
  statPopEl.style.top = `${Math.round(at.top)}px`;
  statPopEl.style.maxHeight = at.maxHeight === null ? '' : `${Math.floor(at.maxHeight)}px`;
  statPopEl.dataset.side = at.side;
}

/** Всплывашка открыта — для слоёв кнопки «Назад» (`BACK_LAYERS` в `main.ts`). */
export function statPopOpen(): boolean {
  return statPop !== null;
}

/** Найти узлы всплывашки и листа и повесить «клик мимо». Зовёт `main.ts` один раз, на
 *  старте: модулю в тестах DOM не нужен. */
export function initStatPop(): void {
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  statPopEl = $('statpop');
  side = $('side');
  // Клик мимо закрывает. Сам параметр не в счёт: его тап — это переключение (делегат листа).
  // Подсказка термина из её текста (`termTip.ts`) тоже не «мимо»: она про ту же всплывашку.
  document.addEventListener(
    'pointerdown',
    (ev) => {
      if (!statPop) return;
      if ((ev.target as Element | null)?.closest?.('#statpop, [data-stat], .termtip')) return;
      closeStatPop();
    },
    true,
  );
}
