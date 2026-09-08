/**
 * ЧЕЛНОКИ (shuttles-roadmap, заказ владельца 2026-09-08) — второй класс космических
 * юнитов, устроенный не как корабли.
 *
 * Корабль ходит по линиям между узлами и при столкновении дерётся обычным боем. Челнок
 * не ходит вовсе: он стоит В КОСМОПОРТЕ (`planet.hangar`, SHU-1.1), на карте его нет, а
 * бьёт он НАПРЯМУЮ от своего узла до цели, мимо графа линий, — и сразу возвращается в
 * тот же порт (SHU-1.2).
 *
 * Три вещи, которые из этого следуют и которые легко потерять при правке:
 *
 * 1. **Удар односторонний.** Цель получает урон, но боя не начинается: ни `battleId`, ни
 *    ответного огня. Та же семантика, что у артиллерийского standoff (`artillery.ts`) —
 *    контрмера не «отстреляться в ответ», а сбить челноки на подлёте (ПВО, SHU-1.3).
 * 2. **Полёт живёт в состоянии** (`state.strikes`), а не считается мгновенно. Мгновенный
 *    удар не оставил бы против себя никакой защиты и обнулил бы точечную оборону.
 * 3. **Порт — и дом, и условие.** Вылет невозможен без живого порта (повреждён больше
 *    чем на 30% — не выпускает), возврат идёт в него же, а не стало порта — челноки
 *    гибнут вместе с ним. Топливо и перезарядка тоже принадлежат порту.
 *
 * Здесь же живёт точечная оборона (`pointDefense`) — единственная контрмера челнокам.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { Fleet, GameState, Planet, ShuttleStrike, UnitStack } from '../state/gameState';
import type { GameData } from '../data/schemas';
import { distance } from '../state/route';
import {
  canSortie,
  freshSortie,
  shuttleBayAt,
  spendSortie,
  tickRearm,
  trimHangar,
} from '../state/shuttle';
import { applyDamageToSide, removeIfWiped } from '../util/combat';
import { addUnits, cappedUnitStat, sumUnitStat } from '../util/stacks';
import { buildingLevel } from '../data/schemas';
import { timeScaleOf } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

/** Total point-defense (anti-shuttle/anti-missile) firepower of a fleet —
 *  Σ the `pointDefense` stat of its live units (via effectiveStats, so modules
 *  are included). 0 = no point defense. */
function fleetPointDefense(fleet: Fleet, data: GameData): number {
  return sumUnitStat(fleet.units, data, 'pointDefense');
}

/** Default PD engagement range (map units) when the unit's `pointDefenseRange` is 0. */
const PD_RANGE = 120;
/** PD cooldown after a volley (game-minutes). Reducible by module upgrades + tech. */
const PD_COOLDOWN_MINUTES = 20;

/** PD range for a fleet — from its units' `pointDefenseRange` stat, or the default. */
function fleetPDRange(fleet: Fleet, data: GameData): number {
  let r = 0;
  for (const s of fleet.units) {
    if (s.count <= 0) continue;
    const def = data.units[s.unit];
    if (def) r = Math.max(r, (def.stats as Record<string, number>).pointDefenseRange ?? 0);
  }
  return r > 0 ? r : PD_RANGE;
}

/** Get the current world position of a fleet (freePosition, location, or edge). */
function fleetWorldPos(fleet: Fleet, state: GameState): { x: number; y: number } | null {
  if (fleet.freePosition) return fleet.freePosition;
  if (fleet.location) return state.planets[fleet.location]?.position ?? null;
  if (fleet.edge) {
    const a = state.planets[fleet.edge.from]?.position;
    const b = state.planets[fleet.edge.to]?.position;
    if (!a || !b) return null;
    return { x: a.x + (b.x - a.x) * fleet.edge.t, y: a.y + (b.y - a.y) * fleet.edge.t };
  }
  return null;
}

/** Где сейчас летящий удар: линейная интерполяция между портом и точкой удара по доле
 *  пройденного времени. Позиции у челнока нет в состоянии намеренно — она ВЫВОДИТСЯ,
 *  как позиция флота на лейне: хранимая копия разъехалась бы с расписанием. */
function strikePosition(
  strike: ShuttleStrike,
  state: GameState,
  now: number,
): { x: number; y: number } | null {
  const port = state.planets[strike.from]?.position ?? null;
  if (!port) return null;
  const [a, b] = strike.leg === 'out' ? [port, strike.to] : [strike.to, port];
  const span = strike.arrivesAt - strike.departedAt;
  const t = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - strike.departedAt) / span));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Убрать `amount` машин из вылета (сбитые ПВО), с хвоста. Пустой вылет исчезает. */
