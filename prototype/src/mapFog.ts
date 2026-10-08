/**
 * Туман карты — зрение кадра и память разведки (REFM-231, второй PR). Зрение кадра
 * (`vision`: опознание, радар, сигнатуры, мои бои, флоты по позиции, чужие патрули), его
 * кэш по миру (`visionMemo`), окна краденой разведки, память последних снимков миров и
 * вопросы к туману: виден ли мир (`known`), его детали (`seesDetails`), флот
 * (`fleetSeen`/`fleetKnown`), бой (`battleKnown`), событие журнала (`admits`).
 *
 * Зрение переписывали не только его функции: кадр, сетевой снимок и смена партии
 * присваивали `vision`, смена партии и песочница сбрасывали кэш, захват и загрузка
 * сохранения писали в память разведки. Теперь они зовут двери модуля
 * ({@link refreshVision}, {@link forgetVision}, {@link resetFogMemory}, {@link rememberScan},
 * {@link restoreFogMemory}), а снаружи зрение — живая привязка только для чтения, и память
 * разведки отдаёт только чтение (`get`/`has`/`ownerOf`/`dump`).
 *
 * Мир на экране, своё место, режим сети, контакты радара с сервера и круги обзора (они
 * считаются раз на мир в кэше кадра) живут в `main.ts`; модуль получает их хуками
 * {@link initMapFog} — импорт оттуда был бы циклом.
 */
import {
  engagementOf,
  fleetNodeAt,
  fleetsSeenByPosition,
  patrolsSeenBy,
  radarSignatures,
  sensorCoverage,
  type Battle,
  type Engagement,
  type Fleet,
  type GameState,
  type IntelGrant,
  type Planet,
  type SeenPatrol,
  type SightCircle,
  type SignatureContact,
} from '../../packages/shared-core/src/index';
import { isMineFleet, mineFleetVisible } from '../../packages/shared-core/src/state/minefields';
import { isMissileFleet } from '../../packages/shared-core/src/state/ordnance';
import { fleetIdentified } from '../../decisions/fleetIdentified';
import { missileOnMap } from '../../decisions/missileOnMap';
import { fleetVisible, seesDetails as fogSeesDetails } from './fogView';
import { data } from './gameData';
import { grantVision, liveGrants, targetsOf } from './intel';
import { recapAdmits } from './recapGate';
import { sandboxConfig } from './sandbox';
import { createScanMemory, type ScanMemory } from './scanMemory';

declare const __PLAYER_BUILD__: boolean;

/** Что туману нужно от игры. Мир, своё место, сеть и кэш кадра — в `main.ts`. */
export interface MapFogHost {
  /** Мир на экране. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Сетевая партия: туман уже наложил сервер, сигнатуры и патрули — из его проекции. */
  net(): boolean;
  /** Контакты радара последнего снимка сервера. */
  contacts(): SignatureContact[];
  /** Круги обзора этого мира — из кэша кадра (`perWorld`): ракете нужна позиция в круге. */
  sight(): SightCircle[];
}

let game: MapFogHost;

/** Поднять туман: хуки игры. Зовётся из `main.ts` один раз, до первого кадра. */
export function initMapFog(host: MapFogHost): void {
  game = host;
}

// --- fog of war (renderer projection; always on) -----------------------------
// Client-side projection just for the renderer — NOT the real security boundary
// (that is `visibleState` in shared-core). Fog is always on: ships are near-blind,
// sight comes from owned worlds + radar (see `computeVision`).
/** Зрение кадра: опознание и радар. `null` — туман выключен (песочница). Снаружи только
 *  для чтения: переписывает его дверь {@link refreshVision}. */
export let vision: Vision | null = null; // identify + radar sets for this frame

export interface Vision {
  identify: Set<string>;
  radar: Set<string>;
  signatures: SignatureContact[];
  /** Мои бои и флоты в них — видны, даже где узел не опознан (`engagementOf`). */
  engaged: Engagement;
  /** Чужие флоты в круге моей мины или висящего патруля — опознаны по позиции, даже на
   *  линии вдали от миров (`fleetsSeenByPosition`, SHU-6.7). */
  seenAt: Set<string>;
  /** Чужие висящие патрули в моём обзоре — круг и состав (SHU-6.10). В сети их считает
   *  проекция сервера, в соло — то же правило ядра (`patrolsSeenBy`) по полному миру. */
  seenPatrols: SeenPatrol[];
}

