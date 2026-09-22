/**
 * ЩИТЫ КРЕПОСТИ (FORT-5.10; решение владельца 20 — §0.7 роадмапа крепостей).
 *
 * «Щит — снаряжение НА крепости, а не свойство здания». Здание щитов не считает щит
 * само: оно надевает на орудия одну из трёх ступеней модуля, и дальше щит живёт по общим
 * корабельным правилам — `effectiveStats` суммирует модули, поглощение и восстановление
 * читают её же. Поэтому путь боевого урона этот кирпич не трогает вовсе.
 *
 * Проверяются следствия, каждое из которых может отвалиться молча:
 *   1. без здания щита НЕТ — он не появляется сам собой у сооружения;
 *   2. постройка здания надевает ступень, прокачка меняет её на следующую;
 *   3. мёртвое здание щит снимает — «стоит» и «работает» не одно и то же;
 *   4. ступень запрещена кораблям — иначе крепостной щит уехал бы на флот;
 *   5. скорость восстановления — ДОБАВКА к общей, а не замена ей: корабль без этого
 *      стата обязан копить щит ровно с прежней скоростью. Это контроль на то, что
 *      правка не переписала молча весь флот игры.
 */
import { describe, expect, it } from 'vitest';
import {
  canEquip,
  constructionModule,
  createInitialState,
  createKernel,
  effectiveStats,
  stationModule,
  technologyModule,
  type Action,
  type Context,
  type GameState,
  type UnitStack,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const ctx = (now = 0): Context => ({ now, data });
const GUNS = 'fortress_guns';
const GUNS_FLEET = 'fleet:station:A';
const SHIELD = 'void_shield';
const CORE = 'starfort';
const HOUR = 3_600_000;

const kernel = createKernel([technologyModule, stationModule, constructionModule]);

/** Крепость уровня `level` со своим расчётом — ровно в той форме, в какой её держит
 *  `syncStationGuns`. Построек щита нет: их ставит сам тест. */
function world(level = 3, shield?: { level: number; hp: number }): GameState {
  const s = createInitialState({ seed: 'fsh', version: { data: data.version, manifest: '1' } });
  const buildings = [{ type: CORE, level, hp: 300 }];
  if (shield) buildings.push({ type: SHIELD, level: shield.level, hp: shield.hp });
  return {
    ...s,
    players: {
      p1: {
        id: 'p1', name: 'p1', faction: 'x', status: 'active',
        resources: Object.fromEntries(data.resources.map((r) => [r, 99000])),
        technologies: { completed: ['void_shielding'] },
      },
    },
    planets: {
      A: {
        id: 'A', owner: 'p1', kind: 'void_station', position: { x: 0, y: 0 }, links: [],
        resources: {}, buildings, garrison: [], traits: [],
      },
    },
    fleets: {
      [GUNS_FLEET]: {
        id: GUNS_FLEET, owner: 'p1', location: 'A', movement: null,
        units: [{ unit: GUNS, count: level }], landing: [], traits: [], battleId: null,
      },
    },
  };
}

const act = (type: string, payload: Record<string, unknown>): Action => ({
  id: `s:p1:${type}`, type, playerId: 'p1', payload, issuedAt: 0,
});

/** Дать действию доиграться: стройка и прокачка занимают часы. */
function settle(st: GameState, action: Action, at: number): GameState {
  const r = kernel.applyAction(st, action, ctx(at));
  if (!r.ok) throw new Error(`отказ ${r.code}`);
  const done = kernel.advanceTo(r.state, ctx(at + 200 * HOUR));
  if (!done.ok) throw new Error('advance отказ');
  return done.state;
}

const gunsStack = (st: GameState): UnitStack | undefined =>
  st.fleets[GUNS_FLEET]?.units.find((u) => u.unit === GUNS);

/** Щит на ОДНО орудие — та величина, из которой бой считает пул стека. */
function shieldPerGun(stack: UnitStack): number {
  const def = data.units[GUNS];
  if (!def) throw new Error('в каталоге нет орудий крепости');
  return effectiveStats(def, stack, data).shield ?? 0;
}
function regenBonus(stack: UnitStack): number {
  const def = data.units[GUNS];
  if (!def) throw new Error('в каталоге нет орудий крепости');
  return effectiveStats(def, stack, data).shieldRegen ?? 0;
}

describe('щиты крепости — решение владельца 20', () => {
  it('БЕЗ ЗДАНИЯ щита нет — сооружение не обзаводится им само', () => {
    const stack = gunsStack(world());
    expect(stack?.modules, 'щит взялся из ниоткуда').toBeUndefined();
    expect(shieldPerGun(stack!)).toBe(0);
  });

  it('ПОСТРОЙКА здания надевает первую ступень', () => {
    const st = settle(world(), act('building.construct', { planetId: 'A', building: SHIELD }), 0);
    expect(st.planets.A?.buildings.some((b) => b.type === SHIELD)).toBe(true);
    const stack = gunsStack(st);
    expect(stack?.modules).toEqual(['void_shield_i']);
    expect(shieldPerGun(stack!), 'ступень надета, а щита нет').toBeGreaterThan(0);
  });

  it('УРОВЕНЬ ЗДАНИЯ = СТУПЕНЬ, и с ней растут и размер, и скорость набора', () => {
    // Обе величины названы владельцем: «размер и скорость восстановления». Проверяются
    // вместе, потому что забыть вторую — ровно тот тихий пропуск, которым ступень стала
    // бы косметикой.
    let st = settle(world(), act('building.construct', { planetId: 'A', building: SHIELD }), 0);
    const seen: Array<{ step: string; size: number; rate: number }> = [];
    const snap = (): void => {
      const stack = gunsStack(st)!;
      seen.push({ step: stack.modules![0]!, size: shieldPerGun(stack), rate: regenBonus(stack) });
    };
    snap();
    for (let i = 0; i < 2; i += 1) {
      st = settle(st, act('building.upgrade', { planetId: 'A', building: SHIELD }), (i + 1) * 500 * HOUR);
      snap();
    }
    expect(seen.map((r) => r.step)).toEqual(['void_shield_i', 'void_shield_ii', 'void_shield_iii']);
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]!.size, `размер на ступени ${i + 1}`).toBeGreaterThan(seen[i - 1]!.size);
      expect(seen[i]!.rate, `скорость на ступени ${i + 1}`).toBeGreaterThan(seen[i - 1]!.rate);
    }
  });

  it('МЁРТВОЕ здание щит СНИМАЕТ — «стоит» и «работает» не одно и то же', () => {
    // Разрушенное здание нигде не перестаёт «стоять» в списке — у него обнуляется `hp`.
    // Сверку запускаем прокачкой ЯДРА: повод другой, а дом у правила один, и щит обязан
    // сняться на любом из поводов.
    const st = settle(
      world(3, { level: 2, hp: 0 }),
      act('building.upgrade', { planetId: 'A', building: CORE }),
      0,
    );
    expect(gunsStack(st)?.modules, 'щит держится на трупе здания').toBeUndefined();
  });

  it('ступень щита НЕ НАДЕВАЕТСЯ на корабль — она снаряжение крепости', () => {
    const cruiser = data.units.cruiser;
    expect(cruiser, 'в каталоге нет крейсера — тест потерял контроль').toBeDefined();
    const r = canEquip('cruiser', cruiser!, [], 'void_shield_i', data);
    expect(r.ok).toBe(false);
    // Контроль наоборот: обычный корабельный щит на крейсер встаёт, то есть отказ выше
    // пришёл от `allowed`, а не от отсутствия слота.
    expect(canEquip('cruiser', cruiser!, [], 'shield_booster', data).ok).toBe(true);
  });

  it('СКОРОСТЬ — ДОБАВКА к общей, а не замена ей', () => {
    // Крепость со ступенью набирает быстрее базовых 6%/ч, а корабль с обычным бустером —
    // ровно 6%/ч, как и до этого кирпича. Второе и есть смысл теста: стат-добавка не
    // имеет права переписать восстановление всему флоту игры.
    const st = world(1, { level: 3, hp: 48 });
    const fort = { ...st, fleets: { ...st.fleets } };
    const gunsDef = data.units[GUNS]!;
    const fortStack: UnitStack = { unit: GUNS, count: 1, modules: ['void_shield_iii'], shieldHp: 0 };
    const fortFull = effectiveStats(gunsDef, fortStack, data).shield ?? 0;
    fort.fleets[GUNS_FLEET] = { ...fort.fleets[GUNS_FLEET]!, units: [fortStack] };
    fort.fleets.ship = {
      id: 'ship', owner: 'p1', location: 'A', movement: null, landing: [], traits: [], battleId: null,
      units: [{ unit: 'cruiser', count: 1, modules: ['shield_booster'], shieldHp: 0 }],
    };
    const shipFull = effectiveStats(data.units.cruiser!, { modules: ['shield_booster'] }, data).shield ?? 0;

    const done = kernel.advanceTo(fort, ctx(HOUR));
    if (!done.ok) throw new Error('advance отказ');
    const after = done.state;

    const BASE = 0.06; // общая скорость игры — константа `SHIELD_REGEN`
    const shipShield = after.fleets.ship?.units[0]?.shieldHp ?? 0;
    expect(shipShield, 'корабль перестал копить щит с прежней скоростью').toBeCloseTo(
      BASE * shipFull,
      6,
    );
    const fortShield = after.fleets[GUNS_FLEET]?.units[0]?.shieldHp ?? 0;
    expect(fortShield).toBeCloseTo((BASE + regenBonus(fortStack)) * fortFull, 6);
    // И контроль смысла: крепость со ступенью восстанавливается БЫСТРЕЕ доли базы.
    expect(fortShield / fortFull).toBeGreaterThan(shipShield / shipFull);
  });
});
