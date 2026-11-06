/**
 * Чужая авиация глазами зрителя: висящий патруль (SHU-6.10), эскадра в полёте и отметка
 * авиации на радаре (SHU-6.16, резолюция владельца 2026-11-06: «в зоне прямой видимости их
 * видно, в зоне радара только сигнал»). Правила здесь, а точку входа держит `visibility.ts`:
 * он даёт глаза и блок зрения ({@link AircraftView}) и собирает из ответов проекцию.
 */
import type { GameData } from '../data/schemas';
import type {
  GameState,
  PlanetId,
  PlayerId,
  SeenPatrol,
  ShuttleStrike,
  UnitStack,
} from './gameState';
import { fleetPositionAt } from './fleetPosition';
import { inRadius, isMissileFleet } from './ordnance';
import { fleetSignalStrength, type SignalEmitter } from './radarSignals';
import type { SightCircle } from './sensorView';
import { strikePosition } from './strikePosition';

/**
 * Чужая эскадра в полёте глазами зрителя (нога `out` или `back`; висящий патруль — это
 * {@link SeenPatrol}). Видно, чья она, где сейчас, куда и как быстро идёт, и чем. База,
 * точка цели и срок прибытия не передаются: это тыл и планы хозяина, а курс зритель и так
 * видит по движению значка.
 */
export interface SeenSortie {
  owner: PlayerId;
  /** Где эскадра в момент проекции (`state.time`). */
  at: { x: number; y: number };
  /** Скорость в единицах карты за минуту мира: значок идёт по ней до следующего снимка. */
  velocity: { x: number; y: number };
  leg: 'out' | 'back';
  /** Состав: машины и их число, без лоадаута и здоровья. */
  units: Array<Pick<UnitStack, 'unit' | 'count'>>;
}

/** Чем видит зритель: его блок зрения и круги опознания блока (лениво — не всем нужны). */
export interface AircraftView {
  bloc: ReadonlySet<PlayerId>;
  eyes: () => readonly SightCircle[];
}

/** Машины вылета, которые видно со стороны: тип и число, без лоадаута и здоровья. */
export function liveStacks(st: ShuttleStrike): SeenPatrol['units'] {
  return st.units.filter((u) => u.count > 0).map((u) => ({ unit: u.unit, count: u.count }));
}

/**
 * Чужие висящие патрули в обзоре зрителя — сами вылеты (SHU-6.10; рекомендация карточки
 * владельцу 2026-10-04 — «видно в обзоре», как самолёты в Conflict of Nations).
 *
 * 1. **Только висящий.** Эскадра на пути к точке и домой — вылет в полёте: её видят по
 *    правилам {@link sortiesInSight}, без круга.
 * 2. **Точка в обзоре зрителя** — внутри опознания хоть одного его круга, с блоком зрения.
 *    Это та же граница, что нарисована на карте: видно то, что внутри неё.
 * 3. **Или в круге патруля стоит флот блока.** Обзор флота (40 по умолчанию) меньше
 *    круга патруля (90), и без этого правила патруль бил бы флот, оставаясь невидимым.
 *    Граница круга включительна — та же мерка, по которой патруль выбирает цель. Ракета
 *    (SM-3.7b) не в счёт: она не глаз, и её пролёт не разведывает патрули по пути.
 * 4. **Со стороны видно круг и состав**, а не базу, эскадру, удержание и срок
 *    ({@link SeenPatrol}). Свой патруль сюда не входит: он целиком в `strikes`.
 */
export function hangingPatrolsSeen(
  state: GameState,
  viewerId: PlayerId,
  data: GameData,
  view: AircraftView,
): ShuttleStrike[] {
  const hanging = (state.strikes ?? []).filter(
    (st) => st.owner !== viewerId && st.leg === 'patrol' && (st.patrol?.radius ?? 0) > 0,
  );
  if (hanging.length === 0) return [];
  const eyes = view.eyes();
  const guarded: Array<{ x: number; y: number }> = [];
  for (const fleet of Object.values(state.fleets)) {
    if (!view.bloc.has(fleet.owner) || !fleet.units.some((u) => u.count > 0)) continue;
    if (isMissileFleet(fleet, data)) continue; // правило 3: ракета — не глаз
    const at = fleetPositionAt(state, fleet, state.time);
    if (at) guarded.push(at);
  }
  const ended = state.match.status === 'ended';
  return hanging.filter((st) => {
    const radius = st.patrol!.radius;
    return (
      ended ||
      eyes.some((c) => inRadius(st.to, c, c.identify)) || // правило 2
      guarded.some((at) => inRadius(at, st.to, radius)) // правило 3
    );
  });
}

