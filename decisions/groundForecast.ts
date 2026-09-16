// ПРОГНОЗ НАЗЕМНОГО БОЯ — «возьму ли я этот мир и какой ценой».
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Правила бота (решение владельца 2026-09-16) запрещают
// высаживать десант вслепую: сперва он обязан ЗНАТЬ гарнизон и быть уверенным, что
// возьмёт мир. Значит нужна оценка исхода — а её в проекте не было ни в каком виде.
//
// ЗДЕСЬ НЕ ПЕРЕПИСАНО НИ ОДНО ПРАВИЛО БОЯ. Залп считает `cappedUnitStat` ядра (тот же
// кап линии огня, тот же порядок), развеску урона по стекам — `damageUnits` ядра (те же
// линии `front/mid/rear` и те же доли). Копия этих правил разошлась бы с боем молча:
// бот считал бы одно, а мир разыгрывал другое, и первым признаком была бы не ошибка, а
// тихо изменившийся баланс.
//
// ЧЕГО ПРОГНОЗ НЕ ВИДИТ — и это названо, а не спрятано: смягчения хука `combat.damage`
// (укрепления, местность, тип планеты, ауры героя). На земле хук открыт только
// ОБОРОНЯЮЩЕМУСЯ, поэтому прогноз систематически оптимистичен для атакующего. Ровно
// поэтому «победил в прогнозе» и «уверен» — РАЗНЫЕ ответы: `confidentGroundWin` даёт
// обороне фору {@link DEFENDER_EDGE} и спрашивает уже с ней.
//
// Лежит в `/decisions`, а не в `prototype/src`: оценку «возьму ли я мир» одинаково
// захотят показать оба клиента (бот сегодня, подсказка игроку завтра), а две копии
// такого правила разойдутся на первой же правке.
import { cappedUnitStat, deepClone } from '../packages/shared-core/src/index';
// Глубокий импорт: и предохранитель раундов, и развеска урона живут в `util/combat`, а
// наружу `index` отдаёт из него не всё. Брать их оттуда, где они объявлены, честнее,
// чем заводить копию ради красивого импорта.
import { damageUnits, MAX_COMBAT_ROUNDS } from '../packages/shared-core/src/util/combat';
import type { GameData, UnitStack } from '../packages/shared-core/src/index';

/**
 * Фора обороне в проверке уверенности — за то, чего прогноз не видит (см. шапку).
 * Полтора: смягчения на земле сегодня дают защитнику десятки процентов, а не разы,
 * и запас в половину залпа покрывает их с полем.
 */
export const DEFENDER_EDGE = 1.5;

export interface GroundForecast {
  /** Кто останется на ногах. `draw` — предохранитель раундов, как у ядра. */
  winner: 'attacker' | 'defender' | 'draw';
  /** Раундов до исхода; раунд — игровой час. Ноль значит «боя не было». */
  rounds: number;
  /** Сколько машин останется у атакующего. */
  attackerSurvivors: number;
  /** Сколько машин останется у обороны. */
  defenderSurvivors: number;
}

const alive = (units: readonly UnitStack[]): number =>
  units.reduce((n, st) => n + (st.count > 0 ? st.count : 0), 0);

export interface ForecastOptions {
  /** Во сколько раз усилить залп ОБОРОНЫ. `1` — честный прогноз. */
  defenderEdge?: number;
}

/**
 * Разыграть наземный бой на бумаге. Раунд ОДНОВРЕМЕННЫЙ и считается из предраундового
 * снимка — тем же порядком, что и `combat.tick`: иначе сторона, обсчитанная первой,
 * била бы по уже подбитым, и прогноз расходился бы с боем на ровном месте.
 *
 * Входные стеки НЕ меняются: `damageUnits` правит массив на месте, поэтому копия
 * делается здесь. Прогноз, портящий состояние, которым его кормят, — это баг, который
 * проявится далеко от места вызова.
 */
export function forecastGround(
  attackers: readonly UnitStack[],
  defenders: readonly UnitStack[],
  data: GameData,
  opts: ForecastOptions = {},
): GroundForecast {
  const edge = opts.defenderEdge ?? 1;
  let att: UnitStack[] = deepClone(attackers as UnitStack[]);
  let def: UnitStack[] = deepClone(defenders as UnitStack[]);
  // Некого послать — мир не берётся, даже пустой: захват делают ВОЙСКА.
  if (alive(att) <= 0) {
    return { winner: 'defender', rounds: 0, attackerSurvivors: 0, defenderSurvivors: alive(def) };
  }
  if (alive(def) <= 0) {
    return { winner: 'attacker', rounds: 0, attackerSurvivors: alive(att), defenderSurvivors: 0 };
  }
  let rounds = 0;
  while (rounds < MAX_COMBAT_ROUNDS) {
    rounds += 1;
    const aVolley = cappedUnitStat(att, data, 'attack');
    const dVolley = cappedUnitStat(def, data, 'defense') * edge;
    att = damageUnits(att, dVolley, data).survivors;
    def = damageUnits(def, aVolley, data).survivors;
    const aLeft = alive(att);
    const dLeft = alive(def);
    if (aLeft <= 0 || dLeft <= 0) {
      return {
        winner: aLeft > 0 ? 'attacker' : 'defender',
        rounds,
        attackerSurvivors: aLeft,
        defenderSurvivors: dLeft,
      };
    }
    // Обе стороны целы и ни одна не может убить другую — дальше крутить нечего.
    if (aVolley <= 0 && dVolley <= 0) break;
  }
  return {
    winner: 'draw',
    rounds,
    attackerSurvivors: alive(att),
    defenderSurvivors: alive(def),
  };
}

/**
 * УВЕРЕН ЛИ, что возьму мир. Строже простой победы: обороне даётся фора
 * {@link DEFENDER_EDGE} за смягчения, которых прогноз не видит.
 *
 * Fail-secure по смыслу правила владельца «не высаживать вслепую»: любой неясный исход
 * (ничья, победа впритык при форе) читается как «не уверен».
 */
export function confidentGroundWin(
  attackers: readonly UnitStack[],
  defenders: readonly UnitStack[],
  data: GameData,
): boolean {
  const f = forecastGround(attackers, defenders, data, { defenderEdge: DEFENDER_EDGE });
  return f.winner === 'attacker';
}
