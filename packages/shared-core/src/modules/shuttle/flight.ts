/** Челноки: вылет и его исход — мощь удара, высадка, перелёт, посадка, ракеты и мины. Разрезан из `../shuttle.ts` (SLIM). */
import {
  type BaseView,
  type Flyer,
  absorbIntoStrike,
  baseOf,
  baseSortieSpec,
  fleetBase,
  hourMs,
  nextStrikeId,
  noteBase,
  planetBase,
  requireSquadron,
  returnFireAgainstFleet,
  scheduleFlight,
  schedulePatrolTick,
} from './kit';
import { type Context, travelSpeedFactorOf } from '../../action/types';
import type {
  Fleet,
  Planet,
  ShuttleStrike,
  Squadron,
  StrikeBase,
  UnitStack,
} from '../../state/gameState';
import type { GameData } from '../../data/schemas';
import { type GroundVolley, groundVolley, shuttleGroundDamage } from '../../util/groundFire';
import type { HandlerContext } from '../../kernel/module';
import {
  type SortieState,
  canSortie,
  freshSortie,
  hangarSize,
  hasMissiles,
  hullShare,
  spendSortie,
  squadronFerryRange,
  squadronPatrol,
  squadronReach,
  squadronSize,
  stacksSize,
  strikesReserved,
  trimCargo,
} from '../../state/shuttle';
import { addUnits, cappedUnitStat } from '../../util/stacks';
import {
  applyDamageToSide,
  beachheadOf,
  hookedDamage,
  isAllied,
  isHostile,
  removeIfWiped,
} from '../../util/combat';
import { basePosition } from '../../state/strikePosition';
import { distance } from '../../state/route';
import { fleetPositionAt } from '../../state/fleetPosition';
import { hasMapShare } from '../../state/diplomacy';
import { isCapturable } from '../../state/sectorKind';
import { isForkSite } from '../../state/forkSite';
import { isMineFleet } from '../../state/minefields';
import { isMissileFleet } from '../../state/ordnance';
import { requireOwnedUnengagedFleet } from '../../util/fleet';

/** Сила вылета против ЦЕЛИ ЭТОГО РОДА, ограниченная линией боя, ровно как у
 *  артиллерии: количество бьёт, но не бесконечно.
 *
 *  Профилей два (ROS-1.4): по КОРАБЛЯМ челнок бьёт `attack`, по ЗДАНИЯМ — своим
 *  `siegeDamage` (тот же стат, которым осадная платформа крушит мир, ROS-1.3).
 *  Одной цифрой роли челноков не различались вовсе: машина, хорошая против флота,
 *  была ровно настолько же хороша против построек, и «бомбардировщик против
 *  кораблей, перехватчик против челноков» оставалось словами в дизайне.
 *
 *  Нет `siegeDamage` → по зданиям считается `attack`, как до разделения: мягкая
 *  деградация, чужой и старый контент ведёт себя как вёл. */
export function strikePower(
  strike: ShuttleStrike,
  data: GameData,
  target: ShuttleStrike['target']['kind'],
): number {
  // Подбитые машины бьют слабее — в доле живого корпуса (SHU-5.7).
  const share = hullShare(strike.units, strike.damage, data);
  if (target === 'fleet') {
    return cappedUnitStat(strike.units, data, 'attack') * share;
  }
  return (
    cappedUnitStat(strike.units, data, (stats) => {
      const siege = stats.siegeDamage ?? 0;
      return siege > 0 ? siege : (stats.attack ?? 0);
    }) * share
  );
}

/** Огонь вылета по ВОЗДУШНОЙ цели — чужому вылету и ракете (SM-3.7d): `shuttleDamage`, в
 *  доле живого корпуса. */
export function strikeAirPower(strike: ShuttleStrike, data: GameData): number {
  return cappedUnitStat(strike.units, data, 'shuttleDamage') * hullShare(strike.units, strike.damage, data);
}

/** Огонь вылета по ВОЙСКАМ мира за удар (ROS-1.6): той же линией огня и в той же доле
 *  живого корпуса, что и удар по постройкам. */
export function strikeGroundPower(strike: ShuttleStrike, target: Planet, data: GameData): GroundVolley {
  const volley = groundVolley(strike.units, target.garrison, data, shuttleGroundDamage);
  return { ...volley, total: volley.total * hullShare(strike.units, strike.damage, data) };
}

/** Носитель, пустивший этот вылет, для `DamageHookArgs.attackerFleet` (CORE-DMG-3).
 *  Вылет с МИРА флотом не является — тогда поле не ставится вовсе. */
export function strikeAttackerFleet(strike: ShuttleStrike): { attackerFleet?: string } {
  return strike.base.kind === 'fleet' ? { attackerFleet: strike.base.id } : {};
}

/**
 * Пустить ответку по вылету и записать, чего она стоила (ROS-2.2).
 *
 * Через хук `combat.damage` со СВОЕЙ фазой `returnFire` (CORE-DMG-1): все каналы огня
 * ходят через один хук, и канал, который перестал его звать, молча отменяет техи и
 * пассивы фракций для своей доли урона. Ноль ответки — молчание: голый мир ничем не
 * стрелял, и событие о выстреле было бы враньём.
 */
