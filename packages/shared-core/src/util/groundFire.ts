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
 *    SHIP_GROUND_FRACTION[род]` за час, той же линией огня (`COMBAT_UNIT_CAP`), что обстрел
 *    построек. Отдельного приказа нет: обстрел и есть огонь по миру под флотом.
 * 2. **Шаттл — при ударе по миру**: `attack × SHUTTLE_GROUND_FRACTION[род]` за удар, в доле
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
 * 6. **Урон ложится поровну на каждого юнита гарнизона, а не фокусом** (ROS-1.6a, заказ
 *    владельца 2026-10-24). На каждого из N живых юнитов приходится `урон / N`, стек из
 *    `count` юнитов получает `урон × count / N` (`damageEvenly`). До этого огонь сверху шёл
 *    правилом боя: все наземные юниты стоят в одной линии, а внутри линии урон берёт стеки
 *    по очереди id — и обстрел выбивал один род войск целиком, не задев остальных.
 * 7. **Род войск цели решает, сколько урона несёт его доля** (ROS-1.6b, вопрос владельца
 *    2026-10-24 «должен учитываться тип юнита»). У каждого канала своя доля атаки по пехоте
 *    и по технике: корабли с орбиты прореживают пехоту, а броню бьют вдвое слабее; шаттлы
 *    наоборот, выбивают технику, а пехоту бьют вдвое слабее. Юнит рода `c` получает
 *    `урон стрелков по c / N`, где N — число юнитов гарнизона (`groundVolley`). Урон по
 *    одному роду не перетекает в стрелковую мощь по другому: остаток погибших делится по
 *    тем же весам (`damageEvenly`).
 *
 * Урон идёт через хук `combat.damage` в фазе своего канала (`bombard` и `shuttle`), поэтому
 * прикрытие мира постройками и техи «космос» и «шаттлы» доходят и до войск.
 */
import type { HandlerContext } from '../kernel/module';
import type { Planet, PlayerId, UnitStack } from '../state/gameState';
import type { GameData } from '../data/schemas';
import { effectiveStats } from './loadout';
import { cappedUnitBreakdown } from './stacks';
import { applyDamageToSide, capHooked, stackHull, type HookedDamage } from './combat';
import { TARGET_CLASSES, targetClassOf, type ClassPools, type TargetClass } from './groundTargets';

/** Доля атаки корабля, которая за час обстрела ложится на войска мира, по роду цели
 *  (правила 1 и 7). `other` — не наземный юнит в гарнизоне (корабль, ждущий вылета). */
export const SHIP_GROUND_FRACTION: Readonly<Record<TargetClass, number>> = {
  infantry: 0.1,
  vehicle: 0.05,
  other: 0.1,
};
/** Доля атаки шаттла, которая за удар по миру ложится на его войска, по роду цели
 *  (правила 2 и 7). */
export const SHUTTLE_GROUND_FRACTION: Readonly<Record<TargetClass, number>> = {
  infantry: 0.125,
  vehicle: 0.25,
  other: 0.25,
};
/** Сколько прочности огонь сверху оставляет гарнизону (правило 4). */
export const GARRISON_FLOOR_HP = 1;

type Stats = Partial<Record<string, number>>;

/** Урон ОДНОГО корабля по войскам рода `cls` за час обстрела — для ядра и для карточки. */
export function shipGroundDamage(stats: Stats, cls: TargetClass): number {
  return Math.max(0, stats.attack ?? 0) * SHIP_GROUND_FRACTION[cls];
}

/** Урон ОДНОЙ целой машины по войскам рода `cls` за удар по миру — для ядра и для карточки. */
export function shuttleGroundDamage(stats: Stats, cls: TargetClass): number {
  return Math.max(0, stats.attack ?? 0) * SHUTTLE_GROUND_FRACTION[cls];
}

/** Залп сверху по гарнизону: урон до хука и урон стрелков по каждому роду (вес рода). */
export interface GroundVolley {
  total: number;
  weights: ClassPools;
}

/**
 * Залп `shooters` по гарнизону `garrison` (правило 7). `perUnit` — урон одного стрелка по
 * роду. Юнит рода `c` получает `weights[c] / N`, поэтому залп целиком равен
 * `Σ число_c × weights[c] / N`.
 *
 * Линию огня (`COMBAT_UNIT_CAP`) выбирает кап по урону против ЭТОГО гарнизона, как в
 * наземном бою (`targetedVolley`): доля рода здесь — его доля в числе юнитов, потому что
 * урон делится по юнитам. Пустой гарнизон — залпа нет.
 */
export function groundVolley(
  shooters: readonly UnitStack[],
  garrison: readonly UnitStack[],
  data: GameData,
  perUnit: (stats: Stats, cls: TargetClass) => number,
): GroundVolley {
  const counts: ClassPools = { infantry: 0, vehicle: 0, other: 0 };
  let alive = 0;
  for (const s of garrison) {
    const def = data.units[s.unit];
    if (s.count <= 0 || !def) continue;
    counts[targetClassOf(def)] += s.count;
    alive += s.count;
  }
  const weights: ClassPools = { infantry: 0, vehicle: 0, other: 0 };
  if (alive === 0) return { total: 0, weights };
  const present = TARGET_CLASSES.filter((cls) => counts[cls] > 0);
  const rows = cappedUnitBreakdown(shooters, data, (stats) =>
    present.reduce((sum, cls) => sum + (counts[cls] / alive) * perUnit(stats, cls), 0),
  );
  let total = 0;
  for (const row of rows) {
    const stack = shooters[row.index]!;
    // Те же статы, что взял кап, — здесь их читают заново, чтобы разложить залп по родам.
    const stats = effectiveStats(data.units[stack.unit]!, stack, data);
    for (const cls of present) weights[cls] += row.firing * perUnit(stats, cls);
    total += row.damage;
  }
  return { total, weights };
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
 *  только порог и приёмник, который делит урон поровну на юнитов с весом их рода
 *  (`weights` из {@link groundVolley}, правила 6 и 7). Павших записывает на `killedBy`, как
 *  и любой другой канал. */
export function fireOnGarrison(
  h: HandlerContext,
  planet: Planet,
  dealt: HookedDamage,
  killedBy: PlayerId,
  weights: ClassPools,
): void {
  const landed = capHooked(dealt, garrisonRoom(planet, h.ctx.data));
  if (!(landed > 0)) return;
  const ref = { kind: 'garrison' as const, planetId: planet.id };
  applyDamageToSide(
    h,
    ref,
    landed,
    h.ctx.data,
    planet.id,
    undefined,
    undefined,
    killedBy,
    weights,
  );
}
