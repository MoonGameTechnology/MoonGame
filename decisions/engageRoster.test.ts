import { describe, it, expect } from 'vitest';
import { engageRoster } from './engageRoster';
import { battleHostility, type ForecastSide } from './battleForecast';
import {
  combatModule,
  createInitialState,
  createKernel,
  diplomacyModule,
  fleetOpsModule,
  parseGameData,
  setStance,
  type Fleet,
  type GameData,
  type GameState,
} from '../packages/shared-core/src/index';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    corvette: {
      faction: 'x',
      domain: 'space',
      stats: { attack: 10, defense: 6, hp: 30, speed: 60 },
    },
    mine: {
      faction: 'x',
      domain: 'space',
      traits: ['mine'],
      stats: { attack: 0, defense: 0, hp: 10, speed: 0 },
    },
  },
  factions: {},
  buildings: {},
  events: {},
});

const kernel = createKernel([combatModule, diplomacyModule, fleetOpsModule]);
const ctx = { now: 1_000, data };

/** Флоты `[id, владелец, узел?]`; стойки по умолчанию — война, остальное расставляется явно. */
function world(
  fleets: Array<[id: string, owner: string, at?: string]>,
  stances: Array<[string, string, 'peace' | 'alliance' | 'pact']> = [],
): GameState {
  const s = createInitialState({ seed: 'roster', version: { data: '0.1.0', manifest: '1' } });
  for (const [id, owner, at] of fleets) {
    s.players[owner] = { id: owner, name: owner, faction: 'x', status: 'active', resources: {} };
    s.fleets[id] = {
      id,
      owner,
      location: at ?? 'P',
      movement: null,
      units: [{ unit: 'corvette', count: 2 }],
      traits: [],
    } satisfies Fleet;
  }
  for (const p of ['P', 'Q']) {
    s.planets[p] = {
      id: p,
      owner: null,
      position: { x: 0, y: 0 },
      resources: {},
      buildings: [],
      garrison: [],
      traits: [],
    };
  }
  for (const [a, b, stance] of stances) setStance(s, a, b, stance);
  return s;
}

const roster = (s: GameState, selected: string[], target: string, me = 'me'): ForecastSide[] =>
  engageRoster(
    s,
    me,
    selected.map((id) => s.fleets[id]!),
    s.fleets[target]!,
    data,
    battleHostility(s),
  );

/** Сторона прогноза коротко: id, роль, своя колонка. */
const brief = (sides: readonly ForecastSide[]) =>
  sides.map((x) => [x.key, x.role, x.mine ? 'mine' : x.ally ? 'ally' : 'other']).sort();

/** Тот же бой, каким его заведёт ядро: `fleet.engage` первого выделенного по цели. */
function liveBattle(s: GameState, fleetId: string, target: string, me = 'me') {
  const r = kernel.applyAction(
    s,
    {
      id: `a:${me}:1`,
      type: 'fleet.engage',
      playerId: me,
      payload: { fleetId, targetId: target },
      issuedAt: 0,
    },
    ctx,
  );
  if (!r.ok) throw new Error(`engage failed: ${r.code}`);
  const battle = r.state.battles[r.state.fleets[fleetId]!.battleId!]!;
  return battle.sides.map((x) => [x.ref.kind === 'fleet' ? x.ref.fleetId : '', x.role]).sort();
}
const keysAndRoles = (sides: readonly ForecastSide[]) => sides.map((x) => [x.key, x.role]).sort();

