import { describe, expect, it } from 'vitest';
import { orbitSeats, type SeatFleet } from './orbitSeats';

interface F extends SeatFleet {
  fort?: boolean;
}
const fixed = (f: F): boolean => !!f.fort;
const ids = (list: readonly F[]): string[] => list.map((f) => f.id);

describe('места флотов у мира — один проход вместо прохода на каждый флот', () => {
  it('кольцо мира: стоящие флоты в порядке мира; движущийся, бьющийся и крепость мест не занимают', () => {
    const fleets: F[] = [
      { id: 'a', location: 'w1' },
      { id: 'moving', location: 'w1', movement: { from: 'w1', to: 'w2' } },
      { id: 'b', location: 'w1' },
      { id: 'fighting', location: 'w1', battleId: 'b1' },
      { id: 'fort', location: 'w1', fort: true },
      { id: 'c', location: 'w1' },
      { id: 'other', location: 'w2' },
    ];
    const seats = orbitSeats(fleets, fixed);
    expect(seats.ring('a', 'w1')).toEqual({ idx: 0, peers: 3 });
    expect(seats.ring('b', 'w1')).toEqual({ idx: 1, peers: 3 });
    expect(seats.ring('c', 'w1')).toEqual({ idx: 2, peers: 3 });
    expect(seats.ring('other', 'w2')).toEqual({ idx: 0, peers: 1 });
  });

  it('флот не с этого кольца садится на первое место, число соседей — этого кольца', () => {
    const fleets: F[] = [
      { id: 'a', location: 'w1' },
      { id: 'b', location: 'w1' },
      { id: 'x', location: 'w2' },
      { id: 'moving', location: 'w1', movement: {} },
    ];
    const seats = orbitSeats(fleets, fixed);
    expect(seats.ring('moving', 'w1')).toEqual({ idx: 0, peers: 2 });
    // Флот спрашивают о чужом кольце (его старая копия стояла у другого мира).
    expect(seats.ring('b', 'w2')).toEqual({ idx: 0, peers: 1 });
    expect(seats.ring('ghost', 'w9')).toEqual({ idx: 0, peers: 0 });
  });

  it('строй боя: флоты боя у этого мира в порядке мира; тот же бой у другого мира — другой строй', () => {
    const fleets: F[] = [
      { id: 'e1', location: 'w1', battleId: 'b1' },
      { id: 'm1', location: 'w1', battleId: 'b1' },
      { id: 'run', location: 'w1', battleId: 'b1', movement: {} },
      { id: 'fort', location: 'w1', battleId: 'b1', fort: true },
      { id: 'far', location: 'w2', battleId: 'b1' },
      { id: 'idle', location: 'w1' },
    ];
    const seats = orbitSeats(fleets, fixed);
    expect(ids(seats.fight('b1', 'w1'))).toEqual(['e1', 'm1']);
    expect(ids(seats.fight('b1', 'w2'))).toEqual(['far']);
    expect(seats.fight('b2', 'w1')).toEqual([]);
  });

  it('совпадает с прежним перебором всех флотов на каждый флот', () => {
    // Прежний кадр — дословно: фильтр по всем флотам мира для каждого флота.
    const ringBefore = (all: F[], f: F) => {
      const peers = all.filter((g) => g.location === f.location && !g.movement && !g.battleId && !fixed(g));
      return { idx: Math.max(0, peers.findIndex((g) => g.id === f.id)), peers: peers.length };
    };
    const fightBefore = (all: F[], f: F) =>
      all.filter((g) => g.battleId === f.battleId && g.location === f.location && !g.movement && !fixed(g));
    let seed = 7;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let round = 0; round < 40; round++) {
      const fleets: F[] = Array.from({ length: 1 + rnd(40) }, (_, i) => ({
        id: `f${i}`,
        location: rnd(8) === 0 ? null : `w${rnd(5)}`,
        movement: rnd(5) === 0 ? {} : undefined,
        battleId: rnd(3) === 0 ? `b${rnd(2)}` : null,
        fort: rnd(7) === 0,
      }));
      const seats = orbitSeats(fleets, fixed);
      // Кадр спрашивает только о стоящих флотах с миром и не о крепостях.
      for (const f of fleets.filter((g) => g.location && !g.movement && !fixed(g))) {
        expect(seats.ring(f.id, f.location!)).toEqual(ringBefore(fleets, f));
        if (f.battleId) expect(ids(seats.fight(f.battleId, f.location!))).toEqual(ids(fightBefore(fleets, f)));
      }
    }
  });
});