/** The map node a fleet occupies / is travelling over / is parked nearest to. */
export function fleetNode(f: Fleet): string | null {
  const s = game.world();
  // The node the ship is NEAREST to right now — tracks it along the leg, not the
  // destination (so its radar/identify anchor follows the fleet). The core's rule
  // (`fleetNodeAt`), not a copy: with roads (ROADS-2) "nearest" is the province the
  // ship is IN — split by the border crossing, not by half the lane — and a second copy
  // of that rule would anchor the radar in the wrong province near every fork.
  return fleetNodeAt(s, f, s.time);
}

// --- espionage (SPY-1 in the prototype) ---------------------------------------
// The core `espionageModule` grants time-boxed intel windows (`state.intel[ME]`);
// here the client fog honours them: a `planet` grant identifies that node, a
// `fleets` grant shows the target's fleets through the fog, a `treasury` grant is
// read by the diplomacy roster. Mirrors what `visibleState` does server-side.
// Окна краденой разведки и журнал шпионажа живут в `intel.ts` (REFM-28) — там же
// правила «истёкшее окно не видно» и «опознание влечёт радар».
/** Мои ЖИВЫЕ окна разведки на текущий час мира. */
export function myIntel(): IntelGrant[] {
  const s = game.world();
  return liveGrants(s.intel?.[game.me()], s.time);
}
// Владельцы, чьи флоты этот кадр показаны живым окном `fleets` — набор пересобирается
// вместе с `vision`, чтобы отрисовка проверяла Set, а не список грантов.
let intelFleetOwners = new Set<string>();

/** Variant-B visibility: an identify range (full detail, feeds memory) plus a
 *  wider radar range (enemy fleets seen only as coarse signatures). The radar
 *  reach scales with radar-array level and radar-ships. null vision = fog off. */
/**
 * RULES-5 — туман карты СПРАШИВАЕТСЯ у ядра, а не выводится заново.
 *
 * Здесь стояла рукописная копия `sensorCoverage`: те же обходы своих миров и флотов,
 * те же два кольца (сигнатуры снаружи, опознание внутри). Копия была БЕДНЕЕ оригинала
 * ровно на три правила, и каждое — живое:
 *
 *  · множитель радара от технологий и пассивки фракции (`radarRangeBonus`) копия не
 *    знала вовсе — исследованная дальность расширяла тревоги, но не карту, на которую
 *    игрок смотрит;
 *  · блок зрения (союз + договор об обмене картами) не сводился — разведка союзника
 *    приходила в состояние, но рисовалась туманом;
 *  · активные «сканы» героя (`activeReveals`) карту не подсвечивали.
 *
 * Расхождение было доказуемо на одном экране: `main.ts` уже звал ядро за туманом для
 * тревог (`identifiedNodes` в `updateThreatAlerts`), то есть тревога могла сообщить об
 * угрозе в мире, который карта рядом рисовала неопознанным.
 *
 * Клиентского здесь осталось только то, чего у ядра в этой точке и нет: окна краденой
 * разведки. У ядра они живут в ПРОЕКЦИИ (`visibleState`), которую соло-режим не гоняет —
 * он считает туман сам, по полному состоянию.
 */
function computeVision(): Vision {
  const s = game.world();
  const ME = game.me();
  const NET = game.net();
  const netSignatures = game.contacts();
  const { identify, radar } = sensorCoverage(s, ME, data);
  // Stolen `planet` windows identify their node (feeds memory too, so the scan
  // is remembered after the window closes); `fleets` windows fill the owner set
  // that fleet rendering consults.
  const grants = myIntel();
  grantVision({ identify, radar }, targetsOf(grants, 'planet'), (id) => !!s.planets[id]);
  intelFleetOwners = targetsOf(grants, 'fleets');
  const seenAt = fleetsSeenByPosition(s, ME, data);
  return {
    identify,
    radar,
    signatures: NET ? netSignatures : radarSignatures(s, ME, data, identify, seenAt),
    engaged: engagementOf(s, ME),
    seenAt,
    seenPatrols: NET ? (s.seenPatrols ?? []) : patrolsSeenBy(s, ME, data),
  };
}

