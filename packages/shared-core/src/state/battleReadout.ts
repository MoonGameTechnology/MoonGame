import type { Context } from '../action/types';
import type { Kernel } from '../kernel/kernel';
import type { HookQuery, HookTrace } from '../kernel/module';
import type { BattleSide, GameState } from './gameState';
import { combatantKey } from './battle';
import { getStance } from './diplomacy';
import { mitigationFromPool, sideAlive, sideUnits } from '../util/combat';
import { targetedVolley } from '../util/groundTargets';

export interface BattleModifier {
  source: string;
  hook: string;
  value: number;
  direction: 'outgoing' | 'incoming';
  against: string | null;
  beneficial: boolean;
}

export interface BattleReadout {
  /** One attack, divided across the currently hostile participants. */
  attack: number;
  /** Full response to ONE incoming attack; target composition can change it. */
  defense: { min: number; max: number };
  modifiers: BattleModifier[];
}

/** Evaluate the real optional hook pipelines on the caller's visible state.
 * Shares traceHooks with the fleet console; no copied perk formulas or state/RNG changes. */
export function inspectBattle(
  kernel: Kernel,
  state: GameState,
  ctx: Context,
  battleId: string,
): Record<string, BattleReadout> {
  const battle = state.battles[battleId];
  if (!battle) return {};
  const live = battle.sides.filter((s) => sideAlive(state, s.ref));
  const enemiesOf = (a: BattleSide): BattleSide[] =>
    live.filter(
      (b) =>
        a !== b &&
        (a.owner === null || b.owner === null
          ? a.owner !== b.owner
          : getStance(state, a.owner, b.owner) === 'war'),
    );
  const queries: HookQuery[] = [];
  const jobs: Array<{
    key: string;
    kind: 'attack' | 'defense' | 'incoming';
    against: string | null;
  }> = [];
  const queueShot = (
    side: BattleSide,
    enemy: BattleSide,
    kind: 'attack' | 'defense' | 'incoming',
  ): void => {
    const [a, b] = kind === 'incoming' ? [enemy, side] : [side, enemy];
    const role = kind === 'defense' ? 'defense' : 'attack';
    const divisor = role === 'defense' ? 1 : enemiesOf(a).length;
    const base =
      targetedVolley(sideUnits(state, a.ref) ?? [], sideUnits(state, b.ref) ?? [], ctx.data, role)
        .total / divisor;
    const args = {
      battleId,
      location: battle.location,
      phase: battle.phase,
      attacker: a.owner,
      defender: b.owner,
      ...(a.ref.kind === 'fleet' ? { attackerFleet: a.ref.fleetId } : {}),
    };
    queries.push(
      { name: 'combat.damage', base, args },
      { name: 'combat.damage.parallel', base: 0, args },
      { name: 'combat.mitigation', base: 0, args },
    );
    jobs.push({ key: combatantKey(side.ref), kind, against: enemy.owner });
  };
  const out: Record<string, BattleReadout> = {};
  const responses: Record<string, number[]> = {};
  for (const side of live) {
    const key = combatantKey(side.ref);
    out[key] = { attack: 0, defense: { min: 0, max: 0 }, modifiers: [] };
    responses[key] = [];
    for (const enemy of enemiesOf(side)) {
      queueShot(side, enemy, 'attack');
      queueShot(side, enemy, 'defense');
      queueShot(side, enemy, 'incoming');
    }
  }
  // One state clone for the whole battle, including target-specific modifiers.
  const traces = kernel.traceHooks(state, queries, ctx);
  if (!traces || traces.some((t) => typeof t.value !== 'number' || !Number.isFinite(t.value)))
    return {};
  for (const [i, job] of jobs.entries()) {
    const pipeline = traces.slice(i * 3, i * 3 + 3) as HookTrace<number>[];
    const [seq, par, pool] = pipeline;
    if (!seq || !par || !pool) return {};
    const damage = seq.value * (1 + par.value) * mitigationFromPool(pool.value);
    const current = out[job.key]!;
    if (job.kind === 'attack') current.attack += damage;
    if (job.kind === 'defense') responses[job.key]!.push(damage);
    const direction = job.kind === 'incoming' ? 'incoming' : 'outgoing';
    for (const trace of pipeline)
      for (const step of trace.steps) {
        const value =
          trace.name === 'combat.damage'
            ? step.before === 0
              ? 0
              : step.after / step.before - 1
            : step.after - step.before;
        if (!Number.isFinite(value) || Math.abs(value) < 1e-10) continue;
        const increasesDamage = trace.name === 'combat.mitigation' ? value < 0 : value > 0;
        const mod: BattleModifier = {
          source: step.module,
          hook: trace.name,
          value,
          direction,
          against: job.against,
          beneficial: direction === 'outgoing' ? increasesDamage : !increasesDamage,
        };
        if (
          !current.modifiers.some(
            (m) =>
              m.source === mod.source &&
              m.hook === mod.hook &&
              m.value === mod.value &&
              m.direction === direction &&
              m.against === mod.against,
          )
        )
          current.modifiers.push(mod);
      }
  }
  for (const key of Object.keys(out)) {
    const values = responses[key]!;
    if (values.length) out[key]!.defense = { min: Math.min(...values), max: Math.max(...values) };
  }
  return out;
}
