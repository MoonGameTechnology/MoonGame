import type { GameModule, HandlerContext } from '../kernel/module';
import type { Fleet, GameState, LoadingClaim } from '../state/gameState';
import type { GameData } from '../data/schemas';
import { hoursToMs } from '../action/types';
import { defHasTrait } from '../data/traits';
import { findHealthyStack, addUnits, sumUnitStat } from '../util/stacks';
import { garrisonUnderAssault, requireOwnedIdleFleet } from '../util/fleet';
import { isAllied } from '../util/combat';
import { hasMapShare } from '../state/diplomacy';

interface TransferPayload {
  fleetId: string;
  unit: string;
  count?: number;
}

/** Total ground-army a fleet's ships can carry (Σ count × cargoCapacity). */
function fleetCapacity(fleet: Fleet, data: GameData): number {
  return sumUnitStat(fleet.units, data, 'cargoCapacity');
}

/** Transport space currently occupied by the fleet's carried ground army. */
function cargoUsed(fleet: Fleet, data: GameData): number {
  return sumUnitStat(fleet.landing ?? [], data, 'cargoSize');
}

/**
 * CARGO-1 — a ground lift takes a game HOUR, and that hour lives HERE.
 *
 * It used to live in the playable prototype's memory (`pendingLoads` in `main.ts`,
 * pumped every frame): the order was held for an hour by the TAB, and closing the
 * tab — or merely reconnecting — destroyed it silently, with no troops and no
 * message. At the default `TIME_SCALE=1` that hour is a REAL hour, in a game whose
 * whole premise is "give orders that take hours, then leave". So the rule moved to
 * the only actor that is always awake: the world itself.
 *
 * The lift is a CLAIM, not custody. The units never leave the garrison while the
 * hour runs, which settles by construction every question the client copy answered
 * with a separate rule:
 *
 *  · **nothing is ever in limbo** — no half-loaded troops to give back if the world
 *    changes hands, because they were never taken;
 *  · **they still defend** the world they are standing on, which is the truth;
 *  · **nobody double-draws them** — a second order sees the claim and subtracts it,
 *    and so does the hold's free space (two orders cannot promise one bay);
 *  · **flying away cancels it** — the lift completes only while the fleet is still
 *    docked where it started, so departure is the player's own cancel button and
 *    costs exactly the hour it was going to cost anyway.
 *
 * ONE hour per ORDER, not per unit — the shipped behaviour of the copy this ports
 * (`makeLoads` gave every record the same deadline, whatever the count).
 */
export const LOAD_HOURS = 1;

/** Units of `unit` at `planetId` already promised to lifts — by ANY fleet docked
 *  there, since one garrison feeds them all. */
function claimedAt(state: GameState, planetId: string, unit: string): number {
  let n = 0;
  for (const fleet of Object.values(state.fleets)) {
    for (const claim of fleet.loading ?? []) {
      if (claim.from === planetId && claim.unit === unit) n += claim.count;
    }
  }
  return n;
}

/** Hold space this fleet's in-progress lifts have already spoken for. */
function claimedCargo(fleet: Fleet, data: GameData): number {
  let n = 0;
  for (const claim of fleet.loading ?? []) {
    n += claim.count * (data.units[claim.unit]?.stats.cargoSize ?? 1);
  }
  return n;
}

/**
 * Army — a base module (docs/modulesystem.md). Fleets (ships) and the planetary
 * ground army (tanks / drop-infantry / militia) are separate: ground units sit
 * in a planet's garrison and only travel as a fleet's cargo. This module moves
 * ground units between a planet's garrison and a fleet docked there, bounded by
 * the fleet's transport `cargoCapacity` — so a fleet must include enough hull
 * (or a dropship) to carry an invasion force. The carried army is the landing
 * force a ground assault uses (GDD §7.4).
 *
 * Fail-secure: every check rejects with a stable code and moves nothing.
 */
