/**
 * Автослияние на прибытии (заказ владельца 2026-10-03): флот, ДОЛЕТЕВШИЙ в узел, где
 * уже стоит свой флот, сразу вливается в него — без отдельного приказа `fleet.merge`.
 * Правило в ядре, а не в клиенте: игрок, бот и закрытая вкладка играют по нему одинаково.
 *
 * Кто в кого: прибывший вливается в СТОЯВШЕГО. Стоявший сохраняет id и метки — флот
 * сбора (`rally`, BF-29) остаётся флотом сбора, и новые корабли с верфи идут туда же.
 * Стоявших несколько — берётся первый по id (порядок фиксирован, инвариант детерминизма).
 *
 * Не сливается то же, что не сливает приказ (`fleet.merge`), плюс то, у чего есть своя
 * работа, которую слияние молча оборвало бы:
 * - бой, высадка штурмом, не прибыл в узел (курс, стоянка на дороге/развилке);
 * - орудия крепости (`immobile`, FORT-5.4) и мины — это не флоты игрока;
 * - два героя в одном флоте («один герой на флот»);
 * - цепочка приказов (`state.orders`) у любой стороны — её ведёт драйвер по id флота;
 * - намерение `mergeInto`, которое ещё не созрело (бой/высадка приостановили его);
 * - флоты NPC-мест (жители, пираты, место Роя в PvE): сценарий узнаёт их по id
 *   (`pve:boss`, `pve:wave:N`).
 *
 * В КОНЕЦ списка модулей намеренно: прибытие сначала слышат все остальные (бой, захват,
 * мины, союзник, архив), и только потом флот исчезает в стоявшем.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { Fleet } from '../state/gameState';
import { heroByFleet } from '../state/heroes';
import { isMineFleet } from '../state/minefields';
import { emplacedFleet, fuseFleets } from '../util/fleetMerge';

/** Стоит ли флот в узле свободным: не летит, не в бою, не высаживается, без цепочки. */
function idleAt(h: HandlerContext, f: Fleet, at: string): boolean {
  return (
    f.location === at &&
    !f.movement &&
    !f.battleId &&
    !f.assaultLanding &&
    !f.mergeInto &&
    !h.state.orders?.[f.id] &&
    !emplacedFleet(h, f) &&
    !isMineFleet(f, h.ctx.data)
  );
}

export const autoMergeModule: GameModule = {
  id: 'auto-merge',
  version: '1.0.0',
  setup(api) {
    api.on('fleet.arrived', (event, h) => {
      const p = event.payload as { fleetId?: unknown; at?: unknown };
      if (typeof p?.fleetId !== 'string' || typeof p.at !== 'string') return;
      const arrived = h.state.fleets[p.fleetId];
      if (!arrived || !idleAt(h, arrived, p.at)) return;
      const owner = arrived.owner;
      if (h.state.players[owner]?.npc || owner === h.state.pve?.npcPlayerId) return;
      const hero = !!heroByFleet(h.state, arrived.id);
      for (const id of Object.keys(h.state.fleets).sort()) {
        const into = h.state.fleets[id];
        if (!into || id === arrived.id || into.owner !== arrived.owner) continue;
        if (!idleAt(h, into, p.at)) continue;
        if (hero && heroByFleet(h.state, id)) continue;
        fuseFleets(h, arrived.id, id, arrived.owner);
        return;
      }
    });
  },
};
