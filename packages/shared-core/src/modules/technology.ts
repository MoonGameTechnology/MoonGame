import type { Action } from '../action/types';
import { hoursToMs } from '../action/types';
import { MS_PER_DAY } from '../util/time';
import type {
  DamageScope,
  GameData,
  ResourceBag,
  TechnologyCondition,
  TechnologyDef,
} from '../data/schemas';
import type { GameModule, HandlerContext } from '../kernel/module';
import type {
  ActiveResearch,
  GameState,
  Planet,
  Player,
  PlayerTechnologyState,
  TechRules,
  UnitStack,
} from '../state/gameState';
import { scientistsOf } from '../state/gameState';
import { matchCost, matchHours } from '../util/pricing';
import { canAfford, payCost } from '../util/treasury';
import { isForkSite } from '../state/forkSite';

interface ResearchPayload {
  technology: string;
}

interface CompletePayload {
  playerId?: string;
  technology?: string;
  completesAt?: number;
}

interface ConstructionRequirement {
  allowed: boolean;
  code?: string;
}

interface ConstructionRequirementArgs {
  playerId?: string;
  kind?: 'unit' | 'building';
  id?: string;
}

interface ProductionArgs {
  planetId?: string;
}

interface SpeedArgs {
  fleetId?: string;
}

interface DamageArgs {
  attacker?: string | null;
  phase?: string;
}

/** Каналы огня каждой области боевого теха (BAL-6, решение владельца 2026-10-07): урон
 *  ветки идёт только своему каналу. Канал — это `phase` в аргументах хука урона, его
 *  ставит сам канал (`util/combat.ts`, `hookedDamage`). Космос — всё, чем стреляют
 *  корабли и миры по целям в космосе и воздухе; каждый канал входит ровно в одну
 *  область, и новый канал без области роняет `techDamageScope.test.ts`. */
export const DAMAGE_SCOPE_PHASES: Readonly<Record<DamageScope, readonly string[]>> = {
  space: ['orbital', 'bombard', 'pointDefense', 'returnFire'],
  ground: ['ground'],
  shuttle: ['shuttle', 'intercept'],
  missile: ['missile'],
};

/** Concurrent research slots: 2 by the base rule, raised via the `research.slots`
 *  hook (e.g. a "+1 slot" scientist) up to a design maximum of 3. */
export const BASE_RESEARCH_SLOTS = 2;
export const MAX_RESEARCH_SLOTS = 3;

/** Clamp a raw `research.slots` hook result into the design range. Exported because
 *  the CLIENT shows the same number on its research screen: a hand-copied
 *  `Math.min(3, Math.max(2, …))` there drifted from this one (CONV-5) — the prototype's
 *  pill promised a slot the reducer then refused. A misbehaving hook (non-finite /
 *  out of range) falls back to the base rather than fail-open to unlimited slots. */
export function clampResearchSlots(raw: number): number {
  return Number.isFinite(raw)
    ? Math.min(MAX_RESEARCH_SLOTS, Math.max(BASE_RESEARCH_SLOTS, Math.floor(raw)))
    : BASE_RESEARCH_SLOTS;
}

function technologyState(player: Player): PlayerTechnologyState {
  const tech = player.technologies ?? (player.technologies = { completed: [] });
  // Migrate a pre-multi-slot single-object `active` (from a match persisted before
  // slots existed) into the list, so the concurrent-research code never meets a
  // non-array and throws E_INTERNAL.
  const active = tech.active as ActiveResearch[] | ActiveResearch | undefined;
  if (active !== undefined && !Array.isArray(active)) {
    tech.active = [active];
  }
  return tech;
}

function hasCompleted(player: Player | undefined, technology: string): boolean {
  return player?.technologies?.completed.includes(technology) ?? false;
}

function effectsSum(
  player: Player | undefined,
  data: GameData,
  key: 'productionBonus' | 'fleetSpeedBonus',
): number {
  // Summed inline (no intermediate def array) — this runs from the fleet.speed /
  // economy.production hooks, i.e. per movement leg and production span.
  let bonus = 0;
  for (const id of player?.technologies?.completed ?? []) {
    const def = data.technologies[id];
    if (def) bonus += def.effects[key] ?? 0;
  }
  return bonus;
}

/** Технологии, любая из которых открывает юнита или здание (пусто — не заперто). Тот же
 *  список, по которому хук `construction.requirement` решает, пускать ли стройку, —
 *  экспортирован, чтобы клиент называл игроку ИМЕННО эту технологию, а не гадал. */
export function technologiesUnlocking(
  data: GameData, kind: 'unit' | 'building', id: string, state?: Pick<GameState, 'techRules'>,
): string[] {
  const out: string[] = [];
  for (const technology of Object.keys(data.technologies).sort()) {
    const def = data.technologies[technology];
    if (!def) {
      continue;
    }
    if (state && def.ruleset !== undefined && def.ruleset !== techRulesOf(state).ruleset) continue;
    const unlocked = kind === 'unit' ? (def.unlocks.units ?? []) : (def.unlocks.buildings ?? []);
    if (unlocked.includes(id)) {
      out.push(technology);
    }
  }
  return out;
}

