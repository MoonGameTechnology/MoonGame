import { describe, expect, it } from 'vitest';
import { FLEET_CALLSIGNS, fleetCallsign, fleetKindKey } from './fleetName';

describe('fleetCallsign — детерминированный позывной из id', () => {
  it('один id → один и тот же позывной (стабильно между вызовами/клиентами)', () => {
    expect(fleetCallsign('p1-1')).toBe(fleetCallsign('p1-1'));
    expect(fleetCallsign('t-a2')).toBe(fleetCallsign('t-a2'));
  });

  it('формат «{ИМЯ из пула} {N=1..9}»', () => {
    for (const id of ['p1-1', 'p2-3', 't-move', 'x', 'fleet-42']) {
      const cs = fleetCallsign(id);
      const m = /^([A-Z]+) ([1-9])$/.exec(cs);
      expect(m, `bad callsign ${cs}`).not.toBeNull();
      expect(FLEET_CALLSIGNS).toContain(m![1]);
    }
  });

  it('разные id дают разброс имён (не все одинаковые)', () => {
    const names = new Set(Array.from({ length: 40 }, (_, i) => fleetCallsign(`p${i}-${i}`)));
    expect(names.size).toBeGreaterThan(10);
  });
});

describe('fleetKindKey — тип соединения по размеру', () => {
  it('пороги: звено → эскадрилья → эскадра → флот → армада', () => {
    expect(fleetKindKey(1)).toBe('fleet.size.flight');
    expect(fleetKindKey(2)).toBe('fleet.size.flight');
    expect(fleetKindKey(3)).toBe('fleet.size.squadron');
    expect(fleetKindKey(5)).toBe('fleet.size.squadron');
    expect(fleetKindKey(6)).toBe('fleet.size.squadron-heavy');
    expect(fleetKindKey(12)).toBe('fleet.size.squadron-heavy');
    expect(fleetKindKey(13)).toBe('fleet.size.fleet');
    expect(fleetKindKey(25)).toBe('fleet.size.fleet');
    expect(fleetKindKey(26)).toBe('fleet.size.armada');
    expect(fleetKindKey(100)).toBe('fleet.size.armada');
  });
});
