/**
 * ДОМ В ХОДЕ БОТА (SLIM-3): база места, его казна и общие вопросы к стройке, которые задают
 * фазы хозяйства, науки и производства. Собирается раз за ход, если у места есть база.
 */
import {
  hangarMachines,
  matchCost,
  type Planet,
  type Player,
  type UnitStack,
} from '../../../packages/shared-core/src/index';
import { buildBuilding } from '../../../decisions/actions';
import { netIncome } from '../economy';
import { data } from '../gameData';
import { canOrder } from '../protoKernel';
import type { AiTurn } from './turn';

export interface HomeTurn {
  readonly base: Planet;
  readonly pl: Player;
  /** Чистый поток ресурсов места за час. */
  readonly flow: Record<string, number>;
  readonly has: (b: string) => boolean;
  readonly pendingBuild: (planetId: string, b: string) => boolean;
  readonly affordable: (b: string) => boolean;
  readonly buildAllowed: (planetId: string, b: string) => boolean;
  /** Сколько машин рода `unit` у места: в ангарах портов и кораблей и в воздухе. */
  readonly shuttlesOwned: (unit: string) => number;
}

export function openHome(bot: AiTurn, base: Planet, pl: Player): HomeTurn {
  const { state, ai, pad } = bot;
  const flow = netIncome(state, ai);
  const has = (b: string): boolean =>
    Object.values(state.planets).some(
      (p) => p.owner === ai && p.buildings.some((x) => x.type === b),
    );
  const pendingBuild = (planetId: string, b: string): boolean =>
    state.scheduled.some((e) => {
      if (e.type !== 'construction.complete') return false;
      const q = e.payload as { kind?: string; planetId?: string; building?: string };
      return q.kind === 'building' && q.planetId === planetId && q.building === b;
    });
  const affordable = (b: string): boolean => {
    const cost = matchCost(state, data.buildings[b]?.cost) ?? {};
    return Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + pad(r, 60));
  };
  /** Разрешает ли ЯДРО это здание здесь и сейчас, если отвлечься от денег.
   *
   *  Спрашиваем, а не переводим правило заново (RULES-1): ядро может запретить
   *  постройку по причине, о которой бот не знает — например, орбитальное ПКО до
   *  `orbital_defense_grid` (ORB-1). Звено цепочки, которое нельзя построить, надо
   *  ПРОПУСТИТЬ: критерий «не построено и не в очереди» держал бы его вечно, и до
   *  следующего звена бот не дошёл бы никогда. Деньги спрашиваются отдельно, потому
   *  что нехватка средств — это «подожди», а не «нельзя». `canOrder` мемоизирован по
   *  состоянию, так что цепочка стоит один прогон на здание за тик. */
  const buildAllowed = (planetId: string, b: string): boolean => {
    const code = canOrder(state, buildBuilding(ai, planetId, b));
    return code === null || code === 'E_INSUFFICIENT';
  };
  // Сколько машин рода `unit` у места. Предел спрашивают и слот линейного корабля (армия
  // под ветку), и заказ челноков ниже.
  // СЧЁТ ИДЁТ ПО АНГАРАМ И ВОЗДУХУ, а не по флотам. `shipsOwned` смотрит в состав
  // флотов и в гарнизон, а челнок с SHU-1.1 не бывает ни там, ни там — он лежит в
  // ангаре базы. Пока предел считался тем счётчиком, он не срабатывал НИКОГДА: бот
  // заказывал челнок каждый тик до упора в `E_HANGAR_FULL` и платил за это отказами
  // весь матч. SHU-6.8: в счёт входят и ангары кораблей, и эскадры в воздухе.
  // Перехватчики теперь держат патруль, а ударные эскадры перелетают к фронту, и предел
  // по одному ангару порта стал бы конвейером: эскадра ушла — порт заказывает новую.
  const shuttlesOwned = (unit: string): number => {
    const count = (stacks: readonly UnitStack[]): number =>
      stacks.reduce((k, st) => k + (st.unit === unit ? st.count : 0), 0);
    let n = 0;
    for (const p of Object.values(state.planets)) if (p.owner === ai) n += count(hangarMachines(p));
    for (const f of Object.values(state.fleets)) if (f.owner === ai) n += count(hangarMachines(f));
    for (const st of state.strikes ?? []) if (st.owner === ai) n += count(st.units);
    return n;
  };
  return { base, pl, flow, has, pendingBuild, affordable, buildAllowed, shuttlesOwned };
}
