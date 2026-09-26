// ЧЕМ И КЕМ ВЫСАЖИВАТЬСЯ — план десантного вылета.
//
// Правило владельца №3 (2026-09-16): «бот отправляет на планету МИНИМАЛЬНОЕ количество
// челноков с МАКСИМАЛЬНЫМ размером силы наземных юнитов, необходимых для победы и
// захвата планеты (экономим десантные челноки, а наземных юнитов нет, чтобы побеждать
// на планетах с меньшими потерями)».
//
// С SHU-5.2 десантный челнок строится СРАЗУ с бойцом внутри (по одному на борт), и
// грузить трюм перед вылетом больше нечем и незачем: «максимум силы» решается на
// заказе челнока (бот берёт самого ударного бойца, которого может построить), а здесь
// остаётся вторая экономия — ЧЕЛНОКИ БЕРЕЖЁМ: из эскадр, чей УЖЕ лежащий в трюме
// десант уверенно берёт мир, поднимается самая маленькая.
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
  /** Что эскадра везёт — её трюм как есть, копией. */
  troops: UnitStack[];
  /** Сколько бойцов в трюме. */
  cargoUsed: number;
}

const machines = (sq: Squadron): number => sq.units.reduce((n, st) => n + Math.max(0, st.count), 0);

/** Наземный десант в трюме эскадры, без пустых строк. */
const groundCargo = (sq: Squadron, data: GameData): UnitStack[] =>
  (sq.cargo ?? [])
    .filter((st) => st.count > 0 && data.units[st.unit]?.domain === 'ground')
    .map((st) => ({ ...st }));

/**
 * Составить план высадки — или `null`, если высаживаться некем или незачем.
 *
 * `null` здесь не «попробуем и посмотрим»: правило владельца требует УВЕРЕННОСТИ, а
 * `confidentGroundWin` даёт обороне фору за то, чего прогноз не видит. Не сошлось —
 * значит вылет не уходит, и челноки остаются целы.
 */
export function planDrop(
  squadrons: readonly Squadron[],
  defenders: readonly UnitStack[],
  data: GameData,
): DropPlan | null {
  // Сначала самая МАЛЕНЬКАЯ эскадра: челноки берегутся. Тай-брейк по id — тот же
  // детерминизм, что и везде в решениях бота. Эскадра без десанта в трюме (бомбардировщик,
  // перехватчик) не кандидат: пустой борт долетит и просто погибнет.
  const ordered = squadrons
    .filter((sq) => groundCargo(sq, data).length > 0)
    .slice()
    .sort((a, b) => machines(a) - machines(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const sq of ordered) {
    const troops = groundCargo(sq, data);
    if (!confidentGroundWin(troops, defenders, data)) continue;
    return { squadronId: sq.id, troops, cargoUsed: troops.reduce((n, st) => n + st.count, 0) };
  }
  return null;
}
