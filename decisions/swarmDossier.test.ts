import { describe, expect, it } from 'vitest';
import { createInitialState } from '../packages/shared-core/src/index';
import { orderContacts, swarmDossier, swarmDossierSummary } from './swarmDossier';

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

describe('Swarm dossier — сводка и порядок (досье справа, сворачиваемое)', () => {
  it('сводка считает известные силы и те, что на радаре сейчас', () => {
    expect(swarmDossierSummary([])).toEqual({ seen: 0, live: 0 });
    expect(swarmDossierSummary([{ live: true }, { live: false }, { live: true }])).toEqual({
      seen: 3,
      live: 2,
    });
  });

  it('сначала то, что на радаре сейчас, затем по свежести, при равенстве — по id', () => {
    const c = (id: string, live: boolean, at: number) => ({ id, live, at });
    const ordered = orderContacts([
      c('a-old', false, 100),
      c('z-live', true, 50),
      c('b-fresh', false, 900),
      c('a-live', true, 50),
    ]);
    expect(ordered.map((x) => x.id)).toEqual(['a-live', 'z-live', 'b-fresh', 'a-old']);
  });

  it('входной список не трогает — порядок строится на копии', () => {
    const input = [
      { id: 'b', live: false, at: 1 },
      { id: 'a', live: true, at: 1 },
    ];
    orderContacts(input);
    expect(input.map((x) => x.id)).toEqual(['b', 'a']);
  });
});
