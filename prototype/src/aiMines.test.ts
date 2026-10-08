// Ракетные мины у бота (решение владельца 2026-10-08).
//
// Что здесь закрепляется. После BAL-6 урон ракетной ветки техов (`damageScope: missile`)
// идёт только ракетным минам, а бот мин не ставил вовсе: минёр — самый дорогой модуль
// отсека героя, и правило «дешёвое вперёд» не отдавало его никому. Теперь один герой места
// везёт минёра, а мину он ставит там, где и так едет: на дороге между своим миром и миром
// противника, с которым война. Остановка и установка — одним тиком, следующим тиком носитель
// едет дальше.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES, kernel, ctx } from './game';
import { data } from './gameData';
import type { Action, GameState, Hero } from '../../packages/shared-core/src/index';
import { moveFleet } from '../../decisions/actions';

const MINER = 'rocket_mine_layer';
const RICH = { credits: 4000, metal: 6000, food: 900, energy: 900, microelectronics: 400 };

function game2(): GameState {
  const s = newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
  return { ...s, players: { ...s.players, p2: { ...s.players.p2!, resources: { ...RICH } } } };
}

const orders = (s: GameState): Action[] => aiOrders(s, 'p2', 'expand', 'strong');
const only = (actions: Action[], type: string): Action[] => actions.filter((a) => a.type === type);
const mainHero = (s: GameState): Hero =>
  Object.values(s.heroes ?? {}).find((x) => x.owner === 'p2' && x.alive === true)!;

function apply(s: GameState, a: Action): GameState {
  const r = kernel.applyAction(s, a, ctx(s.time));
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
function advance(s: GameState, to: number): GameState {
  const r = kernel.advanceTo(s, ctx(to));
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

/** Флот главного героя p2 с минёром на борту идёт по дороге от своего мира к миру p1 и
 *  стоит на её середине. `war` — воюют ли места к этой минуте (в мир соседа, с которым мир,
 *  флот не въезжает, поэтому в путь он выходит в войну, а мир заключается в дороге). */
function minerOnFrontLane(war: boolean): { s: GameState; fleetId: string; to: string } {
  let s = structuredClone(game2());
  const fleetId = mainHero(s).fleetId!;
  const fleet = s.fleets[fleetId]!;
  const home = fleet.location!;
  const to = s.planets[home]!.links!.find((id) => s.planets[id]?.owner === null)!;
  s.planets[to] = { ...s.planets[to]!, owner: 'p1', garrison: [] };
  fleet.units = fleet.units.map((st) =>
    st.unit === 'hero' ? { ...st, modules: [...(st.modules ?? []), MINER] } : st,
  );
  s.diplomacy = { ...(s.diplomacy ?? {}), 'p1|p2': 'war' };
  s = apply(s, moveFleet('p2', fleetId, to));
  const mv = s.fleets[fleetId]!.movement!;
  s = advance(s, Math.round((mv.departedAt + mv.arrivesAt) / 2));
  if (!war) s = { ...s, diplomacy: { ...s.diplomacy, 'p1|p2': 'peace' } };
  return { s, fleetId, to };
}

describe('минёр в отсеке героя', () => {
  it('пока минёра не везёт никто, спящий герой получает его, а не самое дешёвое', () => {
    const s = game2();
    const installs = only(orders(s), 'hero.install').map(
      (a) => (a.payload as { moduleId: string }).moduleId,
    );
    expect(installs).toEqual([MINER]);
  });

  it('минёр уже есть у одного героя — второй получает прежнее «дешёвое вперёд»', () => {
    const s = game2();
    const first = only(orders(s), 'hero.install')[0]!.payload as { heroId: string };
    const staged: GameState = {
      ...s,
      heroes: { ...s.heroes, [first.heroId]: { ...s.heroes![first.heroId]!, modules: [MINER] } },
    };
    const next = only(orders(staged), 'hero.install').map(
      (a) => (a.payload as { moduleId: string }).moduleId,
    );
    expect(next).toHaveLength(1);
    expect(data.modules[next[0]!]?.rocketMine).toBeUndefined();
  });
});

describe('мина на дороге к противнику', () => {
  it('посреди дороги к миру противника — остановка и мина одним тиком, ядро их принимает', () => {
    const { s, fleetId } = minerOnFrontLane(true);
    const acts = orders(s);
    const pair = acts.filter(
      (a) =>
        (a.type === 'fleet.stop' || a.type === 'fleet.deployRocketMine') &&
        (a.payload as { fleetId: string }).fleetId === fleetId,
    );
    expect(pair.map((a) => a.type)).toEqual(['fleet.stop', 'fleet.deployRocketMine']);
    expect((pair[1]!.payload as { mode: string }).mode).toBe('confirmed');
    // Ни один другой приказ этого тика не трогает носитель.
    const others = acts.filter(
      (a) => !pair.includes(a) && (a.payload as { fleetId?: string })?.fleetId === fleetId,
    );
    expect(others).toEqual([]);
    let next = s;
    for (const a of pair) next = apply(next, a);
    expect(next.ordnance?.installations.some((m) => m.fleetId === fleetId)).toBe(true);
  });

  it('мира нет войны — мины нет', () => {
    const { s } = minerOnFrontLane(false);
    expect(only(orders(s), 'fleet.deployRocketMine')).toEqual([]);
    expect(only(orders(s), 'fleet.stop')).toEqual([]);
  });

  it('кулдаун установки идёт — бот не останавливается зря', () => {
    const { s } = minerOnFrontLane(true);
    const cooling: GameState = {
      ...s,
      ordnance: {
        ...(s.ordnance ?? { installations: [], cooldowns: {}, serials: {} }),
        cooldowns: { p2: s.time + 3_600_000 },
      } as GameState['ordnance'],
    };
    expect(only(orders(cooling), 'fleet.stop')).toEqual([]);
  });

  it('мина взведена — носитель едет дальше, а не стоит посреди дороги', () => {
    const { s, fleetId, to } = minerOnFrontLane(true);
    let next = s;
    for (const a of orders(s).filter(
      (a) => a.type === 'fleet.stop' || a.type === 'fleet.deployRocketMine',
    ))
      next = apply(next, a);
    const armedAt = next.ordnance!.installations[0]!.readyAt;
    next = advance(next, armedAt + 60_000);
    expect(next.ordnance?.installations ?? []).toEqual([]);
    const resume = orders(next).filter(
      (a) => a.type === 'fleet.move' && (a.payload as { fleetId: string }).fleetId === fleetId,
    );
    expect(resume.map((a) => (a.payload as { to: string }).to)).toEqual([to]);
  });
});
