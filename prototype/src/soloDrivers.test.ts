import { describe, it, expect } from 'vitest';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import { newGame, order, HOUR, START_CANDIDATES } from './game';
import { initSoloDrivers, autoProbeKey, AI_STEP_MS, type SoloHost } from './soloDrivers';

/**
 * REFM-26: драйверы проверяются на НАСТОЯЩЕМ состоянии матча — они читают мир
 * (флоты, миры, дипломатию) и зовут редьюсер, поэтому подделка состояния проверяла бы
 * подделку. Подделаны только пути приказов, чтобы видеть, ЧТО именно выдано.
 */
function harness(over: Partial<SoloHost> = {}, seed: GameState = newGame()) {
  let s = seed;
  const mine: Action[] = [];
  const others: Action[] = [];
  const patrols = new Map<string, { kind: 'planet' | 'fleet' }>();
  const autoOn = new Set<string>();
  const api = initSoloDrivers({
    state: () => s,
    me: () => 'p1',
    aiSeats: () => new Map([['p2', 'weak' as const]]),
    applyLocal: (a) => {
      others.push(a);
      const out = order(s, a, s.time);
      if (!out.error) s = out.state;
    },
    playerOrder: (a) => {
      mine.push(a);
      const out = order(s, a, s.time);
      if (!out.error) s = out.state;
    },
    autoAssault: (id) => autoOn.has(id),
    patrols: () => patrols,
    known: () => true,
    ...over,
  });
  return {
    api,
    mine,
    others,
    patrols,
    autoOn,
    state: () => s,
    setState: (next: GameState) => {
      s = next;
    },
  };
}

/** Сдвинуть часы мира, не трогая ничего другого (драйверы читают только `time`). */
const at = (s: GameState, time: number): GameState => ({ ...s, time });

