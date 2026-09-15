/**
 * ВСТУПЛЕНИЕ В ИДУЩИЙ БОЙ (MSB-3) — приёмка кирпича.
 *
 * MSB-2 научил раунд считать N сторон, но взяться этим сторонам было НЕОТКУДА: бой заводит
 * только встреча двух СВОБОДНЫХ флотов. `findEnemyFleetAt` пропускает всех, у кого стоит
 * `battleId`, а `engageFleets` выходит, не найдя свободного врага. Третий прилетал на узел,
 * где идёт бой, и оставался зрителем — при том, что он враг обоим.
 *
 * Решение владельца 2026-09-11: **втягивать АВТОМАТИЧЕСКИ.** Иначе выжидание остаётся
 * доминирующей стратегией («дождись, пока двое обескровят друг друга, и добей свежим
 * флотом»), а ровно против неё затевался многосторонний бой.
 *
 * РОЛЬ вступающего правилом не назначается заново — она уже есть в движке и одна на все
 * четыре конструктора боя: **кто вступает, тот атакующий; кого нашли — обороняющийся.**
 * Так устроены прибытие, перехват, штурм и высадка. Отсюда и ответ на третью роль из
 * критерия приёмки: летящий выручать союзника — атакующий, потому что он атакует
 * агрессора, и бьёт своим `attack`, а не `defense`.
 */
import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { combatModule } from './combat';
import { diplomacyModule } from './diplomacy';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { setStance } from '../state/diplomacy';
import type { Action, ApplyResult, Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    // Один корпус на всех: разница в исходе тогда объясняется ПРАВИЛОМ, а не составом.
    // Запас хода большой — кирпич про сцепление, добивать никого не нужно.
    fighter: { faction: 'x', stats: { attack: 10, defense: 4, speed: 10, hp: 5000 } },
  },
  factions: {},
  buildings: {},
  events: {},
});

/**
 * Прибытие без модуля движения — приём из `combat.test.ts`, плюс сам перелёт: флот
 * переставляется на узел и только потом объявляет прибытие. Без перелёта «прибывший»
 * стоял бы на узле с самого начала, а это ДРУГОЙ сценарий (S3, «ждал рядом»), и проверять
 * им втягивание прилетевшего значило бы проверять не то.
 */
const arrivalModule: GameModule = {
  id: 'test-arrival',
  version: '1.0.0',
  setup(api) {
    api.onAction('arrive', (a, h) => {
      const { fleetId, at } = a.payload as { fleetId: string; at?: string };
      const f = h.state.fleets[fleetId];
      const node = at ?? f?.location;
      if (f && node) {
        f.location = node;
        f.movement = null;
      }
      h.emit('fleet.arrived', { fleetId, at: node });
    });
  },
};

const kernel = createKernel([combatModule, diplomacyModule, arrivalModule]);
const ctx = (now: number): Context => ({ now, data });
const arrive = (fleetId: string, playerId: string, at = 'P'): Action => ({
  id: `s:${playerId}:1`,
  type: 'arrive',
  playerId,
  payload: { fleetId, at },
  issuedAt: 0,
});

function fleetOf(id: string, owner: string, at: string): Fleet {
  return { id, owner, location: at, movement: null, units: [{ unit: 'fighter', count: 1 }], traits: [] };
}
function planetOf(id: string): Planet {
  return { id, owner: null, position: { x: 0, y: 0 }, resources: {}, buildings: [], garrison: [], traits: [] };
}
function okApply(r: ApplyResult): GameState {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r.state;
}

/**
 * Мир с двумя узлами: `P` — где идёт бой, `Q` — откуда прилетают. Флот владельца из
 * `away` стоит на `Q`, остальные на `P`. Стойки по умолчанию — война (`DEFAULT_STANCE`),
 * `peace` расставляется точечно, чтобы союз был ЯВНЫМ и тест не зависел от умолчания.
 */
function world(
  owners: string[],
  peace: Array<[string, string]> = [],
  away: string[] = [],
): GameState {
  const s = createInitialState({ seed: 'msb3', version: { data: '0.1.0', manifest: '1' } });
  const fleets: Record<string, Fleet> = {};
  const players: Record<string, Player> = {};
  for (const o of owners) {
    players[o] = { id: o, name: o, faction: 'x', status: 'active', resources: {} };
    fleets[o.toUpperCase()] = fleetOf(o.toUpperCase(), o, away.includes(o) ? 'Q' : 'P');
  }
  const out: GameState = {
    ...s,
    players,
    fleets,
    planets: { P: planetOf('P'), Q: planetOf('Q') },
  };
  for (const [a, b] of peace) setStance(out, a, b, 'peace');
  return out;
}

/** Единственный бой на узле — его и проверяем. */
function only(s: GameState) {
  const ids = Object.keys(s.battles);
  expect(ids).toHaveLength(1);
  return s.battles[ids[0]!]!;
}
const roleOf = (s: GameState, owner: string): string | undefined =>
  only(s).sides.find((x) => x.owner === owner)?.role;

