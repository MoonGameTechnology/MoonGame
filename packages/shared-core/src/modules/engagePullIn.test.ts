/**
 * БОЙ «АТАКИ» ВТЯГИВАЕТ ЖДАВШИХ РЯДОМ (ATK-3) — приёмка кирпича.
 *
 * Правило S3 (MSB-3, решение владельца 2026-09-11: втягивать АВТОМАТИЧЕСКИ) говорит, что
 * завязка боя втягивает всех, кто стоял у мира свободным и имеет в бою врага. Держал его
 * только бой, заведённый ядром на прибытии: `fleet.engage` собирает свой бой в модуле
 * fleet-ops и про втягивание не знал. Отсюда две дыры. Третий враг у того же мира ждал в
 * стороне и добивал выжившего свежим флотом, а из нескольких своих флотов у цели в бой
 * вступал первый, остальные получали `E_IN_BATTLE`.
 *
 * Втягивает по-прежнему модуль боя: fleet-ops зовёт его через реестр возможностей
 * (`battle.pullIn`), потому что модули не импортируют друг друга (инвариант №3). Нет
 * модуля боя — нет и возможности, и бой «Атаки» остаётся парой, как до кирпича.
 */
import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { combatModule } from './combat';
import { diplomacyModule } from './diplomacy';
import { fleetOpsModule } from './fleetOps';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { setStance } from '../state/diplomacy';
import { hoursToMs, type Action, type ApplyResult, type Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    // Один корпус на всех и большой запас хода: кирпич про то, КТО в бою, а не кто кого добьёт.
    fighter: {
      faction: 'x',
      domain: 'space',
      stats: { attack: 10, defense: 4, speed: 10, hp: 5000 },
    },
  },
  factions: {},
  buildings: {},
  events: {},
});

const NOW = 1_000;
const ctx: Context = { now: NOW, data };
const kernel = createKernel([combatModule, diplomacyModule, fleetOpsModule]);

