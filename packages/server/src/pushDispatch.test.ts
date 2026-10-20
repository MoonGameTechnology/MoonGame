import { describe, expect, it, vi } from 'vitest';
import { createPushDispatcher } from './pushDispatch';
import type { SendPushResult } from './push';

const SUB = { endpoint: 'https://push.example/x', keys: { p256dh: 'k', auth: 'a' } };
const attack = {
  kind: 'events' as const,
  seq: 1,
  events: [{ type: 'battle.started', payload: { location: 'w1', attacker: 'p2', defender: 'p1' } }],
};
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(result: SendPushResult = { ok: true }) {
  const store = { of: vi.fn(async () => SUB), remove: vi.fn(async () => {}) };
  const send = vi.fn(async () => result);
  const observe = createPushDispatcher({ store, send });
  return { store, send, observe };
}

describe('UIX-4.3 · push dispatcher over the room observation stream', () => {
  it('sends the grouped push to the account of a seat whose player is away', async () => {
    const { send, observe } = setup();
    observe('m1', { kind: 'join', playerId: 'p1', accountId: 'acc1' });
    observe('m1', { kind: 'leave', playerId: 'p1' });
    observe('m1', attack);
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(SUB, {
      key: 'push.attacked',
      params: { place: 'w1' },
      anchor: 'w1',
      matchId: 'm1',
      more: 0,
    });
  });

  it('a player in the game sees it on screen — no push; one of two tabs closing keeps them in', async () => {
    const { send, observe } = setup();
    observe('m1', { kind: 'join', playerId: 'p1', accountId: 'acc1' });
    observe('m1', attack);
    observe('m1', { kind: 'join', playerId: 'p1', accountId: 'acc1' });
    observe('m1', { kind: 'leave', playerId: 'p1' });
    observe('m1', attack);
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it('a seat without an account (nick mode, bots) gets nothing; neither does news that is not theirs', async () => {
    const { send, observe } = setup();
    observe('m1', { kind: 'join', playerId: 'p1' });
    observe('m1', { kind: 'leave', playerId: 'p1' });
    observe('m1', { kind: 'join', playerId: 'p3', accountId: 'acc3' });
    observe('m1', { kind: 'leave', playerId: 'p3' });
    observe('m1', attack);
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it('a gone endpoint is dropped from the store; matches are tracked apart', async () => {
    const { store, observe } = setup({ ok: false, gone: true });
    observe('m1', { kind: 'join', playerId: 'p1', accountId: 'acc1' });
    observe('m1', { kind: 'leave', playerId: 'p1' });
    observe('m2', attack); // nobody known in m2
    await flush();
    expect(store.of).not.toHaveBeenCalled();
    observe('m1', attack);
    await flush();
    expect(store.remove).toHaveBeenCalledWith('acc1');
  });

  it('only the kinds the player allowed go out; `more` counts only allowed ones (UIX-4.4)', async () => {
    const store = {
      of: vi.fn(async () => ({ ...SUB, kinds: ['researched' as const] })),
      remove: vi.fn(async () => {}),
    };
    const send = vi.fn(async (): Promise<SendPushResult> => ({ ok: true }));
    const observe = createPushDispatcher({ store, send });
    observe('m1', { kind: 'join', playerId: 'p1', accountId: 'acc1' });
    observe('m1', { kind: 'leave', playerId: 'p1' });
    observe('m1', attack); // attacks switched off — nothing goes out
    await flush();
    expect(send).not.toHaveBeenCalled();
    observe('m1', {
      kind: 'events',
      seq: 2,
      events: [
        ...attack.events,
        { type: 'technology.researched', payload: { playerId: 'p1', technology: 'radar' } },
      ],
    });
    await flush();
    expect(send).toHaveBeenCalledWith(expect.anything(), {
      key: 'push.researched',
      params: { technology: 'radar' },
      matchId: 'm1',
      more: 0,
    });
  });

  it('the match end forgets its seats', async () => {
    const { send, observe } = setup();
    observe('m1', { kind: 'join', playerId: 'p1', accountId: 'acc1' });
    observe('m1', { kind: 'leave', playerId: 'p1' });
    observe('m1', { kind: 'end', winner: null });
    observe('m1', attack);
    await flush();
    expect(send).not.toHaveBeenCalled();
  });
});
