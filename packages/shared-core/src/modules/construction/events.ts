/** Стройка: события завершения и войны. Вынесено из `../construction.ts` (SLIM). */
import type { ModuleSetupApi } from '../../kernel/module';
import type { CompletePayload } from '../../state/construction';
import type { DamageHookArgs } from '../../util/combat';
import { FORTRESS_CORE, stationBerth } from '../../state/fortress';
import type { Fleet, Planet, UnitStack } from '../../state/gameState';
import type { HandlerContext } from '../../kernel/module';
import {
  STRUCTURE_DAMAGE_SHARE,
  atInstanceCap,
  damageBuildings,
  fortificationCovers,
  parkActive,
  startNextAfter,
  startNextQueued,
  suppressed,
  syncIssuedGarrison,
} from './kit';
import { addUnits } from '../../util/stacks';
import { basedLander, basedMachine } from '../../state/shuttle';
import { buildingLevel } from '../../data/schemas';
import { completionModuleSnapshot } from '../../util/arsenalLoadout';
import { coverPoints, worldDamageReduction } from '../../util/worldCover';
import { hoursToMs } from '../../action/types';
import { isBuildLane, orderLane } from '../../state/buildLane';
import { registerControlRecheck } from './controlRecheck';

/** Завершение стройки, подкачка очереди, гибель станции, захват мира. */
export function registerCompletion(api: ModuleSetupApi): void {
  // BLD-1. Освободить полосу и пустить в неё следующего обязан КАЖДЫЙ путь, который
  // израсходовал событие завершения, — включая тихие «не приземлилось» ниже
  // (лимит экземпляров, здание ушло вперёд). Иначе полоса осталась бы занятой
  // навсегда: событие уже снято с таймлайна, а очередь ждёт его вечно. Единственное
  // исключение — отсрочка под бомбардировкой: там стройка НЕ закончилась.
  api.on('construction.complete', (event, h) => {
    const p = event.payload as CompletePayload;
    if (typeof p?.planetId !== 'string' || typeof p?.playerId !== 'string') {
      return; // malformed → no-op (fail-secure)
    }
    const planet = h.state.planets[p.planetId];
    if (!planet || planet.owner !== p.playerId) {
      return; // planet gone or captured mid-build → investment forfeited
    }
    if (suppressed(h, planet.id)) {
      // узел не работает (обстрел или бой) → отложить до лучших времён (scale the
      // retry by timeScale like every other duration, so a fast match isn't stuck)
      h.schedule(h.ctx.now + hoursToMs(h.ctx, 1), 'construction.complete', p);
      return;
    }
    if (p.building === FORTRESS_CORE && planet.fortress?.assembly &&
      planet.fortress.assembly.doneAt > h.ctx.now) {
      h.schedule(planet.fortress.assembly.doneAt, 'construction.complete', p);
      return;
    }
    landCompletion(h, planet, p);
    startNextAfter(h, planet, orderLane(h.ctx.data, p));
  });

  // Повтор попытки для головы, упёршейся в деньги (правило 4). Сам себя не
  // перепланирует: новый повтор назначает только `startNextQueued`, и только если
  // денег снова не хватило, — очередь опустела или голова стартовала, цикл затих.
  api.on('construction.queue.pump', (event, h) => {
    const p = (event.payload ?? {}) as { planetId?: unknown; lane?: unknown };
    if (typeof p.planetId !== 'string') return;
    const planet = h.state.planets[p.planetId];
    if (!planet) return;
    if (p.lane === 'units') startNextAfter(h, planet, 'ships');
    else startNextQueued(h, planet, p.lane === 'infantry' || p.lane === 'vehicles' ? 'mobilization' : isBuildLane(p.lane) ? p.lane : 'buildings');
  });

  /**
   * ГИБЕЛЬ КРЕПОСТИ СНОСИТ ВСЁ, ЧТО НА НЕЙ СТОЯЛО (FORT-5.13, решение владельца 22).
   *
   * Станция объявляет событие, а сносит ЭТОТ модуль — потому что здания его дом, и
   * вместе с ними здесь живут три вещи, которые прямое обнуление массива оставило бы
   * сиротами, каждая со своим видимым последствием:
   *
   *   · ВЫДАННЫЙ ФОРТОМ ГАРНИЗОН. `syncIssuedGarrison` ходит только путями стройки, и
   *     без него бойцы пережили бы породивший их форт. `captureOnArrival` увидел бы
   *     живой гарнизон и отказал в том самом «голом месте», ради которого решение 22
   *     и принималось.
   *   · ОЧЕРЕДЬ И ПРИОСТАНОВЛЕННЫЕ СТРОЙКИ. Ждущие заказы не оплачены, но остались бы
   *     планами на узле, которого больше нет.
   *   · ОПЛАЧЕННЫЕ ЗАВЕРШЕНИЯ В ТАЙМЛАЙНЕ. Вот это хуже всего: `landCompletion`
   *     вернувшийся вид узла НЕ перепроверяет, так что радар или верфь выросли бы на
   *     туманности уже ПОСЛЕ гибели крепости. Владельца гибель намеренно не меняет
   *     (узел стал своим захватом), поэтому проверка владельца в `construction.complete`
   *     такое завершение пропустила бы.
   *
   * Снос идёт теми же событиями `building.destroyed`, что и обстрел: журнал клиента и
   * сводка возвращения их уже понимают, и заводить рядом второе имя для того же факта
   * значило бы учить клиента одному и тому же дважды.
   */
  api.on('station.destroyed', (event, h) => {
    const p = (event.payload ?? {}) as { planetId?: unknown; owner?: unknown };
    if (typeof p.planetId !== 'string') return;
    const planet = h.state.planets[p.planetId];
    if (!planet) return;
    const owner = typeof p.owner === 'string' ? p.owner : planet.owner;
    for (const b of planet.buildings) {
      h.emit('building.destroyed', { planetId: planet.id, building: b.type, owner });
    }
    planet.buildings = [];
    syncIssuedGarrison(h, planet);
    delete planet.buildQueue;
    delete planet.pausedConstruction;
    h.state.scheduled = h.state.scheduled.filter(
      (e) =>
        e.type !== 'construction.complete' ||
        (e.payload as CompletePayload | undefined)?.planetId !== planet.id,
    );
  });

  registerControlRecheck(api, parkActive);

  // Захват стирает очередь прежнего хозяина (правило 6). Терять нечего — ждущие
  // заказы не оплачены; а оставить их значило бы показать новому владельцу планы
  // старого и однажды списать деньги с игрока за чужой мир.
  api.on('planet.captured', (event, h) => {
    const p = (event.payload ?? {}) as { planetId?: unknown };
    if (typeof p.planetId !== 'string') return;
    const planet = h.state.planets[p.planetId];
    if (planet?.buildQueue) delete planet.buildQueue;
  });

  function landCompletion(h: HandlerContext, planet: Planet, p: CompletePayload): void {
    if (p.kind === 'building' && typeof p.building === 'string') {
      // Same instance cap as the order gate, read from the same data field. This is
      // the LAST barrier (a duplicate/replayed completion must not double-build), so
      // it has to move with `maxPerPlanet` too: leaving `some(...)` here would accept
      // the order for a second instance, take the payment, then silently drop the
      // result. With the default cap of 1 this is bit-identical to the old check.
      if (atInstanceCap(h, planet, p.building)) {
        return; // cap reached (e.g. a duplicate queued order) → no-op
      }
      const def = h.ctx.data.buildings[p.building];
      const hp = def ? buildingLevel(def, 1).hp : 0;
      const uid = `b:${planet.id}:${p.building}:${h.ctx.now}:${p.seq ?? 0}`;
      planet.buildings.push({ uid, type: p.building, level: 1, hp });
      syncIssuedGarrison(h, planet);
      h.emit('building.constructed', {
        planetId: planet.id,
        building: p.building,
        owner: p.playerId,
      });
    } else if (
      p.kind === 'upgrade' &&
      typeof p.building === 'string' &&
      typeof p.level === 'number'
    ) {
      const instance = p.uid
        ? planet.buildings.find((b) => b.uid === p.uid)
        : planet.buildings.find((b) => b.type === p.building);
      const def = h.ctx.data.buildings[p.building];
      if (!instance || !def || instance.level !== p.level - 1) {
        return; // building gone or already changed → drop
      }
      const wounds = Math.max(0, buildingLevel(def, instance.level).hp - instance.hp);
      instance.level = p.level;
      instance.hp = Math.max(0, buildingLevel(def, p.level).hp - wounds);
      syncIssuedGarrison(h, planet);
      h.emit('building.upgraded', {
        planetId: planet.id,
        building: p.building,
        level: p.level,
        owner: p.playerId,
      });
    } else if (p.kind === 'unit' && typeof p.unit === 'string' && typeof p.count === 'number') {
      // Челнок сдают В ПОРТ (SHU-1.1) — он не гарнизон (не держит мир, не гибнет в
      // наземном штурме) и не флот (`autoRally` его не поднимает).
      const built = h.ctx.data.units[p.unit];
      const { stars, rarity } = completionModuleSnapshot(p, h.state.players[p.playerId ?? '']?.arsenal);
      let fleet: Fleet | undefined;
      if (built?.traits.includes('shuttle')) {
        // Готовая машина встаёт в ЭСКАДРУ (SHU-4.2), а не россыпью. Правило живёт в
        // `state/shuttle.ts` — там же, где вся арифметика ангара: своя копия здесь
        // разъехалась бы с посадкой вернувшегося вылета. Импортировать его из
        // модуля челноков нельзя вовсе — модули общаются только через шину.
        const seq = (h.state.squadronSeq ?? 0) + 1;
        h.state.squadronSeq = seq;
        // Десантный челнок встаёт В СВОЮ эскадру вместе с бойцом (SHU-5.2): челнок без
        // бойца — это не челнок, а корпус без смысла, поэтому заказ без `troop` сюда
        // не доходит (отбит на приказе).
        if (built.traits.includes('lander') && typeof p.troop === 'string') {
          planet.hangar = basedLander(
            planet.hangar ?? [],
            p.unit,
            p.count,
            p.troop,
            `sq:${p.playerId}:${seq}`,
          );
        } else
          planet.hangar = basedMachine(
            planet.hangar ?? [],
            p.unit,
            p.count,
            `sq:${p.playerId}:${seq}`,
            p.modules,
            stars,
            rarity,
          );
      } else if (planet.fortress && built?.domain === 'space') {
        const sequence = (h.state.fleetSeq ?? 0) + 1;
        h.state.fleetSeq = sequence;
        const id = `fleet:${p.playerId}:${h.ctx.now}:${sequence}`;
        const units: UnitStack[] = [];
        addUnits(units, p.unit, p.count, p.modules, stars, rarity);
        fleet = { id, owner: p.playerId!, ...stationBerth(h.state, planet),
          movement: null, units, traits: [], battleId: null };
        h.state.fleets[id] = fleet;
      } else {
        addUnits(planet.garrison, p.unit, p.count, p.modules, stars, rarity);
      }
      h.emit('unit.built', {
        planetId: planet.id,
        unit: p.unit,
        count: p.count,
        owner: p.playerId,
        ...(fleet ? { fleetId: fleet.id } : {}),
        ...(p.modules && p.modules.length > 0 ? { modules: p.modules, moduleSnapshot: { stars, rarity } } : {}),
        ...(typeof p.troop === 'string' ? { troop: p.troop } : {}),
      });
      // Let promotion stamp the fresh stack before arrival can auto-merge its fleet.
      if (fleet?.edge) h.emit('fleet.parked', { fleetId: fleet.id, edge: fleet.edge });
      else if (fleet) h.emit('fleet.arrived', { fleetId: fleet.id, at: fleet.location });
    }
  }
}