function scheduleCompletion(
  h: HandlerContext,
  technology: string,
  playerId: string,
  hours: number,
): number {
  const completesAt = h.ctx.now + hoursToMs(h.ctx, hours);
  h.schedule(completesAt, 'technology.complete', { playerId, technology, completesAt });
  return completesAt;
}

/** Planets a player currently owns. */
function ownedPlanets(state: GameState, playerId: string): Planet[] {
  return Object.values(state.planets).filter((p) => p.owner === playerId);
}

/** Built copies of `building` across the player's worlds. */
function countBuilding(state: GameState, playerId: string, building: string): number {
  return ownedPlanets(state, playerId).reduce(
    (n, p) => n + p.buildings.filter((b) => b.type === building).length,
    0,
  );
}

/** Worlds of `planetType` the player owns. */
function countPlanetType(state: GameState, playerId: string, planetType: string): number {
  return ownedPlanets(state, playerId).filter((p) => p.planetType === planetType).length;
}

/** Copies of `unit` the player fields across fleets, their cargo, and garrisons. */
function countUnit(state: GameState, playerId: string, unit: string): number {
  const inStacks = (stacks: UnitStack[] | undefined): number =>
    (stacks ?? []).reduce((n, s) => n + (s.unit === unit ? s.count : 0), 0);
  let total = 0;
  for (const f of Object.values(state.fleets)) {
    if (f.owner === playerId) total += inStacks(f.units) + inStacks(f.landing);
  }
  for (const p of ownedPlanets(state, playerId)) total += inStacks(p.garrison);
  // Десант на чужой земле — тоже его войска (замечание Codex на #1392: с MSB-9 штурмующий
  // десант весь бой живёт плацдармом, а не в трюме).
  for (const p of Object.values(state.planets)) {
    for (const b of p.beachheads ?? []) if (b.owner === playerId) total += inStacks(b.units);
  }
  return total;
}

/** Evaluates one curated unlock condition deterministically from state — each is an
 *  "at least `min`" count. Unknown types fail-secure (never satisfied); the `never`
 *  guard makes adding a schema variant WITHOUT an evaluator case a COMPILE error, so
 *  the catalog stays safe to extend. Composing existing ones to balance is pure data.
 *
 *  RULES-4: экспортируется для read-only запроса «выполнено ли ЭТО условие» — дереву
 *  технологий надо рисовать галочку у каждой строки условий по отдельности, а
 *  `technologyLock` отвечает только про узел целиком. Своя копия этого перебора в
 *  клиенте покрывала 2 типа из 5, то есть узел с условием `has_building` /
 *  `controls_planet_type` / `has_unit` читался бы как запертый НАВСЕГДА, хотя ядро
 *  исследование разрешает. */
export function conditionMet(
  cond: TechnologyCondition,
  state: GameState,
  playerId: string,
  data: GameData,
): boolean {
  switch (cond.type) {
    case 'own_sectors':
      // Площадка крепости на развилке — не сектор: она стоит на дороге, а не на карте
      // провинций (замечание Codex на #1410: каждая крепость приближала порог).
      return ownedPlanets(state, playerId).filter((p) => !isForkSite(p)).length >= cond.min;
    case 'has_building':
      return countBuilding(state, playerId, cond.building) >= cond.min;
    case 'controls_planet_type':
      return countPlanetType(state, playerId, cond.planetType) >= cond.min;
    case 'has_unit':
      return countUnit(state, playerId, cond.unit) >= cond.min;
    case 'has_scientist': {
      // Branch-focus / capstone gate: ANY of the player's chosen leaders (≤2) meets the
      // level and (if specified) the branch. Branches come from the per-match-frozen
      // catalog, so the id lookups are snapshot-safe.
      return scientistsOf(state.players[playerId]).some((chosen) => {
        if (chosen.level < cond.minLevel) return false;
        const def = data.scientists[chosen.id];
        if (!def) return false; // a chosen id absent from the catalog satisfies nothing
        return cond.branch === undefined || def.branch === cond.branch;
      });
    }
    default: {
      const _exhaustive: never = cond;
      void _exhaustive;
      return false; // fail-secure for hand-built / unvalidated data
    }
  }
}

/** Дерево сетевого матча: ворота дней действуют, исключённых узлов нет (PVR-6.17). */
export const DEFAULT_TECH_RULES: Readonly<TechRules> = { dayGates: true, exclude: [] };

/** Правила дерева этого матча: закреплённые из режима (`state.techRules`) или сетевые. */
export function techRulesOf(state: Pick<GameState, 'techRules'>): Readonly<TechRules> {
  return state.techRules ?? DEFAULT_TECH_RULES;
}

/** Есть ли узел `id` в дереве этого матча (PVR-6.17): режим может убрать узел целиком —
 *  в забеге нет «Хранителя». Окно, бот и редьюсер спрашивают одно и то же. */
