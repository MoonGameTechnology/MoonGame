/**
 * ПОЛИГОН ОСНОВНОЙ ИГРЫ (`data/maps/proving-ground.json`, генератор
 * `scripts/generate-proving-ground.py`, M2.15).
 *
 * Заказ владельца 2026-09-29: все области, весь каталог провинций, все юниты игрока и все
 * враги, старт песочницей, имена у областей и только у них. Карта существует ради
 * ПОЛНОТЫ, поэтому тесты ниже пересчитывают «что есть в игре» из каталога, а не из
 * списка рядом: новая запись в каталоге без места на полигоне роняет тест, пока генератор
 * не перезапустят.
 *
 * Соседство выводится из мозаики (M4.3): сдвинув провинцию, перезапусти тест — правка
 * координат может молча поменять проходы.
 */
import { describe, expect, it } from 'vitest';
import {
  buildStateFromMap,
  isBuildable,
  allowedBuildings,
  parseMatchMap,
  validateMatchMap,
  type GameData,
  type MatchMap,
} from '../packages/shared-core/src/index';
import { regionKey } from '../decisions/regionName';
import { ru } from '../localization/ru';
import { en } from '../localization/en';
import { shippedGameData } from './bundle';
import {
  mapRegions,
  PROVING_GROUND_PLAYER,
  provingGroundShuttles,
  provingGroundState,
} from '../packages/client/src/gameData';
import mapJson from './maps/proving-ground.json';

const data = shippedGameData();
const map: MatchMap = parseMatchMap(mapJson);
const ids = Object.keys(map.sectors);
const world = buildStateFromMap(map, data);
const roadsOf = (id: string): number => world.planets[id]!.links?.length ?? 0;
const ME = PROVING_GROUND_PLAYER;
const capitalOf = (owner: string): string => ids.find((id) => map.sectors[id]!.owner === owner && map.sectors[id]!.kind === 'planet')!;

/** Что игрок СТРОИТ — ворота ядра (`construction.ts`, `faction.ts`): не выдаваемое, не
 *  уникальное для фракции, не корабль героя. */
function playerUnits(d: GameData): string[] {
  const factionOnly = new Set(Object.values(d.factions).flatMap((f) => f.uniqueUnits));
  return Object.keys(d.units).filter(
    (id) => id !== 'hero' && !factionOnly.has(id) && !d.units[id]!.traits.includes('issued'),
  );
}

describe('полигон — полнота каталога', () => {
  it('проходит валидатор на шипнутом каталоге; соседство — из мозаики; 70–90 провинций', () => {
    expect(validateMatchMap(map, data)).toEqual([]);
    expect(map.paths).toBeUndefined();
    expect(ids.length).toBeGreaterThanOrEqual(70);
    expect(ids.length).toBeLessThanOrEqual(90);
  });

  it('на нём ВСЕ виды провинций, все среды и все типы миров каталога', () => {
    const has = (pick: (id: string) => string | undefined): string[] =>
      [...new Set(ids.map(pick).filter((v): v is string => v !== undefined))].sort();
    // Площадка крепости на развилке (`fork_station`, FORT-6.1) провинцией не бывает: она
    // появляется в игре, когда крепость ставят на развилку дороги.
    const provinceKinds = Object.keys(data.sectorKinds).filter((k) => k !== 'fork_station');
    expect(has((id) => map.sectors[id]!.kind)).toEqual(provinceKinds.sort());
    expect(has((id) => map.sectors[id]!.terrain)).toEqual(Object.keys(data.sectors).sort());
    expect(has((id) => map.sectors[id]!.planetType)).toEqual(Object.keys(data.planetTypes).sort());
  });
});

describe('полигон — области', () => {
  // Шесть областей концепции (§5.5) и лестница каждой: ядро → оболочка → край.
  const LADDER: Record<string, readonly string[]> = {
    asteroid_massif: ['dust_lane', 'asteroid_field'],
    nebula_cloud: ['dense_nebula', 'nebula', 'empty_space'],
    expedition_graveyard: ['derelict_graveyard', 'empty_space'],
    depleted_node: ['depleted_system', 'empty_space', 'deep_void'],
    storm_front: ['ion_storm', 'solar_flare_zone', 'empty_space'],
    open_expanse: ['deep_void', 'empty_space'],
  };

  it('шесть областей делят карту: каждая провинция — ровно в одной', () => {
    expect(map.regions.map((r) => r.id).sort()).toEqual(Object.keys(LADDER).sort());
    expect(map.regions.flatMap((r) => r.sectors).sort()).toEqual([...ids].sort());
  });

  it('у каждой области имя на обоих языках — и только у областей: провинции без имён', () => {
    const missing = map.regions
      .map((r) => regionKey(map.id, r.id))
      .filter((key) => !(key in ru) || !(key in en));
    expect(missing).toEqual([]);
    const provinceNames = Object.keys(ru).filter((key) => key.startsWith(`province.${map.id}.`));
    expect(provinceNames).toEqual([]);
  });

  it('лестница области идёт от ядра к краю: ступень дальше от ядра, чем предыдущая', () => {
    for (const region of map.regions) {
      const ladder = LADDER[region.id]!;
      const pos = (id: string): { x: number; y: number } => map.sectors[id]!.position;
      const tier = (terrain: string): string[] =>
        region.sectors.filter((id) => map.sectors[id]!.terrain === terrain);
      const core = tier(ladder[0]!);
      expect([region.id, core.length > 0]).toEqual([region.id, true]);
      const cx = core.reduce((n, id) => n + pos(id).x, 0) / core.length;
      const cy = core.reduce((n, id) => n + pos(id).y, 0) / core.length;
      const meanDist = (terrain: string): number => {
        const cells = tier(terrain);
        return cells.reduce((n, id) => n + Math.hypot(pos(id).x - cx, pos(id).y - cy), 0) / cells.length;
      };
      for (let i = 1; i < ladder.length; i++)
        expect([region.id, ladder[i], meanDist(ladder[i]!) > meanDist(ladder[i - 1]!)]).toEqual([
          region.id,
          ladder[i],
          true,
        ]);
    }
  });

  it('в сердце массива — цель, мёртвый кристаллический мир (§5.4); троянские карманы — тупики', () => {
    const massif = map.regions.find((r) => r.id === 'asteroid_massif')!.sectors;
    const heart = massif.find((id) => map.sectors[id]!.planetType === 'crystalline')!;
    expect(map.sectors[heart]).toMatchObject({ kind: 'dead_world', terrain: 'dust_lane' });
    const pockets = massif.filter((id) => map.sectors[id]!.kind === 'asteroid_cluster');
    expect(pockets.length).toBeGreaterThanOrEqual(2);
    for (const id of pockets) expect([id, roadsOf(id)]).toEqual([id, 1]);
  });

  it('клиент берёт подписи из самой карты; у карты без областей их нет', () => {
    expect(mapRegions(map.id)).toEqual(map.regions);
    expect(mapRegions('pve-1')).toEqual([]);
    expect(mapRegions(undefined)).toEqual([]);
  });
});

