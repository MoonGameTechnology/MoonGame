/**
 * УСИЛЕННЫЙ КРЕЙСЕР (`heavy_cruiser`, решение владельца 2026-09-26): «добавь юнит
 * усиленный крейсер. 4 слотов под модули любые». Корпус тяжёлого класса строится на верфи
 * 3-го уровня; его четыре отсека — универсальные (SM-0.9).
 *
 * «Любые» — это УНИВЕРСАЛЬНЫЕ отсеки (`ShipSlots.universal`): в каждый встаёт модуль
 * любого типа. Собственное правило модуля действует и здесь: радары пикета и разведчика
 * остаются за своими корпусами, а осадная платформа, оружие крейсера, открыта и ему.
 *
 * Сторожим по шипнутым данным и через настоящий приказ `unit.build`: механику держит
 * гейт ядра, и проверять надо то, чем игра реально играет.
 */
import { describe, expect, it } from 'vitest';
import {
  constructionModule,
  createInitialState,
  createKernel,
  effectiveStats,
  type Action,
  type Context,
  type GameState,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const ctx = (now = 0): Context => ({ now, data });
const kernel = createKernel([constructionModule]);
const HULL = 'heavy_cruiser';

function world(yardLevel: number): GameState {
  const s = createInitialState({ seed: 'rc', version: { data: data.version, manifest: '1' } });
  return {
    ...s,
    players: {
      p1: {
        id: 'p1', name: 'p1', faction: 'x', status: 'active',
        resources: Object.fromEntries(data.resources.map((r) => [r, 99000])),
      },
    },
    planets: {
      A: {
        id: 'A', owner: 'p1', kind: 'planet', position: { x: 0, y: 0 }, links: [],
        resources: {}, buildings: [{ type: 'shipyard', level: yardLevel, hp: 100 }],
        garrison: [], traits: [],
      },
    },
  };
}
const order = (yardLevel: number, modules: string[]): string | true => {
  const action: Action = {
    id: 's:p1:1', type: 'unit.build', playerId: 'p1', issuedAt: 0,
    payload: { planetId: 'A', unit: HULL, modules },
  };
  const r = kernel.applyAction(world(yardLevel), action, ctx());
  return r.ok ? true : r.code;
};

/** Четыре модуля РАЗНЫХ типов, среди них два защитных — на обычном крейсере так нельзя. */
const MIXED = ['targeting_array', 'shield_booster', 'ablative_plating', 'cargo_bay'];

describe('усиленный крейсер — решение владельца 2026-09-26', () => {
  it('четыре универсальных отсека и ни одного типизированного; тяжёлый класс', () => {
    const def = data.units[HULL]!;
    expect(def.slots).toEqual({ weapon: 0, defense: 0, utility: 0, universal: 4 });
    expect(def.hullClass).toBe('heavy');
  });

  it('сильнее и медленнее обычного крейсера — тяжёлый корпус той же линии', () => {
    const rc = data.units[HULL]!.stats;
    const cr = data.units.cruiser!.stats;
    expect(rc.hp).toBeGreaterThan(cr.hp);
    expect(rc.attack).toBeGreaterThan(cr.attack);
    expect(rc.defense).toBeGreaterThan(cr.defense);
    expect(rc.speed).toBeLessThan(cr.speed);
  });

  it('строится только на верфи 3-го уровня', () => {
    expect(order(3, [])).toBe(true);
    expect(order(2, [])).toBe('E_YARD_TOO_SMALL');
  });

  it('берёт четыре модуля любых типов — и пятый уже некуда', () => {
    expect(order(3, MIXED)).toBe(true);
    expect(order(3, [...MIXED, 'point_defense_array'])).toBe('E_NO_SLOT');
    // Обычный крейсер этот набор не примет: второй защитный модуль ему ставить некуда.
    const cruiserOrder = kernel.applyAction(
      world(3),
      { id: 's:p1:1', type: 'unit.build', playerId: 'p1', issuedAt: 0, payload: { planetId: 'A', unit: 'cruiser', modules: MIXED } },
      ctx(),
    );
    expect(cruiserOrder.ok ? true : cruiserOrder.code).toBe('E_NO_SLOT');
  });

  it('все четыре модуля работают: характеристики — сумма вкладов', () => {
    const def = data.units[HULL]!;
    const bare = effectiveStats(def, {}, data);
    const fitted = effectiveStats(def, { modules: MIXED }, data);
    for (const id of MIXED)
      for (const [stat, v] of Object.entries(data.modules[id]!.effects.stats))
        expect(fitted[stat]! - (bare[stat] ?? 0), `${id}: ${stat}`).toBeGreaterThanOrEqual(v - 1e-9);
  });

  it('правило модуля действует и в универсальном отсеке', () => {
    // Осадная платформа — оружие крейсера — открыта и усиленному.
    expect(order(3, ['siege_platform'])).toBe(true);
    // Радар пикета остаётся за пикетом: универсальный отсек не делает корпус пикетом.
    expect(order(3, ['radar_module'])).toBe('E_NOT_ALLOWED');
  });
});

describe('звезда корабля в экспедиции не отнимает универсальные отсеки', () => {
  // Слоты за звёзды корабля (Sector Zero) едут в забег снимком арсенала (`arsenal.slots`), и
  // верфь забега собирает корпус через `withBonusSlots`. Пересобери она слоты из трёх типов —
  // усиленный крейсер со звездой остался бы без четырёх отсеков.
  it('звезда оружия + четыре универсальных: пять модулей встают, без звезды — нет', () => {
    const five = ['targeting_array', 'siege_platform', 'shield_booster', 'ablative_plating', 'cargo_bay'];
    const withStar = (slots?: Record<string, Record<string, number>>): string | true => {
      const w = world(3);
      w.players.p1!.arsenal = {
        hulls: [HULL],
        modules: five,
        ...(slots ? { slots } : {}),
      };
      const action: Action = {
        id: 's:p1:1', type: 'unit.build', playerId: 'p1', issuedAt: 0,
        payload: { planetId: 'A', unit: HULL, modules: five },
      };
      const r = kernel.applyAction(w, action, ctx());
      return r.ok ? true : r.code;
    };
    expect(withStar({ [HULL]: { weapon: 1 } })).toBe(true);
    expect(withStar()).toBe('E_NO_SLOT');
  });
});

describe('универсальные отсеки не доходят до корабля героя', () => {
  // Отсеки корабля героя (корпус + прибавка ступени) считают ПО ТИПАМ и гейт
  // `hero.install`, и экраны героя. Универсальный отсек у корпуса героя или у ступени
  // ядро молча не учло бы — поэтому их не объявляет никто, пока экраны героя им не научены.
  it('ни корпус героя, ни ступень героя не объявляют универсальных отсеков', () => {
    const hulls = new Set(['hero', ...Object.values(data.heroes).map((h) => h.ship.unit ?? 'hero')]);
    for (const hull of hulls) expect(data.units[hull]?.slots.universal ?? 0, hull).toBe(0);
    for (const [grade, def] of Object.entries(data.heroGrades))
      expect(def.moduleSlots.universal ?? 0, grade).toBe(0);
  });
});
