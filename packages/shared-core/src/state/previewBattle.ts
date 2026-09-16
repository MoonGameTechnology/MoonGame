import type { UnitStack } from './gameState';
import type { GameData } from '../data/schemas';
import { damageUnits, MAX_COMBAT_ROUNDS, stackHull } from '../util/combat';
import { cappedUnitStat } from '../util/stacks';
import { volleyShare } from '../util/volley';
import { effectiveStats } from '../util/loadout';
import { deepClone } from '../util/clone';

/**
 * Combat preview — «если атакую — что будет?» (ONB-6 / G4, onboarding-roadmap §ONB-6).
 *
 * A PURE what-if over the combat module's own round engine: the same simultaneous
 * round — aggressor fires `attack`, the standing side answers with `defense` — the
 * same tier-ordered pure damage model (`damageUnits`: front→mid→rear,
 * ablative shields first, whole units lost as pools drop), the same stalemate
 * valve. Inputs are never mutated (the sim runs on deep clones); no bus, no
 * schedule, no RNG — combat resolution is fully deterministic.
 *
 * It is a FORECAST, not an oracle (the spec's bar is sign-agreement, not
 * equality): the live battle additionally pipes each round through the
 * `combat.damage` hook — terrain, planet type, standing fortifications, faction
 * and technology passives, hero auras. Those are deliberately NOT folded in:
 * a module-faithful preview would need the match kernel, and — worse — would
 * leak the ENEMY's hidden bonuses (their researched techs, faction passives,
 * hero fittings) through the predicted numbers. The base model reads only unit
 * compositions, which is exactly what the viewer legitimately sees; when hidden
 * bonuses flip a close fight, that is the fog of war doing its job.
 *
 * Fog discipline is the CALLER's: feed it sides the viewer legitimately knows
 * (own units vs an identified world's garrison / an identified fleet; a client
 * naturally holds only the fog-projected state, so this is structural there).
 */

/** One side's forecast: what's left and what it cost. */
export interface BattlePreviewSide {
  /** Surviving stacks (count > 0) at the forecast's end. */
  survivors: UnitStack[];
  /** Units lost, aggregated per unit id. */
  losses: UnitStack[];
  /** Share of this side's HULL the forecast says it loses, in [0,1] — the
   *  «ответный урон» number a commit-or-retreat rule thresholds on (ST-3.1).
   *  Measured on hull pools ({@link hullPool}): a wing ground down to 1% hp
   *  reads as ~1, where a whole-units count would read ~0. An empty side is 0
   *  (nothing to lose) — callers gate on emptiness separately. */
  damageFraction: number;
}

/** Current HULL pool of a stack list: Σ per-stack residual `hp` (a battle-worn
 *  stack keeps its partial pool), or full `count × effective hp` when healthy.
 *  The per-stack arithmetic IS `damageUnits`' own (`stackHull`, one shared
 *  copy), so a fraction of this pool is a fraction of what the damage model
 *  actually chews through. Shields are deliberately EXCLUDED: they regenerate
 *  between engagements, so only lasting hull damage counts. */
export function hullPool(units: readonly UnitStack[], data: GameData): number {
  let total = 0;
  for (const s of units) {
    const def = data.units[s.unit];
    if (!def || s.count <= 0) continue;
    total += stackHull(s, effectiveStats(def, s, data).hp).pool;
  }
  return total;
}

/** The forecast: winner (by the combat module's rule — the side left standing;
 *  both dead or the 240-round valve → `stalemate`), rounds fought, both sides. */
export interface BattlePreview {
  outcome: 'attacker' | 'defender' | 'stalemate';
  roundsEst: number;
  attacker: BattlePreviewSide;
  defender: BattlePreviewSide;
}

const alive = (units: UnitStack[]): boolean => units.some((s) => s.count > 0);

/** Losses = per-unit difference between the input and the surviving counts.
 *  Insertion order of the input pins the output order (deterministic). */
function lossesOf(before: readonly UnitStack[], after: UnitStack[]): UnitStack[] {
  const beforeN = new Map<string, number>();
  for (const s of before) beforeN.set(s.unit, (beforeN.get(s.unit) ?? 0) + s.count);
  const afterN = new Map<string, number>();
  for (const s of after) afterN.set(s.unit, (afterN.get(s.unit) ?? 0) + s.count);
  const out: UnitStack[] = [];
  for (const [unit, n] of beforeN) {
    const lost = n - (afterN.get(unit) ?? 0);
    if (lost > 0) out.push({ unit, count: lost });
  }
  return out;
}

/** Одна сторона в многостороннем прогнозе: чем она бьёт и кому враждебна. */
export interface PreviewSideInput {
  units: readonly UnitStack[];
  role: 'attacker' | 'defender';
  /** Владелец — нужен только чтобы спросить вражду; для безымянной дуэли не нужен. */
  owner?: string | null;
}

export interface MultiBattlePreview {
  /** `stalemate`, если выжили не все… точнее: если выживших не ровно один. */
  outcome: 'decided' | 'stalemate';
  roundsEst: number;
  /** В ТОМ ЖЕ порядке, что и вход. */
  sides: BattlePreviewSide[];
}

