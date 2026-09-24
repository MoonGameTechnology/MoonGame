/**
 * ДОПОЛНИТЕЛЬНЫЕ ЗАДАЧИ ЗАБЕГА (PVR-5.2; решение владельца 2026-09-22).
 *
 * Задача здесь — ЧИСТОЕ УСЛОВИЕ над состоянием матча, а не сущность в нём. Тест держит
 * именно это свойство: одна и та же функция отвечает и живой строке в интерфейсе, и
 * выплате в конце попытки, поэтому разойтись «что показали» и «за что заплатили» не могут.
 */
import { describe, expect, it } from 'vitest';
import {
  missionProgress,
  objectiveBonus,
  objectiveProgress,
  type MissionObjective,
} from './missionObjectives';
import type { GameState, Planet } from '../packages/shared-core/src/index';

const planet = (id: string, owner: string | null, buildings: Array<[string, number]> = []): Planet => ({
  id,
  owner,
  position: { x: 0, y: 0 },
  resources: {},
  buildings: buildings.map(([type, hp]) => ({ type, level: 1, hp })),
  garrison: [],
  traits: [],
});

function world(planets: Planet[], fog: string[] = []): GameState {
  return {
    planets: Object.fromEntries(planets.map((p) => [p.id, p])),
    fog: fog.length ? { p1: Object.fromEntries(fog.map((id) => [id, {}])) } : undefined,
  } as unknown as GameState;
}

const salvage: MissionObjective = {
  id: 'mission.salvage',
  kind: 'control',
  targets: ['w1', 'w2'],
  reward: 3,
};
const raze: MissionObjective = {
  id: 'mission.raze-biomass',
  kind: 'raze',
  targets: ['biomass_pit'],
  reward: 3,
};
const recon: MissionObjective = { id: 'mission.recon', kind: 'scout', targets: [], count: 3, reward: 2 };

describe('сбор материалов — взять названные узлы', () => {
  it('считает ВЗЯТЫЕ, а не все подряд', () => {
    const s = world([planet('w1', 'p1'), planet('w2', 'swarm')]);
    expect(objectiveProgress(salvage, s, 'p1')).toMatchObject({ done: 1, total: 2, complete: false });
  });

  it('выполняется, когда взяты ВСЕ', () => {
    const s = world([planet('w1', 'p1'), planet('w2', 'p1')]);
    expect(objectiveProgress(salvage, s, 'p1').complete).toBe(true);
  });

  it('чужой владелец не считается — контроль именно СВОЙ', () => {
    const s = world([planet('w1', 'swarm'), planet('w2', 'swarm')]);
    expect(objectiveProgress(salvage, s, 'p1')).toMatchObject({ done: 0, complete: false });
  });
});

describe('зачистка производства — чтобы построек не осталось', () => {
  it('пока постройка цела — не выполнено', () => {
    const s = world([planet('h', 'swarm', [['biomass_pit', 30]])]);
    expect(objectiveProgress(raze, s, 'p1').complete).toBe(false);
  });

  it('без названных целей не выполняется сама собой (ревью Sector Zero)', () => {
    // Схема карты допускает пустой `targets`; без предохранителя задача платила бы с первой
    // секунды каждого забега и закрывалась навсегда.
    const s = world([planet('h', 'swarm', [['biomass_pit', 30]])]);
    expect(objectiveProgress({ ...raze, targets: [] }, s, 'p1').complete).toBe(false);
  });

  it('РАЗРУШЕННАЯ постройка уже не считается стоящей', () => {
    // Иначе задача выполнялась бы только полным исчезновением записи, а её там не будет:
    // снос оставляет здание с нулевым `hp` ровно до следующей сверки.
    const s = world([planet('h', 'swarm', [['biomass_pit', 0]])]);
    expect(objectiveProgress(raze, s, 'p1').complete).toBe(true);
  });

  it('СВОИ постройки того же вида задачу не ломают', () => {
    // Контроль: считать «все такие здания на карте» значило бы запретить игроку строить
    // биореактор самому — задача про ПРОТИВНИКА, а не про вид здания.
    const s = world([planet('mine', 'p1', [['biomass_pit', 30]]), planet('h', 'swarm')]);
    expect(objectiveProgress(raze, s, 'p1').complete).toBe(true);
  });
});

describe('разведка — решается ходьбой', () => {
  it('считает опознанные провинции и упирается в потолок', () => {
    expect(objectiveProgress(recon, world([], ['a', 'b']), 'p1')).toMatchObject({ done: 2, complete: false });
    expect(objectiveProgress(recon, world([], ['a', 'b', 'c', 'd']), 'p1')).toMatchObject({
      done: 3,
      total: 3,
      complete: true,
    });
  });

  it('без памяти тумана — ноль, а не падение', () => {
    // Забег может идти на хосте, который тумана не ведёт; задача обязана это пережить.
    expect(objectiveProgress(recon, world([]), 'p1')).toMatchObject({ done: 0, complete: false });
  });
});

