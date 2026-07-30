import webpush from 'web-push';
import type { PushSubscriptionRecord } from './store';
import type { Recap } from '@void/shared-core';

/**
 * ONB-5 · Web Push — the send side. `buildRecap` (`@void/shared-core`) already
 * builds the "пока тебя не было" return digest; this is the thin adapter that
 * turns one into a push payload and hands it to `web-push` against a stored
 * subscription. No trigger logic here (deciding WHEN a digest is worth pushing,
 * per-account cooldown, etc.) — that is a separate, larger follow-up that needs
 * to track match membership + online/offline per account; this file is the
 * reusable primitive it will call.
 */

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** `mailto:` or `https:` contact URI the push service may use to reach the
   *  sender about a misbehaving subscriber — required by the VAPID spec. */
  subject: string;
}

/** Read VAPID config from the environment, or `undefined` if push isn't
 *  configured (graceful degradation — the API/driver simply skip sending). */
export function vapidFromEnv(env: NodeJS.ProcessEnv = process.env): VapidConfig | undefined {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return undefined;
  return { publicKey, privateKey, subject };
}

/** Wire the VAPID keypair into the `web-push` singleton (its own API is a
 *  module-level `setVapidDetails`, not an instantiable client). Call once at boot. */
export function configureWebPush(cfg: VapidConfig): void {
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
}

export interface DigestPushPayload {
  title: string;
  body: string;
  matchId: string;
  /** Map node to focus when the notification is tapped (the top item's anchor). */
  anchor?: string;
}

/** Turn a `Recap` (already built by `buildRecap`) into a push payload. Empty/no-
 *  attention recaps are the caller's business to filter — this only formats.
 *  No prose is synthesized here (localization is off-limits to this module): the
 *  title is the top item's own already-localised text (per `RecapItem.text`'s
 *  contract), with only a numeric `+N` suffix for the rest, never invented words. */
export function digestPushPayload(recap: Recap, matchId: string): DigestPushPayload {
  const top = recap.items[0];
  const rest = recap.count - (top ? 1 : 0);
  return {
    title: `${recap.attention > 0 ? '⚔ ' : ''}${top?.text ?? ''}`,
    body: rest > 0 ? `+${rest}` : '',
    matchId,
    ...(top?.anchor ? { anchor: top.anchor } : {}),
  };
}

export type SendPushResult =
  | { ok: true }
  /** The push service reported the endpoint permanently gone (404/410) — the
   *  caller should drop the stored subscription so it stops retrying it. */
  | { ok: false; gone: boolean };

/** Send one payload to one subscription. Never throws — a dead/invalid endpoint
 *  is reported back as `{ok:false}`, not a crash of whatever loop is sending
 *  digests to many accounts. */
export async function sendPush(
  sub: PushSubscriptionRecord,
  payload: DigestPushPayload,
): Promise<SendPushResult> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      JSON.stringify(payload),
    );
    return { ok: true };
  } catch (err) {
    const statusCode = (err as { statusCode?: number } | null)?.statusCode;
    return { ok: false, gone: statusCode === 404 || statusCode === 410 };
  }
}