export function repelStrike(
  h: HandlerContext,
  strike: ShuttleStrike,
  amount: number,
  target: { kind: 'fleet' | 'planet'; id: string; owner: string | null; location: string },
): void {
  if (amount <= 0) return;
  const dealt = hookedDamage(h, amount, {
    phase: 'returnFire',
    location: target.location,
    attacker: target.owner ?? '',
    defender: strike.owner,
    // CORE-DMG-3: огрызается ЦЕЛЬ — флот своими орудиями, мир своим ПВО.
    ...(target.kind === 'fleet' ? { attackerFleet: target.id } : {}),
  });
  const downed = absorbIntoStrike(strike, dealt, h.ctx.data, h, target.owner);
  h.emit('shuttle.repelled', {
    strikeId: strike.id,
    owner: strike.owner,
    targetId: target.id,
    targetOwner: target.owner,
    damage: dealt,
    downed,
  });
}

/**
 * Урезать груз до того, что довезли УЦЕЛЕВШИЕ машины (ROS-1.5, SHU-5.2).
 *
 * Десантный челнок несёт ровно одного бойца, поэтому сбитый борт уносит своего: иначе
 * зональное ПВО выбивало бы конвой, а на землю всё равно сходил бы полный десант, и
 * оборона против высадки ничего не решала бы. Режем с хвоста (`trimCargo`) тем же
 * порядком, что и сами машины: порядок детерминирован.
 */
export function trimCargoToSurvivors(strike: ShuttleStrike): void {
  const cargo = strike.cargo ?? [];
  if (cargo.length === 0) return;
  strike.cargo = trimCargo(cargo, strike.units.reduce((n, st) => n + Math.max(0, st.count), 0));
}

/**
 * ВЫСАДКА (ROS-1.5) — что делает долетевший груз на чужой земле.
 *
 * Решение владельца 2026-09-09: десант с челнока — полноценная сторона наземного боя.
 * Флота у него нет, поэтому его держит МИР (`planet.beachhead`), а не флот, как у
 * высадки с орбиты; всё остальное — тот же шов, что у `fleet.assault`:
 *
 *  · мир СВОЙ или дружественный → груз просто уходит в гарнизон (переброска
 *    подкреплений, дефолт кирпича на открытый вопрос владельцу);
 *  · мир чужой и НЕОБОРОНЯЕМЫЙ → он берётся сразу, десант становится гарнизоном;
 *  · мир чужой и обороняемый → встаёт ПЛАЦДАРМ и начинается наземный бой; если свой
 *    плацдарм там уже есть, груз доливается в него (переброска под огонь);
 *  · за мир уже дерётся КТО-ТО ДРУГОЙ → сесть некуда: один наземный бой на гарнизон
 *    (то же правило, что отбивает второй штурм кодом `E_UNDER_ASSAULT`), и груз гибнет
 *    вместе с машинами. Это не молчаливая потеря: о ней говорит `shuttle.landed`
 *    с `landed: 0`.
 */
/**
 * Поставить высаженных бойцов в список стеков (SHU-5.7). Побитый челнок отдаёт бойцу свою
 * долю живого корпуса: 50% корпуса челнока — 50% здоровья бойца (резолюция владельца
 * 2026-09-26). Раненый стек встаёт ОТДЕЛЬНО — с целыми он не сливается, как и любой
 * раненый стек (`findHealthyStack`); целые сливаются как прежде.
 */
function landStacks(into: UnitStack[], cargo: readonly UnitStack[], share: number, data: GameData): void {
  for (const st of cargo) {
    const per = data.units[st.unit]?.stats.hp ?? 0;
    if (share >= 1 || per <= 0) addUnits(into, st.unit, st.count);
    else into.push({ unit: st.unit, count: st.count, hp: st.count * per * share });
  }
}

