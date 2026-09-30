/**
 * ЗАЩИТА ПОСТРОЕК МИРА (решение владельца 2026-09-26): «Крепость на планетах даёт снижение
 * получаемого урона. Как и каждое здание. Максимум 90% — если построены все здания и
 * максимальная крепость; при разрушении здания бонус начинает уменьшаться». Резолюция:
 * форт 15/30/45% по уровню, каждая другая целая постройка +5%, потолок 90%, срезает и штурм,
 * и обстрел с орбиты.
 *
 * Сторожим по шипнутым данным и через настоящий хук урона (`hookedDamage`): число, которое
 * видит игрок, и число, которое срезает бой, — одно.
 */
import { describe, expect, it } from 'vitest';
import {
  combatModule,
  constructionModule,
  createInitialState,
  createKernel,
  fleetOpsModule,
  orbitalModule,
  stationModule,
  worldDamageReduction,
  type BuildingInstance,
  type Fleet,
  type GameState,
  type Planet,
} from '../packages/shared-core/src/index';
import type { GameModule } from '../packages/shared-core/src/kernel/module';
import { hookedDamage, type DamageHookArgs } from '../packages/shared-core/src/util/combat';
import { fleetStatMods, fleetStatQueries } from '../decisions/statModifiers';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const fort = (level: number): BuildingInstance => ({ type: 'fort', level, hp: 100 });
const plain = (type: string, hp = 10): BuildingInstance => ({ type, level: 1, hp });
/** Девять обычных построек — столько нужно рядом с фортом III до потолка. */
const NINE = ['mine', 'farm', 'refinery', 'tax_office', 'power_plant', 'fabricator', 'hospital', 'barracks', 'radar'];
const cover = (buildings: BuildingInstance[]): number => worldDamageReduction({ buildings }, data);

describe('защита построек мира — форт 15/30/45%, прочие по 5%, потолок 90%', () => {
  it('форт даёт свою долю по уровню, обычная постройка — 5%', () => {
    expect(cover([fort(1)])).toBeCloseTo(0.15);
    expect(cover([fort(2)])).toBeCloseTo(0.3);
    expect(cover([fort(3)])).toBeCloseTo(0.45);
    expect(cover([plain('mine')])).toBeCloseTo(0.05);
    expect(cover(NINE.map((t) => plain(t)))).toBeCloseTo(0.45);
  });

  it('форт III и девять построек — 90%; больше построек потолок не пробивают', () => {
    expect(cover([fort(3), ...NINE.map((t) => plain(t))])).toBeCloseTo(0.9);
    expect(cover([fort(3), ...NINE.map((t) => plain(t)), plain('factory'), plain('shipyard')])).toBeCloseTo(0.9);
  });

  it('снесённая постройка перестаёт прикрывать — доля падает по одной', () => {
    const full = [fort(3), ...NINE.map((t) => plain(t))];
    expect(cover(full.slice(0, -1))).toBeCloseTo(0.85);
    expect(cover([fort(3), plain('mine', 0)])).toBeCloseTo(0.45); // hp 0 — уже не постройка
    expect(cover([])).toBe(0);
  });

  it('бой срезает ровно эту долю — и при штурме, и при обстреле; флаку по флоту — нет', () => {
    const probe: GameModule = {
      id: 'cover-probe',
      version: '1.0.0',
      setup(api) {
        api.onAction('probe.damage', (action, h) => {
          const phase = (action.payload as { phase: string }).phase;
          h.emit('probe.result', {
            dmg: hookedDamage(h, 100, { phase, location: 'A', attacker: 'p2', defender: 'p1' }),
          });
        });
      },
    };
    const kernel = createKernel([constructionModule, probe]);
    const world = (buildings: BuildingInstance[]): GameState => {
      const s = createInitialState({ seed: 'cover', version: { data: data.version, manifest: '1' } });
      return {
        ...s,
        players: {
          p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: {} },
          p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: {} },
        },
        planets: {
          A: {
            id: 'A', owner: 'p1', kind: 'planet', position: { x: 0, y: 0 }, links: [],
            resources: {}, buildings, garrison: [], traits: [],
          },
        },
      };
    };
    const damage = (buildings: BuildingInstance[], phase: string): number => {
      const r = kernel.applyAction(
        world(buildings),
        { id: `p:${phase}`, type: 'probe.damage', playerId: 'p1', payload: { phase }, issuedAt: 0 },
        { now: 0, data },
      );
      if (!r.ok) throw new Error(r.code);
      return (r.events.find((e) => e.type === 'probe.result')!.payload as { dmg: number }).dmg;
    };
    const full = [fort(3), ...NINE.map((t) => plain(t))];
    expect(damage(full, 'ground')).toBeCloseTo(10, 5);
    expect(damage(full, 'bombard')).toBeCloseTo(10, 5);
    expect(damage([fort(1)], 'ground')).toBeCloseTo(85, 5);
    expect(damage(full, 'orbital')).toBe(100); // флак мира бьёт по флоту — его мир не прикрывает
  });
});

