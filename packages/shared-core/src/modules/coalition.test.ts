import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { diplomacyModule } from './diplomacy';
import { createInitialState, type GameState, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { getOffer, getStance, setOffer } from '../state/diplomacy';
import { coalitionCapacity, coalitionOf } from '../state/coalition';
import { isValidActionPayload } from '../actions/payloadSchemas';
import type { GameModule } from '../kernel/module';
import type { Action, ApplyResult, Context } from '../action/types';
import { deepFreeze } from '../util/clone';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
});
const ctx = (): Context => ({ now: 0, data });
const kernel = createKernel([diplomacyModule]);
const killer: GameModule = {
  id: 'test-killer',
  version: '1',
  setup(api) {
    api.onAction('test.kill', (a, h) => {
      const id = (a.payload as { id: string }).id;
      h.state.players[id]!.status = 'defeated';
      h.emit('player.eliminated', { playerId: id });
    });
  },
};

function player(id: string, extra: Partial<Player> = {}): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: {}, ...extra };
}
/** Карта на `n` мест: p1…pn. */
function board(n: number): GameState {
  const s = createInitialState({ seed: 'coal', version: { data: '0.1.0', manifest: '1' } });
  for (let i = 1; i <= n; i++) s.players[`p${i}`] = player(`p${i}`);
  return s;
}
let seq = 0;
function act(playerId: string, type: string, payload: unknown): Action {
  seq += 1;
  return { id: `c:${seq}`, type, playerId, payload, issuedAt: 0 };
}
function ok(r: ApplyResult): GameState {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r.state;
}
function code(r: ApplyResult): string {
  if (r.ok) throw new Error('expected rejection');
  return r.code;
}
/** a предлагает союз, b принимает. */
function ally(s: GameState, a: string, b: string): GameState {
  const offered = ok(
    kernel.applyAction(s, act(a, 'diplomacy.declare', { target: b, stance: 'alliance' }), ctx()),
  );
  return ok(
    kernel.applyAction(
      offered,
      act(b, 'diplomacy.declare', { target: a, stance: 'alliance' }),
      ctx(),
    ),
  );
}

describe('COAL-1 — вместимость коалиции', () => {
  it('карта на 20 — коалиция на 3; не меньше двух; NPC не считаются', () => {
    expect(coalitionCapacity(board(20))).toBe(3);
    expect(coalitionCapacity(board(50))).toBe(7);
    expect(coalitionCapacity(board(4))).toBe(2);
    const s = board(20);
    s.players.pirates = player('pirates', { npc: 'pirate' });
    expect(coalitionCapacity(s)).toBe(3);
  });
});

