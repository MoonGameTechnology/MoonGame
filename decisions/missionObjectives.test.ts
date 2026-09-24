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