export function techInMatch(
  state: Pick<GameState, 'techRules'>, id: string, data?: GameData,
): boolean {
  const rules = techRulesOf(state);
  const ruleset = data?.technologies[id]?.ruleset;
  return !rules.exclude.includes(id) && (ruleset === undefined || ruleset === rules.ruleset);
}

/** Правила дерева режима — один раз, на первом шаге часов, как `sight` у зрения: дальше
 *  матч живёт со своими правилами, и правка данных не переписывает идущий матч. У режима
 *  без раздела `technology` поле не появляется — действует дерево сетевого матча. */
function pinTechRules(h: HandlerContext): void {
  if (h.state.techRules !== undefined) return;
  const modeId = h.ctx.config?.modeId;
  const rules = modeId === undefined ? undefined : h.ctx.data.modes[modeId]?.technology;
  if (rules) h.state.techRules = { ...rules, exclude: [...rules.exclude],
    ...(rules.starting ? { starting: [...rules.starting] } : {}) };
}

/** The data-driven availability gate of a tech, independent of cost / research-slot
 *  state: grant-only → not in this match → prerequisites → day-gate → conditions. Returns the first unmet
 *  gate's stable reject code, or null when the node is researchable. Pure — used by the
 *  reducer and reusable for a read-only "what can I research (and why not)" query. */
export function technologyLock(
  def: TechnologyDef,
  state: GameState,
  playerId: string,
  data: GameData,
  id?: string,
): string | null {
  // A grant-only node is never researchable BY ANYONE — it is handed out (commander
  // meta-progression, a run boon), not worked for. The rule belongs here and not only in
  // the action handler, because this function is what every READING consumer asks: the
  // seat AI picks its candidates through it (deliberately keeping no private copy of the
  // rules), and the tech-tree window reads it too. While the ban lived in the handler
  // alone the gate answered "researchable", so the AI — which sorts cheapest-first, and
  // these are free — asked for one every step, got E_GRANT_ONLY, and never reached the
  // real tree: research was dead in every match (BAL-15).
  if (def.grantOnly) return 'E_GRANT_ONLY';
  if (def.ruleset !== undefined && def.ruleset !== techRulesOf(state).ruleset) return 'E_NOT_IN_MATCH';
  // PVR-6.17: узла нет в дереве этого матча (режим его убрал). `id` необязателен лишь
  // ради старых вызовов по одному определению; все читатели в игре его передают.
  if (id !== undefined && !techInMatch(state, id, data)) return 'E_NOT_IN_MATCH';
  const completed = state.players[playerId]?.technologies?.completed ?? [];
  for (const prerequisite of def.prerequisites) {
    if (!completed.includes(prerequisite)) return 'E_PREREQUISITE';
  }
  // Day-gate: "Day N" is the match's world clock, counted exactly as the match browser
  // shows it (matchRegistry: floor((state.time − startedAt) / MS_PER_DAY)), so the lock
  // lines up with the displayed day. timeScale already lives in state.time (the room
  // runs the world clock fast); startedAt defaults to 0 for the 0-based clock.
  // PVR-6.17: режим может снять ворота дней целиком — забег до третьего дня не доживает.
  if (
    techRulesOf(state).dayGates &&
    (def.dayGate ?? 0) > 0 &&
    state.time - (state.startedAt ?? 0) < def.dayGate * MS_PER_DAY
  ) {
    return 'E_TOO_EARLY';
  }
  for (const condition of def.conditions ?? []) {
    if (!conditionMet(condition, state, playerId, data)) return 'E_CONDITIONS_UNMET';
  }
  return null;
}

// --- очередь исследований (RQ-1) ---------------------------------------------
//
// Просьба владельца 2026-11-01: «строить очередь технологий». Лаборатория больше не
// простаивает, пока игрок офлайн: следующая тема стартует сама, как только освободится
// слот. Правила списаны с очереди стройки (BLD-1, `construction.ts`) там, где вопрос тот
// же, и решены здесь там, где у науки он свой:
//
//  1. **Деньги — НА СТАРТЕ, а не при постановке.** Ждущая тема не стоит ничего, и
//     снятие её из очереди — просто удаление, без возврата (как BLD-1, правило 2).
//  2. **Очередь — это ПРИОРИТЕТ.** Слот достаётся первой теме, которую можно начать.
//     Не хватает на неё денег — она ЖДЁТ, а более дешёвые за ней не обгоняют: иначе
//     они съедали бы доход, и дорогая тема не стартовала бы никогда (BLD-1, правило 4).
//  3. **Ждать предка — не то же, что ждать денег.** Тема, у которой предок ещё изучается
//     или стоит выше в очереди, слот не держит: его берёт следующая готовая. Так два
//     слота не простаивают, пока один дорабатывает корень ветки.
//  4. **В очередь можно то, что откроется само или по плану.** Предок должен быть изучен,
//     в работе или стоять в очереди раньше; день и условия узла (сектора, постройки,
//     учёный) могут ещё не наступить — тема ждёт их и честно называет, чего ждёт.
//     Нельзя только невозможное: грант-узел, узел не этого матча, тему без предка в плане.
//  5. **Порядок держит зависимость.** Тему нельзя поднять выше её предка в очереди, а
//     снятие предка снимает и тех, кто от него зависит, — иначе они висели бы мёртвыми.
//  6. **Повтор — событие на таймлайне**, раз в игровой час и только пока есть свободный
//     слот: старт не может зависеть от того, каким шагом звали `advanceTo` (BLD-1,
//     правило 4). Завершение темы, постановка, снятие и перестановка зовут насос сразу.
//  7. **Глубина ограничена** — это граница персистируемого состояния, а не баланс.

