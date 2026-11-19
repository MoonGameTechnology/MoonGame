import { describe, expect, it } from 'vitest';
import {
  LANE_MAX,
  foldLane,
  lineOverload,
  schemeLanes,
  visibleVolleys,
  worldHeir,
  type SchemeSide,
} from './battleScheme';

const side = (key: string, owner: string | null, extra: Partial<SchemeSide> = {}): SchemeSide => ({
  key,
  owner,
  mine: false,
  attacks: false,
  alive: true,
  ...extra,
});

/** Все разные владельцы враждуют, кроме пар из `peace`. */
const hostility =
  (...peace: [string, string][]) =>
  (a: string | null | undefined, b: string | null | undefined): boolean =>
    a !== b && !peace.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

describe('ряды схемы', () => {
  it('свои и союзники — снизу, моя сторона первой; остальные — сверху', () => {
    const sides = [
      side('nord', 'n', { ally: true }),
      side('hydra', 'h'),
      side('me', 'p1', { mine: true }),
      side('amber', 'a'),
    ];
    const lanes = schemeLanes(sides, hostility(['p1', 'n'], ['p1', 'a']));
    expect(lanes.ours.map((s) => s.key)).toEqual(['me', 'nord']);
    // Нейтрал не враг мне, но и не союзник: приказать ему нельзя — он сверху.
    expect(lanes.theirs.map((s) => s.key)).toEqual(['hydra', 'amber']);
    expect(lanes.observer).toBe(false);
  });

  it('чужой бой: снизу первая сторона и её не-враги, сверху их противники', () => {
    const sides = [side('h1', 'h'), side('a1', 'a'), side('h2', 'h'), side('x', 'x')];
    const lanes = schemeLanes(sides, hostility(['h', 'x']));
    expect(lanes.observer).toBe(true);
    expect(lanes.ours.map((s) => s.key)).toEqual(['h1', 'h2', 'x']);
    expect(lanes.theirs.map((s) => s.key)).toEqual(['a1']);
  });
});

describe('видимые залпы', () => {
  it('дуэль, я атакую: одна стрелка, весь залп в одного; ответ врага не виден', () => {
    const v = visibleVolleys(
      [side('me', 'p1', { mine: true, attacks: true }), side('foe', 'p2')],
      hostility(),
    );
    expect(v).toEqual([{ from: 'me', to: 'foe', of: 1, reply: false }]);
  });

  it('на меня напали: куда целится враг, не видно — видно только мой ответ', () => {
    const v = visibleVolleys(
      [side('me', 'p1', { mine: true }), side('foe', 'p2', { attacks: true })],
      hostility(),
    );
    expect(v).toEqual([{ from: 'me', to: 'foe', of: 1, reply: true }]);
  });

  it('свалка: мой залп поровну на всех врагов, союзник отвечает тому, кто по нему бьёт', () => {
    const sides = [
      side('me', 'p1', { mine: true, attacks: true }),
      side('nord', 'n', { ally: true }),
      side('hydra', 'h', { attacks: true }),
      side('spec', 'h'),
    ];
    const v = visibleVolleys(sides, hostility(['p1', 'n']));
    expect(v).toEqual([
      { from: 'me', to: 'hydra', of: 2, reply: false },
      { from: 'me', to: 'spec', of: 2, reply: false },
      { from: 'nord', to: 'hydra', of: 1, reply: true },
    ]);
  });

  it('погибшая сторона не стреляет и в доли не входит', () => {
    const v = visibleVolleys(
      [
        side('me', 'p1', { mine: true, attacks: true }),
        side('a', 'p2'),
        side('b', 'p3', { alive: false }),
      ],
      hostility(),
    );
    expect(v).toEqual([{ from: 'me', to: 'a', of: 1, reply: false }]);
  });

  it('в чужом бою стрелок нет вовсе', () => {
    const v = visibleVolleys(
      [side('a', 'p2', { attacks: true }), side('b', 'p3', { attacks: true })],
      hostility(),
    );
    expect(v).toEqual([]);
  });
});

describe('сворачивание ряда в «+N»', () => {
  const many = (n: number, mineAt = -1) =>
    Array.from({ length: n }, (_, i) => ({ key: `s${i}`, mine: i === mineAt }));

  it(`до ${LANE_MAX} плиток — ряд целиком`, () => {
    expect(foldLane(many(LANE_MAX), false).folded).toEqual([]);
  });

  it('длиннее — хвост уходит в одну плитку «+N», ряд остаётся в LANE_MAX плиток', () => {
    const { shown, folded } = foldLane(many(14), false);
    expect(shown).toHaveLength(LANE_MAX - 1);
    expect(folded).toHaveLength(14 - (LANE_MAX - 1));
  });

  it('раскрытый ряд показывает всех', () => {
    expect(foldLane(many(14), true).shown).toHaveLength(14);
  });

  it('своя сторона в хвосте всё равно на виду', () => {
    const { shown, folded } = foldLane(many(14, 12), false);
    expect(shown.map((s) => s.key)).toContain('s12');
    expect(shown).toHaveLength(LANE_MAX - 1);
    expect(folded.some((s) => s.mine)).toBe(false);
  });
});

describe('перегруз линии флотов державы (MSB-13)', () => {
  it('пять флотов и меньше — строки нет', () => {
    expect(lineOverload(5)).toBeNull();
    expect(lineOverload(1)).toBeNull();
    expect(lineOverload(0)).toBeNull();
  });

  it('сверх пяти — каждый флот бьёт на 5/M, как у ядра', () => {
    expect(lineOverload(6)).toEqual({ count: 6, cap: 5, pct: 83 });
    expect(lineOverload(7)).toEqual({ count: 7, cap: 5, pct: 71 });
    expect(lineOverload(10)).toEqual({ count: 10, cap: 5, pct: 50 });
  });
});

describe('кому достанется мир', () => {
  it('один плацдарм — вопроса нет', () => {
    expect(worldHeir([{ owner: 'p1', alive: true }])).toBeNull();
  });

  it('два живых — первому высадившемуся', () => {
    expect(
      worldHeir([
        { owner: 'nord', alive: true },
        { owner: 'p1', alive: true },
      ]),
    ).toBe('nord');
  });

  it('первый выбит — мир не мёртвому; живых меньше двух — строки нет', () => {
    expect(
      worldHeir([
        { owner: 'nord', alive: false },
        { owner: 'p1', alive: true },
        { owner: 'p3', alive: true },
      ]),
    ).toBe('p1');
    expect(
      worldHeir([
        { owner: 'nord', alive: false },
        { owner: 'p1', alive: true },
      ]),
    ).toBeNull();
  });
});
