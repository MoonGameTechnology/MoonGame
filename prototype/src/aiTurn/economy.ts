/**
 * ХОЗЯЙСТВО В ХОДЕ БОТА (SLIM-3): свет и еда, цепочка дохода и верфь, шахты и салвага,
 * вложения ведущего места. Порядок звеньев — порядок приказов в ходе.
 */
import {
  buildingLevel,
  buildingMaxLevel,
  matchCost,
  matchUnitCost,
  type Action,
} from '../../../packages/shared-core/src/index';
import { buildBuilding, upgradeBuilding } from '../../../decisions/actions';
import { data } from '../gameData';
import { canOrder } from '../protoKernel';
import type { HomeTurn } from './home';
import { ORDER_RESERVE, worldsInOrder } from './rules';
import type { AiTurn } from './turn';

/** С какого запаса металла не отстающее место вкладывает лишнее в доход (а не в армию). */
const LEADER_METAL_SURPLUS = 600;
/** Что ведущее место улучшает дома, по порядку: кредиты, налог, микроэлектроника. */
const LEADER_UPGRADES = ['refinery', 'tax_office', 'fabricator'] as const;

/** Хозяйство дома за ход: четыре звена по порядку. */
export function economyOrders(bot: AiTurn, home: HomeTurn): void {
  keepLightsOn(bot, home);
  incomeOrders(bot, home);
  mineOrders(bot, home);
  leaderInvest(bot, home);
}

// Keep the lights on first: a bot whose energy/food NET flow is negative (or already
// in arrears) raises a plant/farm before anything else — brownouts halve its economy.
// One plant is not a cap (owner's decision 2026-10-07): the bot used to stop at the
// first farm/reactor of the match and then lived in arrears, which no player would
// do — so self-play reported a food/energy pressure that only the bot felt. Like a
// player, it adds the next one on its first own world that lacks it (home first,
// then by id — a stable order, invariant #1), but keeps ONE of a kind in the queue,
// so the flow it reads next tick already counts the plant it ordered.
function keepLightsOn(bot: AiTurn, home: HomeTurn): void {
  const { state, ai, out, pad } = bot;
  const { base, pl, flow } = home;
  for (const [need, b] of [
    ['energy', 'power_plant'],
    ['food', 'farm'],
  ] as const) {
    if ((flow[need] ?? 0) >= 0 && !(pl.arrears ?? []).includes(need)) continue;
    const queued = state.scheduled.some((e) => {
      if (e.type !== 'construction.complete') return false;
      const q = e.payload as { kind?: string; planetId?: string; building?: string };
      return (
        q.kind === 'building' && q.building === b && state.planets[q.planetId ?? '']?.owner === ai
      );
    });
    if (queued) continue;
    const cost = matchCost(state, data.buildings[b]?.cost) ?? {};
    if (!Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + pad(r, 60))) continue;
    const site = [
      base,
      ...Object.values(state.planets)
        .filter((p) => p.owner === ai && p.id !== base.id)
        .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)),
    ].find(
      (p) =>
        !p.buildings.some((x) => x.type === b) &&
        canOrder(state, buildBuilding(ai, p.id, b)) === null,
    );
    if (site) out.push(buildBuilding(ai, site.id, b));
  }
}

