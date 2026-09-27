/**
 * Операция союзника главы IV (`docs/sector-zero-map-concepts.md` §6.5, кирпич PVR-7.4).
 *
 * Игрок ставит задачу («Охранять», «Атаковать», «Разведать») действием ядра `ally.order`;
 * здесь — ЧИСТОЕ решение, как её выполнить, и в каком она состоянии. Одно и то же решение
 * зовут два места: бот союзника (чьими флотами и куда) и карточка операции у игрока (что
 * сейчас происходит и почему). Разойтись «что делает бот» и «что написано в карточке» не
 * может: источник один.
 *
 * Шаги (§6.5): **сбор** (подготовка группы: разведать, подвезти десант, свести силы) →
 * **выдвижение** → **выполнение**. Доклад о выполнении делает ядро: оно снимает операцию,
 * когда цель взята, разведчик дошёл или цель охраны потеряна (`rendezvousModule`).
 *
 * Бесконечного «собираем силы» нет: сбор дольше {@link GATHER_LIMIT_HOURS} игровых часов
 * становится «нужна помощь» с причиной. Бот при этом не бросает попытки — меняется честная
 * подпись, а решение (отменить, заменить, помочь) остаётся за игроком.
 *
 * Сведения — только общие с игроком: то, что видят союзник и игрок (`identifiedNodes` по
 * союзу), и память разведки. Скрытое состояние Роя планировщик не читает.
 *
 * Без приказа союзник ведёт СВОЮ задачу (§6.5): возвращает провинции, помеченные в карте
 * признаком {@link ALLY_TASK_TRAIT}, ближайшую первой. Закончил — держит район.
 */
import { confidentGroundWin } from './groundForecast';
import { knownGarrison, freshIntel } from './garrisonIntel';
import { spareGround } from './garrisonPolicy';
import { canTraverse, loadArmy, mergeFleet, moveFleet, splitFleet } from './actions';
import {
  identifiedNodes,
  planRoute,
  previewBattle,
  getStance,
  type Action,
  type AllyOperation,
  type Fleet,
  type GameData,
  type GameState,
  type Planet,
  type PlayerId,
  type UnitStack,
} from '../packages/shared-core/src/index';

/** Признак провинции из собственной задачи союзника (§6.5): вернуть и закрепиться. */
export const ALLY_TASK_TRAIT = 'ally_task';

/** Сколько игровых часов сбор может длиться, прежде чем стать «нужна помощь». */
export const GATHER_LIMIT_HOURS = 18;

const HOUR = 3_600_000;

export type AllyOpStep = 'gather' | 'advance' | 'execute' | 'blocked' | 'idle';

/** Почему операция стоит на сборе или недоступна — ключ подписи в карточке. */
export type AllyOpReason =
  | 'scouting' // сведений о цели нет — сперва разведка
  | 'need-landing' // ждём десант
  | 'need-ships' // сил мало — сводим и ждём подкрепления
  | 'detaching' // отделяем разведчика
  | 'no-forces' // у союзника нет кораблей
  | 'no-route' // до цели не дойти
  | 'too-strong'; // собрать нужное не удаётся (сбор дольше предела)

export interface AllyOpPlan {
  step: AllyOpStep;
  reason?: AllyOpReason;
  /** Флоты операции — бот не трогает их своими общими приказами. */
  group: string[];
  actions: Action[];
  /** Что выполняется: приказ игрока или своя задача союзника. */
  source: 'order' | 'own' | 'none';
  /** Цель операции (провинция), если она есть. */
  target?: string;
}

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Живые стеки нужного рода: корабли (`space`) или наземные части (`ground`). */
const stacksOf = (units: readonly UnitStack[], data: GameData, domain: string): UnitStack[] =>
  units.filter((st) => st.count > 0 && (st.hp ?? 1) > 0 && data.units[st.unit]?.domain === domain);
const shipUnits = (units: readonly UnitStack[], data: GameData): UnitStack[] =>
  stacksOf(units, data, 'space');
const groundUnits = (units: readonly UnitStack[], data: GameData): UnitStack[] =>
  stacksOf(units, data, 'ground');

