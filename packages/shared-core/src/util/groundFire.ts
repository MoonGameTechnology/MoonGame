/**
 * ОГОНЬ С ОРБИТЫ И С ВОЗДУХА ПО НАЗЕМНЫМ ВОЙСКАМ (ROS-1.6, заказ владельца 2026-10-12:
 * «надо бы кораблям космическим дать небольшой урон по наземным юнитам», «а у космической
 * авиации чуть побольше»).
 *
 * До этого кирпича войска мира не задевал ни один космический канал: обстрел с орбиты и
 * удар шаттлов по миру стачивали только постройки, и у кораблей и шаттлов в карточке урона
 * по технике и пехоте стоял прочерк.
 *
 * 1. **Корабль бьёт войска, пока ведёт обстрел** (`fleet.bombard`): `attack ×
 *    SHIP_GROUND_FRACTION` за час, той же линией огня (`COMBAT_UNIT_CAP`), что обстрел
 *    построек. Отдельного приказа нет: обстрел и есть огонь по миру под флотом.
 * 2. **Шаттл — при ударе по миру**: `attack × SHUTTLE_GROUND_FRACTION` за удар, в доле
 *    живого корпуса машин (SHU-5.7). Доля больше корабельной: машины спускаются к земле, а
 *    корабль стреляет с орбиты.
 * 3. **Обе доли малы против наземного боя**: огонь сверху ослабляет гарнизон, а берёт мир
 *    по-прежнему десант.
 * 4. **Последнего бойца сверху не добить.** Огонь останавливается, когда у гарнизона
 *    остаётся {@link GARRISON_FLOOR_HP} прочности. Пустой мир занимает любой флот
 *    (`captureOnArrival`, `fleet.assault` без десанта), и без порога корабли брали бы
 *    обороняемый мир сами.
 * 5. **Бьют только гарнизон** — войска хозяина мира. Чужие плацдармы на нём не задеты:
 *    обстрел и удар целятся в мир, и противник у них — его хозяин.
 *
 * Урон идёт через хук `combat.damage` в фазе своего канала (`bombard` и `shuttle`), поэтому
 * прикрытие мира постройками и техи «космос» и «шаттлы» доходят и до войск.
 */
import type { HandlerContext } from '../kernel/module';
import type { Planet, PlayerId } from '../state/gameState';
import type { GameData } from '../data/schemas';
import { effectiveStats } from './loadout';
import { applyDamageToSide, capHooked, stackHull, type HookedDamage } from './combat';

/** Доля атаки корабля, которая за час обстрела ложится на войска мира (правило 1). */
export const SHIP_GROUND_FRACTION = 0.1;
/** Доля атаки шаттла, которая за удар по миру ложится на его войска (правило 2). */
export const SHUTTLE_GROUND_FRACTION = 0.25;
/** Сколько прочности огонь сверху оставляет гарнизону (правило 4). */
export const GARRISON_FLOOR_HP = 1;

type Stats = Partial<Record<string, number>>;

/** Урон ОДНОГО корабля по войскам за час обстрела — для ядра и для карточки юнита. */
export function shipGroundDamage(stats: Stats): number {
  return Math.max(0, stats.attack ?? 0) * SHIP_GROUND_FRACTION;
}

/** Урон ОДНОЙ целой машины по войскам за удар по миру — для ядра и для карточки юнита. */
export function shuttleGroundDamage(stats: Stats): number {
  return Math.max(0, stats.attack ?? 0) * SHUTTLE_GROUND_FRACTION;
}

/** Сколько урона гарнизон ещё примет сверху: весь его корпус без порога (правило 4). */
export function garrisonRoom(planet: Planet, data: GameData): number {
  let pool = 0;
  for (const s of planet.garrison) {
    const def = data.units[s.unit];
    if (s.count <= 0 || !def) continue;
    pool += stackHull(s, effectiveStats(def, s, data).hp).pool;
  }
  return Math.max(0, pool - GARRISON_FLOOR_HP);
}

/** Положить огонь сверху на гарнизон `planet`. Урон уже прошёл хук своего канала; здесь
 *  только порог и приёмник. Павших записывает на `killedBy`, как и любой другой канал. */
export function fireOnGarrison(
  h: HandlerContext,
  planet: Planet,
  dealt: HookedDamage,
  killedBy: PlayerId,
): void {
  const landed = capHooked(dealt, garrisonRoom(planet, h.ctx.data));
  if (!(landed > 0)) return;
  const ref = { kind: 'garrison' as const, planetId: planet.id };
  applyDamageToSide(h, ref, landed, h.ctx.data, planet.id, undefined, undefined, killedBy);
}
