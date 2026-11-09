// Крылатые ракеты у бота (missiles-roadmap, шаг ботов).
//
// Что здесь закрепляется. Ракетная доктрина на войне строит крылатую ракету в слот
// линейного корабля, а ракеты в ангаре бот пускает залпом по видимому флоту врага в
// дальности ракеты. Залп — по корпусу цели и одна сверху, без ракет, которые уже летят в
// неё (`decisions/missileSalvo.ts`): иначе бот, ходящий чаще полёта ракеты, тратил бы
// весь запас на одну цель.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES, kernel, ctx } from './game';
import { data } from './gameData';
import type { Action, GameState, Planet, Squadron } from '../../packages/shared-core/src/index';

const RICH = { credits: 6000, metal: 9000, food: 900, energy: 900, microelectronics: 400 };

function game2(scientist = 'ordnance_savant', war = true): GameState {
  const s = newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
  return structuredClone({
    ...s,
    techRules: { dayGates: false, exclude: [] },
    ...(war ? { diplomacy: { ...(s.diplomacy ?? {}), 'p1|p2': 'war' as const } } : {}),
    players: {
      ...s.players,
      p2: {
        ...s.players.p2!,
        scientists: [{ id: scientist, level: 1 }],
        resources: { ...RICH },
        technologies: { completed: ['guidance_arrays'] },
      },
    },
  });
}

const only = (actions: Action[], type: string): Action[] => actions.filter((a) => a.type === type);
const orders = (s: GameState): Action[] => aiOrders(s, 'p2', 'expand', 'strong');
const home = (s: GameState): Planet =>
  Object.values(s.planets).find(
    (p) => p.owner === 'p2' && p.buildings.some((b) => b.type === 'shipyard'),
  )!;
const dist = (a: Planet, b: Planet): number =>
  Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);

function withPort(s: GameState): GameState {
  const base = home(s);
  base.buildings = [
    ...base.buildings,
    { type: 'spaceport', level: 1, hp: data.buildings.spaceport!.hp },
  ];
  return s;
}

const REACH = data.units.cruise_missile!.stats.strikeRange!;
const WARHEAD = data.units.cruise_missile!.warhead!.damage;

/**
 * Дом p2 с портом и ракетами в ангаре; флот p1 стоит на ближнем мире в дальности ракеты
 * (`far` — за дальностью). Свои флоты p2 убраны: у порта с трюмом они забирали бы эскадру
 * погрузкой, а эскадра за тик получает один приказ.
 */
function armed(
  o: { hangar?: Squadron[]; far?: boolean; war?: boolean; foe?: { unit: string; count: number }[] } = {},
): { s: GameState; foeId: string } {
  const s = withPort(game2('ordnance_savant', o.war ?? true));
  const base = home(s);
  base.hangar = o.hangar ?? [{ id: 'sq:m', units: [{ unit: 'cruise_missile', count: 12 }] }];
  for (const f of Object.values(s.fleets)) if (f.owner === 'p2') delete s.fleets[f.id];
  const spots = Object.values(s.planets)
    .filter((p) => p.id !== base.id && p.owner === null)
    .sort((a, b) => dist(a, base) - dist(b, base));
  const spot = o.far
    ? spots.find((p) => dist(p, base) > REACH)!
    : spots.find((p) => dist(p, base) <= REACH)!;
  const foe = Object.values(s.fleets).find((f) => f.owner === 'p1')!;
  foe.location = spot.id;
  foe.movement = null;
  foe.units = o.foe ?? [{ unit: 'cruiser', count: 2 }];
  // Мир под флотом виден боту: разведка здесь не проверяется.
  spot.owner = 'p2';
  spot.garrison = [];
  return { s, foeId: foe.id };
}

const launches = (s: GameState): Action[] => only(orders(s), 'missile.launch');
const hullOf = (units: { unit: string; count: number }[]): number =>
  units.reduce((n, st) => n + st.count * data.units[st.unit]!.stats.hp, 0);

describe('ракетная доктрина строит ракеты', () => {
  it('на войне ракетная доктрина заказывает крылатую ракету', () => {
    const built = only(orders(withPort(game2())), 'unit.build').map(
      (a) => (a.payload as { unit: string }).unit,
    );
    expect(built).toContain('cruise_missile');
  });

  it('в мирное время ракет не строит — бить некого', () => {
    const built = only(orders(withPort(game2('ordnance_savant', false))), 'unit.build').map(
      (a) => (a.payload as { unit: string }).unit,
    );
    expect(built).not.toContain('cruise_missile');
  });

  it('другая доктрина ракет не строит', () => {
    const built = only(orders(withPort(game2('void_admiral'))), 'unit.build').map(
      (a) => (a.payload as { unit: string }).unit,
    );
    expect(built).not.toContain('cruise_missile');
  });
});

describe('бот пускает ракеты', () => {
  it('флот врага в дальности — залп по корпусу цели и одна сверху, ядро его принимает', () => {
    const { s, foeId } = armed();
    const out = launches(s);
    expect(out).toHaveLength(1);
    const p = out[0]!.payload as { targetFleetId: string; count: number };
    expect(p.targetFleetId).toBe(foeId);
    const need = Math.ceil(hullOf([{ unit: 'cruiser', count: 2 }]) / WARHEAD) + 1;
    expect(p.count).toBe(Math.min(12, need));
    const r = kernel.applyAction(s, out[0]!, ctx(s.time));
    expect(r.ok, r.ok ? '' : r.code).toBe(true);
  });

  it('ракеты уже летят в цель — следующий ход залпа нет', () => {
    const { s } = armed({ foe: [{ unit: 'scout', count: 1 }] });
    const first = launches(s)[0]!;
    const r = kernel.applyAction(s, first, ctx(s.time));
    if (!r.ok) throw new Error(r.code);
    expect(launches(r.state)).toEqual([]);
  });

  it('флот за дальностью ракеты — пуска нет', () => {
    expect(launches(armed({ far: true }).s)).toEqual([]);
  });

  it('в мирное время пуска нет', () => {
    expect(launches(armed({ war: false }).s)).toEqual([]);
  });

  it('эскадра челноков ракетой не считается', () => {
    expect(
      launches(armed({ hangar: [{ id: 'sq:b', units: [{ unit: 'bomber', count: 2 }] }] }).s),
    ).toEqual([]);
  });
});
