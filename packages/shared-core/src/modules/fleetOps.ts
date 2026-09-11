/**
 * Fleet formation — `fleet.launch` (scramble a planet's garrison into a mobile
 * fleet), `fleet.merge` (fuse two co-located idle fleets), `fleet.split` (peel
 * a chosen set of ships off a fleet into a fresh one), and `fleet.engage`
 * (deliberately open fire on a co-located hostile fleet — arrival already
 * auto-resolves a collision via combatModule's own `fleet.arrived` handling;
 * this is the player-issued path for two fleets that are ALREADY sharing a
 * node without having fought, e.g. one arrived in peacetime and war was
 * declared after). The core already builds ships into a planet's garrison
 * (constructionModule) and lets a fleet carry ground troops as cargo
 * (armyModule), but nothing moved a built ship OUT of the garrison — this
 * module closes that gap, the one missing link between "built" and
 * "playable". Was a port of the prototype's proven `fleetLaunchModule`
 * (REFP-10); since CONV-8 that copy is gone and this is the only implementation —
 * the prototype loads this module. Auto-rally (`unit.built` → a built ship joins
 * the world's RALLY fleet, BF-29) stayed behind at CONV-8 because it was a gap in
 * the canon rather than a duplicate; CONV-10 brought it in as its own module
 * (`autoRally.ts`), so a ship now reaches orbit either way. Adapted for the
 * multiplayer server: fleet
 * lookups from untrusted payload use `ownFleet` (own-key, A06/A08 — a poisoned
 * id like `__proto__` reads as no-fleet); `fleet.engage`'s battle creation is
 * self-contained here rather than reusing `combat.ts`'s private `startBattle`
 * (modules don't import each other — invariant #3); the prototype's
 * division-carrier re-pointing on merge is dropped — the canonical core has
 * no division/army-carrier concept (that's prototype-only state,
 * `docs/backlog.md` REFP-13). Hero re-pointing on merge IS kept: heroes are
 * core state (`state.heroes`, `heroModule`).
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { Battle, Fleet, UnitStack } from '../state/gameState';
import { hoursToMs } from '../action/types';
import { defHasTrait } from '../data/traits';
import { heroByFleet } from '../state/heroes';
import { isHostile, ownFleet } from '../util/combat';
import { garrisonUnderAssault, nextFleetSeq } from '../util/fleet';
import { sumUnitStat, takeFromStacks, mergeStacks, loadoutKey } from '../util/stacks';

export const fleetOpsModule: GameModule = {
  id: 'fleet-ops',
  version: '1.1.0',
  setup(api) {
    // Scramble a planet's garrison into a mobile fleet: ships → fleet.units,
    // liftable ground troops → fleet.landing (bounded by the ships' summed
    // cargoCapacity, the same bound army.load enforces). Immobile emplacements
    // (e.g. orbital AA) can't be lifted — they stay in the garrison.
    api.onAction('fleet.launch', (action, h) => {
      const payload = action.payload as { planetId?: string };
      if (typeof payload?.planetId !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const planet = h.state.planets[payload.planetId];
      if (!planet) {
        return h.reject('E_NO_PLANET');
      }
      if (planet.owner !== action.playerId) {
        return h.reject('E_FORBIDDEN');
      }
      if (planet.garrison.length === 0) {
        return h.reject('E_EMPTY_GARRISON');
      }
      // No mid-assault evacuation: while a battle holds this garrison, scrambling
      // it onto ships would dodge the resolve — same lock as army.load.
      if (garrisonUnderAssault(h.state, planet.id)) {
        return h.reject('E_UNDER_ASSAULT');
      }
      const units = planet.garrison.filter(
        (s) => h.ctx.data.units[s.unit]?.domain !== 'ground',
      );
      const liftable = planet.garrison.filter(
        (s) =>
          h.ctx.data.units[s.unit]?.domain === 'ground' &&
          !defHasTrait(h.ctx.data.units[s.unit], 'immobile'),
      );
      if (units.length === 0) {
        return h.reject('E_NO_SHIPS'); // need at least one ship to form a fleet
      }
      let free = sumUnitStat(units, h.ctx.data, 'cargoCapacity');
      const landing: UnitStack[] = [];
      const stayBehind: UnitStack[] = [];
      for (const s of liftable) {
        const size = h.ctx.data.units[s.unit]?.stats.cargoSize ?? 1;
        const take = size > 0 ? Math.min(s.count, Math.floor(free / size)) : s.count;
        if (take > 0) {
          landing.push({ unit: s.unit, count: take });
          free -= take * size;
        }
        if (take < s.count) stayBehind.push({ unit: s.unit, count: s.count - take });
      }
      const seq = nextFleetSeq(h.state);
      const id = `fleet:${action.playerId}:${h.ctx.now}:${seq}`;
      h.state.fleets[id] = {
        id,
        owner: action.playerId,
        location: planet.id,
        movement: null,
        units: units.map((s) => ({ ...s })),
        landing,
        traits: [],
        battleId: null,
      };
      planet.garrison = planet.garrison
        .filter((s) => h.ctx.data.units[s.unit]?.traits.includes('immobile'))
        .concat(stayBehind);
      h.emit('fleet.launched', { fleetId: id, planetId: planet.id, owner: action.playerId });
    });

    /**
     * Сплавить `from` в `into`. Общая ЧАСТЬ: одна и та же плавка нужна и приказу
     * игрока, и созревшему намерению (MRG-1), а два исполнения одного правила — это
     * ровно тот баг, из-за которого модуль и заводили.
     */
    const fuse = (h: HandlerContext, fromId: string, intoId: string, owner: string): void => {
      const from = h.state.fleets[fromId];
      const into = h.state.fleets[intoId];
      if (!from || !into) return;
      into.units = mergeStacks(into.units, from.units);
      into.landing = mergeStacks(into.landing ?? [], from.landing ?? []);
      // Heroes are bound by fleetId: the hero UNIT rides into the merged fleet, so
      // the hero ENTITY must follow — a stale fleetId would orphan it (and
      // hero.spawn could then mint a duplicate free flagship).
      for (const hr of Object.values(h.state.heroes ?? {})) {
        if (hr.fleetId === fromId) hr.fleetId = intoId;
      }
      delete h.state.fleets[fromId];
      h.emit('fleet.merged', { from: fromId, into: intoId, owner, at: into.location });
    };

    /** Можно ли сплавить эту пару ПРЯМО СЕЙЧАС (оба стоят, свободны, в одном узле). */
    const fusable = (from: Fleet, into: Fleet): boolean =>
      !from.battleId &&
      !into.battleId &&
      !from.movement &&
      !into.movement &&
      !!from.location &&
      from.location === into.location;

    // Fuse `from` into `into` when both are docked, idle and share a location.
    // Если догоняющий УЖЕ ЛЕТИТ в узел цели — приказ не отбивается, а встаёт
    // НАМЕРЕНИЕМ (`mergeInto`) и созревает на прилёте (MRG-1). Раньше вторую половину
    // такого приказа держал клиент в памяти вкладки и досылал `fleet.merge` покадрово:
    // закрыл вкладку — флот долетал и не сливался, приказ исполнялся наполовину.
    api.onAction('fleet.merge', (action, h) => {
      const payload = action.payload as { from?: string; into?: string };
      if (typeof payload?.from !== 'string' || typeof payload?.into !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      if (payload.from === payload.into) {
        return h.reject('E_SAME_FLEET');
      }
      const from = ownFleet(h.state, payload.from);
      const into = ownFleet(h.state, payload.into);
      if (!from || !into) {
        return h.reject('E_NO_FLEET');
      }
      if (from.owner !== action.playerId || into.owner !== action.playerId) {
        return h.reject('E_FORBIDDEN');
      }
      if (from.battleId || into.battleId) {
        return h.reject('E_IN_BATTLE');
      }
      const flyingTo = from.movement
        ? (from.movement.destination ?? from.movement.to)
        : null;
      const chasing =
        !!flyingTo && !into.movement && !!into.location && into.location === flyingTo;
      if (!fusable(from, into) && !chasing) {
        return h.reject('E_NOT_COLOCATED');
      }
      // Каждый герой ведёт СВОЙ флот (резолюция владельца 2026-09-08, «как в HoMM»):
      // в одном флоте не больше одного героя. Забрать безгеройский флот герою можно —
      // это обычное усиление армии; слить ДВА геройских нельзя.
      //
      // Гейт стоит здесь не для красоты правила. Без него инвариант держался бы только
      // на развёртывании, а `fleet.merge` — рядовое действие, доступное любому игроку, —
      // сводил бы двух героев в один флот, и код ниже честно перенацеливал бы `fleetId`
      // обоим. После этого `heroByFleet` возвращает одного из двух, и смерть флота
      // приписывается не тому герою. С этим гейтом «один герой на флот» верно ПО
      // ПОСТРОЕНИЮ, а не по внимательности вызывающего.
      if (heroByFleet(h.state, payload.from) && heroByFleet(h.state, payload.into)) {
        return h.reject('E_TWO_HEROES');
      }
      if (chasing) {
        // Ещё в пути — приказ ЖДЁТ в мире. Гейты выше (свой, не в бою, не два героя)
        // спрошены уже сейчас: отказ обязан прийти на ЗАКАЗЕ, а не через часы полёта.
        from.mergeInto = into.id;
        h.emit('fleet.merge.pending', {
          from: payload.from,
          into: payload.into,
          owner: action.playerId,
          at: flyingTo,
        });
        return;
      }
      fuse(h, payload.from, payload.into, action.playerId);
    });

    /**
     * Созревшее намерение слияния (MRG-1). Смотрим на ОБЕ стороны прилёта: сойтись
     * могут и потому, что долетел догоняющий, и потому, что вернулась цель.
     *
     * Не сошлось — намерение снимается, а не висит вечно: цель ушла дальше или её уже
     * нет, и «догонять» здесь было бы новым приказом на движение, которого игрок не
     * отдавал. Живой бой намерение НЕ снимает: `fusable` его просто не пропустит, а
     * после боя уцелевшие, скорее всего, всё ещё рядом.
     */
    api.on('fleet.arrived', (event, h) => {
      const p = event.payload as { fleetId?: string };
      if (typeof p?.fleetId !== 'string') return;
      const arrived = h.state.fleets[p.fleetId];
      if (!arrived) return;
      // Пары «кто с кем» — прилетевший со своей целью и все, кто ждал ЭТОГО прилёта.
      const pairs: Array<[string, string]> = [];
      if (typeof arrived.mergeInto === 'string') pairs.push([arrived.id, arrived.mergeInto]);
      for (const id of Object.keys(h.state.fleets).sort()) {
        const f = h.state.fleets[id];
        if (f && f.id !== arrived.id && f.mergeInto === arrived.id) pairs.push([f.id, arrived.id]);
      }
      for (const [fromId, intoId] of pairs) {
        const from = h.state.fleets[fromId];
        const into = h.state.fleets[intoId];
        if (!from) continue;
        if (from.battleId) continue; // бой ПРИОСТАНАВЛИВАЕТ, а не отменяет
        if (!into || into.owner !== from.owner) {
          delete from.mergeInto; // цели больше нет — сливать не с чем
          continue;
        }
        if (into.battleId) continue;
        if (!fusable(from, into)) {
          delete from.mergeInto; // разминулись
          continue;
        }
        if (heroByFleet(h.state, fromId) && heroByFleet(h.state, intoId)) {
          delete from.mergeInto; // «один герой на флот» — правило то же, что на заказе
          continue;
        }
        delete from.mergeInto;
        fuse(h, fromId, intoId, from.owner);
      }
    });

    // Peel a chosen set of ships off a docked, idle fleet into a fresh fleet in
    // the same sector (same orbit). Must keep ≥1 ship behind and move ≥1 out.
    //
    // FSPLIT-1/2 (заказ владельца): раскол адресует СТЕК, а не тип, и делит трюм.
    //   · `take[i].modules` сужает отбор до одного лоадаута — без него «два крейсера»
    //     двусмысленно, как только один корпус летает и фиттованным, и голым, а
    //     `takeFromStacks` брала первый попавшийся стек. Поле необязательное: без него
    //     поведение прежнее (любой лоадаут), и старые вызовы — бот, `shuttleTake` —
    //     работают как работали.
    //   · `takeLanding` уводит часть десанта с новым флотом. Раньше он ВСЕГДА оставался
    //     у исходного, и разделить десант можно было только через планету (выгрузить и
    //     загрузить заново), чего в полёте нет вовсе.
    api.onAction('fleet.split', (action, h) => {
      const payload = action.payload as {
        fleetId?: string;
        take?: Array<{ unit?: string; count?: number; modules?: unknown }>;
        takeLanding?: Array<{ unit?: string; count?: number }>;
      };
      if (typeof payload?.fleetId !== 'string' || !Array.isArray(payload.take)) {
        return h.reject('E_BAD_PAYLOAD');
      }
      if (payload.takeLanding !== undefined && !Array.isArray(payload.takeLanding)) {
        return h.reject('E_BAD_PAYLOAD');
      }
      const fleet = ownFleet(h.state, payload.fleetId);
      if (!fleet) {
        return h.reject('E_NO_FLEET');
      }
      if (fleet.owner !== action.playerId) {
        return h.reject('E_FORBIDDEN');
      }
      if (fleet.battleId) {
        return h.reject('E_IN_BATTLE');
      }
      if (fleet.movement || !fleet.location) {
        return h.reject('E_IN_TRANSIT');
      }
      // Ключ отбора — «юнит + лоадаут»: два стека одного корпуса с разной начинкой
      // адресуются по отдельности, а запись без `modules` берёт по-старому, любой.
      const want = new Map<string, { unit: string; modules?: string[]; count: number }>();
      for (const t of payload.take) {
        if (typeof t?.unit !== 'string' || typeof t?.count !== 'number' || t.count <= 0) {
          return h.reject('E_BAD_PAYLOAD');
        }
        let modules: string[] | undefined;
        if (t.modules !== undefined) {
          if (!Array.isArray(t.modules) || t.modules.some((m) => typeof m !== 'string')) {
            return h.reject('E_BAD_PAYLOAD');
          }
          modules = t.modules as string[];
        }
        // The hero flagship can't be peeled off by a split: the hero ENTITY is
        // bound to the source fleet by fleetId, and moving its UNIT without the
        // entity would orphan the binding.
        if (h.ctx.data.units[t.unit]?.traits.includes('hero')) {
          return h.reject('E_HERO_UNIT');
        }
        const key = `${t.unit}\u0000${modules === undefined ? '*' : loadoutKey(modules)}`;
        const prev = want.get(key);
        const count = (prev?.count ?? 0) + Math.floor(t.count);
        want.set(key, { unit: t.unit, ...(modules ? { modules } : {}), count });
      }
      const have = (unit: string, modules?: readonly string[]) =>
        fleet.units
          .filter(
            (st) =>
              st.unit === unit &&
              (modules === undefined || loadoutKey(st.modules) === loadoutKey(modules)),
          )
          .reduce((a, st) => a + st.count, 0);
      let takeTotal = 0;
      for (const w of want.values()) {
        if (w.count > have(w.unit, w.modules)) return h.reject('E_NOT_ENOUGH');
        takeTotal += w.count;
      }
      const shipsTotal = fleet.units.reduce((a, st) => a + st.count, 0);
      if (takeTotal <= 0) {
        return h.reject('E_SPLIT_EMPTY');
      }
      if (takeTotal >= shipsTotal) {
        return h.reject('E_SPLIT_ALL'); // must leave at least one ship behind
      }
      // Заказ трюма разбирается ДО того, как что-либо сдвинуто: раскол — одно
      // действие, и половинчатый исход (корабли ушли, десант нет) был бы хуже отказа.
      const wantLanding = new Map<string, number>();
      for (const t of payload.takeLanding ?? []) {
        if (typeof t?.unit !== 'string' || typeof t?.count !== 'number' || t.count <= 0) {
          return h.reject('E_BAD_PAYLOAD');
        }
        wantLanding.set(t.unit, (wantLanding.get(t.unit) ?? 0) + Math.floor(t.count));
      }
      const landing = fleet.landing ?? [];
      for (const [unit, n] of wantLanding) {
        const aboard = landing.filter((st) => st.unit === unit).reduce((a, st) => a + st.count, 0);
        if (n > aboard) return h.reject('E_NO_ARMY');
      }
      // Обе половины обязаны увезти свой десант: вместимость даёт КОРПУС, поэтому увод
      // транспортов без войск — такой же перегруз, как заказ войск без транспортов.
      // Считается до мутации, по будущим составам (`army.load` энфорсит ровно это же).
      const cargoOf = (stacks: readonly UnitStack[]) => sumUnitStat(stacks, h.ctx.data, 'cargoSize');
      const capacityOf = (stacks: readonly UnitStack[]) =>
        sumUnitStat(stacks, h.ctx.data, 'cargoCapacity');
      const takenShipsPreview: UnitStack[] = [];
      for (const w of want.values()) {
        takenShipsPreview.push({ unit: w.unit, count: w.count, ...(w.modules ? { modules: w.modules } : {}) });
      }
      const takenLandingPreview: UnitStack[] = [...wantLanding].map(([unit, count]) => ({
        unit,
        count,
      }));
      const keptShipsPreview: UnitStack[] = fleet.units.map((st) => ({ ...st }));
      for (const w of want.values()) {
        let left = w.count;
        for (const st of keptShipsPreview) {
          if (left <= 0) break;
          if (st.unit !== w.unit) continue;
          if (w.modules !== undefined && loadoutKey(st.modules) !== loadoutKey(w.modules)) continue;
          const move = Math.min(st.count, left);
          st.count -= move;
          left -= move;
        }
      }
      const keptLandingPreview: UnitStack[] = landing.map((st) => ({ ...st }));
      for (const [unit, n] of wantLanding) {
        let left = n;
        for (const st of keptLandingPreview) {
          if (left <= 0) break;
          if (st.unit !== unit) continue;
          const move = Math.min(st.count, left);
          st.count -= move;
          left -= move;
        }
      }
      if (cargoOf(takenLandingPreview) > capacityOf(takenShipsPreview)) {
        return h.reject('E_NO_CAPACITY');
      }
      if (cargoOf(keptLandingPreview) > capacityOf(keptShipsPreview)) {
        return h.reject('E_NO_CAPACITY');
      }

      let taken: UnitStack[] = [];
      for (const w of want.values()) {
        taken = taken.concat(takeFromStacks(fleet.units, w.unit, w.count, w.modules));
      }
      fleet.units = fleet.units.filter((st) => st.count > 0);
      let takenLanding: UnitStack[] = [];
      if (wantLanding.size > 0) {
        for (const [unit, n] of wantLanding) {
          takenLanding = takenLanding.concat(takeFromStacks(landing, unit, n));
        }
        fleet.landing = landing.filter((st) => st.count > 0);
      }
      const seq = nextFleetSeq(h.state);
      const id = `fleet:${action.playerId}:${h.ctx.now}:${seq}`;
      // SQ-1.1 (shuttles-roadmap): a split of shuttle-trait ships is a strike
      // WING — it gets `homeBase` (the carrier it launched from), and that is what
      // lets shuttleModule fly it off the lane graph (`shuttle.strike`/`return`).
      // Without it `shuttle.strike` rejects with E_NOT_SHUTTLE and the whole
      // free-flight path is unreachable.
      //
      // ВСЕ отделяемые корабли обязаны быть эскадрильями, а не хотя бы один. Крыло —
      // это ровно shuttle-стеки (`shuttleTake` в `state/shuttle.ts` так его и
      // определяет), и «хотя бы один» позволяло увести крейсер мимо графа линий,
      // подцепив его к отделяемым истребителям: свободный полёт уносит ВЕСЬ флот.
      //
      // Позицию здесь НЕ выставляем намеренно. `shuttle.strike` берёт начало полёта
      // как `freePosition ?? позиция location` — у пристыкованного крыла `location`
      // есть (иначе split отказал бы выше с E_IN_TRANSIT), так что вторая координата
      // не нужна. А выставленная — вредна: она не мутирует при обычном ходе по лейну,
      // и крыло, которое увели `fleet.move`, для всей эскадрильной логики
      // (`fleetWorldPos` предпочитает `freePosition`) навсегда осталось бы у точки
      // вылета — с неверным временем полёта и неверной проверкой радиуса зонального ПВО.
      const isShuttleWing = taken.every((st) =>
        defHasTrait(h.ctx.data.units[st.unit], 'shuttle'),
      );
      h.state.fleets[id] = {
        id,
        owner: action.playerId,
        location: fleet.location,
        movement: null,
        units: taken,
        landing: takenLanding,
        traits: [],
        battleId: null,
        ...(fleet.orbit ? { orbit: fleet.orbit } : {}),
        ...(isShuttleWing ? { homeBase: fleet.id } : {}),
      };
      h.emit('fleet.split', {
        from: payload.fleetId,
        to: id,
        owner: action.playerId,
        at: fleet.location,
      });
    });

    // Deliberately open fire on a co-located hostile fleet.
    api.onAction('fleet.engage', (action, h) => {
      const payload = action.payload as { fleetId?: string; targetId?: string };
      if (typeof payload?.fleetId !== 'string' || typeof payload?.targetId !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      if (payload.fleetId === payload.targetId) {
        return h.reject('E_SAME_FLEET');
      }
      const f = ownFleet(h.state, payload.fleetId);
      const target = ownFleet(h.state, payload.targetId);
      if (!f || !target) {
        return h.reject('E_NO_FLEET');
      }
      if (f.owner !== action.playerId) {
        return h.reject('E_FORBIDDEN');
      }
      if (!isHostile(h, f.owner, target.owner)) {
        return h.reject('E_NOT_HOSTILE');
      }
      if (!f.units.some((s) => s.count > 0) || !target.units.some((s) => s.count > 0)) {
        return h.reject('E_NO_FLEET'); // ghosts can't fight — no empty-side battles
      }
      if (f.battleId || target.battleId) {
        return h.reject('E_IN_BATTLE');
      }
      if (!f.location || f.movement || target.movement || f.location !== target.location) {
        return h.reject('E_NOT_COLOCATED');
      }
      const battleId = `battle:${h.state.battleSeq++}`;
      // Round cadence mirrors combatModule's own: one round per GAME hour
      // (÷timeScale on the wall clock), with nextRoundAt stamped for the HUD timer.
      const roundAt = h.ctx.now + hoursToMs(h.ctx, 1);
      const battle: Battle = {
        id: battleId,
        location: f.location,
        phase: 'orbital',
        sides: [
          { ref: { kind: 'fleet', fleetId: f.id }, owner: f.owner, role: 'attacker' },
          { ref: { kind: 'fleet', fleetId: target.id }, owner: target.owner, role: 'defender' },
        ],
        round: 0,
        nextRoundAt: roundAt,
      };
      h.state.battles[battleId] = battle;
      f.battleId = battleId;
      f.movement = null;
      target.battleId = battleId;
      target.movement = null;
      h.schedule(roundAt, 'combat.tick', { battleId });
      h.emit('battle.started', {
        battleId,
        location: f.location,
        phase: 'orbital',
        attacker: f.owner,
        defender: target.owner,
      });
    });
  },
};