export function landCargo(h: HandlerContext, strike: ShuttleStrike, planet: Planet): void {
  const cargo = (strike.cargo ?? []).filter((st) => st.count > 0);
  const share = hullShare(strike.units, strike.damage, h.ctx.data);
  const owner = strike.owner;
  const friendly =
    planet.owner === owner ||
    (planet.owner !== null &&
      (isAllied(h, owner, planet.owner) || hasMapShare(h.state, owner, planet.owner)));
  let landed = cargo;
  let mode: 'reinforce' | 'capture' | 'beachhead' | 'lost' = 'lost';
  // MSB-4: свой плацдарм на этом мире и чужие — разные случаи. Свой принимает
  // подкрепление, чужие больше не запрещают высадку, но запрещают тихий захват пустого
  // мира: за него уже дерутся.
  const own = beachheadOf(h.state, planet.id, owner);
  const others = (planet.beachheads ?? []).some((b) => b.owner !== owner);

  if (cargo.length === 0 || isForkSite(planet)) {
    // Площадка развилки десанта не принимает (приказ отбит ещё на вылете) — подстраховка.
    landed = [];
    mode = 'lost';
  } else if (friendly) {
    landStacks(planet.garrison, cargo, share, h.ctx.data);
    mode = 'reinforce';
  } else if (own) {
    // Свой плацдарм уже на земле — подкрепление в идущий бой. Ссылка стороны адресует
    // ПАРУ (мир, владелец), а не снимок стеков, поэтому подошедшие войска считаются со
    // следующего раунда.
    landStacks(own.units, cargo, share, h.ctx.data);
    mode = 'beachhead';
    // Берег мог стоять на земле БЕЗ БОЯ — после ничьей или перемирия. Тогда подкрепление
    // продолжает штурм так же, как новый десант с флота: `beachhead.landed` заводит бой или
    // вводит берег в идущий (замечание Codex на #1409: челнок довозил войска, а бой так и не
    // начинался). Против невраждебного хозяина — нет: перемирие драку и сняло.
    const fighting = Object.values(h.state.battles).some(
      (b) =>
        b.phase === 'ground' &&
        b.location === planet.id &&
        b.sides.some((x) => x.ref.kind === 'beachhead' && x.ref.owner === owner),
    );
    if (!fighting && (planet.owner === null || isHostile(h, owner, planet.owner))) {
      h.emit('beachhead.landed', { planetId: planet.id, owner });
    }
  } else if (!isCapturable(h.ctx.data, planet)) {
    landed = []; // пустое пространство не занимают пехотой
  } else if (
    !planet.garrison.some((st) => st.count > 0) &&
    !others &&
    !groundBattleAt(h, planet.id)
  ) {
    // Fail-secure: тихо занять мир можно, только если за него НИКТО не дерётся. Чужой
    // плацдарм или идущий наземный бой (например, высадка с флота) означают, что мир
    // спорный, — тогда ниже заводится свой берег, а не захват без боя.
    const previous = planet.owner;
    planet.owner = owner;
    planet.garrison = [];
    landStacks(planet.garrison, cargo, share, h.ctx.data);
    h.emit('planet.captured', {
      planetId: planet.id,
      owner,
      by: planet.id,
      from: previous,
      via: 'assault',
    });
    mode = 'capture';
  } else {
    // MSB-4: СВОЙ берег у каждого штурмующего (решение владельца §0.0 №3). Раньше здесь
    // стоял отказ «за мир дерётся другой — садиться некуда»: плацдарм был один, и второй
    // десант просто терял груз. Push в конец — порядок списка это порядок ВЫСАДКИ, по
    // которому §0.0 №4 решает, чей мир.
    const units: UnitStack[] = [];
    landStacks(units, cargo, share, h.ctx.data);
    (planet.beachheads ??= []).push({ owner, units });
    // Бой начинает МОДУЛЬ БОЯ, услышав событие: модули не зовут друг друга напрямую
    // (инвариант «только через шину»), и `startBattle` живёт там же, где все остальные
    // правила боя. Нет модуля боя — плацдарм просто стоит, а не падает.
    h.emit('beachhead.landed', { planetId: planet.id, owner });
    mode = 'beachhead';
  }

  h.emit('shuttle.landed', {
    strikeId: strike.id,
    owner,
    planetId: planet.id,
    landed: landed.reduce((n, st) => n + st.count, 0),
    mode,
  });
}

/** Идёт ли на этом мире наземный бой — то же правило «один бой на гарнизон», которым
 *  `fleet.assault` отбивает второй штурм. */
function groundBattleAt(h: HandlerContext, planetId: string): boolean {
  for (const id of Object.keys(h.state.battles).sort()) {
    const b = h.state.battles[id];
    if (b && b.phase === 'ground' && b.location === planetId) return true;
  }
  return false;
}

/** База из payload: ровно одна из двух — свой мир с портом ИЛИ свой носитель. Общая
 *  преамбула ВСЕХ приказов ангара (вылет, делёж, слияние, погрузка): своя копия у
 *  каждого разъехалась бы с остальными на первой же правке правил владения. */
export function baseFromPayload(
  h: HandlerContext,
  playerId: string,
  p: { planetId?: unknown; fleetId?: unknown },
): BaseView {
  const fromPlanet = typeof p.planetId === 'string';
  const fromFleet = typeof p.fleetId === 'string';
  if (fromPlanet === fromFleet) return h.reject('E_BAD_PAYLOAD'); // ровно одна база
  if (fromPlanet) {
    const planet = h.state.planets[p.planetId as string];
    if (!planet) return h.reject('E_NO_PLANET');
    if (planet.owner !== playerId) return h.reject('E_FORBIDDEN');
    return planetBase(planet, h.ctx.data);
  }
  // Носитель обязан быть СВОИМ и не запертым в бою — но НЕ обязан стоять (решение
  // владельца 2026-09-16). Прежнее правило требовало стоянки, и обоснование звучало так:
  // «порт не двигается, и вылет с разгоняющегося носителя пришлось бы догонять». Оно
  // устарело раньше, чем сменилось правило: SHU-4.4 научил удар ДОГОНЯТЬ движущуюся
  // цель, а возврат и так берёт позицию базы ЖИВОЙ (`turnHome`: «носитель мог сдвинуться,
  // пока челноки летели»). Догонять уже умели — запрещали ровно взлёт.
  //
  // Второй ветки правил это не завело: позицию идущего носителя считает та же
  // `fleetPositionAt`, что и стоящего, — и радиус вылета, и возврат читают её одинаково.
  const fleet = requireOwnedUnengagedFleet(h, p.fleetId as string, playerId);
  return fleetBase(fleet, h.state, h.ctx.data, h.ctx.now);
}

