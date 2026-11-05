// Отбить своё (BAL-19, освоение): планету, взятую у места другой стороной, место до конца её
// освоения получает назад целиком. Флот бота выбирает такую цель втрое охотнее прочих, если
// возьмёт её и успеет до конца освоения. Довод — у `retakeWeight` в `aiTurn/fleets.ts`.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES, HOUR } from './game';
import { data } from './gameData';
import { openTurn } from './aiTurn/turn';
import { RETAKE_WEIGHT, retakeWeight } from './aiTurn/fleets';
import { decisionNoise, NO_HANDICAP } from './aiTurn/rules';
import { ctx } from './protoKernel';
import {
  estimateTravelHours,
  INTEGRATION_HOURS,
  type Fleet,
  type GameState,
  type Planet,
} from '../../packages/shared-core/src/index';

const capturable = (p: Planet): boolean => data.sectorKinds[p.kind ?? '']?.capturable ?? false;
const D = 100;

/**
 * Флот p2 стоит на своём узле `at`; у p1 две соседние цели: `near` на расстоянии D и `lost`
 * на 1,4·D, которую p1 взял у p2 и ещё осваивает. По одной дальности ближе `near`, а с весом
 * отбития `lost` выигрывает больше чем вдвое (1,4·D / 3 < D / 2), так что и шумовой выбор
 * второй цели курс не отменит. Без веса вторая цель `lost` ближе 2·D, и курс решал бы шум:
 * у этого флота он выше шанса ошибки сильного бота, поэтому без веса курс — `near`. Всё прочее
 * на карте у p2, поэтому он впереди и не охотится.
 */
function scene(): { s: GameState; at: Planet; near: Planet; lost: Planet } {
  const base = newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[5]!, ai: true },
    ],
  });
  const home = START_CANDIDATES[5]!;
  const homeOf = new Set([home, START_CANDIDATES[0]!]);
  const at = Object.values(base.planets).find(
    (p) =>
      capturable(p) &&
      !homeOf.has(p.id) &&
      (p.links ?? []).filter((id) => {
        const nb = base.planets[id];
        return nb && capturable(nb) && !homeOf.has(id);
      }).length >= 2,
  )!;
  const [nearId, lostId] = (at.links ?? []).filter((id) => {
    const nb = base.planets[id];
    return nb && capturable(nb) && !homeOf.has(id);
  });
  const planets: GameState['planets'] = {};
  for (const p of Object.values(base.planets)) {
    const target = p.id === nearId || p.id === lostId;
    const owner = capturable(p) ? (target ? 'p1' : 'p2') : p.owner;
    const position =
      p.id === nearId
        ? { x: at.position.x + D, y: at.position.y }
        : p.id === lostId
          ? { x: at.position.x - 1.4 * D, y: at.position.y }
          : p.position;
    planets[p.id] = { ...p, owner, position, garrison: [] };
  }
  planets[lostId!]!.integration = {
    claim: 'p2',
    since: base.time,
    until: base.time + INTEGRATION_HOURS * HOUR,
  };
  const fleet: Fleet = {
    id: 'f:return',
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
  return { s, at: planets[at.id]!, near: planets[nearId!]!, lost: planets[lostId!]! };
}

const courseOf = (s: GameState): string | undefined =>
  aiOrders(s, 'p2', 'expand', 'strong')
    .filter((a) => a.type === 'fleet.move')
    .map((a) => a.payload as { fleetId: string; to: string })
    .find((m) => m.fleetId === 'f:return')?.to;

const weightOf = (s: GameState, target: string): number => {
  const bot = openTurn(s, 'p2', 'expand', 'strong', new Set())!;
  const f = s.fleets['f:return']!;
  return retakeWeight(bot, f, f.location!, s.planets[target]!);
};

describe('бот отбивает своё (BAL-19)', () => {
  it('флот идёт к своей планете в чужом освоении, а не к ближней цели', () => {
    const { s, at, lost } = scene();
    // Предпосылка сцены: флот успевает к планете задолго до конца освоения.
    const eta = estimateTravelHours(s, ctx(s.time, s), at.id, lost.id, s.fleets['f:return']!);
    expect(eta).not.toBeNull();
    expect(eta!).toBeLessThan(INTEGRATION_HOURS);
    expect(weightOf(s, lost.id)).toBe(RETAKE_WEIGHT);
    expect(courseOf(s)).toBe(lost.id);
  });

  it('чужая цель, опоздание и гарнизон, который не взять, веса не дают', () => {
    const { s, near, lost } = scene();
    expect(weightOf(s, near.id)).toBe(1);
    // Освоение кончится раньше, чем флот долетит: на месте он застанет обычную чужую планету.
    const late = structuredClone(s);
    late.planets[lost.id]!.integration = {
      claim: 'p2',
      since: s.time - INTEGRATION_HOURS * HOUR + 60_000,
      until: s.time + 60_000,
    };
    expect(weightOf(late, lost.id)).toBe(1);
    // Гарнизон, который флот без десанта не возьмёт.
    const held = structuredClone(s);
    held.planets[lost.id]!.garrison = [{ unit: 'heavy_infantry', count: 6 }];
    expect(weightOf(held, lost.id)).toBe(1);
    // Право на планету у третьей стороны, а не у p2: обычная чужая цель, курс к ближней.
    const other = structuredClone(s);
    other.planets[lost.id]!.integration!.claim = 'p3';
    expect(weightOf(other, lost.id)).toBe(1);
    expect(decisionNoise(other, 'p2', 'target:f:return')).toBeGreaterThanOrEqual(
      NO_HANDICAP.wrongTarget,
    );
    expect(courseOf(other)).toBe(near.id);
  });
});
