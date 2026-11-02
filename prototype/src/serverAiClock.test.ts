import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  stewardActive,
  type Player,
} from '../../packages/shared-core/src/index';
import { StaggeredAi } from './aiScheduler';
import { serverAiHeartbeat } from './serverAiClock';

function setup(until = 1500) {
  const state = createInitialState({
    seed: 'offline-watch',
    version: { data: 'test', manifest: '1' },
  });
  state.time = 1000;
  state.players.p1 = {
    id: 'p1',
    name: 'Owner',
    faction: 'azure',
    status: 'active',
    resources: {},
    steward: { posture: 'active_defend', until },
  } as Player;
  const room = { state, isStarted: true, clockScale: 2 };
  const schedule = new StaggeredAi<string>(2000);
  schedule.reset(state.time);
  const policy = (seat: string): string | null => {
    const posture = stewardActive(state, seat, state.time);
    return posture ? `steward:${posture}` : null;
  };
  return { room, schedule, policy };
}

describe('server AI heartbeat', () => {
  it('wakes on the watch deadline when it precedes the next AI phase', () => {
    const { room, schedule, policy } = setup();
    expect(schedule.nextDelay(room.state.time, ['p1'], policy)).toBe(2000);
    expect(serverAiHeartbeat(room, schedule, policy, 50)).toBe(250);
    room.clockScale = 10;
    expect(serverAiHeartbeat(room, schedule, policy, 50)).toBe(50);
  });

  it('a nearer decision phase wins over a longer watch', () => {
    const { room, schedule, policy } = setup(10000);
    expect(serverAiHeartbeat(room, schedule, policy, 50)).toBe(1000);
  });

  it('recall, expiry and ineligible seats leave no background heartbeat', () => {
    const { room, schedule, policy } = setup();
    expect(serverAiHeartbeat(room, schedule, () => null, 50)).toBeNull();
    room.state.time = 1500;
    expect(serverAiHeartbeat(room, schedule, policy, 50)).toBeNull();
    delete room.state.players.p1!.steward;
    expect(serverAiHeartbeat(room, schedule, policy, 50)).toBeNull();
  });

  it('autonomous bots still get their deadline, and stopped/ended matches get none', () => {
    const { room, schedule } = setup();
    delete room.state.players.p1!.steward;
    const bot = () => 'bot:expand';
    expect(serverAiHeartbeat(room, schedule, bot, 50)).toBe(1000);
    room.isStarted = false;
    expect(serverAiHeartbeat(room, schedule, bot, 50)).toBeNull();
    room.isStarted = true;
    room.state.match.status = 'ended';
    expect(serverAiHeartbeat(room, schedule, bot, 50)).toBeNull();
  });

  it('pending work wakes promptly, without a zero-delay loop', () => {
    const { room, schedule, policy } = setup(10000);
    room.state.time = 3000;
    schedule.step(room.state.time, ['p1'], policy, () => ['build']);
    expect(serverAiHeartbeat(room, schedule, policy, 50)).toBe(50);
  });
});
