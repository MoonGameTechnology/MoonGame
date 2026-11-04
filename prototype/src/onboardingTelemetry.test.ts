import { describe, expect, it } from 'vitest';
import { tutorialAnalytics } from '../../packages/client/src/tutorialAnalytics';
import { parseTelemetryBatch, type TelemetryProps } from '../../packages/protocol/src/telemetry';
import { SpotlightTour, type SpotlightStep } from './spotlight';

const attempt = 'a'.repeat(32);
describe('tutorial observations', () => {
  it('records real transitions once, stage skips and the terminal checkpoint in the existing wire format', () => {
    const emitted: TelemetryProps[] = [];
    let now = 100;
    const analytics = tutorialAnalytics({ guide: 'main', attempt, from: 0, total: 3,
      now: () => now, emit: (p) => emitted.push(p) });
    const steps: SpotlightStep[] = ['economy.a', 'economy.b', 'assault.a'].map((id) => ({
      id, stage: id.split('.')[0], target: null, copy: 'test', advance: { on: 'tap' },
    }));
    const tour = new SpotlightTour(steps, { locate: () => null, render: () => {} },
      () => analytics.finish('completed'), analytics);
    tour.start(); tour.refresh(); tour.refresh();
    now = 200; tour.skipStage(); tour.tap();
    analytics.checkpoint('pagehide'); analytics.finish('exited');
    expect(emitted.map((p) => p.action)).toEqual(['started', 'step', 'stage_skipped', 'step', 'completed']);
    expect(emitted.at(-1)).toMatchObject({ step: 'assault.a', index: 2, skippedStages: 1, elapsedMs: 100 });
    expect(parseTelemetryBatch({ v: 1, install: 'install01', session: 'session01', build: 'test',
      events: emitted.map((p, i) => ({ id: `event000${i}`, e: 'onboarding_step', t: 200, p })) })).toMatchObject({ ok: true, dropped: 0 });
  });

  it('retains a resumed step on hidden/pagehide without claiming completion or exit', () => {
    const emitted: TelemetryProps[] = [];
    const a = tutorialAnalytics({ guide: 'sector-zero', attempt, from: 17, total: 100,
      now: () => 0, emit: (p) => emitted.push(p) });
    a.enter({ id: 'combat.attack', stage: 'combat' }, 17);
    a.checkpoint('hidden'); a.checkpoint('pagehide'); a.checkpoint('visible');
    a.checkpoint('heartbeat'); a.finish('exited');
    expect(emitted.map((p) => p.action)).toEqual(['started', 'step', 'hidden', 'pagehide', 'visible', 'heartbeat', 'exited']);
    expect(emitted.every((p) => p.from === 17)).toBe(true);
    expect(emitted.at(-1)).toMatchObject({ step: 'combat.attack', index: 17 });
  });

  it('never lets a broken analytics consumer stop the actual lesson', () => {
    const a = tutorialAnalytics({ guide: 'hud', attempt, from: 0, total: 1,
      now: () => 0, emit: () => { throw Error('offline'); } });
    const tour = new SpotlightTour([{ id: 'welcome', target: null, copy: 'test', advance: { on: 'tap' } }],
      { locate: () => null, render: () => {} }, () => a.finish('completed'), a);
    tour.start(); tour.tap(); expect(tour.active).toBe(false);
  });
});