/** Зрение этого кадра — по миру, а не по кадру (шаг 3 плавности). `computeVision` читает
 *  только мир, игрока, режим сети и контакты сервера, а мир здесь не правится на месте, а
 *  заменяется целиком: ход соло (`apply`), снимок сервера (`applyDelta` отдаёт новый
 *  объект), загрузка. Значит, пока мир и контакты — те же объекты, а игрок и режим сети
 *  прежние, прежнее зрение верно, и пересчёт вместе с записью в память разведки идёт только
 *  при смене одного из четырёх. В сети это раз на снимок, а не на каждый кадр, на паузе
 *  соло — только после действия игрока; в ходу соло мир новый каждый кадр, и круг радара
 *  летит за флотом, как раньше. Кто правит мир на месте или чистит память разведки, тот
 *  сбрасывает `visionMemo` дверью: песочница — {@link forgetVision} каждым кадром, смена
 *  матча — {@link resetFogMemory} вместе с памятью.
 *  Новый вход у `computeVision` обязан попасть и в эту проверку. */
let visionMemo: {
  state: GameState;
  me: string;
  net: boolean;
  contacts: SignatureContact[];
  vision: Vision;
} | null = null;
function currentVision(): Vision {
  const s = game.world();
  const ME = game.me();
  const NET = game.net();
  const netSignatures = game.contacts();
  const memo = visionMemo;
  if (
    memo &&
    memo.state === s &&
    memo.me === ME &&
    memo.net === NET &&
    memo.contacts === netSignatures
  )
    return memo.vision;
  const fresh = computeVision();
  updateMemory(fresh.identify); // variant B: remember what we see
  visionMemo = { state: s, me: ME, net: NET, contacts: netSignatures, vision: fresh };
  return fresh;
}

/**
 * Туман, по которому судят кадр и журнал (FOG-13). `null` значит «туман выключен», и
 * выключить его может только тумблер песочницы. Поэтому `vision` переписывается этой
 * функцией (дверь {@link refreshVision}) везде, где появляется НОВЫЙ мир (конец
 * `installMatch`, каждый сетевой снимок), а не только кадром: шаг мира, которым партия засевается, идёт до первого
 * кадра, и его события журнал проверял по зрению прошлой партии, а после загрузки
 * страницы — по `null`, то есть «видно всё»; события сетевой дельты идут сразу после
 * снимка и сверялись со зрением прошлого снимка.
 */
function fogVision(): Vision | null {
  // SANDBOX — fenced hook. The "fog of war" toggle defaults ON; turning it OFF drops the
  // fog projection (null vision ⇒ everything is `known`, mirroring the dev reveal).
  return !__PLAYER_BUILD__ && !game.net() && sandboxConfig.enabled && !sandboxConfig.fog
    ? null
    : currentVision();
}

/** Пересчитать зрение по миру, который сейчас на экране: кадр, каждый сетевой снимок и
 *  смена партии (FOG-13). Пока мир прежний, берётся запомненное (`visionMemo`). */
export function refreshVision(): void {
  vision = fogVision();
}

/** Забыть запомненное зрение: мир правили на месте (песочница), тот же объект — уже
 *  другой мир. */
export function forgetVision(): void {
  visionMemo = null;
}

/** Записать в память разведки миры, увиденные не радаром: захват, который игрок видел. */
export function rememberScan(ids: Iterable<string>): void {
  scans.remember(ids, game.world().planets);
}

/** Смена матча: память разведки принадлежит старому, и зрение в неё уже записано. */
export function resetFogMemory(): void {
  scans.clear();
  visionMemo = null;
}

/** Загрузка сохранения: память разведки едет вместе с партией. */
export function restoreFogMemory(entries: Parameters<ScanMemory['restore']>[0]): void {
  scans.restore(entries);
}

/** Is this fleet visible? Own always; enemy — when its node is identified OR a
 *  live `fleets` intel window covers its owner. */
export function fleetSeen(f: Fleet): boolean {
  const s = game.world();
  const ME = game.me();
  // Мина (SM-3.6) — только вблизи: ни опознанный узел, ни окно шпионажа её не раскрывают.
  if (isMineFleet(f, data)) return mineFleetVisible(s, f, ME, data);
  // Ракета (SM-3.7b) — по обычному туману, но по своей ПОЗИЦИИ: узла у неё нет. Окно
  // шпионажа открывает её здесь, остальное решает `missileOnMap`: в сети — присутствие в
  // проекции сервера, в соло — правило ядра (своя или глаза блока зрения); туман,
  // выключенный в песочнице (`vision` пуст), открывает её, как и любой флот.
  if (isMissileFleet(f, data))
    return (
      intelFleetOwners.has(f.owner) ||
      missileOnMap(s, f, ME, data, {
        net: game.net(),
        fogOff: !vision,
        circles: () => game.sight(),
      })
    );
  // Правила 5–7 «видимости под туманом» — `fogView.ts` (REFM-103), там же, где мир.
  return fleetVisible(f.owner === ME, fleetKnown(f), intelFleetOwners.has(f.owner));
}