/** Скорость соединения — самая медленная машина в нём: летят вместе, не порознь.
 *  Помножена на темп перемещения матча (`travelSpeedFactor`, ×5 в Sector Zero) — тот же,
 *  что у флотов: ускорь одни флоты, и истребитель отстал бы от фрегата, за которым охотится. */
function slowestSpeed(units: readonly UnitStack[], ctx: Context): number {
  let slowest = Infinity;
  for (const st of units) {
    if (st.count <= 0) continue;
    slowest = Math.min(slowest, ctx.data.units[st.unit]?.stats.speed ?? 0);
  }
  return Number.isFinite(slowest) ? slowest * travelSpeedFactorOf(ctx) : 0;
}

/** Скорость вылета — самая медленная машина в нём, урезанная в доле живого корпуса
 *  (SHU-5.7): подбитое соединение летит медленнее. */
export function strikeSpeed(strike: ShuttleStrike, ctx: Context): number {
  return slowestSpeed(strike.units, ctx) * hullShare(strike.units, strike.damage, ctx.data);
}

/**
 * ПОСАДОЧНОЕ МЕСТО БАЗЫ (SHU-6.4) — одно правило на посадку, приказ перелёта и поиск
 * запасной базы: три копии разъехались бы ровно там, где игрок теряет эскадру.
 *
 * `bay` — сколько мест ангар базы может занять после посадки, `room` — сколько из них
 * свободно сейчас. У порта места без предела. У корабля — трюм за вычетом мест, которые
 * держат за собой ДРУГИЕ вылеты, летящие к нему (`except` — сам садящийся: своё место он
 * занимает сам). `null` — сесть нельзя вовсе: базы нет, она чужая, порт снесён, трюма нет.
 */
export function landingSpot(
  h: HandlerContext,
  owner: string,
  ref: StrikeBase,
  except?: string,
): { base: BaseView; bay: number; room: number } | null {
  const base = baseOf(ref, h.state, h.ctx.data, h.ctx.now);
  if (!base || base.owner !== owner) return null;
  const bay =
    ref.kind === 'fleet' ? base.bay - strikesReserved(h.state, ref.id, h.ctx.data, except) : base.bay;
  if (bay <= 0) return null;
  return { base, bay, room: bay - hangarSize({ hangar: base.hangar }, h.ctx.data) };
}

/**
 * БЛИЖАЙШАЯ СВОЯ БАЗА, куда эскадра сядет целиком (SHU-6.4): мир с портом или ангаром
 * крепости либо корабль с трюмом, в том числе идущий, — в дальности ПЕРЕЛЁТА от точки
 * `from`. Дальность та же, что у приказа: дальше эскадра не долетает ни по приказу, ни
 * без него.
 *
 * Детерминированно: ближе — раньше, при равной дистанции мир раньше корабля, дальше по
 * id. Союзник не база — сажать машины на чужой порт владелец не заказывал.
 */
function nearestBase(
  h: HandlerContext,
  strike: ShuttleStrike,
  from: { x: number; y: number },
  need: number,
): StrikeBase | null {
  const reach = squadronFerryRange(strike, h.ctx.data);
  const candidates: Array<{ ref: StrikeBase; at: { x: number; y: number } | null }> = [];
  for (const id of Object.keys(h.state.planets).sort()) {
    const planet = h.state.planets[id]!;
    if (planet.owner === strike.owner) candidates.push({ ref: { kind: 'planet', id }, at: planet.position });
  }
  for (const id of Object.keys(h.state.fleets).sort()) {
    const fleet = h.state.fleets[id]!;
    if (fleet.owner !== strike.owner) continue;
    candidates.push({ ref: { kind: 'fleet', id }, at: fleetPositionAt(h.state, fleet, h.ctx.now) });
  }
  let best: StrikeBase | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    if (!c.at) continue;
    const d = distance(from, c.at);
    // Строго ближе: при равной дистанции остаётся тот, кто раньше в обходе.
    if (d > reach || d >= bestDist) continue;
    const spot = landingSpot(h, strike.owner, c.ref, strike.id);
    if (!spot || spot.room < need) continue;
    best = c.ref;
    bestDist = d;
  }
  return best;
}

