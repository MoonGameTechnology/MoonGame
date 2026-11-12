export { hasShipyard, unitBuildSiteBlocker, unitYardLevelBlocker } from '../state/buildFacilities';
import type { GameModule } from '../kernel/module';
import { clearInfected } from './construction/kit';
import { registerConstructionMaintenance } from './construction/maintenance';
import { registerBuildingOrders, registerUnitOrders } from './construction/orders';
import { registerCompletion, registerWarDamage } from './construction/events';

export type { BuildingHit, BuildingDamage, DelayedOrder, ConstructionDelay } from './construction/kit';

/**
 * Buildings — a base module (docs/modulesystem.md). It owns everything about
 * planet structures:
 *
 *   - orders: `building.construct` / `building.upgrade` / `unit.build`, each
 *     paid up-front from the ordering player's treasury (`Player.resources`) and
 *     finished after `buildTimeHours` (timeScale-scaled) via a scheduled
 *     `construction.complete`. Fail-secure: an unaffordable / unauthorized order
 *     is rejected and charges nothing (OWASP A10). Delivery is gated on still
 *     owning the planet — lose it mid-build and the investment is forfeited.
 *   - defense: each standing building toughens the garrison through the
 *     `combat.damage` hook (the `defenseBonus`, +1% by default, more for a
 *     fortress, growing with level — GDD §7).
 *   - destruction: the ground assault wears down building HP each round; a
 *     destroyed building stops granting its bonus (GDD §7.4). (A distinct
 *     orbital-bombardment pass, with its own magnitude, is a future refinement.)
 */
export const constructionModule: GameModule = {
  id: 'construction',
  // 1.1.0: защита построек мира — доля каждой постройки, потолок 90%, штурм и обстрел (FORT-5.15).
  // 1.2.0: снос постройки пересчитывает прикрытие для остатка того же обстрела (FORT-5.16).
  // 1.3.0: бой с орудиями крепости на развилке ставит её стройку на паузу (Codex на #1410).
  // 1.5.0: возможность `building.damage` — прицельный урон по выбранным постройкам (SPY-9).
  // 1.6.0: retired entries refuse new orders; accepted work remains valid. Ship
  // prices also honour the optional match-pinned hull multipliers.
  // 1.7.0: возможность `construction.delay` — сдвиг ближайшего заказа мира (SPY-14).
  // 1.8.0: залеченный госпиталем стек сливается с целыми того же вида (раны теперь
  // переживают бой, `combat` 3.10.0).
  // 1.9.0: своя полоса у каждой производственной постройки — верфь, порт, казармы, завод (BLD-2.1).
  // 1.12.0 combines paid module snapshots with immediate structure casualties.
  // 1.13.0: the requirement hook names the order's world; queued units re-ask it (BAL-19).
  // 1.14.0: a running unit build is parked when its world leaves control; resume re-asks (BAL-19).
  // 1.15.2: приостановленная постройка держит своё место в крепости (ponytail-аудит).
  version: '1.15.2',
  setup(api) {
    registerBuildingOrders(api);
    registerUnitOrders(api);
    registerCompletion(api);
    registerWarDamage(api);

    // Лечение наземных войск — только госпиталем (решение владельца 2026-11-01): бой больше
    // не возвращает выживших целыми (`combat` 3.10.0), раны затягивает здесь `healRate` живых
    // построек мира. Нет госпиталя — раненый остаётся раненым, как корабль без дока.
    registerConstructionMaintenance(api, clearInfected);
  },
};
