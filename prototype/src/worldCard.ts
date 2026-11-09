/**
 * Карточка мира (REFM-223): что боковая панель показывает о месте на карте. Известный мир —
 * окно «i», только сведения (UIX-10.12): строка статуса со шпионажем, доход, оборона,
 * гарнизон, свёрнутые постройки и эскадра (`planetDossierView.ts`); стройка и приказы мира
 * — в окне «Построить»; мир вне зрения — память последнего скана или «нет телеметрии»; развилка
 * тропы — с кнопкой крепости. Здесь же ангар: секция порта и трюма с карточками эскадр и
 * строками патрулей. Её рисует и карточка флота, поэтому секция экспортируется.
 *
 * Правила того, ЧТО показать, живут в чистых модулях рядом (`planetTabs.ts`, `hangarPanel.ts`,
 * `squadronPanel.ts`, `conveyorView.ts`, `catalogTile.ts`, `spyOffer.ts`) и в решениях
 * `decisions/` (`worldFacts`, `worldOrders`, `rallyPoint`, `fortressRaise`); здесь только
 * разметка. Мир на экране, своё место, имена, плитки гарнизона и карта
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
  hasShipyard,
  planetDevelopment,
  uncontrolledPlanets,
  integrationShare,
  isIntegrating,
} from '../../packages/shared-core/src/index';
import { isMineFleet } from '../../packages/shared-core/src/state/minefields';
import { feedsOnBiomass } from '../../packages/shared-core/src/util/infestation';
import { t, tData } from '../../localization/runtime';
import { buildsAnything } from '../../decisions/buildGate';
import { forkFortressRaise } from '../../decisions/fortressRaise';
import { basePatrols, patrolMarks } from '../../decisions/patrolMarks';
import { espionageShown, toolShown, victoryPointsShown } from '../../decisions/sectorZeroTools';
import { medalBadges } from '../../decisions/unitMedals';
import { worldFacts, type WorldFact } from '../../decisions/worldFacts';
import { intelLayers } from '../../decisions/intelLayers';
import { knownBureau, oddsPct, spyOdds } from '../../decisions/spyOdds';
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
import { canOrder } from './game';
import { fortressStatusHtml, fortressServicesHtml } from './fortressView';
import { pcUi } from './graphicsPrefs';
import { hasHangar, planetHangar, type HangarView } from './hangarPanel';
import { BUILD_ICON, KIND_ICON, unitIconHtml } from './icons';
import { myAgents, SPY_COST } from './intel';
import { liveTimerHtml } from './liveTimers';
import { SECTOR_TYPES, type SectorType } from './map';
import { known, memory, myIntel, surveyed } from './mapFog';
import { ownerColor, youColor } from './mapPalette';
import {
  actionButton,
  cardHeader as kitCardHeader,
  pcols,
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
  squadronCallsignOf,
  squadronCards,
  SQUADRON_KIND_KEY,
  type SquadronCard,
} from './squadronPanel';
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
import { foldHtml } from './dossierFolds';
import {
  buildingsFoldHtml,
  defenseHtml,
  garrisonGridHtml,
  incomeBandHtml,
  scanAgeHtml,
  scanGarrisonHtml,
} from './planetDossierView';

/** Что карточке нужно от игры. Мир, место, плитки и карта узлов — в `main.ts`. */
export interface WorldCardHost {
  /** Мир на экране. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Имена держав по месту. */
  names(): Record<string, string>;
  /** Юниты, которые строит прототип: из них берётся ростер вкладки. */
  buildUnits(): readonly string[];
  /** Режим отладки (`?dev`): в подзаголовке мира виден код узла. */
  devUi(): boolean;
  /** Род узла на карте матча; `undefined` — узла на карте нет. */
  sectorOf(id: string): string | undefined;
  /** Тип сектора узла; `undefined` — узел не на карте. */
  sectorType(id: string): SectorType | undefined;
  /** Скрыты ли мультиплеерные инструменты: идёт забег Sector Zero. */
  sectorZeroToolsHidden(): boolean;
  /** Радар мира: дальность засечки и круг опознания (`mapRadar.ts`); 0 — радара нет. */
  radar(p: Planet): { reach: number; identify: number };
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

/**
 * Секция ангара в панели (SHU-3.1): состав, вместимость, топливо места и — на своём
 * месте — кнопка удара. Одна разметка на порт мира и на трюм носителя: у ангара везде
 * один смысл, и вторая вёрстка развела бы две панели по мелочам.
 *
 * `owner` — id мира или флота: он уезжает в `data-arg` кнопки, чтобы обработчик знал,
 * ОТКУДА поднимать вылет, не заводя второго состояния.
 */
export function hangarSectionHtml(view: HangarView, owner: string, mine: boolean): string {
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
  const cards = squadronCards(view, { mine, data });
  if (cards.length === 0) {
    return head + patrols + `<div class="row dim">${esc(t('side.wing.empty'))}</div>`;
  }
  const body = cards.map((c) => squadronCardHtml(c, mine)).join('');
  return head + patrols + body + (mine && why ? `<div class="row dim">${esc(why)}</div>` : '');
}

/**
 * Строки патрулей, поднятых с базы `owner` (SHU-6.3): позывной и остаток висения. Приказы
 * патрулю — «Держать», «Вернуть» — живут в карточке эскадры в полёте (UIX-10.14): имя
 * здесь её выделяет. Что считается патрулём и чей он — `patrolMarks.ts`. Вид базы
 * выводится по карте, где нашёлся id: id мира и id флота живут в разных картах состояния.
 */
function patrolRowsHtml(owner: string): string {
  const s = game.world();
  const ME = game.me();
  const base: StrikeBase = s.planets[owner]
    ? { kind: 'planet', id: owner }
    : { kind: 'fleet', id: owner };
  return basePatrols(patrolMarks(s.strikes, { me: ME, now: s.time }), base)
    .map((m) => {
      const name = squadronCallsignOf(m.squadronId);
      const text =
        m.until !== null
          ? t('side.wing.patrol.on', { left: liveTimerHtml(m.until) })
          : t('side.aloft.order.patrol-out');
      return `<div class="row">${btn('strikepick', m.id, `✳ ${name}`, true)} <span class="dim">${text}</span></div>`;
    })
    .join('');
}

/**
 * ЭСКАДРА В АНГАРЕ (SHU-4.3) — имя, места, десант, корпус и состав. Приказы эскадре живут
 * только в её карточке (UIX-10.14, концепт «Управление эскадрой»): своё имя здесь —
 * кнопка, которая выделяет эскадру, как значок ангара на карте.
 */
function squadronCardHtml(card: SquadronCard, mine: boolean): string {
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
  // У кнопки-имени точка-разделитель не нужна: кнопка и так отделена, а перенос строки
  // оставлял бы точку висеть у её края.
  const sub = ` <span class="dim">${mine ? '' : '· '}${esc(notes.join(' · '))}</span>`;
  const name = mine ? btn('sqpick', card.id, `◇ ${title}`, true) : `<b>${esc(title)}</b>`;
  return `<div class="row">${name}${sub}</div>` + unitRows(card.stacks);
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
    // Мир в тумане показан последним снимком разведки (UIX-10.12) в том же порядке, что и
    // видимый: строка статуса (ник хозяина, возраст снимка, шпионаж), гарнизон, постройки.
    // Espionage from memory: an agent goes to the WORLD itself (SPY-8), not to its
    // owner — if the world changed hands, the kernel targets whoever holds it now.
    // В забеге Sector Zero шпионажа нет и здесь (`espionageShown`).
    const free = myAgents(game.world(), ME).free > 0;
    const spyReady = (op: SpyOp) => free && afford({ credits: SPY_COST[op] });
    const acts: string[] = [];
    if (mem.owner && mem.owner !== ME) {
      const name = seatNick(mem.owner) ?? NAME[mem.owner] ?? mem.owner;
      acts.push(btn('seat', mem.owner, t('side.world.owner', { name }), true));
    }
    if (toolShown('pings', sectorZeroToolsHidden()))
      acts.push(btn('ping', '', t('side.world.ping'), true));
    if (mem.owner && mem.owner !== ME && espionageShown(sectorZeroToolsHidden()))
      acts.push(
        ...spyMenuHtml(p.id, [
          spyOddsHtml(p.id, mem.owner),
          btn('spyplanet', 'recon', t('side.scan.spy', { c: SPY_COST.recon }), spyReady('recon')),
          ...HOSTILE_OPS.map((op) =>
            btn('spyplanet', op, t(SCAN_KEY[op], { c: SPY_COST[op] }), spyReady(op)),
          ),
        ]),
      );
    // Возраст снимка (правило 4 `decisions/planetDossier.ts`); снимок без времени — словами.
    const age = scanAgeHtml(mem.at, game.world().time);
    const neutral = mem.owner ? '' : `<span class="pfact">${esc(t('side.neutral'))}</span>`;
    const stale = age ? '' : `<div class="row dim">${t('side.scan.stale')}</div>`;
    return (
      cardHeader(ownerColor(mem.owner), placeName(p.id), t('side.scan.title')) +
      `<div class="pfacts">${age}${neutral}${acts.length ? `<div class="pacts">${acts.join('')}</div>` : ''}</div>` +
      stale +
      scanGarrisonHtml(mem.garrison) +
      buildingsFoldHtml(mem.buildings)
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
 * Действия в строке статуса мира: ник хозяина, «Пинг», разведка. Столица, точка удержания и
 * точка сбора — приказы миру, они в окне «Построить» (`worldOrdersPane.ts`, UIX-10.12).
 * ЧТО предлагать, решает `spyOffer.ts` (REFM-92), здесь только кнопки. На телефоне «Пинг»,
 * «Построить» и ник хозяина стоят в нижней полосе листа, и в шапке их прячет CSS: кнопки остаются в разметке, потому что полоса листа показывается по их наличию.
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
    out.push(
      `<button class="b btn-second" data-act="openbuild">▣ ${t('side.build.open')}</button>`,
    );
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
  // Счёт машин ангара — тот же, что у прежней вкладки «Эскадра» (`planetTabs.ts`, REFM-41).
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
  // ОКНО «i» — ТОЛЬКО СВЕДЕНИЯ (UIX-10.12, заказ владельца 2026-11-08): стройка, очереди,
  // конвейеры и приказы мира живут в окне «Построить», здесь — что о мире известно. Укрытие
  // и тип мира встают строкой «Защита», выход своего мира — полосой дохода.
  const inDefense = (f: WorldFact) => f.kind === 'cover' || f.kind === 'type';
  const status = facts.filter((f) => !inDefense(f) && !(mine && f.kind === 'output'));
  const factsRow = status.map(worldFactHtml).join('') + worldActionsHtml(p, mine);
  // Пустой строки нет: без фактов и действий шапка кончается своей чертой.
  if (factsRow) h += `<div class="pfacts">${factsRow}</div>`;
  if (mine) h += incomeBandHtml(s, ME, p.id);
  // ECON-1: голодный гарнизон — владелец мира в food-arrears теряет 25% на земле.
  const { ground } = garrisonByTab(p.garrison, data);
  const starving = showsStarving(mine, ground.length, s.players[ME]?.arrears)
    ? `<div class="row" style="color:var(--red)">🍽 ${t('side.fleet.hunger')}</div>`
    : '';
  const cover = facts.filter(inDefense).map(worldFactHtml).join(' ');
  h += pcols([
    defenseHtml(game.radar(p), ME, cover, here, (f) => sumUnits(f.units)),
    garrisonGridHtml(p.garrison, starving),
  ]);
  h += buildingsFoldHtml(p.buildings, incomeOf);
  // Эскадра порта (SHU-3.1) — свёрнутым блоком, вместе с приказами звеньев: вылет — дело
  // эскадры, а не стройки мира, и окна «Построить» у него нет.
  const port = planetHangar(p, data);
  // Пустой порт — блока нет: показывать нечего. Перегрузка с носителем и прочие приказы —
  // в карточке самой эскадры (UIX-10.14).
  if (hasHangar(port) && counts.shuttle > 0)
    h += foldHtml('wing', t('side.tab.wings'), counts.shuttle, () =>
      hangarSectionHtml(port, p.id, mine),
    );
  // ПК: вход в окно «Построить» — внизу карточки; телефон держит его в нижней полосе листа.
  if (pcUi() && mine && buildsAnything(p, data, feedsOnBiomass(s, ME, data)))
    h += `<button class="bw-open btn-main" data-act="openbuild">▣ ${t('side.build.open')}</button>`;
  return h;
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
