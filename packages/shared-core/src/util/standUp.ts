import type { HandlerContext } from '../kernel/module';
import type { GameState } from '../state/gameState';

/**
 * ФЛОТ ВСТАЛ У МИРА НЕ ПРИЛЁТОМ (баг владельца 2026-11-02: «прилетел на вражескую планету,
 * там был вражеский корабль, а бой начался только по моему приказу»).
 *
 * Ядро сводило флоты в бой только на ДВИЖЕНИИ — прибытие, проход узла, перехват, объявление
 * войны. Флот, который появился у мира на месте, не прилетал и боя не заводил: корабль с
 * верфи под чужим флотом на орбите (авто-сбор), взлёт гарнизона, раскол флота, герой,
 * волна Роя. Враги стояли рядом мирно, пока игрок не отдавал «Атаку». В одиночной игре дыру
 * прикрывал покадровый драйвер клиента (`checkFleetClashes`), а на сервере такого цикла нет.
 *
 * Здесь — какие события означают «флот встал у мира» и где в их полезной нагрузке флот и
 * мир. Сводит в бой модуль боя тем же путём, что прибытие (`engageFleets`): кто встал, тот
 * атакующий. Авто-сбор зовёт его возможностью `battle.standUp`: своего события у него нет,
 * а `unit.built` модуль боя слышит раньше, чем корабль поднят на орбиту.
 */
export const STAND_UP_EVENTS: Readonly<Record<string, { fleet: string; at: string }>> = {
  'fleet.launched': { fleet: 'fleetId', at: 'planetId' },
  'fleet.split': { fleet: 'to', at: 'at' },
  'fleet.joined': { fleet: 'fleetId', at: 'at' },
  'hero.spawned': { fleet: 'fleetId', at: 'at' },
  'hero.respawned': { fleet: 'fleetId', at: 'at' },
  'pve.wave.spawned': { fleet: 'fleetId', at: 'location' },
};

/** Контракт возможности `battle.standUp`: «флот `fleetId` встал у мира `at` — сведи его с
 *  врагом, как прибывший». Нет модуля боя — нет возможности, и флот просто стоит. */
export type BattleStandUp = (fleetId: string, at: string, h: HandlerContext) => void;

/** Флот и мир из события `type`, если флот и правда стоит у этого мира (не в пути, не на
 *  дороге). Иначе null: флот уже ушёл, слит или событие не из таблицы. */
export function standingFleet(
  state: GameState,
  type: string,
  payload: unknown,
): { fleetId: string; at: string } | null {
  const keys = STAND_UP_EVENTS[type];
  if (!keys || typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const fleetId = p[keys.fleet];
  const at = p[keys.at];
  if (typeof fleetId !== 'string' || typeof at !== 'string') return null;
  return standsAt(state, fleetId, at) ? { fleetId, at } : null;
}

/** Стоит ли флот `fleetId` у мира `at`: не в пути и не на дороге. */
export function standsAt(state: GameState, fleetId: string, at: string): boolean {
  const fleet = Object.hasOwn(state.fleets, fleetId) ? state.fleets[fleetId] : undefined;
  return !!fleet && fleet.location === at && !fleet.movement && !fleet.edge;
}