describe('coalition.create — explicit founding', () => {
  it('creates a persistent singleton without changing diplomatic relations or offers', () => {
    const input = deepFreeze(board(4));
    const result = kernel.applyAction(input, act('p1', 'coalition.create', {}), ctx());
    const s = ok(result);
    const c = coalitionOf(s, 'p1')!;
    expect(c).toMatchObject({ founder: 'p1', members: ['p1'], description: '' });
    expect(s.diplomacy).toEqual(input.diplomacy);
    expect(s.diplomacyOffers).toEqual(input.diplomacyOffers);
    expect(coalitionOf(JSON.parse(JSON.stringify(s)) as GameState, 'p1')).toEqual(c);
    expect(input.coalitions).toBeUndefined();
    if (result.ok) {
      expect(result.events).toContainEqual({
        type: 'coalition.joined',
        payload: { playerId: 'p1', coalitionId: c.id },
      });
    }
  });

  it('rejects founding a second coalition without consuming a coalition id', () => {
    const s = deepFreeze(
      ok(kernel.applyAction(board(4), act('p1', 'coalition.create', {}), ctx())),
    );
    expect(code(kernel.applyAction(s, act('p1', 'coalition.create', {}), ctx()))).toBe(
      'E_FORBIDDEN',
    );
    expect(s.coalitionSeq).toBe(1);
    expect(Object.keys(s.coalitions!)).toHaveLength(1);
  });

  it.each([
    ['missing', null],
    ['defeated', { status: 'defeated' }],
    ['bot', { ai: true }],
    ['npc', { npc: 'pirate' }],
  ] as const)('refuses a %s actor', (_kind, extra) => {
    const s = board(4);
    if (extra === null) delete s.players.p1;
    else s.players.p1 = player('p1', extra);
    expect(code(kernel.applyAction(deepFreeze(s), act('p1', 'coalition.create', {}), ctx()))).toBe(
      'E_FORBIDDEN',
    );
  });

  it.each(['team_2v2', 'team_3v3'])('refuses founding in fixed-side mode %s', (modeId) => {
    expect(
      code(
        kernel.applyAction(board(4), act('p1', 'coalition.create', {}), {
          ...ctx(),
          config: { timeScale: 1, modeId },
        }),
      ),
    ).toBe('E_FORBIDDEN');
  });

  it('admits an invited free player only after their consent and keeps the original founder', () => {
    const created = ok(kernel.applyAction(board(4), act('p1', 'coalition.create', {}), ctx()));
    const offered = ok(
      kernel.applyAction(
        created,
        act('p1', 'diplomacy.declare', {
          target: 'p2',
          stance: 'alliance',
        }),
        ctx(),
      ),
    );
    expect(coalitionOf(offered, 'p1')?.members).toEqual(['p1']);
    expect(coalitionOf(offered, 'p2')).toBeNull();
    expect(getStance(offered, 'p1', 'p2')).toBe('war');
    const joined = ok(
      kernel.applyAction(
        offered,
        act('p2', 'diplomacy.declare', {
          target: 'p1',
          stance: 'alliance',
        }),
        ctx(),
      ),
    );
    expect(coalitionOf(joined, 'p1')).toMatchObject({
      id: coalitionOf(created, 'p1')!.id,
      founder: 'p1',
      members: ['p1', 'p2'],
    });
    expect(getStance(joined, 'p1', 'p2')).toBe('alliance');
  });

  it('does not merge two independently founded coalitions through an alliance offer', () => {
    const first = ok(kernel.applyAction(board(4), act('p1', 'coalition.create', {}), ctx()));
    const both = ok(kernel.applyAction(first, act('p2', 'coalition.create', {}), ctx()));
    expect(
      code(
        kernel.applyAction(
          both,
          act('p1', 'diplomacy.declare', {
            target: 'p2',
            stance: 'alliance',
          }),
          ctx(),
        ),
      ),
    ).toBe('E_COALITION_OTHER');
  });

  it('dissolves the coalition when its last member leaves', () => {
    const created = ok(kernel.applyAction(board(4), act('p1', 'coalition.create', {}), ctx()));
    const left = ok(kernel.applyAction(created, act('p1', 'coalition.leave', {}), ctx()));
    expect(left.coalitions).toBeUndefined();
  });

  it('removes a defeated singleton without touching another coalition', () => {
    const created = ok(kernel.applyAction(board(4), act('p1', 'coalition.create', {}), ctx()));
    const both = ok(kernel.applyAction(created, act('p2', 'coalition.create', {}), ctx()));
    const k = createKernel([diplomacyModule, killer]);
    const defeated = ok(k.applyAction(both, act('p3', 'test.kill', { id: 'p1' }), ctx()));
    expect(coalitionOf(defeated, 'p1')).toBeNull();
    expect(coalitionOf(defeated, 'p2')).toEqual(coalitionOf(both, 'p2'));
  });

  it('keeps the survivor and transfers the title when the founder is defeated', () => {
    const created = ok(kernel.applyAction(board(4), act('p1', 'coalition.create', {}), ctx()));
    const paired = ally(created, 'p1', 'p2');
    const k = createKernel([diplomacyModule, killer]);
    const defeated = ok(k.applyAction(paired, act('p3', 'test.kill', { id: 'p1' }), ctx()));
    expect(coalitionOf(defeated, 'p1')).toBeNull();
    expect(coalitionOf(defeated, 'p2')).toMatchObject({
      id: coalitionOf(created, 'p1')!.id,
      founder: 'p2',
      members: ['p2'],
    });
    expect(getStance(defeated, 'p1', 'p2')).toBe('peace');
  });
});

