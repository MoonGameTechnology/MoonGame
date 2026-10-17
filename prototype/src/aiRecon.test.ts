// Бот и правило «разведчик не захватывает» (решение владельца 2026-10-16, PR #1689).
//
// Что здесь закрепляется. Ядро перестало отдавать пустой мир флоту из одних разведчиков
// (`E_RECON_NO_CAPTURE`), а бот об этом не знал: слал такой флот к ближайшей пустой
// провинции и оттуда каждые два часа отдавал отбиваемый штурм. Замер на дуэли: 117
// отказов за матч, и треть своего времени разведчики стояли на чужих мирах. Теперь
// разведчик без десанта едет домой, дома берёт ополченца (трюм разведчика — один боец),
// и с ним пустой мир берётся штурмом, как и разрешает правило.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES, SECTOR_TYPES } from './game';
import { data } from './gameData';
import type { Action, GameState } from '../../packages/shared-core/src/index';

function game2(): GameState {
  return newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
}

/** Домашний мир места — тот, где стоит ВЕРФЬ (тем же признаком его ищет бот). */
const homeOf = (s: GameState, seat: string): string =>
  Object.values(s.planets).find(
    (p) => p.owner === seat && p.buildings.some((b) => data.buildings[b.type]?.enablesShipConstruction),
  )!.id;

/** Ничья захватываемая провинция без гарнизона — то, что разведчик брал прилётом. */
const emptyProvince = (s: GameState): string =>
  Object.values(s.planets).find(
    (p) =>
      p.owner === null &&
      SECTOR_TYPES[p.kind ?? '']?.capturable === true &&
      !p.garrison.some((st) => st.count > 0),
  )!.id;

function fleetAt(
  location: string,
  units: Array<{ unit: string; count: number }>,
  landing: Array<{ unit: string; count: number }> = [],
): GameState['fleets'][string] {
  return { id: 'f:r', owner: 'p2', location, units, landing, traits: [], movement: null, orbit: 'near' };
}

/** Флот-фикстура ОДИН: стартовый флот дома иначе слил бы разведчика в себя. */
const withFleet = (s: GameState, f: GameState['fleets'][string]): GameState => ({
  ...s,
  fleets: { [f.id]: f },
});
const ordersFor = (s: GameState, type: string): Action[] =>
  aiOrders(s, 'p2', 'expand', 'strong').filter(
    (a) => a.type === type && (a.payload as { fleetId?: string }).fleetId === 'f:r',
  );

describe('бот знает, что разведчик без десанта мир не берёт', () => {
  it('на пустой провинции не штурмует, а летит домой', () => {
    const s = game2();
    const st = withFleet(s, fleetAt(emptyProvince(s), [{ unit: 'scout', count: 2 }]));
    expect(ordersFor(st, 'fleet.assault')).toHaveLength(0);
    const moves = ordersFor(st, 'fleet.move');
    expect(moves).toHaveLength(1);
    expect((moves[0]!.payload as { to: string }).to).toBe(homeOf(s, 'p2'));
  });

  it('с ополченцем на борту пустую провинцию штурмует', () => {
    const s = game2();
    const st = withFleet(
      s,
      fleetAt(emptyProvince(s), [{ unit: 'scout', count: 1 }], [{ unit: 'militia', count: 1 }]),
    );
    expect(ordersFor(st, 'fleet.assault')).toHaveLength(1);
  });

  it('дома, без войны и без ничьих гарнизонов, берёт ополченца в трюм', () => {
    // Остальной флот грузится дома только под атаку или под ничий гарнизон (правило
    // владельца №5); разведчику без бойца брать нечего вовсе, поэтому он грузится всегда.
    const s = game2();
    const home = homeOf(s, 'p2');
    const planets = Object.fromEntries(
      Object.entries(s.planets).map(([id, p]) => [id, p.owner === null ? { ...p, garrison: [] } : p]),
    );
    const staged: GameState = {
      ...s,
      planets: { ...planets, [home]: { ...s.planets[home]!, garrison: [{ unit: 'militia', count: 9 }] } },
    };
    const loads = ordersFor(withFleet(staged, fleetAt(home, [{ unit: 'scout', count: 1 }])), 'army.load');
    expect(loads.map((a) => a.payload)).toEqual([{ fleetId: 'f:r', unit: 'militia', count: 1 }]);
  });

  it('один боевой корабль в отряде делает флот обычным — пустой мир он занимает', () => {
    const s = game2();
    const st = withFleet(
      s,
      fleetAt(emptyProvince(s), [
        { unit: 'scout', count: 2 },
        { unit: 'cruiser', count: 1 },
      ]),
    );
    expect(ordersFor(st, 'fleet.assault')).toHaveLength(1);
  });
});
