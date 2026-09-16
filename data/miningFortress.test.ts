/**
 * ДОБЫВАЮЩАЯ СТАНЦИЯ НЕ ИСКЛЮЧАЕТ КОСМИЧЕСКУЮ КРЕПОСТЬ (решение владельца 8, 2026-09-16).
 *
 * Правило звучит одной фразой, но выполняется ТРЕМЯ разными местами, и разойтись они
 * могут молча:
 *   1. крепость ставится на узле, где станция уже стоит — это флаг `stationable`;
 *   2. уже стоящая станция переживает конверсию — добыча считается по зданиям и вида
 *      узла не знает;
 *   3. на готовой крепости станцию можно ПОСТРОИТЬ — это ростер `allowedBuildings`.
 *
 * Третий пункт и был дырой: без него конверсия отнимала добычу НАВСЕГДА — не в момент
 * постройки крепости, а потом, когда станцию разрушат и окажется, что отстроить её негде.
 * Правило «не исключает» выполнялось бы день и переставало бы на неделе.
 *
 * ПОЧЕМУ ТЕСТ ГОНЯЕТ ЯДРО, А НЕ ЧИТАЕТ ROSTER. Ростер, содержащий id, не доказывает, что
 * постройка пройдёт: перед ним стоит флаг `buildable`, за ним — ограничение со стороны
 * здания (`onlyOn`), и любое из трёх ворот отменяет решение владельца в одиночку. Поэтому
 * здесь настоящий редьюсер на настоящем каталоге: то же, что увидит игрок.
 *
 * ЖИВЁТ РЯДОМ С КАТАЛОГОМ: ядро намеренно изолировано от шипнутых данных и импортировать
 * их не имеет права (`rootDir` роняет тайпчек на первой же попытке). Правило-как-код
 * покрыто юнит-тестом в `construction.test.ts`; здесь — правило-как-контент.
 */
import { describe, expect, it } from 'vitest';
import {
  constructionModule,
  createInitialState,
  createKernel,
  isBuildable,
  stationModule,
  type Action,
  type ApplyResult,
  type Context,
  type GameState,
  type Planet,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const MINING = 'metal_station';
/** Виды, где по решению 3 добывает станция. */
const MINING_KINDS = ['asteroid', 'dead_world'];

const kernel = createKernel([constructionModule, stationModule]);
const ctx: Context = { now: 0, data };

/** Свой узел заданного вида, с казной, которой хватает на что угодно из каталога. */
function nodeOwnedBy(kind: string, buildings: string[] = []): GameState {
  const node: Planet = {
    id: 'A',
    owner: 'p1',
    kind,
    position: { x: 0, y: 0 },
    resources: {},
    buildings: buildings.map((type) => ({ type, level: 1, hp: 100 })),
    garrison: [],
    traits: [],
  };
  const s = createInitialState({ seed: 'mf', version: { data: data.version, manifest: '1' } });
  return {
    ...s,
    players: {
      p1: {
        id: 'p1',
        name: 'p1',
        faction: 'x',
        status: 'active',
        resources: { metal: 9000, credits: 9000, energy: 9000 },
      },
    },
    planets: { A: node },
  };
}

function act(type: string, payload: Record<string, unknown>): Action {
  return { id: 's:p1:1', type, playerId: 'p1', payload, issuedAt: 0 };
}
const raiseFortress = (st: GameState): ApplyResult =>
  kernel.applyAction(st, act('station.deploy', { planetId: 'A' }), ctx);
const buildOn = (st: GameState, building: string): ApplyResult =>
  kernel.applyAction(st, act('building.construct', { planetId: 'A', building }), ctx);

function okApply(r: ApplyResult): GameState {
  if (!r.ok) throw new Error(`отказ ${r.code}`);
  return r.state;
}
function errCode(r: ApplyResult): string {
  if (r.ok) throw new Error('ждали отказа, получили ok');
  return r.code;
}

describe('добыча и крепость сосуществуют (решение владельца 8)', () => {
  it('крепость встаёт ПОВЕРХ работающей станции, и станция конверсию переживает', () => {
    // Половины 1 и 2 разом, и именно в том порядке, в каком это делает игрок: на своём
    // астероиде уже качает руду станция, сверху поднимается крепость.
    for (const kind of MINING_KINDS) {
      const after = okApply(raiseFortress(nodeOwnedBy(kind, [MINING])));
      expect(after.planets.A?.kind, kind).toBe('void_station');
      expect(after.planets.A?.buildings.map((b) => b.type), kind).toContain(MINING);
    }
  });

  it('и на готовой КРЕПОСТИ станция строится — иначе добыча терялась бы навсегда', () => {
    // Дыра была здесь. Стоящая станция конверсию переживает (см. выше), но отстроить её
    // после разрушения было бы негде — и «не исключает» тихо превратилось бы в
    // «исключает через неделю».
    expect(okApply(buildOn(nodeOwnedBy('void_station'), MINING)).players.p1?.resources.metal).toBe(
      9000 - (data.buildings[MINING]?.cost.metal ?? 0),
    );
  });

  it('станция строится ровно там, где решил владелец: мёртвые миры и астероиды', () => {
    for (const kind of MINING_KINDS) {
      expect(buildOn(nodeOwnedBy(kind), MINING).ok, kind).toBe(true);
    }
  });

  it('а на ПЛАНЕТЕ станции нет — и виновата станция, а не местность', () => {
    // Решение 3 сформулировано от здания, и проверять его надо через отказ: у планеты
    // ростера нет вовсе (undefined = любое здание), так что «нет в ростере» тут не
    // работает как утверждение. Рядом — контрольная постройка: если бы дело было в
    // местности, шахта отбилась бы тем же кодом.
    const planet = nodeOwnedBy('planet');
    expect(isBuildable(data, { kind: 'planet' })).toBe(true);
    expect(errCode(buildOn(planet, MINING))).toBe('E_WRONG_SECTOR');
    expect(buildOn(planet, 'mine').ok).toBe(true);
  });
});