/** Потолок очереди исследований (правило 7). */
export const MAX_RESEARCH_QUEUE = 8;

/** Как часто очередь, которой не хватило денег или времени, пробует снова (правило 6). */
const RESEARCH_QUEUE_RETRY_HOURS = 1;

/** Идущие темы, даже если матч сохранён до слотов (одиночный объект, см. `technologyState`):
 *  читающие функции ниже не мутируют состояние и не могут его мигрировать. */
function activeOf(tech: PlayerTechnologyState | undefined): ActiveResearch[] {
  const active = tech?.active as ActiveResearch[] | ActiveResearch | undefined;
  return active === undefined ? [] : Array.isArray(active) ? active : [active];
}

/** Чего ждёт тема в очереди — по порядку проверок ядра (`technologyLock`). */
type QueuedFate =
  | { fate: 'ready' }
  | { fate: 'prerequisite' | 'day' | 'conditions' }
  | { fate: 'drop'; code: string };

function queuedFate(
  state: GameState,
  playerId: string,
  data: GameData,
  id: string,
  queue: readonly string[],
): QueuedFate {
  const def = data.technologies[id];
  if (!def) return { fate: 'drop', code: 'E_UNKNOWN_TECHNOLOGY' };
  const tech = state.players[playerId]?.technologies;
  const completed = tech?.completed ?? [];
  const active = activeOf(tech);
  if (completed.includes(id) || active.some((a) => a.technology === id)) {
    return { fate: 'drop', code: 'E_ALREADY_RESEARCHED' };
  }
  const lock = technologyLock(def, state, playerId, data, id);
  switch (lock) {
    case null:
      return { fate: 'ready' };
    case 'E_PREREQUISITE': {
      const planned = def.prerequisites.every(
        (p) => completed.includes(p) || active.some((a) => a.technology === p) || queue.includes(p),
      );
      return planned ? { fate: 'prerequisite' } : { fate: 'drop', code: 'E_PREREQUISITE' };
    }
    case 'E_TOO_EARLY':
      return { fate: 'day' };
    case 'E_CONDITIONS_UNMET':
      return { fate: 'conditions' };
    default:
      return { fate: 'drop', code: lock }; // грант-узел, узел не этого матча — навсегда
  }
}

/** Можно ли поставить тему в хвост очереди — то же правило, что у редьюсера
 *  (`technology.queue`), для кнопки «В очередь». Null — можно, иначе код отказа. */
export function queueableTechnology(
  state: GameState,
  playerId: string,
  data: GameData,
  id: string,
): string | null {
  const def = data.technologies[id];
  if (!def) return 'E_UNKNOWN_TECHNOLOGY';
  if (def.grantOnly) return 'E_GRANT_ONLY';
  const tech = state.players[playerId]?.technologies;
  if (tech?.completed.includes(id) || activeOf(tech).some((a) => a.technology === id)) {
    return 'E_ALREADY_RESEARCHED';
  }
  const queue = tech?.queue ?? [];
  if (queue.includes(id)) return 'E_RESEARCH_QUEUED';
  if (queue.length >= MAX_RESEARCH_QUEUE) return 'E_QUEUE_FULL';
  const fate = queuedFate(state, playerId, data, id, queue);
  return fate.fate === 'drop' ? fate.code : null;
}

/** Правило 5: ни одна тема не стоит выше своего предка из той же очереди. */
export function researchQueueOrderOk(queue: readonly string[], data: GameData): boolean {
  return queue.every((id, i) =>
    (data.technologies[id]?.prerequisites ?? []).every((p) => {
      const at = queue.indexOf(p);
      return at < 0 || at < i;
    }),
  );
}

/** Что уйдёт из очереди вместе с темой `id` (правило 5): она сама и все, чей предок
 *  после её снятия не изучен, не в работе и не в очереди. Порядок — порядок очереди. */
export function researchQueueCascade(
  state: GameState,
  playerId: string,
  data: GameData,
  id: string,
): string[] {
  const tech = state.players[playerId]?.technologies;
  const queue = tech?.queue ?? [];
  if (!queue.includes(id)) return [];
  const completed = tech?.completed ?? [];
  const active = activeOf(tech);
  const gone = new Set([id]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const q of queue) {
      if (gone.has(q)) continue;
      const orphan = (data.technologies[q]?.prerequisites ?? []).some(
        (p) =>
          gone.has(p) && !completed.includes(p) && !active.some((a) => a.technology === p),
      );
      if (orphan) {
        gone.add(q);
        changed = true;
      }
    }
  }
  return queue.filter((q) => gone.has(q));
}

