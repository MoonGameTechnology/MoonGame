/**
 * The prototype's kernel assembly point (REFP-21) — the ordered module list, the
 * compiled kernel, the match config (`SCORE_LIMIT`), and the two pure step helpers
 * (`advance`/`order`) both hosts drive the world with. Extracted from `game.ts` as a
 * pure move: module ORDER is the determinism contract (invariant #6) — do not
 * reorder here without understanding replay invalidation. `game.ts` re-exports
 * everything for `main.ts`/`netserver.ts`/tests (until REFP-28).
 */
import {
  createKernel,
  economyModule,
  effectsModule,
  movementModule,
  factionModule,
  heroModule,
  heroEffectsModule,
  combatModule,
  orbitalModule,
  artilleryModule,
  interceptModule,
  captureOnArrivalModule,
  sectorModule,
  planetTypeModule,
  constructionModule,
  arsenalSyncModule,
  armyModule,
  victoryModule,
  technologyModule,
  espionageModule,
  stewardModule,
  diplomacyModule,
  squadronModule,
  type GameModule,
  type GameState,
  type Action,
  type Context,
  type DomainEvent,
} from '../../packages/shared-core/src/index';
import { data } from './prototypeData';
import { taxModule } from './tax';
import { hungerModule } from './hunger';
import { fleetLaunchModule } from './fleetLaunch';
import { botDiplomacyModule } from './botDiplomacy';
import { marketModule } from './sessionMarket';
import { capitalModule } from './capital';
import { standingOrdersModule } from './standingOrders';
import { forcedMarchModule } from './forcedMarch';
import { instantRepairModule } from './instantRepair';
import { econScrewsModule } from './econScrews';

export const MODULES: GameModule[] = [
  sectorModule,
  planetTypeModule,
  taxModule, // civic tax on inhabited worlds (hooks economy.production, after planetType)
  factionModule, // H3: чисто пассивные бонусы дома (production / fleet.speed / combat.damage)
  hungerModule, // ECON-1: food в arrears → наземный урон ×0.75 (корабли едят кредиты)
  economyModule,
  movementModule,
  heroModule, // projection hero: fleet combat aura (+5%) + death/respawn
  heroEffectsModule, // first hero.effect.<type> capability provider: recall (warp ship home)
  // The combat family (split along the bus seams). Order matters (invariant #6):
  // orbital stamps orbit on fleet.arrived BEFORE combat engages, and runs its
  // AA/bombard span BEFORE artillery's standoff span — the old internal sequence.
  orbitalModule, // the single near-orbit: stationing, AA fire, bombardment
  combatModule, // melee battles: engage / tick / assault / retreat / capture
  artilleryModule, // standoff fire accrual + barrage orders
  interceptModule, // schedules lane-crossing meetings (resolved by combat)
  captureOnArrivalModule, // walk-in capture now a kernel rule (was client-side seizeSector)
  constructionModule,
  arsenalSyncModule, // LARS-1: server-driver refresh of live build-catalog ownership (bypasses gate)
  technologyModule, // session research: branch/day-gated techs → effect bonuses + content unlocks
  stewardModule, // «Хранитель»: delegate the seat to the AI while you sleep (gated by the Steward tech)
  armyModule,
  victoryModule, // terminal match state from authoritative state (domination / elimination / score / timeout)
  fleetLaunchModule,
  diplomacyModule, // CORE D2+D3 (D4): escalation/consent offers; combat reads state.diplomacy
  espionageModule, // SPY-1 core module: espionage.spy → time-boxed intel windows (state.intel)
  botDiplomacyModule, // bots: friendly-by-default favour meter → embargo/war only when provoked
  marketModule, // session resource market: two-sided order book (sell/buy lots), embargo-gated
  capitalModule, // designatable capital (hero respawn / module re-fit anchor)
  standingOrdersModule, // CC-2/CC-4 standing orders (auto-storm / дежурный вылет), server-driven
  squadronModule, // SQ: free-space movement for squadrons (strike/return off the lane graph)
  forcedMarchModule, // BOOST-1 форс-марш: +50% скорости за 5% max-HP износа в час хода
  instantRepairModule, // платный мгновенный ремонт корпуса (кредиты как премиум-валюта)
  econScrewsModule, // ECON-3: экспресс-ремонт корпуса за metal у своего дока
  effectsModule, // EFX-1: интерпретатор data.events (trigger→effect); инертен, пока events: {} пуст
];

export const kernel = createKernel(MODULES);

