import { describe, it, expect } from 'vitest';
import { createKernel, createInitialState } from '../../packages/shared-core/src/index';
import type { GameState, Fleet, Planet, Context, ApplyResult } from '../../packages/shared-core/src/index';
import {
  standingOrdersModule,
  orderAuto,
  serverAutoAssaultActions,
  serverPatrolActions,
  data,
} from './game';

const kernel = createKernel([standingOrdersModule]);
const ctx = (now = 0): Context => ({ now, data });


function fleet(id: string, over: Partial<Fleet> = {}): Fleet {
  return {
    id, owner: 'green', location: 'A', movement: null,
    units: [{ unit: 'cruiser', count: 1 }], landing: [], traits: [], battleId: null, ...over,
  } as unknown as Fleet;
}
function planet(id: string, pos: { x: number; y: number }, owner: string | null = null, links: string[] = []): Planet {
  return { id, owner, position: pos, links, garrison: [], buildings: [] } as unknown as Planet;
}
function stateWith(fleets: Fleet[], planets: Planet[] = [planet('A', { x: 0, y: 0 })]): GameState {
  const s = createInitialState({ seed: 'so', version: { data: '0.1.0', manifest: '1' } });
  const f: Record<string, Fleet> = {};
  for (const x of fleets) f[x.id] = x;
  const p: Record<string, Planet> = {};
  for (const x of planets) p[x.id] = x;
  return { ...s, fleets: f, planets: p };
}
function ok(r: ApplyResult): GameState {
  if (!r.ok) throw new Error('apply failed: ' + r.code);
  return r.state;
}
function rej(r: ApplyResult): string {
  if (r.ok) throw new Error('expected rejection, got ok');
  return r.code;
}
type SOState = GameState & {
  autoAssault?: Record<string, true>;
  patrols?: Record<string, { kind: 'planet' | 'fleet' }>;
};

describe('standingOrdersModule — CC-2 auto-storm stance (authoritative)', () => {
  it('order.auto toggles the flag; the emptied map leaves state entirely', () => {
    let s = ok(kernel.applyAction(stateWith([fleet('F')]), orderAuto('green', 'F', true), ctx()));
    expect((s as SOState).autoAssault).toEqual({ F: true });
    s = ok(kernel.applyAction(s, orderAuto('green', 'F', false), ctx()));
    expect('autoAssault' in (s as SOState)).toBe(false);
  });

  it('is fail-secure: unknown fleet / not yours / non-boolean payload reject', () => {
    const s = stateWith([fleet('F'), fleet('E', { owner: 'red' })]);
    // Чужой флот и несуществующий отвечают ОДИНАКОВО (A06 — по коду отказа нельзя
    // выяснить, есть ли такой флот у соседа). Копия прототипа различала их
    // `E_FORBIDDEN`/`E_NO_FLEET` и тем самым отвечала на вопрос, которого не задавали;
    // CONV-7 снял копию, и остался ужесточённый ответ ядра.
    expect(rej(kernel.applyAction(s, orderAuto('green', 'ghost', true), ctx()))).toBe('E_NO_FLEET');
    expect(rej(kernel.applyAction(s, orderAuto('green', 'E', true), ctx()))).toBe('E_NO_FLEET');
    const bad = { ...orderAuto('green', 'F', true), payload: { fleetId: 'F', on: 'yes' } };
    expect(rej(kernel.applyAction(s, bad, ctx()))).toBe('E_BAD_PAYLOAD');
  });
});