function ships(f: Fleet, data: GameData): number {
  return shipUnits(f.units, data).reduce((n, st) => n + st.count, 0);
}

/** Боевая сила флота — по статам, а не по числу корпусов: десяток разведчиков не ударная
 *  группа, а пара крейсеров — да. */
function power(f: Fleet, data: GameData): number {
  return shipUnits(f.units, data).reduce((n, st) => {
    const s = data.units[st.unit]?.stats;
    return n + st.count * ((s?.attack ?? 0) + (s?.defense ?? 0));
  }, 0);
}

/** Где флот будет: стоит — где стоит, летит — куда летит. */
function whereBound(f: Fleet): string | null {
  return f.movement ? (f.movement.destination ?? f.movement.to) : f.location;
}

function homeOf(state: GameState, ally: PlayerId, data: GameData): Planet | undefined {
  const own = Object.values(state.planets)
    .filter((p) => p.owner === ally)
    .sort(byId);
  return (
    own.find((p) =>
      p.buildings.some((b) => (b.hp ?? 1) > 0 && data.buildings[b.type]?.enablesShipConstruction),
    ) ?? own[0]
  );
}

/** Маршрут, по которому союзник вправе идти (мир закрыт — не ход). */
function reach(state: GameState, ally: PlayerId, from: string, to: string): string[] | null {
  if (from === to) return [];
  return planRoute(
    state,
    from,
    to,
    (id) => !canTraverse(state, ally, state.planets[id]?.owner ?? null),
  );
}

/** Цель своей задачи: провинция с признаком задачи, ещё не у союзника, ближайшая к дому. */
export function allyOwnTarget(state: GameState, ally: PlayerId): string | undefined {
  const home = Object.values(state.planets).find((p) => p.owner === ally);
  return Object.values(state.planets)
    .filter((p) => p.traits.includes(ALLY_TASK_TRAIT) && p.owner !== ally)
    .filter((p) => p.owner === null || getStance(state, ally, p.owner) === 'war')
    .map((p) => ({
      id: p.id,
      d: home ? Math.hypot(p.position.x - home.position.x, p.position.y - home.position.y) : 0,
    }))
    .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1))[0]?.id;
}

/** Действующая операция: приказ игрока, иначе своя задача (после связи), иначе ничего. */
export function allyActiveOp(
  state: GameState,
  ally: PlayerId,
): { op: AllyOperation; source: 'order' | 'own' } | null {
  const order = state.allyOps?.[ally];
  if (order) return { op: order, source: 'order' };
  const met = Object.values(state.missionFacts?.contacted ?? {}).some((places) =>
    places.some((at) => state.planets[at]?.rendezvous === ally),
  );
  if (!met) return null;
  const target = allyOwnTarget(state, ally);
  return target
    ? { op: { by: ally, kind: 'attack', planet: target, issuedAt: 0 }, source: 'own' }
    : null;
}

/**
 * План операции союзника. Чистая функция состояния: зови сколько угодно — бот за ход,
 * карточка за кадр. `identified` можно передать снаружи (один подсчёт сенсоров на тик).
 */
export function planAllyOperation(
  state: GameState,
  ally: PlayerId,
  data: GameData,
  identified: ReadonlySet<string> = identifiedNodes(state, ally, data),
): AllyOpPlan {
  const active = allyActiveOp(state, ally);
  if (!active) return { step: 'idle', group: [], actions: [], source: 'none' };
  const { op, source } = active;
  const fleets = Object.values(state.fleets)
    .filter((f) => f.owner === ally && ships(f, data) > 0)
    .sort(byId);
  const base = { source, ...(op.planet ? { target: op.planet } : {}) } as const;
  if (fleets.length === 0)
    return { ...base, step: 'blocked', reason: 'no-forces', group: [], actions: [] };
  const targetAt =
    op.planet ?? (op.fleet ? whereBound(state.fleets[op.fleet] ?? ({} as Fleet)) : null);
  if (!targetAt) return { ...base, step: 'blocked', reason: 'no-route', group: [], actions: [] };
  const plan =
    op.kind === 'scout'
      ? scoutPlan(state, ally, data, fleets, targetAt)
      : op.kind === 'guard'
        ? guardPlan(state, ally, data, fleets, targetAt)
        : attackPlan(state, ally, data, fleets, targetAt, op, identified);
  const overdue = source === 'order' && state.time - op.issuedAt > GATHER_LIMIT_HOURS * HOUR;
  if (plan.step === 'gather' && overdue)
    return { ...base, ...plan, step: 'blocked', reason: 'too-strong' };
  return { ...base, ...plan, target: targetAt };
}

