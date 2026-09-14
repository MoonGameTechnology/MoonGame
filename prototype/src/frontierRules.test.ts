import { describe, expect, it } from 'vitest';
import { getStance, playablePlayerIds, visibleState } from '../../packages/shared-core/src/index';
import { newGame, networkSeats } from './matchSetup';
import { aiOrders } from './ai';
import { advance, ctx, kernel, order } from './protoKernel';
import { data } from './gameData';
import { mapNodesFromState } from './mapCatalog';

const world = () => newGame({ mapId: 'frontier-100', seats: networkSeats('ffa', 'frontier-100') });

describe('Frontier inhabitants', () => {
  it('keeps NPCs out of seating, starts pirates at war and neutral bases at peace', () => {
    const s = world();
    expect(playablePlayerIds(s)).toHaveLength(100);
    for (const p of Object.values(s.players).filter((p) => p.npc)) {
      expect(getStance(s, 'p1', p.id)).toBe(p.npc === 'pirate' ? 'war' : 'peace');
      const result = order(
        s,
        { id: `claim-${p.id}`, issuedAt: 0, type: 'seat.claim', playerId: p.id, payload: {} },
        0,
      );
      expect(result.error).toBe('E_FORBIDDEN');
    }
  });

  it('sends pirates out while neutral bases hold and develop', () => {
    const s = world();
    const pirate = Object.values(s.players).find((p) => p.npc === 'pirate')!.id;
    const neutral = Object.values(s.players).find((p) => p.npc === 'neutral')!.id;
    const raids = aiOrders(s, pirate);
    expect(raids.some((a) => a.type === 'fleet.move')).toBe(true);
    const defense = aiOrders(s, neutral);
    expect(defense.some((a) => a.type === 'fleet.move' || a.type === 'diplomacy.declare')).toBe(
      false,
    );
    expect(defense.some((a) => a.type === 'building.construct' || a.type === 'unit.build')).toBe(
      true,
    );
  });

  it('does not give inhabitants victories/rewards and eliminates a conquered base', () => {
    const s = world();
    const npc = Object.values(s.players).find((p) => p.npc)!.id;
    for (const p of Object.values(s.planets)) if (p.owner === npc) p.owner = 'p1';
    const next = advance(s, 1);
    expect(next.error).toBeUndefined();
    expect(next.state.players[npc]!.status).toBe('defeated');
    expect(Object.values(next.state.fleets).some((f) => f.owner === npc)).toBe(false);
    const result = kernel.advanceTo(next.state, {
      ...ctx(2, s),
      config: { timeScale: 1, victory: { endsAt: 2 } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.state.match.rewards ?? {})).toHaveLength(100);
    expect(Object.keys(result.state.match.rewards ?? {}).some((id) => s.players[id]!.npc)).toBe(
      false,
    );
  });

  it('restores authored geometry from a fogged network snapshot', () => {
    const s = world();
    const view = visibleState(s, 'p1', data);
    expect(view.mapId).toBe('frontier-100');
    const geometry = mapNodesFromState(view);
    expect(geometry.find((p) => p.id === 'F0')).toMatchObject({ sector: 'black_hole', links: [] });
    expect(geometry.filter((p) => p.sector === 'pirate_base')).toHaveLength(12);
  });

  it('allows pirates to defeat a lone player without becoming PvP winners', () => {
    const s = newGame({ mapId: 'frontier-100', seats: networkSeats('ffa', 'frontier-100').slice(0, 1) });
    expect(advance(s, 1).state.match.status).toBe('ongoing');
    for (const p of Object.values(s.planets)) if (p.owner === 'p1') p.owner = null;
    const ended = advance(s, 1);
    expect(ended.state.players.p1!.status).toBe('defeated');
    expect(ended.state.match).toMatchObject({ status: 'ended', winner: null, reason: 'elimination' });
  });
});
