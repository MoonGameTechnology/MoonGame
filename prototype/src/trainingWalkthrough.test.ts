import { describe, it, expect, afterEach } from 'vitest';

import { advance, order, setMatchMode } from './game';
import {
  RAID,
  RAID_IDLE,
  STAGED_FORCES,
  TRAINING_ENEMY,
  trainingVerdict,
  withForce,
  withVerdict,
  type ScenarioForce,
} from '../../decisions/trainingScenario';
import { data } from './gameData';
import { trainingModeId, trainingState } from '../../packages/client/src/gameData';
import { freshSectorZeroProgress, prepareSectorZeroRun } from '../../decisions/sectorZeroProgress';
import { trainingFlagshipMerge } from '../../decisions/trainingGuide';
import {
  fleetGone,
  fortified,
  garrisoned,
  hullMending,
  inOrbit,
  owns,
  productionGrew,
  shipBuilt,
  squadronHome,
  techDone,
  trainingBaseline,
} from '../../decisions/trainingStages';
import { hullFraction, type GameState } from '../../packages/shared-core/src/index';
import { dockHullRate } from '../../packages/shared-core/src/util/repair';

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
  const r = order(
    s,
    { id: `w:${ME}:${++seq}`, type, playerId: ME, payload, issuedAt: s.time },
    s.time,
  );
  expect({ type, error: r.error }).toEqual({ type, error: undefined });
  return r.state;
}
const wait = (s: GameState, hours: number): GameState => advance(s, s.time + hours * HOUR).state;
/** Ждать, пока условие не станет правдой (не дольше `limit` игровых часов). */
function until(s: GameState, ok: (s: GameState) => boolean, limit = 48, quantum = 1): GameState {
  let cur = s;
  for (let h = 0; h < limit && !ok(cur); h += quantum) cur = wait(cur, quantum);
  return cur;
}
/** Ввести соединение сценария (TRN-3) — так, как это делает игра на входе в этап. */
const introduce = (s: GameState, force: ScenarioForce): GameState => withForce(s, force);
const heroOf = (s: GameState) => Object.values(s.heroes ?? {}).find((h) => h.owner === ME)!;
/** Ударный флот героя. Вернувшись туда, где стоит свой флот, он вливается в него
 *  (`autoMerge`), и герой едет вместе с кораблями — его `fleetId` и есть ударный флот. */
const main = (s: GameState): string => heroOf(s)?.fleetId ?? 'p1_1';

