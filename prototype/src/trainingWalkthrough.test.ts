import { describe, it, expect, afterEach } from 'vitest';

import { advance, order, setMatchMode } from './game';
import { data } from './gameData';
import { trainingModeId, trainingState } from '../../packages/client/src/gameData';
import { freshSectorZeroProgress, prepareSectorZeroRun } from '../../decisions/sectorZeroProgress';
import {
  fleetGone,
  fortified,
  garrisoned,
  inOrbit,
  owns,
  productionGrew,
  shipBuilt,
  squadronHome,
  techDone,
  trainingBaseline,
} from '../../decisions/trainingStages';
import type { GameState } from '../../packages/shared-core/src/index';

/**
 * СКВОЗНОЙ ПРОГОН УЧЕБНОГО ПОЛИГОНА (TRN-2): все двенадцать этапов §14.4 проходятся на
 * карте `training-1` настоящими приказами через ядро хоста, и после каждого срабатывает
 * его проверка из `decisions/trainingStages.ts`. Если этап на этой карте не проходим —
 * не хватает ресурсов, нет цели, приказ отбивается, — тест покажет, какой именно.
 */

const HOUR = 3_600_000;
const ME = 'p1';
let seq = 0;

function act(s: GameState, type: string, payload: unknown): GameState {
  const r = order(s, { id: `w:${ME}:${++seq}`, type, playerId: ME, payload, issuedAt: s.time }, s.time);
  expect({ type, error: r.error }).toEqual({ type, error: undefined });
  return r.state;
}
const wait = (s: GameState, hours: number): GameState => advance(s, s.time + hours * HOUR).state;
/** Ждать, пока условие не станет правдой (не дольше `limit` игровых часов). */
function until(s: GameState, ok: (s: GameState) => boolean, limit = 48): GameState {
  let cur = s;
  for (let h = 0; h < limit && !ok(cur); h++) cur = wait(cur, 1);
  return cur;
}
const heroOf = (s: GameState) => Object.values(s.heroes ?? {}).find((h) => h.owner === ME)!;