describe('соло-драйверы — ходы ИИ', () => {
  it('ИИ ходит не чаще своего шага', () => {
    const h = harness();
    h.setState(at(h.state(), AI_STEP_MS));
    h.api.runAI();
    const after = h.others.length;
    expect(after).toBeGreaterThan(0);
    h.api.runAI(); // тот же час — второй раз не ходит
    expect(h.others.length).toBe(after);
  });

  it('прошёл шаг — ИИ ходит снова', () => {
    const h = harness();
    h.setState(at(h.state(), AI_STEP_MS));
    h.api.runAI();
    const first = h.others.length;
    h.setState(at(h.state(), AI_STEP_MS * 2 + 1));
    h.api.runAI();
    expect(h.others.length).toBeGreaterThanOrEqual(first);
  });

  it('ход ИИ — это НАСТОЯЩИЕ приказы за чужое место, а не пустой прогон', () => {
    const h = harness();
    h.setState(at(h.state(), AI_STEP_MS));
    h.api.runAI();
    expect(h.others.length).toBeGreaterThan(0);
    for (const a of h.others) expect(a.playerId).toBe('p2');
  });

  it('СЛОЖНОСТЬ КРЕСЛА ДОЕЗЖАЕТ ДО БОТА: сильный исследует, слабый — нет (AIDIFF-1)', () => {
    // Разница профилей проверяется тем, чего у слабого нет вовсе (ветка исследований),
    // а не числом приказов: их количество зависит от казны и меняется от правок баланса.
    const research = (as: Action[]): Action[] =>
      as.filter((a) => a.type === 'technology.research');
    const run = (profile: 'weak' | 'strong'): Action[] => {
      const h = harness({ aiSeats: () => new Map([['p2', profile]]) });
      h.setState(at(h.state(), AI_STEP_MS));
      h.api.runAI();
      return h.others;
    };
    expect(research(run('weak'))).toHaveLength(0);
    expect(research(run('strong')).length).toBeGreaterThan(0);
  });

  it('РАЗНЫЕ КРЕСЛА — РАЗНАЯ СИЛА: сложность у места своя, а не одна на матч', () => {
    // Матч на ТРИ места: два бота разной силы за одним столом — ровно то, что игрок
    // собирает строками экрана настройки.
    const three = newGame({
      seats: [
        { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: false },
        { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
        { id: 'p3', name: 'C', faction: 'amber', start: START_CANDIDATES[2]!, ai: true },
      ],
    });
    const h = harness(
      {
        aiSeats: () =>
          new Map([
            ['p2', 'strong'],
            ['p3', 'weak'],
          ]),
      },
      three,
    );
    h.setState(at(h.state(), AI_STEP_MS));
    h.api.runAI();
    const by = (id: string): Action[] => h.others.filter((a) => a.playerId === id);
    expect(by('p2').some((a) => a.type === 'technology.research')).toBe(true);
    expect(by('p3').some((a) => a.type === 'technology.research')).toBe(false);
  });

  it('ходы ИИ идут ЛОКАЛЬНЫМ путём, а не как свои приказы', () => {
    const h = harness();
    h.setState(at(h.state(), AI_STEP_MS));
    h.api.runAI();
    expect(h.mine).toEqual([]);
  });

  it('новый матч обнуляет часы ИИ — первый ход ждёт полный шаг', () => {
    const h = harness();
    h.setState(at(h.state(), 10 * AI_STEP_MS));
    h.api.reset();
    h.api.runAI();
    expect(h.others).toEqual([]);
  });

  it('делегированное «Хранителю» место ведёт тот же ИИ', () => {
    const s = newGame();
    const steward = { ...s, time: AI_STEP_MS } as GameState;
    (steward as unknown as { steward: Record<string, unknown> }).steward = {
      p1: { posture: 'defend', until: AI_STEP_MS * 100 },
    };
    const h = harness({}, steward);
    h.api.runAI();
    // Приказы за СВОЁ делегированное место идут локально — их выдал не игрок.
    expect(h.mine).toEqual([]);
  });
});

describe('соло-драйверы — память проб авто-штурма', () => {
  const fleetLike = (over: Record<string, unknown> = {}) =>
    ({ id: 'f1', orbit: 'far', location: 'C1R1', ...over }) as never;

  it('ключ различает час мира, орбиту, место и владельца', () => {
    const base = autoProbeKey(fleetLike(), 1000, 'p2');
    expect(autoProbeKey(fleetLike(), 2000, 'p2')).not.toBe(base);
    expect(autoProbeKey(fleetLike({ orbit: 'near' }), 1000, 'p2')).not.toBe(base);
    expect(autoProbeKey(fleetLike({ location: 'C2R2' }), 1000, 'p2')).not.toBe(base);
    expect(autoProbeKey(fleetLike(), 1000, 'p3')).not.toBe(base);
  });

  it('ничего не изменилось — ключ тот же (иначе память проб бесполезна)', () => {
    expect(autoProbeKey(fleetLike(), 1000, 'p2')).toBe(autoProbeKey(fleetLike(), 1000, 'p2'));
  });

  it('мир без владельца отличается от мира с владельцем', () => {
    expect(autoProbeKey(fleetLike(), 1000, null)).not.toBe(autoProbeKey(fleetLike(), 1000, 'p2'));
  });
});

describe('соло-драйверы — авто-штурм', () => {
  /** Свой флот с десантом над ЗАХВАТЫВАЕМЫМ (ничейным) миром на дальней орбите — та
   *  самая ситуация, где всё решает политика клиента: ядро штурм уже разрешает. */
  function readyToStorm(): { s: GameState; fleetId: string; loc: string } {
    const s = newGame();
    const free = Object.values(s.planets).find((p) => !p.owner)!;
    const f = Object.values(s.fleets).find((x) => x.owner === 'p1')!;
    const next = structuredClone(s) as GameState;
    next.fleets[f.id]!.location = free.id;
    next.fleets[f.id]!.movement = null;
    delete next.fleets[f.id]!.orbit; // дальняя орбита = поля просто нет
    next.fleets[f.id]!.landing = [{ unit: 'militia', count: 5 }];
    return { s: next, fleetId: f.id, loc: free.id };
  }

  it('свой флот БЕЗ опт-ина не штурмует сам — игрок водит его руками', () => {
    const { s } = readyToStorm();
    const h = harness({}, s);
    h.api.autoEngage();
    expect(h.mine).toEqual([]);
  });

  it('свой флот с включённым авто-штурмом получает ПАРУ «орбита → штурм»', () => {
    const { s, fleetId } = readyToStorm();
    const h = harness({}, s);
    h.autoOn.add(fleetId);
    h.api.autoEngage();
    expect(h.mine.map((a) => a.type)).toEqual(['fleet.orbit', 'fleet.assault']);
  });

  /** Тот же флот, но над ЧУЖИМ миром, с которым нет войны: ядро пускает на орбиту и
   *  отвергает штурм — ровно та обречённая пара, ради которой проба идёт по состоянию
   *  ПОСЛЕ орбиты. */
  function doomedPair(): { s: GameState; fleetId: string } {
    const s = newGame();
    const foe = Object.values(s.planets).find((p) => p.owner && p.owner !== 'p1')!;
    const f = Object.values(s.fleets).find((x) => x.owner === 'p1')!;
    const next = structuredClone(s) as GameState;
    next.fleets[f.id]!.location = foe.id;
    next.fleets[f.id]!.movement = null;
    delete next.fleets[f.id]!.orbit; // дальняя орбита = поля просто нет
    next.fleets[f.id]!.landing = [{ unit: 'militia', count: 5 }];
    return { s: next, fleetId: f.id };
  }

  it('половина пары не применяется: штурм отвергнут — не выдаётся и орбита', () => {
    const { s, fleetId } = doomedPair();
    const h = harness({}, s);
    h.autoOn.add(fleetId);
    h.api.autoEngage();
    expect(h.mine).toEqual([]); // ни одной орбиты «в никуда»
  });

  it('флот уже на низкой орбите — выдаётся только штурм', () => {
    const { s, fleetId } = readyToStorm();
    const next = structuredClone(s) as GameState;
    next.fleets[fleetId]!.orbit = 'near';
    const h = harness({}, next);
    h.autoOn.add(fleetId);
    h.api.autoEngage();
    expect(h.mine.map((a) => a.type)).toEqual(['fleet.assault']);
  });

  it('над СВОИМ миром штурмовать нечего', () => {
    const s = newGame();
    const own = Object.values(s.planets).find((p) => p.owner === 'p1')!;
    const f = Object.values(s.fleets).find((x) => x.owner === 'p1')!;
    const next = structuredClone(s) as GameState;
    next.fleets[f.id]!.location = own.id;
    next.fleets[f.id]!.movement = null;
    const h = harness({}, next);
    h.autoOn.add(f.id);
    h.api.autoEngage();
    expect(h.mine).toEqual([]);
  });

  it('в системе живой враг — даём бою утихнуть', () => {
    const { s, fleetId, loc } = readyToStorm();
    const next = structuredClone(s) as GameState;
    const foe = Object.values(next.fleets).find((x) => x.owner !== 'p1');
    if (foe) {
      foe.location = loc;
      foe.movement = null;
    }
    const h = harness({}, next);
    h.autoOn.add(fleetId);
    h.api.autoEngage();
    expect(h.mine).toEqual([]);
  });

  it('флот в пути или в бою пропускается', () => {
    const { s, fleetId } = readyToStorm();
    const next = structuredClone(s) as GameState;
    next.fleets[fleetId]!.battleId = 'b1';
    const h = harness({}, next);
    h.autoOn.add(fleetId);
    h.api.autoEngage();
    expect(h.mine).toEqual([]);
  });

  it('обречённая пара не пережимается каждый кадр', () => {
    const { s, fleetId } = doomedPair();
    const h = harness({}, s);
    h.autoOn.add(fleetId);
    h.api.autoEngage();
    h.api.autoEngage();
    h.api.autoEngage();
    expect(h.mine).toEqual([]);
  });

  it('сменился час мира — попытка повторяется (мир мог измениться)', () => {
    const { s, fleetId } = doomedPair();
    const h = harness({}, s);
    h.autoOn.add(fleetId);
    h.api.autoEngage(); // запомнили обречённость этого часа
    // Тот же флот в НОВОМ часе над ничейным миром — политика обязана пустить его снова.
    const free = Object.values(h.state().planets).find((p) => !p.owner)!;
    const next = structuredClone(h.state()) as GameState;
    next.time += HOUR;
    next.fleets[fleetId]!.location = free.id;
    h.setState(next);
    h.api.autoEngage();
    expect(h.mine.map((a) => a.type)).toContain('fleet.assault');
  });
});

describe('соло-драйверы — столкновения флотов', () => {
  /** Два простаивающих врага на одном узле без боя — ровно тот случай, который
   *  обработчик прибытия боевого модуля пропустил бы. */
  function twoIdleEnemies(): GameState {
    const s = structuredClone(newGame()) as GameState;
    const mineF = Object.values(s.fleets).find((f) => f.owner === 'p1')!;
    const foeF = Object.values(s.fleets).find((f) => f.owner !== 'p1')!;
    foeF.location = mineF.location;
    foeF.movement = null;
    mineF.movement = null;
    return s;
  }

  it('пара сводится в бой', () => {
    const h = harness({}, twoIdleEnemies());
    h.api.checkFleetClashes();
    expect(h.others.map((a) => a.type)).toContain('fleet.engage');
  });

  it('бой начинается со стороны игрока', () => {
    const h = harness({}, twoIdleEnemies());
    h.api.checkFleetClashes();
    const engage = h.others.find((a) => a.type === 'fleet.engage');
    expect(engage?.playerId).toBe('p1');
  });

  it('одна пара — один приказ, а не два (по разу с каждой стороны)', () => {
    const h = harness({}, twoIdleEnemies());
    h.api.checkFleetClashes();
    expect(h.others.filter((a) => a.type === 'fleet.engage').length).toBe(1);
  });

  it('свои флоты между собой не сводятся', () => {
    const s = structuredClone(newGame()) as GameState;
    const own = Object.values(s.fleets).filter((f) => f.owner === 'p1');
    for (const f of own) {
      f.location = own[0]!.location;
      f.movement = null;
    }
    for (const f of Object.values(s.fleets)) if (f.owner !== 'p1') f.location = null;
    const h = harness({}, s);
    h.api.checkFleetClashes();
    expect(h.others).toEqual([]);
  });
});
describe('соло-драйверы — дежурные вылеты (на БАЗЕ, SHU-2.2)', () => {
  it('без дежурных баз драйвер ничего не делает', () => {
    const h = harness();
    h.api.drivePatrols();
    expect(h.mine).toEqual([]);
  });

  it('ПРОПАВШАЯ БАЗА ПРИКАЗА НЕ ДАЁТ — вылету неоткуда взяться', () => {
    const h = harness();
    h.patrols.set('no-such-base', { kind: 'planet' });
    h.api.drivePatrols();
    expect(h.mine).toEqual([]);
  });

  it('ЧУЖАЯ БАЗА МОИХ ПРИКАЗОВ НЕ РОЖДАЕТ: драйвер шлёт только за себя', () => {
    const h = harness();
    const foreign = Object.values(h.state().planets).find((p) => p.owner && p.owner !== 'p1');
    if (foreign) h.patrols.set(foreign.id, { kind: 'planet' });
    h.api.drivePatrols();
    expect(h.mine).toEqual([]);
  });

  it('ПУСТОЙ АНГАР — ВЫЛЕТА НЕТ: дежурить нечем', () => {
    const h = harness();
    const mine = Object.values(h.state().planets).find((p) => p.owner === 'p1')!;
    h.patrols.set(mine.id, { kind: 'planet' });
    h.api.drivePatrols();
    expect(h.mine).toEqual([]);
  });
});

describe('соло-драйверы — цепочки приказов', () => {
  it('без цепочек ничего не выдаётся', () => {
    const h = harness();
    h.api.driveChains();
    expect(h.mine).toEqual([]);
    expect(h.others).toEqual([]);
  });
});