// Win at 1100 of the board's ~2410 base points (30 planets×50 + 91 provinces×10). Set
// below the ~60% domination line so a decisive-but-not-total lead — a fistful of planets
// plus built-up infrastructure — can win the SCORE race first, making the score/building
// system (scoreValue) meaningful instead of vestigial vs conquest. Tunable single source
// of truth, also read by the HUD score readout.
export const SCORE_LIMIT = 1100;
export function ctx(now: number): Context {
  return { now, data, config: { timeScale: 1, victory: { scoreLimit: SCORE_LIMIT } } };
}

export interface StepOut {
  state: GameState;
  events: DomainEvent[];
  error?: string;
}

/** Advance the world to `now`, collecting events. */
export function advance(state: GameState, now: number): StepOut {
  if (now <= state.time) return { state, events: [] };
  // Chain partial catch-ups (mirrors matchRoom.computeAdvance): a long-idle world
  // may exceed MAX_ADVANCE_STEPS per call; stopping short would leave due events in
  // the queue and `order()` would then hit the kernel's E_TIME_GAP guard. A chunk
  // that makes NO progress (same-instant runaway) breaks out — the frame loop
  // retries next tick rather than spinning here.
  let cur = state;
  const events: StepOut['events'] = [];
  for (let i = 0; i < 10; i++) {
    const r = kernel.advanceTo(cur, ctx(now));
    if (!r.ok) return { state: cur, events, error: r.code };
    const progressed = r.state.time > cur.time;
    cur = r.state;
    events.push(...r.events);
    if (!r.partial || !progressed) break;
  }
  return { state: cur, events };
}

/** Apply a player order at the current world time (advancing first if needed). */
export function order(state: GameState, action: Action, now: number): StepOut {
  const advanced = advance(state, now);
  const r = kernel.applyAction(advanced.state, action, ctx(Math.max(now, advanced.state.time)));
  if (!r.ok) return { state: advanced.state, events: advanced.events, error: r.code };
  return { state: r.state, events: [...advanced.events, ...r.events] };
}

/**
 * RULES-1 — «можно ли?» по правилам игры: код отказа (`E_*`) или `null`.
 *
 * Тот же вердикт, что вернул бы `order()`, но без применения — и БЕЗ второго описания
 * правил: под капотом `kernel.canApply`, то есть буквально те же обработчики модулей.
 * Спрашивают отсюда интерфейс (гасит кнопку и печатает причину) и автоматика
 * (покадровые циклы, драйверы), чтобы не издавать заведомо отвергаемый приказ.
 *
 * Спрашивается на `state.time`, а не на «сейчас»: вопрос про МИР В ЕГО ЧАСЕ. Спросить
 * на будущем `now` значило бы сперва прокрутить время (advance) — то есть изменить мир
 * ради вопроса, чего проба делать не должна. Гейты `E_TIME_*` при этом заведомо чисты.
 */
export function canOrder(state: GameState, action: Action): string | null {
  // Память ответов на ОДНО состояние. Ключ — сам объект состояния: `GameState`
  // неизменяем по инварианту №2 (редьюсер возвращает новый объект, а не правит старый),
  // поэтому «другой мир» — это всегда другая ссылка, и устареть ответ не может.
  // Без памяти проба стоила бы дорого не из-за себя, а из-за частоты: панель собирает
  // HTML каждый кадр (dirty-check сравнивает уже готовую строку), и меню стройки
  // спрашивало бы ядро семь раз в кадр — ~2 мс, 12% бюджета, за один только серый цвет.
  if (memoState !== state) {
    memoState = state;
    memo.clear();
  }
  const key = `${action.playerId} ${action.type} ${JSON.stringify(action.payload)}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const verdict = kernel.canApply(state, action, ctx(state.time));
  memo.set(key, verdict);
  return verdict;
}
let memoState: GameState | null = null;
const memo = new Map<string, string | null>();

/**
 * RULES-3 — «прошла бы вся СВЯЗКА приказов?»: первый код отказа или `null`.
 *
 * Тот же вопрос, что `canOrder`, но про последовательность — `kernel.canApplyAll`.
 * Нужен автоматике, которая издаёт связки, а не одиночные приказы: авто-штурм — это
 * «встать на низкую орбиту → штурм», и спросить можно только про пару целиком. Про
 * один штурм ответом был бы `E_WRONG_ORBIT` (орбита ещё не выставлена), про одну
 * орбиту — «можно», после чего применилась бы половина обречённой связки.
 *
 * Без памяти: связки спрашивают драйверы (раз в тик), а не покадровый рендер, и ключ
 * по массиву действий стоил бы дороже самой пробы.
 */
export function canOrderAll(state: GameState, actions: readonly Action[]): string | null {
  return kernel.canApplyAll(state, actions, ctx(state.time));
}
