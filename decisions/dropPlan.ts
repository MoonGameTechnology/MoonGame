// ЧЕМ И КЕМ ВЫСАЖИВАТЬСЯ — план десантного вылета.
//
// Правило владельца №3 (2026-09-16): «бот отправляет на планету МИНИМАЛЬНОЕ количество
// челноков с МАКСИМАЛЬНЫМ размером силы наземных юнитов, необходимых для победы и
// захвата планеты (экономим десантные челноки, а наземных юнитов нет, чтобы побеждать
// на планетах с меньшими потерями)».
//
// Две экономии здесь разнонаправленные, и обе взяты дословно:
//   · ЧЕЛНОКИ БЕРЕЖЁМ — берётся самая маленькая эскадра, которой хватит;
//   · ВОЙСКА НЕ БЕРЕЖЁМ — её трюм набивается ДОВЕРХУ и лучшими ударными.
//
// ЧЕГО ЭТОТ КИРПИЧ НЕ ДЕЛАЕТ: не дробит эскадру до точного числа бортов. `shuttle.split`
// отдаёт позывной БОЛЬШЕЙ половине, а id отделённой выдаёт ядро — узнать его в том же
// тике, когда отдаёшь приказ, нельзя. Поэтому «минимум» здесь — минимум из ТОГО, ЧТО
// СТОИТ В АНГАРЕ, а не выточенный под цель наряд; точный наряд потребует делёж одним
// тиком и вылет следующим.
import { confidentGroundWin } from './groundForecast';
import type { Squadron } from '../packages/shared-core/src/state/gameState';
import type { GameData, UnitStack } from '../packages/shared-core/src/index';

export interface DropPlan {
  /** Кого поднимать. */
  squadronId: string;
  /** Что грузить в трюм — тем же видом, что ждёт `shuttle.loadTroops`. */
  troops: UnitStack[];
  /** Сколько мест в трюме заняли. */
  cargoUsed: number;
}

/** Вместимость трюма эскадры — Σ `cargoCapacity` её машин. */
function squadronCargo(sq: Squadron, data: GameData): number {
  return sq.units.reduce(
    (n, st) => n + (data.units[st.unit]?.stats.cargoCapacity ?? 0) * Math.max(0, st.count),
    0,
  );
}

const machines = (sq: Squadron): number => sq.units.reduce((n, st) => n + Math.max(0, st.count), 0);

/**
 * Набить трюм ЛУЧШИМИ УДАРНЫМИ из доступных. Порядок — по `attack` вниз, тай-брейк по
 * имени: решение бота обязано быть чистой функцией состояния, а перебор объекта дал бы
 * разный порядок на разных движках.
 */
function fillHold(
  available: readonly UnitStack[],
  capacity: number,
  data: GameData,
): { troops: UnitStack[]; used: number } {
  const rows = available
    .filter((st) => st.count > 0 && data.units[st.unit]?.domain === 'ground')
    .map((st) => ({
      unit: st.unit,
      count: st.count,
      attack: data.units[st.unit]?.stats.attack ?? 0,
      size: data.units[st.unit]?.stats.cargoSize ?? 1,
    }))
    .sort((a, b) => b.attack - a.attack || (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0));
  const troops: UnitStack[] = [];
  let room = capacity;
  for (const row of rows) {
    if (room <= 0) break;
    const size = Math.max(1, row.size);
    const take = Math.min(row.count, Math.floor(room / size));
    if (take > 0) {
      troops.push({ unit: row.unit, count: take });
      room -= take * size;
    }
  }
  return { troops, used: capacity - room };
}

/**
 * Составить план высадки — или `null`, если высаживаться нечем, некем или незачем.
 *
 * `null` здесь не «попробуем и посмотрим»: правило владельца требует УВЕРЕННОСТИ, а
 * `confidentGroundWin` даёт обороне фору за то, чего прогноз не видит. Не сошлось —
 * значит вылет не уходит, и челноки остаются целы.
 */
export function planDrop(
  squadrons: readonly Squadron[],
  available: readonly UnitStack[],
  defenders: readonly UnitStack[],
  data: GameData,
): DropPlan | null {
  // Сначала самая МАЛЕНЬКАЯ эскадра: челноки берегутся. Тай-брейк по id — тот же
  // детерминизм, что и везде в решениях бота.
  const ordered = squadrons
    .filter((sq) => squadronCargo(sq, data) > 0)
    .slice()
    .sort((a, b) => machines(a) - machines(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const sq of ordered) {
    const { troops, used } = fillHold(available, squadronCargo(sq, data), data);
    if (troops.length === 0) continue;
    if (!confidentGroundWin(troops, defenders, data)) continue;
    return { squadronId: sq.id, troops, cargoUsed: used };
  }
  return null;
}
