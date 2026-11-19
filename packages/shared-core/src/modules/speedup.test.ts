import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { constructionModule } from './construction';
import { technologyModule } from './technology';
import { speedupModule } from './speedup';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context } from '../action/types';
import { speedupLeftHours, speedupPrice } from '../util/speedup';

/**
 * Ускорение очередей (TEC-3): бюджет K, цена с ростом в игровых сутках, бесплатные
 * последние минуты, партия без золота. Мина строится 30 игровых часов, исследование — 30.
 */
const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {},
  factions: {},
  buildings: { mine: { name: 'Mine', cost: { metal: 10 }, buildTimeHours: 30, produces: { metal: 1 } } },
  technologies: { optics: { name: 'Optics', cost: { metal: 10 }, researchTimeHours: 30 } },
  events: {},
  timeValue: {
    referenceHour: { metal: 10 },
    weights: { metal: 1 },
    sovereignsPerHour: 10,
    warrantsPerHour: 4,
    speedupCap: 1.5,
    escalation: 0.1,
    freeFinishMinutes: 5,
  },
});
const HOUR = 3_600_000;
const kernel = createKernel([constructionModule, technologyModule, speedupModule]);
const ctx = (now: number, timeScale?: number): Context =>
  timeScale === undefined ? { now, data } : { now, data, config: { timeScale } };

function world(): GameState {
  const s = createInitialState({ seed: 'su', version: { data: '0.1.0', manifest: '1' } });
  const p1: Player = { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: { metal: 100 } };
  const a: Planet = { id: 'A', owner: 'p1', position: { x: 0, y: 0 }, resources: {}, buildings: [], garrison: [], traits: [] };
  return { ...s, players: { p1 }, planets: { A: a } };
}
const act = (type: string, payload: unknown, playerId = 'p1'): Action =>
  ({ id: `a:${type}`, type, playerId, payload, issuedAt: 0 }) as Action;
const ok = (r: ApplyResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r.state;
};
const code = (r: ApplyResult) => (r.ok ? 'ok' : r.code);

/** Мир на `now` с идущей стройкой мины, заказанной в момент `orderedAt`. */
function building(orderedAt: number, now: number, timeScale?: number) {
  const s = world();
  s.time = orderedAt;
  const ordered = ok(kernel.applyAction(s, act('building.construct', { planetId: 'A', building: 'mine' }), ctx(orderedAt, timeScale)));
  const event = ordered.scheduled.find((e) => e.type === 'construction.complete')!;
  const adv = kernel.advanceTo(ordered, ctx(now, timeScale));
  if (!adv.ok) throw new Error(adv.code);
  return { state: adv.state, seq: event.seq, at: event.at };
}
const speed = (seq: number, hours: number, price: number) =>
  act('queue.speedup', { kind: 'construction', seq, hours, price });