// Economy chain (self-play M4: mine/refinery/tax office were DEAD content for the
// bot — it bought all its metal on the market): raise the first missing credit
// engine at the home base (refinery → tax office), and put a metal mine on each
// captured PRIZE world — one link at a time, only when comfortably affordable,
// and never over the same build already queued (no reject spam).
function incomeOrders(bot: AiTurn, home: HomeTurn): void {
  const { state, ai, out, pad, army } = bot;
  const { base, pl, has, pendingBuild, affordable } = home;
  // ECON-7: fabricator joins the chain — microelectronics gates warships now
  // (cruiser/siege cost micro), so a bot without a fab eventually can't build a
  // fleet. Built once the credit/tax engine is up; keeps micro produced AND spent.
  // YARD-1: `spaceport` встал в цепочку вторым звеном. Он больше не приезжает даром
  // вместе с домом (дом несёт ВЕРФЬ), а без него у бота нет ни ангара, ни челноков —
  // то есть целый пласт боя выпал бы из измерения. Место в цепочке не случайное:
  // сперва чистые деньги (`refinery`), потом порт, который и торгует, и открывает
  // ангар, и только затем множитель с микроэлектроникой.
  const incomeChain = ['refinery', 'spaceport', 'tax_office', 'fabricator'] as const;
  for (const b of incomeChain) {
    if (has(b)) continue;
    if (affordable(b) && !pendingBuild(base.id, b)) out.push(buildBuilding(ai, base.id, b));
    break; // one link at a time — wait out the current one either way
  }
  // Тяжёлый стапель (армия под ветку, `heavyYard`) — звено после цепочки дохода: верфь
  // дома улучшается до верха. Идущее улучшение ядро отбивает `E_ALREADY_QUEUED`.
  const yard = base.buildings.find((x) => x.type === 'shipyard' && x.hp > 0);
  const yardDef = data.buildings['shipyard'];
  if (
    army.heavyYard &&
    yard &&
    yardDef &&
    yard.level < buildingMaxLevel(yardDef) &&
    incomeChain.every(has)
  ) {
    const cost = matchCost(state, buildingLevel(yardDef, yard.level + 1).cost);
    const order = upgradeBuilding(ai, base.id, 'shipyard');
    if (
      Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + pad(r, 60)) &&
      canOrder(state, order) === null
    )
      out.push(order);
  }
}

