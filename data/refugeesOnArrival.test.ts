/**
 * БЕЖЕНЦЫ ПОЯВЛЯЮТСЯ ПО ПРИБЫТИИ (заказ владельца 2026-09-29).
 *
 * Транспорты беженцев в задачах эвакуации глав II и IV стояли флотом игрока с первой
 * секунды забега. Теперь карта держит их ждущими (`joinsOnArrival`): в игру они входят,
 * когда к ним прибыл флот игрока с живым кораблём, а до того задача метит место, где
 * они ждут.
 */
import { describe, expect, it } from 'vitest';
import {
  buildStateFromMap,
  createKernel,
  missionFactsModule,
  parseMatchMap,
  type Context,
  type GameModule,
  type GameState,
  type MatchConfig,
  visibleState,
} from '../packages/shared-core/src/index';
import { missionTargets } from '../decisions/missionView';
import { shippedGameData } from './bundle';
import pve2 from './maps/pve-2.json';
import pve4 from './maps/pve-4.json';
import pve6 from './maps/pve-6.json';

const data = shippedGameData();

const bell: GameModule = {
  id: 'test-bell',
  version: '1.0.0',
  setup(api) {
    api.onAction('test.arrived', (action, h) => h.emit('fleet.arrived', action.payload));
  },
};
const kernel = createKernel([missionFactsModule, bell]);
const ctx: Context = { now: 0, data, config: { timeScale: 1 } as MatchConfig };

describe.each([
  ['pve-2', pve2, 'deep_drift', 'p1_1', false],
  ['pve-4', pve4, 'lab_outpost', 'p1_1', false],
  // Глава VI: доки — место эпизода (PVR-8.4), задача метит их, когда о доках узнали.
  ['pve-6', pve6, 'quarantine_docks', 'p1_1', true],
])('%s: транспорты беженцев ждут прибытия флота игрока', (_id, raw, site, escort, episode) => {
  const start = (): GameState => buildStateFromMap(parseMatchMap(raw), data);

  it('на старте их нет среди флотов — они ждут на месте, и задача метит это место', () => {
    const s = start();
    expect(s.fleets.p1_evac).toBeUndefined();
    expect(s.planets[site]?.awaitingFleets?.map((f) => f.id)).toEqual(['p1_evac']);
    const evac = parseMatchMap(raw).objectives.find((o) => o.kind === 'evac')!;
    expect(evac.revealedBy !== undefined).toBe(episode);
    if (episode) {
      expect(missionTargets(evac, s, 'p1')).toEqual([]);
      s.missionFacts = { ...s.missionFacts, found: { p1: [site] } };
    }
    expect(missionTargets(evac, s, 'p1')).toContain(site);
  });

  it('ждущий флот виден только владельцу', () => {
    const s = start();
    expect(visibleState(s, 'p1', data).planets[site]?.awaitingFleets).toHaveLength(1);
    expect(visibleState(s, 'swarm', data).planets[site]?.awaitingFleets).toBeUndefined();
  });

  it('флот игрока прибыл — транспорты входят в игру там же', () => {
    const s = start();
    s.fleets[escort]!.location = site;
    const r = kernel.applyAction(
      s,
      { id: 'a1', type: 'test.arrived', playerId: 'p1', payload: { fleetId: escort, at: site }, issuedAt: 0 },
      ctx,
    );
    if (!r.ok) throw new Error(r.code);
    expect(r.state.fleets.p1_evac).toMatchObject({ owner: 'p1', location: site });
    expect(r.state.fleets.p1_evac?.units.every((u) => u.unit === 'evac_transport')).toBe(true);
    expect(r.state.planets[site]?.awaitingFleets).toBeUndefined();
  });
});
