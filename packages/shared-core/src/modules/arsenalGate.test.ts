import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { constructionModule } from './construction';
import { heroModule } from './hero';
import { arsenalSyncModule } from './arsenalSync';
import {
  createInitialState,
  type GameState,
  type Planet,
  type Player,
  type PlayerArsenal,
} from '../state/gameState';
import { visibleState } from '../state/visibility';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context } from '../action/types';

// ARS-3 — the ownership gate: a seat carrying an arsenal SNAPSHOT builds/fits only
// what it owns (E_NOT_OWNED, fail-secure); a seat without one is unrestricted
// (regular/dev matches unchanged — graceful degradation). The snapshot is
// owner-private in the fog projection, like the treasury.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', stats: { attack: 5, defense: 5, speed: 5, hp: 40 }, cost: { metal: 10 }, slots: { weapon: 1 } },
    drone: { faction: 'x', stats: { attack: 1, defense: 1, speed: 10, hp: 6 }, cost: { metal: 3 } },
    hero: { faction: 'x', stats: { attack: 5, defense: 5, speed: 5, hp: 100 }, traits: ['hero'], slots: { weapon: 1 } },
    grunt: { faction: 'x', domain: 'ground', kind: 'infantry', stats: { attack: 2, defense: 2, speed: 1, hp: 10 }, cost: { metal: 2 } },
  },
  factions: {},
  buildings: {
    shipyard: { name: 'Shipyard', cost: {}, buildTimeHours: 0, hp: 20, enablesShipConstruction: true },
    barracks: { name: 'Barracks', cost: {}, buildTimeHours: 0, hp: 20, enablesInfantryConstruction: true },
  },
  events: {},
  modules: {
    railgun: { name: 'Railgun', slot: 'weapon', tag: 'horizontal', cost: { metal: 5 } },
    coilgun: { name: 'Coilgun', slot: 'weapon', tag: 'horizontal', cost: { metal: 5 } },
  },
  heroes: { commander: { name: 'Cmdr', ship: { unit: 'hero' } } },
});

const ctx = (now = 0): Context => ({ now, data });