/** Чего ждёт тема очереди — для подписи в окне науки. */
export type ResearchQueueWait =
  /** стартует при следующей проверке очереди: слот свободен и денег хватает */
  | 'starting'
  /** первая готовая тема, но денег на неё пока нет — очередь ждёт их */
  | 'resources'
  /** все слоты заняты */
  | 'slot'
  /** готова, но выше стоит тема, которая ждёт денег (правило 2) */
  | 'queue'
  /** предок ещё изучается или стоит выше в очереди */
  | 'prerequisite'
  /** день узла ещё не наступил */
  | 'day'
  /** условия узла (сектора, постройки, учёный) пока не выполнены */
  | 'conditions';

export interface ResearchQueueEntry {
  technology: string;
  wait: ResearchQueueWait;
}

/** Очередь глазами насоса — чистое чтение того же правила, которым ядро решает, кто
 *  стартует следующим (`pumpResearchQueue`). Клиент не держит своей копии порядка
 *  проверок: разъедься она с ядром, окно обещало бы старт, которого не будет. `slots` —
 *  число слотов, посчитанное снаружи (хук `research.slots` вне редьюсера не зовётся). */
export function researchQueueView(
  state: GameState,
  playerId: string,
  data: GameData,
  slots: number,
): ResearchQueueEntry[] {
  const player = state.players[playerId];
  const tech = player?.technologies;
  const queue = tech?.queue ?? [];
  let free = Math.max(0, slots - activeOf(tech).length);
  const purse: Record<string, number> = { ...(player?.resources ?? {}) };
  let blocked = false;
  const out: ResearchQueueEntry[] = [];
  for (const id of queue) {
    const fate = queuedFate(state, playerId, data, id, queue);
    if (fate.fate === 'drop') continue; // насос снимет её при первой же проверке
    if (fate.fate !== 'ready') {
      out.push({ technology: id, wait: fate.fate });
      continue;
    }
    if (blocked) {
      out.push({ technology: id, wait: 'queue' });
    } else if (free === 0) {
      out.push({ technology: id, wait: 'slot' });
    } else {
      const cost = matchCost(state, data.technologies[id]!.cost);
      if (canAfford(purse, cost)) {
        payCost(purse, cost);
        free -= 1;
        out.push({ technology: id, wait: 'starting' });
      } else {
        blocked = true;
        out.push({ technology: id, wait: 'resources' });
      }
    }
  }
  return out;
}

/** Назначить повтор насоса (правило 6), не плодя дублей. */
function scheduleResearchPump(h: HandlerContext, playerId: string): void {
  const pending = h.state.scheduled.some(
    (e) =>
      e.type === 'technology.queue.pump' &&
      (e.payload as { playerId?: string } | undefined)?.playerId === playerId,
  );
  if (pending) return;
  h.schedule(h.ctx.now + hoursToMs(h.ctx, RESEARCH_QUEUE_RETRY_HOURS), 'technology.queue.pump', {
    playerId,
  });
}

function researchSlots(h: HandlerContext, playerId: string): number {
  return clampResearchSlots(h.hook<number>('research.slots', BASE_RESEARCH_SLOTS, { playerId }));
}

/** Начать тему в слоте: списать цену, назначить завершение, занять слот. Цена и
 *  возможность проверены вызывающим. */
function beginResearch(
  h: HandlerContext,
  player: Player,
  playerId: string,
  technology: string,
  def: TechnologyDef,
  fromQueue: boolean,
): void {
  payCost(player.resources, matchCost(h.state, def.cost));
  const completesAt = scheduleCompletion(
    h,
    technology,
    playerId,
    matchHours(h.state, def.researchTimeHours),
  );
  (technologyState(player).active ??= []).push({ technology, startedAt: h.ctx.now, completesAt });
  h.emit('technology.research.started', {
    playerId,
    technology,
    completesAt,
    ...(fromQueue ? { fromQueue: true } : {}),
  });
}

function setQueue(tech: PlayerTechnologyState, queue: string[]): void {
  if (queue.length) tech.queue = queue;
  else delete tech.queue;
}

/**
 * Насос очереди: занять свободные слоты темами из очереди. Единственная точка старта из
 * очереди — её зовут завершение темы, приказы очереди, кража технологии и повтор по
 * таймеру. Порядок решений — правила 2 и 3 из шапки раздела.
 */
function pumpResearchQueue(h: HandlerContext, playerId: string): void {
  const player = h.state.players[playerId];
  if (!player || player.status === 'defeated' || !player.technologies?.queue?.length) return;
  pinTechRules(h);
  const tech = technologyState(player);
  const slots = researchSlots(h, playerId);
  for (;;) {
    if ((tech.active ?? []).length >= slots) return; // слоты заняты — разбудит завершение
    let pick: string | null = null;
    for (const id of [...(tech.queue ?? [])]) {
      const fate = queuedFate(h.state, playerId, h.ctx.data, id, tech.queue ?? []);
      if (fate.fate === 'drop') {
        setQueue(tech, (tech.queue ?? []).filter((q) => q !== id));
        h.emit('technology.queue.dropped', { playerId, technology: id, code: fate.code });
        continue;
      }
      if (fate.fate === 'ready') {
        pick = id;
        break;
      }
    }
    if (pick === null) break; // готовых нет — ждут предка, дня или условий
    const def = h.ctx.data.technologies[pick]!;
    if (!canAfford(player.resources, matchCost(h.state, def.cost))) break; // правило 2
    setQueue(tech, (tech.queue ?? []).filter((q) => q !== pick));
    beginResearch(h, player, playerId, pick, def, true);
  }
  if (tech.queue?.length) scheduleResearchPump(h, playerId);
}