/**
 * ЛЕТЕТЬ НА БАЗУ — обратной ногой из точки `from` (SHU-6.4). Одна на возврат домой,
 * перелёт и посадку без базы: та же позиция на карте, тот же зенит по трассе, та же
 * посадка. Копия у каждого разъехалась бы на первой же правке правил возврата.
 *
 * Позиция базы берётся ТЕКУЩАЯ: носитель мог сдвинуться, пока челноки летели, и лететь
 * они должны к нему, а не к точке, где он стоял на вылете. Дальше нога ползёт за живой
 * позицией корабля (`strikePosition`), а садится по сроку.
 *
 * `to` становится точкой РАЗВОРОТА, а живой след (`at`) снимается: с этой секунды у
 * эскадры снова есть расписание, и позицию надо выводить, а не хранить.
 */
export function flyTo(
  h: HandlerContext,
  strike: ShuttleStrike,
  dest: StrikeBase,
  from: { x: number; y: number },
): void {
  const at = basePosition(dest, h.state, h.ctx.now);
  const back = at ? distance(from, at) : 0;
  const speed = strikeSpeed(strike, h.ctx);
  const flightMs = speed > 0 ? Math.max(1, Math.round((back / speed) * hourMs(h))) : 1;
  strike.base = dest;
  if (dest.kind === 'planet') delete strike.baseAt;
  else noteBase(h, strike);
  strike.to = { x: from.x, y: from.y };
  delete strike.at;
  strike.leg = 'back';
  strike.departedAt = h.ctx.now;
  strike.arrivesAt = h.ctx.now + flightMs;
  scheduleFlight(h, strike, strike.arrivesAt, 'shuttle.arrived');
}

/**
 * БАЗА НЕ ПРИНЯЛА — ИСКАТЬ, ГДЕ СЕСТЬ (SHU-6.4, резолюция владельца 2026-10-04).
 *
 * Раньше вылет, чья база пропала, просто гиб на посадке. Теперь:
 *
 * 1. **Перелёт возвращается туда, откуда ушёл** (`origin`), если там есть место, — без
 *    предела дальности: дорогу назад эскадра только что пролетела. Поле снимается сразу:
 *    вторая неудача ведёт уже к ближайшей базе, а не по кругу между двумя.
 * 2. **Иначе — ближайшая своя база в дальности перелёта** (`nearestBase`), куда эскадра
 *    влезает ЦЕЛИКОМ: искать место, чтобы потерять там половину машин, нечестно.
 * 3. **Некуда — эскадра гибнет**, и это громко (`shuttle.lost` с базой, которая не
 *    приняла), а не тихое исчезновение из состояния.
 *
 * Решение принимается в точке, назначенной расписанием вылета (поворот, прибытие), а не
 * на `time.advanced`: нарезка хоста не должна решать, где эскадра сядет.
 */
export function divert(
  h: HandlerContext,
  strike: ShuttleStrike,
  from: { x: number; y: number },
  failed: StrikeBase,
): void {
  const need = Math.max(1, stacksSize(strike.units, h.ctx.data));
  const origin = strike.origin;
  delete strike.origin;
  const home = origin ? landingSpot(h, strike.owner, origin, strike.id) : null;
  const dest = origin && home && home.room >= need ? origin : nearestBase(h, strike, from, need);
  if (!dest) {
    h.state.strikes = (h.state.strikes ?? []).filter((st) => st.id !== strike.id);
    h.emit('shuttle.lost', {
      baseId: failed.id,
      baseKind: failed.kind,
      owner: strike.owner,
      count: strike.units.reduce((n, st) => n + st.count, 0),
    });
    return;
  }
  h.emit('shuttle.diverted', {
    strikeId: strike.id,
    owner: strike.owner,
    squadronId: strike.squadronId,
    fromId: failed.id,
    fromKind: failed.kind,
    baseId: dest.id,
    baseKind: dest.kind,
  });
  // С этой секунды у эскадры одно дело — сесть целиком, как у перелёта. Патруль, если это
  // был он, кончился: поле `patrol` есть только у вылета с целью-точкой.
  strike.target = { kind: 'base' };
  delete strike.patrol;
  flyTo(h, strike, dest, from);
}

/**
 * РАЗВОРОТ ДОМОЙ — тем же путём и с той же скоростью. Один на всех, кто разворачивает
 * эскадру: удар состоялся, погоня сорвалась, цель исчезла, патруль кончился. Дома не
 * стало, пока эскадра была в воздухе, — она ищет другую базу сразу, из точки разворота
 * (`divert`), а не летит в пустоту.
 */
export function turnHome(h: HandlerContext, strike: ShuttleStrike): void {
  const from = strike.at ?? strike.to;
  if (!landingSpot(h, strike.owner, strike.base, strike.id)) {
    return divert(h, strike, from, strike.base);
  }
  flyTo(h, strike, strike.base, from);
}