function fleetOf(id: string, owner: string): Fleet {
  return {
    id,
    owner,
    location: 'P',
    movement: null,
    units: [{ unit: 'fighter', count: 1 }],
    traits: [],
  };
}
function planetOf(id: string, owner: string | null = null): Planet {
  return {
    id,
    owner,
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
}

/** Все флоты стоят у мира `P`. Стойки по умолчанию — война; мир расставляется точечно. */
function world(
  fleets: Array<[id: string, owner: string]>,
  peace: Array<[string, string]> = [],
): GameState {
  const s = createInitialState({ seed: 'atk3', version: { data: '0.1.0', manifest: '1' } });
  const players: Record<string, Player> = {};
  const byId: Record<string, Fleet> = {};
  for (const [id, owner] of fleets) {
    players[owner] = { id: owner, name: owner, faction: 'x', status: 'active', resources: {} };
    byId[id] = fleetOf(id, owner);
  }
  const out: GameState = { ...s, players, fleets: byId, planets: { P: planetOf('P') } };
  for (const [a, b] of peace) setStance(out, a, b, 'peace');
  return out;
}

const engage = (fleetId: string, targetId: string, playerId: string): Action => ({
  id: `a:${playerId}:${fleetId}`,
  type: 'fleet.engage',
  playerId,
  payload: { fleetId, targetId },
  issuedAt: 0,
});
function ok(r: ApplyResult): GameState {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r.state;
}
function errCode(r: ApplyResult): string {
  if (r.ok) throw new Error('expected rejection, got ok');
  return r.code;
}
/** Единственный бой у мира — его и проверяем. */
function only(s: GameState) {
  const ids = Object.keys(s.battles);
  expect(ids).toHaveLength(1);
  return s.battles[ids[0]!]!;
}

describe('ATK-3 — бой «Атаки» втягивает ждавших у мира, как бой прибытия', () => {
  it('ТРЕТИЙ ВРАГ, ждавший у мира, вступает в бой «Атаки», а не добивает победителя потом', () => {
    const s = ok(
      kernel.applyAction(
        world([
          ['A', 'p1'],
          ['D', 'p2'],
          ['E', 'p3'],
        ]),
        engage('A', 'D', 'p1'),
        ctx,
      ),
    );

    const battle = only(s);
    expect(battle.sides).toHaveLength(3);
    expect(s.fleets.E?.battleId).toBe(battle.id);
    // Кто вступает, тот атакующий (MSB-3): обороняющийся в бою по-прежнему один — цель.
    expect(battle.sides.find((x) => x.owner === 'p3')?.role).toBe('attacker');
    expect(battle.sides.filter((x) => x.role === 'defender').map((x) => x.owner)).toEqual(['p2']);
  });

  it('ВТОРОЙ СВОЙ ФЛОТ у цели вступает в тот же бой, и второй приказ ему уже не нужен', () => {
    const s = ok(
      kernel.applyAction(
        world([
          ['A1', 'p1'],
          ['A2', 'p1'],
          ['D', 'p2'],
        ]),
        engage('A1', 'D', 'p1'),
        ctx,
      ),
    );

    const battle = only(s);
    expect(battle.sides.map((x) => x.owner).sort()).toEqual(['p1', 'p1', 'p2']);
    expect(s.fleets.A2?.battleId).toBe(battle.id);
    // Поэтому клиент шлёт `fleet.engage` одному флоту из выделенных у цели: второй приказ
    // получил бы отказ — флот уже дерётся.
    expect(errCode(kernel.applyAction(s, engage('A2', 'D', 'p1'), ctx))).toBe('E_IN_BATTLE');
  });

  it('НЕ ВРАГ никому в бою не втягивается: втягивает вражда, а не соседство', () => {
    const st = world(
      [
        ['A', 'p1'],
        ['D', 'p2'],
        ['E', 'p3'],
      ],
      [
        ['p1', 'p3'],
        ['p2', 'p3'],
      ],
    );
    const s = ok(kernel.applyAction(st, engage('A', 'D', 'p1'), ctx));

    expect(only(s).sides).toHaveLength(2);
    expect(s.fleets.E?.battleId).toBeFalsy();
  });

  it('ВТЯНУТЫЙ стреляет сразу, как всякий вступивший; «Атакующий» — через интервал, как раньше', () => {
    const s = ok(
      kernel.applyAction(
        world([
          ['A1', 'p1'],
          ['A2', 'p1'],
          ['D', 'p2'],
        ]),
        engage('A1', 'D', 'p1'),
        ctx,
      ),
    );

    const side = (fleetId: string) =>
      only(s).sides.find((x) => x.ref.kind === 'fleet' && x.ref.fleetId === fleetId);
    expect(side('A2')?.nextAttackAt).toBe(NOW);
    expect(side('A1')?.nextAttackAt).toBe(NOW + hoursToMs(ctx, 1));
  });
});

describe('ATK-3 — «Атака» по цели, которая уже дерётся у этого мира', () => {
  /**
   * Свободный флот рядом с идущим боем: гарнизон мира поднят флотом (`fleet.launch`) уже
   * после того, как бой завязался, — прибытия не было, и втянуть его было нечему.
   */
  function launchedNextToBattle(): { s: GameState; launched: string } {
    const st = world([
      ['D', 'p2'],
      ['E', 'p3'],
    ]);
    st.players.p1 = { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: {} };
    st.planets.P = { ...planetOf('P', 'p1'), garrison: [{ unit: 'fighter', count: 2 }] };
    const fighting = ok(kernel.applyAction(st, engage('E', 'D', 'p3'), ctx));
    const r = kernel.applyAction(
      fighting,
      {
        id: 'a:p1:launch',
        type: 'fleet.launch',
        playerId: 'p1',
        payload: { planetId: 'P' },
        issuedAt: 0,
      },
      ctx,
    );
    if (!r.ok) throw new Error(`launch failed: ${r.code}`);
    const launched = (
      r.events.find((e) => e.type === 'fleet.launched')?.payload as { fleetId: string }
    ).fleetId;
    return { s: r.state, launched };
  }

  it('вступает в её бой, как вступил бы прибывший: идущий бой важнее новой дуэли (MSB-3)', () => {
    const { s: before, launched } = launchedNextToBattle();
    expect(before.fleets[launched]?.battleId).toBeFalsy();
    expect(only(before).sides).toHaveLength(2);

    const s = ok(kernel.applyAction(before, engage(launched, 'D', 'p1'), ctx));

    expect(Object.keys(s.battles)).toHaveLength(1); // тот же бой, не второй рядом
    expect(only(s).sides).toHaveLength(3);
    expect(s.fleets[launched]?.battleId).toBe(only(s).id);
  });

  it('бой цели недостижим — честный отказ E_IN_BATTLE, а не тихий успех (fail-secure)', () => {
    const st = world([
      ['A', 'p1'],
      ['D', 'p2'],
    ]);
    st.fleets.D = { ...st.fleets.D!, battleId: 'battle:gone' }; // бой, которого нет: занятость
    const r = kernel.applyAction(st, engage('A', 'D', 'p1'), ctx);

    expect(errCode(r)).toBe('E_IN_BATTLE');
  });
});

describe('ATK-3 — без модуля боя (деградация, инвариант №3)', () => {
  const bare = createKernel([fleetOpsModule]);

  it('бой «Атаки» остаётся парой: втягивать некому', () => {
    const s = ok(
      bare.applyAction(
        world([
          ['A', 'p1'],
          ['D', 'p2'],
          ['E', 'p3'],
        ]),
        engage('A', 'D', 'p1'),
        ctx,
      ),
    );

    expect(only(s).sides).toHaveLength(2);
    expect(s.fleets.E?.battleId).toBeFalsy();
  });

  it('по дерущейся цели — прежний отказ E_IN_BATTLE', () => {
    const st = world([
      ['A', 'p1'],
      ['D', 'p2'],
    ]);
    st.fleets.D = { ...st.fleets.D!, battleId: 'battle:x' };
    st.battles['battle:x'] = {
      id: 'battle:x',
      location: 'P',
      phase: 'orbital',
      sides: [],
      round: 0,
    };

    expect(errCode(bare.applyAction(st, engage('A', 'D', 'p1'), ctx))).toBe('E_IN_BATTLE');
  });
});