function shootDownStrike(strike: ShuttleStrike, amount: number): number {
  let left = Math.floor(amount);
  let downed = 0;
  for (let i = strike.units.length - 1; i >= 0 && left > 0; i--) {
    const st = strike.units[i]!;
    const hit = Math.min(st.count, left);
    st.count -= hit;
    left -= hit;
    downed += hit;
  }
  strike.units = strike.units.filter((st) => st.count > 0);
  return downed;
}

/** Один игровой час в миллисекундах мира — с учётом ускорения времени матча. */
function hourMs(h: HandlerContext): number {
  return MS_PER_HOUR * timeScaleOf(h.ctx);
}

/** Доля, ниже которой порт перестаёт выпускать челноки: повреждён БОЛЕЕ чем на 30%
 *  (резолюция владельца 2026-09-08). Порог на вылет, не на возврат. */
const PORT_LAUNCH_HP = 0.7;

/** Не выпускает ли порт челноки из-за повреждений. Считается по САМОМУ ЦЕЛОМУ порту
 *  мира: два порта — вылет идёт из уцелевшего, а не блокируется разрушенным. */
function portDisabled(planet: Planet, data: GameData): boolean {
  let best = 0;
  for (const b of planet.buildings) {
    const def = data.buildings[b.type];
    if (!def) continue;
    const level = buildingLevel(def, b.level);
    if (level.shuttleBay <= 0 || level.hp <= 0) continue;
    best = Math.max(best, b.hp / level.hp);
  }
  return best < PORT_LAUNCH_HP;
}

/** Топливо и перезарядка порта берутся у ЧЕЛНОКОВ, которые в нём стоят (первый стек —
 *  как `sortieSpec` для флота): счётчик принадлежит порту, а числа — машине. */
function hangarSortieSpec(planet: Planet, data: GameData): { maxFuel: number; rearmRounds: number } {
  const st = (planet.hangar ?? []).find((s) => s.count > 0);
  const stats = st ? data.units[st.unit]?.stats : undefined;
  return {
    maxFuel: Math.max(0, Math.floor(stats?.fuel ?? 0)),
    rearmRounds: Math.max(0, Math.floor(stats?.rearmRounds ?? 0)),
  };
}

/** Радиус удара челнока этого типа. */
function hangarStrikeRange(planet: Planet, data: GameData, unit: string): number {
  void planet;
  return data.units[unit]?.stats.strikeRange ?? 0;
}

/** Снять `count` челноков `unit` из ангара. */
function takeFromHangar(hangar: readonly UnitStack[], unit: string, count: number): UnitStack[] {
  let left = count;
  const out: UnitStack[] = [];
  for (const st of hangar) {
    if (st.unit !== unit || left <= 0) {
      out.push({ ...st });
      continue;
    }
    const take = Math.min(st.count, left);
    left -= take;
    if (st.count - take > 0) out.push({ ...st, count: st.count - take });
  }
  return out;
}

/** Сила вылета — Σ `count × attack` челноков, ограниченная линией боя, ровно как у
 *  артиллерии: количество бьёт, но не бесконечно. */
function strikePower(strike: ShuttleStrike, data: GameData): number {
  return cappedUnitStat(strike.units, data, 'attack');
}

/** Скорость вылета — самая медленная машина в нём. */
function strikeSpeed(strike: ShuttleStrike, data: GameData): number {
  let slowest = Infinity;
  for (const st of strike.units) {
    if (st.count <= 0) continue;
    slowest = Math.min(slowest, data.units[st.unit]?.stats.speed ?? 0);
  }
  return Number.isFinite(slowest) ? slowest : 0;
}