function player(id: string, arsenal?: PlayerArsenal): Player {
  return {
    id,
    name: id,
    faction: 'x',
    status: 'active',
    resources: { metal: 100 },
    ...(arsenal ? { arsenal } : {}),
  };
}
function planet(id: string, owner: string | null): Planet {
  return {
    id,
    owner,
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [
      { type: 'shipyard', level: 1, hp: 20 },
      { type: 'barracks', level: 1, hp: 20 },
    ],
    garrison: [],
    traits: [],
  };
}
function stateWith(players: Player[]): GameState {
  const s = createInitialState({ seed: 'ars', version: { data: '0.1.0', manifest: '1' } });
  const rec: Record<string, Player> = {};
  for (const p of players) rec[p.id] = p;
  return { ...s, players: rec, planets: { A: planet('A', 'p1') } };
}
function build(unit: string, modules?: string[]): Action {
  return {
    id: 's:p1:1',
    type: 'unit.build',
    playerId: 'p1',
    payload: { planetId: 'A', unit, ...(modules ? { modules } : {}) },
    issuedAt: 0,
  };
}
function okApply(r: ApplyResult): ApplyResult & { ok: true } {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
function errCode(r: ApplyResult): string {
  if (r.ok) throw new Error('expected rejection, got ok');
  return r.code;
}

const OWNED: PlayerArsenal = { hulls: ['cruiser'], modules: ['railgun'] };

describe('unit.build × arsenal snapshot (ARS-3)', () => {
  const kernel = createKernel([constructionModule]);

  /**
   * АРСЕНАЛ — ПРО КОРАБЛИ (решение владельца 2026-09-15).
   *
   * Гейт не различал домен, и на гейтированном месте (человеческое кресло AvA) нельзя
   * было построить НИ ОДНОГО наземного юнита: снапшот перечисляет корпуса кораблей, а
   * пехота и техника в нём не значатся никогда. Кресло получало стартовый гарнизон и
   * теряло способность его пополнять — то есть захват миров закрывался вовсе, хотя
   * казармы с заводом стояли и ядро было готово принять заказ.
   *
   * Замысел арсенала (`docs/arsenal-roadmap.md`) — «корпуса КОРАБЛЕЙ, модули, фитинги
   * героев»; наземка в него не входила ни одного дня. Поэтому правило сузилось до
   * домена, а не список расширился: наземный род войск гейтят ЗДАНИЯ (казармы, завод),
   * и этого достаточно.
   */
  it('НАЗЕМНЫЙ юнит строится мимо снапшота — арсенал про корабли', () => {
    const st = (): GameState => stateWith([player('p1', OWNED)]);
    // Корабль вне снапшота по-прежнему отбивается...
    expect(errCode(kernel.applyAction(st(), build('drone'), ctx()))).toBe('E_NOT_OWNED');
    // ...а пехоты в снапшоте нет вовсе, и это больше не преграда.
    okApply(kernel.applyAction(st(), build('grunt'), ctx()));
  });

  it('здания наземку гейтят по-прежнему — сузился ТОЛЬКО арсенал', () => {
    const s = stateWith([player('p1', OWNED)]);
    s.planets.A!.buildings = [{ type: 'shipyard', level: 1, hp: 20 }]; // казарм нет
    expect(errCode(kernel.applyAction(s, build('grunt'), ctx()))).toBe('E_NO_BARRACKS');
  });

  it('звёзды корабля открывают слоты: лишний слот места пускает второй модуль (Sector Zero)', () => {
    const both: PlayerArsenal = { hulls: ['cruiser'], modules: ['railgun', 'coilgun'] };
    const two = build('cruiser', ['railgun', 'coilgun']);
    // У крейсера один оружейный слот — без звезды второй модуль некуда поставить…
    expect(errCode(kernel.applyAction(stateWith([player('p1', both)]), two, ctx()))).toBe('E_NO_SLOT');
    // …а звезда корабля этого места прибавила оружейный слот.
    const starred: PlayerArsenal = { ...both, slots: { cruiser: { weapon: 1 } } };
    okApply(kernel.applyAction(stateWith([player('p1', starred)]), two, ctx()));
  });

  it('an owned hull with an owned module builds; unowned are E_NOT_OWNED', () => {
    const st = (): GameState => stateWith([player('p1', OWNED)]);
    expect(okApply(kernel.applyAction(st(), build('cruiser', ['railgun']), ctx())).ok).toBe(true);
    // the hull is not in the snapshot
    expect(errCode(kernel.applyAction(st(), build('drone'), ctx()))).toBe('E_NOT_OWNED');
    // the hull is owned, but one module is not
    expect(errCode(kernel.applyAction(st(), build('cruiser', ['coilgun']), ctx()))).toBe(
      'E_NOT_OWNED',
    );
  });

  it('a seat WITHOUT a snapshot builds unrestricted (regular matches unchanged)', () => {
    const st = stateWith([player('p1')]);
    expect(okApply(kernel.applyAction(st, build('drone'), ctx())).ok).toBe(true);
  });
});

describe('hero.install × arsenal snapshot (ARS-3)', () => {
  const kernel = createKernel([heroModule]);
  const install = (moduleId: string): Action => ({
    id: 's:p1:2',
    type: 'hero.install',
    playerId: 'p1',
    payload: { heroId: 'hero:p1', moduleId },
    issuedAt: 0,
  });
  const withHero = (arsenal?: PlayerArsenal): GameState => {
    const st = stateWith([player('p1', arsenal)]);
    return {
      ...st,
      heroes: {
        'hero:p1': { id: 'hero:p1', owner: 'p1', location: 'A', cooldowns: {}, archetype: 'commander' },
      },
    };
  };

  // HPR-1.5.2: the hero's ship is fitted from the SAME `arsenal.modules` list a built
  // ship is — the ownership axis has one catalogue now, not one per equipment system.
  it('an owned module installs; an unowned one is E_NOT_OWNED; no snapshot = open', () => {
    expect(okApply(kernel.applyAction(withHero(OWNED), install('railgun'), ctx())).ok).toBe(true);
    expect(errCode(kernel.applyAction(withHero(OWNED), install('coilgun'), ctx()))).toBe(
      'E_NOT_OWNED',
    );
    expect(okApply(kernel.applyAction(withHero(), install('coilgun'), ctx())).ok).toBe(true);
  });
});

describe('arsenal.sync × live build-catalog ownership (LARS-1)', () => {
  const kernel = createKernel([constructionModule, arsenalSyncModule]);
  const sync = (payload: Partial<PlayerArsenal> | undefined): Action => ({
    id: 's:p1:3',
    type: 'arsenal.sync',
    playerId: 'p1',
    payload,
    issuedAt: 0,
  });

  it('a module bought mid-match becomes buildable right after the sync — no new snapshot/match needed', () => {
    const st = stateWith([player('p1', OWNED)]);
    // coilgun isn't in the boot-time snapshot yet.
    expect(errCode(kernel.applyAction(st, build('cruiser', ['coilgun']), ctx()))).toBe('E_NOT_OWNED');
    const grown: PlayerArsenal = { hulls: ['cruiser'], modules: ['railgun', 'coilgun'] };
    const synced = okApply(kernel.applyAction(st, sync(grown), ctx())).state;
    expect(okApply(kernel.applyAction(synced, build('cruiser', ['coilgun']), ctx())).ok).toBe(true);
  });

  it('a seat with NO snapshot at all refuses to sync one in (E_NO_SNAPSHOT) — never turns an open match restrictive', () => {
    const st = stateWith([player('p1')]);
    expect(errCode(kernel.applyAction(st, sync(OWNED), ctx()))).toBe('E_NO_SNAPSHOT');
  });

  it('rejects a malformed payload (fail-secure)', () => {
    const st = stateWith([player('p1', OWNED)]);
    expect(errCode(kernel.applyAction(st, sync(undefined), ctx()))).toBe('E_BAD_PAYLOAD');
    expect(errCode(kernel.applyAction(st, sync({ hulls: ['cruiser'] }), ctx()))).toBe('E_BAD_PAYLOAD');
  });

  it('a sold-off item disappears from the live catalog too (full replace, not a union)', () => {
    const st = stateWith([player('p1', OWNED)]);
    const shrunk: PlayerArsenal = { hulls: [], modules: ['railgun'] };
    const synced = okApply(kernel.applyAction(st, sync(shrunk), ctx())).state;
    expect(errCode(kernel.applyAction(synced, build('cruiser'), ctx()))).toBe('E_NOT_OWNED');
  });
});

describe('LARS-3 — balance/honesty invariants', () => {
  const kernel = createKernel([constructionModule]);

  it('a live-owned module still only builds on YOUR world — the arsenal gate never bypasses planet ownership', () => {
    // B belongs to an enemy; p1 fully owns the module/hull in its snapshot.
    const st: GameState = { ...stateWith([player('p1', OWNED)]), planets: { A: planet('A', 'p1'), B: planet('B', 'p2') } };
    const buildOnB: Action = {
      id: 's:p1:own-worlds',
      type: 'unit.build',
      playerId: 'p1',
      payload: { planetId: 'B', unit: 'cruiser', modules: ['railgun'] },
      issuedAt: 0,
    };
    expect(errCode(kernel.applyAction(st, buildOnB, ctx()))).toBe('E_FORBIDDEN'); // not E_NOT_OWNED
    expect(okApply(kernel.applyAction(st, build('cruiser', ['railgun']), ctx())).ok).toBe(true); // same items, own world A
  });

  it('F2P parity: a dropped/crafted module builds exactly like an auctioned/starter one — origin never gates buildability', () => {
    // The core snapshot carries only defIds (ARS-3) — origin already can't discriminate
    // here by construction; this pins that invariant explicitly as the LARS-3 contract,
    // not just an accident of the current shape.
    const st = stateWith([player('p1', OWNED)]);
    const r1 = kernel.applyAction(st, build('cruiser', ['railgun']), ctx());
    // The same snapshot, re-synced from a store where every item came from a
    // DIFFERENT origin (drop/craft/auction) — still the identical defId set, so the
    // gate must behave identically (ARS-2's ArsenalItem.origin is stripped by the
    // ARS-3 projection, never read by unit.build).
    const st2 = stateWith([player('p1', { ...OWNED })]);
    const r2 = kernel.applyAction(st2, build('cruiser', ['railgun']), ctx());
    expect(okApply(r1).ok).toBe(okApply(r2).ok);
  });
});

describe('fog: the arsenal snapshot is owner-private (ARS-3)', () => {
  it('the viewer keeps their own snapshot; an enemy’s is stripped', () => {
    const st = stateWith([player('p1', OWNED), player('p2', OWNED)]);
    const view = visibleState(st, 'p1', data);
    expect(view.players.p1?.arsenal).toEqual(OWNED);
    expect(view.players.p2?.arsenal).toBeUndefined(); // what an enemy CAN build is intel
  });
});
