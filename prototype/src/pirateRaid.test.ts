import { describe, expect, it } from 'vitest';
import type { GameState } from '../../packages/shared-core/src/index';
import { pirateRaidZone, pirateShipCap, pirateShipCount, PIRATE_RAID_HOPS } from '../../decisions/pirateReach';
import { aiOrders } from './ai';
import { data } from './gameData';
import { MAP_IDS } from './mapCatalog';
import { newGame, networkSeats } from './matchSetup';
import { advance, order } from './protoKernel';
import { HOUR } from './time';

// Заказ владельца 2026-10-25: «зашёл в сессию, а у меня на базе 22 корабля пиратов».
// Пираты — местная угроза (`decisions/pirateReach.ts`): угодья в два перехода от логова
// и потолок флота по игровому дню.

const game = (mapId: (typeof MAP_IDS)[number]): GameState =>
  newGame({ mapId, seats: networkSeats('ffa', mapId) });
const clans = (s: GameState): string[] =>
  Object.values(s.players).filter((p) => p.npc === 'pirate').map((p) => p.id);
const isShip = (u: string): boolean => !!data.units[u] && !data.units[u]!.traits.includes('ground');

describe('pirates are a local threat', () => {
  // Набег не дотягивается до стартовой империи только потому, что столицы лежат дальше
  // угодий. Это свойство КАРТ, и новая карта обязана его соблюдать.
  it.each(MAP_IDS.filter((id) => clans(game(id)).length > 0))(
    '%s keeps every capital beyond the pirate raid zone',
    (mapId) => {
      const s = game(mapId);
      const capitals = Object.values(s.planets).filter((p) => p.owner && !s.players[p.owner]?.npc);
      expect(capitals.length).toBeGreaterThan(0);
      for (const clan of clans(s)) {
        const zone = pirateRaidZone(s, clan);
        expect(zone.size).toBeGreaterThan(1);
        expect(capitals.filter((p) => zone.has(p.id)).map((p) => p.id), `${clan}, ${PIRATE_RAID_HOPS} hops`).toEqual([]);
      }
    },
  );

  it('Twenty Lights: three days of pirates stay under the cap and inside their grounds', () => {
    let s = game('ffa-20');
    const npcs = Object.values(s.players).filter((p) => p.npc).map((p) => p.id);
    for (let hour = 0; hour <= 72; hour += 2) {
      s = advance(s, hour * HOUR).state;
      for (const id of npcs) {
        const zone = s.players[id]!.npc === 'pirate' ? pirateRaidZone(s, id) : null;
        for (const action of aiOrders(s, id)) {
          if (zone && action.type === 'fleet.move') {
            expect(zone.has((action.payload as { to: string }).to), `${id} → ${JSON.stringify(action.payload)}`).toBe(true);
          }
          s = order(s, action, s.time).state;
        }
      }
      for (const clan of clans(s)) expect(pirateShipCount(s, clan, isShip)).toBeLessThanOrEqual(pirateShipCap(s));
    }
    const capitals = Object.values(s.planets).filter((p) => p.owner && !s.players[p.owner]?.npc).map((p) => p.id);
    const atCapitals = Object.values(s.fleets).filter(
      (f) => clans(s).includes(f.owner) && capitals.includes((f.movement?.destination ?? f.location) as string),
    );
    expect(atCapitals).toEqual([]);
  }, 120_000);
});
