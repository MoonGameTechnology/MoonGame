import type { GameData } from '../data/schemas';
import type { UnitStack } from './gameState';

/**
 * МЕДАЛИ ВЕТЕРАНА: два числа со стека → две награды со степенями (VET-3).
 *
 * Решения владельца 4-6: у медали есть СТЕПЕНЬ, степень зависит от нанесённого урона и от
 * числа пройденных сражений, и чем выше степень, тем выше награда за сохранение юнита.
 *
 * Функция ЧИСТАЯ и живёт в `state/`, а не в модуле, потому что читателей у неё трое и они
 * в разных слоях: выплата в конце матча (VET-4, ядро), карточка юнита (VET-5, оба клиента)
 * и сам этот тест. Правило «сколько урона на какую степень» обязано у них совпадать до
 * единицы — иначе игрок увидит в карточке «Багровую звезду», а заплатят ему за «Искру»,
 * и разойдётся это МОЛЧА, без единого падающего теста.
 *
 * Грейд в состоянии НЕ лежит — он вычисляется. Значит пороги можно перебалансировать на
 * живом матче, ничего не мигрируя.
 */

/** Линии медалей. Порядок ЗНАЧИМ: это порядок строк в карточке юнита, и он не имеет
 *  права зависеть от того, какая медаль оказалась выше степенью. */
export const MEDAL_LINES = ['valour', 'service'] as const;
export type MedalLine = (typeof MEDAL_LINES)[number];

/** Какое число со стека читает каждая линия. Здесь и нигде больше: связь «линия ↔ поле»
 *  названа один раз, поэтому добавить третью линию — это строка тут и строка в данных. */
const LINE_SOURCE: Readonly<Record<MedalLine, (stack: UnitStack) => number>> = {
  valour: (stack) => stack.damageDealt ?? 0,
  service: (stack) => stack.battles ?? 0,
};

/** Одна медаль на юните: какая линия, какая степень и по какому ключу её звать. */
export interface MedalAward {
  line: MedalLine;
  /** 1..N, где N — длина шкалы линии в данных. Нуля не бывает: нет медали — нет и записи. */
  grade: number;
  /** Ключ локализации имени (`medal.valour.3` → «Багровая звезда»). Собирается ЗДЕСЬ, а не
   *  у каждого клиента своим шаблоном: два шаблона разъехались бы на первой же правке. */
  key: string;
}

/**
 * Степень линии по величине заслуги: номер последнего перешагнутого порога, или `0`, если
 * не перешагнут ни один. Границы ВКЛЮЧАЮЩИЕ — ровно на пороге медаль уже есть.
 */
export function medalGrade(value: number, grades: readonly number[]): number {
  let grade = 0;
  for (const [i, threshold] of grades.entries()) {
    if (value >= threshold) grade = i + 1;
  }
  return grade;
}

/**
 * Медали стека — в фиксированном порядке линий, без пропущенных степеней и без нулей.
 *
 * Линия, которой нет в данных, наград не даёт: снять `data.medals` значит выключить
 * механику целиком, без единого флага в коде.
 */
export function medalsOf(stack: UnitStack, data: GameData): MedalAward[] {
  const awards: MedalAward[] = [];
  for (const line of MEDAL_LINES) {
    const scale = data.medals[line];
    if (!scale) continue;
    const grade = medalGrade(LINE_SOURCE[line](stack), scale.grades);
    if (grade > 0) awards.push({ line, grade, key: `medal.${line}.${grade}` });
  }
  return awards;
}