describe('полигон — песочница игрока', () => {
  const state = provingGroundState(data);
  const capital = state.planets[capitalOf(ME)]!;
  const armada = Object.values(state.fleets).filter((f) => f.owner === ME);

  it('флот — все корабли, которые игрок строит; гарнизон столицы — все наземные части', () => {
    const own = playerUnits(data);
    const ships = own.filter((u) => data.units[u]!.domain === 'space' && !data.units[u]!.traits.includes('shuttle'));
    const ground = own.filter((u) => data.units[u]!.domain === 'ground');
    expect([...new Set(armada.flatMap((f) => f.units.map((st) => st.unit)))].sort()).toEqual(ships.sort());
    expect(capital.garrison.map((st) => st.unit).sort()).toEqual(ground.sort());
  });

  it('челноки — в ангаре космопорта столицы, десантный — с бойцом в трюме', () => {
    const inHangar = (capital.hangar ?? []).flatMap((q) => q.units.map((st) => st.unit)).sort();
    expect(inHangar).toEqual(provingGroundShuttles(data).sort());
    expect(inHangar.length).toBeGreaterThan(0);
    for (const q of capital.hangar ?? []) {
      const lander = q.units.some((st) => data.units[st.unit]!.traits.includes('lander'));
      expect([q.id, (q.cargo ?? []).length > 0]).toEqual([q.id, lander]);
    }
  });

  it('столица — со всеми постройками, которые пускают ворота строительства, на последнем уровне', () => {
    const allowed = Object.keys(data.buildings).filter((id) => {
      const def = data.buildings[id]!;
      const roster = allowedBuildings(data, capital);
      return (
        isBuildable(data, capital) &&
        !def.traits.includes('infected') &&
        (def.onlyOn === undefined || def.onlyOn.includes(capital.kind ?? '')) &&
        (roster === undefined || roster.includes(id))
      );
    });
    expect(capital.buildings.map((b) => b.type).sort()).toEqual(allowed.sort());
    for (const b of capital.buildings)
      expect([b.type, b.level]).toEqual([b.type, 1 + (data.buildings[b.type]!.upgrades?.length ?? 0)]);
  });

  it('все технологии открыты, ресурсов с запасом', () => {
    const me = state.players[ME]!;
    expect(me.technologies?.completed).toEqual(Object.keys(data.technologies).sort());
    for (const res of ['credits', 'metal', 'food', 'energy', 'microelectronics'])
      expect([res, me.resources[res]! >= 10_000]).toEqual([res, true]);
  });
});

describe('полигон — враги', () => {
  const state = provingGroundState(data);

  it('соперник и Рой — места ИИ; пираты и нейтралы — обитатели на своих базах', () => {
    expect(state.players.p2).toMatchObject({ ai: true });
    expect(state.players.p3).toMatchObject({ ai: true, faction: 'swarm' });
    const base = (kind: string): string => ids.find((id) => map.sectors[id]!.kind === kind)!;
    expect(map.players[map.sectors[base('pirate_base')]!.owner!]!.npc).toBe('pirate');
    expect(map.players[map.sectors[base('neutral_base')]!.owner!]!.npc).toBe('neutral');
  });

  it('места воюют между собой с первой минуты', () => {
    for (const [a, b] of [
      ['p1', 'p2'],
      ['p1', 'p3'],
      ['p2', 'p3'],
    ] as const)
      expect(state.diplomacy?.[`${a}|${b}`]).toBe('war');
  });

  it('у каждой столицы больше одного выхода', () => {
    for (const owner of ['p1', 'p2', 'p3']) expect([owner, roadsOf(capitalOf(owner)) >= 2]).toEqual([owner, true]);
  });
});
