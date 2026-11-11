import type { HandlerContext, ModuleSetupApi } from '../../kernel/module';
import type { ResourceBag } from '../../data/schemas';
import type { GameState, PlayerId, Spy } from '../../state/gameState';
import { BASE_SPY_AGENTS, spyRoster } from '../../state/spyTravel';
import { finiteOr, networkSize } from '../../util/spyLife';
import { DISRUPT_FACTOR } from '../../util/spyDeeds';

/** A spy's base pay, credits per game-day (owner's request 2026-11-11). Between a frigate
 *  (16) and a cruiser (32): three spies cost about what two cruisers do. The
 *  `espionage.salary` pipeline (args `{ playerId, spyId }`) may bend it per spy. */
export const SPY_SALARY = 24;

/** The spies `playerId` pays (`size` — the network a registry not yet created stands for).
 *  Every spy of the network is on the payroll wherever it is — at rest, on the road, at
 *  work or lying low; a slot whose spy was killed or turned (`recruit`) is empty until the
 *  replacement arrives. A turned enemy agent (SPY-18) is paid by the side it now serves.
 *  Map inhabitants and defeated players hire nobody. */
export function paidSpies(state: GameState, playerId: PlayerId, size = BASE_SPY_AGENTS): Spy[] {
  const player = state.players[playerId];
  if (!player || player.npc !== undefined || player.status !== 'active') return [];
  return spyRoster(state, playerId, size).filter((spy) => spy.state !== 'recruit');
}

/** What `playerId` pays their spies per game-day, credits. */
export function spySalary(h: HandlerContext, playerId: PlayerId): number {
  let total = 0;
  for (const spy of paidSpies(h.state, playerId, networkSize(h, playerId))) {
    const raw = h.hook<number>('espionage.salary', SPY_SALARY, { playerId, spyId: spy.id });
    total += Math.max(0, finiteOr(raw, SPY_SALARY));
  }
  return total;
}

/** Where espionage meets the economy, registered from the espionage module's setup. */
export function registerEspionageEconomy(api: ModuleSetupApi): void {
  // SPY-15: a disrupted world produces `DISRUPT_FACTOR` of its output. A span never
  // runs across the end (it is a scheduled event), so «until ≥ now» at the span's end
  // means the whole span was disrupted.
  api.hook<ResourceBag>('economy.production', (bag, args, h) => {
    const planetId = (args as { planetId?: string } | undefined)?.planetId;
    const until = planetId ? h.state.planets[planetId]?.disruptedUntil : undefined;
    if (until === undefined || until < h.ctx.now) return bag;
    const out: Record<string, number> = {};
    for (const res of Object.keys(bag)) out[res] = (bag[res] ?? 0) * DISRUPT_FACTOR;
    return out;
  });

  api.on('espionage.disrupt.end', (event, h) => {
    const planet = h.state.planets[(event.payload as { planetId: string }).planetId];
    // An extended term leaves this end early: the cut stays until its own end fires.
    if (planet?.disruptedUntil !== undefined && planet.disruptedUntil <= h.ctx.now)
      delete planet.disruptedUntil;
  });

  // Spies are paid with the rest of the player's daily bill (`economy.upkeep`), so unpaid
  // pay leaves the credits in arrears like an unpaid army.
  api.hook<ResourceBag>('economy.upkeep', (bag, args, h) => {
    const playerId = (args as { playerId?: unknown } | undefined)?.playerId;
    if (typeof playerId !== 'string') return bag;
    const pay = spySalary(h, playerId);
    return pay > 0 ? { ...bag, credits: (bag.credits ?? 0) + pay } : bag;
  });
}