describe('учебный полигон: все двенадцать этапов проходимы', () => {
  afterEach(() => setMatchMode(undefined));

  it('от подготовки до взятия планеты-цели', () => {
    setMatchMode(trainingModeId());
    let s = advance(prepareSectorZeroRun(trainingState(data), freshSectorZeroProgress(data), data), 1).state;
    const base = trainingBaseline(s, ME, data);

    // 1. Подготовка: герой экспедиции на месте.
    expect(heroOf(s).alive).toBe(true);

    // 2. База и экономика: улучшить добычу, заказать корабль, дождаться верфи.
    s = act(s, 'building.construct', { planetId: 'base', building: 'mine' });
    s = until(s, (x) => productionGrew(x, ME, base, data));
    expect(productionGrew(s, ME, base, data)).toBe(true);
    s = act(s, 'unit.build', { planetId: 'base', unit: 'cruiser' });
    s = until(s, (x) => shipBuilt(x, ME, base));
    expect(shipBuilt(s, ME, base)).toBe(true);

    // 3. Исследование: сетка орбитальной обороны — без неё на этапе 11 батарею не поставить.
    s = act(s, 'technology.research', { technology: 'orbital_defense_grid' });
    s = until(s, (x) => techDone(x, ME, base));
    expect(techDone(s, ME, base)).toBe(true);

    // 4. Разведка и расширение: занять нейтральную планету.
    s = act(s, 'fleet.move', { fleetId: 'p1_2', to: 'neutral' });
    s = until(s, (x) => owns(x, ME, 'neutral'));
    expect(owns(s, ME, 'neutral')).toBe(true);

    // 5. Задания: учебный маяк на наблюдательной станции.
    s = act(s, 'fleet.move', { fleetId: 'p1_2', to: 'station' });
    s = until(s, (x) => owns(x, ME, 'station'));
    expect(owns(s, ME, 'station')).toBe(true);

    // 6. Управление флотом: отделить корабль и слить обратно.
    const before = new Set(Object.keys(s.fleets));
    s = act(s, 'fleet.split', { fleetId: 'p1_2', take: [{ unit: 'cruiser', count: 1 }] });
    const split = Object.keys(s.fleets).find((id) => !before.has(id))!;
    expect(split).toBeDefined();
    s = act(s, 'fleet.merge', { from: split, into: 'p1_2' });

    // 7. Космический бой и герой: разбить патруль на открытом участке, применить способность.
    s = act(s, 'fleet.move', { fleetId: 'p1_1', to: 'open_reach' });
    s = until(s, (x) => fleetGone(x, 'p2_patrol'));
    expect(fleetGone(s, 'p2_patrol')).toBe(true);
    const hero = heroOf(s);
    s = act(s, 'hero.ability', { heroId: hero.id, abilityId: hero.equipped![0] });

    // 8. Отход и восстановление: войти в бой у планеты-цели, отступить, отремонтироваться.
    s = act(s, 'fleet.move', { fleetId: 'p1_1', to: 'target' });
    s = until(s, (x) => !!x.fleets.p1_1?.battleId);
    s = act(s, 'fleet.retreat', { fleetId: 'p1_1', to: 'open_reach' });
    s = until(s, (x) => x.fleets.p1_1?.location === 'open_reach' && !x.fleets.p1_1?.battleId);
    s = act(s, 'fleet.move', { fleetId: 'p1_1', to: 'base' });
    s = until(s, (x) => x.fleets.p1_1?.location === 'base' && !x.fleets.p1_1?.movement);
    s = act(s, 'fleet.repair', { fleetId: 'p1_1' });

    // 9. Носитель и челноки: удар эскадры по посту, возвращение в ангар.
    const carrier = Object.values(s.fleets).find((f) => f.owner === ME && (f.hangar ?? []).length > 0)!;
    expect(carrier).toBeDefined();
    // С открытого участка до поста дальше радиуса удара (`E_OUT_OF_RANGE`) — это и есть
    // урок дальности: авианосец встаёт на дороге к посту, не заходя в его провинцию.
    s = act(s, 'fleet.move', { fleetId: carrier.id, toEdge: { from: 'open_reach', to: 'outpost', t: 0.45 } });
    s = until(s, (x) => !!x.fleets[carrier.id]?.edge && !x.fleets[carrier.id]?.movement);
    s = act(s, 'shuttle.strike', {
      fleetId: carrier.id,
      squadronId: s.fleets[carrier.id]!.hangar![0]!.id,
      targetPlanetId: 'outpost',
    });
    expect(squadronHome(s, ME)).toBe(false);
    s = until(s, (x) => squadronHome(x, ME));
    expect(squadronHome(s, ME)).toBe(true);

    // 10. Орбита и наземный штурм: погрузить армию, очистить орбиту поста, высадиться.
    s = act(s, 'army.load', { fleetId: 'p1_1', unit: 'heavy_infantry', count: 2 });
    s = act(s, 'army.load', { fleetId: 'p1_1', unit: 'militia', count: 3 });
    // Погрузка — заявка на час (CARGO-1): войска на борту, когда час прошёл; улетишь
    // раньше — погрузка отменится.
    s = until(s, (x) => (x.fleets.p1_1?.landing ?? []).some((u) => u.unit === 'heavy_infantry'));
    s = act(s, 'fleet.move', { fleetId: 'p1_1', to: 'outpost' });
    s = until(s, (x) => inOrbit(x, ME, 'outpost'));
    expect(inOrbit(s, ME, 'outpost')).toBe(true);
    if (!owns(s, ME, 'outpost')) {
      s = act(s, 'fleet.assault', { fleetId: 'p1_1' });
      s = until(s, (x) => owns(x, ME, 'outpost'));
    }
    expect(owns(s, ME, 'outpost')).toBe(true);

    // 11. Закрепление: форт и орбитальная оборона, гарнизон на посту.
    s = act(s, 'building.construct', { planetId: 'outpost', building: 'fort' });
    s = act(s, 'building.construct', { planetId: 'outpost', building: 'orbital_aa' });
    s = until(s, (x) => fortified(x, ME, base));
    expect(fortified(s, ME, base)).toBe(true);
    expect(garrisoned(s, ME, 'outpost')).toBe(true);

    // 12. Финал: собрать все крейсеры в один кулак, взять с поста десант и штурмовать
    // планету-цель (форт, батарея, два фрегата) — операция окончена победой.
    const rally = Object.values(s.fleets).filter(
      (f) => f.owner === ME && f.id !== 'p1_1' && f.units.some((u) => u.unit === 'cruiser'),
    );
    // У цели форт и гарнизон крепче, чем был у поста: десант набирают в казармах базы.
    s = act(s, 'unit.build', { planetId: 'base', unit: 'heavy_infantry', count: 8 });
    s = act(s, 'fleet.move', { fleetId: 'p1_1', to: 'base' });
    for (const f of rally) if (f.location !== 'base') s = act(s, 'fleet.move', { fleetId: f.id, to: 'base' });
    s = until(s, (x) =>
      ['p1_1', ...rally.map((f) => f.id)].every((id) => x.fleets[id]?.location === 'base' && !x.fleets[id]?.movement) &&
      (x.planets.base?.garrison ?? []).some((g) => g.unit === 'heavy_infantry' && g.count >= 8));
    for (const f of rally) s = act(s, 'fleet.merge', { from: f.id, into: 'p1_1' });
    s = act(s, 'army.load', { fleetId: 'p1_1', unit: 'heavy_infantry', count: 8 });
    s = until(s, (x) => (x.fleets.p1_1?.landing ?? []).some((u) => u.unit === 'heavy_infantry'));
    s = act(s, 'fleet.move', { fleetId: 'p1_1', to: 'target' });
    s = until(s, (x) => inOrbit(x, ME, 'target') || !x.fleets.p1_1);
    if (!owns(s, ME, 'target')) {
      s = act(s, 'fleet.assault', { fleetId: 'p1_1' });
      s = until(s, (x) => owns(x, ME, 'target') || x.match.status === 'ended');
    }
    expect({ status: s.match.status, winner: s.match.winner }).toEqual({ status: 'ended', winner: ME });
  });
});
