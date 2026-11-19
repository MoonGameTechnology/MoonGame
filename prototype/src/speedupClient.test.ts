import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** TEC-3.2: the speed-up request keeps its id until a final answer. */
const net = vi.hoisted(() => ({ match: 'm1' as string | null }));
vi.mock('./netSession', () => ({ serverMatchId: () => net.match }));
const toasts = vi.hoisted(() => [] as string[]);
vi.mock('./toastStack', () => ({ toast: (msg: string) => toasts.push(msg) }));

import { requestSpeedup, setSpeedupAuth, speedupPaid } from './speedupClient';

type Reply = { status: number; body: Record<string, unknown> } | 'network';
let replies: Reply[] = [];
const sent: Array<Record<string, unknown>> = [];

beforeEach(() => {
  vi.useFakeTimers();
  replies = [];
  sent.length = 0;
  toasts.length = 0;
  net.match = 'm1';
  setSpeedupAuth(async () => ({ base: 'https://host', token: 'tok' }));
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    expect(url).toBe('https://host/matches/m1/speedup');
    sent.push(JSON.parse(init.body) as Record<string, unknown>);
    const reply = replies.shift() ?? { status: 200, body: { ok: true, sovereigns: 11 } };
    if (reply === 'network') throw new Error('offline');
    return { status: reply.status, json: async () => reply.body };
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const settle = async () => {
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(5000);
};

describe('speedup client (TEC-3.2)', () => {
  it('a paid button only in a network match', () => {
    expect(speedupPaid()).toBe(true);
    net.match = null;
    expect(speedupPaid()).toBe(false);
  });

  it('sends the order and reports the debit', async () => {
    requestSpeedup({ kind: 'construction', seq: 4 }, 1);
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'construction', seq: 4, hours: 1 });
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toContain('11');
  });

  it('an unknown answer is retried under the SAME request id', async () => {
    replies = [{ status: 503, body: { error: 'E_UNAVAILABLE' } }, 'network'];
    requestSpeedup({ kind: 'research', technology: 'optics' }, 0.5);
    await settle();
    expect(sent).toHaveLength(3);
    expect(new Set(sent.map((b) => b.requestId)).size).toBe(1);
    expect(sent[0]).toMatchObject({ kind: 'research', technology: 'optics', hours: 0.5 });
  });

  it('an unresolved request goes first: a new tap resends it instead of starting another', async () => {
    replies = [
      { status: 503, body: {} },
      { status: 503, body: {} },
      { status: 503, body: {} },
    ];
    requestSpeedup({ kind: 'construction', seq: 4 }, 1);
    await settle();
    expect(sent).toHaveLength(3);
    expect(toasts.at(-1)).toBeTruthy(); // «повторим при следующем входе»
    requestSpeedup({ kind: 'construction', seq: 9 }, 1);
    await settle();
    expect(sent).toHaveLength(4);
    expect(sent[3]).toMatchObject({ requestId: sent[0]!.requestId, seq: 4 });
    // Resolved — the next tap is a new request.
    requestSpeedup({ kind: 'construction', seq: 9 }, 1);
    await settle();
    expect(sent[4]).toMatchObject({ seq: 9 });
    expect(sent[4]!.requestId).not.toBe(sent[0]!.requestId);
  });

  it('a refusal is final and names the refund', async () => {
    replies = [{ status: 409, body: { error: 'E_NOT_ACTIVE', refunded: 11 } }];
    requestSpeedup({ kind: 'construction', seq: 4 }, 1);
    await settle();
    expect(sent).toHaveLength(1);
    expect(toasts[0]).toContain('11');
  });

  it('a lost session keeps the request for later instead of forgetting a possible debit', async () => {
    replies = [{ status: 503, body: {} }];
    let session = true;
    setSpeedupAuth(async () => (session ? { base: 'https://host', token: 'tok' } : null));
    requestSpeedup({ kind: 'construction', seq: 4 }, 1);
    await vi.advanceTimersByTimeAsync(10);
    session = false;
    await settle();
    expect(sent).toHaveLength(1);
    session = true;
    requestSpeedup({ kind: 'construction', seq: 9 }, 1);
    await settle();
    expect(sent[1]).toMatchObject({ requestId: sent[0]!.requestId, seq: 4 });
  });

  it('without a session nothing is sent', async () => {
    setSpeedupAuth(async () => null);
    requestSpeedup({ kind: 'construction', seq: 4 }, 1);
    await settle();
    expect(sent).toHaveLength(0);
    expect(toasts).toHaveLength(1);
  });
});