describe('serverAutoAssaultActions — the CC-2 server driver core', () => {
  const flag = (s: GameState, id: string): GameState => {
    (s as SOState).autoAssault = { [id]: true };
    return s;
  };

  it('storms someone else’s world under a flagged, parked fleet (orbit first)', () => {
    const s = flag(stateWith([fleet('F')], [planet('A', { x: 0, y: 0 }, 'red')]), 'F');
    const out = serverAutoAssaultActions(s);
    expect(out).toHaveLength(1);
    expect(out[0]!.owner).toBe('green');
    expect(out[0]!.actions.map((a) => a.type)).toEqual(['fleet.orbit', 'fleet.assault']);
  });

  it('holds on your own world, under enemy contact, in transit — and skips unflagged fleets', () => {
    const own = flag(stateWith([fleet('F')], [planet('A', { x: 0, y: 0 }, 'green')]), 'F');
    expect(serverAutoAssaultActions(own)).toEqual([]);
    const contested = flag(
      stateWith([fleet('F'), fleet('E', { owner: 'red' })], [planet('A', { x: 0, y: 0 }, 'red')]),
      'F',
    );
    expect(serverAutoAssaultActions(contested)).toEqual([]);
    const moving = flag(stateWith([fleet('F', { movement: { to: 'B' } as never })], [planet('A', { x: 0, y: 0 }, 'red')]), 'F');
    expect(serverAutoAssaultActions(moving)).toEqual([]);
    const unflagged = stateWith([fleet('F')], [planet('A', { x: 0, y: 0 }, 'red')]);
    expect(serverAutoAssaultActions(unflagged)).toEqual([]);
  });

  it('ignores a stale flag whose fleet is gone (the sweep will drop it)', () => {
    const s = stateWith([], [planet('A', { x: 0, y: 0 }, 'red')]);
    (s as SOState).autoAssault = { GONE: true };
    expect(serverAutoAssaultActions(s)).toEqual([]);
  });

  // --- RULES-3: драйвер спрашивает ядро, а не переписывает правила ---------------
  // Смысл конверсии не в красоте, а в отказах, которых рукописные условия НЕ ЗНАЛИ:
  // их драйвер выдавал каждое пробуждение (rejected-churn), причём половина пары
  // «орбита → штурм» успевала примениться.
  it('молчит по защищённому миру без десанта — отказ, которого условия не знали', () => {
    const defended = planet('A', { x: 0, y: 0 }, 'red');
    (defended as unknown as { garrison: Array<{ unit: string; count: number }> }).garrison = [
      { unit: 'militia', count: 3 },
    ];
    const s = flag(stateWith([fleet('F')], [defended]), 'F'); // у флота landing: []
    expect(serverAutoAssaultActions(s)).toEqual([]); // ядро: E_NO_TROOPS
  });

  it('молчит по незахватываемому сектору — правило теперь в ядре, а не в копии драйвера', () => {
    const nowhere = planet('A', { x: 0, y: 0 }, null);
    (nowhere as unknown as { kind: string }).kind = 'empty';
    const s = flag(stateWith([fleet('F')], [nowhere]), 'F');
    expect(serverAutoAssaultActions(s)).toEqual([]); // ядро: E_NOT_CAPTURABLE
  });

  it('выдаёт приказы в порядке id, а не в порядке ключей JSONB (инвариант №6)', () => {
    const s = stateWith(
      [fleet('Z'), fleet('A2')],
      [planet('A', { x: 0, y: 0 }, 'red')],
    );
    (s as SOState).autoAssault = { Z: true, A2: true }; // ключи вставлены НЕ по порядку
    expect(serverAutoAssaultActions(s).map((o) => o.fleetId)).toEqual(['A2', 'Z']);
  });
});

/**
 * CC-4 у прототипа — ТОНКАЯ обёртка (SHU-2.2): и выбор цели, и чтение мира живут в ядре
 * (`patrolScrambles`), а правила дежурства — в `standingOrdersModule`. Оба покрыты
 * своими тестами в `packages/`, поэтому здесь сторожится ровно проводка: обёртка отдаёт
 * `shuttle.strike` с базой в правильном поле. Раньше на этом месте лежала третья копия
 * тех же правил.
 */
describe('serverPatrolActions — проводка прототипной обёртки (CC-4)', () => {
  it('дежурная БАЗА отдаёт `shuttle.strike` с id мира в поле мира', () => {
    const port = planet('A', { x: 0, y: 0 }, 'green');
    const s = stateWith([fleet('foe', { owner: 'red', location: 'A' })], [port]);
    s.planets.A = {
      ...s.planets.A!,
      buildings: [{ type: 'spaceport', level: 1, hp: 200 }],
      hangar: [{ id: 'sq:green:1', units: [{ unit: 'interceptor', count: 2 }] }],
    } as unknown as Planet;
    (s as SOState).patrols = { A: { kind: 'planet' } };
    const out = serverPatrolActions(s);
    expect(out).toHaveLength(1);
    expect(out[0]!.actions[0]!.type).toBe('shuttle.strike');
    expect(out[0]!.actions[0]!.payload).toMatchObject({
      planetId: 'A',
      squadronId: 'sq:green:1',
      targetFleetId: 'foe',
    });
  });

  it('без дежурных баз обёртка молчит', () => {
    expect(serverPatrolActions(stateWith([fleet('F')]))).toEqual([]);
  });
});
