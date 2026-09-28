// Охота отстающего (снежный ком, 2026-09-28): флот места, которое ОТСТАЁТ по очкам
// провинций на войне, выбирает цель по «расстояние ÷ ценность», а не ближайшую. Лидер
// идёт к ближайшему, как раньше. Замер и довод — у `huntWeight` в `ai.ts`.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES } from './game';
import { data } from './gameData';
import { huntWeight } from './ai';
import { provinceScore } from '../../packages/shared-core/src/state/sectorKind';
import type { Fleet, GameState, Planet } from '../../packages/shared-core/src/index';

const capturable = (p: Planet): boolean => data.sectorKinds[p.kind ?? '']?.capturable ?? false;

/**
 * Узел `at` и две цели p1: 10-очковая провинция `near` на расстоянии D и планета
 * `prize` на 2.2·D. По одной дальности планета не проходит даже как «вторая цель»
 * (дальше 2× ближней), а по весу выигрывает с запасом: 2.2·D / 5 < D / 2, так что и
 * шумовой выбор второй цели курс не отменит. Координаты ставятся прямо — остальные
 * узлы в сцене не цели (свои или мирного соседа), поэтому геометрия карты не мешает.
 */
function findLayout(s: GameState, home: string): { at: Planet; near: Planet; prize: Planet } {
  const free = Object.values(s.planets).filter(
    (p) => capturable(p) && p.id !== home && p.buildings.length === 0,
  );
  const at = free.find((p) => provinceScore(data, p) < 50)!;
  const nearSrc = free.find((p) => p.id !== at.id && provinceScore(data, p) < 50)!;
  const prizeSrc = free.find((p) => provinceScore(data, p) >= 50)!;
  const D = 100;
  const near = { ...nearSrc, position: { x: at.position.x + D, y: at.position.y } };
  const prize = { ...prizeSrc, position: { x: at.position.x - 2.2 * D, y: at.position.y } };
  return { at, near, prize };
}

/** p2 воюет с p1; все прочие узлы — у `rest` (p3 в мире с p2 — туда не летают). */
function scene(rest: 'p2' | 'p3'): { s: GameState; near: Planet; prize: Planet } {
  const base = newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[5]!, ai: true },
      { id: 'p3', name: 'C', faction: 'amber', start: START_CANDIDATES[2]!, ai: true },
    ],
  });
  // Дом p2 (верфь) остаётся за ним: без него якорем стал бы `at`, а флот на якоре
  // в войну ждёт ударную группу вместо того, чтобы лететь.
  const home = START_CANDIDATES[5]!;
  const { at, near, prize } = findLayout(base, home);
  const planets: GameState['planets'] = {};
  for (const p of Object.values(base.planets)) {
    const owner =
      p.id === near.id || p.id === prize.id ? 'p1' : p.id === at.id || p.id === home ? 'p2' : rest;
    const src = p.id === near.id ? near : p.id === prize.id ? prize : p;
    planets[p.id] = { ...src, owner: capturable(p) ? owner : p.owner, garrison: [] };
  }
  const fleet: Fleet = {
    id: 'f:hunt',
    owner: 'p2',
    location: at.id,
    units: [{ unit: 'cruiser', count: 2 }],
    landing: [],
    traits: [],
    movement: null,
    orbit: 'near',
  };
  const s: GameState = {
    ...base,
    planets,
    fleets: { [fleet.id]: fleet },
    diplomacy: { ...(base.diplomacy ?? {}), 'p1|p2': 'war' },
  };
  return { s, near, prize };
}

const courseOf = (s: GameState): string | undefined =>
  aiOrders(s, 'p2', 'expand', 'strong')
    .filter((a) => a.type === 'fleet.move')
    .map((a) => a.payload as { fleetId: string; to: string })
    .find((m) => m.fleetId === 'f:hunt')?.to;

describe('охота отстающего', () => {
  it('вес: планета 5, прочее 1; гарнизон, который не взять, делит вес на 5', () => {
    const s = scene('p3').s;
    const [planet] = Object.values(s.planets).filter((p) => provinceScore(data, p) >= 50);
    const [minor] = Object.values(s.planets).filter(
      (p) => capturable(p) && provinceScore(data, p) < 20,
    );
    expect(huntWeight(planet!, [])).toBe(5);
    expect(huntWeight(minor!, [])).toBe(1);
    const held = { ...planet!, garrison: [{ unit: 'heavy_infantry', count: 6 }] };
    expect(huntWeight(held, [])).toBe(1);
  });

  it('отстающий на войне идёт к планете, а не к ближней провинции', () => {
    const { s, prize } = scene('p3'); // у p3 почти вся карта — p2 отстаёт
    expect(courseOf(s)).toBe(prize.id);
  });

  it('лидер по-прежнему идёт к ближайшему', () => {
    const { s, near } = scene('p2'); // вся карта у самого p2 — он впереди
    expect(courseOf(s)).toBe(near.id);
  });

  it('слабый профиль охоты не знает', () => {
    const { s, near } = scene('p3');
    const to = aiOrders(s, 'p2', 'expand', 'weak')
      .filter((a) => a.type === 'fleet.move')
      .map((a) => a.payload as { fleetId: string; to: string })
      .find((m) => m.fleetId === 'f:hunt')?.to;
    expect(to).toBe(near.id);
  });
});

// Ударный резерв (`STRIKE_RESERVE` в `ai.ts`): столица, у которой запас в 8 голов целиком
// уходит в пол гарнизона, продолжает строить войска, пока в десант нечего отдать.
describe('ударный резерв', () => {
  function capital(garrison: Array<{ unit: string; count: number }>): {
    s: GameState;
    home: string;
  } {
    const s = newGame({
      seats: [
        { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
        { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[5]!, ai: true },
      ],
    });
    const home = START_CANDIDATES[5]!;
    const p = s.planets[home]!;
    // Застроенная столица: пол гарнизона растёт с уровнями зданий.
    const extra = ['barracks', 'fort', 'hospital', 'refinery', 'tax_office', 'mine'].map(
      (type) => ({ type, level: 1, hp: 25 }),
    );
    const planets = {
      ...s.planets,
      [home]: { ...p, buildings: [...p.buildings, ...extra], garrison },
    };
    const players = {
      ...s.players,
      p2: {
        ...s.players.p2!,
        resources: {
          ...s.players.p2!.resources,
          metal: 5000,
          credits: 5000,
          microelectronics: 500,
        },
      },
    };
    return { s: { ...s, planets, players }, home };
  }
  const groundOrders = (s: GameState, home: string): number =>
    aiOrders(s, 'p2', 'expand', 'strong').filter(
      (a) =>
        a.type === 'unit.build' &&
        (a.payload as { planetId: string; unit: string }).planetId === home &&
        data.units[(a.payload as { unit: string }).unit]?.domain === 'ground',
    ).length;

  it('восемь ополченцев на полу — войска всё равно заказываются', () => {
    const { s, home } = capital([{ unit: 'militia', count: 8 }]);
    expect(groundOrders(s, home)).toBeGreaterThan(0);
  });

  it('резерв набран — больше не заказывает', () => {
    const { s, home } = capital([
      { unit: 'militia', count: 8 },
      { unit: 'tank', count: 6 },
    ]);
    expect(groundOrders(s, home)).toBe(0);
  });
});
