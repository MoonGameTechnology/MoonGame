/**
 * ЗЕНИТКИ ПРИ N СТОРОНАХ (MSB-7) — приёмка кирпича.
 *
 * Решение владельца 2026-09-11 (§0.0 №8 роадмапа многостороннего боя): **зенитный залп
 * ДЕЛИТСЯ на всех враждебных**, единообразно с правилом ближнего боя.
 *
 * Что было до кирпича: прежний `nearOrbitHostile` (в единственном числе) брал враждебный флот с наименьшим `id` и
 * сваливал на него весь залп. Порядок `id` — это, по сути, порядок ПРИБЫТИЯ, поэтому
 * flak наказывал пришедшего первым и вознаграждал подошедшего вторым: дешёвая приманка,
 * отправленная заранее, собирала на себя весь огонь, пока ударная группа висела рядом
 * нетронутой. Не баланс, а эксплойт, и появлялся он ровно при N > 1.
 *
 * Поэтому третий тест здесь — не «а ещё проверим порядок», а САМА суть кирпича: исход не
 * имеет права зависеть от того, кто прилетел раньше.
 */
import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { combatModule } from './combat';
import { orbitalModule } from './orbital';
import { diplomacyModule } from './diplomacy';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, buildingLevel, type GameData } from '../data/schemas';
import { setStance } from '../state/diplomacy';
import type { Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    // Один корпус на всех: разница в исходе тогда объясняется ПРАВИЛОМ, а не составом.
    // Корпус крупный — чтобы залп ранил, но не добивал, и урон остался виден числом.
    hull: { faction: 'x', domain: 'space', stats: { attack: 0, defense: 0, speed: 6, hp: 1000 } },
    // Отдельный корпус С ПУШКОЙ — только для обстрела: у `hull` `attack: 0`, и осада им
    // не сняла бы с построек ни очка. Держать два корпуса дешевле, чем дать пушку
    // общему: тогда зенитные тесты выше пришлось бы читать «а не подрался ли кто».
    gun: { faction: 'x', domain: 'space', stats: { attack: 40, defense: 0, speed: 6, hp: 1000 } },
  },
  factions: {},
  buildings: {
    flak: { name: 'Orbital AA', cost: { metal: 1 }, buildTimeHours: 0, hp: 25, aaDamage: 120 },
  },
  events: {},
});

const kernel = createKernel([orbitalModule, combatModule, diplomacyModule]);
const HOUR = 3_600_000;
const at = (now: number): Context => ({ now, data });

function world(fleetOwners: string[], ids?: string[]): GameState {
  const s = createInitialState({ seed: 'msb7', version: { data: '0.1.0', manifest: '1' } });
  const players: Record<string, Player> = {
    host: { id: 'host', name: 'host', faction: 'x', status: 'active', resources: {} },
  };
  const planet: Planet = {
    id: 'P',
    owner: 'host',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [{ type: 'flak', level: 1, hp: buildingLevel(data.buildings.flak!, 1).hp }],
    garrison: [],
    traits: [],
  };
  const fleets: Record<string, Fleet> = {};
  fleetOwners.forEach((owner, i) => {
    const id = ids?.[i] ?? `f${i}`;
    players[owner] = { id: owner, name: owner, faction: 'x', status: 'active', resources: {} };
    fleets[id] = {
      id,
      owner,
      location: 'P',
      movement: null,
      units: [{ unit: 'hull', count: 1 }],
      orbit: 'near',
      battleId: null,
      traits: [],
    };
  });
  const out: GameState = { ...s, players, planets: { P: planet }, fleets };
  for (const owner of fleetOwners) setStance(out, owner, 'host', 'war');
  // Осаждающие между собой НЕ воюют: иначе они сцепятся в бой (MSB-3), уйдут из-под
  // зенитного огня (`nearOrbitHostiles` пропускает занятых боем) и тест померит не то.
  for (let i = 0; i < fleetOwners.length; i++)
    for (let j = i + 1; j < fleetOwners.length; j++)
      setStance(out, fleetOwners[i]!, fleetOwners[j]!, 'peace');
  return out;
}

function afterOneVolley(s: GameState): GameState {
  const r = kernel.advanceTo(s, at(HOUR));
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r.state;
}
/** Сколько корпуса снято с флота (hp не задан = целый). */
const lost = (s: GameState, id: string): number => 1000 - (s.fleets[id]?.units[0]?.hp ?? 1000);

