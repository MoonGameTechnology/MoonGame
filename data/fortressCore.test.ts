/**
 * ЯДРО КОСМИЧЕСКОЙ КРЕПОСТИ (FORT-5.2; решения владельца 9, 10, 13, 18 — §0.7 роадмапа).
 *
 * Уровень, корпус и прокачка в этой игре живут ТОЛЬКО у здания: вид узла — ярлык, а не
 * объект, и полей под них у него нет. Поэтому крепость несёт здание-ядро, и по решению 18
 * это не новая сущность, а доращённый `starfort` («Void Fortress»).
 *
 * Тест проверяет не «в json записаны числа» (это тавтология), а три вещи, которые могут
 * разойтись молча:
 *   1. ядро реально появляется от `station.deploy` — иначе крепость выйдет бестелесной;
 *   2. свежая крепость 1 уровня реально СТРЕЛЯЕТ по флоту — то есть её зенитка попадает в
 *      орбитальный счёт мира, а не просто объявлена полем;
 *   3. руками ядро не построить нигде — оно появляется только вместе с крепостью.
 *
 * Отдельный сторож стоит на ловушку схемы: уровни `upgrades` НЕ наследуют поля, каждый
 * задаётся целиком. Забыть `defenseBonus` на одном уровне — значит уронить его на дефолт
 * схемы (0.01), то есть тихо обнулить оборону крепости ровно на этом уровне.
 */
import { describe, expect, it } from 'vitest';
import {
  buildingLevel,
  buildingMaxLevel,
  constructionModule,
  createInitialState,
  createKernel,
  stationModule,
  type Action,
  type Context,
  type Fleet,
  type GameState,
  type Planet,
} from '../packages/shared-core/src/index';
import { orbitalModule } from '../packages/shared-core/src/modules/orbital';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const CORE = 'starfort';
const HOUR = 3_600_000;
const core = data.buildings[CORE];

const ctx = (now = 0): Context => ({ now, data });

function node(kind: string, buildings: string[] = []): Planet {
  return {
    id: 'A',
    owner: 'p1',
    kind,
    position: { x: 0, y: 0 },
    resources: {},
    buildings: buildings.map((type) => ({ type, level: 1, hp: 100 })),
    garrison: [],
    traits: [],
  };
}
function world(kind: string, fleets: Fleet[] = []): GameState {
  const s = createInitialState({ seed: 'fc', version: { data: data.version, manifest: '1' } });
  return {
    ...s,
    players: {
      p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: { metal: 9000, credits: 9000, energy: 9000 } },
      p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: {} },
    },
    planets: { A: node(kind) },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
  };
}
const act = (type: string, payload: Record<string, unknown>): Action => ({
  id: 's:p1:1', type, playerId: 'p1', payload, issuedAt: 0,
});

describe('ядро крепости — решения владельца 9/10/13/18 в шипнутом каталоге', () => {
  it('`station.deploy` ставит ядро САМ: крепость не бывает бестелесной', () => {
    const kernel = createKernel([stationModule]);
    const r = kernel.applyAction(world('asteroid'), act('station.deploy', { planetId: 'A' }), ctx());
    if (!r.ok) throw new Error(`отказ ${r.code}`);
    const built = r.state.planets.A?.buildings ?? [];
    expect(r.state.planets.A?.kind).toBe('void_station');
    expect(built.map((b) => b.type)).toContain(CORE);
    const placed = built.find((b) => b.type === CORE)!;
    expect(placed.level).toBe(1);
    // Корпус берётся из каталога, а не из константы рядом: разойдись они — крепость
    // рождалась бы побитой или бессмертной.
    expect(placed.hp).toBe(buildingLevel(core!, 1).hp);
  });

  it('СВЕЖАЯ крепость 1 уровня уже стреляет по флоту (решение 13)', () => {
    // Самая сильная проверка файла: не «поле объявлено», а залп, дошедший до чужого
    // флота. Он доказывает всю цепочку разом — ядро встало, его зенитка попала в
    // орбитальный счёт узла, и узел выстрелил.
    const enemy: Fleet = {
      id: 'E', owner: 'p2', location: 'A', movement: null,
      units: [{ unit: 'cruiser', count: 1 }], landing: [], traits: [], battleId: null, orbit: 'near',
    };
    const kernel = createKernel([stationModule, orbitalModule]);
    const raised = kernel.applyAction(world('asteroid', [enemy]), act('station.deploy', { planetId: 'A' }), ctx());
    if (!raised.ok) throw new Error(`отказ ${raised.code}`);
    const r = kernel.advanceTo(raised.state, ctx(1.1 * HOUR));
    if (!r.ok) throw new Error(`advance отказ ${r.code}`);
    const volleys = r.events.filter((e) => e.type === 'aa.fired');
    expect(volleys.length).toBeGreaterThan(0);
    expect((volleys[0]!.payload as { damage: number }).damage).toBe(buildingLevel(core!, 1).aaDamage);
  });

  it('прокачка растит корпус И ОБА орудия — пять уровней, ни одной полки', () => {
    expect(buildingMaxLevel(core!)).toBe(5);
    const rows = [1, 2, 3, 4, 5].map((lv) => buildingLevel(core!, lv));
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1]!;
      const cur = rows[i]!;
      expect(cur.hp, `корпус на уровне ${i + 1}`).toBeGreaterThan(prev.hp);
      expect(cur.aaDamage, `зенитка по флоту на уровне ${i + 1}`).toBeGreaterThan(prev.aaDamage);
      expect(cur.pointDefense, `зенитка по челнокам на уровне ${i + 1}`).toBeGreaterThan(prev.pointDefense);
    }
  });

  it('НИ ОДИН уровень не теряет оборонный бонус — ловушка ненаследуемых upgrades', () => {
    // `upgrades[i]` — полный уровень, а не патч: поле, забытое на одном из них, молча
    // падает на дефолт схемы (0.01). Снаружи это выглядит как «на четвёртом уровне
    // крепость почему-то не держит землю» и не ловится ничем другим.
    const base = buildingLevel(core!, 1).defenseBonus;
    expect(base).toBeGreaterThan(0.1);
    for (const lv of [2, 3, 4, 5]) {
      expect(buildingLevel(core!, lv).defenseBonus, `уровень ${lv}`).toBe(base);
    }
  });

  it('ядро НЕЛЬЗЯ построить руками — ни на одном виде местности', () => {
    // `onlyOn: []` — «возводится нигде», тот же способ сказать «нет», каким
    // `allowedBuildings: []` закрывает застройку вида. Без этого ядро строилось бы на
    // планете: у неё ростера нет вовсе, то есть разрешено любое здание.
    const kernel = createKernel([constructionModule]);
    for (const kind of Object.keys(data.sectorKinds)) {
      const r = kernel.applyAction(world(kind), act('building.construct', { planetId: 'A', building: CORE }), ctx());
      expect(r.ok, `${kind} принял ядро в постройку`).toBe(false);
    }
  });
});
