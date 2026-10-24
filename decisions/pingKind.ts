/** Single-point tactical markers exposed by the map composer. Wire arrow/build kinds remain valid. */
export const PING_MARKER_KINDS = ['mark', 'defend', 'attack'] as const;
export type PingMarkerKind = (typeof PING_MARKER_KINDS)[number];
export const PING_KIND_LABEL = {
  mark: 'ping.kind.mark',
  defend: 'ping.kind.defend',
  attack: 'ping.kind.attack',
} as const;

/** Old session messages have no kind; preserve their original pin. */
export function pingMarkerKind(kind?: string): PingMarkerKind {
  return kind === 'defend' || kind === 'attack' ? kind : 'mark';
}

export function pingGlyph(kind?: string): string {
  return kind === 'defend' ? '🛡' : kind === 'attack' ? '🗡' : '📍';
}

/** Ping expiry uses the authoritative match clock, including its lobby pause and time scale. */
export function pingIsActive(ping: { pingExpiresAt?: number }, now: number): boolean {
  return ping.pingExpiresAt === undefined || ping.pingExpiresAt > now;
}
