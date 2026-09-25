/**
 * СЧЁТЧИКИ ВЕТЕРАНА НА СТЕКЕ (VET-2) — приёмка кирпича.
 *
 * Два числа на стек: сколько боёв он пережил и сколько урона нанёс. Из них VET-3 считает
 * грейд медали, поэтому важна не только величина, но и АРИФМЕТИКА при сплите, слиянии и
 * убыли — там прячутся все интересные ошибки.
 *
 * ⚠️ ОБА ЧИСЛА — НА ЮНИТ, А НЕ НА СТЕК ЦЕЛИКОМ, и это исправление §0.2 роадмапа, где я
 * написал «счётчик делится пропорционально при сплите». Пропорциональный ИТОГ ломается на
 * убыли: 5 крейсеров с итогом 300 — это 60 на корпус; погиб один — итог всё ещё 300, а
 * корпусов четыре, то есть 75 на корпус. **Гибель товарища повышала бы награду
 * выжившим.** У средних такой дыры нет: сплит копирует, слияние усредняет по весу,
 * гибель не трогает. Тест «гибель НЕ повышает заслугу» ниже — ровно про это.
 */
import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { combatModule } from './combat';
import { orbitalModule } from './orbital';
import { mergeStacks, takeFromStacks } from '../util/stacks';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Player,
  type UnitStack,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { setStance } from '../state/diplomacy';
import type { Action, Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    lance: { faction: 'x', domain: 'space', stats: { attack: 30, defense: 10, speed: 6, hp: 400 } },
    barge: { faction: 'x', domain: 'space', stats: { attack: 0, defense: 0, speed: 4, hp: 400 } },
  },
  factions: {},
  buildings: {},
  events: {},
});

/** Бой начинается по ПРИБЫТИЮ, а не сам собой от того, что два флота стоят рядом
 *  в снимке состояния (выяснено инструментированием: без этого модуля `advanceTo`
 *  четыре часа подряд возвращал ноль боёв). Тот же тестовый модуль, что в
 *  `combat-bombard.test.ts`. */
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
const arrive = (fleetId: string, playerId = 'p1'): Action => ({
  id: `s:${playerId}:1`,
  type: 'arrive',
  playerId,
  payload: { fleetId },
  issuedAt: 0,
});

const kernel = createKernel([orbitalModule, combatModule, arrivalModule]);
const HOUR = 3_600_000;
const at = (now: number): Context => ({ now, data });

function duel(aUnits: UnitStack[], bUnits: UnitStack[]): GameState {
  const s = createInitialState({ seed: 'med2', version: { data: '0.1.0', manifest: '1' } });
  const players: Record<string, Player> = {
    p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: {} },
    p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: {} },
  };
  const mk = (id: string, owner: string, units: UnitStack[]): Fleet => ({
    id,
    owner,
    location: 'N',
    movement: null,
    units,
    // Без `orbit`: флоты стоят НА УЗЛЕ, а не на орбите — там и происходит встречный бой.
    // (`Fleet.orbit` бывает только `'near'`, «дальней» стоянки в игре нет.)
    battleId: null,
    traits: [],
  });
  const out: GameState = {
    ...s,
    players,
    planets: {
      N: {
        id: 'N',
        owner: null,
        position: { x: 0, y: 0 },
        resources: {},
        buildings: [],
        garrison: [],
        traits: [],
      },
    },
    fleets: { A: mk('A', 'p1', aUnits), B: mk('B', 'p2', bUnits) },
  };
  setStance(out, 'p1', 'p2', 'war');
  return out;
}

/** Прогнать бой до конца (или до предела) и вернуть состояние. */
function fight(s: GameState, hours = 12): GameState {
  const started = kernel.applyAction(s, arrive('A'), at(0));
  if (!started.ok) throw new Error(`arrive failed: ${started.code}`);
  let cur = started.state;
  for (let i = 1; i <= hours; i++) {
    const r = kernel.advanceTo(cur, at(i * HOUR));
    if (!r.ok) throw new Error(`advance failed: ${r.code}`);
    cur = r.state;
  }
  return cur;
}

describe('VET-2 — счётчик нанесённого урона', () => {
  it('стреляющий стек копит заслугу, и она НА ЮНИТ', () => {
    const after = fight(duel([{ unit: 'lance', count: 2 }], [{ unit: 'lance', count: 2 }]));
    const stack = after.fleets.A?.units[0] ?? after.fleets.B?.units[0];
    expect(stack?.damageDealt ?? 0).toBeGreaterThan(0);
  });

  it('транспорт без пушек заслуги НЕ копит, хотя в бою стоял', () => {
    const after = fight(duel([{ unit: 'barge', count: 2 }], [{ unit: 'lance', count: 2 }]));
    const barge = after.fleets.A?.units.find((u) => u.unit === 'barge');
    expect(barge?.damageDealt ?? 0).toBe(0);
  });

  it('на матче без боёв счётчиков нет вовсе — поле не заводится «нулём»', () => {
    const quiet = duel([{ unit: 'lance', count: 2 }], [{ unit: 'lance', count: 2 }]);
    setStance(quiet, 'p1', 'p2', 'peace');
    const after = fight(quiet, 3);
    for (const f of Object.values(after.fleets))
      for (const st of f.units) {
        expect(st.damageDealt).toBeUndefined();
        expect(st.battles).toBeUndefined();
      }
  });
});