describe('COAL-1 — союз создаёт коалицию и держит её потолок', () => {
  it('принятый союз двух свободных игроков создаёт коалицию', () => {
    const s = ally(board(20), 'p1', 'p2');
    const c = coalitionOf(s, 'p1')!;
    expect(c.members).toEqual(['p1', 'p2']);
    expect(c.founder).toBe('p1');
    expect(coalitionOf(s, 'p2')?.id).toBe(c.id);
  });

  it('одно предложение коалицию не создаёт', () => {
    const s = ok(
      kernel.applyAction(
        board(20),
        act('p1', 'diplomacy.declare', { target: 'p2', stance: 'alliance' }),
        ctx(),
      ),
    );
    expect(s.coalitions).toBeUndefined();
  });

  it('вступивший получает союз со всеми членами', () => {
    const s = ally(ally(board(20), 'p1', 'p2'), 'p3', 'p2');
    expect(coalitionOf(s, 'p3')?.members).toEqual(['p1', 'p2', 'p3']);
    expect(getStance(s, 'p3', 'p1')).toBe('alliance');
  });

  it('четвёртый на карте в 20 мест отбит и при предложении, и при принятии', () => {
    const full = ally(ally(board(20), 'p1', 'p2'), 'p3', 'p2');
    expect(
      code(
        kernel.applyAction(
          full,
          act('p4', 'diplomacy.declare', { target: 'p1', stance: 'alliance' }),
          ctx(),
        ),
      ),
    ).toBe('E_COALITION_FULL');
    expect(
      code(
        kernel.applyAction(
          full,
          act('p1', 'diplomacy.declare', { target: 'p4', stance: 'alliance' }),
          ctx(),
        ),
      ),
    ).toBe('E_COALITION_FULL');
    // Предложение, сделанное до заполнения, при принятии тоже отбивается.
    const pending = ally(board(20), 'p1', 'p2');
    setOffer(pending, 'p4', 'p1', 'alliance');
    const filled = ally(pending, 'p3', 'p2');
    expect(
      code(
        kernel.applyAction(
          filled,
          act('p1', 'diplomacy.declare', { target: 'p4', stance: 'alliance' }),
          ctx(),
        ),
      ),
    ).toBe('E_COALITION_FULL');
  });

  it('члены разных коалиций не могут заключить союз', () => {
    const s = ally(ally(board(20), 'p1', 'p2'), 'p3', 'p4');
    expect(
      code(
        kernel.applyAction(
          s,
          act('p1', 'diplomacy.declare', { target: 'p3', stance: 'alliance' }),
          ctx(),
        ),
      ),
    ).toBe('E_COALITION_OTHER');
  });
});

describe('COAL-1 — выход из коалиции', () => {
  it('coalition.leave снимает союз миром; оставшийся продолжает коалицию', () => {
    const s = ok(
      kernel.applyAction(ally(board(20), 'p1', 'p2'), act('p1', 'coalition.leave', {}), ctx()),
    );
    expect(getStance(s, 'p1', 'p2')).toBe('peace');
    expect(coalitionOf(s, 'p1')).toBeNull();
    expect(coalitionOf(s, 'p2')).toMatchObject({ founder: 'p2', members: ['p2'] });
  });

  it('объявление войны члену коалиции — выход из неё', () => {
    const three = ally(ally(board(20), 'p1', 'p2'), 'p3', 'p2');
    const r = kernel.applyAction(
      three,
      act('p1', 'diplomacy.declare', { target: 'p2', stance: 'war' }),
      ctx(),
    );
    const s = ok(r);
    expect(getStance(s, 'p1', 'p2')).toBe('war');
    expect(getStance(s, 'p1', 'p3')).toBe('peace');
    expect(coalitionOf(s, 'p1')).toBeNull();
    expect(coalitionOf(s, 'p2')?.members).toEqual(['p2', 'p3']);
  });

  it('выбывший освобождает место и теряет союзы, союз оставшихся цел', () => {
    const k = createKernel([diplomacyModule, killer]);
    const three = ally(ally(board(20), 'p1', 'p2'), 'p3', 'p2');
    const s = ok(k.applyAction(three, act('p1', 'test.kill', { id: 'p3' }), ctx()));
    expect(coalitionOf(s, 'p1')?.members).toEqual(['p1', 'p2']);
    expect(getStance(s, 'p1', 'p2')).toBe('alliance');
    expect(getStance(s, 'p3', 'p1')).toBe('peace');
    expect(getStance(s, 'p3', 'p2')).toBe('peace');
  });

  it('выйти, не состоя в коалиции, нельзя', () => {
    expect(code(kernel.applyAction(board(20), act('p1', 'coalition.leave', {}), ctx()))).toBe(
      'E_NO_COALITION',
    );
  });
});

