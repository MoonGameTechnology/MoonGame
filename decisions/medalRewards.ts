/**
 * Награды за медали профиля в клиенте: какой ответ сервера можно показать игроку.
 *
 * 1. **Показывается только известная выдача.** Медаль из списка `PROFILE_MEDALS`, степень,
 *    которая у неё есть, суммы — целые неотрицательные числа. Хоть одна строка не такая —
 *    ответ целиком отвергается: окно не покажет выдумку, а сервер выдачу уже записал.
 * 2. **Пустая выдача — не повод для окна.** Пустой список разбирается, окно его не откроет.
 * 3. **Итог — сумма строк.** Клиент не пересчитывает награды по своей таблице: суммы —
 *    те, что заплатил сервер.
 */
import {
  PROFILE_MEDALS,
  type MedalGrade,
  type MedalRewardGrant,
} from '../packages/protocol/src/playerProfile';

export interface MedalRewardTotals {
  sovereigns: number;
  warrants: number;
  xp: number;
}

const amount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Список выдачи `POST /profiles/rewards/medals` или `null`, если он не годится (правило 1). */
export function parseMedalRewards(raw: unknown): MedalRewardGrant[] | null {
  if (!Array.isArray(raw)) return null;
  const grants: MedalRewardGrant[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') return null;
    const value = row as Record<string, unknown>;
    const medal = PROFILE_MEDALS.find((m) => m.id === value.medalId);
    const grade = value.grade;
    if (
      !medal ||
      (grade !== 1 && grade !== 2 && grade !== 3) ||
      medal.goals[3 - grade] === undefined ||
      !amount(value.sovereigns) ||
      !amount(value.warrants) ||
      !amount(value.xp)
    )
      return null;
    grants.push({
      medalId: medal.id,
      grade: grade as MedalGrade,
      sovereigns: value.sovereigns,
      warrants: value.warrants,
      xp: value.xp,
    });
  }
  return grants;
}

/** Итог выдачи (правило 3). */
export function medalRewardTotals(grants: readonly MedalRewardGrant[]): MedalRewardTotals {
  return grants.reduce(
    (sum, g) => ({
      sovereigns: sum.sovereigns + g.sovereigns,
      warrants: sum.warrants + g.warrants,
      xp: sum.xp + g.xp,
    }),
    { sovereigns: 0, warrants: 0, xp: 0 },
  );
}
