/**
 * Разведка в журнале событий: впервые опознанный чужой мир или флот — строка со всем,
 * что о нём видно в этот миг. Правила — `decisions/scoutReport.ts`; здесь проводка:
 * зрение кадра (`mapFog.ts`), мир на экране и журнал (`eventFeed.ts`).
 *
 * Работает только при смене зрения: пока мир прежний, `vision` — тот же объект, и нового
 * ему сказать нечего. И не чаще раза в секунду: на открытой большой карте опознано больше
 * тысячи миров, а сверка нужна игроку, а не кадру.
 */
import type { Fleet, GameState } from '../../packages/shared-core/src/index';
import { getStance } from '../../packages/shared-core/src/index';
import { isMineFleet } from '../../packages/shared-core/src/state/minefields';
import { isMissileFleet } from '../../packages/shared-core/src/state/ordnance';
import { t, tData } from '../../localization/runtime';
import { headcount } from '../../decisions/battleReport';
import { freshTargets, scoutParts } from '../../decisions/scoutReport';
import { note } from './eventFeed';
import { data } from './gameData';
import { fleetNode, fleetSeen, vision, type Vision } from './mapFog';

/** Что сверке нужно от игры. */
export interface ScoutHost {
  world: GameState;
  me: string;
  names: Record<string, string>;
  placeName(id: string): string;
}

/** Сверка не чаще (мс реального времени). */
const SCOUT_EVERY_MS = 1000;

const seenWorlds = new Set<string>();
const seenFleets = new Set<string>();
/** Первый взгляд партии уже снят (правило 2). */
let baseline = false;
let lastVision: Vision | null = null;
let lastAtMs = -Infinity;

/** Смена матча: названные цели принадлежат старому. */
export function resetScoutNews(): void {
  seenWorlds.clear();
  seenFleets.clear();
  baseline = false;
  lastVision = null;
  lastAtMs = -Infinity;
}

/** Чужой и не союзный владелец (правило 3). */
function foreign(s: GameState, me: string, owner: string | null | undefined): owner is string {
  if (!owner || owner === me) return false;
  const stance = getStance(s, me, owner);
  return stance !== 'alliance' && stance !== 'pact';
}

/** Сверить зрение кадра с названными целями и написать новые. Зовётся каждым кадром. */
export function tickScoutNews(host: ScoutHost, nowMs: number): void {
  const v = vision;
  if (!v) return; // туман выключен (песочница): разведывать нечего
  if (v === lastVision || nowMs - lastAtMs < SCOUT_EVERY_MS) return;
  lastVision = v;
  lastAtMs = nowMs;
  const s = host.world;
  if (s.match.status === 'ended') return;
  const me = host.me;

  // Видимые чужие флоты, по узлу: стоящие у мира входят в его строку (правило 4).
  const fleets: Fleet[] = [];
  const atNode = new Map<string, Fleet[]>();
  for (const f of Object.values(s.fleets)) {
    if (!foreign(s, me, f.owner) || isMineFleet(f, data) || isMissileFleet(f, data)) continue;
    if (headcount(f.units) === 0 || !fleetSeen(f)) continue;
    fleets.push(f);
    if (!f.movement && f.location) {
      const list = atNode.get(f.location) ?? [];
      list.push(f);
      atNode.set(f.location, list);
    }
  }

  if (!baseline) {
    for (const id of v.identify) seenWorlds.add(id);
    for (const f of fleets) seenFleets.add(f.id);
    baseline = true;
    return;
  }

  const worlds = freshTargets(seenWorlds, v.identify, (id) => foreign(s, me, s.planets[id]?.owner));
  for (const id of v.identify) seenWorlds.add(id);
  for (const id of worlds) {
    const p = s.planets[id]!;
    const orbit = atNode.get(id) ?? [];
    for (const f of orbit) seenFleets.add(f.id);
    const what = scoutParts({
      garrison: headcount(p.garrison),
      buildings: p.buildings.map((b) => ({ name: tData(data.buildings[b.type]?.name ?? b.type), level: b.level })),
      fleets: orbit.length,
      ships: orbit.reduce((n, f) => n + headcount(f.units), 0),
    })
      .map((part) => t(part.key, part.params))
      .join(', ');
    note(t('log.scout.world', { at: host.placeName(id), who: host.names[p.owner!] ?? p.owner!, what }), id, { quiet: true });
  }

  for (const id of freshTargets(seenFleets, fleets.map((f) => f.id), () => true)) {
    const f = s.fleets[id]!;
    const node = fleetNode(f);
    if (!node) continue; // узла нет — сказать «где» нечего; скажем, когда появится
    seenFleets.add(id);
    note(
      t('log.scout.fleet', { who: host.names[f.owner] ?? f.owner, n: headcount(f.units), at: host.placeName(node) }),
      node,
      { quiet: true },
    );
  }
}
