import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { salvageModule, SALVAGE_SHARE } from './salvage';
import { combatModule } from './combat';
import { orbitalModule } from './orbital';
import { interceptModule } from './intercept';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { composeGameDataBundle } from '../data/loadGameData';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Action, AdvanceResult, ApplyResult, Context, DomainEvent } from '../action/types';

/**
 * EVT-2 — трофеи победителю.
 *
 * Большая часть правил проверяется СИНТЕТИЧЕСКИМИ событиями, а не прогоном боя, и это
 * не срезание угла: модуль живёт на шине, его вход — это `unit.died` / `battle.resolved`
 * / `station.destroyed` в том порядке, в каком их отдаёт дренаж, и подать их напрямую
 * честнее, чем выводить нужный расклад через стрельбу. Порядок при этом настоящий:
 * `emitAll` кладёт события в ОДИН шаг, и кернел дренирует их FIFO — ровно как в бою.
 *
 * Сверху один прогон НАСТОЯЩЕГО боя: он проверяет то, чего синтетика проверить не может,
 * — что `combat.ts` действительно штампует `battleId` на смертях, и значит модуль
 * получает то, на что подписан.
 */

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal', 'credits'],
  units: {
    // Дорогой и слабый: его гибель даёт заметный котёл, а исход боя предрешён.
    hauler: {
      faction: 'x',
      stats: { attack: 0, defense: 0, speed: 5, hp: 10 },
      line: 'front',
      cost: { metal: 100, credits: 40 },
    },
    aggressor: {
      faction: 'x',
      stats: { attack: 30, defense: 5, speed: 5, hp: 100 },
      line: 'front',
      cost: { metal: 200 },
    },
    // Выдаваемый корпус: стоимости нет вовсе — как у орудий крепости.
    issued: { faction: 'x', stats: { attack: 1, defense: 1, speed: 0, hp: 10 }, line: 'front' },
  },
  factions: {},
  buildings: {
    bastion: { name: 'Bastion', cost: { metal: 180, credits: 60 }, upgrades: [{ cost: { metal: 260 } }] },
  },
  events: {},
});

const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });

