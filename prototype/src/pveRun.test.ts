import { describe, it, expect, afterEach } from 'vitest';

import {
  advance,
  order,
  setMatchMode,
  setMatchTravelSpeed,
  moveFleet,
  orbitFleet,
  assaultFleet,
  mergeFleet,
  buildBuilding,
  buildUnit,
} from './game';
import { data } from './gameData';
import { initSoloDrivers } from './soloDrivers';
import { pveState, pveModeId } from '../../packages/client/src/gameData';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import { runAiSeats } from '../../decisions/runAiSeats';
import { pirateEncounter } from '../../decisions/pirateEncounter';
import { sensorCoverage, playablePlayerIds } from '../../packages/shared-core/src/index';
import { RUN_SPINE_HOURS, RUN_TAIL_HOURS, RUN_TRAVEL_SPEED } from '../../decisions/runTempo';
import { freshSectorZeroProgress, prepareSectorZeroRun } from '../../decisions/sectorZeroProgress';
import type { RunDifficulty } from '../../decisions/runDifficulty';

/**
 * PVR-1.6 — сквозной прогон ЗАБЕГА на шипнутой карте `pve-1`, через настоящие функции
 * хоста: `advance`/`order` плюс те же `soloDrivers`, что гоняет кадр прототипа. Копии
 * их политики здесь нет намеренно — подделаны только пути приказов.
 *
 * Зачем такой тест вообще. Модульные тесты волн были зелёными всё время, пока забег
 * был непроходим: волны исправно создавались и стояли в улье (PVR-1.5), состав был
 * слабее стартового флота игрока (PVR-1.3), матч кончался чужой победой по
 * доминированию на 30-м часу, а защищённый дом игрока нельзя было взять вовсе.
 * Каждая из этих поломок жила МЕЖДУ модулями — между картой, режимом, дипломатией,
 * победой и клиентскими драйверами, — и ловится только прогоном целиком.
 *
 * Игрок здесь ПАССИВЕН: ни одного своего приказа, авто-штурм не включён. Это нижняя
 * граница — «что карта делает сама». Она обязана кончаться вердиктом.
 */

const HOUR = 3_600_000;

/** Правила ЗАБЕГА — те же, что ставит хост (`installMatch` + `setRunActive`): режим карты и
 *  темп перемещения ×5 (PVR-2.3). Без второго прогон мерил бы не ту игру, в которую играют. */
function armRun(): void {
  setMatchMode(pveModeId());
  setMatchTravelSpeed(RUN_TRAVEL_SPEED);
}
function disarmRun(): void {
  setMatchMode(undefined);
  setMatchTravelSpeed(1);
}

interface RunOut {
  state: GameState;
  endedAtHour?: number;
  groundBattleAtHome?: number;
  /** Кем кончились наземные бои у дома, по порядку (`null` — боем без победителя). */
  groundOutcomes: Array<string | null>;
  /** Сколько раундов шёл каждый наземный бой у дома, по порядку. */
  groundRounds: number[];
}

function runIdlePlayer(maxHours: number): RunOut {
  armRun();
  let s: GameState = pveState(data);
  let groundBattleAtHome: number | undefined;
  const groundOutcomes: Array<string | null> = [];
  const groundRounds: number[] = [];
  let hour = 0;
  const scan = (events: readonly { type: string; payload: unknown }[]): void => {
    for (const e of events) {
      const p = e.payload as { location?: string; phase?: string; winner?: string | null; rounds?: number };
      if (e.type === 'battle.resolved' && p.location === 'home_a' && p.phase === 'ground') {
        groundOutcomes.push(p.winner ?? null);
        groundRounds.push(p.rounds ?? 0);
      }
    }
  };

  const apply = (a: Action): void => {
    const out = order(s, a, s.time);
    if (!out.error) {
      s = out.state;
      for (const e of out.events) {
        if (
          groundBattleAtHome === undefined &&
          e.type === 'battle.started' &&
          (e.payload as { location?: string; phase?: string }).location === 'home_a' &&
          (e.payload as { phase?: string }).phase === 'ground'
        ) {
          groundBattleAtHome = hour;
        }
      }
    }
  };

  const drivers = initSoloDrivers({
    state: () => s,
    me: () => 'p1',
    aiSeats: () => runAiSeats(s, 'p1', 'weak'),
    applyLocal: apply,
    playerOrder: apply,
    autoAssault: () => false, // игрок пассивен: свой флот сам не штурмует
    patrols: () => new Map(),
    known: () => true,
  });

  for (hour = 1; hour <= maxHours; hour++) {
    const step = advance(s, hour * HOUR);
    s = step.state;
    scan(step.events);
    if (s.match.status === 'ended') {
      return { state: s, endedAtHour: hour, groundBattleAtHome, groundOutcomes, groundRounds };
    }
    drivers.runAI();
    drivers.autoEngage();
    drivers.checkFleetClashes();
  }
  return { state: s, groundBattleAtHome, groundOutcomes, groundRounds };
}

