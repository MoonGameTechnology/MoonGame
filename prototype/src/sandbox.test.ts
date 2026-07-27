import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialState, setStance, getStance } from '../../packages/shared-core/src/index';
import type { GameState, Hero, Planet } from '../../packages/shared-core/src/index';
import {
  sandboxConfig,
  resetSandboxConfig,
  resetSandboxRuntime,
  sbAddResource,
  sbReadyCommanders,
  sbEndWars,
  enforceSandbox,
  isBuildAction,
} from './sandbox';

// Pure single-player "practice tools": one-shot commands mutate the local solo state,
// and the two held toggles (immortal home / frozen queues) are enforced every frame.

function base(): GameState {
  const s = createInitialState({ seed: 'sbx', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: {
      p1: { id: 'p1', name: 'You', resources: { credits: 100 } },
      p2: { id: 'p2', name: 'Foe', resources: {} },
    },
  } as unknown as GameState;
}

beforeEach(() => {
  resetSandboxConfig();
  resetSandboxRuntime();
});

describe('sandbox — one-shot commands', () => {
  it('sbAddResource grants +2000 to the treasury (stacking)', () => {
    const s = base();
    sbAddResource(s, 'p1', 'metal');
    expect(s.players.p1!.resources.metal).toBe(2000);
    sbAddResource(s, 'p1', 'metal');
    expect(s.players.p1!.resources.metal).toBe(4000);
    sbAddResource(s, 'p1', 'credits');
    expect(s.players.p1!.resources.credits).toBe(2100); // added to the existing 100
  });

  it('sbReadyCommanders readies my commanders but keeps a death timer', () => {
    const s = base();
    s.heroes = {
      h1: { id: 'h1', owner: 'p1', location: 'A', cooldowns: { strike: 5000, respawn: 9000 } },
      h2: { id: 'h2', owner: 'p2', location: 'B', cooldowns: { strike: 5000 } },
    } as Record<string, Hero>;
    expect(sbReadyCommanders(s, 'p1')).toBe(true); // cleared a pending ability
    expect(s.heroes.h1!.cooldowns).toEqual({ respawn: 9000 }); // ability cleared, death timer kept
    expect(s.heroes.h2!.cooldowns).toEqual({ strike: 5000 }); // the rival's hero is untouched
  });

  it('sbEndWars returns every war I am in to neutral (peace), including the FFA default', () => {
    const s = base();
    s.players.p3 = { id: 'p3', name: 'Third', resources: {} } as GameState['players'][string];
    setStance(s, 'p1', 'p2', 'war');
    setStance(s, 'p2', 'p3', 'war'); // a war I'm not part of
    // p1↔p3 has no record → the FFA default is `war`, so it counts too.
    const msg = sbEndWars(s, 'p1');
    expect(getStance(s, 'p1', 'p2')).toBe('peace');
    expect(getStance(s, 'p1', 'p3')).toBe('peace'); // default war → ended as well
    expect(getStance(s, 'p2', 'p3')).toBe('war'); // untouched — not my war
    expect(msg).toContain('2');
  });
});

describe('sandbox — held toggles', () => {
  it('isBuildAction flags the paid construction intents only', () => {
    expect(isBuildAction('building.construct')).toBe(true);
    expect(isBuildAction('unit.build')).toBe(true);
    expect(isBuildAction('fleet.move')).toBe(false);
  });

  it('immortalHome re-asserts ownership and re-seeds an empty garrison', () => {
    const s = base();
    s.planets = {
      home: { id: 'home', owner: 'p2', position: { x: 0, y: 0 }, buildings: [], garrison: [] },
    } as unknown as Record<string, Planet>;
    sandboxConfig.enabled = true;
    sandboxConfig.immortalHome = true;
    enforceSandbox(s, 'p1', 'home');
    expect(s.planets.home!.owner).toBe('p1'); // captured world flipped straight back
    expect(s.planets.home!.garrison.length).toBeGreaterThan(0); // defensible again
    // toggle off ⇒ ownership is no longer forced
    sandboxConfig.immortalHome = false;
    s.planets.home!.owner = 'p2';
    enforceSandbox(s, 'p1', 'home');
    expect(s.planets.home!.owner).toBe('p2');
  });

  it('instantCooldown readies my commanders every frame while held', () => {
    const s = base();
    s.heroes = {
      h1: { id: 'h1', owner: 'p1', location: 'A', cooldowns: { strike: 5000 } },
    } as Record<string, Hero>;
    sandboxConfig.enabled = true;
    enforceSandbox(s, 'p1', null); // toggle off → untouched
    expect(s.heroes.h1!.cooldowns).toEqual({ strike: 5000 });
    sandboxConfig.instantCooldown = true;
    enforceSandbox(s, 'p1', null);
    expect(s.heroes.h1!.cooldowns).toEqual({}); // held ready
  });

  it('freezeQueues holds construction.complete events forward, then releases them', () => {
    const s = base();
    s.time = 0;
    s.scheduled = [{ id: 'evt:1', at: 100, type: 'construction.complete', payload: {}, seq: 1 }];
    sandboxConfig.enabled = true;
    sandboxConfig.freezeQueues = true;
    enforceSandbox(s, 'p1', null); // captures remaining = 100
    expect(s.scheduled[0]!.at).toBe(100);
    s.time = 80; // world moved on
    enforceSandbox(s, 'p1', null);
    expect(s.scheduled[0]!.at).toBe(180); // still 100 ahead — never becomes due
    // release: the event keeps its last `at` and resumes counting down
    sandboxConfig.freezeQueues = false;
    enforceSandbox(s, 'p1', null);
    expect(s.scheduled[0]!.at).toBe(180);
  });

  it('fog is on by default — turning it off is what reveals the map', () => {
    expect(sandboxConfig.fog).toBe(true);
  });

  it('instantBuild pulls every pending construction.complete due at once', () => {
    const s = base();
    s.time = 50;
    s.scheduled = [
      { id: 'evt:1', at: 100, type: 'construction.complete', payload: {}, seq: 1 },
      { id: 'evt:2', at: 30, type: 'construction.complete', payload: {}, seq: 2 }, // already due
      { id: 'evt:3', at: 200, type: 'unit.build', payload: {}, seq: 3 }, // unrelated event
    ];
    sandboxConfig.enabled = true;
    enforceSandbox(s, 'p1', null); // toggle off → untouched
    expect(s.scheduled[0]!.at).toBe(100);
    sandboxConfig.instantBuild = true;
    enforceSandbox(s, 'p1', null);
    expect(s.scheduled[0]!.at).toBe(50); // pulled to now → fires next advance
    expect(s.scheduled[1]!.at).toBe(30); // already past `now` → left alone
    expect(s.scheduled[2]!.at).toBe(200); // not a construction event → untouched
  });
});