const HOUR = 3_600_000;
const players = (...ids: string[]): GameState['players'] =>
  Object.fromEntries(ids.map((id) => [id, { id, name: id, faction: 'x', status: 'active' as const, resources: {} }]));
const worldNode = (id: string, owner: string | null, kind: string, buildings: BuildingInstance[]): Planet => ({
  id, owner, kind, position: { x: 0, y: 0 }, links: [], resources: {}, buildings, garrison: [], traits: [],
});
const hullFleet = (id: string, owner: string, location: string, unit: string, count: number): Fleet => ({
  id, owner, location, movement: null, units: [{ unit, count }], landing: [], traits: [], battleId: null,
});

/**
 * ОБСТРЕЛ НЕ ЗАВИСИТ ОТ НАРЕЗКИ ВРЕМЕНИ (замечание Codex на #1389).
 *
 * Матч без зрителей спит до следующего события, и сервер догоняет обстрел одним длинным
 * отрезком; под присмотром тот же обстрел идёт тактами раз в секунду. Прикрытие считалось
 * один раз на отрезок, поэтому постройка, павшая в начале, прикрывала мир до его конца, и
 * исход зависел от того, смотрел ли кто-то на матч. Теперь снос пересчитывает прикрытие для
 * остатка урона: один отрезок и сотня коротких сносят одно и то же.
 *
 * Ни зенитки, ни гарнизона на мире нет намеренно: их залпы бьют по флоту и меняют его силу
 * посреди отрезка — это отдельный вопрос, и он не должен маскировать этот.
 */
describe('обстрел: один длинный отрезок и сотня коротких сносят одно и то же', () => {
  const kernel = createKernel([orbitalModule, constructionModule]);
  const shelled = (fleets: Fleet[]): GameState => {
    const s = createInitialState({ seed: 'shell', version: { data: data.version, manifest: '1' } });
    return {
      ...s,
      players: players('p1', 'p2', 'p3'),
      planets: { A: worldNode('A', 'p1', 'planet', NINE.map((t) => plain(t, 20))) },
      fleets: Object.fromEntries(
        fleets.map((f) => [f.id, { ...f, orbit: 'near' as const, bombarding: true }]),
      ),
    };
  };
  const run = (st: GameState, hours: number, steps: number): BuildingInstance[] => {
    let cur = st;
    for (let i = 1; i <= steps; i += 1) {
      const r = kernel.advanceTo(cur, { now: (hours * HOUR * i) / steps, data });
      if (!r.ok) throw new Error(r.code);
      cur = r.state;
    }
    return cur.planets.A!.buildings;
  };
  const same = (a: BuildingInstance[], b: BuildingInstance[]): void => {
    expect(a.map((x) => x.type)).toEqual(b.map((x) => x.type));
    a.forEach((x, i) => expect(x.hp, x.type).toBeCloseTo(b[i]!.hp, 6));
  };

  it('один флот: снос по ходу отрезка снимает прикрытие для остатка урона', () => {
    const st = shelled([hullFleet('F', 'p2', 'A', 'cruiser', 2)]);
    const lump = run(st, 10, 1);
    same(lump, run(st, 10, 100));
    // Контроль, что тест не тавтология: под прикрытием НАЧАЛА отрезка (45%) постройки
    // потеряли бы ровно сырой урон × 0.55; с пересчётом — больше.
    const raw = 2 * 16 * 0.5 * 10; // два крейсера × атака × доля обстрела × часы
    const lost = 9 * 20 - lump.reduce((sum, b) => sum + b.hp, 0);
    expect(lost).toBeGreaterThan(raw * 0.55 + 1);
  });

  it('два флота над одним миром — тот же итог при любой нарезке', () => {
    // События одного отрезка разбираются очередью: обстрел второго флота приходит, когда
    // первый уже мог что-то снести, и обязан пересчитаться и на входе.
    const st = shelled([hullFleet('F', 'p2', 'A', 'cruiser', 2), hullFleet('G', 'p3', 'A', 'cruiser', 1)]);
    same(run(st, 8, 1), run(st, 8, 64));
  });
});

