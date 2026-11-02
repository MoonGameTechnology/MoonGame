/** ПРОИЗВОДСТВО В ХОДЕ БОТА (SLIM-3): линейные корпуса дома и военный заказ. */
import { matchUnitCost, type UnitStack } from '../../../packages/shared-core/src/index';
import { buildUnit, launchFleet } from '../../../decisions/actions';
import { canOrder } from '../protoKernel';
import { data } from '../gameData';
import { ORDER_RESERVE, SHUTTLE_CAP, hasFacilityFor } from './rules';
import type { HomeTurn } from './home';
import type { AiTurn } from './turn';

/** Линейные корпуса дома, пока флотов мало: корпус ветки в слот линейного, иначе крейсер. */
export function lineOrders(bot: AiTurn, home: HomeTurn): void {
  const { state, ai, out, pad, lineUnit, army, warFooting, ownFleets } = bot;
  const { base, pl, shuttlesOwned } = home;
  // Ship production is CAPPED by the fleet count (self-play M4: endless building
  // fed an ever-growing swarm — hundreds of fleets by mid-match). Enough fleets
  // out ⇒ the metal flows to economy/garrisons instead.
  if (
    ownFleets < (warFooting ? 8 : 4) &&
    (pl.resources.metal ?? 0) > pad('metal', 220) &&
    (pl.resources.credits ?? 0) > pad('credits', 120) &&
    (pl.resources.microelectronics ?? 0) >= pad('microelectronics', 3) // ECON-7: warships need the hi-tech good
  ) {
    // Корпус ветки в слот линейного корабля (армия под ветку): первое, что примет ядро,
    // пока таких у места меньше, чем крейсеров, — армия выходит смешанной. Целиком своим
    // родом бот проигрывал: земля на войне строила одни танки, отдавала бой за орбиту и
    // выигрывала 49/35% партий (`selfplay 200` sp/alt). Челнок вдобавок держит потолок
    // своего рода. Иначе крейсер.
    const strikeCap = army.strikeCap ?? SHUTTLE_CAP;
    const owned = (unit: string): number => {
      if (data.units[unit]?.traits.includes('shuttle')) return shuttlesOwned(unit);
      const count = (stacks: readonly UnitStack[] = []): number =>
        stacks.reduce((k, st) => k + (st.unit === unit ? st.count : 0), 0);
      let n = 0;
      for (const f of Object.values(state.fleets))
        if (f.owner === ai) n += count(f.units) + count(f.landing);
      for (const p of Object.values(state.planets)) if (p.owner === ai) n += count(p.garrison);
      return n;
    };
    const cruisers = owned(lineUnit);
    const hull =
      [...(warFooting ? (army.warHulls ?? []) : []), ...(army.lineHulls ?? [])].find(
        (u) =>
          owned(u) < cruisers &&
          (!data.units[u]?.traits.includes('shuttle') || owned(u) < strikeCap) &&
          canOrder(state, buildUnit(ai, base.id, u, 1)) === null,
      ) ?? lineUnit;
    const order = buildUnit(ai, base.id, hull, 1);
    // Resource floors are a strategy reserve, not an affordability check: the
    // pinned ship premium can raise any component above those old floors.
    if (canOrder(state, order) === null) out.push(order);
  }
}

/** На войне: запас ополчения дома под десант и разведчики на лишние деньги. */
export function warFootingOrders(bot: AiTurn, home: HomeTurn): void {
  const { state, ai, out, pad, lineUnit, scoutUnit, militiaUnit, warFooting, ownFleets } = bot;
  const { base, pl } = home;
  // Wartime posture (self-play M4: wars were free walk-in raids — the leader had no
  // garrisons, so whoever attacked always came back and won): at war the bot
  // (a) garrisons its undefended PRIZE worlds with militia — a garrisoned planet
  // can't be walk-in captured, it takes a ground assault; the 10-point provinces
  // stay an open raid zone by design; (b) adds fast scouts to the build mix
  // (capture runners for that raid zone); (c) fields more fleets — and a launched
  // fleet lifts home-built militia aboard as landing troops (fleet.launch), which
  // is exactly what lets it assault a garrisoned world back.
  if (warFooting) {
    // ГАРНИЗОН ПРИЗОВЫХ МИРОВ ПЕРЕЕХАЛ ОТСЮДА (2026-09-16). Здесь стояло правило
    // «на войне занять ПУСТЫЕ призовые миры ополчением», и оно стало вторым живым
    // ответом на тот же вопрос: пустой мир — частный случай мира ниже ПОЛА, а пол
    // (правило владельца №4) считается ниже, в блоке призовых миров, и не только на
    // войне. Две копии разошлись бы на первой же правке — эта уже расходилась капом
    // (2 против 3) и условием (пусто против недобора).
    // A landing stock at home: strike groups lift militia on sortie (`fleets.ts`), so
    // the base keeps a few spare beyond its seeded defenders.
    const baseMilitia = base.garrison
      .filter((s) => s.unit === militiaUnit)
      .reduce((n, s) => n + s.count, 0);
    if (baseMilitia < 4 && (pl.resources.metal ?? 0) > pad('metal', 120) && hasFacilityFor(base, militiaUnit)) {
      out.push(buildUnit(ai, base.id, militiaUnit, 2));
    }
    if (ownFleets < 8 && (pl.resources.metal ?? 0) > pad('metal', 140)) {
      // Scouts use spare money after the next line hull. Otherwise a 75-metal
      // scout bought every two hours drains more than the opening mine earns,
      // keeping the treasury below the line-production floor indefinitely.
      // NPC rosters and Sector Zero keep their existing scenario behaviour.
      const lineBlock = canOrder(state, buildUnit(ai, base.id, lineUnit, 1));
      const saveForLine =
        scoutUnit === 'scout' &&
        !pl.npc &&
        !state.pve &&
        (lineBlock === null || lineBlock === 'E_INSUFFICIENT');
      const scoutCost = matchUnitCost(state, data.units[scoutUnit]) ?? {};
      const lineCost = matchUnitCost(state, data.units[lineUnit]) ?? {};
      const afterScout = (r: string): number =>
        (pl.resources[r] ?? 0) - (scoutCost[r] ?? 0);
      const keepsLineBudget =
        afterScout('metal') > pad('metal', 220) &&
        afterScout('credits') > pad('credits', 120) &&
        afterScout('microelectronics') >= pad('microelectronics', 3) &&
        Object.keys({ ...lineCost, ...ORDER_RESERVE }).every(
          (r) => afterScout(r) >= (lineCost[r] ?? 0) + pad(r, ORDER_RESERVE[r] ?? 0),
        );
      // A technology or facility gate is not something hoarding can fix: keep
      // scouting while the ordinary research/building policy opens that gate.
      if (!saveForLine || keepsLineBudget) out.push(buildUnit(ai, base.id, scoutUnit, 1));
    }
  }
}

/** Поднять флот с базы, пока своих флотов мало (на войне — до четырёх). */
export function launchHomeFleet(bot: AiTurn, home: HomeTurn): void {
  const { ai, out, isShipUnit, warFooting, ownFleets } = bot;
  const { base } = home;
  // (marine retired: the AI no longer cheap-builds a ground trooper. Its home keeps its
  //  seeded infantry garrison + orbital-AA building for defence; mobile ground via divisions.)
  const baseHasShip = base.garrison.some((st) => isShipUnit(st.unit));
  if (ownFleets < (warFooting ? 4 : 2) && baseHasShip) out.push(launchFleet(ai, base.id));
}