/** Шахта на каждом своём мире, улучшение шахт, пока металла мало, станция на мёртвом мире. */
function mineOrders(bot: AiTurn, home: HomeTurn): void {
  const { state, ai, out, pad, skilled, lineUnit } = bot;
  const { base, pl, pendingBuild, affordable } = home;
  for (const p of worldsInOrder(state, ai, 'mine', skilled)) {
    if (p.owner !== ai || p.kind !== 'planet' || p.id === base.id) continue;
    if (p.buildings.some((x) => x.type === 'mine') || pendingBuild(p.id, 'mine')) continue;
    if (!affordable('mine')) break;
    out.push(buildBuilding(ai, p.id, 'mine'));
    break; // spread the economy one world per tick
  }
  // Invest while metal is tight, keeping one usable line hull and the normal
  // order reserve. A rich treasury does not need another source of stockpiles.
  // Only one mining investment may be pending anywhere in the empire.
  const minePending =
    out.some(
      (a) =>
        (a.type === 'building.construct' || a.type === 'building.upgrade') &&
        (a.payload as { building?: string }).building === 'mine',
    ) ||
    Object.values(state.planets).some(
      (p) =>
        p.owner === ai &&
        [...(p.buildQueue ?? []), ...(p.pausedConstruction ?? [])].some(
          (q) => (q.kind === 'building' || q.kind === 'upgrade') && q.building === 'mine',
        ),
    ) ||
    state.scheduled.some((e) => {
      if (e.type !== 'construction.complete') return false;
      const q = e.payload as { kind?: string; planetId?: string; building?: string };
      return (
        (q.kind === 'building' || q.kind === 'upgrade') &&
        q.building === 'mine' &&
        state.planets[q.planetId ?? '']?.owner === ai
      );
    });
  if (skilled && !minePending && data.buildings.mine) {
    const hull = matchUnitCost(state, data.units[lineUnit]) ?? {};
    const reserve = (r: string): number => (hull[r] ?? 0) + pad(r, ORDER_RESERVE[r] ?? 0);
    for (const p of [
      base,
      ...worldsInOrder(state, ai, 'mine-upgrade', skilled).filter((p) => p.id !== base.id),
    ]) {
      if (p.owner !== ai || p.kind !== 'planet') continue;
      const mine = p.buildings.find((b) => b.type === 'mine' && b.hp > 0);
      if (!mine || mine.level >= buildingMaxLevel(data.buildings.mine)) continue;
      if (p.buildQueue?.length || p.pausedConstruction?.length) continue;
      if (
        out.some(
          (a) =>
            (a.type === 'building.construct' || a.type === 'building.upgrade') &&
            (a.payload as { planetId?: string }).planetId === p.id,
        )
      )
        continue;
      const cost = matchCost(state, buildingLevel(data.buildings.mine, mine.level + 1).cost);
      if (
        (pl.resources.metal ?? 0) >=
        (cost.metal ?? 0) + 2 * (hull.metal ?? 0) + pad('metal', ORDER_RESERVE.metal ?? 0)
      )
        continue;
      if (
        !Object.keys({ ...cost, ...hull, ...ORDER_RESERVE }).every(
          (r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + reserve(r),
        )
      )
        continue;
      const order = upgradeBuilding(ai, p.id, 'mine');
      if (canOrder(state, order) !== null) continue;
      out.push(order);
      break;
    }
  }
  // МЁРТВЫЙ МИР — тоже экономика (AI-BAL-8). До аннигиляции ни одного `dead_world` на
  // карте прототипа не существовало, поэтому `metal_station` числилась мёртвым
  // контентом «по УСЛОВИЮ» (AI-BAL-10, случай «в»). Теперь герой их создаёт — но обычная
  // шахта на пустыре запрещена (`allowedBuildings: ['metal_station']`), а правило шахты
  // выше берёт только `kind === 'planet'`, так что без этой ветки аннигиляция оставляла
  // бы после себя ровно пустырь. Салвага и есть плата за разрушенный мир: 30 металла в
  // час против 10 базовых.
  if (skilled) {
    for (const p of worldsInOrder(state, ai, 'salvage', skilled)) {
      if (p.owner !== ai || p.kind !== 'dead_world') continue;
      if (
        p.buildings.some((x) => x.type === 'metal_station') ||
        pendingBuild(p.id, 'metal_station')
      ) {
        continue;
      }
      if (!affordable('metal_station')) break;
      out.push(buildBuilding(ai, p.id, 'metal_station'));
      break; // одна стройка за тик — как и с шахтой
    }
  }
}

function leaderInvest(bot: AiTurn, home: HomeTurn): void {
  const { state, ai, out, pad, skilled, trailing } = bot;
  const { base, pl, pendingBuild, affordable } = home;
  // Ведущее место вкладывает лишний металл в доход (решение владельца 2026-10-08:
  // «если впереди, может думать, куда ещё потратить, кроме лишней армии»). Металл к
  // 30-му дню копился до ~44k, а кредитов не было. Порядок: улучшить дома
  // переработку, налоговую и фабрикатор, потом поставить переработку на своём мире без
  // неё — она стоит один металл и даёт кредиты. Одна стройка за тик, как у шахт.
  if (!trailing && (pl.resources.metal ?? 0) >= pad('metal', LEADER_METAL_SURPLUS)) {
    const pendingUpgrade = (planetId: string, b: string): boolean =>
      state.scheduled.some((e) => {
        if (e.type !== 'construction.complete') return false;
        const q = e.payload as { kind?: string; planetId?: string; building?: string };
        return q.kind === 'upgrade' && q.planetId === planetId && q.building === b;
      });
    const invest = (): Action | null => {
      for (const b of LEADER_UPGRADES) {
        const def = data.buildings[b];
        const inst = base.buildings.find((x) => x.type === b);
        if (!def || !inst || inst.level >= buildingMaxLevel(def)) continue;
        if (pendingUpgrade(base.id, b)) continue;
        const cost = matchCost(state, buildingLevel(def, inst.level + 1).cost);
        if (!Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + pad(r, 60)))
          continue;
        const order = upgradeBuilding(ai, base.id, b);
        if (canOrder(state, order) === null) return order;
      }
      if (!affordable('refinery')) return null;
      for (const p of worldsInOrder(state, ai, 'refinery', skilled)) {
        if (p.owner !== ai || p.kind !== 'planet' || p.id === base.id) continue;
        if (p.buildings.some((x) => x.type === 'refinery') || pendingBuild(p.id, 'refinery'))
          continue;
        const order = buildBuilding(ai, p.id, 'refinery');
        if (canOrder(state, order) === null) return order;
      }
      return null;
    };
    const order = invest();
    if (order) out.push(order);
  }
}
