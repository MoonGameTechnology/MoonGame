import { describe, expect, it } from 'vitest';
import { createInitialState, offerKey, type GameState, type IntelGrant } from '../packages/shared-core/src/index';
import { intelLayers } from './intelLayers';

function world(): GameState {
  const s = createInitialState({ seed: 'il', version: { data: '0.1.0', manifest: '1' } });
  const player = (id: string) => ({ id, name: id, faction: '', status: 'active' as const, resources: {} });
  s.players = { p1: player('p1'), p2: player('p2'), p3: player('p3'), p4: player('p4') };
  s.players.p2!.resources = { credits: 120.7, metal: 0.4 };
  s.players.p2!.technologies = { completed: [], active: [{ technology: 'optics', startedAt: 0, completesAt: 9 }] };
  s.planets = {
    B: {
      id: 'B',
      owner: 'p2',
      position: { x: 0, y: 0 },
      resources: {},
      buildings: [],
      garrison: [],
      traits: [],
      buildQueue: [{ id: 3, kind: 'unit', playerId: 'p2', unit: 'cruiser', count: 2 }],
    },
  };
  s.scheduled = [
    { id: 'evt:1', at: 5, seq: 1, type: 'construction.complete', payload: { planetId: 'B', playerId: 'p2', building: 'mine' } },
    { id: 'evt:2', at: 6, seq: 2, type: 'construction.complete', payload: { planetId: 'Z', playerId: 'p3', building: 'yard' } },
  ];
  s.diplomacyOffers = { [offerKey('p2', 'p3')]: 'peace', [offerKey('p3', 'p4')]: 'pact' };
  return s;
}
const grant = (layer?: number): IntelGrant => ({ kind: 'planet', target: 'B', until: 99, ...(layer ? { layer } : {}) });

describe('intelLayers — what each recon layer shows (SPY-13)', () => {
  it('rule 1: a window without a layer is the first layer only', () => {
    expect(intelLayers(world(), grant())).toEqual({ layer: 1 });
  });

  it('layer 2: the owner treasury, whole units only', () => {
    expect(intelLayers(world(), grant(2))).toEqual({ layer: 2, treasury: [['credits', 120]] });
  });

  it('layer 3: the order under way first, then the queue, and the owner research', () => {
    const v = intelLayers(world(), grant(3));
    expect(v.building).toEqual(['mine', 'cruiser']);
    expect(v.research).toEqual(['optics']);
    expect(v.offers).toBeUndefined();
  });

  it('rule 2: an open layer stays even when empty', () => {
    const s = world();
    s.players.p2!.resources = {};
    s.planets.B!.buildQueue = [];
    s.scheduled = [];
    expect(intelLayers(s, grant(3))).toEqual({ layer: 3, treasury: [], building: [], research: ['optics'] });
  });

  it('rule 4: layer 4 shows the offers the owner is party to, not third parties', () => {
    expect(intelLayers(world(), grant(4)).offers).toEqual([{ from: 'p2', to: 'p3', stance: 'peace' }]);
  });

  it('rule 3: the CURRENT owner — a world that changed hands shows its new holder', () => {
    const s = world();
    s.planets.B!.owner = 'p3';
    s.players.p3!.resources = { credits: 5 };
    expect(intelLayers(s, grant(2)).treasury).toEqual([['credits', 5]]);
  });
});