/** Опознан ли флот: стоит у опознанного узла, дерётся в моём бою ИЛИ идёт в круге моей
 *  мины или висящего патруля. Перехват на полпути идёт вдали от миров — без второго
 *  условия флот вставал перед невидимым врагом (владелец 2026-09-29); патруль висит над
 *  дорогой — без третьего он не видел бы того, по кому бьёт (SHU-6.7). Правила те же, что
 *  у ядра, — `engagementOf` и `fleetsSeenByPosition`. В сети флот без окна шпионажа опознан
 *  самим присутствием в проекции сервера (`fleetIdentified`): сервер судит и глазами,
 *  которых проекция не отдаёт, — ракетной миной союзника. */
export function fleetKnown(f: Fleet): boolean {
  return fleetIdentified({
    net: game.net(),
    spied: intelFleetOwners.has(f.owner),
    local: () => fleetSeenHere(f),
  });
}
/** Опознание по зрению, посчитанному клиентом, — единственное место, где узел флота
 *  спрашивается напрямую (сторож `engagedFog.test.ts`). */
function fleetSeenHere(f: Fleet): boolean {
  return known(fleetNode(f)) || !!vision?.engaged.fleets.has(f.id) || !!vision?.seenAt.has(f.id);
}

/** Виден ли бой: его узел опознан ИЛИ в нём дерусь я (или мой блок зрения). */
export function battleKnown(b: Battle): boolean {
  return known(b.location) || !!vision?.engaged.battles.has(b.id);
}

// Per-viewer MEMORY of the last identified state of a node (variant B): once you
// have seen a system, you remember its last-known state (greyed) when sight lifts.
// Само хранилище и правила снимка — в `scanMemory.ts` (REFM-43): пишутся только
// ОПОЗНАННЫЕ узлы (радар состава не выдаёт), снимок — копия, а не ссылка на живой
// мир, и память принадлежит матчу.
const scans = createScanMemory();
/** Память разведки для чтения: писать в неё можно только дверями модуля. */
export const memory: Pick<ScanMemory, 'get' | 'has' | 'ownerOf' | 'dump'> = scans;
/**
 * Записать в память разведки то, что видно СЕЙЧАС, и то, что помнит СЕРВЕР (FOG-10).
 *
 * Клиентская память (`scanMemory.ts`) живёт ровно столько, сколько живёт вкладка. Пока
 * страница открыта, этого хватает; перезагрузил — и разведанные лично миры снова «?».
 * Настоящее хранилище памяти есть в ядре (`state.fog`, пишет `visibilityModule`), и
 * `visibleState` присылает по нему список `remembered`, УЖЕ подставив в эти миры их
 * последний известный снимок. Значит достаточно снять с них снимок тем же вызовом:
 * серверная память становится источником, клиентская — кэшем кадра, и после
 * перезагрузки карта восстанавливается из первого же снапшота.
 *
 * В соло поля нет (проекция там не применяется) — и не нужно: состояние полное, а
 * память набирается из того, что видно.
 */
function updateMemory(identify: Set<string>): void {
  const s = game.world();
  scans.remember(identify, s.planets);
  const remembered = (s as { remembered?: string[] }).remembered;
  if (remembered?.length) scans.remember(remembered, s.planets);
}

/** True if node `id` is identified (full detail); fog off ⇒ always true. */
export function known(id: string | null | undefined): boolean {
  return !vision || (id != null && vision.identify.has(id));
}
/** RECAP-FOG: пускать ли событие в журнал (а значит, и в сводку). Правило живёт
 *  чистой функцией в `recapGate.ts` — это правило безопасности, и гейт проверяет
 *  именно его, а не рукописный `if` внутри свитча. */
export function admits(type: string, p: Record<string, unknown>): boolean {
  return recapAdmits(type, p.owner as string | undefined, game.me(), known(p.planetId as string));
}
/** Fog gate: «этот мир игроку вообще видно в деталях?» — опознан или свой.
 *  Правило живёт ОДНОЙ функцией в `fogView.ts` (REFM-62): оно нужно и панели, и
 *  отрисовке радиусов, а когда было выписано дважды, второе место про него забыло —
 *  тап по неисследованной системе рисовал её радарные окружности с подписями, выдавая
 *  и владельца, и наличие радара, и его радиус, пока панель писала «нет телеметрии». */
export function seesDetails(p: Planet): boolean {
  return fogSeesDetails({ identified: known(p.id), mine: p.owner === game.me() });
}