describe('MSB-3 — прибытие втягивает в идущий бой', () => {
  /**
   * Бой p1 (прилетел с `Q`, атакующий) против p2 (стоял на `P`, обороняющийся).
   * `extra` тоже ждут на `Q` — иначе их втянуло бы сразу как «ждавших рядом» (S3),
   * и прилёт проверить было бы нечем.
   */
  function running(extra: string[] = [], peace: Array<[string, string]> = []): GameState {
    const st = world(['p1', 'p2', ...extra], peace, ['p1', ...extra]);
    return okApply(kernel.applyAction(st, arrive('P1', 'p1'), ctx(0)));
  }

  it('НОВЫЙ ВРАГ ОБЕИХ СТОРОН вступает в тот же бой, а не стоит зрителем', () => {
    const before = running(['p3']);
    expect(only(before).sides).toHaveLength(2); // исходный бой — дуэль

    const after = okApply(kernel.applyAction(before, arrive('P3', 'p3'), ctx(0)));

    expect(Object.keys(after.battles)).toHaveLength(1); // ТОТ ЖЕ бой, не второй рядом
    expect(only(after).sides).toHaveLength(3);
    expect(after.fleets.P3?.battleId).toBe(only(after).id);
  });

  it('СОЮЗНИК АТАКУЮЩЕГО вступает и получает роль атакующего', () => {
    const before = running(['p3'], [['p1', 'p3']]); // p3 в мире с p1, во вражде с p2
    const after = okApply(kernel.applyAction(before, arrive('P3', 'p3'), ctx(0)));

    expect(only(after).sides).toHaveLength(3);
    expect(roleOf(after, 'p3')).toBe('attacker');
  });

  it('СОЮЗНИК ОБОРОНЯЮЩЕГОСЯ вступает АТАКУЮЩИМ — он атакует агрессора', () => {
    const before = running(['p3'], [['p2', 'p3']]); // p3 в мире с p2, во вражде с p1
    const after = okApply(kernel.applyAction(before, arrive('P3', 'p3'), ctx(0)));

    expect(only(after).sides).toHaveLength(3);
    expect(roleOf(after, 'p3')).toBe('attacker');
    // Обороняющийся в бою по-прежнему ОДИН: вступают только атакующими, поэтому
    // допущение `dmgToDefender` из MSB-2 кирпич не ломает.
    expect(only(after).sides.filter((x) => x.role === 'defender')).toHaveLength(1);
  });

  it('НЕ ВРАГ никому в бою НЕ втягивается (fail-secure: втягивает вражда, а не соседство)', () => {
    const before = running(['p3'], [['p1', 'p3'], ['p2', 'p3']]);
    const after = okApply(kernel.applyAction(before, arrive('P3', 'p3'), ctx(0)));

    expect(only(after).sides).toHaveLength(2);
    expect(after.fleets.P3?.battleId).toBeFalsy();
  });

  it('S3: ЖДАВШИЙ РЯДОМ втягивается завязкой боя — выжидание перестаёт быть стратегией', () => {
    // p3 никуда не летит: он уже стоит на узле и по старому правилу дождался бы, пока
    // двое обескровят друг друга, и добил свежим флотом. Ровно против этого кирпич.
    const st = world(['p1', 'p2', 'p3'], [], ['p1']);
    const after = okApply(kernel.applyAction(st, arrive('P1', 'p1'), ctx(0)));

    expect(Object.keys(after.battles)).toHaveLength(1);
    expect(only(after).sides).toHaveLength(3);
    expect(after.fleets.P3?.battleId).toBe(only(after).id);
  });

  it('ЗАКРЫТИЕ БОЯ отпускает ВСЕ стороны — третий не остаётся заперт на удалённом бое', () => {
    // Сторож найденной дыры. `finishBattle` отпускал ровно пару (`attackerOf`/
    // `defenderOf`), и пока сторон было две, этого хватало. С втягиванием третьего тот же
    // код оставлял ему `battleId`, указывающий на УДАЛЁННЫЙ бой: такой флот заперт
    // навсегда — не ходит, не стреляет, и освободить его больше некому. Ни один тест не
    // падал: состояние оставалось «валидным», просто флот исчезал из игры.
    const st = world(['p1', 'p2', 'p3'], [], ['p1']);
    const engaged = okApply(kernel.applyAction(st, arrive('P1', 'p1'), ctx(0)));
    expect(only(engaged).sides).toHaveLength(3);

    const done = kernel.advanceTo(engaged, ctx(400 * 3_600_000));
    if (!done.ok) throw new Error('advance failed');

    for (const f of Object.values(done.state.fleets)) {
      // Либо флот свободен, либо его бой действительно существует. Третьего не дано.
      if (f.battleId) expect(done.state.battles[f.battleId]).toBeDefined();
    }
  });

  it('N-УНИВЕРСАЛЬНОСТЬ: пятеро подряд дают ОДИН бой на шесть сторон, а не пять боёв', () => {
    const extra = ['p3', 'p4', 'p5', 'p6', 'p7'];
    let s = running(extra);
    for (const o of extra) s = okApply(kernel.applyAction(s, arrive(o.toUpperCase(), o), ctx(0)));

    expect(Object.keys(s.battles)).toHaveLength(1);
    expect(only(s).sides).toHaveLength(7);
    for (const o of extra) expect(s.fleets[o.toUpperCase()]?.battleId).toBe(only(s).id);
  });
});