function queuePayload(action: Action, h: HandlerContext): { player: Player; technology: string } | null {
  const payload = action.payload as Partial<ResearchPayload>;
  if (typeof payload?.technology !== 'string') {
    h.reject('E_BAD_PAYLOAD');
    return null;
  }
  const player = h.state.players[action.playerId];
  if (!player) {
    h.reject('E_FORBIDDEN');
    return null;
  }
  technologyState(player); // старый одиночный `active` — в список, до любых проверок
  return { player, technology: payload.technology };
}

/** `technology.queue` — поставить тему в хвост очереди (правило 4). Свободный слот и
 *  деньги — тема стартует тут же, тем же насосом. */
function enqueueResearch(action: Action, h: HandlerContext): void {
  const got = queuePayload(action, h);
  if (!got) return;
  pinTechRules(h);
  const tech = got.player.technologies!;
  const code = queueableTechnology(h.state, action.playerId, h.ctx.data, got.technology);
  if (code) return h.reject(code);
  tech.queue = [...(tech.queue ?? []), got.technology];
  h.emit('technology.queued', {
    playerId: action.playerId,
    technology: got.technology,
    position: tech.queue.length,
  });
  pumpResearchQueue(h, action.playerId);
}

/** `technology.dequeue` — снять тему и всех, кто без неё остался без предка (правило 5).
 *  Возврата нет: ждущая тема не оплачена (правило 1). */
function dequeueResearch(action: Action, h: HandlerContext): void {
  const got = queuePayload(action, h);
  if (!got) return;
  const removed = researchQueueCascade(h.state, action.playerId, h.ctx.data, got.technology);
  if (!removed.length) return h.reject('E_NOT_QUEUED');
  const tech = technologyState(got.player);
  setQueue(tech, (tech.queue ?? []).filter((q) => !removed.includes(q)));
  h.emit('technology.dequeued', {
    playerId: action.playerId,
    technology: got.technology,
    removed,
  });
  pumpResearchQueue(h, action.playerId); // снятая голова могла держать очередь на деньгах
}

/** `technology.queue.move` — переставить тему на место `to` (с нуля, лишнее — к краю). */
function moveQueuedResearch(action: Action, h: HandlerContext): void {
  const got = queuePayload(action, h);
  if (!got) return;
  const to = (action.payload as { to?: unknown }).to;
  if (typeof to !== 'number' || !Number.isInteger(to) || to < 0) return h.reject('E_BAD_PAYLOAD');
  const tech = technologyState(got.player);
  const queue = [...(tech.queue ?? [])];
  const from = queue.indexOf(got.technology);
  if (from < 0) return h.reject('E_NOT_QUEUED');
  const target = Math.min(to, queue.length - 1);
  if (target === from) return;
  queue.splice(from, 1);
  queue.splice(target, 0, got.technology);
  if (!researchQueueOrderOk(queue, h.ctx.data)) return h.reject('E_QUEUE_ORDER');
  tech.queue = queue;
  h.emit('technology.queue.moved', {
    playerId: action.playerId,
    technology: got.technology,
    to: target,
  });
  pumpResearchQueue(h, action.playerId); // наверх могла встать тема, на которую хватает
}

