/** Local single-player checkpoint. The world stays JSON; host-only policies travel
 * alongside it. No wall-clock catch-up and no dependency on a particular client. */
import { hashJson, type GameState } from '../packages/shared-core/src/index';

export interface SoloIntel {
  owner: string | null;
  garrison: number;
  buildings: Array<{ type: string; level: number }>;
}
export interface SoloSave {
  state: GameState;
  ai: Array<[string, 'weak' | 'strong']>;
  normalSpeed: number;
  fastSpeed: number;
  autoAssault: string[];
  patrols: Array<[string, { kind: 'planet' | 'fleet' }]>;
  memory: Array<[string, SoloIntel]>;
}

export function serializeSoloSave(save: SoloSave, rules: string): string {
  // Hash exactly what JSON will restore, including removal of undefined fields.
  const payload: unknown = JSON.parse(JSON.stringify(save));
  return JSON.stringify({ v: 1, rules, checksum: hashJson(payload), payload });
}
const record = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
const nonnegative = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0;
const pair = (x: unknown): x is [string, unknown] =>
  Array.isArray(x) && x.length === 2 && typeof x[0] === 'string';

/** Damaged/foreign versions are refused, never migrated or erased implicitly.
 * Checksum is corruption detection, not an authenticity/security boundary. */
export function parseSoloSave(raw: string | null, rules: string): SoloSave | null {
  if (!raw) return null;
  try {
    const env: unknown = JSON.parse(raw);
    if (
      !record(env) ||
      env.v !== 1 ||
      env.rules !== rules ||
      env.checksum !== hashJson(env.payload)
    )
      return null;
    const p = env.payload;
    if (!record(p) || !record(p.state)) return null;
    const s = p.state;
    const rng = s.rng;
    const players = s.players;
    const planets = s.planets;
    if (
      !nonnegative(s.time) ||
      !record(s.version) ||
      !record(rng) ||
      !['a', 'b', 'c', 'd'].every((k) => Number.isInteger(rng[k])) ||
      !record(players) ||
      !record(players.p1) ||
      !record(planets) ||
      !Object.keys(planets).length ||
      !record(s.fleets) ||
      !record(s.battles) ||
      !Array.isArray(s.scheduled) ||
      !nonnegative(s.scheduleSeq) ||
      !nonnegative(s.battleSeq) ||
      !record(s.match) ||
      s.match.status !== 'ongoing' ||
      s.pve !== undefined ||
      s.modeId !== undefined ||
      typeof s.mapId !== 'string'
    )
      return null;
    if (
      !nonnegative(p.normalSpeed) ||
      p.normalSpeed === 0 ||
      !nonnegative(p.fastSpeed) ||
      p.fastSpeed === 0 ||
      !Array.isArray(p.ai) ||
      !p.ai.every((x) => pair(x) && (x[1] === 'weak' || x[1] === 'strong') && x[0] in players) ||
      !Array.isArray(p.autoAssault) ||
      !p.autoAssault.every((x) => typeof x === 'string') ||
      !Array.isArray(p.patrols) ||
      !p.patrols.every(
        (x) => pair(x) && record(x[1]) && (x[1].kind === 'planet' || x[1].kind === 'fleet'),
      ) ||
      !Array.isArray(p.memory) ||
      !p.memory.every(
        (x) =>
          pair(x) &&
          x[0] in planets &&
          record(x[1]) &&
          (x[1].owner === null || typeof x[1].owner === 'string') &&
          nonnegative(x[1].garrison) &&
          Array.isArray(x[1].buildings) &&
          x[1].buildings.every(
            (b) => record(b) && typeof b.type === 'string' && nonnegative(b.level),
          ),
      )
    )
      return null;
    return p as unknown as SoloSave;
  } catch {
    return null;
  }
}
