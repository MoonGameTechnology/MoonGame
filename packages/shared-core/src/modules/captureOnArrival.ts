import type { GameModule, HandlerContext } from '../kernel/module';
import { getStance } from '../state/diplomacy';
import { isCapturable } from '../state/sectorKind';

/**
 * Capture-on-arrival (map-roadmap.md M2.2). A fleet that reaches an undefended,
 * uncontested **capturable** sector it doesn't own takes it on the spot — the
 * "walk-in" capture. This was a client-only convenience in the prototype
 * (`seizeSector`), so it never happened in multiplayer; as a kernel rule it now
 * runs server-side and applies identically in single-player and online.
 *
 * Skipped (these need a real assault — the combat module — or can't be owned):
 *   - defended: the sector has a live garrison;
 *   - contested: an enemy fleet with units is also present;
 *   - not capturable: empty space (sector kind `capturable: false`);
 *   - owned by a non-hostile player: an ally's / at-peace world can't be seized
 *     for free — that needs a declared war first (same `war`-only gate combat's
 *     `isHostile` uses). Only a NEUTRAL (unowned) or an at-WAR world walks in;
 *   - **empty hold: the fleet carries no landing force (BAL-4).**
 *
 * Про последнее подробно, потому что это правка ТЕМПА ВСЕЙ ИГРЫ, а не мелкая
 * оговорка. Раньше провинцию брало само присутствие корабля, и замер BAL-5 показал,
 * во что это обходится: карта из 121 провинции делилась за 4 дня из 14, победитель
 * определялся к пятому и лидерства не отдавал, а 88% переходов территории шли без
 * единого выстрела. Армия была нужна лишь для призовых миров, остальная карта
 * перекидывалась каруселью пустых корпусов.
 *
 * Теперь территорию берут ВОЙСКА: в трюме нужен живой наземный юнит. «Живой» — это
 * `count > 0`, «наземный» — `domain: 'ground'` по ДАННЫМ. Юнит, которого в каталоге
 * нет, десантом не считается (fail-secure: не знаем — не высаживаем; иначе правило
 * обходилось бы опечаткой в данных). Правило одинаково для нейтральной и вражеской
 * провинции — и там и там захват это высадка, а не пролёт.
 *
 * Ordered AFTER combat in the module list, so a contested arrival starts its
 * battle first and the guards below then decline to capture.
 */

/** Несёт ли флот живой десант (BAL-4). */
function hasLandingForce(h: HandlerContext, fleet: { landing?: readonly { unit: string; count: number }[] }): boolean {
  return (fleet.landing ?? []).some(
    (stack) => stack.count > 0 && h.ctx.data.units[stack.unit]?.domain === 'ground',
  );
}
function tryCapture(h: HandlerContext, payload: unknown): void {
  const { fleetId, at } = (payload ?? {}) as { fleetId?: string; at?: string };
  if (typeof fleetId !== 'string' || typeof at !== 'string') return;
  const fleet = h.state.fleets[fleetId];
  const planet = h.state.planets[at];
  if (!fleet || !planet || planet.owner === fleet.owner) return;
  if (!isCapturable(h.ctx.data, planet)) return;
  if (planet.owner !== null && getStance(h.state, fleet.owner, planet.owner) !== 'war') return;
  if (planet.garrison.some((s) => s.count > 0)) return;
  if (!hasLandingForce(h, fleet)) return; // BAL-4: пустой трюм не берёт провинцию
  const contested = Object.values(h.state.fleets).some(
    (g) => g.owner !== fleet.owner && g.location === at && g.units.some((u) => u.count > 0),
  );
  if (contested) return;
  planet.owner = fleet.owner;
  h.emit('planet.captured', { planetId: at, owner: fleet.owner, via: 'arrival' });
}

export const captureOnArrivalModule: GameModule = {
  id: 'capture-on-arrival',
  version: '0.1.0',
  setup(api) {
    api.on('fleet.arrived', (event, h) => tryCapture(h, event.payload));
    api.on('fleet.transit', (event, h) => tryCapture(h, event.payload));
  },
};
