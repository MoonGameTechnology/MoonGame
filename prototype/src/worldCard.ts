/**
 * Карточка мира (REFM-223): что боковая панель показывает о месте на карте. Известный мир —
 * шапка с фактами и действиями и четыре вкладки (земля, орбита, эскадра, постройки) с
 * очередью стройки; мир вне зрения — память последнего скана или «нет телеметрии»; развилка
 * тропы — с кнопкой крепости. Здесь же ангар: секция порта и трюма с карточками эскадр и
 * строками патрулей. Её рисует и карточка флота, поэтому секция экспортируется.
 *
 * Правила того, ЧТО показать, живут в чистых модулях рядом (`planetTabs.ts`, `hangarPanel.ts`,
 * `squadronPanel.ts`, `conveyorView.ts`, `catalogTile.ts`, `spyOffer.ts`) и в решениях
 * `decisions/` (`worldFacts`, `worldOrders`, `rallyPoint`, `fortressRaise`); здесь только
 * разметка. Мир на экране, своё место, имена, открытая вкладка, плитки гарнизона и карта
 * узлов живут в `main.ts`; модуль получает их хуками {@link initWorldCard}: импорт оттуда был
 * бы циклом.
 */
import type {
  GameState,
  IntelGrant,
  PausedConstructionSite,
  Planet,
  SpyOp,
  StrikeBase,
  UnitStack,
} from '../../packages/shared-core/src/index';
import {
  buildingLevel,
  capitalOf,
  orderLane,
  forkSiteId,
  stationSiteId,
  hasShipyard,
  isForkSite,
  isInhabited,
  MAX_STEWARD_HOLD_POINTS,
  planetDevelopment,
  rallyPointOf,
  uncontrolledPlanets,
  integrationShare,
  isIntegrating,
} from '../../packages/shared-core/src/index';
import { isMineFleet } from '../../packages/shared-core/src/state/minefields';
import { feedsOnBiomass } from '../../packages/shared-core/src/util/infestation';
import { t, tData } from '../../localization/runtime';
import { buildsAnything } from '../../decisions/buildGate';
import { forkFortressRaise, fortressRaise } from '../../decisions/fortressRaise';
import { basePatrols, patrolMarks } from '../../decisions/patrolMarks';
import { rallyOffer, type RallyOffer } from '../../decisions/rallyPoint';
import { espionageShown, toolShown, victoryPointsShown } from '../../decisions/sectorZeroTools';
import { medalBadges } from '../../decisions/unitMedals';
import { worldFacts } from '../../decisions/worldFacts';
import { intelLayers } from '../../decisions/intelLayers';
import { knownBureau, oddsPct, spyOdds } from '../../decisions/spyOdds';
import { capitalOffer, holdOffer } from '../../decisions/worldOrders';
import { showsBlackout, showsStarving } from './arrearsWarnings';
import type { BuildLane } from './buildQueue';
import { shownProductionLanes } from '../../decisions/productionLanes';
import type { UnitCatalogTab } from './buildScreen';
import { bombardVolleyAt } from './bombardClock';
import { builtTileHtml } from './catalogTile';
import { conveyorHtml as kitConveyorHtml } from './conveyorView';
import { controlLimitOf } from './economy';
import { buildingName, cost, displayUnit, esc, resLine } from './format';
import { data } from './gameData';
import { canOrder, ctx } from './game';
import { fortressStatusHtml, fortressServicesHtml } from './fortressView';
import { pcUi } from './graphicsPrefs';
import {
  dockedCarrier,
  fleetHangar,
  hasHangar,
  planetHangar,
  transferOffer,
  type HangarView,
} from './hangarPanel';
import { BUILD_ICON, KIND_ICON, unitIconHtml } from './icons';
import { myAgents, SPY_COST } from './intel';
import { squadMerge } from './interaction';
import { liveTimerHtml } from './liveTimers';
import { SECTOR_TYPES, type SectorType } from './map';
import { squadronRelocateSpots } from './mapAim';
import { known, memory, myIntel, surveyed } from './mapFog';
import { ownerColor, youColor } from './mapPalette';
import {
  actionButton,
  cardHeader as kitCardHeader,
  pcols,
  tabButton as kitTabButton,
  unitRows as kitUnitRows,
} from './panelKit';
import { worldName } from './planetName';
import { seatNick } from './seatNicks';
import { isGroundUnit, planetSummary } from './planetSummary';
import { buildRoster, garrisonByTab, tabCounts } from './planetTabs';
import { spyMenuHtml } from './spyMenu';
export { toggleSpyMenu } from './spyMenu';
import { spyOffer } from './spyOffer';
import {
  mergeTargets,
  squadronCallsignOf,
  squadronCards,
  SQUADRON_KIND_KEY,
  type SquadronCard,
} from './squadronPanel';
import { stewardTechDone } from './stewardScreen';
import { HOUR } from './time';
import {
  activeConstruction,
  afford,
  buildCost,
  buildDurationHours,
  constructionLabel,
  coreQueue,
  myRes,
} from './worldQueries';
import { worldFactHtml } from './worldFactView';

/** Вкладка карточки мира. */
export type PlanetTab = 'ground' | 'ships' | 'shuttle' | 'buildings';

/** Что карточке нужно от игры. Мир, место, вкладка, плитки и карта узлов — в `main.ts`. */
export interface WorldCardHost {
  /** Мир на экране. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Имена держав по месту. */
  names(): Record<string, string>;
  /** Открытая вкладка карточки мира. */
  planetTab(): PlanetTab;
  /** Юниты, которые строит прототип: из них берётся ростер вкладки. */
  buildUnits(): readonly string[];
  /** Режим отладки (`?dev`): в подзаголовке мира виден код узла. */
  devUi(): boolean;
  /** Род узла на карте матча; `undefined` — узла на карте нет. */
  sectorOf(id: string): string | undefined;
  /** Тип сектора узла; `undefined` — узел не на карте. */
  sectorType(id: string): SectorType | undefined;
  /** Плитки гарнизона мира — те же, что у состава флота. */
  garrisonTiles(owner: string | null, stacks: UnitStack[]): string;
  /** Скрыты ли мультиплеерные инструменты: идёт забег Sector Zero. */
  sectorZeroToolsHidden(): boolean;
}

let game: WorldCardHost;