describe('ускорение стройки за ◆ (TEC-3)', () => {
  it('сдвигает заказ раньше на купленные часы и пишет учёт', () => {
    // Сутки партии прошли: бюджет 12 ч. Стройка заказана в начале и идёт ещё 6 ч.
    const { state, seq, at } = building(0, 24 * HOUR);
    const price = speedupPrice(state, 'p1', 2, data.timeValue, ctx(24 * HOUR));
    // Два часа с ростом 10%: 10 × (2 + 0,1 × 2²/2) = 22 ◆.
    expect(price).toBe(22);
    const sped = ok(kernel.applyAction(state, speed(seq, 2, price), ctx(24 * HOUR)));
    const moved = sped.scheduled.find((e) => e.seq === seq)!;
    expect(moved.at).toBe(at - 2 * HOUR);
    expect(sped.players.p1!.speedup).toEqual({ usedHours: 2, day: 1, dayHours: 2 });
  });

  it('нарезка выгоды не даёт: два раза по часу не дешевле, чем два часа разом', () => {
    const { state, seq } = building(0, 24 * HOUR);
    const first = speedupPrice(state, 'p1', 1, data.timeValue, ctx(24 * HOUR));
    const after = ok(kernel.applyAction(state, speed(seq, 1, first), ctx(24 * HOUR)));
    const second = speedupPrice(after, 'p1', 1, data.timeValue, ctx(24 * HOUR));
    expect(first).toBe(11); // 10 × (1 + 0,05) = 10,5 → вверх до 11
    expect(second).toBe(12); // 10 × (1 + 0,1 × (1 + 0,5)) = 11,5 → 12
    // Без округления 10,5 + 11,5 = 22 — ровно цена двух часов разом; округление вверх
    // у каждой покупки делает нарезку только дороже.
    expect(first + second).toBeGreaterThanOrEqual(speedupPrice(state, 'p1', 2, data.timeValue, ctx(24 * HOUR)));
  });

  it('новые игровые сутки — рост цены начинается заново', () => {
    const { state, seq } = building(0, 24 * HOUR);
    const after = ok(kernel.applyAction(state, speed(seq, 1, 11), ctx(24 * HOUR)));
    // Следующие сутки: снова первый час по курсу.
    const tomorrow = { ...after, time: 48 * HOUR - 1 };
    expect(speedupPrice(tomorrow, 'p1', 1, data.timeValue, ctx(48 * HOUR))).toBe(11);
  });

  it('бюджет K: не больше (K − 1) часа на каждый прошедший час партии', () => {
    const { state, seq } = building(0, 6 * HOUR); // прошло 6 ч → бюджет 3 ч
    expect(speedupLeftHours(state, 'p1', data.timeValue, ctx(6 * HOUR))).toBe(3);
    const price4 = speedupPrice(state, 'p1', 4, data.timeValue, ctx(6 * HOUR));
    expect(code(kernel.applyAction(state, speed(seq, 4, price4), ctx(6 * HOUR)))).toBe('E_SPEEDUP_BUDGET');
    const price3 = speedupPrice(state, 'p1', 3, data.timeValue, ctx(6 * HOUR));
    const used = ok(kernel.applyAction(state, speed(seq, 3, price3), ctx(6 * HOUR)));
    expect(speedupLeftHours(used, 'p1', data.timeValue, ctx(6 * HOUR))).toBe(0);
  });

  it('цена разошлась с ядром — отказ, а не списание другой суммы', () => {
    const { state, seq } = building(0, 24 * HOUR);
    expect(code(kernel.applyAction(state, speed(seq, 2, 20), ctx(24 * HOUR)))).toBe('E_PRICE_CHANGED');
  });

  it('нельзя ускорить больше остатка очереди', () => {
    const { state, seq } = building(0, 24 * HOUR); // осталось 6 ч
    const price = speedupPrice(state, 'p1', 7, data.timeValue, ctx(24 * HOUR));
    expect(code(kernel.applyAction(state, speed(seq, 7, price), ctx(24 * HOUR)))).toBe('E_SPEEDUP_TOO_LONG');
  });

  it('в партии без золота платного ускорения нет', () => {
    const { state, seq } = building(0, 24 * HOUR);
    state.match.goldActions = false;
    expect(code(kernel.applyAction(state, speed(seq, 1, 11), ctx(24 * HOUR)))).toBe('E_GOLD_OFF');
  });

  it('чужой заказ ускорить нельзя', () => {
    const { state, seq } = building(0, 24 * HOUR);
    state.players.p2 = { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: {} };
    expect(code(kernel.applyAction(state, { ...speed(seq, 1, 11), playerId: 'p2' }, ctx(24 * HOUR)))).toBe('E_NOT_ACTIVE');
  });

  it('на скорости партии ×4 тот же игровой час стоит столько же ◆, а реальный — вчетверо дороже', () => {
    const { state } = building(0, 6 * HOUR, 4); // 6 реальных ч = 24 игровых
    expect(speedupLeftHours(state, 'p1', data.timeValue, ctx(6 * HOUR, 4))).toBe(12);
    expect(speedupPrice(state, 'p1', 1, data.timeValue, ctx(6 * HOUR, 4))).toBe(11);
  });

  it('ускоренная стройка завершается в новый срок', () => {
    const { state, seq } = building(0, 24 * HOUR);
    const sped = ok(kernel.applyAction(state, speed(seq, 6, speedupPrice(state, 'p1', 6, data.timeValue, ctx(24 * HOUR))), ctx(24 * HOUR)));
    const done = kernel.advanceTo(sped, ctx(24 * HOUR + 1));
    if (!done.ok) throw new Error(done.code);
    expect(done.state.planets.A!.buildings.map((b) => b.type)).toEqual(['mine']);
  });
});

describe('бесплатные последние минуты (TEC-3)', () => {
  it('остаток не больше 5 игровых минут заканчивается без ◆ и без бюджета', () => {
    const { state, seq } = building(0, 30 * HOUR - 5 * 60_000);
    const done = ok(kernel.applyAction(state, act('queue.finish', { kind: 'construction', seq }), ctx(30 * HOUR - 5 * 60_000)));
    expect(done.scheduled.find((e) => e.seq === seq)!.at).toBe(30 * HOUR - 5 * 60_000);
    expect(done.players.p1!.speedup).toBeUndefined();
  });

  it('остаток больше 5 минут — бесплатно нельзя', () => {
    const { state, seq } = building(0, 29 * HOUR);
    expect(code(kernel.applyAction(state, act('queue.finish', { kind: 'construction', seq }), ctx(29 * HOUR)))).toBe('E_NOT_FREE');
  });

  it('бесплатное окончание работает и в партии без золота', () => {
    const { state, seq } = building(0, 30 * HOUR - 60_000);
    state.match.goldActions = false;
    expect(code(kernel.applyAction(state, act('queue.finish', { kind: 'construction', seq }), ctx(30 * HOUR - 60_000)))).toBe('ok');
  });
});