export const armyModule: GameModule = {
  id: 'army',
  version: '1.0.0',
  setup(api) {
    /** Validates a load/unload order and resolves the fleet, its planet and the
     *  ground unit def, or rejects. */
    const resolve = (action: { playerId: string; payload: unknown }, h: HandlerContext) => {
      const p = action.payload as Partial<TransferPayload>;
      if (typeof p?.fleetId !== 'string' || typeof p?.unit !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const count = p.count ?? 1;
      if (!Number.isSafeInteger(count) || count <= 0) {
        return h.reject('E_BAD_PAYLOAD');
      }
      const fleet = requireOwnedIdleFleet(h, p.fleetId as string, action.playerId);
      const planet = h.state.planets[fleet.location];
      if (!planet) {
        return h.reject('E_NO_PLANET');
      }
      // Владелец мира здесь НЕ проверяется: у погрузки и высадки правила разные
      // (ALLY-LAND). Каждое действие проверяет своё — см. `army.load` / `army.unload`.
      const def = h.ctx.data.units[p.unit];
      if (!def) {
        return h.reject('E_UNKNOWN_UNIT');
      }
      if (def.domain !== 'ground') {
        return h.reject('E_NOT_GROUND'); // only the ground army is transported as cargo
      }
      return { fleet, planet, def, unit: p.unit, count };
    };

    api.onAction('army.load', (action, h) => {
      const { fleet, planet, def, unit, count } = resolve(action, h);
      // Поднять можно ТОЛЬКО со своего мира. Союзный гарнизон — не твой ресурс:
      // иначе «помощь» превращалась бы в вывоз чужой обороны.
      if (planet.owner !== action.playerId) {
        return h.reject('E_FORBIDDEN');
      }
      if (defHasTrait(def, 'immobile')) {
        return h.reject('E_IMMOBILE'); // fixed emplacements (e.g. orbital AA) can't be lifted
      }
      // No mid-assault evacuation: while a battle holds this garrison, lifting it
      // onto ships would dodge the resolve (defender escapes unbloodied, attacker
      // wins an empty rock).
      if (garrisonUnderAssault(h.state, planet.id)) {
        return h.reject('E_UNDER_ASSAULT');
      }
      const avail = findHealthyStack(planet.garrison, unit);
      // Уже обещанное вычитается ОБА раза: из гарнизона (два флота у одного мира не
      // вычерпают одну роту) и из трюма (два заказа подряд не пообещают один отсек).
      if (!avail || avail.count - claimedAt(h.state, planet.id, unit) < count) {
        return h.reject('E_NO_ARMY'); // not that many in the garrison
      }
      const free =
        fleetCapacity(fleet, h.ctx.data) -
        cargoUsed(fleet, h.ctx.data) -
        claimedCargo(fleet, h.ctx.data);
      if (count * def.stats.cargoSize > free) {
        return h.reject('E_NO_CAPACITY'); // not enough transport space aboard
      }
      // Час не проходит здесь: заказ встаёт в мир и созревает событием таймлайна.
      // Привязка к ЗАПЛАНИРОВАННОМУ событию, а не к «сколько прошло с прошлого тика»,
      // — требование детерминизма: иначе момент погрузки зависел бы от того, каким
      // шагом звали `advanceTo` (сервер тикает секундами, тест — часами).
      const doneAt = h.ctx.now + hoursToMs(h.ctx, LOAD_HOURS);
      const claim: LoadingClaim = { unit, count, from: planet.id, startAt: h.ctx.now, doneAt };
      fleet.loading = fleet.loading ?? [];
      fleet.loading.push(claim);
      h.schedule(doneAt, 'army.load.done', { fleetId: fleet.id });
      h.emit('army.loading', {
        fleetId: fleet.id,
        planetId: planet.id,
        unit,
        count,
        owner: action.playerId,
        doneAt,
      });
    });

    /**
     * Созревшая погрузка. Обрабатываются ВСЕ созревшие заявки флота, а не одна: срок
     * у заявок может совпасть, и тогда лишние срабатывания просто не найдут работы —
     * это дешевле и надёжнее, чем адресовать заявку идентификатором.
     *
     * Условия проверяются ЗАНОВО, теми же, что и на заказе: за час мир мог перейти к
     * другому, гарнизон — поредеть, флот — уйти или ввязаться в бой. Не сошлось —
     * заявка просто снимается: терять нечего, войска всё это время стояли в гарнизоне.
     */
    api.on('army.load.done', (event, h) => {
      const p = event.payload as { fleetId?: string };
      if (typeof p?.fleetId !== 'string') return; // malformed → no-op (fail-secure)
      const fleet = h.state.fleets[p.fleetId];
      if (!fleet?.loading?.length) return;
      const keep: LoadingClaim[] = [];
      for (const claim of fleet.loading) {
        if (claim.doneAt > h.ctx.now) {
          keep.push(claim); // ещё не срок — это чужое срабатывание
          continue;
        }
        const planet = h.state.planets[claim.from];
        const docked = fleet.location === claim.from && !fleet.movement && !fleet.battleId;
        if (!planet || !docked || planet.owner !== fleet.owner) continue;
        if (garrisonUnderAssault(h.state, planet.id)) continue;
        const def = h.ctx.data.units[claim.unit];
        const stack = findHealthyStack(planet.garrison, claim.unit);
        if (!def || !stack) continue;
        // Берём, сколько ЕСТЬ и сколько влезает: за час гарнизон мог поредеть в бою,
        // а трюм — заполниться соседней заявкой. Частичная погрузка честнее отказа:
        // приказ был «подними столько», и он поднимает столько, сколько осталось.
        const room = fleetCapacity(fleet, h.ctx.data) - cargoUsed(fleet, h.ctx.data);
        const size = def.stats.cargoSize;
        const take = Math.min(claim.count, stack.count, size > 0 ? Math.floor(room / size) : claim.count);
        if (take <= 0) continue;
        stack.count -= take;
        planet.garrison = planet.garrison.filter((s) => s.count > 0);
        fleet.landing = fleet.landing ?? [];
        addUnits(fleet.landing, claim.unit, take);
        h.emit('army.loaded', {
          fleetId: fleet.id,
          planetId: planet.id,
          unit: claim.unit,
          count: take,
          owner: fleet.owner,
        });
      }
      if (keep.length) fleet.loading = keep;
      else delete fleet.loading;
    });

    /** Ушёл — значит отменил (правило 5 клиентской копии, теперь правило мира).
     *  Снимается СРАЗУ, а не по сроку: иначе бронь держала бы чужой гарнизон ещё час
     *  после того, как носитель за ним уже не придёт. */
    api.on('fleet.departed', (event, h) => {
      const p = event.payload as { fleetId?: string };
      if (typeof p?.fleetId !== 'string') return;
      const fleet = h.state.fleets[p.fleetId];
      if (fleet?.loading?.length) delete fleet.loading;
    });

    api.onAction('army.unload', (action, h) => {
      const { fleet, planet, unit, count } = resolve(action, h);
      // ALLY-LAND. Высадиться можно на свой мир, на мир СОЮЗНИКА (коалиция) и на мир
      // того, с кем заключён ОБМЕН КАРТАМИ (MAPSHARE-1) — оба права даны по взаимному
      // согласию, поэтому пускать чужие войска на свою землю никого не заставляют.
      // Мир, с чьим владельцем всего лишь мир/пакт без договора, по-прежнему закрыт.
      const host = planet.owner;
      const guest =
        host !== null &&
        (isAllied(h, action.playerId, host) || hasMapShare(h.state, action.playerId, host));
      if (host !== action.playerId && !guest) {
        return h.reject('E_FORBIDDEN');
      }
      // Высадка в ИДУЩИЙ наземный бой намеренно НЕ запрещена — в отличие от погрузки.
      // Погрузку запрещает уклонение от размена (защитник уплыл бы небитым), а высадка
      // — это подкрепление, ровно тот сценарий, ради которого союзная высадка и нужна.
      // Механически это корректно: ссылка защитника (`kind: 'garrison'`) адресует мир,
      // а не снимок стеков, поэтому подошедшие войска считаются со следующего раунда.
      const carried = findHealthyStack(fleet.landing ?? [], unit);
      if (!carried || carried.count < count) {
        return h.reject('E_NO_ARMY'); // not that many aboard
      }
      carried.count -= count;
      fleet.landing = (fleet.landing ?? []).filter((s) => s.count > 0);
      addUnits(planet.garrison, unit, count);
      h.emit('army.unloaded', {
        fleetId: fleet.id,
        planetId: planet.id,
        unit,
        count,
        owner: action.playerId,
      });
    });
  },
};