describe('учебный полигон: все двенадцать этапов проходимы', () => {
  afterEach(() => setMatchMode(undefined));

  it('от подготовки до взятия планеты-цели', () => {
    setMatchMode(trainingModeId());
    let s = advance(
      prepareSectorZeroRun(trainingState(data), freshSectorZeroProgress(data), data),
      1,
    ).state;
    const merge = trainingFlagshipMerge(s, ME)!;
    s = act(s, 'fleet.merge', merge);
    const base = trainingBaseline(s, ME, data);

    // 1. Подготовка: герой экспедиции на месте.
    expect(heroOf(s).alive).toBe(true);

    // 2. База и экономика: улучшить добычу, заказать корабль, дождаться верфи.
    s = act(s, 'building.upgrade', { planetId: 'base', building: 'mine' });
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

    // 7. Космический бой и герой: патруль появляется на входе в этап (TRN-3) — разбить
    // его на открытом участке, применить способность.
    expect(s.fleets.p2_patrol).toBeUndefined();
    s = introduce(s, STAGED_FORCES.find((f) => f.id === 'p2_patrol')!);
    s = act(s, 'fleet.move', { fleetId: main(s), to: 'open_reach' });
    s = until(s, (x) => fleetGone(x, 'p2_patrol'));
    expect(fleetGone(s, 'p2_patrol')).toBe(true);
    const hero = heroOf(s);
    s = act(s, 'hero.ability', { heroId: hero.id, abilityId: hero.equipped![0] });

    // 8. Отход и восстановление: на входе в этап у цели встаёт охрана (TRN-3) — войти в
    // бой у планеты-цели, отступить, отремонтироваться.
    s = introduce(s, STAGED_FORCES.find((f) => f.id === 'p2_guard')!);
    s = act(s, 'fleet.move', { fleetId: main(s), to: 'target' });
    s = until(s, (x) => !!x.fleets[main(x)]?.battleId, 48, 0.01);
    s = act(s, 'fleet.retreat', { fleetId: main(s), to: 'open_reach' });
    s = until(
      s,
      (x) => x.fleets[main(x)]?.location === 'open_reach' && !x.fleets[main(x)]?.battleId,
    );
    s = act(s, 'fleet.move', { fleetId: main(s), to: 'base' });
    s = until(s, (x) => x.fleets[main(x)]?.location === 'base' && !x.fleets[main(x)]?.movement);
    // Ремонта за металл больше нет (заказ владельца 2026-11-01): у дока корпус чинится сам.
    // Подсказка шага называет темп верфи базы — 10% в час; разъедутся данные — упадёт здесь.
    expect(dockHullRate(s.planets.base!, data)).toBeCloseTo(0.1);
    const battered = hullFraction(s.fleets[main(s)]!, data);
    expect(battered).toBeLessThan(1); // отход стоил корпуса — чинить есть что
    s = until(s, (x) => hullMending(hullFraction(x.fleets[main(x)]!, data), battered), 2, 0.25);
    expect(hullMending(hullFraction(s.fleets[main(s)]!, data), battered)).toBe(true);

    // 9. Носитель и челноки: удар эскадры по посту, возвращение в ангар.
    const carrier = Object.values(s.fleets).find(
      (f) => f.owner === ME && (f.hangar ?? []).length > 0,
    )!;
    expect(carrier).toBeDefined();
    // С открытого участка до поста дальше радиуса удара (`E_OUT_OF_RANGE`) — это и есть
    // урок дальности: авианосец встаёт на дороге к посту, не заходя в его провинцию.
    s = act(s, 'fleet.move', {
      fleetId: carrier.id,
      toEdge: { from: 'open_reach', to: 'outpost', t: 0.45 },
    });
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
    s = act(s, 'army.load', { fleetId: main(s), unit: 'heavy_infantry', count: 2 });
    // Погрузка — заявка на час (CARGO-1): войска на борту, когда час прошёл; улетишь
    // раньше — погрузка отменится.
    s = until(s, (x) =>
      (x.fleets[main(x)]?.landing ?? []).some((u) => u.unit === 'heavy_infantry'),
    );
    s = act(s, 'fleet.move', { fleetId: main(s), to: 'outpost' });
    s = until(s, (x) => inOrbit(x, ME, 'outpost'));
    expect(inOrbit(s, ME, 'outpost')).toBe(true);
    if (!owns(s, ME, 'outpost')) {
      s = act(s, 'fleet.assault', { fleetId: main(s) });
      s = until(s, (x) => owns(x, ME, 'outpost'));
    }
    expect(owns(s, ME, 'outpost')).toBe(true);

    // 11. Закрепление: форт и орбитальная оборона, гарнизон на посту.
    s = act(s, 'building.construct', { planetId: 'outpost', building: 'fort' });
    s = act(s, 'building.construct', { planetId: 'outpost', building: 'orbital_aa' });
    s = until(s, (x) => fortified(x, ME, base));
    expect(fortified(s, ME, base)).toBe(true);
    expect(garrisoned(s, ME, 'outpost')).toBe(true);
    // Объявленная контратака (TRN-3): три фрегата с открытого участка идут на пост и
    // разбиваются о форт, ПКО и флот.
    s = introduce(s, RAID);
    const raid = order(
      s,
      { id: `w:p2:${++seq}`, type: 'fleet.move', playerId: TRAINING_ENEMY, payload: { fleetId: RAID.id, to: RAID.to }, issuedAt: s.time },
      s.time,
    );
    expect(raid.error).toBeUndefined();
    s = raid.state;
    const launched = { ...RAID_IDLE, announced: true, launched: true };
    s = until(s, (x) => fleetGone(x, RAID.id));
    expect(fleetGone(s, RAID.id)).toBe(true);
    expect(owns(s, ME, 'outpost')).toBe(true);
    // Взятые миры сами операцию не кончают: режим сценарный.
    expect(s.match.status).not.toBe('ended');

    // 12. Финал: собрать все крейсеры в один кулак, взять с поста десант и штурмовать
    // планету-цель (форт, батарея, фрегаты) — операция окончена победой.
    const rally = Object.values(s.fleets).filter(
      (f) => f.owner === ME && f.id !== main(s) && f.units.some((u) => u.unit === 'cruiser'),
    );
    // У цели форт и гарнизон крепче, чем был у поста: десант набирают в казармах базы.
    s = act(s, 'unit.build', { planetId: 'base', unit: 'heavy_infantry', count: 8 });
    s = act(s, 'fleet.move', { fleetId: main(s), to: 'base' });
    for (const f of rally)
      if (f.location !== 'base') s = act(s, 'fleet.move', { fleetId: f.id, to: 'base' });
    // Долетевшие к базе сливаются сами (`autoMerge`); вручную — только те, кто уже стоял там.
    s = until(
      s,
      (x) =>
        [main(x), ...rally.map((f) => f.id)].every(
          (id) => !x.fleets[id] || (x.fleets[id]!.location === 'base' && !x.fleets[id]!.movement),
        ) &&
        (x.planets.base?.garrison ?? []).some((g) => g.unit === 'heavy_infantry' && g.count >= 8),
    );
    for (const f of rally)
      if (s.fleets[f.id] && f.id !== main(s))
        s = act(s, 'fleet.merge', { from: f.id, into: main(s) });
    s = act(s, 'army.load', { fleetId: main(s), unit: 'heavy_infantry', count: 8 });
    s = until(s, (x) =>
      (x.fleets[main(x)]?.landing ?? []).some((u) => u.unit === 'heavy_infantry'),
    );
    s = act(s, 'fleet.move', { fleetId: main(s), to: 'target' });
    s = until(s, (x) => inOrbit(x, ME, 'target') || !x.fleets[main(x)]);
    if (!owns(s, ME, 'target')) {
      s = act(s, 'fleet.bombard', { fleetId: main(s), on: true });
      s = until(s, (x) => !x.planets.target!.buildings.some((b) => b.type === 'fort'), 6, 0.05);
      expect(s.planets.target!.buildings.some((b) => b.type === 'fort')).toBe(false);
      s = act(s, 'fleet.bombard', { fleetId: main(s), on: false });
      expect(s.planets.target!.garrison.some((u) => u.count > 0)).toBe(true);
      s = act(s, 'fleet.assault', { fleetId: main(s) });
      s = until(s, (x) => owns(x, ME, 'target'));
    }
    expect(owns(s, ME, 'target')).toBe(true);
    // Ни одного мира у противника — а ядро операцию не кончило: исход объявляет сценарий.
    expect(s.match.status).not.toBe('ended');
    const verdict = trainingVerdict(s, ME, launched);
    expect(verdict).toEqual({ winner: ME, reason: 'training-held' });
    s = withVerdict(s, verdict!);
    expect({ status: s.match.status, winner: s.match.winner }).toEqual({
      status: 'ended',
      winner: ME,
    });
  });
});