/**
 * ЭСКАДРА, ГОТОВАЯ К ВЫЛЕТУ, и запас вылетов её базы — общая преамбула удара и патруля
 * (SHU-6.2): своя копия у каждого приказа разъехалась бы с другой на первой правке.
 *
 * База: есть, цела и с топливом. Порог повреждения — на ВЫЛЕТ (правило владельца);
 * возврату он не мешает, иначе челнок повис бы в пустоте. У носителя порога нет:
 * подбитый носитель теряет корпуса, вместимость падает сама.
 *
 * Проверяется РАНЬШЕ эскадры намеренно: «этот флот вообще не база» — более точный ответ,
 * чем «в нём нет такого соединения», а у обычного корабля его и не бывает.
 */
export function readySquadron(h: HandlerContext, base: BaseView, squadronId: unknown): Ready {
  const blocked = baseBlock(base);
  if (blocked) return h.reject(blocked);
  const squad = requireSquadron(h, base, squadronId);
  // Ракеты не вылетают: их пускают (`missile.launch`), а удар, патруль и перелёт — для
  // челноков (решение владельца 2026-11-09).
  if (hasMissiles(squad, h.ctx.data)) return h.reject('E_MISSILE_SQUADRON');
  const ready = squadronReady(h, base, squad);
  return typeof ready === 'string' ? h.reject(ready) : ready;
}

/** Эскадра, готовая к вылету, и запас вылетов её базы. */
type Ready = { squad: Squadron; spec: { maxFuel: number; rearmRounds: number }; sortie: SortieState };

/** Выпускает ли база вообще: есть, цела. Код отказа, а не бросок — тем же ответом
 *  удержание патруля (SHU-6.6) решает, ждать ему или снять удержание. */
export function baseBlock(base: BaseView): string | null {
  if (base.bay <= 0) return 'E_NO_PORT';
  if (base.disabled) return 'E_PORT_DAMAGED';
  return null;
}

/** Готова ли эскадра и есть ли у базы вылет — без бросков, как {@link baseBlock}. */
export function squadronReady(h: HandlerContext, base: BaseView, squad: Squadron): Ready | string {
  if (squadronSize(squad) <= 0) return 'E_NOT_ENOUGH';
  const spec = baseSortieSpec(base, h.state, h.ctx.data);
  const sortie = base.sortie ?? freshSortie(spec.maxFuel);
  if (!canSortie(sortie)) return 'E_NO_FUEL';
  return { squad, spec, sortie };
}

/** Время полёта эскадры по прямой: самая медленная машина, урезанная в доле живого
 *  корпуса (SHU-5.7). Не летит вовсе — отказ `E_NO_SPEED`. */
export function flightTime(
  h: HandlerContext,
  squad: Flyer,
  from: { x: number; y: number },
  to: { x: number; y: number },
): number {
  return flightMs(h, squad, from, to) ?? h.reject('E_NO_SPEED');
}

/** То же время полёта без броска: `null` — эскадре нечем лететь. Нужно удержанию патруля
 *  (SHU-6.6), которое поднимает эскадру из события и обязано снять удержание, а не
 *  уронить событие. */
function flightMs(
  h: HandlerContext,
  squad: Flyer,
  from: { x: number; y: number },
  to: { x: number; y: number },
): number | null {
  const speed = slowestSpeed(squad.units, h.ctx) * hullShare(squad.units, squad.damage, h.ctx.data);
  if (speed <= 0) return null;
  return Math.max(1, Math.round((distance(from, to) / speed) * hourMs(h)));
}

/**
 * ВЗЛЁТ — один на удар, патруль и перелёт (SHU-6.2, SHU-6.4): эскадра покидает ангар,
 * база тратит вылет, в состоянии появляется летящий вылет. Id, снятие с ангара и расход
 * топлива у приказов не должны расходиться. Расписание (прибытие или погоню) ставит
 * вызывающий: оно у приказов разное.
 *
 * `dest` — у ПЕРЕЛЁТА: эскадра сразу идёт обратной ногой на новую базу, а база, с
 * которой она ушла, запоминается в `origin` — туда она вернётся, если новая не примет.
 */
export function launchFlight(
  h: HandlerContext,
  owner: string,
  base: BaseView,
  ready: Ready,
  flight: Pick<ShuttleStrike, 'target' | 'to' | 'arrivesAt'> &
    Partial<Pick<ShuttleStrike, 'at' | 'cargo' | 'patrol'>> & { dest?: StrikeBase },
): ShuttleStrike {
  const { squad, spec, sortie } = ready;
  // Эскадра покидает ангар ЦЕЛИКОМ — с этой секунды её в базе нет. Груз уже в трюме
  // (SHU-4.2), брать с базы нечего: он ушёл из гарнизона при погрузке.
  base.setHangar(base.hangar.filter((q) => q.id !== squad.id));
  base.setSortie(spendSortie(sortie, spec.rearmRounds));
  const strike: ShuttleStrike = {
    id: nextStrikeId(h, owner),
    owner,
    base: flight.dest ?? base.ref,
    squadronId: squad.id,
    units: squad.units.map((st) => ({ ...st })),
    target: flight.target,
    to: flight.to,
    departedAt: h.ctx.now,
    arrivesAt: flight.arrivesAt,
    leg: flight.dest ? 'back' : 'out',
    ...(flight.at ? { at: flight.at } : {}),
    ...(flight.cargo ? { cargo: flight.cargo } : {}),
    // Подбитые машины летят подбитыми (SHU-5.3): урон эскадры — начало счёта вылета.
    ...(squad.damage ? { damage: squad.damage } : {}),
    ...(flight.patrol ? { patrol: flight.patrol } : {}),
    ...(flight.dest ? { origin: base.ref } : {}),
  };
  noteBase(h, strike);
  h.state.strikes = [...(h.state.strikes ?? []), strike];
  h.emit('shuttle.launched', {
    strikeId: strike.id,
    owner,
    from: base.ref.id,
    fromKind: base.ref.kind,
    count: squadronSize(squad),
  });
  return strike;
}