describe('забег на карте pve-1 доходит до вердикта (PVR-1.6)', () => {
  // Режим принадлежит МАТЧУ: следующий не должен унаследовать чужой.
  afterEach(disarmRun);

  it('пассивный игрок ПРОИГРЫВАЕТ забег — и именно по-PvE-шному', () => {
    const { state, endedAtHour } = runIdlePlayer(400);
    expect({ ended: state.match.status, reason: state.match.reason }).toEqual({
      ended: 'ended',
      reason: 'pve-failed',
    });
    expect(state.match.winner).toBe('p3');
    // Верхняя граница, а не точное число: она ловит «забег не кончается никогда»,
    // не ломаясь от любой правки баланса. Замер на темпе ×5 с крепким стартом — 35-й час.
    expect(endedAtHour).toBeLessThan(300);
  });

  it('крепкий старт держит дом: первый штурм — не один раунд, пассивный держится дольше (PVR-2.4)', () => {
    // После ×5 дом пассивного игрока брали ПЕРВЫМ же десантом за один раунд (30-й час).
    // Владелец выбрал рычаг «крепче старт игрока»: форт, тяжёлая пехота и стража дома.
    //
    // Замер на кирпиче показывал «первый штурм отбит, дом падает на втором (35-й час)», но
    // «отбит» был артефактом бага (плейтест 2026-09-24): флот, вступивший в идущий
    // наземный бой, не помечался «в бою», ИИ уводил его, и сторона считалась погибшей —
    // бой обрывался. С честным боем первый штурм — СОВМЕСТНЫЙ, волн 2, 3 и 5; дом держит
    // его четыре раунда и падает на 34-м часу. Держит тест именно то, что даёт рычаг: бой
    // за дом длится больше раунда, и пассивный держится дольше прежних 30 часов.
    const { groundRounds, endedAtHour } = runIdlePlayer(400);
    expect(groundRounds[0]).toBeGreaterThanOrEqual(2);
    expect(endedAtHour).toBeGreaterThanOrEqual(33);
  });

  it('штурм доходит до дома игрока и высаживается — а не стоит на орбите', () => {
    // Раньше волна могла взять только ПУСТОЙ сектор (приходом). Дом с гарнизоном
    // требует второй фазы, и без десанта флот копился на орбите вечно.
    const { groundBattleAtHome } = runIdlePlayer(400);
    expect(groundBattleAtHome).toBeDefined();
    // И доходит, ПОКА ВОЛНЫ ЕЩЁ ИДУТ (PVR-2.3). На ×1 Рой шёл до дома так долго, что
    // первый штурм начинался уже после последней волны — на 64-м часу при хребте в 60.
    // Ради этого темп и ускорен; замер — 31-й час.
    expect(groundBattleAtHome!).toBeLessThan(RUN_SPINE_HOURS);
  });

  it('волны идут по расписанию до самого вердикта, а не глохнут на первой', () => {
    // На темпе забега ×5 (PVR-2.3) Рой доходит до дома впятеро быстрее, и пассивный игрок
    // падает раньше десятой волны: замер — 35-й час, пятая волна. Поэтому
    // сторож держит не «десять волн», а то, ради чего стоит: ни одна волна, чей срок
    // наступил до вердикта, не пропала.
    const { state, endedAtHour } = runIdlePlayer(400);
    const interval = data.modes[pveModeId()!]!.pve!.waveIntervalHours;
    expect(state.pve!.waveNumber).toBeGreaterThan(1);
    expect(state.pve!.waveNumber).toBeGreaterThanOrEqual(Math.floor((endedAtHour! - 1) / interval));
  });
});

