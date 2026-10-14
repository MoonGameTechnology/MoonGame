/**
 * PTM-1.1 (docs/playtest-telemetry-roadmap.md): the client → server product-event batch.
 *
 * One dictionary for every platform: a funnel is comparable across the web build, the APK
 * and a portal only if the events are named the same everywhere. The prototype's platform
 * contract re-exports this list as `PLATFORM_EVENTS`; the server accepts nothing else.
 *
 * The parser is the server's gate, so it is strict and boring: an envelope that is not
 * exactly right is refused whole; an event inside a good envelope that is not exactly right
 * is dropped and counted. Props are flat and short (the Firebase limits are the yardstick:
 * ≤25 params, names ≤40 chars) — enough for "which step", never room for free text. Nothing
 * here identifies a person: `install` and `session` are random ids the client made up, and
 * the pseudonym `actor` is added by the server from the session token, never sent.
 */
export const TELEMETRY_EVENTS = [
  'session_started',
  'onboarding_step',
  'pve_started',
  'pve_completed',
  'pve_failed',
  'rewarded_ad_offered',
  'rewarded_ad_completed',
  'iap_started',
  'iap_completed',
  'meta_unlock',
] as const;
export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[number];

export type TelemetryProps = Record<string, string | number | boolean>;

/** Envelope schema version; bumped only by an incompatible change to the batch shape. */
export const TELEMETRY_VERSION = 1;
export const TELEMETRY_MAX_EVENTS = 20;
/** The whole request body, bytes. Twenty full events fit with room to spare. */
export const TELEMETRY_BODY_MAX = 8192;
export const TELEMETRY_MAX_PROPS = 25;
export const TELEMETRY_VALUE_MAX = 120;

export interface TelemetryEvent {
  /** Client-made id, so a resent batch can be de-duplicated in analysis. */
  id: string;
  e: TelemetryEventName;
  /** Client clock, ms. Kept for ordering inside a session; the server stamps its own. */
  t: number;
  p?: TelemetryProps;
}

export interface TelemetryBatch {
  v: typeof TELEMETRY_VERSION;
  /** Random per browser profile (localStorage). */
  install: string;
  /** Random per page load. */
  session: string;
  build: string;
  events: TelemetryEvent[];
}

export type TelemetryParse =
  | { ok: true; batch: TelemetryBatch; dropped: number }
  | { ok: false };

const ID = /^[A-Za-z0-9-]{8,64}$/;
const BUILD = /^[\x21-\x7e]{1,40}$/;
const PROP_KEY = /^[a-z][a-zA-Z0-9_]{0,39}$/;
// Printable, no control characters: a value lands in a JSONL line someone greps.
const PROP_TEXT = /^[^\p{Cc}]*$/u;
const NAMES: ReadonlySet<string> = new Set(TELEMETRY_EVENTS);

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

function parseProps(raw: unknown): TelemetryProps | undefined | null {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length > TELEMETRY_MAX_PROPS) return null;
  const props: TelemetryProps = {};
  for (const key of keys) {
    if (!PROP_KEY.test(key)) return null;
    const value = raw[key];
    if (typeof value === 'boolean') props[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) props[key] = value;
    else if (
      typeof value === 'string' &&
      value.length <= TELEMETRY_VALUE_MAX &&
      PROP_TEXT.test(value)
    )
      props[key] = value;
    else return null;
  }
  return props;
}

function parseEvent(raw: unknown): TelemetryEvent | null {
  if (!isObject(raw)) return null;
  for (const key of Object.keys(raw)) if (!['id', 'e', 't', 'p'].includes(key)) return null;
  const { id, e, t } = raw;
  if (typeof id !== 'string' || !ID.test(id)) return null;
  if (typeof e !== 'string' || !NAMES.has(e)) return null;
  if (typeof t !== 'number' || !Number.isSafeInteger(t) || t < 0) return null;
  const p = parseProps(raw.p);
  if (p === null) return null;
  return p === undefined
    ? { id, e: e as TelemetryEventName, t }
    : { id, e: e as TelemetryEventName, t, p };
}

/** Validate a decoded request body. Never throws. */
export function parseTelemetryBatch(body: unknown): TelemetryParse {
  if (!isObject(body)) return { ok: false };
  for (const key of Object.keys(body))
    if (!['v', 'install', 'session', 'build', 'events'].includes(key)) return { ok: false };
  const { v, install, session, build, events } = body;
  if (v !== TELEMETRY_VERSION) return { ok: false };
  if (typeof install !== 'string' || !ID.test(install)) return { ok: false };
  if (typeof session !== 'string' || !ID.test(session)) return { ok: false };
  if (typeof build !== 'string' || !BUILD.test(build)) return { ok: false };
  if (!Array.isArray(events) || events.length < 1 || events.length > TELEMETRY_MAX_EVENTS)
    return { ok: false };
  const kept: TelemetryEvent[] = [];
  for (const raw of events) {
    const ev = parseEvent(raw);
    if (ev) kept.push(ev);
  }
  return {
    ok: true,
    batch: { v: TELEMETRY_VERSION, install, session, build, events: kept },
    dropped: events.length - kept.length,
  };
}
