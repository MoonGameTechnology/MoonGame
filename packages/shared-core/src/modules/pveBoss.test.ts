import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { pveModule } from './pve';
import { heroModule } from './hero';
import { heroEffectsModule } from './heroEffects';
import { fleetBroodModule } from './fleetBrood';
import { movementModule } from './movement';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context, MatchConfig } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

// PVR-4.7 — Левиафан, босс матёрого Роя (резолюция владельца 2026-09-24): приходит с
// ПОСЛЕДНЕЙ волной, когда хост его позвал; это герой места Роя, поэтому способности и
// пассивка едут по героическим швам; смерть его окончательна, а запись о ней — основа
// награды. Мир собран из четырёх модулей: волны, герои, их эффекты и выводок.

const H = MS_PER_HOUR;

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal', 'biomass'],
  units: {
    drone: { faction: 'swarm', stats: { attack: 3, defense: 1, speed: 10 } },
    lander: {
      faction: 'swarm',
      domain: 'ground',
      stats: { attack: 5, defense: 2, speed: 0, cargoSize: 1 },
      cost: { biomass: 10 },
    },
    colossus: {
      faction: 'swarm',
      stats: { attack: 40, defense: 36, speed: 32, hp: 900, cargoCapacity: 24 },
      traits: ['hero', 'issued', 'brood_host'],
      slots: { weapon: 0, defense: 0, utility: 1 },
    },
  },
  modules: {
    litter: {
      name: 'Litter',
      slot: 'utility',
      tag: 'horizontal',
      allowed: { domain: 'space', units: ['colossus'] },
      brood: { unit: 'lander', intervalHours: 3, count: 6 },
    },
  },
  heroes: {
    colossus: {
      name: 'Colossus',
      ship: { unit: 'colossus' },
      startAbilities: ['howl'],
      startPassives: ['instinct'],
      boss: true,
    },
    plain: { name: 'Plain', ship: { unit: 'colossus' } },
  },
  heroAbilities: {
    howl: {
      name: 'Howl',
      type: 'aura',
      cooldownHours: 6,
      params: { combatBonus: 0.15, durationHours: 2, radius: 220 },
    },
  },
  heroPassives: {
    instinct: {
      name: 'Instinct',
      hook: 'fleet.speed',
      scope: 'ownFleetsNear',
      params: { bonus: 0.1, radius: 220 },
    },
  },
  factions: {
    swarm: { name: 'Swarm', startingLoadout: { fleet: [{ unit: 'drone', count: 2 }] } },
    vanguard: { name: 'Vanguard' },
  },
  buildings: {},
  events: {},
  modes: {
    boss: {
      name: 'Boss',
      modules: ['pve'],
      pve: {
        waves: 2,
        npcFaction: 'swarm',
        waveIntervalHours: 6,
        boss: { hero: 'colossus', modules: ['litter'], reward: 5 },
      },
    },
    // Режим, который назвал боссом обычного героя: такого не выставляют.
    ordinary: {
      name: 'Ordinary',
      modules: ['pve'],
      pve: { waves: 2, npcFaction: 'swarm', waveIntervalHours: 6, boss: { hero: 'plain' } },
    },
  },
});

const kernel = createKernel([pveModule, heroModule, heroEffectsModule, fleetBroodModule]);
/** Тот же мир с модулем движения — для замера скорости. */
const movers = createKernel([heroModule, movementModule]);
const config = (pveBoss: boolean, modeId = 'boss'): MatchConfig => ({
  timeScale: 1,
  modeId,
  ...(pveBoss ? { pveBoss: true } : {}),
});
const ctx = (now: number, cfg: MatchConfig): Context => ({ now, data, config: cfg });