describe('MSB-7 — зенитный залп делится на всех враждебных', () => {
  it('ТРОЕ на орбите: задеты ВСЕ ТРИ, а не один', () => {
    const after = afterOneVolley(world(['p1', 'p2', 'p3']));
    for (const id of ['f0', 'f1', 'f2']) expect(lost(after, id)).toBeGreaterThan(0);
  });

  it('делится РОВНО: каждому по трети, и сумма равна залпу', () => {
    const after = afterOneVolley(world(['p1', 'p2', 'p3']));
    const parts = ['f0', 'f1', 'f2'].map((id) => lost(after, id));
    for (const p of parts) expect(p).toBeCloseTo(parts[0]!, 10);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(120, 10);
  });

  it('ОДИН враг забирает всё — правило вырождается в прежнее', () => {
    const after = afterOneVolley(world(['p1']));
    expect(lost(after, 'f0')).toBeCloseTo(120, 10);
  });

  it('ПОРЯДОК ПРИБЫТИЯ на исход не влияет — та самая дыра, ради которой кирпич', () => {
    // Те же трое, но идентификаторы (а значит и «кто пришёл первым») переставлены.
    const a = afterOneVolley(world(['p1', 'p2', 'p3'], ['aaa', 'bbb', 'ccc']));
    const b = afterOneVolley(world(['p1', 'p2', 'p3'], ['ccc', 'bbb', 'aaa']));
    // p1 в первом раскладе — `aaa`, во втором — `ccc`; урон обязан совпасть.
    expect(lost(a, 'aaa')).toBeCloseTo(lost(b, 'ccc'), 10);
    expect(lost(a, 'bbb')).toBeCloseTo(lost(b, 'bbb'), 10);
  });

  it('СОЮЗНИК мира под огонь не попадает', () => {
    const s = world(['p1', 'p2']);
    setStance(s, 'p2', 'host', 'peace'); // p2 помирился с хозяином мира
    const after = afterOneVolley(s);
    expect(lost(after, 'f1')).toBe(0);
    expect(lost(after, 'f0')).toBeCloseTo(120, 10); // весь залп достаётся оставшемуся врагу
  });
});

describe('MSB-7 — очередь трассеров тоже не зависит от порядка прибытия', () => {
  // Делёж ровный, поэтому УРОН одинаков при любом обходе списка — но подписчики
  // `combat.damage` и слушатели `aa.fired` работают ИМЕННО в этом порядке, и через них
  // порядок прибытия просочился бы обратно. Отсюда сортировка по id в `nearOrbitHostiles`:
  // она больше никого не выбирает, она фиксирует очередь.
  const tracers = (s: GameState): string[] => {
    const r = kernel.advanceTo(s, at(HOUR));
    if (!r.ok) throw new Error(`advance failed: ${r.code}`);
    return r.events
      .filter((e) => e.type === 'aa.fired')
      .map((e) => (e.payload as { fleetId: string }).fleetId);
  };

  it('трассеры идут в одном и том же порядке, кто бы ни подошёл первым', () => {
    expect(tracers(world(['p1', 'p2', 'p3'], ['aaa', 'bbb', 'ccc']))).toEqual([
      'aaa',
      'bbb',
      'ccc',
    ]);
    expect(tracers(world(['p1', 'p2', 'p3'], ['ccc', 'bbb', 'aaa']))).toEqual([
      'aaa',
      'bbb',
      'ccc',
    ]);
  });

  it('на каждую цель — свой трассер, а не один на залп', () => {
    expect(tracers(world(['p1', 'p2', 'p3']))).toHaveLength(3);
  });
});

describe('MSB-7 — обстрел мира уже N-универсален, и это надо удержать', () => {
  // Вторая половина кирпича: обстрел НЕ переделывался, потому что он и не выбирал одну
  // цель — это цикл по всем стоящим здесь флотам, и каждый осаждающий сыплет по
  // постройкам сам. Тест не про новое поведение, а про то, что старое верное поведение
  // не сломается молча: без него «мы проверили» держалось бы на прочтении кода.
  function siege(besiegers: string[]): GameState {
    const s = world(besiegers);
    for (const f of Object.values(s.fleets)) {
      f.units = [{ unit: 'gun', count: 1 }];
      f.bombarding = true;
    }
    return s;
  }

  it('ТРОЕ осаждающих — три независимых обстрела, у каждого своё имя в `by`', () => {
    const r = kernel.advanceTo(siege(['p1', 'p2', 'p3']), at(HOUR));
    if (!r.ok) throw new Error(`advance failed: ${r.code}`);
    const shellings = r.events.filter((e) => e.type === 'planet.bombarded');
    expect(shellings).toHaveLength(3);
    // Именно РАЗНЫЕ владельцы: один и тот же `by` трижды означал бы, что счёт
    // разрушений сведён к одному осаждающему.
    expect(new Set(shellings.map((e) => (e.payload as { by: string }).by))).toEqual(
      new Set(['p1', 'p2', 'p3']),
    );
  });

  it('обстрел НЕ делится: каждый сыплет полную силу, а не треть', () => {
    const one = kernel.advanceTo(siege(['p1']), at(HOUR));
    const three = kernel.advanceTo(siege(['p1', 'p2', 'p3']), at(HOUR));
    if (!one.ok || !three.ok) throw new Error('advance failed');
    const power = (r: typeof one): number[] =>
      r.ok
        ? r.events
            .filter((e) => e.type === 'planet.bombarded')
            .map((e) => (e.payload as { power: number }).power)
        : [];
    // Цель у обстрела одна и она не флот, а мир под килем: делить нечего.
    for (const p of power(three)) expect(p).toBeCloseTo(power(one)[0]!, 10);
  });
});