describe('pirates teach the first fight on the actual PvE map', () => {
  afterEach(disarmRun);

  it('starts visible, nearby and outside the player roster', () => {
    const state = pveState(data);
    expect(sensorCoverage(state, 'p1', data).identify.has('pirate_den')).toBe(true);
    expect(state.planets.pirate_den!.links).toEqual(['home_a']);
    expect(playablePlayerIds(state).sort()).toEqual(['p1', 'p3']);
  });

  it('the opening fleet wins a real multi-round battle and the run continues', () => {
    armRun();
    let state = advance(pveState(data), 1).state;
    expect(pirateEncounter(state, 'p1')?.stage).toBe('approach');
    const moved = order(state, moveFleet('p1', 'p1_1', 'pirate_den'), state.time);
    expect(moved.error).toBeUndefined();
    state = moved.state;
    // A teaching encounter must arrive before the first Swarm wave, even with
    // the slow starting scout attached. Four game-hours = 96 seconds at ×150.
    expect(state.fleets.p1_1!.movement!.arrivesAt - state.time).toBeLessThan(4 * HOUR);
    expect(pirateEncounter(state, 'p1')?.stage).toBe('travel');
    const stages = new Set<string>();
    let rounds = 0;
    let victor: string | null = null;
    for (let hour = 1; hour <= 40; hour++) {
      const next = advance(state, hour * HOUR);
      state = next.state;
      for (const e of next.events) {
        if (e.type !== 'battle.resolved') continue;
        const p = e.payload as { location: string; winner: string; rounds: number };
        if (p.location === 'pirate_den') { rounds = p.rounds; victor = p.winner; }
      }
      const encounter = pirateEncounter(state, 'p1');
      if (encounter) stages.add(encounter.stage);
      for (const b of Object.values(state.battles)) {
        if (b.location === 'pirate_den') rounds = Math.max(rounds, b.round);
      }
      if (encounter?.stage === 'occupy') {
        // The player explicitly gives the second order; victory in space does not
        // silently capture a hostile base. The landing squad comes from map data.
        for (const action of [orbitFleet('p1', 'p1_1', 'near'), assaultFleet('p1', 'p1_1')]) {
          const out = order(state, action, state.time);
          expect(out.error).toBeUndefined();
          state = out.state;
        }
      }
      if (pirateEncounter(state, 'p1')?.stage === 'won') break;
    }
    expect(stages).toContain('battle');
    expect(stages).toContain('occupy');
    expect(rounds).toBeGreaterThanOrEqual(2);
    expect(victor).toBe('p1');
    expect(pirateEncounter(state, 'p1')?.stage).toBe('won');
    expect(state.fleets.p1_1?.units.some((u) => u.count > 0)).toBe(true);
    expect(state.fleets.p1_1?.units.find((u) => u.unit === 'cruiser')?.count).toBe(2);
    expect(Object.values(state.fleets).some((f) => f.owner === 'pirates')).toBe(false);
    expect(state.pve?.waveNumber).toBe(0); // the first fight finishes before the first wave
    state = advance(state, 8 * HOUR).state;
    expect(state.pve?.waveNumber).toBeGreaterThan(0);
    expect(state.pve?.boons?.pirates).toBeUndefined();
    expect(state.match.status).toBe('ongoing');
    expect(pirateEncounter(JSON.parse(JSON.stringify(state)), 'p1')?.stage).toBe('won');
  });

  it('skipping pirates neither blocks a PvE win nor saves a defeated human', () => {
    armRun();
    const start = advance(pveState(data), 1).state;
    const won = structuredClone(start);
    won.pve!.waveNumber = won.pve!.totalWaves;
    won.planets.hive!.owner = 'p1';
    expect(advance(won, HOUR).state.match).toMatchObject({ reason: 'pve-cleared', winner: 'p1' });
    const lost = structuredClone(start);
    lost.planets.home_a!.owner = 'p3';
    expect(advance(lost, HOUR).state.match).toMatchObject({ reason: 'pve-failed', winner: 'p3' });
  });

});

