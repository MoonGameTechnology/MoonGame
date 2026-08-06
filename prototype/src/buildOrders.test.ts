import { describe, it, expect } from 'vitest';
import type { GameData, GameState } from '../../packages/shared-core/src/index';
import type { QueuedBuild } from './buildQueue';
import {
  WAIT_CODE,
  afford,
  emptyQueue,
  laneOf,
  queuedAction,
  queuedCost,
  waitsForMoney,
} from './buildOrders';

const data = {
  units: { corvette: { cost: { credits: 20, alloy: 5 } }, hero: {} },
  buildings: {
    mine: {
      cost: { credits: 100 },
      upgrades: [{ cost: { credits: 200 } }, { cost: { credits: 400 } }],
    },
  },
} as unknown as GameData;

/** Мир с постройкой указанного уровня — цена апгрейда считается от него. */
const worldWith = (level: number): GameState =>
  ({
    planets: { C1R1: { buildings: [{ type: 'mine', level }] } },
  }) as unknown as GameState;

const q = (over: Partial<QueuedBuild> = {}): QueuedBuild =>
  ({ kind: 'building', id: 'mine', count: 1, ...over }) as QueuedBuild;

describe('очередь — полосы', () => {
  it('юниты идут своей полосой, здания и апгрейды — общей', () => {
    expect(laneOf('unit')).toBe('units');
    expect(laneOf('building')).toBe('buildings');
    expect(laneOf('upgrade')).toBe('buildings');
  });

  it('новая очередь пуста в обеих полосах', () => {
    expect(emptyQueue()).toEqual({ buildings: [], units: [] });
  });

  it('каждая новая очередь — своя (полосы не общие на все миры)', () => {
    const a = emptyQueue();
    a.units.push(q({ kind: 'unit', id: 'corvette' }));
    expect(emptyQueue().units).toEqual([]);
  });
});

describe('очередь — хватает ли казны', () => {
  const res = { credits: 100, alloy: 10 };

  it('хватает по всем ресурсам — да', () => {
    expect(afford(res, { credits: 50, alloy: 10 })).toBe(true);
  });

  it('не хватает хотя бы одного — нет', () => {
    expect(afford(res, { credits: 50, alloy: 11 })).toBe(false);
  });

  it('ровно столько, сколько есть — хватает', () => {
    expect(afford(res, { credits: 100 })).toBe(true);
  });

  it('незнакомый ресурс считается нулевым', () => {
    expect(afford(res, { exotic: 1 })).toBe(false);
  });

  it('платить нечем и не за что — хватает', () => {
    expect(afford(res, {})).toBe(true);
    expect(afford(res, undefined)).toBe(true);
  });

  it('пустая казна не «богата» по умолчанию', () => {
    expect(afford({}, { credits: 1 })).toBe(false);
  });
});

describe('очередь — цена головы', () => {
  it('здание берёт цену из данных', () => {
    expect(queuedCost(worldWith(1), data, 'C1R1', q())).toEqual({ credits: 100 });
  });

  it('ЦЕНА ЮНИТА МАСШТАБИРУЕТСЯ на количество — как это делает ядро', () => {
    const five = q({ kind: 'unit', id: 'corvette', count: 5 });
    expect(queuedCost(worldWith(1), data, 'C1R1', five)).toEqual({ credits: 100, alloy: 25 });
  });

  it('один юнит — цена как в данных, без пересборки объекта', () => {
    const one = q({ kind: 'unit', id: 'corvette', count: 1 });
    expect(queuedCost(worldWith(1), data, 'C1R1', one)).toEqual({ credits: 20, alloy: 5 });
  });

  it('АПГРЕЙД берёт цену перехода с ТЕКУЩЕГО уровня — upgrades[level-1]', () => {
    const up = q({ kind: 'upgrade', id: 'mine' });
    expect(queuedCost(worldWith(1), data, 'C1R1', up)).toEqual({ credits: 200 });
    expect(queuedCost(worldWith(2), data, 'C1R1', up)).toEqual({ credits: 400 });
  });

  it('апгрейд на максимуме — цену назвать нечем', () => {
    expect(
      queuedCost(worldWith(3), data, 'C1R1', q({ kind: 'upgrade', id: 'mine' })),
    ).toBeUndefined();
  });

  it('апгрейд того, чего на мире нет — цены нет', () => {
    expect(
      queuedCost(worldWith(1), data, 'C2R2', q({ kind: 'upgrade', id: 'mine' })),
    ).toBeUndefined();
  });

  it('неизвестный id — цены нет (а НЕ «бесплатно»)', () => {
    expect(queuedCost(worldWith(1), data, 'C1R1', q({ id: 'нет-такого' }))).toBeUndefined();
    expect(
      queuedCost(worldWith(1), data, 'C1R1', q({ kind: 'unit', id: 'нет-такого' })),
    ).toBeUndefined();
  });

  it('юнит без цены в данных — тоже «цены нет»', () => {
    expect(queuedCost(worldWith(1), data, 'C1R1', q({ kind: 'unit', id: 'hero' }))).toBeUndefined();
  });
});

describe('очередь — приказ головы', () => {
  it('юнит уезжает приказом на юнит, с количеством', () => {
    const a = queuedAction('p1', 'C1R1', q({ kind: 'unit', id: 'corvette', count: 3 }));
    expect(a.type).toBe('unit.build');
    expect(a.playerId).toBe('p1');
  });

  it('здание и апгрейд — разные приказы', () => {
    const build = queuedAction('p1', 'C1R1', q({ kind: 'building', id: 'mine' }));
    const up = queuedAction('p1', 'C1R1', q({ kind: 'upgrade', id: 'mine' }));
    expect(build.type).not.toBe(up.type);
  });

  it('приказ адресован тому миру, из очереди которого взят', () => {
    const a = queuedAction('p1', 'C7R7', q()) as unknown as { payload: { planetId: string } };
    expect(a.payload.planetId).toBe('C7R7');
  });
});

describe('очередь — когда голову держать', () => {
  it('нечем платить — ждём', () => {
    expect(waitsForMoney(WAIT_CODE)).toBe(true);
  });

  it('приказ проходит — пускаем', () => {
    expect(waitsForMoney(null)).toBe(false);
  });

  it('ЛЮБОЙ неденежный отказ пускаем в ядро — там игрок узнает настоящую причину', () => {
    for (const code of ['E_MAX_LEVEL', 'E_NO_SHIPYARD', 'E_BOMBARDED', 'E_WRONG_SECTOR']) {
      expect(waitsForMoney(code)).toBe(false);
    }
  });
});