describe('награда', () => {
  it('платит только за ВЫПОЛНЕННЫЕ и складывает их', () => {
    const s = world([planet('w1', 'p1'), planet('w2', 'p1'), planet('h', 'swarm')], ['a', 'b', 'c']);
    expect(objectiveBonus([salvage, raze, recon], s, 'p1')).toBe(3 + 3 + 2);
  });

  it('ни одной выполненной — ноль, и это нормальный забег', () => {
    const s = world([planet('w1', 'swarm'), planet('w2', 'swarm'), planet('h', 'swarm', [['biomass_pit', 30]])]);
    expect(objectiveBonus([salvage, raze, recon], s, 'p1')).toBe(0);
  });

  it('карта без задач ничего не добавляет', () => {
    expect(objectiveBonus([], world([]), 'p1')).toBe(0);
  });

  it('ОДНА функция кормит и показ, и выплату', () => {
    // Смысл всей формы: разойтись «что показали игроку» и «за что заплатили» не могут,
    // потому что источник один. Разведи их — и первое же расхождение увидит игрок.
    const s = world([planet('w1', 'p1'), planet('w2', 'p1')]);
    const shown = missionProgress([salvage], s, 'p1');
    expect(shown[0]!.complete).toBe(true);
    expect(objectiveBonus([salvage], s, 'p1')).toBe(shown[0]!.reward);
  });
});

describe('новые задачи владельца 2026-09-24: крепость, эвакуация, спасение, маяк', () => {
  const HOUR = 3_600_000;
  const withFacts = (s: GameState, facts: GameState['missionFacts'], time = 0): GameState =>
    ({ ...s, missionFacts: facts, time, fleets: {} }) as GameState;

  it('крепость в провинции — считается только в названном месте', () => {
    const fort: MissionObjective = { id: 'm.fort', kind: 'build', targets: ['starfort'], at: ['gate'], count: 1, reward: 3 };
    const elsewhere = world([planet('home', 'p1', [['starfort', 50]]), planet('gate', 'p1')]);
    expect(objectiveProgress(fort, elsewhere, 'p1').complete).toBe(false);
    const there = world([planet('home', 'p1'), planet('gate', 'p1', [['starfort', 50]])]);
    expect(objectiveProgress(fort, there, 'p1').complete).toBe(true);
  });

  it('эвакуация — счёт доставленных из памяти фактов', () => {
    const evac: MissionObjective = { id: 'm.evac', kind: 'evac', targets: [], count: 4, reward: 3 };
    const s = withFacts(world([]), { evacuated: { p1: 3 } });
    expect(objectiveProgress(evac, s, 'p1')).toMatchObject({ done: 3, total: 4, complete: false });
    expect(objectiveProgress(evac, withFacts(world([]), { evacuated: { p1: 5 } }), 'p1').complete).toBe(true);
  });

  it('спасение — выполнено, когда мир твой и врага у него нет; пал — провал до конца забега', () => {
    const rescue: MissionObjective = { id: 'm.rescue', kind: 'rescue', targets: ['keep'], reward: 3 };
    const besieged = {
      ...world([planet('keep', 'p1')]),
      fleets: { s: { id: 's', owner: 'swarm', location: 'keep', movement: null, units: [{ unit: 'x', count: 2 }], traits: [] } },
    } as unknown as GameState;
    expect(objectiveProgress(rescue, besieged, 'p1')).toMatchObject({ complete: false, failed: false });
    const relieved = { ...world([planet('keep', 'p1')]), fleets: {} } as unknown as GameState;
    expect(objectiveProgress(rescue, relieved, 'p1').complete).toBe(true);
    // Гарнизон пал и мир отбит назад — задача всё равно провалена (решение владельца).
    const retaken = withFacts(world([planet('keep', 'p1')]), { fallen: { p1: ['keep'] } });
    expect(objectiveProgress(rescue, retaken, 'p1')).toMatchObject({ complete: false, failed: true });
  });

  it('маяк — N часов подряд; выполненная серия не отменяется потерей после', () => {
    const beacon: MissionObjective = { id: 'm.beacon', kind: 'beacon', targets: ['b'], count: 6, reward: 3 };
    const holding = withFacts(world([planet('b', 'p1')]), { held: { b: { owner: 'p1', since: 2 * HOUR } } }, 5 * HOUR);
    expect(objectiveProgress(beacon, holding, 'p1')).toMatchObject({ done: 3, total: 6, complete: false, holdMs: 3 * HOUR, needMs: 6 * HOUR });
    const done = withFacts(world([planet('b', 'p1')]), { held: { b: { owner: 'p1', since: 0 } } }, 6 * HOUR);
    expect(objectiveProgress(beacon, done, 'p1').complete).toBe(true);
    // Серия 7 ч состоялась, потом маяк отбит Роем — задача выполнена.
    const lostAfter = withFacts(world([planet('b', 'swarm')]), { held: { b: { owner: 'swarm', since: 9 * HOUR } }, longest: { b: { p1: 7 * HOUR } } }, 10 * HOUR);
    expect(objectiveProgress(beacon, lostAfter, 'p1').complete).toBe(true);
    // Две серии по 4 ч — не «подряд».
    const broken = withFacts(world([planet('b', 'p1')]), { held: { b: { owner: 'p1', since: 10 * HOUR } }, longest: { b: { p1: 4 * HOUR } } }, 14 * HOUR);
    expect(objectiveProgress(beacon, broken, 'p1').complete).toBe(false);
  });
});