export const shuttleModule: GameModule = {
  id: 'shuttle',
  version: '1.0.0',
  setup(api) {
    /**
     * `shuttle.strike { planetId, unit, count, targetFleetId | targetPlanetId }` —
     * вылет из порта. Челноки покидают ангар, летят по прямой к точке, снятой в момент
     * вылета, и после удара разворачиваются домой.
     *
     * Цель фиксируется КООРДИНАТОЙ, а не ссылкой: «навёлся и пустил». Цель может уйти —
     * челноки всё равно летят туда, куда их послали, и по прибытии бьют того, кто там
     * оказался. Иначе удар был бы самонаводящимся, а уклонение — невозможным.
     */
    api.onAction('shuttle.strike', (action, h: HandlerContext) => {
      const p = action.payload as {
        planetId?: string;
        unit?: string;
        count?: number;
        targetFleetId?: string;
        targetPlanetId?: string;
      };
      if (typeof p?.planetId !== 'string' || typeof p?.unit !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const count = p.count ?? 1;
      if (!Number.isSafeInteger(count) || count <= 0) return h.reject('E_BAD_PAYLOAD');
      const port = h.state.planets[p.planetId];
      if (!port) return h.reject('E_NO_PLANET');
      if (port.owner !== action.playerId) return h.reject('E_FORBIDDEN');

      // Порт: есть, цел и с топливом. Порог повреждения — на ВЫЛЕТ (правило владельца);
      // возврату он не мешает, иначе челнок повис бы в пустоте.
      if (shuttleBayAt(port, h.ctx.data) <= 0) return h.reject('E_NO_PORT');
      if (portDisabled(port, h.ctx.data)) return h.reject('E_PORT_DAMAGED');

      const have = (port.hangar ?? [])
        .filter((st) => st.unit === p.unit)
        .reduce((n, st) => n + st.count, 0);
      if (have < count) return h.reject('E_NOT_ENOUGH');

      const spec = hangarSortieSpec(port, h.ctx.data);
      const sortie = port.sortie ?? freshSortie(spec.maxFuel);
      if (!canSortie(sortie)) return h.reject('E_NO_FUEL');

      // Цель: чужой флот или чужой мир. Ровно одна из двух — payload-схема этого не
      // выражает, поэтому проверяем здесь (fail-secure: обе или ни одной → отказ).
      const wantFleet = typeof p.targetFleetId === 'string';
      const wantPlanet = typeof p.targetPlanetId === 'string';
      if (wantFleet === wantPlanet) return h.reject('E_BAD_PAYLOAD');
      const targetFleet = wantFleet ? h.state.fleets[p.targetFleetId!] : undefined;
      const targetPlanet = wantPlanet ? h.state.planets[p.targetPlanetId!] : undefined;
      if (wantFleet && !targetFleet) return h.reject('E_NO_TARGET');
      if (wantPlanet && !targetPlanet) return h.reject('E_NO_PLANET');
      const targetOwner = targetFleet?.owner ?? targetPlanet?.owner ?? null;
      if (targetOwner === action.playerId) return h.reject('E_NOT_HOSTILE');

      const from = port.position;
      const to = targetFleet
        ? (fleetWorldPos(targetFleet, h.state) ?? null)
        : (targetPlanet?.position ?? null);
      if (!to) return h.reject('E_NO_TARGET_POSITION');

      // Радиус считается ОТ УЗЛА БАЗИРОВАНИЯ: своей позиции у челнока в порту нет.
      const range = hangarStrikeRange(port, h.ctx.data, p.unit);
      if (range <= 0) return h.reject('E_NO_RANGE');
      if (distance(from, to) > range) return h.reject('E_OUT_OF_RANGE');

      const speed = h.ctx.data.units[p.unit]?.stats.speed ?? 0;
      if (speed <= 0) return h.reject('E_NO_SPEED');
      const flightMs = Math.max(1, Math.round((distance(from, to) / speed) * hourMs(h)));

      // Челноки покидают ангар — с этой секунды их в порту нет.
      port.hangar = takeFromHangar(port.hangar ?? [], p.unit, count);
      port.sortie = spendSortie(sortie, spec.rearmRounds);
      const seq = (h.state.strikeSeq ?? 0) + 1;
      h.state.strikeSeq = seq;
      const strike: ShuttleStrike = {
        id: `strike:${action.playerId}:${h.ctx.now}:${seq}`,
        owner: action.playerId,
        from: port.id,
        units: [{ unit: p.unit, count }],
        target: targetFleet
          ? { kind: 'fleet', id: targetFleet.id }
          : { kind: 'planet', id: targetPlanet!.id },
        to,
        departedAt: h.ctx.now,
        arrivesAt: h.ctx.now + flightMs,
        leg: 'out',
      };
      h.state.strikes = [...(h.state.strikes ?? []), strike];
      h.schedule(strike.arrivesAt, 'shuttle.arrived', { strikeId: strike.id });
      h.emit('shuttle.launched', {
        strikeId: strike.id,
        owner: action.playerId,
        from: port.id,
        count,
      });
    });

    /**
     * Прибытие. Нога `out` — удар и разворот, нога `back` — посадка в свой порт.
     *
     * Удар наносится ОДНОСТОРОННЕ: флоту — через тот же хук `combat.damage`, что и
     * любой другой канал огня (CORE-DMG-1, `phase: 'shuttle'`), миру — событием
     * `planet.bombarded`, которое модуль построек уже умеет превращать в урон зданиям.
     * Ни бой, ни ответный огонь не начинаются.
     */
    api.on('shuttle.arrived', (event, h: HandlerContext) => {
      const { strikeId } = event.payload as { strikeId?: string };
      if (typeof strikeId !== 'string') return;
      const strikes = h.state.strikes ?? [];
      const strike = strikes.find((s) => s.id === strikeId);
      if (!strike) return; // сбит по дороге / удалён — dead letter, таймлайн не застревает

      if (strike.leg === 'out') {
        const power = strikePower(strike, h.ctx.data);
        if (power > 0) {
          if (strike.target.kind === 'fleet') {
            const target = h.state.fleets[strike.target.id];
            // Цель ушла с точки удара — челноки бьют пустоту и возвращаются ни с чем.
            if (target && target.owner !== strike.owner) {
              const dealt = h.hook<number>('combat.damage', power, {
                phase: 'shuttle',
                location: target.location ?? '',
                attacker: strike.owner,
                defender: target.owner,
              });
              h.emit('shuttle.hit', {
                strikeId,
                owner: strike.owner,
                targetId: target.id,
                targetOwner: target.owner,
                damage: dealt,
              });
              applyDamageToSide(h, { kind: 'fleet', fleetId: target.id }, dealt, h.ctx.data, '');
              removeIfWiped(h, target.id);
            }
          } else {
            const target = h.state.planets[strike.target.id];
            if (target && target.owner !== strike.owner) {
              const dealt = h.hook<number>('combat.damage', power, {
                phase: 'shuttle',
                location: target.id,
                attacker: strike.owner,
                defender: target.owner ?? '',
              });
              h.emit('shuttle.hit', {
                strikeId,
                owner: strike.owner,
                targetId: target.id,
                targetOwner: target.owner,
                damage: dealt,
              });
              h.emit('planet.bombarded', {
                planetId: target.id,
                power: dealt,
                owner: target.owner,
              });
            }
          }
        }
        // Разворот домой — тем же путём и с той же скоростью.
        const port = h.state.planets[strike.from];
        const back = port ? distance(strike.to, port.position) : 0;
        const speed = strikeSpeed(strike, h.ctx.data);
        const flightMs = speed > 0 ? Math.max(1, Math.round((back / speed) * hourMs(h))) : 1;
        strike.leg = 'back';
        strike.departedAt = h.ctx.now;
        strike.arrivesAt = h.ctx.now + flightMs;
        h.schedule(strike.arrivesAt, 'shuttle.arrived', { strikeId });
        return;
      }

      // Посадка. Порт мог погибнуть, пока челноки летели, — тогда садиться некуда.
      h.state.strikes = strikes.filter((s) => s.id !== strikeId);
      const port = h.state.planets[strike.from];
      const bay = port && port.owner === strike.owner ? shuttleBayAt(port, h.ctx.data) : 0;
      if (!port || bay <= 0) {
        h.emit('shuttle.lost', {
          planetId: strike.from,
          owner: strike.owner,
          count: strike.units.reduce((n, st) => n + st.count, 0),
        });
        return;
      }
      const hangar = [...(port.hangar ?? [])];
      for (const st of strike.units) addUnits(hangar, st.unit, st.count, st.modules);
      port.hangar = trimHangar(hangar, bay);
      h.emit('shuttle.landed', { planetId: port.id, owner: strike.owner, strikeId });
    });

    /**
     * АНГАР НЕ ПЕРЕЖИВАЕТ СВОЙ ПОРТ (SHU-1.1). Челнок стоит ВНУТРИ космопорта, поэтому
     * снесённый порт забирает его с собой, а упавшая вместимость оставляет ровно
     * столько, сколько теперь помещается.
     *
     * Правило висит на `time.advanced`, а не на событии «здание разрушено», намеренно:
     * порт исчезает НЕСКОЛЬКИМИ путями — бомбардировка, наземный штурм, а вместимость
     * может упасть и от смены уровня. Реакция на одно событие закрыла бы один путь и
     * оставила остальные, и в состоянии остались бы челноки, которым негде стоять.
     * Здесь же ловится захват: мир сменил владельца — ангар прежнего хозяина пуст
     * (`planet.captured` ниже снимает его сразу, это лишь страховка того же правила).
     */
    api.on('time.advanced', (_event, h: HandlerContext) => {
      for (const planet of Object.values(h.state.planets)) {
        const hangar = planet.hangar;
        if (!hangar || hangar.length === 0) continue;
        const bay = planet.owner === null ? 0 : shuttleBayAt(planet, h.ctx.data);
        const kept = trimHangar(hangar, bay);
        const lost = hangar.reduce((n, st) => n + st.count, 0) - kept.reduce((n, st) => n + st.count, 0);
        if (lost <= 0) continue;
        planet.hangar = kept;
        h.emit('shuttle.lost', { planetId: planet.id, owner: planet.owner, count: lost });
      }
    });

    /** Мир захвачен — челноки прежнего владельца гибнут вместе с портом, а не достаются
     *  захватчику (резолюция владельца 2026-09-08). Сразу, не дожидаясь тика: между
     *  захватом и следующим `time.advanced` ангар иначе числился бы за новым хозяином. */
    api.on('planet.captured', (event, h: HandlerContext) => {
      const { planetId } = event.payload as { planetId?: string };
      if (typeof planetId !== 'string') return;
      const planet = h.state.planets[planetId];
      const lost = (planet?.hangar ?? []).reduce((n, st) => n + st.count, 0);
      if (!planet || lost <= 0) return;
      planet.hangar = [];
      h.emit('shuttle.lost', { planetId, owner: planet.owner, count: lost });
    });

    /**
     * ТОЧЕЧНАЯ ОБОРОНА — единственная контрмера челнокам (SHU-1.2; полный перехват с
     * подъёмом своих перехватчиков — SHU-1.3). Реактивно, на `time.advanced`: флот с
     * `pointDefense` вне боя и вне перезарядки бьёт по ЧУЖИМ ВЫЛЕТАМ, проходящим в его
     * радиусе, и сбивает их машины. Один залп делится поровну между всеми целями в
     * радиусе, затем 20 игровых минут перезарядки.
     *
     * Раньше здесь целями были «флоты-крылья» — сущность, которой в новой модели нет.
     * Цель сменилась вместе с моделью, механика (радиус, кулдаун, деление залпа) — та же.
     */
    api.on('time.advanced', (_event, h: HandlerContext) => {
      const strikes = h.state.strikes ?? [];
      if (strikes.length === 0) return;
      const data = h.ctx.data;
      const cooldownMs = (PD_COOLDOWN_MINUTES / 60) * hourMs(h);

      for (const fleet of Object.values(h.state.fleets)) {
        const pd = fleetPointDefense(fleet, data);
        if (pd <= 0) continue;
        if (fleet.battleId) continue; // в бою ПВО — часть боя
        if (h.ctx.now < (fleet.pdCooldownUntil ?? 0)) continue;
        const myPos = fleetWorldPos(fleet, h.state);
        if (!myPos) continue;
        const range = fleetPDRange(fleet, data);

        const targets = strikes.filter((st) => {
          if (st.owner === fleet.owner || st.units.length === 0) return false;
          const p = strikePosition(st, h.state, h.ctx.now);
          return !!p && distance(myPos, p) <= range;
        });
        if (targets.length === 0) continue;

        const perTarget = pd / targets.length;
        for (const target of targets) {
          const dealt = h.hook<number>('combat.damage', perTarget, {
            phase: 'pointDefense',
            location: fleet.location ?? '',
            attacker: fleet.owner,
            defender: target.owner,
          });
          // Урон переводится в СБИТЫЕ МАШИНЫ по корпусу челнока: у вылета нет своего
          // пула здоровья — он и не должен его иметь, иначе половина сбитого крыла
          // жила бы «раненой» в состоянии, которого игрок не видит.
          const hull = Math.max(1, data.units[target.units[0]!.unit]?.stats.hp ?? 1);
          target.damage = (target.damage ?? 0) + dealt;
          const downed = shootDownStrike(target, Math.floor(target.damage / hull));
          target.damage -= downed * hull;
          h.emit('pd.fired', {
            fleetId: fleet.id,
            owner: fleet.owner,
            strikeId: target.id,
            targetOwner: target.owner,
            damage: dealt,
            downed,
          });
        }
        fleet.pdCooldownUntil = h.ctx.now + cooldownMs;
      }
      // Вылет, у которого не осталось машин, до цели не долетит.
      h.state.strikes = strikes.filter((st) => st.units.length > 0);
    });

    /** Перезарядка порта идёт ДОМА: час мира — раунд перезарядки (SHU-1.2). */
    api.on('time.advanced', (event, h: HandlerContext) => {
      const { from, to } = event.payload as { from: number; to: number };
      const hours = Math.floor((to - from) / hourMs(h));
      if (hours <= 0) return;
      for (const planet of Object.values(h.state.planets)) {
        const sortie = planet.sortie;
        if (!sortie || sortie.rearming <= 0) continue;
        const spec = hangarSortieSpec(planet, h.ctx.data);
        let next = sortie;
        for (let i = 0; i < hours && next.rearming > 0; i++) next = tickRearm(next, spec.maxFuel);
        planet.sortie = next;
      }
    });

  },
};