/**
 * БОЙ ПРИ СМЕНЕ ВЛАДЕЛЬЦА СТОРОНЫ (MSB-5) — приёмка кирпича.
 *
 * Сценарии S18–S20: игрок выбыл, место передано «Хранителю», место освобождено — и всё
 * это ПОСРЕДИ боя, который хранит `owner` в стороне и о смене руки не знает.
 *
 * Разбор показал, что три случая — не три правила, а два РАЗНЫХ вопроса:
 *
 * 1. **Хранитель и освобождение места руку не меняют.** Оба трогают, КТО играет за место
 *    (`steward`, `claimedAt`, `seated`), а не ЧЬЁ оно: `players[id]` тот же, `owner`
 *    стороны остаётся валидным. Правило здесь — «ничего не происходит», и оно закрепляется
 *    тестом: иначе следующий читатель заведёт лишнюю ветку на всякий случай.
 * 2. **Выбывание — настоящая дыра.** Оно удаляет флоты выбывшего, но плацдарм держит МИР,
 *    а не флот, — и он оставался на земле живой стороной, за которой никого нет. После
 *    MSB-4 такой призрак ещё и мог ЗАХВАТИТЬ мир: захват отдаёт его владельцу самого
 *    раннего выжившего берега, а «выживший» проверяется по войскам, а не по игроку.
 */
import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { combatModule } from './combat';
import { diplomacyModule } from './diplomacy';
import { victoryModule } from './victory';
import { stewardModule } from './steward';
import {
  createInitialState,
  type Battle,
  type GameState,
  type Planet,
  type Player,
  type UnitStack,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { setStance } from '../state/diplomacy';
import type { Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    marine: { faction: 'x', domain: 'ground', stats: { attack: 10, defense: 4, speed: 1, hp: 20 } },
    // Гарнизон-стена: не бьёт вовсе и очень живуч. Нужен, чтобы бой ПЕРЕЖИЛ выбывание —
    // иначе он кончается раньше, берега стираются концом боя, и тест зеленел бы по
    // неверной причине (проверено: с обычным гарнизоном ровно так и было).
    wall: { faction: 'x', domain: 'ground', stats: { attack: 0, defense: 0, speed: 1, hp: 5000 } },
  },
  factions: {},
  buildings: {},
  events: {},
});

const kernel = createKernel([combatModule, diplomacyModule, stewardModule, victoryModule]);
const ctx = (now: number): Context => ({ now, data });
const HOUR = 3_600_000;
const stacks = (l: Array<[string, number]>): UnitStack[] => l.map(([unit, count]) => ({ unit, count }));

/** Мир `p0` под штурмом: берег `ghost` (у него БОЛЬШЕ нет своих миров) и берег `p2`. */
function siege(): GameState {
  const s = createInitialState({ seed: 'msb5', version: { data: '0.1.0', manifest: '1' } });
  const players: Record<string, Player> = {};
  for (const id of ['p0', 'ghost', 'p2']) {
    players[id] = { id, name: id, faction: 'x', status: 'active', resources: {} };
  }
  const planet: Planet = {
    id: 'P',
    owner: 'p0',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: stacks([['wall', 1]]),
    traits: [],
    beachheads: [
      { owner: 'ghost', units: stacks([['marine', 3]]) },
      { owner: 'p2', units: stacks([['marine', 3]]) },
    ],
  };
  const sides: Battle['sides'] = [
    { ref: { kind: 'beachhead', planetId: 'P', owner: 'ghost' }, owner: 'ghost', role: 'attacker' },
    { ref: { kind: 'beachhead', planetId: 'P', owner: 'p2' }, owner: 'p2', role: 'attacker' },
    { ref: { kind: 'garrison', planetId: 'P' }, owner: 'p0', role: 'defender' },
  ];
  // У p2 есть свой мир, у `ghost` — нет. Без этого модуль победы признаёт выбывшими
  // ОБОИХ штурмующих, матч заканчивается на первом же пересчёте, и тест смотрит на
  // остановленную партию вместо идущего боя.
  const home: Planet = {
    id: 'Q',
    owner: 'p2',
    position: { x: 100, y: 0 },
    resources: {},
    buildings: [],
    garrison: stacks([['marine', 1]]),
    traits: [],
  };
  const out: GameState = {
    ...s,
    players,
    planets: { P: planet, Q: home },
    battles: { b1: { id: 'b1', location: 'P', phase: 'ground', sides, round: 0 } },
    scheduled: [{ id: 'evt:0', at: 0, type: 'combat.tick', payload: { battleId: 'b1' }, seq: 0 }],
    scheduleSeq: 1,
  };
  setStance(out, 'ghost', 'p0', 'war');
  setStance(out, 'p2', 'p0', 'war');
  setStance(out, 'ghost', 'p2', 'peace');
  return out;
}

function run(s: GameState, hours: number): GameState {
  const r = kernel.advanceTo(s, ctx(hours * HOUR));
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r.state;
}

describe('MSB-5 — смена владельца стороны посреди боя', () => {
  it('S18: ВЫБЫВШИЙ не оставляет призрачный берег, который некому вести', () => {
    // `ghost` не держит ни одного мира, поэтому модуль победы признаёт его выбывшим на
    // первом же пересчёте. Его флоты удаляются — а берег держит МИР, и раньше он
    // оставался драться сам по себе.
    const after = run(siege(), 3);
    expect(after.players.ghost?.status).toBe('defeated');
    const left = (after.planets.P?.beachheads ?? []).map((b) => b.owner);
    expect(left).not.toContain('ghost');
    const battle = Object.values(after.battles)[0];
    expect(battle?.sides.map((x) => x.owner) ?? []).not.toContain('ghost');
  });

  it('S18: выбывший НЕ захватывает мир своим призраком', () => {
    // Край, который открыл MSB-4: захват отдаёт мир владельцу самого РАННЕГО выжившего
    // берега, а «выживший» проверяется по войскам. Берег выбывшего стоит в списке
    // первым — не убрав его, мир достался бы игроку, которого в партии больше нет.
    const after = run(siege(), 400);
    expect(after.planets.P?.owner).not.toBe('ghost');
  });

  it('S19/S20: Хранитель и освобождение места руку НЕ меняют — бой не трогается', () => {
    const s = siege();
    // Здесь НИКТО не выбывает: проверяется только смена руки, поэтому дом даётся и
    // `ghost` тоже. Иначе его выбывание убрало бы сторону, и тест мерил бы S18.
    s.planets.R = {
      id: 'R',
      owner: 'ghost',
      position: { x: -100, y: 0 },
      resources: {},
      buildings: [],
      garrison: stacks([['marine', 1]]),
      traits: [],
    };
    // Хранитель: место играет ИИ, но `players[id]` тот же — сторона остаётся валидной.
    s.players.p2!.steward = { posture: 'defend', until: 10 * HOUR };
    // Освобождение места: снимается заявка, а не владение.
    s.players.p2!.claimedAt = 0;
    const before = s.battles.b1!.sides.length;
    delete s.players.p2!.claimedAt;

    const after = run(s, 2);
    const battle = Object.values(after.battles)[0];
    expect(battle?.sides).toHaveLength(before);
    expect(battle?.sides.map((x) => x.owner)).toContain('p2');
  });
});
