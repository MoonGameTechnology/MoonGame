import type { SeenSortie, UnitStack } from '../packages/shared-core/src/index';

/**
 * ЧУЖАЯ ЭСКАДРА В ПОЛЁТЕ НА КАРТЕ (резолюция владельца 2026-11-06: «в зоне прямой видимости
 * их видно, в зоне радара только сигнал»). Кого видно, решает ядро (`sortiesSeenBy`): в
 * сети — проекция сервера (`seenSorties`), в соло — то же правило по полному миру. Здесь
 * только то, где рисовать значок в этом кадре.
 *
 * 1. **Ход между снимками — по скорости.** Проекция даёт точку на `state.time` и скорость
 *    за минуту мира, а не базу и цель: их зритель не видит. Значок идёт от точки снимка по
 *    этой скорости, пока не придёт следующий.
 * 2. **Не дальше {@link MAX_GLIDE_MS}.** Снимок задержался — значок не уходит по прямой в
 *    никуда, а замирает: эскадра могла повернуть, сесть или погибнуть.
 * 3. **Кадр раньше снимка значок назад не тянет:** время до снимка считается нулём.
 * 4. **Нос — по скорости.** Стоящая эскадра (срок ноги вышел) смотрит вверх.
 */

/** Сколько мира значок проходит сам, без нового снимка (правило 2). */
export const MAX_GLIDE_MS = 30 * 60_000;

/** Один значок чужой эскадры: где, куда смотрит и сколько в ней машин. */
export interface SeenSortieMark {
  owner: string;
  at: { x: number; y: number };
  /** Угол курса в радианах (0 — вправо, по часовой на экране). */
  heading: number;
  leg: SeenSortie['leg'];
  machines: number;
  units: ReadonlyArray<Pick<UnitStack, 'unit' | 'count'>>;
}

/** Значки чужих эскадр на миг `now` по снимку, снятому на `snapshotAt`. */
export function seenSortieMarks(
  sorties: readonly SeenSortie[] | undefined,
  snapshotAt: number,
  now: number,
): SeenSortieMark[] {
  const minutes = Math.min(Math.max(0, now - snapshotAt), MAX_GLIDE_MS) / 60_000; // правила 2–3
  return (sorties ?? []).map((s) => {
    const { x: vx, y: vy } = s.velocity;
    return {
      owner: s.owner,
      at: { x: s.at.x + vx * minutes, y: s.at.y + vy * minutes },
      heading: vx === 0 && vy === 0 ? -Math.PI / 2 : Math.atan2(vy, vx), // правило 4
      leg: s.leg,
      machines: s.units.reduce((n, u) => n + Math.max(0, u.count), 0),
      units: s.units,
    };
  });
}