/** Где чужой вылет сейчас, если он В ПОЛЁТЕ (нога `out`/`back`), и `null` у висящего
 *  патруля и у вылета без точки (база потеряна вместе с последней позицией). */
function inFlightAt(state: GameState, st: ShuttleStrike): { x: number; y: number } | null {
  return st.leg === 'patrol' ? null : strikePosition(st, state, state.time);
}

/** Точка внутри опознания хоть одного круга. */
function identified(eyes: readonly SightCircle[], at: { x: number; y: number }): boolean {
  return eyes.some((c) => inRadius(at, c, c.identify));
}

/**
 * Чужие эскадры в полёте, которые видит зритель (SHU-6.16; SHU-3.1 прятал их целиком).
 *
 * 1. **Только полёт.** Нога `out` или `back`; висящий патруль видят по своим правилам.
 * 2. **Точка в обзоре зрителя** — внутри опознания хоть одного круга его блока зрения,
 *    по той же мерке, что ракета (`missileVisible`): вылет идёт вне дорог, узел ему не
 *    мерка. Вылет блока виден всегда: хозяин знает, где его машины, и делит карту.
 * 3. **Под одним радаром** — безымянная отметка авиации ({@link airEmitters}), не сюда.
 * 4. **Со стороны видно** точку, скорость, ногу и состав ({@link SeenSortie}).
 */
export function sortiesInSight(
  state: GameState,
  viewerId: PlayerId,
  view: AircraftView,
): SeenSortie[] {
  const ended = state.match.status === 'ended';
  const out: SeenSortie[] = [];
  for (const st of state.strikes ?? []) {
    if (st.owner === viewerId || st.leg === 'patrol') continue;
    const at = inFlightAt(state, st);
    if (!at || !(ended || view.bloc.has(st.owner) || identified(view.eyes(), at))) continue;
    out.push({
      owner: st.owner,
      at: { x: at.x, y: at.y },
      velocity: sortieVelocity(state, st, at),
      leg: st.leg as SeenSortie['leg'],
      units: liveStacks(st),
    });
  }
  return out;
}

/** Скорость вылета в единицах карты за минуту мира: от нынешней точки к концу ноги за
 *  оставшееся время. Вылет на исходе срока стоит. */
function sortieVelocity(
  state: GameState,
  st: ShuttleStrike,
  at: { x: number; y: number },
): { x: number; y: number } {
  const left = st.arrivesAt - state.time;
  const end = left > 0 ? strikePosition(st, state, st.arrivesAt) : null;
  if (!end) return { x: 0, y: 0 };
  const perMinute = 60_000 / left;
  return { x: (end.x - at.x) * perMinute, y: (end.y - at.y) * perMinute };
}

/**
 * Излучатели чужой авиации, которую зритель НЕ видит глазами: эскадры в полёте и висящие
 * патрули. Сила — сумма `signature` машин (`units[].signature`), точка — где вылет сейчас,
 * якорь — `anchor` (ближайшая провинция, как у ракеты). Вылет блока не излучает: он виден.
 */
export function airEmitters(
  state: GameState,
  viewerId: PlayerId,
  data: GameData,
  view: AircraftView,
  anchor: (at: { x: number; y: number }) => PlanetId | null,
): SignalEmitter[] {
  const foreign = (state.strikes ?? []).filter(
    (st) => st.owner !== viewerId && !view.bloc.has(st.owner),
  );
  if (foreign.length === 0) return [];
  const seenPatrols = new Set(hangingPatrolsSeen(state, viewerId, data, view));
  const out: SignalEmitter[] = [];
  for (const st of foreign) {
    if (seenPatrols.has(st)) continue;
    const at = st.leg === 'patrol' ? st.to : inFlightAt(state, st);
    if (!at || (st.leg !== 'patrol' && identified(view.eyes(), at))) continue;
    const location = anchor(at);
    if (location !== null)
      out.push({
        location,
        x: at.x,
        y: at.y,
        inTransit: true,
        strength: fleetSignalStrength(st, data),
      });
  }
  return out;
}
