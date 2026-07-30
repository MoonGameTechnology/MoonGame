import { describe, expect, it, vi } from 'vitest';
import type { Recap } from '@void/shared-core';

const sendNotification = vi.fn();
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}));

const { digestPushPayload, sendPush, vapidFromEnv } = await import('./push');

// ONB-5: the push payload formatter must never synthesize localized prose (server
// code has no business emitting player-facing text — see CLAUDE.md "Локализация").
// It may only reuse an already-localized RecapItem.text and numeric formatting.

function recap(items: Recap['items'], attention = 0, count = items.length): Recap {
  return { items, attention, count, from: 0, to: 0 };
}

describe('digestPushPayload', () => {
  it('uses the top item text verbatim as the title, no invented words', () => {
    const payload = digestPushPayload(
      recap([{ text: '⚔ Флот уничтожен у Vega-3', high: true, at: 10 }], 1),
      'match-1',
    );
    expect(payload.title).toBe('⚔ ⚔ Флот уничтожен у Vega-3');
    expect(payload.body).toBe('');
    expect(payload.matchId).toBe('match-1');
  });

  it('appends only a numeric +N for the remaining events, never prose', () => {
    const payload = digestPushPayload(
      recap(
        [
          { text: 'Событие A', high: false, at: 5 },
          { text: 'Событие B', high: false, at: 3 },
        ],
        0,
      ),
      'match-1',
    );
    expect(payload.title).toBe('Событие A');
    expect(payload.body).toBe('+1');
  });

  it('carries the top item anchor through when present', () => {
    const payload = digestPushPayload(
      recap([{ text: 'X', anchor: 'node-7', high: false, at: 1 }]),
      'match-1',
    );
    expect(payload.anchor).toBe('node-7');
  });

  it('an empty recap yields an empty title/body, no fallback prose', () => {
    const payload = digestPushPayload(recap([]), 'match-1');
    expect(payload.title).toBe('');
    expect(payload.body).toBe('');
    expect(payload.anchor).toBeUndefined();
  });
});

describe('vapidFromEnv', () => {
  it('is undefined when any VAPID var is missing', () => {
    expect(vapidFromEnv({})).toBeUndefined();
    expect(vapidFromEnv({ VAPID_PUBLIC_KEY: 'pub' })).toBeUndefined();
  });

  it('reads all three vars when present', () => {
    expect(
      vapidFromEnv({
        VAPID_PUBLIC_KEY: 'pub',
        VAPID_PRIVATE_KEY: 'priv',
        VAPID_SUBJECT: 'mailto:a@b.c',
      }),
    ).toEqual({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.c' });
  });
});

describe('sendPush', () => {
  const sub = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } };
  const payload = { title: 't', body: 'b', matchId: 'm' };

  it('reports ok on a successful send', async () => {
    sendNotification.mockResolvedValueOnce(undefined);
    await expect(sendPush(sub, payload)).resolves.toEqual({ ok: true });
  });

  it('reports gone:true on a 404/410 from the push service', async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 410 });
    await expect(sendPush(sub, payload)).resolves.toEqual({ ok: false, gone: true });
  });

  it('reports gone:false on any other failure, never throws', async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 500 });
    await expect(sendPush(sub, payload)).resolves.toEqual({ ok: false, gone: false });
  });
});