/**
 * ПРОГНОЗ НА N СТОРОН (MSB-6) — зеркало такта живого боя, правило в правило.
 *
 * Считает то же, что `combat.tick`: предраундовый снимок (сперва ВСЕ залпы, потом весь
 * урон), кап линии огня на сторону, делёж залпа между всеми враждебными живыми
 * (`splitVolley`, MSB-2), предохранитель на `MAX_COMBAT_ROUNDS` и конец боя по гибели
 * ЛЮБОЙ стороны (§0.0 №5 «цепочка»).
 *
 * `hostile` спрашивается у вызывающего, потому что вражда живёт в состоянии, а прогноз
 * чистый: у него нет ни шины, ни дипломатии. Не передали — все против всех (так считает
 * и ядро без модуля дипломатии, `isHostile` вырождается в «разные владельцы враждебны»).
 */
export function previewSides(
  input: readonly PreviewSideInput[],
  data: GameData,
  hostile?: (a: string | null | undefined, b: string | null | undefined) => boolean,
): MultiBattlePreview {
  // damageUnits мутирует то, что ему дали, — симуляция идёт по приватным копиям.
  const live = input.map((s) => deepClone(s.units as UnitStack[]).filter((x) => x.count > 0));
  const enemies = (i: number): number[] => {
    const out: number[] = [];
    for (let j = 0; j < input.length; j++) {
      if (j === i || !alive(live[j]!)) continue;
      if (hostile ? hostile(input[i]!.owner, input[j]!.owner) : true) out.push(j);
    }
    return out;
  };
  let rounds = 0;
  let stalemate = false;
  while (live.every((u) => alive(u))) {
    rounds += 1;
    // Как и у живого предохранителя: счётчик ПРЕВЫШАЕТ кап, сам раунд не считается.
    if (rounds > MAX_COMBAT_ROUNDS) {
      stalemate = true;
      break;
    }
    const incoming = new Array<number>(input.length).fill(0);
    let anyFired = false;
    for (let i = 0; i < input.length; i++) {
      if (!alive(live[i]!)) continue;
      const foes = enemies(i);
      if (foes.length === 0) continue;
      anyFired = true;
      const volley = cappedUnitStat(
        live[i]!,
        data,
        input[i]!.role === 'attacker' ? 'attack' : 'defense',
      );
      const share = volleyShare(volley, foes.length);
      for (const j of foes) incoming[j]! += share;
    }
    // Никто никому не враг — бой не идёт вовсе, и крутить его до предохранителя значило
    // бы обещать игроку 240 раундов там, где не будет ни одного (живой такт закрывает
    // такой бой перемирием, CMB-7).
    if (!anyFired) {
      stalemate = true;
      break;
    }
    for (let i = 0; i < input.length; i++) {
      if (incoming[i]! > 0) live[i] = damageUnits(live[i]!, incoming[i]!, data).survivors;
    }
  }
  const survivorCount = live.filter((u) => alive(u)).length;
  const sideOf = (before: readonly UnitStack[], after: UnitStack[]): BattlePreviewSide => {
    const total = hullPool(before, data);
    const fraction = total > 0 ? 1 - hullPool(after, data) / total : 0;
    return { survivors: after, losses: lossesOf(before, after), damageFraction: fraction };
  };
  return {
    outcome: !stalemate && survivorCount === 1 ? 'decided' : 'stalemate',
    roundsEst: rounds,
    sides: input.map((s, i) => sideOf(s.units, live[i]!)),
  };
}

/**
 * Forecast a battle between `attacker` (the aggressor: strikes with `attack`)
 * and `defender` (returns fire with `defense`) — fleet vs fleet, or a landing
 * force vs a garrison (the engine is the same for every combatant kind).
 * Pure and deterministic; the inputs are never mutated.
 */
export function previewBattle(
  attacker: readonly UnitStack[],
  defender: readonly UnitStack[],
  data: GameData,
): BattlePreview {
  // Дуэль — ЧАСТНЫЙ СЛУЧАЙ многостороннего расклада, а не отдельный алгоритм (MSB-6).
  // Двусторонняя петля, стоявшая здесь, повторяла правила боя своими словами; теперь
  // они произносятся один раз в `previewSides`, и разойтись двум прогнозам негде.
  const sim = previewSides(
    [
      { units: attacker, role: 'attacker' },
      { units: defender, role: 'defender' },
    ],
    data,
  );
  const a = sim.sides[0]!.survivors;
  const d = sim.sides[1]!.survivors;
  const rounds = sim.roundsEst;
  const stalemate = sim.outcome === 'stalemate';
  const aAlive = alive(a);
  const dAlive = alive(d);
  const outcome: BattlePreview['outcome'] =
    !stalemate && aAlive && !dAlive
      ? 'attacker'
      : !stalemate && dAlive && !aAlive
        ? 'defender'
        : 'stalemate';
  // No clamp needed: survivors are a subset of `before` whose pools only ever
  // shrink (damageUnits subtracts, never adds), so the ratio is in [0,1] by
  // construction — same insertion order, term-wise smaller, monotone float sum.
  const side = (before: readonly UnitStack[], after: UnitStack[]): BattlePreviewSide => {
    const total = hullPool(before, data);
    const fraction = total > 0 ? 1 - hullPool(after, data) / total : 0;
    return { survivors: after, losses: lossesOf(before, after), damageFraction: fraction };
  };
  return {
    outcome,
    roundsEst: rounds,
    attacker: side(attacker, a),
    defender: side(defender, d),
  };
}

/** Total units lost by a forecast side — the one-glance number for a HUD readout. */
export function previewLossCount(side: BattlePreviewSide): number {
  return side.losses.reduce((n, s) => n + s.count, 0);
}