describe('ускорение исследования (TEC-3)', () => {
  it('срок исследования сдвигается, и оно завершается в новый срок', () => {
    const s = world();
    const started = ok(kernel.applyAction(s, act('technology.research', { technology: 'optics' }), ctx(0)));
    const adv = kernel.advanceTo(started, ctx(24 * HOUR));
    if (!adv.ok) throw new Error(adv.code);
    const price = speedupPrice(adv.state, 'p1', 6, data.timeValue, ctx(24 * HOUR));
    const sped = ok(kernel.applyAction(adv.state, act('queue.speedup', { kind: 'research', technology: 'optics', hours: 6, price }), ctx(24 * HOUR)));
    const done = kernel.advanceTo(sped, ctx(24 * HOUR + 1));
    if (!done.ok) throw new Error(done.code);
    expect(done.state.players.p1!.technologies?.completed).toContain('optics');
  });
});

describe('матрицы нет — ускорения нет', () => {
  it('пустой timeValue: платное ускорение отказывает', () => {
    const bare = parseGameData({ ...data, timeValue: {} });
    const k = createKernel([constructionModule, technologyModule, speedupModule]);
    const { state, seq } = building(0, 24 * HOUR);
    expect(code(k.applyAction(state, speed(seq, 1, 11), { now: 24 * HOUR, data: bare }))).toBe('E_NOT_AVAILABLE');
  });
});

describe('ресурсы за ◆ (TEC-4)', () => {
  // Матрица теста: 10 металла в час, вес 1 → 1 ЭЧ = 10 металла.
  const buy = (hours: number, price: number, resource = 'metal') =>
    act('resources.buy', { resource, hours, price });

  it('даёт ресурс на купленные часы и тратит тот же бюджет K по той же цене', () => {
    const { state } = building(0, 24 * HOUR);
    const price = speedupPrice(state, 'p1', 2, data.timeValue, ctx(24 * HOUR));
    expect(price).toBe(22);
    const after = ok(kernel.applyAction(state, buy(2, price), ctx(24 * HOUR)));
    expect(after.players.p1!.resources.metal).toBe((state.players.p1!.resources.metal ?? 0) + 20);
    expect(after.players.p1!.speedup).toEqual({ usedHours: 2, day: 1, dayHours: 2 });
    // Час ускорения после этого стоит уже как третий час суток.
    expect(speedupPrice(after, 'p1', 1, data.timeValue, ctx(24 * HOUR))).toBe(13);
  });

  it('бюджет, цена, золото и матрица — те же отказы, что у ускорения', () => {
    const { state } = building(0, 6 * HOUR); // бюджет 3 ч
    expect(code(kernel.applyAction(state, buy(4, speedupPrice(state, 'p1', 4, data.timeValue, ctx(6 * HOUR))), ctx(6 * HOUR)))).toBe('E_SPEEDUP_BUDGET');
    expect(code(kernel.applyAction(state, buy(1, 99), ctx(6 * HOUR)))).toBe('E_PRICE_CHANGED');
    const noGold = structuredClone(state);
    noGold.match.goldActions = false;
    expect(code(kernel.applyAction(noGold, buy(1, 11), ctx(6 * HOUR)))).toBe('E_GOLD_OFF');
    const bare = parseGameData({ ...data, timeValue: {} });
    expect(code(kernel.applyAction(state, buy(1, 11), { now: 6 * HOUR, data: bare }))).toBe('E_NOT_AVAILABLE');
  });

  it('ресурс вне матрицы и кривая нагрузка — отказ', () => {
    const { state } = building(0, 24 * HOUR);
    expect(code(kernel.applyAction(state, buy(1, 11, 'credits'), ctx(24 * HOUR)))).toBe('E_BAD_PAYLOAD');
    expect(code(kernel.applyAction(state, act('resources.buy', { resource: 'metal', hours: -1, price: 0 }), ctx(24 * HOUR)))).toBe('E_BAD_PAYLOAD');
    // Меньше единицы ресурса за проданные часы — не продаётся.
    expect(code(kernel.applyAction(state, buy(0.01, speedupPrice(state, 'p1', 0.01, data.timeValue, ctx(24 * HOUR))), ctx(24 * HOUR)))).toBe('E_BAD_PAYLOAD');
  });
});