describe('VET-2 — счётчик пройденных сражений', () => {
  it('переживший бой стек получает +1, и ровно один раз за бой', () => {
    const after = fight(duel([{ unit: 'lance', count: 6 }], [{ unit: 'lance', count: 1 }]));
    const winner = after.fleets.A?.units[0];
    expect(winner?.battles).toBe(1);
  });

  it('гибель стека уносит счётчики вместе с ним', () => {
    const after = fight(duel([{ unit: 'lance', count: 6 }], [{ unit: 'lance', count: 1 }]));
    expect(after.fleets.B).toBeUndefined(); // слабый флот стёрт вместе со своей заслугой
  });
});

describe('VET-2 — арифметика носителя', () => {
  const veteran = (): UnitStack[] => [
    { unit: 'lance', count: 5, damageDealt: 60, battles: 3 },
  ];

  it('СПЛИТ копирует заслугу: она на юнит, и делить её нечем', () => {
    const src = veteran();
    const taken = takeFromStacks(src, 'lance', 2);
    expect(taken[0]?.damageDealt).toBe(60);
    expect(taken[0]?.battles).toBe(3);
    expect(src[0]?.damageDealt).toBe(60); // у остатка тоже прежняя
  });

  it('ветераны и новички НЕ сливаются — у ветерана своя плитка (решение владельца 2026-09-25)', () => {
    const merged = mergeStacks(veteran(), [{ unit: 'lance', count: 5 }]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ count: 5, damageDealt: 60, battles: 3 });
    expect(merged[1]).toEqual({ unit: 'lance', count: 5 });
  });

  it('СЛИЯНИЕ одной выслуги усредняет урон по весу — «Доблесть» доливом не размножить', () => {
    const merged = mergeStacks(veteran(), [{ unit: 'lance', count: 5, battles: 3 }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.count).toBe(10);
    expect(merged[0]?.damageDealt).toBe(30); // (5×60 + 5×0) / 10
    expect(merged[0]?.battles).toBe(3);
  });

  it('ГИБЕЛЬ товарища заслугу выживших НЕ повышает — та самая дыра итогов', () => {
    // Расклад подобран ЗАМЕРОМ, а не на глаз: 12 против 10 — победитель теряет корпус
    // ровно посреди боя (траектория состава: 12,12,12,11,11,…), поэтому часть раундов
    // развешена на двенадцать, часть на одиннадцать. На 6 против 3 победитель не теряет
    // никого, и тест был бы зелёным при любой модели.
    let cur = duel([{ unit: 'lance', count: 12 }], [{ unit: 'lance', count: 10 }]);
    const started = kernel.applyAction(cur, arrive('A'), at(0));
    if (!started.ok) throw new Error(`arrive failed: ${started.code}`);
    cur = started.state;
    let dealtByA = 0;
    for (let i = 1; i <= 20; i++) {
      const r = kernel.advanceTo(cur, at(i * HOUR));
      if (!r.ok) throw new Error(`advance failed: ${r.code}`);
      for (const e of r.events) {
        if (e.type !== 'combat.round') continue;
        const pl = e.payload as { sides: Array<{ owner: string | null; damage: number }> };
        for (const sd of pl.sides) if (sd.owner === 'p2') dealtByA += sd.damage; // прилетело p2 = нанесено p1
      }
      cur = r.state;
    }
    const stack = cur.fleets.A?.units[0];
    expect(stack).toBeDefined();
    expect(stack!.count).toBeLessThan(12); // потери БЫЛИ, иначе тест ничего не проверяет
    const recorded = stack!.damageDealt ?? 0;

    // Вот оно, содержательное утверждение. Заслуга копится как Σ(легло за раунд / состав
    // НА ТОТ раунд), поэтому обязана лежать строго между двумя границами:
    //   · итог / ИСХОДНЫЙ состав — если бы никто не гибнул;
    //   · итог / ВЫЖИВШИЕ — ровно то, что дала бы модель ИТОГОВ.
    // Второе неравенство и есть «гибель не раздувает»: будь счётчик итогом на стек,
    // запись равнялась бы верхней границе. Замер: 370.45 при границах [350.00, 381.82].
    expect(recorded).toBeGreaterThan(dealtByA / 12);
    expect(recorded).toBeLessThan(dealtByA / stack!.count);
  });
});

describe('фракция без ветеранов (решение владельца 2026-09-25: «у Роя ветеранов нет»)', () => {
  const hiveData: GameData = parseGameData({
    ...JSON.parse(JSON.stringify({ version: '0.1.0', resources: ['metal'], units: data.units, buildings: {}, events: {} })),
    factions: { hive: { name: 'Hive', veterans: false } },
  });

  it('силы фракции с `veterans: false` не копят ни боёв, ни урона; противник копит как раньше', () => {
    const s = duel([{ unit: 'lance', count: 3 }], [{ unit: 'lance', count: 3 }]);
    s.players.p2!.faction = 'hive';
    const started = kernel.applyAction(s, arrive('A'), { now: 0, data: hiveData });
    if (!started.ok) throw new Error(`arrive failed: ${started.code}`);
    let cur = started.state;
    for (let i = 1; i <= 2; i++) {
      const r = kernel.advanceTo(cur, { now: i * HOUR, data: hiveData });
      if (!r.ok) throw new Error(`advance failed: ${r.code}`);
      cur = r.state;
    }
    // Хотя бы один залп прошёл — иначе тест был бы зелёным при любой модели.
    expect(cur.fleets.A?.units[0]?.damageDealt ?? 0).toBeGreaterThan(0);
    for (const st of cur.fleets.B?.units ?? []) {
      expect(st.damageDealt).toBeUndefined();
      expect(st.battles).toBeUndefined();
    }
  });
});