/**
 * PVR-2.5 — «победа — выстоять» (решение владельца 2026-09-23). Главный сторож кирпича:
 * первую главу МОЖНО пройти, и проходит её не зачистка, а оборона.
 *
 * До кирпича её не проходила ни одна из 16 стратегий: вердикт требовал взять ВСЕ миры
 * Роя после десятой волны, а волны бесплатные, растут ×N и рождаются в улье — к 60-му часу
 * там стояли ~55 маток и ~100 фрегатов. Теперь забег засчитан, если игрок держит мир
 * `holdHours` после последней волны.
 *
 * Игрок здесь — НОВИЧОК на настоящем старте забега (`prepareSectorZeroRun` со свежим
 * профилем: флагман с героем, прокачки нет) и с самой простой обороной, какую можно
 * придумать: все флоты в один у дома, казарма и непрерывный найм пехоты. Если такой
 * игрок перестанет проходить главу — это сдвиг баланса, который обязан заметить человек.
 */
describe('первую главу проходит оборона (PVR-2.5)', () => {
  afterEach(disarmRun);

  function defend(difficulty: RunDifficulty): { state: GameState; endedAtHour?: number } {
    armRun();
    let s: GameState = prepareSectorZeroRun(pveState(data), freshSectorZeroProgress(data), data);
    const home = 'home_a';
    const apply = (a: Action): void => {
      const out = order(s, a, s.time);
      if (!out.error) s = out.state;
    };
    const drivers = initSoloDrivers({
      state: () => s,
      me: () => 'p1',
      aiSeats: () => runAiSeats(s, 'p1', difficulty),
      applyLocal: apply,
      playerOrder: apply,
      autoAssault: () => false,
      patrols: () => new Map(),
      known: () => true,
    });
    for (const f of Object.values(s.fleets)) {
      if (f.owner === 'p1' && f.id !== 'sector-zero:flagship') apply(mergeFleet('p1', f.id, 'sector-zero:flagship'));
    }
    apply(buildBuilding('p1', home, 'barracks'));
    for (let hour = 1; hour <= 200; hour++) {
      s = advance(s, hour * HOUR).state;
      if (s.match.status === 'ended') return { state: s, endedAtHour: hour };
      const r = s.players.p1!.resources;
      if ((r.metal ?? 0) >= 55 && (r.credits ?? 0) >= 15) apply(buildUnit('p1', home, 'heavy_infantry', 1));
      else if ((r.metal ?? 0) >= 15) apply(buildUnit('p1', home, 'militia', 1));
      drivers.runAI();
      drivers.autoEngage();
      drivers.checkFleetClashes();
    }
    return { state: s };
  }

  it('против обычного Роя: забег засчитан удержанием, улей стоит', () => {
    const { state, endedAtHour } = defend('weak');
    expect({ reason: state.match.reason, winner: state.match.winner }).toEqual({
      reason: 'pve-cleared',
      winner: 'p1',
    });
    // Вердикт ровно в срок: хребет волн плюс удержание — ни раньше, ни позже.
    expect(state.match.endedAt).toBe((RUN_SPINE_HOURS + RUN_TAIL_HOURS) * HOUR);
    expect(endedAtHour).toBe(RUN_SPINE_HOURS + RUN_TAIL_HOURS);
    // Прошла именно ОБОРОНА: улей так и остался за Роем.
    expect(state.planets.hive?.owner).toBe('p3');
  });

  it('против сильного Роя забег доходит до вердикта — простой обороне он не обещан', () => {
    // Решение владельца 2026-09-24: с тех пор как построенное Роем уходит с волной,
    // сильный Рой вправе сломать простую оборону — против него нужна активная игра.
    // Обещание «простая оборона проходит главу I» держит только обычный Рой (выше).
    const { state, endedAtHour } = defend('strong');
    expect(['pve-cleared', 'pve-failed']).toContain(state.match.reason);
    expect(endedAtHour).toBeLessThanOrEqual(RUN_SPINE_HOURS + RUN_TAIL_HOURS);
  });
});

