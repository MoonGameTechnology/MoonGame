/**
 * Прогноз в окне боя (UIX-6.2, UIX-6.3) — «чем кончится этот бой для меня», по живому составу.
 *
 * Считает не этот модуль: исход, раунды и доли потерь даёт `previewSides` ядра — тот же
 * раунд, что у живого боя, и та же цепочка пересцепок после гибели. Слова, тон и проценты —
 * карточка прицела «Атаки» (`engageForecast.ts`, UIX-6.1): один прогноз говорит одними
 * словами на обоих экранах. Прицел и зовёт этот модуль, подавая каждый выделенный флот
 * своей стороной.
 *
 * 1. **Сторон сколько угодно, вердикт — моей колонке.** Своя колонка окна — мои стороны и
 *    союзники. Победа: враждебных мне не осталось, а кто-то из своей колонки стоит, даже
 *    если мои корабли пали (решение владельца 2026-10-01: победа есть победа, потери её
 *    ничьей не делают — они стоят в карточке отдельной цифрой). Поражение: своя колонка
 *    пала, а враг стоит. Остальное — ничья: предохранитель развёл бойцов, пали все или
 *    устоял лишь сосед, который мне не союзник и не враг. Многосторонний бой кончается
 *    не первой гибелью, а цепочкой (§0.0 №5 `multiside-combat-roadmap.md`), и прогноз
 *    досчитывает её до конца.
 * 2. **Меня в бою нет — вердикта нет.** «Победа» и «поражение» бывают только у своей
 *    стороны; чужую схватку окно показывает без прогноза. Врага у меня в бою нет
 *    (помирились) — тоже нет.
 * 3. **Считается от ТЕКУЩЕГО состава.** В стеках боя лежит остаток корпуса (`hp`), и ядро
 *    его читает: прогноз на пятом раунде считается с пятого раунда. Поэтому он и
 *    обновляется каждый раунд без своего таймера: новый раунд — новый состав. Потери —
 *    доля ТЕКУЩЕГО корпуса, у нескольких сторон — их общего корпуса.
 * 4. **Роль — у стороны.** Обороняющийся отвечает `defense`, перешедший в атаку бьёт
 *    `attack`: тот же бой меняет исход, когда враг нажал «В атаку».
 *
 * Туман — как в UIX-6.1: в прогноз идут только составы, которые окно и так показывает;
 * скрытые бонусы врага (технологии, пассивы, ауры) прогноз не видит (шапка `previewBattle`).
 */
import {
  getStance,
  hullPool,
  previewSides,
  type GameData,
  type GameState,
  type UnitStack,
} from '../packages/shared-core/src/index';
import { engageForecastCard, type EngageForecastCard } from './engageForecast';

/** Сторона боя — то, что прогнозу нужно из модели окна. */
export interface ForecastSide {
  mine: boolean;
  /** Союзник — сторона в моей колонке окна: его победа — моя победа (правило 1). */
  ally?: boolean;
  role: 'attacker' | 'defender';
  /** Текущий состав: стеки вместе с остатком корпуса (`hp`). */
  units: readonly UnitStack[];
  /** Владелец: по нему спрашивается вражда сторон. */
  owner: string | null;
  /** Id флота — по нему живой бой сцепляет выживших заново (`previewSides`). */
  key?: string;
  /** Сторона держит мир — гарнизон наземного боя. */
  holds?: boolean;
}

/** Враждебны ли два владельца. */
export type Hostility = (a: string | null | undefined, b: string | null | undefined) => boolean;

/**
 * Вражда сторон так, как её спрашивает залп живого боя (`sidesHostile`, `combat.ts`):
 * два игрока — враги, только если между ними война; ничейный враждебен всякому, кроме
 * ничейного. Стойки в тумане видны всем, поэтому клиент спрашивает их у своего состояния.
 */
export function battleHostility(state: GameState): Hostility {
  return (a, b) => a !== b && (a == null || b == null || getStance(state, a, b) === 'war');
}

const alive = (units: readonly UnitStack[]): boolean => units.some((u) => u.count > 0);

/** Прогноз для игрока, либо `null`: меня или моего врага в бою нет (правило 2), бой уже
 *  решён. Без `hostile` враждебны все разные владельцы — так считает ядро без дипломатии. */
export function battleForecast(
  sides: readonly ForecastSide[],
  data: GameData,
  hostile: Hostility = (a, b) => a !== b,
): EngageForecastCard | null {
  const me = sides.find((s) => s.mine);
  if (!me || sides.some((s) => !alive(s.units))) return null;
  const mine = sides.flatMap((s, i) => (s.mine ? [i] : []));
  const ours = sides.flatMap((s, i) => (s.mine || s.ally ? [i] : []));
  const foes = sides.flatMap((s, i) =>
    !s.mine && !s.ally && hostile(me.owner, s.owner) ? [i] : [],
  );
  if (foes.length === 0) return null;
  const sim = previewSides(sides, data, hostile);
  const standing = (idx: number[]): boolean => idx.some((i) => alive(sim.sides[i]!.survivors));
  /** Доля общего корпуса сторон `idx`, которую прогноз теряет (правило 3). */
  const lost = (idx: number[]): number => {
    let before = 0;
    let after = 0;
    for (const i of idx) {
      before += hullPool(sides[i]!.units, data);
      after += hullPool(sim.sides[i]!.survivors, data);
    }
    return before > 0 ? 1 - after / before : 0;
  };
  const won = standing(ours) && !standing(foes);
  const beaten = !standing(ours) && standing(foes);
  // В карточке прицела «атакующий» — это игрок, какую бы роль ни несла его сторона.
  return engageForecastCard({
    outcome: won ? 'attacker' : beaten ? 'defender' : 'stalemate',
    roundsEst: sim.roundsEst,
    attacker: { damageFraction: lost(mine) },
    defender: { damageFraction: lost(foes) },
  });
}