function startResearch(action: Action, h: HandlerContext): void {
  const payload = action.payload as Partial<ResearchPayload>;
  if (typeof payload?.technology !== 'string') {
    return h.reject('E_BAD_PAYLOAD');
  }
  const player = h.state.players[action.playerId];
  if (!player) {
    return h.reject('E_FORBIDDEN');
  }
  const def = h.ctx.data.technologies[payload.technology];
  if (!def) {
    return h.reject('E_UNKNOWN_TECHNOLOGY');
  }
  // Грант-узел исследовать нельзя НИКОМУ и ни в каком матче: он бесплатен и мгновенен
  // по своей сути (награда, а не работа), и без этой отсечки «исследовать» его значило
  // бы взять даром. Прятать из окна мало — окно не единственный отправитель приказа.
  //
  // ПРАВИЛО ЖИВЁТ В `technologyLock` (BAL-15) — там его спрашивают читающие потребители,
  // и там же оно ловится ниже по этому же пути. Здесь отсечка стоит РАНЬШЕ ради ТОЧНОСТИ
  // КОДА, а не ради самого запрета: грант-узлы приезжают в матч как `completed`, так что
  // без неё повторная просьба отбивалась бы `E_ALREADY_RESEARCHED` — правдой про этот
  // матч, но не про узел, который нельзя исследовать в принципе. Удалять её, «раз ворота
  // и так ловят», значит менять код отказа; удалять ту — вернуть BAL-15.
  if (def.grantOnly) {
    return h.reject('E_GRANT_ONLY');
  }
  const tech = technologyState(player);
  const active = (tech.active ??= []);
  if (
    tech.completed.includes(payload.technology) ||
    active.some((a) => a.technology === payload.technology)
  ) {
    return h.reject('E_ALREADY_RESEARCHED'); // already completed or in progress
  }
  const raw = h.hook<number>('research.slots', BASE_RESEARCH_SLOTS, { playerId: action.playerId });
  const slots = clampResearchSlots(raw);
  if (active.length >= slots) {
    return h.reject('E_RESEARCH_SLOTS_FULL'); // every research slot is occupied
  }
  // Приказ может прийти раньше первого шага часов — правила режима закрепляются здесь же.
  pinTechRules(h);
  const lock = technologyLock(def, h.state, action.playerId, h.ctx.data, payload.technology);
  if (lock) {
    return h.reject(lock);
  }
  if (!canAfford(player.resources, matchCost(h.state, def.cost))) {
    return h.reject('E_INSUFFICIENT');
  }
  // RQ-1: тема из очереди, начатая вручную, уходит из очереди — она уже в слоте, и
  // зависящие от неё темы остаются на своих местах (предок теперь «в работе»).
  if (tech.queue?.includes(payload.technology)) {
    setQueue(tech, tech.queue.filter((q) => q !== payload.technology));
  }
  beginResearch(h, player, action.playerId, payload.technology, def, false);
}

/** SES-3 (GDD §4.3): sink the premium resource into faster research. One boost
 *  pays `data.researchBoost.cost` and cuts the REMAINING time of one active
 *  research by `initialPercent × decay^boosts` — geometric diminishing returns,
 *  so pouring more premium never buys instant completion (and never touches
 *  units / combat power / hero XP — the GDD fairness rule). Acceleration is a
 *  RESCHEDULE, not a cancel: `completesAt` moves earlier and a fresh
 *  `technology.complete` is scheduled; the originally-scheduled event no-ops on
 *  arrival because its `completesAt` no longer matches the slot (the same
 *  stale-completion guard the complete handler already has). */
function boostResearch(action: Action, h: HandlerContext): void {
  const payload = action.payload as Partial<ResearchPayload>;
  if (typeof payload?.technology !== 'string') {
    return h.reject('E_BAD_PAYLOAD');
  }
  const player = h.state.players[action.playerId];
  if (!player) {
    return h.reject('E_FORBIDDEN');
  }
  // technologyState migrates a legacy single-object `active` before the .find —
  // a pre-multi-slot save must boost, not blow up with E_INTERNAL.
  const slot = technologyState(player).active?.find((a) => a.technology === payload.technology);
  if (!slot) {
    return h.reject('E_NOT_ACTIVE'); // not currently being researched
  }
  const remaining = slot.completesAt - h.ctx.now;
  if (remaining <= 0) {
    return h.reject('E_TOO_LATE'); // completion is already due — nothing to cut
  }
  const boost = h.ctx.data.researchBoost;
  if (!canAfford(player.resources, boost.cost)) {
    return h.reject('E_INSUFFICIENT');
  }
  payCost(player.resources, boost.cost);
  // initialPercent × decay^boosts by repeated multiplication — Math.pow is barred
  // from the core (implementation-approximated); products are correctly rounded.
  let share = boost.initialPercent;
  for (let i = 0; i < (slot.boosts ?? 0); i++) share *= boost.decay;
  const cut = remaining * share;
  slot.boosts = (slot.boosts ?? 0) + 1;
  slot.completesAt = h.ctx.now + Math.max(0, Math.round(remaining - cut));
  h.schedule(slot.completesAt, 'technology.complete', {
    playerId: action.playerId,
    technology: payload.technology,
    completesAt: slot.completesAt,
  });
  h.emit('technology.research.boosted', {
    playerId: action.playerId,
    technology: payload.technology,
    completesAt: slot.completesAt,
    boosts: slot.boosts,
  });
}

/**
 * Capability `technology.grant` (SPY-10): hand a player a finished technology outside
 * the lab — research theft. A slot already researching it is freed (the scheduled
 * completion then finds no slot and no-ops); nothing is refunded. Prerequisites are
 * NOT checked (owner's resolution 2026-10-22). Emits `technology.researched` like a
 * normal completion. Returns false when there is nothing to grant.
 */
export type TechnologyGrant = (h: HandlerContext, playerId: string, technology: string) => boolean;

const grantTechnology: TechnologyGrant = (h, playerId, technology) => {
  const player = h.state.players[playerId];
  if (!player || !h.ctx.data.technologies[technology] || hasCompleted(player, technology)) return false;
  const tech = technologyState(player);
  if (tech.active) tech.active = tech.active.filter((a) => a.technology !== technology);
  if (tech.queue) setQueue(tech, tech.queue.filter((q) => q !== technology));
  tech.completed.push(technology);
  h.emit('technology.researched', { playerId, technology });
  pumpResearchQueue(h, playerId); // слот мог освободиться, а предок — открыться
  return true;
};