/**
 * Сбитая ракета (SM-3.7b) уходит с карты отработавшей — `spent`, как после попадания и
 * перехвата ПРО: «☠️ флот уничтожен» читался бы потерей флота, которой не было. Конец ракеты
 * объявляет своя строка, обеим сторонам — как перехват ПРО (`rocketMine.intercepted`):
 * `owner` — хозяин челноков, как у прочих событий `shuttle.*`, `playerId` — хозяин ракеты.
 */
function downMissile(h: HandlerContext, strike: ShuttleStrike, missileId: string): void {
  const missile = h.state.fleets[missileId];
  if (!missile || missile.units.length > 0) return;
  delete h.state.fleets[missileId];
  h.emit('fleet.destroyed', { fleetId: missileId, owner: missile.owner, spent: true });
  h.emit('shuttle.missileDowned', { owner: strike.owner, playerId: missile.owner, missileId });
}

/**
 * Залп эскадры по ракете (SM-3.7d, решение владельца 2026-10-14): ракета — воздушная цель,
 * и бьют её `shuttleDamage`, тем же каналом, что чужой вылет (`intercept`). Ответки нет:
 * ракета без оружия. Один путь на тик патруля, выстрел при влёте в круг и удар приказом.
 */
export function hitMissile(h: HandlerContext, strike: ShuttleStrike, missile: Fleet, power: number): void {
  if (power <= 0) return;
  const dealt = hookedDamage(h, power, {
    phase: 'intercept',
    location: '',
    attacker: strike.owner,
    defender: missile.owner,
    ...strikeAttackerFleet(strike),
    defenderFleet: missile.id,
  });
  h.emit('shuttle.hit', {
    strikeId: strike.id,
    owner: strike.owner,
    targetId: missile.id,
    targetOwner: missile.owner,
    playerId: missile.owner,
    location: '',
    damage: dealt,
  });
  applyDamageToSide(h, { kind: 'fleet', fleetId: missile.id }, dealt, h.ctx.data, '', undefined, undefined, strike.owner);
  downMissile(h, strike, missile.id);
}

/**
 * Мина, снятая челноками или зональным ПВО (SM-3.6, SM-3.7a), уходит с карты отработавшей —
 * `spent`, как ракета выше: «☠️ флот уничтожен» читался бы хозяину мины потерей флота,
 * которой не было. Конец мины объявляет своя строка обеим сторонам, теми же ключами, что у
 * сбитой ракеты: `owner` — кто снял, `playerId` — хозяин мины. Места в событии нет: мину
 * видно только вблизи, и узел выдал бы её третьим. Убийством она засчитывается (`unit.died`
 * с `killedBy`, решение владельца 2026-10-13).
 */
export function clearMine(
  h: HandlerContext,
  by: string,
  mineId: string,
  event: 'shuttle.mineCleared' | 'pd.mineCleared',
): void {
  const mine = h.state.fleets[mineId];
  if (!mine || mine.units.length > 0) return;
  delete h.state.fleets[mineId];
  h.emit('fleet.destroyed', { fleetId: mineId, owner: mine.owner, spent: true });
  h.emit(event, { owner: by, playerId: mine.owner, mineId });
}

/**
 * УДАР ВЫЛЕТА ПО ФЛОТУ — урон, гибель цели и её ответка. Один на удар по прибытии и на
 * тик патруля (SHU-6.2): `share` — доля обычного удара (у удара 1, у тика ¼), и ответка
 * берётся той же долей. Две копии этих строк разъехались бы на первой правке урона.
 */