type Part = Pick<AllyOpPlan, 'step' | 'reason' | 'group' | 'actions'>;

/** Разведка: самый малый флот идёт к цели; у всех по нескольку кораблей — отделить один. */
function scoutPlan(
  state: GameState,
  ally: PlayerId,
  data: GameData,
  fleets: Fleet[],
  at: string,
): Part {
  const going = fleets.find((f) => whereBound(f) === at);
  if (going) return { step: f(going) ? 'execute' : 'advance', group: [going.id], actions: [] };
  const idle = fleets.filter((f) => !f.movement && !f.battleId && f.location);
  if (idle.length === 0) return { step: 'gather', reason: 'need-ships', group: [], actions: [] };
  const smallest = [...idle].sort((a, b) => ships(a, data) - ships(b, data) || byId(a, b))[0]!;
  if (ships(smallest, data) > 1 && idle.length === 1) {
    // Один флот на всё: отделить самый быстрый корабль — разведка не должна уводить кулак.
    const fastest = shipUnits(smallest.units, data).sort(
      (a, b) =>
        (data.units[b.unit]?.stats.speed ?? 0) - (data.units[a.unit]?.stats.speed ?? 0) ||
        (a.unit < b.unit ? -1 : 1),
    )[0]!;
    return {
      step: 'gather',
      reason: 'detaching',
      group: [],
      actions: [splitFleet(ally, smallest.id, [{ unit: fastest.unit, count: 1 }])],
    };
  }
  if (!reach(state, ally, smallest.location!, at))
    return { step: 'blocked', reason: 'no-route', group: [], actions: [] };
  return { step: 'advance', group: [smallest.id], actions: [moveFleet(ally, smallest.id, at)] };

  function f(fl: Fleet): boolean {
    return fl.location === at && !fl.movement;
  }
}

/**
 * Флоты, которые можно отдать операции: все, кто не в бою. Безопасность дома держит его
 * ГАРНИЗОН, а не флот в запасе: десант с базы снимается только сверх её пола
 * (`spareGround`), форт и выданная оборона остаются. Держать дома «самый слабый флот»
 * оказалось хуже: слабость по статам и слабость по делу — разное, и в запас уходил флот
 * с десантом, а в бой — стопка разведчиков.
 */
function strikeCandidates(fleets: Fleet[]): Fleet[] {
  return fleets.filter((f) => !f.battleId);
}

/** Охрана: группа встаёт у цели (или идёт за охраняемым флотом) и держится там. */
function guardPlan(
  state: GameState,
  ally: PlayerId,
  data: GameData,
  fleets: Fleet[],
  at: string,
): Part {
  const pool = strikeCandidates(fleets);
  const there = pool.filter((f) => f.location === at && !f.movement);
  if (there.length > 0) return { step: 'execute', group: there.map((f) => f.id), actions: [] };
  const going = pool.filter((f) => whereBound(f) === at);
  if (going.length > 0) return { step: 'advance', group: going.map((f) => f.id), actions: [] };
  const guard = [...pool]
    .filter((f) => !f.movement && f.location)
    .sort((a, b) => power(b, data) - power(a, data) || byId(a, b))[0];
  if (!guard) return { step: 'gather', reason: 'need-ships', group: [], actions: [] };
  if (!reach(state, ally, guard.location!, at))
    return { step: 'blocked', reason: 'no-route', group: [], actions: [] };
  return { step: 'advance', group: [guard.id], actions: [moveFleet(ally, guard.id, at)] };
}