/** Подключить карточку мира к игре. */
export function initWorldCard(host: WorldCardHost): void {
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
const sectorZeroToolsHidden = (): boolean => game.sectorZeroToolsHidden();

/** Шапка карточки — та же обёртка над `panelKit`, что у остальных карточек панели. */
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

function tabButton(tab: PlanetTab, label: string, count: number, desc?: string): string {
  return kitTabButton(tab, label, count, game.planetTab() === tab, desc);
}

/**
 * Секция ангара в панели (SHU-3.1): состав, вместимость, топливо места и — на своём
 * месте — кнопка удара. Одна разметка на порт мира и на трюм носителя: у ангара везде
 * один смысл, и вторая вёрстка развела бы две панели по мелочам.
 *
 * `owner` — id мира или флота: он уезжает в `data-arg` кнопки, чтобы обработчик знал,
 * ОТКУДА поднимать вылет, не заводя второго состояния.
 */
export function hangarSectionHtml(view: HangarView, owner: string, mine: boolean): string {
  const s = game.world();
  // Заголовок берётся у САМОГО места (правило 6 в `hangarPanel.ts`): секция одна на порт
  // и на трюм, и общая подпись «Ангар порта» врала бы про корабль. Оба ключа стоят
  // литералами — разбор гейта локализации видит в вызове только первый, поэтому выбор
  // ключа тернарником ВНУТРИ `t()` спрятал бы второй от проверки.
  const title =
    view.kind === 'hold'
      ? t('side.wing.hold', { used: view.used, bay: view.bay })
      : t('side.wing.hangar', { used: view.used, bay: view.bay });
  const head =
    `<div class="sec">${title}</div>` +
    // Места улетевших держатся за бортом (SHU-5.1): без этой строки «2 из 4» при пустом
    // трюме читалось бы как «два места свободны», а погрузку на них ядро отобьёт.
    (view.aloft > 0
      ? `<div class="row dim">${esc(t('side.wing.aloft', { n: view.aloft }))}</div>`
      : '') +
    (view.sortie
      ? `<div class="row dim">${
          view.sortie.rearming > 0
            ? t('side.wing.rearming', { h: view.sortie.rearming })
            : t('side.wing.fuel', { n: view.sortie.fuel, max: view.sortie.maxFuel })
        }</div>`
      : '');
  // Причина «нельзя лететь» называется СВОИМ словом (правило 3 в `hangarPanel.ts`):
  // пустой ангар, перезарядка и сухой бак — разные ожидания у игрока. Причина у МЕСТА
  // одна на все звенья: топливо принадлежит базе (SHU-1.2), поэтому строка стоит над
  // карточками, а не в каждой.
  const rearming =
    view.kind === 'hold' ? t('side.wing.blocked.rearming.hold') : t('side.wing.blocked.rearming');
  const why =
    view.blocked === 'empty'
      ? t('side.wing.blocked.empty')
      : view.blocked === 'busy'
        ? t('side.wing.blocked.busy')
        : view.blocked === 'rearming'
          ? rearming
          : view.blocked === 'no-fuel'
            ? t('side.wing.blocked.no-fuel')
            : '';
  // ПАТРУЛИ ЭТОЙ БАЗЫ (SHU-6.3): улетевшего звена в ангаре нет, и без этих строк игрок
  // не нашёл бы, где его вернуть. Стоят и над пустым ангаром — в небе может висеть весь
  // состав.
  const patrols = mine ? patrolRowsHtml(owner) : '';
  // Перелёт (SHU-6.5) — только туда, где ядро его примет: своя база в дальности, где
  // звено поместится. Вид базы выводится по карте, где нашёлся id: id мира и id флота
  // живут в разных картах состояния.
  const from = s.planets[owner] ? { planetId: owner } : { fleetId: owner };
  const cards = squadronCards(view, {
    mine,
    data,
    relocate: (sq) => squadronRelocateSpots(sq, from).length > 0,
  });
  if (cards.length === 0) {
    return head + patrols + `<div class="row dim">${esc(t('side.wing.empty'))}</div>`;
  }
  const body = cards.map((c) => squadronCardHtml(c, view)).join('');
  return head + patrols + body + (mine && why ? `<div class="row dim">${esc(why)}</div>` : '');
}

/**
 * Строки патрулей, поднятых с базы `owner` (SHU-6.3): позывной, остаток висения,
 * «Держать патруль» (SHU-6.6) и «Вернуть». Что считается патрулём и чей он —
 * `patrolMarks.ts`; здесь только разметка. Вид базы выводится по карте, где нашёлся id:
 * id мира и id флота живут в разных картах состояния.
 */
function patrolRowsHtml(owner: string): string {
  const s = game.world();
  const ME = game.me();
  const base: StrikeBase = s.planets[owner]
    ? { kind: 'planet', id: owner }
    : { kind: 'fleet', id: owner };
  return basePatrols(patrolMarks(s.strikes, { me: ME, now: s.time }), base)
    .map((m) => {
      const name = esc(squadronCallsignOf(m.squadronId));
      const text =
        m.until !== null
          ? t('side.wing.patrol.on', { name, left: liveTimerHtml(m.until) })
          : t('side.wing.patrol.out', { name });
      // «Держать патруль» стоит у САМОГО патруля, а не у базы: удержание принадлежит
      // вылету и уходит с ним, и с одной базы могут висеть два патруля в разных точках.
      const keep = m.hold ? t('side.wing.keep.off') : t('side.wing.keep');
      return `<div class="row"><span class="dim">${text}</span> ${btn('wingkeep', m.id, keep, true)} ${btn('wingrecall', m.id, t('side.wing.recall'), true)}</div>`;
    })
    .join('');
}

/**
 * КАРТОЧКА ЭСКАДРЫ (SHU-4.3) — соединение читается так же, как флот на карте: своё имя,
 * свой состав, свои кнопки. До этого кирпича ангар был одним списком машин, а «Удар»
 * поднимал ПЕРВОЕ живое звено: выбирать было не из чего.
 *
 * Решения (кому что можно) живут в `squadronPanel.ts` — здесь только разметка. Адрес
 * приказа — id ЭСКАДРЫ: он уникален, и по нему же находится база (`squadronBase`),
 * поэтому составного ключа «база+звено» в разметке нет и разъезжаться нечему.
 */
function squadronCardHtml(card: SquadronCard, view: HangarView): string {
  const title = `${t(SQUADRON_KIND_KEY)} «${card.name}»`;
  const cargo = card.cargo.reduce((n, st) => n + st.count, 0);
  // Места звена в трюме (SHU-5.1), десант (SHU-5.2) и корпус подбитого борта (SHU-5.3).
  const notes = [
    t('side.wing.places', { n: card.places }),
    ...(cargo > 0 ? [t('side.wing.cargo', { n: cargo })] : []),
    ...(card.hull !== null ? [t('side.wing.hull', { p: card.hull })] : []),
    // Вернулась из удерживаемого патруля и встанет снова сама (SHU-6.6).
    ...(card.hold ? [t('side.wing.holding')] : []),
  ];
  const sub = ` <span class="dim">· ${esc(notes.join(' · '))}</span>`;
  const head = `<div class="row"><b>${esc(title)}</b>${sub}</div>`;
  const rows = unitRows(card.stacks);
  if (!card.canStrike && !card.canSplit && !card.canMerge && !card.hold) return head + rows;

  // Слияние — ДВА ТАПА: первый взводит источник, второй выбирает приёмника. Пока
  // источник взведён, у остальных карточек кнопка меняет смысл на «сюда», а у самого
  // источника — на отмену: взведённый режим обязан иметь выход без приказа.
  const armed = squadMerge?.from ?? null;
  const isSource = armed === card.id;
  const canReceive = armed !== null && mergeTargets(view, armed).includes(card.id);
  const merge = card.canMerge
    ? canReceive
      ? btn('wingmergeto', card.id, t('side.wing.merge.into'), true)
      : btn('wingmerge', card.id, t('side.wing.merge'), true)
    : '';
  const buttons =
    `<div class="row">` +
    btn('wingstrike', card.id, t('side.wing.strike'), card.canStrike) +
    // Патруль (SHU-6.3) — только у звена, которое умеет висеть; готовность базы та же,
    // что у удара: топливо и перезарядка у места общие.
    (card.canPatrol ? btn('wingpatrol', card.id, t('side.wing.patrol'), card.canStrike) : '') +
    // Снять удержание (SHU-6.6) можно и на перезарядке: это отмена стоячего приказа, а не
    // вылет (правило 8 `squadronPanel.ts`).
    (card.hold ? btn('wingrelease', card.id, t('side.wing.keep.off'), true) : '') +
    // Перелёт (SHU-6.5) — только когда есть куда; база готова — та же, что у удара.
    (card.canRelocate
      ? btn('wingrelocate', card.id, t('side.wing.relocate'), card.canStrike)
      : '') +
    (card.canSplit ? btn('wingsplit', card.id, t('side.wing.split'), true) : '') +
    merge +
    `</div>` +
    (isSource ? `<div class="row dim">${esc(t('side.wing.merge.pick'))}</div>` : '');
  return head + rows + buttons;
}

export function unitRows(stacks: Array<UnitStack>): string {
  const s = game.world();
  const ME = game.me();
  return kitUnitRows(
    stacks,
    (unit) => ({
      icon: unitIconHtml(unit, data, youColor, 18, s.players[ME]?.faction),
      name: displayUnit(unit),
      domain: isGround(unit) ? t('side.unit.ground') : t('side.unit.space'),
    }),
    t('side.none'),
    // VET-5: медали ветерана. Решение «что показать» — в `/decisions/unitMedals.ts`,
    // здесь только подстановка живых данных.
    (st) => medalBadges(st as UnitStack, data),
  );
}
/** Localized one-line label for a paused site (shares `ConstructionPayload`'s field
 *  names, so `constructionLabel` reads it directly — the extra `id`/`progress`/
 *  `remainingHours`/`remainingCost` fields are simply ignored). */
function pausedLabel(site: PausedConstructionSite): string {
  return constructionLabel(site);
}
/** Заголовок конвейера полосы юнитов: очередь названа по тому, что в ней строится. */
const LANE_TITLE: Record<string, string> = {
  ships: 'side.conveyor.lane.ships',
  shuttles: 'side.conveyor.lane.shuttles',
  infantry: 'side.conveyor.lane.infantry',
  vehicles: 'side.conveyor.lane.vehicles',
};

/** Конвейеры полос вкладки, которые мир может вести или уже ведёт (BLD-2.2), каждый под
 *  своим заголовком (`decisions/productionLanes.ts`). */
function laneConveyors(planetId: string, lanes: readonly BuildLane[]): string {
  return shownProductionLanes(game.world(), planetId, lanes, data)
    .map((l) => `<div class="sec">${t(LANE_TITLE[l] ?? '')}</div>` + conveyorHtml(planetId, l))
    .join('');
}

function conveyorHtml(planetId: string, lane: BuildLane): string {
  const s = game.world();
  // Разметку собирает `conveyorView.ts` (REFM-36) — там же правило «живые числа не
  // входят в подпись панели» и «очередь без денег называет цену».
  const active = activeConstruction(planetId, lane);
  const queued = coreQueue(planetId, lane);
  const head = queued[0];
  return kitConveyorHtml(
    planetId,
    lane,
    {
      active: active
        ? {
            label: esc(constructionLabel(active.payload)),
            at: active.at,
            durationMs: buildDurationHours(active.payload) * HOUR,
            seq: active.seq,
          }
        : null,
      queued: queued.map((q) => ({ label: esc(constructionLabel(q)), id: q.id })),
      paused: (s.planets[planetId]?.pausedConstruction ?? [])
        .filter((p) => orderLane(data, p) === lane)
        .map((p) => ({ id: p.id, label: esc(pausedLabel(p)), progress: p.progress })),
      // Строка «ждём цену» встаёт вместо строки простоя, поэтому стоит и на телефоне: без
      // неё ждущий заказ стоял бы под «Ожидание заказов» (UIX-10.6). Условие простое именно
      // потому, что решает ЯДРО: полоса свободна, а голова всё ещё ждёт — значит она уперлась
      // ровно в деньги (BLD-1, правило 4); своего прайс-листа для этого вывода клиенту не нужно.
      waitingCost: !active && head ? cost(buildCost(planetId, head), myRes()) : null,
    },
    {
      now: t('side.conveyor.now'),
      cancel: t('side.conveyor.cancel.title'),
      waiting: (c) => t('side.conveyor.waiting', { c }),
      idle: t('side.conveyor.idle'),
      dequeue: t('side.conveyor.dequeue.title'),
      paused: (n) => t('side.conveyor.paused', { n }),
      resume: t('side.conveyor.resume.title'),
    },
  );
}
/**
 * Вход в каталог ЮНИТОВ — той же кнопкой, какой BUILD-1 увёл в окно каталог зданий:
 * «плитки непостроенного ушли; вместо них одна кнопка, только там, где строить можно».
 * Юнитные вкладки жили по старому правилу и держали в панели вторую вёрстку списка,
 * цены и срока — ту самую, что окно уже умеет.
 *
 * Кнопки нет там, где вкладке нечего предложить (CMD-VIS: нет приказа — нет кнопки):
 * пустой ростер на этом мире — не повод обещать окно, в котором будет пусто.
 */
function unitCatalogButton(tab: UnitCatalogTab): string {
  return buildRoster(tab, game.buildUnits(), data).length
    ? `<button class="bw-open btn-main" data-act="openunits" data-arg="${tab}">▣ ${t('production.units')}</button>`
    : '';
}

/** Кнопка «Пинг» карточки мира. Маркер коалиции делится с союзником-человеком, поэтому
 *  в одиночном забеге Sector Zero её нет (PVR-6.1). */
function pingRowHtml(): string {
  if (!toolShown('pings', sectorZeroToolsHidden())) return '';
  return `<div class="row">${btn('ping', '', t('side.world.ping'), true)}</div>`;
}

/** Side-panel: a world outside sensor coverage — last-scan memory, or no telemetry. */
export function unknownPlanetHtml(p: Planet): string {
  const ME = game.me();
  const NAME = game.names();
  const mem = memory.get(p.id);
  const ping = pingRowHtml();
  if (mem) {
    const icons =
      mem.buildings
        .map(
          (b) =>
            `${BUILD_ICON[b.type] ?? '▪'} ${esc(buildingName(data.buildings[b.type]?.name, b.type))} L${b.level}`,
        )
        .join(', ') || t('side.scan.no-buildings');
    // Espionage from memory: an agent goes to the WORLD itself (SPY-8), not to its
    // owner — if the world changed hands, the kernel targets whoever holds it now.
    // В забеге Sector Zero шпионажа нет и здесь (`espionageShown`).
    const free = myAgents(game.world(), ME).free > 0;
    const spyReady = (op: SpyOp) => free && afford({ credits: SPY_COST[op] });
    const spyRow =
      mem.owner && mem.owner !== ME && espionageShown(sectorZeroToolsHidden())
        ? `<div class="row">${spyMenuHtml(p.id, [
            spyOddsHtml(p.id, mem.owner),
            btn('spyplanet', 'recon', t('side.scan.spy', { c: SPY_COST.recon }), spyReady('recon')),
            ...HOSTILE_OPS.map((op) => btn('spyplanet', op, t(SCAN_KEY[op], { c: SPY_COST[op] }), spyReady(op))),
          ]).join('')}</div>`
        : '';
    // `.pscan` — тело карточки одним столбцом: окно выбора сжимается под него, а не
    // растягивает три строки газетой на всю ширину (переработка окна мира, 2026-09-29).
    return (
      cardHeader(ownerColor(mem.owner), placeName(p.id), t('side.scan.title')) +
      `<div class="pscan">` +
      `<div class="row dim">${t('side.scan.stale')}</div>` +
      `<div class="row">${t('side.scan.owner')}: <b>${esc(mem.owner ? NAME[mem.owner] ?? mem.owner : t('side.neutral'))}</b></div>` +
      `<div class="row">${t('side.scan.garrison')}: <b>${mem.garrison}</b></div>` +
      `<div class="row">${t('side.scan.buildings')}: ${icons}</div>` +
      spyRow +
      `<div class="hint">${t('side.scan.hint')}</div>` +
      ping +
      `</div>`
    );
  }
  // A province a ship has crossed into shows its type, and only that (`surveyed`).
  const kind = surveyed(p.id)?.kind;
  const type = kind === undefined ? undefined : SECTOR_TYPES[kind];
  const typeRow = type
    ? `<div class="row">${KIND_ICON[kind!] ?? ''} <b>${esc(tData(type.name))}</b></div>`
    : '';
  // No «Снять выделение» on planet cards: it only clears FLEET selection (selPlanet
  // stays, the card would not even close) — the ✕ in the corner is the real close.
  return (
    cardHeader('#5f8f8c', placeName(p.id), t('side.notelemetry.title')) +
    `<div class="pscan">` +
    `<div class="row dim">${t('side.notelemetry.sub')}</div>` +
    typeRow +
    `<div class="hint">${t('side.notelemetry.hint')}</div>` +
    ping +
    `</div>`
  );
}

/**
 * Действия с миром в его шапке: сделать столицей, точка удержания, «Пинг», разведка.
 * ЧТО предлагать, решают `worldOrders.ts` и `spyOffer.ts` (REFM-91/92), здесь только
 * кнопки. На телефоне «Пинг», «Построить» и ник хозяина стоят в нижней полосе листа, и в шапке
 * их прячет CSS: кнопки остаются в разметке, потому что полоса листа показывается по их наличию.
 */
function worldActionsHtml(p: Planet, mine: boolean): string {
  const s = game.world();
  const ME = game.me();
  const out: string[] = [];
  // Хозяин чужого мира — кнопкой с его ником, она открывает карточку места (UIX-10.10).
  // Ника нет (бот, одиночная партия) — подписью служит имя дома.
  if (p.owner && !mine) {
    const name = seatNick(p.owner) ?? game.names()[p.owner] ?? p.owner;
    out.push(btn('seat', p.owner, t('side.world.owner', { name }), true));
  }
  // Телефон поднимает «Построить» в нижнюю полосу листа, рядом с «Пингом», чтобы строить без
  // раскрытия листа; полоса показывается по наличию этой кнопки (UIX-10.10).
  if (!pcUi() && mine && buildsAnything(p, data, feedsOnBiomass(s, ME, data)))
    out.push(`<button class="b btn-second" data-act="openbuild">▣ ${t('side.build.open')}</button>`);
  // Столица — здесь возрождаются герои и меняют модули (Phase C).
  if (capitalOffer(mine, capitalOf(s, ME) === p.id, isInhabited(data, p),
    !!ctx(s.time, s).config?.victory?.capitalCapture) === 'designate')
    out.push(btn('capital', '', t('side.world.make-capital'), true));
  // Hold point (ST-2.1): a standing order for the Steward — the anchor is never
  // auto-evacuated and gets reinforced under threat. Same tech gate as delegation.
  // Лимит ГАСИТ кнопку, но не прячет её, а снять точку можно всегда — иначе игрок,
  // исчерпавший лимит, запрётся: ни поставить новую, ни убрать старую (правило 6).
  const points = s.players[ME]?.stewardHoldPoints ?? [];
  // Крепость на развилке — не мир: точкой удержания её ядро не принимает (`steward` 1.1.0),
  // но старую точку на ней снять можно.
  const hold = holdOffer(
    mine,
    stewardTechDone(s, ME),
    points.includes(p.id),
    points.length,
    MAX_STEWARD_HOLD_POINTS,
    !isForkSite(p),
  );
  if (hold === 'clear') {
    out.push(
      `<span class="pfact cyan">🚩 ${t('side.world.hold.title')}</span>` +
        btn('holdpoint', 'off', t('side.world.hold.clear'), true),
    );
  } else if (hold !== 'none') {
    out.push(
      btn(
        'holdpoint',
        'on',
        pcUi() ? t('side.world.hold') : t('side.world.hold.set'),
        hold === 'set',
      ),
    );
  }
  // Tactical ping — mark this province and share it (coalition chat, or a player's DM).
  if (toolShown('pings', sectorZeroToolsHidden()))
    out.push(btn('ping', '', t('side.world.ping'), true));
  // Espionage: a 12h mission to this enemy world (SPY-8/9/10) — recon opens a 24h intel
  // window (while it lives its countdown replaces the recon button), sabotage, theft of
  // resources or of a technology. В забеге Sector Zero шпионажа нет (`espionageShown`).
  if (espionageShown(sectorZeroToolsHidden())) {
    const live = myIntel().find((g) => g.kind === 'planet' && g.target === p.id);
    // Свой и ничейный мир не шпионят; нехватка кредитов или свободных агентов (SPY-6)
    // гасит кнопку, но не прячет её.
    const free = myAgents(s, ME).free > 0;
    const ready = (op: SpyOp) => free && afford({ credits: SPY_COST[op] });
    const spy = spyOffer(mine, !!p.owner, !!live, ready('recon'));
    // Приказы шпионов копятся отдельно: больше одного — под кнопку «Шпионаж», шанс — первым (UIX-10.11).
    const ops: string[] = [];
    if (spy !== 'none') ops.push(spyOddsHtml(p.id, p.owner!));
    // SPY-13: a posted agent — its layers and «Отозвать» (`intelRowsHtml`).
    if (spy === 'window' && live && live.layer !== undefined) ops.push(...intelRowsHtml(live));
    else if (spy === 'window' && live) {
      ops.push(
        `<span class="pfact cyan">${t('side.world.spy-window')} ${t('side.world.spy-window.left', { left: liveTimerHtml(live.until) })}</span>`,
      );
    } else if (spy !== 'none') {
      ops.push(btn('spyplanet', 'recon', t('side.scan.spy', { c: SPY_COST.recon }), spy === 'buy'));
    }
    if (spy !== 'none')
      for (const op of HOSTILE_OPS) ops.push(btn('spyplanet', op, t(SCAN_KEY[op], { c: SPY_COST[op] }), ready(op)));
    // SPY-11: a guard for any owned world, your own too; posted or en route → «Отозвать».
    const guard = myAgents(s, ME).away.some((a) => a.op === 'counter' && a.planetId === p.id);
    if (p.owner && guard) ops.push(btn('spyrecall', '', t('side.scan.recall'), true));
    else if (p.owner) ops.push(btn('spyplanet', 'counter', t('side.scan.counter', { c: SPY_COST.counter }), ready('counter')));
    out.push(...spyMenuHtml(p.id, ops));
    // SPY-15: the owner sees its own world's economy sabotaged and for how long.
    if (mine && (p.disruptedUntil ?? 0) > s.time)
      out.push(`<span class="pfact">${t('side.world.disrupted', { left: liveTimerHtml(p.disruptedUntil!) })}</span>`);
  }
  return out.length ? `<div class="pacts">${out.join('')}</div>` : '';
}

/** SPY-19: the odds of an aggressive operation on this world, from what the player knows —
 *  their own wave on the way there and the owner's bureaus they see or remember
 *  (`decisions/spyOdds.ts`). */
function spyOddsHtml(planetId: string, owner: string): string {
  const s = game.world();
  const ME = game.me();
  const wave = myAgents(s, ME).away.filter(
    (a) => a.planetId === planetId && !a.posted && a.op !== undefined && a.op !== 'counter',
  ).length;
  const seenBuildings = Object.values(s.planets).flatMap((w) => {
    if (known(w.id)) return w.owner === owner ? w.buildings : [];
    const mem = memory.get(w.id);
    return mem && mem.owner === owner ? mem.buildings : [];
  });
  const o = spyOdds(wave + 1, knownBureau(seenBuildings, data));
  return `<span class="pfact" title="${esc(t('side.scan.odds.hint'))}">${t('side.scan.odds', { s: oddsPct(o.success), r: oddsPct(o.risk) })}</span>`;
}

/** The aggressive operations after recon, in button order, and their button keys. */
const HOSTILE_OPS = ['sabotage', 'delay', 'disrupt', 'theft', 'research'] as const;
const SCAN_KEY = {
  sabotage: 'side.scan.sabotage',
  delay: 'side.scan.delay',
  disrupt: 'side.scan.disrupt',
  theft: 'side.scan.theft',
  research: 'side.scan.research',
} as const;

const STANCE_KEY = {
  war: 'diplo.stance.war',
  peace: 'diplo.stance.peace',
  pact: 'diplo.stance.pact',
  alliance: 'diplo.stance.alliance',
} as const;

/** SPY-13: the layer chip, one line per open recon layer past the first
 *  (`decisions/intelLayers.ts`) and the recall of the posted agent. */
function intelRowsHtml(grant: IntelGrant): string[] {
  const v = intelLayers(game.world(), grant);
  const NAME = game.names();
  const list = (items: string[]) => (items.length ? items.join(', ') : t('side.world.intel.none'));
  const row = (text: string) => `<span class="pfact">${text}</span>`;
  const rows: string[] = [`<span class="pfact cyan">${t('side.world.spy-layer', { n: v.layer })}</span>`];
  if (v.treasury)
    rows.push(row(t('side.world.intel.treasury', { list: resLine(Object.fromEntries(v.treasury)) || t('side.world.intel.none') })));
  if (v.building) {
    const names = v.building.map((id) =>
      esc(data.buildings[id] ? buildingName(data.buildings[id]!.name, id) : displayUnit(id)),
    );
    rows.push(row(t('side.world.intel.build', { list: list(names) })));
  }
  if (v.research) {
    const names = v.research.map((id) => esc(tData(data.technologies[id]?.name ?? id)));
    rows.push(row(t('side.world.intel.research', { list: list(names) })));
  }
  if (v.offers) {
    const names = v.offers.map(
      (o) => `${esc(NAME[o.from] ?? o.from)} → ${esc(NAME[o.to] ?? o.to)}: ${t(STANCE_KEY[o.stance])}`,
    );
    rows.push(row(t('side.world.intel.offers', { list: list(names) })));
  }
  rows.push(btn('spyrecall', 'recon', t('side.scan.recall.recon'), true));
  return rows;
}

/** Точка сбора мира-верфи (RALLY-1): цель и «Сменить»/«Снять», либо «Задать». Что
 *  предлагать — `decisions/rallyPoint.ts`; цель берётся у ядра (`rallyPointOf`). */
function rallySectionHtml(planetId: string, offer: Exclude<RallyOffer, 'none'>): string {
  const s = game.world();
  const ME = game.me();
  const to = rallyPointOf(s, ME, planetId);
  const row =
    offer === 'change' && to
      ? `<b>${esc(t('side.world.rally.to', { w: placeName(to) }))}</b>` +
        btn('rally', 'pick', t('side.world.rally.change'), true) +
        btn('rally', 'off', t('side.world.rally.clear'), true)
      : `<b class="dim">${esc(t('side.world.rally.none'))}</b>` +
        btn('rally', 'pick', t('side.world.rally.set'), true);
  return `<div class="sec">${t('side.world.rally')}</div><div class="asset-row">${row}</div>`;
}

/** Доход ПОСТРОЕННОГО здания за час — готовой разметкой; у недоходного пусто. Цифра
 *  считается тем же `buildingLevel`, что и строка «производит» в карточке кодекса:
 *  список и карточка обязаны называть одно число, иначе список врёт про доход. */
function incomeOf(type: string, level: number): string {
  const def = data.buildings[type];
  return def ? resLine(buildingLevel(def, level).produces, { per: 'h' }) : '';
}

/** Side-panel: a known world — ownership header + ground/ships/shuttle/buildings tabs. */
export function planetPanelHtml(p: Planet): string {
  const s = game.world();
  const ME = game.me();
  const mine = p.owner === ME;
  if (p.fortress) {
    let station = cardHeader(ownerColor(p.owner), placeName(p.id), t('fleet.kind.fortress')) +
      fortressStatusHtml(s, p, ME, (order) => canOrder(s, order));
    station += `<div class="sec">${t('side.tab.buildings')}</div><div class="blist">` +
      p.buildings.filter((b) => b.type !== 'starfort').map((b) => builtTileHtml({ type: b.type, level: b.level,
        icon: BUILD_ICON[b.type] ?? '▪', name: buildingName(data.buildings[b.type]?.name, b.type),
        income: incomeOf(b.type, b.level),
      })).join('') + '</div>';
    if (mine) {
      station += `<button class="bw-open btn-main" data-act="openbuild">▣ ${t('side.build.open')}</button>` +
        conveyorHtml(p.id, 'buildings');
      station += fortressServicesHtml(s, p, ME, { hasShipyard: hasShipyard(p, data),
        production: (tab) => unitCatalogButton(tab) + laneConveyors(p.id, [tab === 'shuttle' ? 'shuttles' : 'ships']),
        hangar: (port) => hangarSectionHtml(port, p.id, true),
      });
    }
    return station;
  }
  const sec = data.sectors[p.terrain ?? '']?.name ?? p.terrain;
  const pt = p.planetType ? data.planetTypes[p.planetType] : undefined;
  const ptName = pt?.name ?? p.planetType;
  // Province type (the structural kind) — shown so the map's provinces read clearly.
  const kindName = sectorTypeOf(p.id)?.name ?? game.sectorOf(p.id);
  // Чего у мира нет (сектора, типа), подпись не пишет: прочерк в ней ничего не сообщал, а на
  // телефоне переносил подпись на лишнюю строку (UIX-10.5).
  // Одно имя дважды не пишется: у астероидов тип узла и сектор оба «Астероидное поле» (UIX-10.10).
  const facets = [
    ...new Set([kindName, ptName, sec].filter((n): n is string => !!n).map((n) => tData(n))),
  ];
  // Разбор гарнизона по вкладкам и их счётчики — в `planetTabs.ts` (REFM-41), там же
  // правило «вкладка флота считает и орбиту»: построенное само уходит в космос.
  const { ground, ships } = garrisonByTab(p.garrison, data);
  const here = Object.values(s.fleets).filter((f) => f.location === p.id && !isMineFleet(f, data));
  const counts = tabCounts(p, data, here);
  // Имя мира — то же, что в подписи на карте и в журнале; код узла («C0R2», «home_a») в
  // подзаголовке — только в режиме отладки (UIX-5.2).
  const sm = planetSummary(p, data, here);
  // Очки победы — рядом с именем (заказ владельца 2026-09-29: «эти 50 можно в шапку»). На
  // телефоне их переносит в шапку листа `mobileHud.ts`, досье — тем же тапом, что у фишек.
  // В забеге Sector Zero очков нет (`victoryPointsShown`).
  const vp =
    sm.victoryPoints > 0 && victoryPointsShown(sectorZeroToolsHidden())
      ? `<span class="pbadge" data-desc="fact:vp" aria-label="${esc(t('side.world.vp'))}">✦ ${sm.victoryPoints}</span>`
      : '';
  // Развитость мира — тоже рядом с именем (заказ владельца 2026-11-02): сумма по постройкам,
  // где каждый уровень стоит своей цены и часов стройки (`state/development.ts`).
  const devPoints = planetDevelopment(data, p);
  const dev =
    devPoints > 0
      ? `<span class="pbadge" data-desc="fact:dev" aria-label="${esc(t('side.world.dev'))}">⬢ ${devPoints}</span>`
      : '';
  let h = cardHeader(
    ownerColor(p.owner),
    placeName(p.id),
    // Хозяина подпись не называет: чужой мир показывает его кнопкой-ником в ряду действий,
    // свой — обычный случай (UIX-10.10). Ничейный мир кнопки не имеет, и слово остаётся.
    `${game.devUi() ? `${esc(p.id)} · ` : ''}${[...(p.owner ? [] : [t('side.neutral')]), ...facets].join(' · ')}`,
    undefined,
    dev + vp,
  );
  // ШАПКА МИРА (переработка окна, заказ владельца 2026-09-29): под именем — то, чего нет во
  // вкладках (состояние и свойства мира, `decisions/worldFacts.ts`), и действия с миром.
  // Числа состава живут только на вкладках: прежний ряд фишек дублировал их другим счётом.
  const facts = worldFacts({
    mine,
    capital: capitalOf(s, ME) === p.id ||
      Object.values(s.match.capitalObjectives ?? {}).some((target) => target.planetId === p.id),
    // ECON-2: блэкаут — свойство ВЛАДЕЛЬЦА, а не этого мира (`arrearsWarnings.ts`, REFM-89).
    blackout: showsBlackout(mine, s.players[ME]?.arrears),
    // BAL-19: своя планета за лимитом управления — половина дохода, юниты не строятся.
    uncontrolled: mine && uncontrolledPlanets(s, data, ME, s.modeId, controlLimitOf(s, ME)).has(p.id),
    // BAL-19: освоение взятой планеты — у взявшего доля выхода, у потерявшего право отбить.
    integration:
      p.integration && isIntegrating(p, s.time)
        ? {
            share: integrationShare(p.integration, s.time),
            until: p.integration.until,
            claimMine: p.integration.claim === ME,
          }
        : null,
    // Таймер обстрела: когда следующий залп (`decisions/bombardTimer.ts`).
    bombardAt: bombardVolleyAt(s, p.id, ME),
    bonuses: sm.bonuses,
    mitigation: sm.mitigation,
    baseOutput: sm.baseOutput,
  });
  const factsRow = facts.map(worldFactHtml).join('') + worldActionsHtml(p, mine);
  // Пустой строки нет: без фактов и действий шапка кончается своей чертой.
  if (factsRow) h += `<div class="pfacts">${factsRow}</div>`;

  h += `<div class="ptabs">${tabButton('ground', t('side.tab.ground'), counts.ground, 'tab:ground')}${tabButton(
    'ships',
    t('side.tab.fleet'),
    counts.ships,
    'tab:ships',
  )}${tabButton('shuttle', t('side.tab.wings'), counts.shuttle, 'tab:shuttle')}${tabButton('buildings', t('side.tab.buildings'), counts.buildings, 'tab:buildings')}</div>`;

  // Tab content is split into self-contained blocks; on desktop they flow into
  // side-by-side columns (filling the wide panel), on phones they stack vertically.
  const cols: string[] = [];
  if (game.planetTab() === 'ground') {
    // Состав ЗЕМЛИ — плитками на ВСЕХ раскладках, как состав флота (заказ владельца
    // 2026-09-25): полоска и числа корпуса видны сразу. Прежние плитки ПК давали только
    // иконку и число, и имя приходилось угадывать — теперь у наземной плитки есть подпись.
    // ECON-1: голодный гарнизон — владелец мира в food-arrears теряет 25% на земле.
    const starving = showsStarving(p.owner === ME, ground.length, s.players[ME]?.arrears)
      ? `<div class="row" style="color:var(--red)">🍽 ${t('side.fleet.hunger')}</div>`
      : '';
    cols.push(
      `<div class="sec">${t('side.ground.units')}</div>` +
        starving +
        game.garrisonTiles(p.owner, ground),
    );
    if (mine) {
      // У каждой производственной постройки своя очередь (BLD-2.1): на земле это казармы
      // и завод, и у каждой свой конвейер под своим именем.
      cols.push(laneConveyors(p.id, ['infantry', 'vehicles']) + unitCatalogButton('ground'));
    }
    if (!pcUi()) {
      cols.push(`<div class="hint">${t('dossier.tab.ground.desc')}</div>`);
    }
  } else if (game.planetTab() === 'ships') {
    // Вкладка флота — это ОРБИТА (владелец 2026-09-26: «гарнизон — только наземный юнит»).
    // Построенный корабль сам уходит в сборный флот (`autoRally`), поэтому кораблей на
    // самой планете обычно нет, и строка о них появляется, только когда они есть. Орбита
    // показывается ВСЕГДА, даже пустая, — как состав земли и здания: скрытая секция
    // читается как поломка панели, и пустота говорит о себе словами.
    let orbit = `<div class="sec">${t('side.world.fleets')}</div>`;
    if (!here.length) orbit += `<div class="row dim">${esc(t('side.none'))}</div>`;
    for (const f of here) {
      const fShips = sumUnits(f.units);
      const tr = sumUnits(f.landing ?? []);
      const sel = f.owner === ME ? btn('selfleet', f.id, t('side.garrison.select'), true) : '';
      orbit += `<div class="asset-row" data-desc="fleet" style="color:${ownerColor(f.owner)}"><span class="bicon">▲</span><b>${t('side.world.fleet-ships', { n: fShips })}${tr ? ' ' + t('side.garrison.plus-troops', { n: tr }) : ''}</b>${sel}</div>`;
    }
    cols.push(orbit);
    if (ships.length) {
      cols.push(
        `<div class="sec">${t('side.garrison.ships')}</div>` + game.garrisonTiles(p.owner, ships),
      );
    }
    // RALLY-1: куда сами летят корабли, построенные здесь. Стоит у очереди кораблей —
    // это настройка выпуска мира, а не одного заказа.
    const rally = rallyOffer(mine, hasShipyard(p, data), rallyPointOf(s, ME, p.id) !== null);
    if (rally !== 'none') cols.push(rallySectionHtml(p.id, rally));
    if (mine) {
      cols.push(laneConveyors(p.id, ['ships']) + unitCatalogButton('ships'));
    }
    // Подсказки вкладки на телефоне нет (UIX-10.6): она пересказывала заголовки орбиты и
    // очереди над ней. Её текст остался досье вкладки по наведению на ПК ('tab:ships').
  } else if (game.planetTab() === 'shuttle') {
    // SHU-3.1 — АНГАР ПОРТА, а не гарнизон. Раньше здесь стоял `wing` — гарнизон,
    // отфильтрованный по трейту `shuttle`, — и вкладка была гарантированно пустой:
    // челнок с SHU-1.1 в гарнизоне не бывает никогда, он лежит в `planet.hangar`.
    // Игрок платил за машины и не мог их ни увидеть, ни применить.
    const port = planetHangar(p, data);
    if (hasHangar(port)) {
      cols.push(hangarSectionHtml(port, p.id, mine));
      // ПЕРЕГРУЗКА ПРЕДЛАГАЕТСЯ И ОТСЮДА (правило 5 в `hangarPanel.ts`). Найдено в живой
      // игре: у игрока был «Шаттл», а кнопок он не нашёл — они стояли только на панели
      // флота-носителя, тогда как челноки он видит и строит здесь. Приказ тот же
      // (`wingload`/`wingunload` адресуют ФЛОТ), поэтому обработчик не тронут.
      const ship = mine ? dockedCarrier(Object.values(s.fleets), p.id, ME, data) : null;
      const offer = transferOffer(port, ship ? fleetHangar(ship, data, s) : null, {
        docked: true, // `dockedCarrier` уже спросил про стоянку, бой и чужой флот
        mine: true,
      });
      if (ship && (offer.load || offer.unload)) {
        cols.push(
          `<div class="row">` +
            (offer.load ? btn('wingload', ship.id, t('side.wing.load'), true) : '') +
            (offer.unload ? btn('wingunload', ship.id, t('side.wing.unload'), true) : '') +
            `</div>`,
        );
      }
    } else {
      // Порта нет — говорим об этом прямо. Пустой список читался бы как «челноков нет»,
      // хотя их тут негде и держать.
      // Заголовка «Эскадра в порту» нет: он повторял имя вкладки (UIX-10.6).
      cols.push(`<div class="row dim">${t('side.wing.no-port')}</div>`);
    }
    if (mine) {
      cols.push(laneConveyors(p.id, ['shuttles']) + unitCatalogButton('shuttle'));
    }
    if (!pcUi()) {
      // PC carries this in the ЭСКАДРА tab's hover dossier ('tab:shuttle').
      // Подпись кнопки подставляется ключом, а не переписывается литералом: прошлая
      // редакция этой подсказки звала «🛩 Запустить челноки» — кнопку, которой не стало
      // ещё в SHU-3.1, и разъехалась молча.
      cols.push(
        `<div class="hint">${t('side.wing.garrison.hint', { b: t('side.wing.strike') })}</div>`,
      );
    }
  } else {
    // Сначала то, что СТОИТ на мире, потом очередь стройки — как на вкладках юнитов. Очередь
    // есть только у своего мира: у чужого вместо неё стояла строка «телеметрия недоступна»,
    // целый блок о том, чего не видно.
    // Заголовка «Здания» нет: он повторял вкладку прямо над списком (UIX-10.6).
    let blds = p.buildings.length === 0 ? `<div class="row dim">${t('side.none')}</div>` : '';
    // BUILD-1 (макет владельца): построенное — ИКОНКАМИ со значком уровня. Тап
    // открывает карточку кодекса с листалкой уровней и кнопкой «Улучшить» —
    // описание, апгрейд и «что даст следующий уровень» переехали туда из строк.
    if (p.buildings.length) {
      // Разметку строки собирает `catalogTile.ts` — там же решения подачи: список идёт
      // СТОЛБИКОМ (строка на здание), имя подписано (иконка одна на вопрос «что это» не
      // отвечает) и уровень показан ВСЕГДА, коротким `L1`, а не галочкой.
      const tiles = p.buildings
        .map((b) =>
          builtTileHtml({
            type: b.type,
            level: b.level,
            icon: BUILD_ICON[b.type] ?? '▪',
            name: buildingName(data.buildings[b.type]?.name, b.type),
            // Доход ТЕКУЩЕГО уровня — тем же `resLine`, что и в кодексе: игрок решает,
            // что строить дальше, по цифре дохода, и раньше шёл за ней в карточку по
            // одной постройке за тап (`catalogTile.ts`, правило 4).
            income: incomeOf(b.type, b.level),
          }),
        )
        .join('');
      blds += `<div class="blist">${tiles}</div>`;
    }
    // Каталог непостроенного больше не живёт плитками в панели — его показывает
    // полноэкранное окно построек. Кнопка есть только там, где строить можно
    // (свой мир И каталог что-то здесь предлагает — CMD-VIS: нет приказа — нет кнопки).
    if (mine && buildsAnything(p, data, feedsOnBiomass(s, ME, data))) {
      blds += `<button class="bw-open btn-main" data-act="openbuild">▣ ${t('side.build.open')}</button>`;
    }
    // FORT-0.2: КОСМИЧЕСКАЯ КРЕПОСТЬ. Правило кнопки — `decisions/fortressRaise.ts`, то же
    // самое, каким решает редьюсер (сверено тестом по всем раскладам): здесь только
    // отрисовка. Стоит РЯДОМ с «Постройками», а не вместо: на астероидах и мёртвом мире
    // осмысленно и то и другое — добывающая станция ИЛИ крепость со своим ростером.
    const fortress = fortressRaise(
      p,
      ME,
      s.players[ME]?.resources ?? {},
      data,
      s.players[ME]?.technologies?.completed ?? [],
      s,
    );
    const attached = s.planets[stationSiteId(p.id)];
    if (attached?.fortress) blds += `<button class="bw-open btn-second" data-act="openstation" data-arg="${esc(attached.id)}">◈ ${t('fortress.open')}</button>`;
    if (fortress.show) {
      const off = fortress.enabled ? '' : ' disabled';
      // Цена — фишками `resLine` (это РАЗМЕТКА со значками). Экранировать её нельзя: игрок
      // видел сырой `<span class="rcost">…<svg…>` вместо цены (сообщение владельца
      // 2026-09-24: «непонятный текст там»).
      blds +=
        `<button class="bw-open btn-second" data-act="fortress"${off}>◈ ${esc(t('side.fortress.raise'))}` +
        ` <span class="dim">${resLine(fortress.cost)}</span></button>`;
      // Не изучена — говорим, ЧТО изучить, и ведём туда: кнопка раньше горела, а ядро
      // отвечало безымянным «нужна технология».
      if (fortress.blocked === 'tech') {
        const names = fortress.needs
          .map((id) => `«${tData(data.technologies[id]?.name ?? id)}»`)
          .join(t('side.fortress.or'));
        // Кнопка открывает сразу досье первой из них — как у запертых юнитов и зданий.
        blds +=
          `<div class="fort-why">${esc(t('side.fortress.needs-tech', { tech: names }))}</div>` +
          `<button class="bw-open btn-quiet" data-act="opentech" data-arg="${esc(fortress.needs[0] ?? '')}">⚗ ${esc(t('side.fortress.to-tech'))}</button>`;
      }
    }
    cols.push(blds);
    if (mine)
      cols.push(
        `<div class="sec">${t('side.build.conveyor')}</div>` + conveyorHtml(p.id, 'buildings'),
      );
  }
  return h + pcols(cols);
}

/**
 * Карточка РАЗВИЛКИ (FORT-6.1): чья это тропа, куда она ведёт и можно ли поставить здесь
 * крепость. Правило кнопки — `forkFortressRaise` (`decisions/fortressRaise.ts`), то же, что
 * у ядра; здесь только отрисовка. Причины без кнопки и отказ технологии — теми же строками,
 * что у крепости на узле: крепость одна и та же, другое у неё только место.
 */
export function forkPanelHtml(fork: { province: string; trail: number }): string {
  const s = game.world();
  const ME = game.me();
  const province = s.planets[fork.province];
  const exits = (province?.roads?.trails[fork.trail]?.exits ?? [])
    .map((x) => `<b>${esc(placeName(x))}</b>`)
    .join(', ');
  let h =
    cardHeader(
      ownerColor(province?.owner ?? null),
      `◇ ${t('side.fork.title')}`,
      placeName(fork.province),
    ) +
    `<div class="row">${t('side.fork.where', { exits })}</div>` +
    `<div class="hint">${esc(t('side.fork.hint'))}</div>`;
  const raise = forkFortressRaise(
    province,
    s.planets[forkSiteId(fork.province, fork.trail)],
    ME,
    s.players[ME]?.resources ?? {},
    data,
    s.players[ME]?.technologies?.completed ?? [],
    s,
  );
  if (raise.show) {
    const off = raise.enabled ? '' : ' disabled';
    h +=
      `<button class="bw-open btn-main" data-act="forkfortress"${off}>◈ ${esc(t('side.fortress.raise'))}` +
      ` <span class="dim">${resLine(raise.cost)}</span></button>`;
    if (raise.blocked === 'tech') {
      const names = raise.needs
        .map((id) => `«${tData(data.technologies[id]?.name ?? id)}»`)
        .join(t('side.fortress.or'));
      h +=
        `<div class="fort-why">${esc(t('side.fortress.needs-tech', { tech: names }))}</div>` +
        `<button class="bw-open btn-quiet" data-act="opentech" data-arg="${esc(raise.needs[0] ?? '')}">⚗ ${esc(t('side.fortress.to-tech'))}</button>`;
    }
  } else if (raise.blocked === 'not-owned') {
    h += `<div class="row dim">${esc(t('side.fork.not-owned'))}</div>`;
  }
  return h;
}
