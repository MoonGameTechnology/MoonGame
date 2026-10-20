/**
 * Карточка «свой мир со своим флотом» на телефоне (UIX-7.1): факты мира для правил
 * `decisions/worldFleetTabs.ts` и память открытой вкладки. Какие объекты складываются в пару
 * и какая вкладка открыта — решает правило; здесь только то, что оно спрашивает у мира.
 */
import type { GameState } from '../../packages/shared-core/src/index';
import { isOrdnanceFleet } from '../../packages/shared-core/src/state/ordnance';
import { isEmplacementFleet } from '../../decisions/emplacement';
import { parseTab, type CardTab, type PairFacts } from '../../decisions/worldFleetTabs';
import { data } from './game';
import { readRaw, writeRaw } from './prefs';

const KEY = 'void.cardTab';

/** Свой флот под приказ, стоящий у мира: мина, ракета и крепость приказов не берут. */
function parkedOwn(s: GameState, me: string, id: string): string | null {
  const f = s.fleets[id];
  if (!f || f.owner !== me || f.movement || !f.location) return null;
  if (isOrdnanceFleet(f, data) || isEmplacementFleet(f, data)) return null;
  if (!f.units.some((u) => u.count > 0)) return null;
  return f.location;
}

/** Факты для правил вкладок по миру на экране. */
export function pairFacts(
  s: GameState,
  me: string,
): PairFacts & { ownFleetsAt(worldId: string): readonly string[] } {
  return {
    ownWorld: (id) => s.planets[id]?.owner === me,
    parkedAt: (id) => parkedOwn(s, me, id),
    ownFleetsAt: (world) => Object.keys(s.fleets).filter((id) => parkedOwn(s, me, id) === world),
  };
}

/** Вкладка, которую выбирали в прошлый раз (правило 2). */
export function lastCardTab(): CardTab | null {
  return parseTab(readRaw(KEY));
}

/** Запомнить выбранную вкладку. */
export function rememberCardTab(tab: CardTab): void {
  writeRaw(KEY, tab);
}
