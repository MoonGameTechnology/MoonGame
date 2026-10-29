// ПИРАТЫ — МЕСТНАЯ УГРОЗА, А НЕ ЗАВОЕВАТЕЛЬ КАРТЫ (заказ владельца 2026-10-25).
//
// Жалоба: «зашёл в сессию, а у меня на базе уже 22 корабля пиратов». Причина была в
// боте, а не в данных. Пиратский клан играл общим ботом экспансии: строил корабли без
// потолка (FFA-20: около 12 корпусов за игровые сутки) и слал флоты к ближайшему
// захватываемому миру, где бы тот ни был. Мир сетевой партии идёт круглосуточно, а
// свободное место можно занять ещё несколько реальных дней. Опоздавший садился в
// столицу, над которой уже висела армада.
//
// Два правила, оба от состояния, без памяти и без настенных часов:
//
// 1. **Радиус набегов.** Клан нападает только на миры в `PIRATE_RAID_HOPS` переходах по
//    лейнам от своего логова. Меряется переходами, а не пикселями: карты на 4 и на 100
//    мест разного масштаба, а «два шага от логова» везде значат одно и то же. На всех
//    картах с пиратами столица любого места лежит не ближе трёх переходов
//    (`pirateReach.test.ts` держит это для каждой карты), так что до стартовой империи
//    набег не дотягивается вовсе. Пираты встречают игрока, когда тот сам расширяется к
//    логову.
// 2. **Потолок флота по игровому дню.** Кораблей у клана не больше
//    `PIRATE_FLEET_START + PIRATE_FLEET_PER_DAY × день`, но не больше `PIRATE_FLEET_MAX`.
//    Логово крепнет вместе с игроками и остаётся целью, которую можно взять.
import type { GameState } from '../packages/shared-core/src/index';
import { MS_PER_DAY } from '../packages/shared-core/src/index';

/** Сколько переходов по лейнам от логова клан считает своими угодьями. */
export const PIRATE_RAID_HOPS = 2;
/** Потолок флота клана в первый игровой день. Стартовый флот — 4 корпуса. */
export const PIRATE_FLEET_START = 6;
/** Прибавка к потолку за каждый прошедший игровой день. */
export const PIRATE_FLEET_PER_DAY = 2;
/** Предел потолка: позже логово не растёт. */
export const PIRATE_FLEET_MAX = 14;

/** Пиратское ли это место (кланы NPC; у обычного места `npc` нет). */
export function isPirateClan(state: GameState, seat: string): boolean {
  return state.players[seat]?.npc === 'pirate';
}

/** Миры, на которые клан может ходить набегом: всё в `PIRATE_RAID_HOPS` переходах от
 *  его логовищ. Логово потеряно — меряем от любого своего мира; своих нет — угодий нет. */
export function pirateRaidZone(state: GameState, clan: string): ReadonlySet<string> {
  const owned = Object.values(state.planets).filter((p) => p.owner === clan);
  const dens = owned.filter((p) => p.kind === 'pirate_base');
  const start = (dens.length > 0 ? dens : owned).map((p) => p.id);
  const hops = new Map<string, number>(start.map((id) => [id, 0]));
  const queue = [...start];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i]!;
    const h = hops.get(at)!;
    if (h >= PIRATE_RAID_HOPS) continue;
    for (const next of state.planets[at]?.links ?? []) {
      if (hops.has(next) || !state.planets[next]) continue;
      hops.set(next, h + 1);
      queue.push(next);
    }
  }
  return new Set(hops.keys());
}

/** Сколько кораблей клан вправе держать сейчас. */
export function pirateShipCap(state: GameState): number {
  const day = Math.max(0, Math.floor((state.time - (state.startedAt ?? 0)) / MS_PER_DAY));
  return Math.min(PIRATE_FLEET_MAX, PIRATE_FLEET_START + PIRATE_FLEET_PER_DAY * day);
}

/** Сколько кораблей у клана есть и строится: во флотах, в портах своих миров, на
 *  стапеле и в очереди верфей. Очередь считается, иначе бот заказывал бы сверх потолка, пока
 *  корпуса ещё не сошли со стапеля. */
export function pirateShipCount(
  state: GameState,
  clan: string,
  isShip: (unit: string) => boolean,
): number {
  let n = 0;
  for (const f of Object.values(state.fleets)) {
    if (f.owner !== clan) continue;
    for (const st of f.units) if (isShip(st.unit)) n += st.count;
  }
  for (const p of Object.values(state.planets)) {
    if (p.owner !== clan) continue;
    for (const st of p.garrison) if (isShip(st.unit)) n += st.count;
    for (const q of p.buildQueue ?? []) if (q.kind === 'unit' && q.unit && isShip(q.unit)) n += q.count ?? 1;
  }
  for (const e of state.scheduled) {
    if (e.type !== 'construction.complete') continue;
    const q = e.payload as { kind?: string; planetId?: string; unit?: string; count?: number };
    if (q.kind !== 'unit' || !q.unit || !isShip(q.unit)) continue;
    if (state.planets[q.planetId ?? '']?.owner === clan) n += q.count ?? 1;
  }
  return n;
}