/**
 * ОРУДИЯ КРЕПОСТИ ПРИКРЫВАЮТ ЕЁ ПОСТРОЙКИ (замечание Codex на #1389).
 *
 * Ядро крепости обещает в досье «−40%», но крепость не обстреливают и на неё не высаживаются:
 * воюет она орудиями в орбитальном бою, и фильтр фаз мира отсекал именно его. Прикрытие
 * получает сам юнит — орудия, — а не обычный флот того же владельца над крепостью.
 */
describe('орудия крепости — прикрытие построек крепости', () => {
  const GUNS = 'fleet:station:A';
  const station = (buildings: BuildingInstance[]): GameState => {
    const s = createInitialState({ seed: 'guns', version: { data: data.version, manifest: '1' } });
    return {
      ...s,
      players: players('p1', 'p2'),
      planets: { A: worldNode('A', 'p1', 'void_station', buildings) },
      fleets: { [GUNS]: hullFleet(GUNS, 'p1', 'A', 'fortress_guns', 1) },
    };
  };
  const core = (level = 1): BuildingInstance => ({ type: 'starfort', level, hp: 70 });

  it('ядро 40% и постройка крепости 5% срезают урон по орудиям — любому обычному флоту нет', () => {
    const probe: GameModule = {
      id: 'guns-probe',
      version: '1.0.0',
      setup(api) {
        api.onAction('probe.damage', (action, h) => {
          const extra = action.payload as Partial<DamageHookArgs>;
          const args: DamageHookArgs = { phase: 'orbital', location: 'A', attacker: 'p2', defender: 'p1', ...extra };
          h.emit('probe.result', { dmg: hookedDamage(h, 100, args) });
        });
      },
    };
    const kernel = createKernel([constructionModule, stationModule, probe]);
    const damage = (buildings: BuildingInstance[], extra: Partial<DamageHookArgs>): number => {
      const r = kernel.applyAction(
        station(buildings),
        { id: 'p:1', type: 'probe.damage', playerId: 'p1', payload: extra, issuedAt: 0 },
        { now: 0, data },
      );
      if (!r.ok) throw new Error(r.code);
      return (r.events.find((e) => e.type === 'probe.result')!.payload as { dmg: number }).dmg;
    };
    expect(damage([core()], { defenderFleet: GUNS })).toBeCloseTo(60, 5);
    expect(damage([core(), plain('radar')], { defenderFleet: GUNS })).toBeCloseTo(55, 5);
    expect(damage([core(), plain('radar')], { defenderFleet: GUNS, phase: 'shuttle' })).toBeCloseTo(55, 5);
    // Обычный флот того же владельца на той же орбите — без прикрытия, как и удар без адресата.
    expect(damage([core(), plain('radar')], { defenderFleet: 'F' })).toBe(100);
    expect(damage([core(), plain('radar')], {})).toBe(100);
  });

  it('в настоящем орбитальном бою орудия теряют на 45% меньше', () => {
    const kernel = createKernel([stationModule, constructionModule, orbitalModule, combatModule]);
    const firstRoundOnGuns = (buildings: BuildingInstance[]): number => {
      const st = station(buildings);
      const withRaider: GameState = {
        ...st,
        fleets: { ...st.fleets, R: hullFleet('R', 'p2', 'A', 'cruiser', 3) },
        scheduled: [{ id: 'e:0', at: 1, type: 'fleet.arrived', payload: { fleetId: 'R', at: 'A' }, seq: 0 }],
        scheduleSeq: 1,
      };
      const r = kernel.advanceTo(withRaider, { now: 4 * HOUR, data });
      if (!r.ok) throw new Error(r.code);
      const round = r.events.find((e) => e.type === 'combat.round');
      expect(round, 'бой с орудиями не начался').toBeDefined();
      const sides = (round!.payload as { sides: { owner: string; damage: number }[] }).sides;
      return sides.find((x) => x.owner === 'p1')!.damage;
    };
    const bare = firstRoundOnGuns([]);
    expect(bare).toBeGreaterThan(0);
    expect(firstRoundOnGuns([core(), plain('radar')])).toBeCloseTo(bare * 0.55, 5);
  });

  it('окно флота показывает орудиям то же прикрытие, что срезает бой', () => {
    // Окно спрашивает ядро теми же конвейерами, по которым считает бой (`traceHooks`).
    // Без адресата под огнём оно показало бы орудиям «без надбавок», а бой срезал бы 45%.
    const kernel = createKernel([constructionModule, stationModule]);
    const st = station([core(), plain('radar')]);
    const mods = fleetStatMods(kernel.traceHooks(st, fleetStatQueries(st.fleets[GUNS]!, 0), { now: 0, data }), 0);
    expect(mods?.incoming.factor).toBeCloseTo(0.55, 5);
    expect(mods?.incoming.sources.map((x) => x.source)).toEqual(['station']);
  });
});