/** Прикрытие постройками в бою, износ построек при штурме и обстреле. */
export function registerWarDamage(api: ModuleSetupApi): void {
  // Standing buildings cover the owner and allies against all three ground channels.
  // Space-fleet cover belongs to station, even when hit by aircraft.
  api.hook<number>('combat.mitigation', (pool, args, h) => {
    const a = args as { phase?: string; location?: string; defender?: string; defenderFleet?: string };
    if (a.phase !== 'ground' && a.phase !== 'bombard' && a.phase !== 'shuttle') return pool;
    if (a.phase === 'shuttle' && a.defenderFleet !== undefined) return pool;
    const planet = fortificationCovers(h, a.location, a.defender);
    if (!planet) return pool;
    return pool + coverPoints(worldDamageReduction(planet, h.ctx.data));
  });

  // Compatibility for event-only producers; current combat applies each hit synchronously.
  api.on('combat.round', (event, h) => {
    const p = event.payload as {
      phase?: string;
      location?: string;
      defender?: string;
      dmgToDefender?: number;
      structuresApplied?: boolean;
    };
    if (p.structuresApplied) return;
    if (p.phase !== 'ground' || typeof p.location !== 'string') {
      return; // only the ground assault wears structures (orbital is fleet-vs-fleet)
    }
    if (typeof p.dmgToDefender !== 'number' || p.dmgToDefender <= 0) {
      return;
    }
    const planet = h.state.planets[p.location];
    if (!planet) {
      return;
    }
    damageBuildings(
      h,
      planet,
      p.dmgToDefender * STRUCTURE_DAMAGE_SHARE,
      p.defender ?? planet.owner,
    );
  });

  // Orbital bombardment wears structures the same way (combat measures the
  // firepower; the buildings module applies it — GDD §7.4). Обстрел с орбиты приходит
  // уже срезанным прикрытием мира и говорит, каким (`hit` + `factor`), — по ходу сноса
  // остаток пересчитывается (см. `damageBuildings`). Удар челноков такой оговорки не
  // несёт: прикрытие мира его не срезает, и ложится он как есть.
  api.on('planet.bombarded', (event, h) => {
    const p = event.payload as {
      planetId?: string;
      power?: number;
      owner?: string | null;
      hit?: DamageHookArgs;
      factor?: number;
      structuresApplied?: boolean;
    };
    if (p.structuresApplied) return;
    if (typeof p.planetId !== 'string' || typeof p.power !== 'number' || p.power <= 0) {
      return;
    }
    const planet = h.state.planets[p.planetId];
    if (!planet) {
      return;
    }
    const covered =
      typeof p.hit === 'object' && p.hit !== null && typeof p.factor === 'number' && p.factor > 0
        ? { hit: p.hit, factor: p.factor }
        : undefined;
    damageBuildings(h, planet, p.power, p.owner ?? planet.owner, covered);
  });
}
