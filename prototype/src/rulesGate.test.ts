// RULES-1 — сторож «единого начала»: правила игры живут в ядре, а поверхности их
// СПРАШИВАЮТ, а не переводят заново.
//
// Зачем именно эти три утверждения. Класс багов, который закрывает кирпич, выглядел
// так: интерфейс держал свою копию правила («одно здание на мир») с оговоркой, а
// покадровый цикл — свою копию условий штурма; копии разъезжались с редьюсером, и
// игрок получал то дубль заказа, то «действие запрещено» без остановки. Поэтому тест
// проверяет не отдельные правила, а САМ КОНТРАКТ: вердикт совпадает с редьюсером,
// вопрос ничего не меняет, автоматика не издаёт обречённого приказа.
import { describe, it, expect } from 'vitest';
import { hashState } from '../../packages/shared-core/src/index';
import { newGame, order, canOrder } from './game';
import { buildBuilding, assaultFleet, moveFleet, orbitFleet } from './actions';
import { serverAutoAssaultActions } from './serverDrivers';

const ME = 'p1';
/** Свежая партия + мой мир и мой флот в ней. */
function field() {
  const s = newGame();
  const home = Object.values(s.planets).find((p) => p.owner === ME)!;
  const fleet = Object.values(s.fleets).find((f) => f.owner === ME) ?? null;
  // Здание, которого на стартовом мире ЕЩЁ НЕТ: часть каталога уже построена
  // (mine/radar/orbital_aa/spaceport), и заказ такого сразу отбился бы E_ALREADY_BUILT.
  const fresh = ['farm', 'fort', 'tax_office', 'refinery', 'barracks'].find(
    (b) => !home.buildings.some((x) => x.type === b),
  )!;
  return { s, home, fleet, fresh };
}

describe('RULES-1 — вердикт «можно ли» = вердикту редьюсера', () => {
  it('на легальном приказе — null, и приказ действительно проходит', () => {
    const { s, home, fresh } = field();
    const a = buildBuilding(ME, home.id, fresh);
    expect(canOrder(s, a)).toBeNull();
    expect(order(s, a, s.time).error).toBeUndefined();
  });

  it('на КАЖДОМ отказе называется тот же код, что вернул бы order()', () => {
    const { s, home, fleet } = field();
    const cases = [
      buildBuilding(ME, home.id, 'нет-такого-здания'), // неизвестное здание
      buildBuilding('p2', home.id, 'mine'), // чужой игрок на моём мире
      buildBuilding(ME, 'нет-такого-мира', 'mine'), // неизвестный мир
      ...(fleet ? [assaultFleet(ME, fleet.id), moveFleet(ME, fleet.id, home.id)] : []),
      ...(fleet ? [orbitFleet(ME, fleet.id, 'near')] : []),
    ];
    for (const a of cases) {
      const applied = order(s, a, s.time);
      expect(canOrder(s, a), a.type).toBe(applied.error ?? null);
    }
  });

  it('дубль уникального здания отбивается ЯДРОМ, а не копией правила в клиенте', () => {
    const { s, home, fresh } = field();
    const first = order(s, buildBuilding(ME, home.id, fresh), s.time);
    expect(first.error).toBeUndefined();
    // после заказа ядро само знает, что второй экземпляр невозможен
    expect(canOrder(first.state, buildBuilding(ME, home.id, fresh))).toBe('E_ALREADY_QUEUED');
  });
});

describe('RULES-1 — вопрос ничего не меняет', () => {
  it('сотня вопросов не сдвигает мир (хеш состояния тот же)', () => {
    const { s, home, fleet, fresh } = field();
    const before = hashState(s);
    for (let i = 0; i < 100; i++) {
      canOrder(s, buildBuilding(ME, home.id, fresh));
      if (fleet) canOrder(s, assaultFleet(ME, fleet.id));
    }
    expect(hashState(s)).toBe(before);
  });

  it('после вопроса тот же приказ всё ещё применяется (ход не потрачен)', () => {
    const { s, home, fresh } = field();
    const a = buildBuilding(ME, home.id, fresh);
    expect(canOrder(s, a)).toBeNull();
    expect(canOrder(s, a)).toBeNull();
    expect(order(s, a, s.time).error).toBeUndefined();
  });
});

/** Мой флот стоит над ЧУЖИМ захватываемым миром без вражеского флота рядом (иначе
 *  драйвер справедливо ждёт, пока утихнет орбитальный бой) с заданной дипломатией. */
function enemyWorldField(s: ReturnType<typeof newGame>, fleet: { id: string }, stance: 'peace' | 'war') {
  const busy = new Set(Object.values(s.fleets).map((f) => f.location));
  const foreign = Object.values(s.planets).find((p) => p.owner && p.owner !== ME);
  if (!foreign) return null;
  const free = Object.values(s.planets).find((p) => p.owner === null && !busy.has(p.id));
  if (!free) return null;
  const f = s.fleets[fleet.id]!;
  return {
    ...s,
    // нейтральный мир отдаём чужому игроку — так рядом гарантированно нет его флота
    planets: { ...s.planets, [free.id]: { ...free, owner: foreign.owner } },
    fleets: { ...s.fleets, [f.id]: { ...f, location: free.id, orbit: 'near', movement: null } },
    diplomacy: { ...(s.diplomacy ?? {}), [`p1|${foreign.owner}`]: stance },
    autoAssault: { [f.id]: true },
  } as ReturnType<typeof newGame> & { autoAssault: Record<string, true> };
}

describe('RULES-1 — автоматика не издаёт обречённых приказов', () => {
  it('авто-штурм молчит, пока с владельцем мира МИР (а не сыплет отказами)', () => {
    const { s, fleet } = field();
    if (!fleet?.location) return; // партия без стартового флота — проверять нечего
    const st = enemyWorldField(s, fleet, 'peace');
    if (!st) return;
    expect(serverAutoAssaultActions(st)).toEqual([]);
  });

  it('при ВОЙНЕ тот же драйвер приказ выдаёт — молчание не «выключено навсегда»', () => {
    const { s, fleet } = field();
    if (!fleet?.location) return;
    const st = enemyWorldField(s, fleet, 'war');
    if (!st) return;
    expect(serverAutoAssaultActions(st).length).toBeGreaterThan(0);
  });
});
