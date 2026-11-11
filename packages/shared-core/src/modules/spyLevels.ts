import { hoursToMs } from '../action/types';
import type { GameModule, HandlerContext } from '../kernel/module';
import type { PlayerId } from '../state/gameState';
import {
  SPY_RECON_XP_HOURS,
  SPY_XP,
  spyLevel,
  spyLevelBonus,
  splitGuardXp,
} from '../state/spyLevel';
import { findSpy, stepSpy, type SpyStep } from '../util/spyLife';

/**
 * Spy experience and levels (owner's resolution 2026-11-10). It listens to what the
 * espionage module announces and keeps `Spy.xp`; the level (`spyLevel`, 0–3) bends the
 * espionage pipelines. Without this module every spy works as a recruit.
 *
 * Experience:
 *   - a successful theft, research theft, sabotage, queue delay or economic disruption —
 *     `SPY_XP.deed` (a failure gives nothing; a spy killed on the deed takes nothing home);
 *   - a recon spy on post — `SPY_XP.reconStep` for every full `SPY_RECON_XP_HOURS` it
 *     survives there; an unfinished span earns nothing, an earned step is kept;
 *   - counter-intelligence: a hostile spy caught on a world where guards stood — catch /
 *     kill / turn (`SPY_XP`), split between every guard there, allies' included
 *     (`splitGuardXp`: the most experienced takes the most). A catch by the bureau alone,
 *     with no guard on the world, gives nobody experience. A guard's own sweep that catches
 *     a hostile guard gives that one guard the catch or the kill.
 *
 * Bonuses per level (`SPY_LEVEL_BONUS`): success chance, lower odds of detection,
 * quality of the deed (`espionage.quality`) and travel speed (`espionage.speed`).
 */

interface SpyArgs {
  playerId?: string;
  spyId?: number;
}

/** The level of the spy a pipeline call names; 0 when it names none. */
function levelOf(h: HandlerContext, args: unknown): number {
  const { playerId, spyId } = (args ?? {}) as SpyArgs;
  if (typeof playerId !== 'string' || typeof spyId !== 'number') return 0;
  return spyLevel(findSpy(h.state, playerId, spyId)?.xp);
}

function award(h: HandlerContext, owner: PlayerId, spyId: number, points: number): void {
  const spy = findSpy(h.state, owner, spyId);
  if (!spy || points <= 0) return;
  const before = spyLevel(spy.xp);
  spy.xp = (spy.xp ?? 0) + points;
  const level = spyLevel(spy.xp);
  h.emit('espionage.xp', { owner, spyId, xp: spy.xp, gained: points, level });
  if (level > before) h.emit('espionage.levelUp', { owner, spyId, level });
}

const DEEDS: ReadonlySet<string> = new Set(['theft', 'research', 'sabotage', 'delay', 'disrupt']);

export const spyLevelsModule: GameModule = {
  id: 'spy-levels',
  version: '1.0.0',
  setup(api) {
    api.hook<number>(
      'espionage.chance',
      (v, args, h) => v + spyLevelBonus('chance', levelOf(h, args)),
    );
    api.hook<number>(
      'espionage.detect',
      (v, args, h) => v - spyLevelBonus('detect', levelOf(h, args)),
    );
    api.hook<number>(
      'espionage.quality',
      (v, args, h) => v * (1 + spyLevelBonus('quality', levelOf(h, args))),
    );
    api.hook<number>(
      'espionage.speed',
      (v, args, h) => v * (1 + spyLevelBonus('speed', levelOf(h, args))),
    );

    api.on('espionage.succeeded', (event, h) => {
      const p = event.payload as { owner: string; spyId?: number; kind: string; agentLost?: true };
      // A spy lost on the deed is already replaced: the recruit earned nothing.
      if (typeof p.spyId === 'number' && !p.agentLost && DEEDS.has(p.kind))
        award(h, p.owner, p.spyId, SPY_XP.deed);
    });

    // Recon: a surviving spy took up its post — the first full day starts now.
    api.on('intel.stolen', (event, h) => {
      const p = event.payload as { owner: string; spyId?: number; layer?: number };
      if (typeof p.spyId !== 'number' || p.layer === undefined) return;
      const spy = findSpy(h.state, p.owner, p.spyId);
      if (!spy?.posted || spy.mission === undefined) return;
      const step: SpyStep = { spy: p.owner, spyId: p.spyId, mission: spy.mission };
      h.schedule(h.ctx.now + hoursToMs(h.ctx, SPY_RECON_XP_HOURS), 'spyLevels.reconDay', step);
    });

    api.on('spyLevels.reconDay', (event, h) => {
      const step = event.payload as SpyStep;
      const spy = stepSpy(h.state, step);
      if (!spy?.posted || spy.op !== 'recon') return; // recalled or caught before the day was out
      award(h, step.spy, step.spyId, SPY_XP.reconStep);
      h.schedule(h.ctx.now + hoursToMs(h.ctx, SPY_RECON_XP_HOURS), 'spyLevels.reconDay', step);
    });

    // Counter-intelligence: the guards on the world share the catch.
    api.on('espionage.detected', (event, h) => {
      const p = event.payload as {
        guards?: { owner: string; spyId: number }[];
        killed?: true;
        turned?: true;
      };
      const guards = (p.guards ?? []).filter((g) => findSpy(h.state, g.owner, g.spyId));
      if (guards.length === 0) return;
      const total = p.turned ? SPY_XP.turn : p.killed ? SPY_XP.kill : SPY_XP.catch;
      const split = splitGuardXp(
        total,
        guards.map((g) => findSpy(h.state, g.owner, g.spyId)!.xp ?? 0),
      );
      guards.forEach((g, i) => award(h, g.owner, g.spyId, split[i]!));
    });

    api.on('espionage.counter.caught', (event, h) => {
      const p = event.payload as { owner: string; guardSpyId?: number; killed?: true };
      if (typeof p.guardSpyId === 'number')
        award(h, p.owner, p.guardSpyId, p.killed ? SPY_XP.kill : SPY_XP.catch);
    });
  },
};