function player(id: string, faction: string, resources: Record<string, number> = {}): Player {
  return { id, name: id, faction, status: 'active', resources };
}
function planet(id: string, owner: string | null, x: number, links: string[]): Planet {
  return {
    id,
    owner,
    position: { x, y: 0 },
    links,
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
    kind: 'planet',
  };
}
function world(): GameState {
  const base = createInitialState({ seed: 'boss', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...base,
    players: {
      human: player('human', 'vanguard'),
      swarm: player('swarm', 'swarm', { biomass: 1000 }),
    },
    // Улей в начале оси, дом далеко; «дальний» мир Роя (id после улья: волны встают в улье) — вне радиуса пассивки босса.
    planets: {
      hive: planet('hive', 'swarm', 0, ['home']),
      home: planet('home', 'human', 5000, ['hive', 'rim']),
      rim: planet('rim', 'swarm', 3000, ['home']),
    },
  };
}

function advance(state: GameState, to: number, cfg: MatchConfig): GameState {
  const r = kernel.advanceTo(state, ctx(to, cfg));
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

/** Засеять штурм: модуль заводит счётчик и взводит первую волну на 6-й час. Заведение и
 *  приход волны — два продвижения часов (ядро не переигрывает только что пройденный спан). */
function seeded(cfg: MatchConfig): GameState {
  return advance(world(), H, cfg);
}

/** Мир сразу после последней (второй) волны: она приходит на 12-м часу. */
function afterLastWave(cfg = config(true)): GameState {
  return advance(seeded(cfg), 12 * H + 1, cfg);
}

describe('Левиафан приходит с последней волной (PVR-4.7)', () => {
  it('хост позвал босса — он выходит из улья героем Роя, со своим кораблём и выводком', () => {
    const s = afterLastWave();
    const boss = s.pve!.boss!;
    expect(boss).toEqual({ heroId: 'hero:swarm:boss', hero: 'colossus', reward: 5, spawnedAt: 12 * H });
    expect(boss.slainAt).toBeUndefined();
    const hero = s.heroes![boss.heroId]!;
    expect(hero).toMatchObject({
      owner: 'swarm',
      archetype: 'colossus',
      alive: true,
      fleetId: 'pve:boss',
    });
    expect(hero.abilities).toEqual(['howl']);
    expect(hero.passives).toEqual(['instinct']);
    const fleet = s.fleets['pve:boss']!;
    expect(fleet.owner).toBe('swarm');
    expect(fleet.location).toBe('hive');
    expect(fleet.units).toEqual([{ unit: 'colossus', count: 1, modules: ['litter'] }]);
  });

  it('до последней волны босса нет', () => {
    const s = advance(seeded(config(true)), 6 * H + 1, config(true));
    expect(s.pve!.waveNumber).toBe(1);
    expect(s.pve!.boss).toBeUndefined();
    expect(s.fleets['pve:boss']).toBeUndefined();
  });

  it('без зова хоста — ни босса, ни следа: сетевая партия и слабый Рой', () => {
    const s = afterLastWave(config(false));
    expect(s.pve!.waveNumber).toBe(2);
    expect(s.pve!.boss).toBeUndefined();
    expect(s.heroes ?? {}).toEqual({});
    expect(s.fleets['pve:boss']).toBeUndefined();
  });

  it('боссом выставляют только архетип-босса: обычный герой воскресал бы в улье вечно', () => {
    const s = afterLastWave(config(true, 'ordinary'));
    expect(s.pve!.boss).toBeUndefined();
    expect(s.fleets['pve:boss']).toBeUndefined();
  });
});

describe('смерть Левиафана окончательна и записана', () => {
  it('корабль пал — босс мёртв, срок в записи, таймера возрождения нет', () => {
    const s = killShip(afterLastWave());
    const boss = s.pve!.boss!;
    expect(boss.slainAt).toBe(12 * H + 2);
    const hero = s.heroes![boss.heroId]!;
    expect(hero.alive).toBe(false);
    expect(hero.fleetId).toBeUndefined();
    expect(hero.cooldowns.respawn).toBeUndefined();
    expect(s.scheduled.some((e) => e.type === 'hero.respawn')).toBe(false);
    // Двое суток спустя — всё ещё мёртв.
    const later = advance(s, 60 * H, config(true));
    expect(later.heroes![boss.heroId]!.alive).toBe(false);
  });

  it('Рой не поднимает павшего босса приказом', () => {
    const s = killShip(afterLastWave());
    const heroId = s.pve!.boss!.heroId;
    const spawn: Action = {
      id: 'x:swarm:1',
      type: 'hero.spawn',
      playerId: 'swarm',
      payload: { heroId, at: 'hive' },
      issuedAt: 0,
    };
    const r = kernel.applyAction(s, spawn, ctx(s.time, config(true)));
    expect(r).toEqual({ ok: false, code: 'E_HERO_FALLEN' });
  });

  it('гибель ДРУГОГО героя Роя — не гибель босса', () => {
    let s = afterLastWave();
    s.heroes!['hero:swarm:1'] = {
      id: 'hero:swarm:1',
      owner: 'swarm',
      location: 'hive',
      cooldowns: {},
      archetype: 'plain',
      alive: true,
      fleetId: 'escort',
    };
    s.fleets.escort = {
      id: 'escort',
      owner: 'swarm',
      location: 'hive',
      movement: null,
      units: [{ unit: 'colossus', count: 1 }],
      traits: [],
    };
    s = emitDeath(s, { unit: 'colossus', fleetId: 'escort', owner: 'swarm' });
    expect(s.heroes!['hero:swarm:1']!.alive).toBe(false);
    expect(s.pve!.boss!.slainAt).toBeUndefined();
    expect(s.heroes![s.pve!.boss!.heroId]!.alive).toBe(true);
  });

  it('гибель корпуса босса считается, даже когда его флот жив — волна у него на борту', () => {
    let s = afterLastWave();
    // Волна влилась в флот босса: корабли Роя переживут Левиафана.
    s.fleets['pve:boss']!.units.push({ unit: 'drone', count: 4 });
    s = emitDeath(s, { unit: 'colossus', fleetId: 'pve:boss', owner: 'swarm' });
    expect(s.pve!.boss!.slainAt).toBeDefined();
    expect(s.heroes![s.pve!.boss!.heroId]!.alive).toBe(false);
  });
});

describe('способности Левиафана — героические швы', () => {
  it('«Зов улья»: каст кладёт ауру +15% на 2 часа', () => {
    const s = afterLastWave();
    const heroId = s.pve!.boss!.heroId;
    const cast: Action = {
      id: 'x:swarm:2',
      type: 'hero.ability',
      playerId: 'swarm',
      payload: { heroId, abilityId: 'howl' },
      issuedAt: 0,
    };
    const r = kernel.applyAction(s, cast, ctx(s.time, config(true)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const auras = r.state.heroes![heroId]!.activeAuras ?? [];
    expect(auras).toHaveLength(1);
    expect(auras[0]).toMatchObject({ bonus: 0.15, radius: 220, until: s.time + 2 * H });
  });

  it('«Стайный инстинкт»: флот Роя рядом с ним на 10% быстрее, вдали — нет', () => {
    const s = afterLastWave();
    const drone = (id: string, at: string) => ({
      id,
      owner: 'swarm',
      location: at,
      movement: null,
      units: [{ unit: 'drone', count: 1 }],
      traits: [],
    });
    s.fleets.near = drone('near', 'hive');
    s.fleets.far = drone('far', 'rim');
    // Часов в пути до дома: дрон летит со скоростью 10.
    const hours = (fleetId: string): number => {
      const r = movers.applyAction(
        s,
        {
          id: `m:swarm:${fleetId}`,
          type: 'fleet.move',
          playerId: 'swarm',
          payload: { fleetId, to: 'home' },
          issuedAt: 0,
        },
        ctx(s.time, config(true)),
      );
      if (!r.ok) throw new Error(r.code);
      return (r.state.fleets[fleetId]!.movement!.arrivesAt - s.time) / H;
    };
    expect(hours('near')).toBeCloseTo(5000 / 11, 6);
    expect(hours('far')).toBeCloseTo(2000 / 10, 6);
  });

  it('«Выводок»: каждые 3 часа шесть Захватчиков в трюм, оплата из казны Роя', () => {
    const s0 = afterLastWave();
    const s = advance(s0, 12 * H + 3 * H + 1, config(true));
    const landing = s.fleets['pve:boss']!.landing ?? [];
    expect(landing).toEqual([{ unit: 'lander', count: 6 }]);
    expect(s.players.swarm!.resources.biomass).toBe(1000 - 6 * 10);
  });
});

/** Смерть корабля босса — тем же сигналом, каким её приносит бой. */
function killShip(s: GameState): GameState {
  return emitDeath(s, { unit: 'colossus', fleetId: 'pve:boss', owner: 'swarm' });
}

/** Прогон одного события `unit.died` через ядро: так его отдаёт бой. */
function emitDeath(
  s: GameState,
  payload: { unit: string; fleetId: string; owner: string },
): GameState {
  const at = s.time + 1;
  const withEvent: GameState = {
    ...s,
    scheduled: [...s.scheduled, { id: 'evt:boss-death', at, seq: 1_000_000, type: 'unit.died', payload }],
  };
  return advance(withEvent, at, config(true));
}
