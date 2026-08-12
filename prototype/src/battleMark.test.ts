import { describe, it, expect } from 'vitest';
import {
  BATTLE_RINGS,
  battleMark,
  clashPoint,
  phaseLook,
  ringPhase,
  ringRadiusAt,
  type BattlePhase,
  type BattleSight,
} from './battleMark';

const бой = (over: Partial<BattleSight> = {}): BattleSight => ({
  identified: true,
  hasPoint: true,
  detail: 1,
  nextRoundAt: 1000,
  ...over,
});

describe('отметка боя — где он идёт', () => {
  it('ЯКОРЬ У ВОЮЮЩЕГО ФЛОТА: перехват идёт там, где встретились, а не в ближайшем мире', () => {
    const мир = { x: 0, y: 0 };
    const флот = { x: 40, y: 7 };
    expect(clashPoint([флот], мир)).toBe(флот);
  });

  it('первый флот с позицией и решает — остальные не спорят', () => {
    const a = { x: 1, y: 1 };
    const b = { x: 2, y: 2 };
    expect(clashPoint([null, a, b], null)).toBe(a);
  });

  it('НЕТ ВОЮЮЩИХ С ПОЗИЦИЕЙ — падаем на узел: бой всё-таки где-то идёт', () => {
    const мир = { x: 5, y: 5 };
    expect(clashPoint([null, null], мир)).toBe(мир);
    expect(clashPoint([], мир)).toBe(мир);
  });

  it('ни флота, ни узла — рисовать нечего', () => {
    expect(clashPoint([null], null)).toBeNull();
  });
});

describe('отметка боя — когда её видно', () => {
  it('ПОД ТУМАНОМ БОЯ НЕ ВИДНО: кольцо работало бы бесплатной разведкой', () => {
    expect(battleMark(бой({ identified: false }))).toEqual({ do: 'none' });
  });

  it('без точки схватки отметки нет', () => {
    expect(battleMark(бой({ hasPoint: false }))).toEqual({ do: 'none' });
  });

  it('опознанный бой с точкой рисуется', () => {
    expect(battleMark(бой())).toEqual({ do: 'draw', label: true, timer: true });
  });

  it('НА СХЕМАТИЧНОМ ВИДЕ ПОДПИСИ НЕТ — но кольца остаются: бой это сигнал', () => {
    expect(battleMark(бой({ detail: 0 }))).toEqual({ do: 'draw', label: false, timer: false });
  });

  it('ТАЙМЕР ТОЛЬКО ПО НАЗНАЧЕННОМУ РАУНДУ: отсчёт без времени врал бы', () => {
    expect(battleMark(бой({ nextRoundAt: undefined }))).toEqual({
      do: 'draw',
      label: true,
      timer: false,
    });
  });

  it('назначенный раунд в НОЛЬ — тоже время, а не «не назначено»', () => {
    expect(battleMark(бой({ nextRoundAt: 0 }))).toEqual({ do: 'draw', label: true, timer: true });
  });
});

describe('отметка боя — две фазы', () => {
  const орбита = phaseLook('orbital');
  const земля = phaseLook('ground');

  it('ФАЗЫ НЕПОХОЖИ ПО ВСЕМ ПРИЗНАКАМ, а не только по цвету: аудит нашёл их неразличимыми', () => {
    expect(земля.color).not.toBe(орбита.color);
    expect(земля.dash).not.toBeNull();
    expect(орбита.dash).toBeNull();
    expect(земля.frontLine).toBe(true);
    expect(орбита.frontLine).toBe(false);
  });

  it('НАЗЕМНЫЕ КОЛЬЦА ПРИЖАТЫ К ПОВЕРХНОСТИ: уже и растут меньше орбитальных', () => {
    expect(земля.from).toBeLessThan(орбита.from);
    expect(земля.grow).toBeLessThan(орбита.grow);
    for (let k = 0; k <= 1; k += 0.1)
      expect(ringRadiusAt(земля, k)).toBeLessThan(ringRadiusAt(орбита, k));
  });

  it('вид фазы стабилен', () => {
    for (const p of ['orbital', 'ground'] as BattlePhase[])
      expect(phaseLook(p)).toEqual(phaseLook(p));
  });
});

describe('отметка боя — волна колец', () => {
  it('КОЛЬЦА СДВИНУТЫ НА ТРЕТЬ: одно читалось бы как мигание, три — как волна', () => {
    expect(ringPhase(0, 0)).toBeCloseTo(0, 12);
    expect(ringPhase(0, 1)).toBeCloseTo(1 / 3, 12);
    expect(ringPhase(0, 2)).toBeCloseTo(2 / 3, 12);
  });

  it('доля всегда в пределах оборота — кольцо не улетает за свой размер', () => {
    for (let w = 0; w < 1; w += 0.05)
      for (let i = 0; i < BATTLE_RINGS; i++) {
        const k = ringPhase(w, i);
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThan(1);
      }
  });

  it('волна замыкается: кольцо возвращается в начало через полный оборот', () => {
    expect(ringPhase(0.999999, 0)).toBeGreaterThan(0.99);
    expect(ringPhase(0, 0)).toBeCloseTo(0, 12);
  });

  it('радиус растёт от начального к начальному плюс прирост', () => {
    const l = phaseLook('orbital');
    expect(ringRadiusAt(l, 0)).toBe(l.from);
    expect(ringRadiusAt(l, 1)).toBe(l.from + l.grow);
  });
});
