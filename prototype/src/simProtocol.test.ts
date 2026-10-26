import { describe, expect, it } from 'vitest';
import {
  applyDelta,
  diffState,
  type GameState,
  type Player,
} from '../../packages/shared-core/src/index';
import { newGame } from './matchSetup';
import { packTreasuries, spreadTreasuries } from './simProtocol';

const start = newGame();

const change = (state: GameState, id: string, to: (p: Player) => Player): GameState => ({
  ...state,
  players: { ...state.players, [id]: to(state.players[id]!) },
});

/** Казна выросла, ключи и их порядок — прежние. */
const earn = (p: Player): Player => ({
  ...p,
  resources: Object.fromEntries(Object.entries(p.resources).map(([k, v]) => [k, v + 1.25])),
});

/**
 * Мир экрана после разностей потока, взятых разом, как их берёт `simLink.ts`: поток считает
 * каждую разность от прошлого мира, экран кладёт их по порядку, а казну раскладывает в конце.
 * Сообщения копируются, как `postMessage`.
 */
function screenAfter(worlds: GameState[]): GameState {
  let screen = worlds[0]!;
  const syncs: Array<ReturnType<typeof packTreasuries>> = [];
  for (let i = 1; i < worlds.length; i++) {
    const wire = structuredClone(
      packTreasuries(worlds[i - 1]!, diffState(worlds[i - 1]!, worlds[i]!)),
    );
    screen = applyDelta(screen, wire.delta);
    syncs.push(wire);
  }
  return spreadTreasuries(screen, syncs);
}

describe('казна мест едет числами', () => {
  it('место, у которого сменилась только казна, едет числами, и мир на экране тот же', () => {
    const next = change(change(start, 'p1', earn), 'p2', earn);
    const packed = packTreasuries(start, diffState(start, next));
    expect(packed.delta.changed.players).toBeUndefined();
    expect(packed.treasuries.ids).toEqual(['p1', 'p2']);
    const p1 = Object.keys(next.players.p1!.resources).length;
    const p2 = Object.keys(next.players.p2!.resources).length;
    expect([...packed.treasuries.at]).toEqual([0, p1]);
    expect(packed.treasuries.values).toHaveLength(p1 + p2);
    expect(screenAfter([start, next])).toEqual(next);
  });

  it('место с иной переменой, новыми ключами казны или не числом в ней едет целиком', () => {
    const keys = Object.keys(start.players.p2!.resources);
    expect(keys.length).toBeGreaterThan(1);
    const cases: Array<(p: Player) => Player> = [
      (p) => ({ ...earn(p), status: 'defeated' }),
      (p) => ({ ...p, resources: { ...p.resources, rare: 1 } }),
      (p) => ({
        ...p,
        resources: Object.fromEntries([...keys].reverse().map((k) => [k, p.resources[k]! + 1])),
      }),
      (p) => ({ ...p, resources: { ...p.resources, [keys[0]!]: '5' as unknown as number } }),
    ];
    for (const to of cases) {
      const next = change(change(start, 'p1', earn), 'p2', to);
      const packed = packTreasuries(start, diffState(start, next));
      expect(packed.treasuries.ids).toEqual(['p1']);
      expect(Object.keys(packed.delta.changed.players!)).toEqual(['p2']);
      expect(screenAfter([start, next])).toEqual(next);
    }
  });

  it('новое место едет целиком, а разность без мест — как была', () => {
    const joined = {
      ...start,
      players: { ...start.players, p9: { ...start.players.p2!, id: 'p9' } },
    };
    const packed = packTreasuries(start, diffState(start, joined));
    expect(packed.treasuries.ids).toEqual([]);
    expect(Object.keys(packed.delta.changed.players!)).toEqual(['p9']);

    const later = { ...start, time: start.time + 1 };
    const delta = diffState(start, later);
    expect(packTreasuries(start, delta).delta).toBe(delta);
  });

  it('из разностей, взятых разом, место получает свою последнюю казну', () => {
    const a = change(start, 'p2', earn);
    const b = change(a, 'p2', (p) => ({ ...earn(p), status: 'defeated' })); // целиком
    const c = change(b, 'p2', earn);
    expect(screenAfter([start, a, b, c])).toEqual(c);
    // Место пришло целиком после чисел: прежние числа на него не ложатся.
    expect(screenAfter([start, a, b])).toEqual(b);
    // Числа после места с новыми ключами ложатся по новым ключам.
    const d = change(a, 'p2', (p) => ({ ...p, resources: { rare: 2, ...p.resources } }));
    const e = change(d, 'p2', earn);
    expect(screenAfter([start, a, d, e])).toEqual(e);
  });

  it('ушедшее место числами не возвращается', () => {
    const a = change(start, 'p2', earn);
    const { p2: _gone, ...rest } = a.players;
    const b = { ...a, players: rest };
    expect(screenAfter([start, a, b]).players.p2).toBeUndefined();
  });

  it('остальная запись места — прежний объект экрана', () => {
    const next = change(start, 'p2', earn);
    const screen = screenAfter([start, next]);
    expect(screen.players.p2).not.toBe(start.players.p2);
    for (const k of Object.keys(start.players.p2!) as Array<keyof Player>) {
      if (k !== 'resources') expect(screen.players.p2![k]).toBe(start.players.p2![k]);
    }
    expect(screen.players.p1).toBe(start.players.p1);
  });
});
