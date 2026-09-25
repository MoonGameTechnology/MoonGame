import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { pveModule } from './pve';
import { victoryModule } from './victory';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { AdvanceResult, Context, MatchConfig } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

// PVR-2.5 — «победа — выстоять» (решение владельца 2026-09-23) на стыке двух модулей:
// срок ставит `pveModule` на последней волне, вердикт выносит `victoryModule`. По
// отдельности каждый проверен рядом (`pve.test.ts`, `victory.test.ts`); здесь — что они
// встречаются на шине, не зная друг друга, и что вердикт падает В САМ срок.

const HOUR = MS_PER_HOUR;
const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: { drone: { faction: 'swarm', stats: { attack: 3, defense: 1, speed: 10 } } },
  factions: {
    swarm: { name: 'Swarm', startingLoadout: { fleet: [{ unit: 'drone', count: 1 }] } },
    vanguard: { name: 'Vanguard' },
  },
  buildings: {},
  events: {},
  modes: {
    held: {
      name: 'Held',
      modules: ['pve'],
      pve: { waves: 2, npcFaction: 'swarm', waveIntervalHours: 6, holdHours: 5 },
    },
  },
});
const kernel = createKernel([pveModule, victoryModule]);
const ctx = (now: number): Context => ({
  now,
  data,
  config: { timeScale: 1, modeId: 'held' } as MatchConfig,
});
const player = (id: string, faction: string): Player => ({
  id,
  name: id,
  faction,
  status: 'active',
  resources: {},
});
const planet = (id: string, owner: string | null): Planet => ({
  id,
  owner,
  position: { x: 0, y: 0 },
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
  kind: 'planet',
});
function world(): GameState {
  const base = createInitialState({ seed: 'hold', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...base,
    players: { human: player('human', 'vanguard'), swarm: player('swarm', 'swarm') },
    planets: { home: planet('home', 'human'), hive: planet('hive', 'swarm') },
  };
}
function ok(r: AdvanceResult): GameState {
  if (!r.ok) throw new Error('advance failed: ' + r.code);
  return r.state;
}
/** Заведённый забег: первая волна взведена на 6-й час, вторая (последняя) — на 12-й. */
const seeded = (): GameState => ok(kernel.advanceTo(world(), ctx(HOUR)));

describe('PvE: удержание после последней волны кончает забег победой (PVR-2.5)', () => {
  it('выстоявший побеждает В САМ срок, даже если хост шагнул далеко за него', () => {
    // Один шаг с 1-го часа на 40-й. Без отметки `pve.hold` вердикт выносился бы в конце
    // шага — на 40-м; с ней — ровно на 17-м (12 + 5), как и обещано игроку отсчётом.
    const state = ok(kernel.advanceTo(seeded(), ctx(40 * HOUR)));
    expect(state.planets.hive?.owner).toBe('swarm'); // улей стоит — и это не мешает победе
    expect(state.match).toMatchObject({
      status: 'ended',
      reason: 'pve-cleared',
      winner: 'human',
      endedAt: 17 * HOUR,
    });
  });

  it('до срока забег идёт', () => {
    const state = ok(kernel.advanceTo(seeded(), ctx(16 * HOUR)));
    expect(state.pve?.holdUntil).toBe(17 * HOUR);
    expect(state.match.status).toBe('ongoing');
  });

  it('павший до срока проигрывает — удержание не засчитывается задним числом', () => {
    const mid = ok(kernel.advanceTo(seeded(), ctx(13 * HOUR)));
    const fallen: GameState = {
      ...mid,
      planets: { ...mid.planets, home: { ...mid.planets.home!, owner: 'swarm' } },
    };
    const state = ok(kernel.advanceTo(fallen, ctx(40 * HOUR)));
    expect(state.match).toMatchObject({ status: 'ended', reason: 'pve-failed', winner: 'swarm' });
  });
});

describe('PVR-6.29 — «Завершить экспедицию» (решение владельца 2026-09-25)', () => {
  // Флот потерян, а Рой штурмует дом минут десять — игрок вправе закончить забег сам. Сдача
  // — действие `pveModule`; вердикт выносит `victoryModule` на том же правиле, что и гибель
  // последнего мира: живых людей нет → `pve-failed`, тем же засчётом.
  const abandon = (state: GameState, playerId = 'human') =>
    kernel.applyAction(
      state,
      { id: `ab:${playerId}`, type: 'pve.abandon', playerId, payload: {}, issuedAt: HOUR },
      ctx(HOUR),
    );

  it('сдача кончает забег поражением сразу, не дожидаясь хода часов', () => {
    const r = abandon(seeded());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.human!.status).toBe('defeated');
    expect(r.state.match).toMatchObject({ status: 'ended', reason: 'pve-failed', winner: 'swarm' });
    expect(r.events.map((e) => e.type)).toContain('pve.abandoned');
  });

  it('сдаться может только человек и только в идущем забеге', () => {
    expect(abandon(seeded(), 'swarm')).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
    expect(abandon(seeded(), 'ghost')).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
    expect(abandon(world())).toMatchObject({ ok: false, code: 'E_NOT_PVE' }); // забег не засеян
    const done = abandon(seeded());
    if (!done.ok) throw new Error('abandon failed');
    expect(abandon(done.state)).toMatchObject({ ok: false, code: 'E_MATCH_ENDED' });
  });
});