export function strikeFleet(h: HandlerContext, strike: ShuttleStrike, target: Fleet, share: number): void {
  const power = strikePower(strike, h.ctx.data, 'fleet') * share;
  // Ракета — воздушная цель (SM-3.7d): её бьёт `shuttleDamage`, ответки нет.
  if (isMissileFleet(target, h.ctx.data)) return hitMissile(h, strike, target, strikeAirPower(strike, h.ctx.data) * share);
  // Мину узнаём ДО удара: у добитого отряда не остаётся юнитов, по которым её узнать.
  const mine = isMineFleet(target, h.ctx.data);
  if (power > 0) {
    const dealt = hookedDamage(h, power, {
      phase: 'shuttle',
      location: target.location ?? '',
      attacker: strike.owner,
      defender: target.owner,
      ...strikeAttackerFleet(strike),
      defenderFleet: target.id,
    });
    // `playerId` — адресат удара (жертва) для фильтра событий сервера, `location` — узел
    // для того, кто его опознаёт (`MatchRoom.eventVisibleTo`). Под одним `targetOwner`
    // жертва не узнавала об ударе по своему флоту вовсе: такого ключа аудитории нет.
    h.emit('shuttle.hit', {
      strikeId: strike.id,
      owner: strike.owner,
      targetId: target.id,
      targetOwner: target.owner,
      playerId: target.owner,
      location: target.location ?? '',
      damage: dealt,
    });
    applyDamageToSide(
      h,
      { kind: 'fleet', fleetId: target.id },
      dealt,
      h.ctx.data,
      '',
      undefined,
      undefined,
      strike.owner,
    );
    if (mine) clearMine(h, strike.owner, target.id, 'shuttle.mineCleared');
    else removeIfWiped(h, target.id);
  }
  repelStrike(h, strike, returnFireAgainstFleet(target, h.ctx.data) * share, {
    kind: 'fleet',
    id: target.id,
    owner: target.owner,
    location: target.location ?? '',
  });
}

/**
 * ПАТРУЛЬ ВСТАЛ В КРУГ (SHU-6.2): эскадра дошла до точки и висит над ней `patrol.hours`
 * игровых часов. Своё расписание нога `patrol` держит той же парой полей, что и полёт:
 * `departedAt` — начало патруля, `arrivesAt` — конец, по ним интерфейс рисует таймер.
 * Конец патруля — последний тик, а не отдельное событие прибытия: так отозванный патруль
 * не оставляет в очереди ничего, что вернуло бы его домой по старому сроку.
 */
export function startPatrol(h: HandlerContext, strike: ShuttleStrike): void {
  delete strike.at; // путь к точке пройден: дальше позиция эскадры и есть точка
  strike.leg = 'patrol';
  strike.departedAt = h.ctx.now;
  strike.arrivesAt = h.ctx.now + Math.max(1, Math.round((strike.patrol?.hours ?? 0) * hourMs(h)));
  schedulePatrolTick(h, strike);
}

/** Путь патруля: часы и круг эскадры, откуда она взлетит, куда встанет и сколько лететь. */
type PatrolRoute = {
  plan: { hours: number; radius: number };
  from: { x: number; y: number };
  to: { x: number; y: number };
  flight: number;
};

/**
 * Встанет ли эскадра в патруль в точке `to` — путь, или код отказа. Одна проверка на
 * приказ, на удержание (SHU-6.6) и на новую точку в воздухе (SHU-6.13): своя копия у
 * удержания разъехалась бы с приказом, и эскадра вставала бы сама туда, куда игрок её не
 * пустил бы. `from` — позиция базы: радиус меряется от неё, а не от эскадры. `to` —
 * `null`, если точки в приказе нет.
 */
export function patrolCheck(
  h: HandlerContext,
  from: { x: number; y: number } | null,
  squad: Flyer,
  to: { x: number; y: number } | null,
): PatrolRoute | string {
  // Время и круг — по слабому звену; ноль хоть у одной машины — патрулировать нечем
  // (десантный челнок этих чисел не имеет).
  const plan = squadronPatrol(squad, h.ctx.data);
  if (plan.hours <= 0 || plan.radius <= 0) return 'E_CANNOT_PATROL';
  // Груз в патруль не берут: обратная нога сажает только машины, и боец бы пропал.
  if ((squad.cargo ?? []).some((st) => st.count > 0)) return 'E_HAS_CARGO';
  if (!to) return 'E_BAD_PAYLOAD';
  if (!from) return 'E_NO_PORT';
  const range = squadronReach(squad, h.ctx.data);
  if (range <= 0) return 'E_NO_RANGE';
  if (distance(from, to) > range) return 'E_OUT_OF_RANGE';
  const flight = flightMs(h, squad, from, to);
  if (flight === null) return 'E_NO_SPEED';
  return { plan, from, to, flight };
}

/** Поднять патруль — один взлёт на приказ и на удержание (SHU-6.6). */
export function takeOffPatrol(
  h: HandlerContext,
  owner: string,
  base: BaseView,
  ready: Ready,
  route: PatrolRoute,
  hold: boolean,
): void {
  const strike = launchFlight(h, owner, base, ready, {
    target: { kind: 'point' },
    to: route.to,
    arrivesAt: h.ctx.now + route.flight,
    // Путь к неподвижной точке идёт от места взлёта: с идущего носителя начало
    // отрезка иначе ехало бы вместе с ним (`ShuttleStrike.at`).
    at: { ...route.from },
    patrol: hold ? { ...route.plan, hold: true } : route.plan,
  });
  scheduleFlight(h, strike, strike.arrivesAt, 'shuttle.arrived');
}
