import { describe, expect, it } from 'vitest';
import { createInitialState } from '../packages/shared-core/src/index';
import { swarmDossier } from './swarmDossier';

describe('Swarm dossier observations', () => {
  it('does not derive status from hidden live changes and replaces counts after recontact', () => {
    const s = createInitialState({ seed: 'dossier', version: { data: '1', manifest: '1' } });
    s.players.p2 = { id: 'p2', name: 'Swarm', faction: 'swarm', status: 'active', resources: {} };
    s.swarmIntel = { p1: { encounter: { owner: 'p2', location: 'A', at: 1000,
      units: [{ unit: 'swarm_drone', count: 7 }] } } };
    s.fleets.encounter = { id: 'encounter', owner: 'p2', location: 'B', movement: null, traits: [],
      units: [{ unit: 'swarm_guard', count: 15 }] };
    const hidden = swarmDossier(s, 'p1', new Set());
    expect(hidden[0]).toMatchObject({ live: false, location: 'A', units: [{ unit: 'swarm_drone', count: 7 }] });
    const live = swarmDossier(s, 'p1', new Set(['B']));
    expect(live[0]).toMatchObject({ live: true, location: 'B', units: [{ unit: 'swarm_guard', count: 15 }] });
    delete s.fleets.encounter;
    expect(swarmDossier(s, 'p1', new Set())).toEqual(hidden);
  });
});