describe('COAL-1 — эмблема и описание', () => {
  it('член коалиции меняет эмблему и описание', () => {
    const s = ok(
      kernel.applyAction(
        ally(board(20), 'p1', 'p2'),
        act('p2', 'coalition.edit', { emblem: 'skull', description: '  Вместе до конца  ' }),
        ctx(),
      ),
    );
    const c = coalitionOf(s, 'p1')!;
    expect(c.emblem).toBe('skull');
    expect(c.description).toBe('Вместе до конца');
  });

  it('чужой, неизвестная эмблема, длинное описание и управляющие символы отбиты', () => {
    const s = deepFreeze(ally(board(20), 'p1', 'p2'));
    expect(
      code(
        kernel.applyAction(
          s,
          act('p3', 'coalition.edit', { emblem: 'star', description: '' }),
          ctx(),
        ),
      ),
    ).toBe('E_NO_COALITION');
    expect(
      code(
        kernel.applyAction(
          s,
          act('p1', 'coalition.edit', { emblem: 'nope', description: '' }),
          ctx(),
        ),
      ),
    ).toBe('E_BAD_PAYLOAD');
    expect(
      code(
        kernel.applyAction(
          s,
          act('p1', 'coalition.edit', { emblem: 'star', description: 'x'.repeat(161) }),
          ctx(),
        ),
      ),
    ).toBe('E_BAD_PAYLOAD');
    expect(
      code(
        kernel.applyAction(
          s,
          act('p1', 'coalition.edit', { emblem: 'star', description: 'a\u0000b' }),
          ctx(),
        ),
      ),
    ).toBe('E_BAD_PAYLOAD');
  });

  it('схемы действий принимают новые формы', () => {
    expect(isValidActionPayload('coalition.create', {})).toBe(true);
    expect(isValidActionPayload('coalition.create', null)).toBe(false);
    expect(isValidActionPayload('coalition.create', [])).toBe(false);
    expect(isValidActionPayload('coalition.edit', { emblem: 'star', description: 'ok' })).toBe(
      true,
    );
    expect(
      isValidActionPayload('coalition.edit', { emblem: 'star', description: 'x'.repeat(161) }),
    ).toBe(false);
    expect(isValidActionPayload('coalition.leave', {})).toBe(true);
    expect(isValidActionPayload('diplomacy.decline', { target: 'p2' })).toBe(true);
  });
});

describe('COAL-1 — отказ от предложения', () => {
  it('diplomacy.decline снимает чужое предложение и сообщает предложившему', () => {
    const offered = ok(
      kernel.applyAction(
        board(4),
        act('p1', 'diplomacy.declare', { target: 'p2', stance: 'peace' }),
        ctx(),
      ),
    );
    const r = kernel.applyAction(offered, act('p2', 'diplomacy.decline', { target: 'p1' }), ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(getOffer(r.state, 'p1', 'p2')).toBeNull();
    expect(getStance(r.state, 'p1', 'p2')).toBe('war');
    expect(r.events).toContainEqual({
      type: 'diplomacy.declined',
      payload: { from: 'p1', to: 'p2', stance: 'peace' },
    });
  });

  it('отказаться можно только от висящего предложения', () => {
    expect(
      code(kernel.applyAction(board(4), act('p2', 'diplomacy.decline', { target: 'p1' }), ctx())),
    ).toBe('E_NO_OFFER');
  });

  it('обмен картами: on:false отклоняет входящее предложение', () => {
    const s = board(4);
    const peace = ok(
      kernel.applyAction(
        ok(
          kernel.applyAction(
            s,
            act('p1', 'diplomacy.declare', { target: 'p2', stance: 'peace' }),
            ctx(),
          ),
        ),
        act('p2', 'diplomacy.declare', { target: 'p1', stance: 'peace' }),
        ctx(),
      ),
    );
    const offered = ok(
      kernel.applyAction(peace, act('p1', 'diplomacy.mapshare', { target: 'p2', on: true }), ctx()),
    );
    const declined = ok(
      kernel.applyAction(
        offered,
        act('p2', 'diplomacy.mapshare', { target: 'p1', on: false }),
        ctx(),
      ),
    );
    expect(declined.mapShareOffers).toBeUndefined();
  });
});
