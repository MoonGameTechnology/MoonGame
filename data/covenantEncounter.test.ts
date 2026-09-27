import { describe, expect, it } from 'vitest';
import { getStance, playablePlayerIds, type GameState } from '../packages/shared-core/src/index';
import { pveObjectives, pveState, shippedGameData, trainingState } from '../packages/client/src/gameData';
import { data } from '../prototype/src/gameData';
import { kernel } from '../prototype/src/protoKernel';
import { objectiveProgress, shownObjectives } from '../decisions/missionObjectives';
import { missionTargets } from '../decisions/missionView';
import { retireDoneEncounters } from '../decisions/retiredEncounters';
import { runAiSeats } from '../decisions/runAiSeats';

const objective = () => pveObjectives(0).find((o) => o.id === 'mission.claim-colony')!;
const ctx = (now: number) => ({ now, data, config: { timeScale: 1 } });

describe('Chapter I: liberate Echo from the Covenant of Unity', () => {
  it('loads the occupiers as a hostile human encounter, not a playable or expanding seat', () => {
    for (const catalog of [data, shippedGameData()]) {
      const state = pveState(catalog, 0);
      expect(state.planets.home_b!.owner).toBe('covenant');
      expect(state.players.covenant).toMatchObject({ name: 'Covenant of Unity', faction: 'vanguard' });
      expect(state.players.covenant!.ai).not.toBe(true);
      expect(getStance(state, 'p1', 'covenant')).toBe('war');
      expect(playablePlayerIds(state)).not.toContain('covenant');
      expect([...runAiSeats(state, 'p1', 'weak').keys()]).toEqual(['p3']);
      expect(objectiveProgress(objective(), state, 'p1').complete).toBe(false);
      expect(missionTargets(objective(), state, 'p1')).toEqual(['home_b']);
      expect(shownObjectives(pveObjectives(), []).map((o) => o.id)).toContain(objective().id);
    }
  });

  it('requires defeating the garrison and capturing the planet, not merely reaching orbit', () => {
    let state = pveState(data, 0);
    // Start at the objective with troops drawn from the chapter's existing home garrison.
    const fleet = state.fleets.p1_1!;
    fleet.location = 'home_b';
    fleet.orbit = 'near';
    fleet.landing = state.planets.home_a!.garrison;
    state.planets.home_a!.garrison = [];
    expect(objectiveProgress(objective(), state, 'p1').complete).toBe(false);
    const assault = kernel.applyAction(state, {
      id: 'liberate-echo', type: 'fleet.assault', playerId: 'p1', issuedAt: 0,
      payload: { fleetId: fleet.id },
    }, ctx(0));
    if (!assault.ok) throw new Error(assault.code);
    state = assault.state;
    expect(Object.values(state.battles).some((b) => b.location === 'home_b' && b.phase === 'ground')).toBe(true);
    for (let hour = 1; hour <= 48 && state.planets.home_b!.owner !== 'p1'; hour++) {
      const step = kernel.advanceTo(state, ctx(hour * 3_600_000));
      if (!step.ok) throw new Error(step.code);
      expect(step.failures).toEqual([]);
      state = step.state;
    }
    expect(state.planets.home_b!.owner).toBe('p1');
    expect(objectiveProgress(objective(), state, 'p1')).toMatchObject({ complete: true, reward: 3 });
    expect(missionTargets(objective(), state, 'p1')).toEqual([]);
  });

  it('honours the saved objective id and retires the completed occupation on later runs', () => {
    const start = pveState(data, 0);
    const done = ['mission.claim-colony'];
    const restored: GameState = JSON.parse(JSON.stringify(retireDoneEncounters(start, pveObjectives(), done)));
    expect(restored.players.covenant).toBeUndefined();
    expect(restored.planets.home_b!.owner).toBeNull();
    expect(restored.planets.home_b!.garrison).toEqual([]);
    expect(shownObjectives(pveObjectives(), done).map((o) => o.id)).not.toContain(objective().id);
    expect(start.planets.home_b!.owner).toBe('covenant');
    expect(restored.planets.pirate_den!.owner).toBe('pirates');
  });

  it('does not introduce the Covenant into the training range or other shipped chapters', () => {
    for (const state of [trainingState(data), pveState(data, 1), pveState(data, 2)]) {
      expect(state.players.covenant).toBeUndefined();
    }
  });
});
