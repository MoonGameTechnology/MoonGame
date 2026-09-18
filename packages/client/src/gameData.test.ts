import { describe, it, expect } from 'vitest';

import { sumUnitStat } from '@void/shared-core';

import { shippedGameData } from '../../../data/bundle';
import { pveState, pveModeId, skirmishState } from './gameData';

/**
 * The client's doors into a playable state. Both were uncovered, and the PvE one was
 * shut: `pve-1.json` shipped four criss-crossing lanes, so `buildStateFromMap` threw
 * `E_INVALID_MAP` and the prototype's "🤖 PvE" button died without a word (PVR-0.1).
 * A door nobody opens in tests is a door that closes silently.
 */
const data = shippedGameData();

describe('pveState — the PvE door', () => {
  it('builds a state from the shipped PvE map', () => {
    const state = pveState(data);
    expect(Object.keys(state.planets).sort()).toEqual([
      'drift',
      'fork_low',
      'fork_mid',
      'fork_north',
      'hive',
      'home_a',
      'home_b',
      'ridge',
      'veil',
    ]);
    expect(state.planets.home_a!.owner).toBe('p1'); // the human seat
    expect(state.planets.hive!.owner).toBe('p3');
    expect(state.players.p3!.faction).toBe('swarm');
    expect(state.fleets.p1_1!.location).toBe('home_a');
  });

  it('seats exactly two sides: the player and the Swarm (PVR-1.6)', () => {
    // Карта возила ВТОРОЕ человеческое место `p2`, а `startPvEMatch()` сажает бота на
    // всё, кроме `p1` — то есть забег за игрока играл союзный бот: он занимал середину
    // к 30-му часу и принимал на себя весь штурм. Забег по решению владельца
    // ОДИНОЧНЫЙ (§0.1/§0.3), поэтому мест ровно два.
    const state = pveState(data);
    expect(Object.keys(state.players).sort()).toEqual(['p1', 'p3']);
    // `home_b` осталась на карте, но НИЧЬЯ: это компактная зона развития сбоку, за
    // которую игрок платит десантом, а не бесплатный второй дом.
    expect(state.planets.home_b!.owner).toBeNull();
    expect(state.planets.home_b!.garrison.length).toBeGreaterThan(0);
  });

  it('lays the sectors out as forks of lines, not a chain of provinces', () => {
    const state = pveState(data);
    // Owner's model: two provinces joined by ONE line, and from that line's middle
    // another line departs — reaching either a further line or another province.
    // `home_a — home_b` is that first line; `fork_north` is where it splits.
    expect(state.planets.fork_north!.links).toEqual(['fork_mid', 'home_a', 'home_b']);
    expect(state.planets.home_a!.links).toEqual(['fork_north']);
    expect(state.planets.home_b!.links).toEqual(['fork_north']);
    // The branch runs down and splits again at `fork_mid` into the two lanes, which
    // come back together at `fork_low` — so the Swarm still gets a CHOICE of route
    // and the player still has two lanes to defend (the shape PVR-0.1 aimed at).
    expect(state.planets.fork_mid!.links).toEqual(['drift', 'fork_north', 'veil']);
    expect(state.planets.fork_low!.links).toEqual(['drift', 'ridge', 'veil']);
    expect(state.planets.drift!.links).toEqual(['fork_low', 'fork_mid']);
    expect(state.planets.veil!.links).toEqual(['fork_low', 'fork_mid']);
    // the Swarm still has exactly one way out, and it is the storm the player can hold
    expect(state.planets.hive!.links).toEqual(['ridge']);
    expect(state.planets.ridge!.links).toEqual(['fork_low', 'hive']);
  });

  it('a fork is NOT a province: it cannot be owned, built on or scored', () => {
    // «Х даже и не должно быть» (владелец): развилка — точка схода линий, а не место.
    // Держим это данными: `kind: empty` в каталоге НЕ захватывается и НЕ застраивается,
    // поэтому ни игрок, ни бот не могут превратить развилку в территорию.
    const state = pveState(data);
    for (const id of ['fork_north', 'fork_mid', 'fork_low'] as const) {
      const kind = data.sectorKinds[state.planets[id]!.kind ?? ''];
      expect(kind?.capturable).toBe(false);
      expect(kind?.buildable).toBe(false);
      expect(state.planets[id]!.owner).toBeNull();
      expect(state.planets[id]!.garrison).toEqual([]);
      expect(state.planets[id]!.buildings).toEqual([]);
    }
  });
});

describe('skirmishState — the single-player door', () => {
  it('builds a state from the shipped skirmish map', () => {
    expect(Object.keys(skirmishState(data).planets)).toHaveLength(5);
  });
});

describe('the shipped PvE scenario — the assault the player actually meets (PVR-1.3)', () => {
  const data = shippedGameData();
  const cfg = data.modes[pveModeId() ?? '']?.pve;

  /** Что режим выставляет на волне N: объявленный состав, взятый N раз. Это ТА ЖЕ
   *  арифметика, что в `pveModule`, повторённая здесь намеренно — тест держит КОНТЕНТ,
   *  а не код: сколько именно железа приедет к игроку по шипнутым числам. */
  const wave = (n: number) => (cfg?.waveFleet ?? []).map((s) => ({ unit: s.unit, count: s.count * n }));

  it('the PvE mode declares its own wave composition, not the Swarm player loadout', () => {
    // Рой — играбельная фракция, поэтому её `startingLoadout` балансируют под ИГРОКА.
    // Пока волна бралась оттуда, «усилить штурм» и «усилить фракцию» были одной ручкой.
    expect(cfg?.waveFleet).toBeDefined();
    expect(cfg?.waveFleet).not.toEqual(data.factions.swarm?.startingLoadout.fleet);
  });

  it('the last wave outguns the fleet the player opens with — by hull and by guns', () => {
    const opening = pveState(data).fleets.p1_1!.units;
    const last = wave(cfg!.waves);
    for (const stat of ['attack', 'hp']) {
      const player = sumUnitStat(opening, data, stat);
      expect([stat, sumUnitStat(last, data, stat) > player * 3]).toEqual([stat, true]);
    }
  });

  it('even wave 1 is a fight, not a formality', () => {
    // Нижняя граница тоже важна: волна, которую два стартовых крейсера снимают не
    // заметив, — это не «лёгкое начало», это отсутствующая механика.
    const opening = pveState(data).fleets.p1_1!.units;
    expect(sumUnitStat(wave(1), data, 'hp')).toBeGreaterThan(
      sumUnitStat(opening, data, 'hp') * 0.5,
    );
  });

  it('the wave can cross the map: no hull slower than the player ships it hunts', () => {
    // 154 игровых часа до первого боя в прогоне PVR-1.5 — цена `scout_drone` со
    // скоростью 12: флот идёт по САМОМУ МЕДЛЕННОМУ корпусу. Волна, которая ползёт
    // дольше, чем длится забег, враждебна только на бумаге.
    const speeds = wave(1).map((s) => data.units[s.unit]!.stats.speed ?? 0);
    expect(speeds.length).toBeGreaterThan(0); // иначе Math.min пустого — Infinity, и проверка зелена ни на чём
    expect(Math.min(...speeds)).toBeGreaterThanOrEqual(40);
  });
});