/**
 * Атака: оценить оборону по общим сведениям; нет сведений — сперва разведка. Собрать
 * ударную группу у дома (свести флоты, погрузить десант), выйти, когда прогноз за нас.
 */
function attackPlan(
  state: GameState,
  ally: PlayerId,
  data: GameData,
  fleets: Fleet[],
  at: string,
  op: AllyOperation,
  identified: ReadonlySet<string>,
): Part {
  const planet = state.planets[at];
  const seen = identified.has(at);
  const intel = planet ? knownGarrison(state, ally, at, data, identified) : null;
  if (!seen && !freshIntel(intel, state.time)) {
    const scout = scoutPlan(state, ally, data, fleets, at);
    return {
      ...scout,
      step: scout.step === 'blocked' ? 'blocked' : 'gather',
      reason: scout.reason === 'no-route' ? 'no-route' : 'scouting',
    };
  }
  // Космос у цели: враждебные союзнику флоты, которых видно (или сам флот-цель).
  const hostile = (owner: string): boolean => getStance(state, ally, owner) === 'war';
  const defendersSpace: UnitStack[] = seen
    ? Object.values(state.fleets)
        .filter((f) => f.location === at && hostile(f.owner))
        .flatMap((f) => shipUnits(f.units, data))
    : [];
  const needGround = !op.fleet && planet && planet.owner !== null && hostile(planet.owner);
  const garrison: UnitStack[] = needGround ? (intel?.units ?? planet!.garrison) : [];

  // Выполнение — ударная группа у цели: в бою там или с десантом, если нужен штурм. Разведчик,
  // оставшийся у цели после доклада, ударной группой не считается.
  const striking = fleets.filter(
    (f) =>
      f.location === at &&
      (f.battleId || !needGround || groundUnits(f.landing ?? [], data).length > 0),
  );
  if (striking.length > 0)
    return { step: 'execute', group: striking.map((f) => f.id), actions: [] };
  const pool = strikeCandidates(fleets);
  const underway = pool.filter((f) => f.movement && whereBound(f) === at);
  if (underway.length > 0)
    return { step: 'advance', group: underway.map((f) => f.id), actions: [] };

  const home = homeOf(state, ally, data);
  if (!home) return { step: 'blocked', reason: 'no-forces', group: [], actions: [] };
  // Сбор у дома: все флоты группы — туда, там — в один.
  const group = pool.filter((f) => !f.movement);
  const away = group.filter((f) => f.location !== home.id);
  const atHome = group
    .filter((f) => f.location === home.id)
    .sort((a, b) => power(b, data) - power(a, data) || byId(a, b));
  const lead = atHome[0];
  const strike = group.flatMap((f) => shipUnits(f.units, data));
  const landing = group.flatMap((f) => groundUnits(f.landing ?? [], data));
  const spaceOk =
    defendersSpace.length === 0 ||
    previewBattle(strike, defendersSpace, data).outcome === 'attacker';
  const groundOk =
    !needGround || garrison.length === 0 || confidentGroundWin(landing, garrison, data);
  if (spaceOk && groundOk && lead) {
    // Готово: ведущий флот ведёт всех, остальные — вслед. Путь проверяется от дома.
    if (!reach(state, ally, home.id, at))
      return { step: 'blocked', reason: 'no-route', group: [], actions: [] };
    const moves = group.map((f) => moveFleet(ally, f.id, at));
    return { step: 'advance', group: group.map((f) => f.id), actions: moves };
  }
  const actions: Action[] = [];
  for (const f of away) actions.push(moveFleet(ally, f.id, home.id));
  if (lead) for (const f of atHome.slice(1)) actions.push(mergeFleet(ally, f.id, lead.id));
  let reason: AllyOpReason = spaceOk ? 'need-landing' : 'need-ships';
  if (spaceOk && !groundOk && lead) {
    // Десант: снять с дома то, что можно увезти, не оголив его.
    const spare = spareGround(home, data);
    for (const st of spare) actions.push(loadArmy(ally, lead.id, st.unit, st.count));
    if (spare.length === 0) reason = 'need-landing';
  }
  return { step: 'gather', reason, group: group.map((f) => f.id), actions };
}
