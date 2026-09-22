// СКОЛЬКО ОБОРОНЫ МИР ОБЯЗАН СОХРАНИТЬ — и что сверх неё можно увезти на войну.
//
// Правила владельца (2026-09-16), из которых это следует дословно:
//   №4 — «бот держит основные наземные силы на своих планетах пропорционально развитию
//        планеты: чем больше развита планета, тем больше наземных сил на ней»;
//   №6 — «досуха никогда гарнизон не вычёрпывать, оставлять минимум 2 ополченцев или
//        1 тяжёлого пехотинца на самой слаборазвитой планете».
//
// МЕРА — ОЧКИ `defense`, а не головы. «Два ополченца ИЛИ один тяжёлый пехотинец» —
// это одно требование, названное двумя наборами, и сходятся они только в обороне
// (8+8 против 20), а не в числе бойцов и не в здоровье. Считать головами значило бы
// принять роту ополчения за равную роте тяжёлой пехоты.
//
// Лежит в `/decisions`: «сколько оставить дома» одинаково нужно и боту, и подсказке
// игроку, а две копии такого правила разойдутся молча.
import type { GameData, Planet, UnitStack } from '../packages/shared-core/src/index';

/** Пол самого слабого мира: два ополченца (8+8) — он же один тяжёлый пехотинец (20). */
export const GARRISON_FLOOR_BASE = 16;

/** Прибавка к полу за КАЖДЫЙ уровень здания — половина ополченца.
 *  Столица с 13 уровнями (потолок, который дал замер) требует ≈ 8 ополченцев. */
export const GARRISON_FLOOR_PER_LEVEL = 4;

/** Развитость мира — сумма УРОВНЕЙ его зданий. Не число построек: один рудник
 *  третьего уровня стоит дороже трёх первых и стоит того, чтобы его защищали. */
export function planetDevelopment(planet: Pick<Planet, 'buildings'>): number {
  return planet.buildings.reduce((n, b) => n + (b.level ?? 1), 0);
}

/** Сколько очков `defense` мир обязан сохранить. */
export function garrisonFloor(planet: Pick<Planet, 'buildings'>): number {
  return GARRISON_FLOOR_BASE + GARRISON_FLOOR_PER_LEVEL * planetDevelopment(planet);
}

/** Оборона стеков. КОРАБЛИ не считаются: мир обороняет армия, а корабль на земле —
 *  груз, а не гарнизон (то же правило, по которому `army.load` возит только `ground`). */
export function garrisonDefense(units: readonly UnitStack[], data: GameData): number {
  let total = 0;
  for (const st of units) {
    const def = data.units[st.unit];
    if (!def || def.domain !== 'ground' || st.count <= 0) continue;
    total += st.count * (def.stats.defense ?? 0);
  }
  return total;
}

/**
 * Что можно увезти с мира, не опустив его оборону ниже пола.
 *
 * ПОРЯДОК ОТДАЧИ ЗНАЧИМ: первыми уезжают лучшие УДАРНЫЕ (высокий `attack`), дома
 * остаются лучшие ОБОРОНИТЕЛЬНЫЕ. Танк бьёт 22 при обороне 14, ополченец — наоборот;
 * везти на чужую землю ополченца, оставив дома танк, значит ослабить обе стороны разом.
 * Тай-брейк по имени — решение бота обязано быть чистой функцией состояния.
 */
export function spareGround(
  planet: Pick<Planet, 'buildings' | 'garrison'>,
  data: GameData,
): UnitStack[] {
  const floor = garrisonFloor(planet);
  let left = garrisonDefense(planet.garrison, data);
  const rows = planet.garrison
    .filter((st) => st.count > 0 && data.units[st.unit]?.domain === 'ground')
    .map((st) => ({
      unit: st.unit,
      count: st.count,
      attack: data.units[st.unit]?.stats.attack ?? 0,
      defense: data.units[st.unit]?.stats.defense ?? 0,
    }))
    .sort((a, b) => b.attack - a.attack || (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0));
  const out: UnitStack[] = [];
  for (const row of rows) {
    if (row.defense <= 0) continue; // обороны не даёт — пол его отпуском не двинется
    const canRelease = Math.floor((left - floor) / row.defense);
    const take = Math.min(row.count, Math.max(0, canRelease));
    if (take > 0) {
      out.push({ unit: row.unit, count: take });
      left -= take * row.defense;
    }
  }
  return out;
}

/**
 * Насколько мир НЕ добирает до своего пола, в очках `defense`. Ноль — добирает.
 *
 * Обратная сторона {@link spareGround}: один и тот же пол отвечает и «сколько можно
 * увезти», и «сколько сюда нужно привезти». Две меры разошлись бы на первой же правке,
 * и бот возил бы войска туда-обратно между двумя мирами.
 */
export function garrisonNeed(
  planet: Pick<Planet, 'buildings' | 'garrison'>,
  data: GameData,
): number {
  return Math.max(0, garrisonFloor(planet) - garrisonDefense(planet.garrison, data));
}

/**
 * Кого ссадить из трюма, чтобы закрыть нужду мира, — и не больше.
 *
 * ПОРЯДОК ЗЕРКАЛЕН {@link spareGround}: там первыми уезжают лучшие УДАРНЫЕ, здесь
 * первыми сходят лучшие ОБОРОНИТЕЛЬНЫЕ. Гарнизон живёт статом `defense`, поэтому на
 * землю идёт тяжёлый пехотинец, а танк остаётся на борту — он полезнее там, где им
 * будут бить. Тай-брейк по имени: решение бота обязано быть чистой функцией состояния.
 */
export function pickForGarrison(
  carried: readonly UnitStack[],
  need: number,
  data: GameData,
): UnitStack[] {
  if (need <= 0) return [];
  const rows = carried
    .filter((st) => st.count > 0 && data.units[st.unit]?.domain === 'ground')
    .map((st) => ({
      unit: st.unit,
      count: st.count,
      defense: data.units[st.unit]?.stats.defense ?? 0,
    }))
    .filter((row) => row.defense > 0)
    .sort((a, b) => b.defense - a.defense || (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0));
  const out: UnitStack[] = [];
  let left = need;
  for (const row of rows) {
    if (left <= 0) break;
    const take = Math.min(row.count, Math.ceil(left / row.defense));
    if (take > 0) {
      out.push({ unit: row.unit, count: take });
      left -= take * row.defense;
    }
  }
  return out;
}