export const technologyModule: GameModule = {
  id: 'technology',
  // 1.1.0: условие «есть юнит» видит и десант на плацдарме.
  // 1.2.0: площадка крепости на развилке не считается сектором (замечание Codex на #1410).
  // 1.4.0: возможность `technology.grant` — технология мимо лаборатории (SPY-10).
  // 1.5.0: очередь исследований (RQ-1) — `technology.queue` / `.dequeue` / `.queue.move`.
  version: '1.5.0',
  setup(api) {
    api.provideCapability<TechnologyGrant>('technology.grant', grantTechnology);
    api.onAction('technology.research', startResearch);
    api.onAction('technology.boost', boostResearch);
    api.onAction('technology.queue', enqueueResearch);
    api.onAction('technology.dequeue', dequeueResearch);
    api.onAction('technology.queue.move', moveQueuedResearch);
    api.on('technology.queue.pump', (event, h) => {
      const playerId = (event.payload as { playerId?: unknown } | undefined)?.playerId;
      if (typeof playerId === 'string') pumpResearchQueue(h, playerId);
    });
    api.on('time.advanced', (_event, h) => pinTechRules(h));

    api.on('technology.complete', (event, h) => {
      const payload = event.payload as CompletePayload;
      if (
        typeof payload?.playerId !== 'string' ||
        typeof payload.technology !== 'string' ||
        typeof payload.completesAt !== 'number'
      ) {
        return;
      }
      const player = h.state.players[payload.playerId];
      if (!player) {
        return;
      }
      const tech = technologyState(player);
      const active = tech.active;
      if (!active) {
        return;
      }
      const idx = active.findIndex(
        (a) => a.technology === payload.technology && a.completesAt === payload.completesAt,
      );
      if (idx < 0) {
        return; // no matching slot (stale / duplicate completion) → no-op
      }
      active.splice(idx, 1);
      if (!tech.completed.includes(payload.technology)) {
        tech.completed.push(payload.technology);
      }
      h.emit('technology.researched', {
        playerId: payload.playerId,
        technology: payload.technology,
      });
      pumpResearchQueue(h, payload.playerId); // RQ-1: освободившийся слот берёт очередь
    });

    api.hook<ConstructionRequirement>('construction.requirement', (current, args, h) => {
      if (!current.allowed) {
        return current;
      }
      const { playerId, kind, id } = args as ConstructionRequirementArgs;
      if (typeof playerId !== 'string' || !kind || typeof id !== 'string') {
        return current;
      }
      const locks = technologiesUnlocking(h.ctx.data, kind, id, h.state);
      if (locks.length === 0) {
        return current;
      }
      const player = h.state.players[playerId];
      return locks.some((technology) => hasCompleted(player, technology))
        ? current
        : { allowed: false, code: 'E_TECH_LOCKED' };
    });

    api.hook<ResourceBag>('economy.production', (bag, args, h) => {
      const planetId = (args as ProductionArgs).planetId;
      const owner = planetId ? h.state.planets[planetId]?.owner : null;
      if (owner === null || owner === undefined) {
        return bag;
      }
      const bonus = effectsSum(h.state.players[owner], h.ctx.data, 'productionBonus');
      if (bonus === 0) {
        return bag;
      }
      const out: Record<string, number> = {};
      for (const res of Object.keys(bag)) {
        out[res] = (bag[res] ?? 0) * (1 + bonus);
      }
      return out;
    });

    api.hook<number>('fleet.speed', (speed, args, h) => {
      const fleetId = (args as SpeedArgs).fleetId;
      const owner = fleetId ? h.state.fleets[fleetId]?.owner : undefined;
      const bonus = owner ? effectsSum(h.state.players[owner], h.ctx.data, 'fleetSpeedBonus') : 0;
      return bonus !== 0 ? speed * (1 + bonus) : speed;
    });

    // PERK-1.2: боевые техи — МАССОВЫЙ класс, поэтому очки, а не множитель. Их восемь
    // исследуемых, и лидер берёт все: перемножаясь, они давали ×1.73, а сложившись — ×1.57.
    // Каждый следующий тех теперь обесценивает сам себя, и это ровно то, ради чего
    // параллельная группа заведена (PERK-0.1 / PERK-1.1, `util/combat.ts`). Тех с областью
    // (`damageScope`) складывается только в каналах своей области (BAL-6).
    api.hook<number>('combat.damage.parallel', (points, args, h) => {
      const { attacker, phase } = args as DamageArgs;
      if (typeof attacker !== 'string') return points;
      let bonus = 0;
      for (const id of h.state.players[attacker]?.technologies?.completed ?? []) {
        const def = h.ctx.data.technologies[id];
        if (!def) continue;
        const scope = def.damageScope;
        if (scope !== undefined && !DAMAGE_SCOPE_PHASES[scope].includes(phase ?? '')) continue;
        bonus += def.effects.combatDamageBonus ?? 0;
      }
      return points + bonus;
    });
  },
};