/**
 * ПРИКРЫТИЕ — ОРУДИЯМ, А НЕ КОНТЕЙНЕРУ (находка Codex на #1393, P1).
 *
 * Станция узнавала орудия по id флота. Обычный `fleet.merge` в `fleet:station:*` проходил
 * все гейты (свой флот, стоят рядом, не в бою) — и крейсеры получали прикрытие крепости
 * 40–90%. Обратный путь уводил орудия из отряда, и станция досчитывала их до уровня ядра
 * заново. Теперь неподвижный отряд не сливается и не делится, а прикрытие проверяет состав.
 */
describe('орудия крепости — не сливаются, не делятся, прикрытие только им', () => {
  const GUNS = 'fleet:station:A';
  const kernel = createKernel([constructionModule, stationModule, fleetOpsModule]);
  const withCruisers = (): GameState => {
    const s = createInitialState({ seed: 'guns-merge', version: { data: data.version, manifest: '1' } });
    return {
      ...s,
      players: players('p1', 'p2'),
      planets: { A: worldNode('A', 'p1', 'void_station', [{ type: 'starfort', level: 2, hp: 70 }]) },
      fleets: {
        [GUNS]: hullFleet(GUNS, 'p1', 'A', 'fortress_guns', 2),
        C: hullFleet('C', 'p1', 'A', 'cruiser', 3),
      },
    };
  };
  const act = (type: string, payload: unknown) =>
    kernel.applyAction(withCruisers(), { id: 'a:1', type, playerId: 'p1', payload, issuedAt: 0 }, { now: 0, data });

  it('слить флот в орудия и орудия во флот нельзя', () => {
    expect(act('fleet.merge', { from: 'C', into: GUNS })).toMatchObject({ ok: false, code: 'E_EMPLACEMENT' });
    expect(act('fleet.merge', { from: GUNS, into: 'C' })).toMatchObject({ ok: false, code: 'E_EMPLACEMENT' });
  });

  it('отделить часть орудий нельзя', () => {
    const r = act('fleet.split', { fleetId: GUNS, take: [{ unit: 'fortress_guns', count: 1 }] });
    expect(r).toMatchObject({ ok: false, code: 'E_EMPLACEMENT' });
  });

  it('созревшее намерение слиться с орудиями снимается, а не исполняется', () => {
    const st: GameState = {
      ...withCruisers(),
      scheduled: [{ id: 'e:0', at: 1, type: 'fleet.arrived', payload: { fleetId: 'C', at: 'A' }, seq: 0 }],
      scheduleSeq: 1,
    };
    st.fleets.C = { ...st.fleets.C!, mergeInto: GUNS };
    const r = kernel.advanceTo(st, { now: 2, data });
    if (!r.ok) throw new Error(r.code);
    expect(r.state.fleets[GUNS]?.units).toEqual([{ unit: 'fortress_guns', count: 2 }]);
    expect(r.state.fleets.C?.mergeInto).toBeUndefined();
  });

  it('отряд с чужим юнитом прикрытия не получает', () => {
    const probe: GameModule = {
      id: 'guns-probe',
      version: '1.0.0',
      setup(api) {
        api.onAction('probe.damage', (_action, h) => {
          const args: DamageHookArgs = { phase: 'orbital', location: 'A', attacker: 'p2', defender: 'p1', defenderFleet: GUNS };
          h.emit('probe.result', { dmg: hookedDamage(h, 100, args) });
        });
      },
    };
    const k = createKernel([constructionModule, stationModule, probe]);
    const damage = (st: GameState): number => {
      const r = k.applyAction(st, { id: 'p:1', type: 'probe.damage', playerId: 'p1', payload: {}, issuedAt: 0 }, { now: 0, data });
      if (!r.ok) throw new Error(r.code);
      return (r.events.find((e) => e.type === 'probe.result')!.payload as { dmg: number }).dmg;
    };
    const clean = withCruisers();
    expect(damage(clean)).toBeCloseTo(60, 5); // ядро 40%
    const polluted = withCruisers();
    polluted.fleets[GUNS] = { ...polluted.fleets[GUNS]!, units: [{ unit: 'fortress_guns', count: 2 }, { unit: 'cruiser', count: 3 }] };
    expect(damage(polluted)).toBe(100);
  });
});