function player(id: string, metal = 0, credits = 0): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: { metal, credits } };
}
function planet(id: string, owner: string | null): Planet {
  return {
    id,
    owner,
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
}
function fleet(id: string, owner: string, location: string, list: Array<[string, number]>): Fleet {
  return {
    id,
    owner,
    location,
    movement: null,
    units: list.map(([unit, count]) => ({ unit, count })),
    traits: [],
  };
}
function baseState(players: Player[], planets: Planet[] = [], fleets: Fleet[] = []): GameState {
  const s = createInitialState({ seed: 'slv', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: Object.fromEntries(players.map((p) => [p.id, p])),
    planets: Object.fromEntries(planets.map((p) => [p.id, p])),
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
  };
}
const okApply = (r: ApplyResult): ApplyResult & { ok: true } => {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
};
const okAdvance = (r: AdvanceResult): AdvanceResult & { ok: true } => {
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r;
};

/** Фикстура: выложить готовые события в один шаг — кернел дренирует их FIFO. */
const emitter: GameModule = {
  id: 'test-emitter',
  version: '1.0.0',
  setup(api) {
    api.onAction('emit', (a, h) => {
      for (const e of (a.payload as { events: DomainEvent[] }).events) h.emit(e.type, e.payload);
    });
  },
};
function emitAll(events: DomainEvent[], playerId = 'p1'): Action {
  return { id: `s:${playerId}:1`, type: 'emit', playerId, payload: { events }, issuedAt: 0 };
}
const died = (unit: string, count: number, at: string, owner: string, battleId?: string) => ({
  type: 'unit.died',
  payload: { unit, count, at, owner, ...(battleId !== undefined ? { battleId } : {}) },
});
const resolved = (location: string, winners: string[]) => ({
  type: 'battle.resolved',
  payload: { battleId: 'b1', location, phase: 'orbital', winner: winners[0] ?? null, winners },
});

function run(state: GameState, events: DomainEvent[], extra: GameModule[] = []): GameState {
  const kernel = createKernel([salvageModule, emitter, ...extra]);
  return okApply(kernel.applyAction(state, emitAll(events), ctx(0))).state;
}

describe('salvage — победитель забирает долю поля боя (EVT-2)', () => {
  it('платит 5% от стоимости ВСЕГО погибшего: и чужого, и своего', () => {
    // Погибло: 2 hauler'а врага (200 металла + 80 кредитов) и 1 СВОЙ aggressor (200
    // металла) → котёл 400 металла и 80 кредитов. Свои потери считаются наравне с
    // чужими: пиррова победа окупается заметнее лёгкой.
    const after = run(baseState([player('p1'), player('p2')]), [
      died('hauler', 2, 'N', 'p2', 'b1'),
      died('aggressor', 1, 'N', 'p1', 'b1'),
      resolved('N', ['p1']),
    ]);
    expect(after.players['p1']!.resources['metal']).toBe(Math.floor(400 * SALVAGE_SHARE)); // 20
    expect(after.players['p1']!.resources['credits']).toBe(Math.floor(80 * SALVAGE_SHARE)); // 4
  });

  it('проигравший не получает ничего (решение владельца)', () => {
    const after = run(baseState([player('p1'), player('p2')]), [
      died('hauler', 2, 'N', 'p2', 'b1'),
      died('aggressor', 1, 'N', 'p1', 'b1'),
      resolved('N', ['p1']),
    ]);
    expect(after.players['p2']!.resources['metal']).toBe(0);
    expect(after.players['p2']!.resources['credits']).toBe(0);
  });

  it('смерть БЕЗ `battleId` не платит: это не поле боя, а зенитка или бомбардировка', () => {
    const after = run(baseState([player('p1'), player('p2')]), [
      died('hauler', 2, 'N', 'p2'), // без battleId
      resolved('N', ['p1']),
    ]);
    expect(after.players['p1']!.resources['metal']).toBe(0);
  });

  it('ничья не платит никому, и её котёл не достаётся следующему бою', () => {
    const state = baseState([player('p1'), player('p2')]);
    const after = run(state, [died('hauler', 2, 'N', 'p2', 'b1'), resolved('N', [])]);
    expect(after.players['p1']!.resources['metal']).toBe(0);
    expect(after.salvage?.['N']?.pool).toEqual({});
  });

  it('совместная победа ДЕЛИТ добычу, а не удваивает её', () => {
    const after = run(baseState([player('p1'), player('p2'), player('p3')]), [
      died('aggressor', 1, 'N', 'p3', 'b1'), // 200 металла
      resolved('N', ['p1', 'p2']),
    ]);
    // 200 × 5% = 10 на двоих → по 5 каждому, а не по 10.
    expect(after.players['p1']!.resources['metal']).toBe(5);
    expect(after.players['p2']!.resources['metal']).toBe(5);
  });

  it('юнит без стоимости (выдаваемый корпус) не приносит ничего', () => {
    const after = run(baseState([player('p1'), player('p2')]), [
      died('issued', 10, 'N', 'p2', 'b1'),
      resolved('N', ['p1']),
    ]);
    expect(after.players['p1']!.resources['metal']).toBe(0);
  });

  it('доля идёт через хук `salvage.share` — это шов для пассивки героя (EVT-3)', () => {
    const doubler: GameModule = {
      id: 'test-doubler',
      version: '1.0.0',
      setup(api) {
        api.hook('salvage.share', (base: number) => base * 2);
      },
    };
    const after = run(
      baseState([player('p1'), player('p2')]),
      [died('aggressor', 1, 'N', 'p2', 'b1'), resolved('N', ['p1'])],
      [doubler],
    );
    expect(after.players['p1']!.resources['metal']).toBe(Math.floor(200 * SALVAGE_SHARE * 2)); // 20
  });

  it('котёл, оставшийся без боя (отступление распустило бой), убирается уборкой', () => {
    const kernel = createKernel([salvageModule, emitter]);
    let state = baseState([player('p1'), player('p2')]);
    state = okApply(
      kernel.applyAction(state, emitAll([died('hauler', 1, 'N', 'p2', 'b1')]), ctx(0)),
    ).state;
    expect(state.salvage?.['N']?.pool['metal']).toBe(100); // накопилось
    // Боя на узле нет (он распущен отступлением) → ход часов подметает запись.
    state = okAdvance(kernel.advanceTo(state, ctx(HOUR))).state;
    expect(state.salvage).toBeUndefined();
  });
});

describe('salvage — гибель крепости (EVT-2)', () => {
  const bastion = (id: string, owner: string, level: number): Planet => ({
    ...planet(id, owner),
    buildings: [{ type: 'bastion', level, hp: 10 }],
  });
  const stationDestroyed = (planetId: string, owner: string) => ({
    type: 'station.destroyed',
    payload: { planetId, owner },
  });

  it('платит долю от того, что было ВЛОЖЕНО в постройки узла', () => {
    // Крепость 1 уровня: базовые 180 металла + 60 кредитов. 5% → 9 и 3.
    const after = run(baseState([player('p1'), player('p2')], [bastion('N', 'p2', 1)]), [
      resolved('N', ['p1']),
      stationDestroyed('N', 'p2'),
    ]);
    expect(after.players['p1']!.resources['metal']).toBe(9);
    expect(after.players['p1']!.resources['credits']).toBe(3);
  });

  it('прокачанная крепость дороже: улучшение тоже было оплачено', () => {
    // 2 уровень: 180 + 260 = 440 металла, 60 кредитов. 5% → 22 и 3.
    const after = run(baseState([player('p1'), player('p2')], [bastion('N', 'p2', 2)]), [
      resolved('N', ['p1']),
      stationDestroyed('N', 'p2'),
    ]);
    expect(after.players['p1']!.resources['metal']).toBe(22);
  });

  it('крепость, павшая ВНЕ боя, не платит никому — победителя нет', () => {
    const after = run(baseState([player('p1'), player('p2')], [bastion('N', 'p2', 1)]), [
      stationDestroyed('N', 'p2'),
    ]);
    expect(after.players['p1']!.resources['metal']).toBe(0);
  });
});

describe('salvage — настоящий бой штампует `battleId` и платит (EVT-2)', () => {
  // Фикстура прибытия: combat сцепляет враждебные флоты на узле по `fleet.arrived`.
  const arrivalModule: GameModule = {
    id: 'test-arrival',
    version: '1.0.0',
    setup(api) {
      api.onAction('arrive', (a, h) => {
        const fleetId = (a.payload as { fleetId: string }).fleetId;
        h.emit('fleet.arrived', { fleetId, at: h.state.fleets[fleetId]?.location });
      });
    },
  };

  it('после разрешённого боя победитель богаче, чем был', () => {
    const kernel = createKernel([
      orbitalModule,
      combatModule,
      interceptModule,
      salvageModule,
      arrivalModule,
    ]);
    let state = baseState(
      [player('p1'), player('p2')],
      [planet('N', null)],
      [fleet('A', 'p1', 'N', [['aggressor', 3]]), fleet('D', 'p2', 'N', [['hauler', 2]])],
    );
    state = okApply(
      kernel.applyAction(
        state,
        { id: 's:p1:1', type: 'arrive', playerId: 'p1', payload: { fleetId: 'A' }, issuedAt: 0 },
        ctx(0),
      ),
    ).state;
    const done = okAdvance(kernel.advanceTo(state, ctx(40 * HOUR)));
    // Бой действительно кончился, и победитель получил долю — а значит `battleId`
    // доехал до модуля: без штампа котёл остался бы пустым.
    expect(Object.keys(done.state.battles)).toHaveLength(0);
    expect(done.state.players['p1']!.resources['metal']).toBeGreaterThan(0);
    expect(done.state.players['p2']!.resources['metal']).toBe(0);
    expect(done.events.some((e) => e.type === 'salvage.paid')).toBe(true);
  });
});

describe('salvage — лестница «мародёра» (EVT-3)', () => {
  /** Ступени цепочки в порядке прокачки и ИТОГИ, которые игрок видит на каждой. */
  const LADDER = [
    { node: 'wreck_rig', salvage: 0.03, damage: 0 },
    { node: 'wreck_battery', salvage: 0.03, damage: 0.05 },
    { node: 'wreck_shears', salvage: 0.05, damage: 0.05 },
    { node: 'wreck_foundry', salvage: 0.05, damage: 0.07 },
    { node: 'wreck_mastery', salvage: 0.1, damage: 0.1 },
  ] as const;

  // Лестница проверяется на ШИПНУТЫХ данных, а не на фикстуре: утверждение здесь —
  // «игрок получит ровно эти итоги», и проверять его на выдуманных числах бессмысленно.
  const dataDir = path.join(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..'),
    'data',
  );
  const shipped = parseGameData(
    composeGameDataBundle((name) => JSON.parse(readFileSync(path.join(dataDir, name), 'utf8'))),
  );

  /** Пассивки, накопленные к этой ступени включительно (узлы выдают, а не заменяют). */
  function passivesUpTo(step: number): string[] {
    const out: string[] = [];
    for (const { node } of LADDER.slice(0, step + 1)) {
      const grants = shipped.heroSkillTrees[node]!.grants;
      if (grants.passive !== undefined) out.push(grants.passive);
      out.push(...grants.passives);
    }
    return out;
  }
  const sumFor = (ids: string[], hook: string): number =>
    ids.reduce((acc, id) => {
      const def = shipped.heroPassives[id]!;
      return def.hook === hook ? acc + def.params.bonus : acc;
    }, 0);

  it.each(LADDER.map((x, i) => [i + 1, x] as const))(
    'ступень %i даёт ровно заявленные итоги',
    (_step, expected) => {
      const ids = passivesUpTo(LADDER.indexOf(expected));
      expect(sumFor(ids, 'salvage')).toBeCloseTo(expected.salvage, 5);
      expect(sumFor(ids, 'combat.damage')).toBeCloseTo(expected.damage, 5);
    },
  );

  it('потолок прокачки — 10% и 10%, а не сумма озвученных чисел', () => {
    // Развилка, решённая при заведении EVT-3: числа ступеней — это НАКОПЛЕННЫЙ итог,
    // а не прибавка. Сложи их буквально — выйдет 18% и 22%, то есть вдвое мимо
    // потолка, который назвал владелец. В данных лежат прибавки, дающие эти итоги.
    const all = passivesUpTo(LADDER.length - 1);
    expect(sumFor(all, 'salvage')).toBeCloseTo(0.1, 5);
    expect(sumFor(all, 'combat.damage')).toBeCloseTo(0.1, 5);
  });

  it('цепочка действительно цепочка: каждая ступень требует предыдущую', () => {
    for (let i = 1; i < LADDER.length; i++) {
      expect(shipped.heroSkillTrees[LADDER[i]!.node]!.requires).toContain(LADDER[i - 1]!.node);
    }
  });

  it('последняя ступень выдаёт ОБЕ половины одним узлом', () => {
    const grants = shipped.heroSkillTrees['wreck_mastery']!.grants;
    expect(grants.passives).toHaveLength(2);
    const hooks = grants.passives.map((id) => shipped.heroPassives[id]!.hook).sort();
    expect(hooks).toEqual(['combat.damage', 'salvage']);
  });

  it('кэшбэк-пассивки считают «тот же узел» — это и есть «бой с участием героя»', () => {
    for (const id of ['wreck_optics', 'wreck_cutters', 'wreck_mastery_salvage']) {
      const def = shipped.heroPassives[id]!;
      expect(def.scope).toBe('ownFleetsNear');
      expect(def.params.radius).toBe(0);
    }
  });
});

describe('salvage — биомассу берёт только тот, кто ею питается (решение владельца 2026-09-25)', () => {
  // Жалоба владельца после плейтеста: «И опять ресурс биомасса у меня». Экономика и стройка
  // уже не дают человеку биомассы (`util/infestation.ts`), но трофеи платили долю стоимости
  // погибших, а формы Роя стоят биомассу, — и победитель-человек её получал.
  const swarmy: GameData = parseGameData({
    version: '0.1.0',
    resources: ['metal', 'credits', 'biomass'],
    units: {
      drone: {
        faction: 'swarm',
        stats: { attack: 0, defense: 0, speed: 5, hp: 10 },
        line: 'front',
        cost: { metal: 100, biomass: 200 },
      },
    },
    factions: {
      vanguard: { name: 'Vanguard' },
      swarm: { name: 'Swarm', traits: ['consume_biomass'] },
    },
    buildings: {},
    events: {},
  });
  const who = (id: string, faction: string): Player => ({ ...player(id), faction });
  const runSwarmy = (winner: Player, loser: Player) => {
    const kernel = createKernel([salvageModule, emitter]);
    const state = baseState([winner, loser]);
    const events = [died('drone', 2, 'N', loser.id, 'b1'), resolved('N', [winner.id])];
    return okApply(kernel.applyAction(state, emitAll(events), { now: 0, data: swarmy })).state;
  };

  it('человек-победитель получает металл, но не биомассу', () => {
    const after = runSwarmy(who('p1', 'vanguard'), who('p3', 'swarm'));
    expect(after.players['p1']!.resources['metal']).toBe(Math.floor(200 * SALVAGE_SHARE)); // 10
    expect(after.players['p1']!.resources['biomass']).toBeUndefined();
  });

  it('Рой-победитель биомассу получает, как прежде', () => {
    const after = runSwarmy(who('p3', 'swarm'), who('p1', 'vanguard'));
    expect(after.players['p3']!.resources['biomass']).toBe(Math.floor(400 * SALVAGE_SHARE)); // 20
  });
});