describe('состав боя «Атаки» для прогноза прицела (ATK-3)', () => {
  it('без соседей — выделенные против цели, как и раньше', () => {
    const s = world([
      ['A', 'me'],
      ['B', 'me', 'Q'],
      ['D', 'foe'],
    ]);
    expect(brief(roster(s, ['A', 'B'], 'D'))).toEqual([
      ['A', 'attacker', 'mine'],
      ['B', 'attacker', 'mine'], // вдали: придёт маршем, прогноз считает бой, а не дорогу
      ['D', 'defender', 'other'],
    ]);
  });

  it('третий враг у мира цели — в составе, тем же составом, что заводит ядро', () => {
    const s = world([
      ['A', 'me'],
      ['D', 'foe'],
      ['E', 'third'],
    ]);
    const sides = roster(s, ['A'], 'D');
    expect(brief(sides)).toEqual([
      ['A', 'attacker', 'mine'],
      ['D', 'defender', 'other'],
      ['E', 'attacker', 'other'],
    ]);
    expect(keysAndRoles(sides)).toEqual(liveBattle(s, 'A', 'D'));
  });

  it('мои невыделенные флоты у мира и союзник, воюющий с целью, — в моей колонке', () => {
    const s = world(
      [
        ['A', 'me'],
        ['A2', 'me'],
        ['D', 'foe'],
        ['F', 'friend'],
      ],
      [['me', 'friend', 'alliance']],
    );
    const sides = roster(s, ['A'], 'D');
    expect(brief(sides)).toEqual([
      ['A', 'attacker', 'mine'],
      ['A2', 'attacker', 'mine'],
      ['D', 'defender', 'other'],
      ['F', 'attacker', 'ally'],
    ]);
    expect(keysAndRoles(sides)).toEqual(liveBattle(s, 'A', 'D'));
  });

  it('не враг никому в бою — не в составе: втягивает вражда, а не соседство', () => {
    const s = world(
      [
        ['A', 'me'],
        ['D', 'foe'],
        ['N', 'calm'],
      ],
      [
        ['me', 'calm', 'peace'],
        ['foe', 'calm', 'peace'],
      ],
    );
    expect(brief(roster(s, ['A'], 'D'))).toEqual([
      ['A', 'attacker', 'mine'],
      ['D', 'defender', 'other'],
    ]);
    expect(keysAndRoles(roster(s, ['A'], 'D'))).toEqual(liveBattle(s, 'A', 'D'));
  });

  it('втягивание повторяется: вступивший тянет своего врага, которого первый проход не взял', () => {
    // `B4` враждует только с `third`; `third` воюет с целью. Первым проходом `B4` врагов в бою
    // не имеет и вступает, лишь когда вступил `E3`.
    const s = world(
      [
        ['A', 'me'],
        ['B4', 'fourth'],
        ['D', 'foe'],
        ['E3', 'third'],
      ],
      [
        ['me', 'fourth', 'peace'],
        ['foe', 'fourth', 'peace'],
        ['me', 'third', 'peace'],
      ],
    );
    const sides = roster(s, ['A'], 'D');
    expect(sides.map((x) => x.key).sort()).toEqual(['A', 'B4', 'D', 'E3']);
    expect(keysAndRoles(sides)).toEqual(liveBattle(s, 'A', 'D'));
  });

  it('мина и пустой флот у мира не вступают', () => {
    const s = world([
      ['A', 'me'],
      ['D', 'foe'],
      ['M', 'third'],
      ['Z', 'third'],
    ]);
    s.fleets.M!.units = [{ unit: 'mine', count: 3 }];
    s.fleets.Z!.units = [{ unit: 'corvette', count: 0 }];
    expect(
      roster(s, ['A'], 'D')
        .map((x) => x.key)
        .sort(),
    ).toEqual(['A', 'D']);
    expect(keysAndRoles(roster(s, ['A'], 'D'))).toEqual(liveBattle(s, 'A', 'D'));
  });

  it('выделенный флот, занятый другим боем, в состав не идёт: приказ он отвергнет', () => {
    const s = world([
      ['A', 'me'],
      ['B', 'me', 'Q'],
      ['D', 'foe'],
      ['X', 'foe', 'Q'],
    ]);
    s.fleets.B!.battleId = 'battle:elsewhere';
    s.battles['battle:elsewhere'] = {
      id: 'battle:elsewhere',
      location: 'Q',
      phase: 'orbital',
      sides: [],
      round: 0,
    };
    expect(
      roster(s, ['A', 'B'], 'D')
        .map((x) => x.key)
        .sort(),
    ).toEqual(['A', 'D']);
  });

  it('ни один выделенный флот в бой не попадёт — состава нет, хотя мой флот стоит у цели', () => {
    const s = world([
      ['A', 'me', 'Q'],
      ['A2', 'me'],
      ['D', 'foe'],
      ['X', 'foe', 'Q'],
    ]);
    s.fleets.A!.battleId = 'battle:elsewhere';
    s.battles['battle:elsewhere'] = {
      id: 'battle:elsewhere',
      location: 'Q',
      phase: 'orbital',
      sides: [],
      round: 0,
    };
    // `A2` у цели не выделен: приказ «Атаки» его не двигает, а `A` его отвергнет.
    expect(roster(s, ['A'], 'D')).toEqual([]);
  });

  it('цель уже дерётся — состав её боя, выделенный вступает атакующим, как в ядре', () => {
    // Бой `third` против цели завязался, когда моего флота у мира не было; потом он
    // появился свободным (как поднятый гарнизон) — «Атака» вступает в идущий бой.
    const before = world([
      ['D', 'foe'],
      ['E', 'third'],
    ]);
    const r = kernel.applyAction(
      before,
      {
        id: 'a:third:1',
        type: 'fleet.engage',
        playerId: 'third',
        payload: { fleetId: 'E', targetId: 'D' },
        issuedAt: 0,
      },
      ctx,
    );
    if (!r.ok) throw new Error(r.code);
    const s = r.state;
    s.players.me = { id: 'me', name: 'me', faction: 'x', status: 'active', resources: {} };
    s.fleets.A = {
      id: 'A',
      owner: 'me',
      location: 'P',
      movement: null,
      units: [{ unit: 'corvette', count: 2 }],
      traits: [],
    };

    const sides = roster(s, ['A'], 'D');
    expect(brief(sides)).toEqual([
      ['A', 'attacker', 'mine'],
      ['D', 'defender', 'other'],
      ['E', 'attacker', 'other'],
    ]);
    expect(keysAndRoles(sides)).toEqual(liveBattle(s, 'A', 'D'));
  });

  it('цель в пути — втягивать некому: прогноз считает выделенных против цели', () => {
    const s = world([
      ['A', 'me'],
      ['D', 'foe'],
      ['E', 'third', 'Q'],
    ]);
    s.fleets.D!.location = null;
    expect(
      roster(s, ['A'], 'D')
        .map((x) => x.key)
        .sort(),
    ).toEqual(['A', 'D']);
  });
});
