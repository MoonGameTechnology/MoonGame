import type { RegistrationReward } from '../packages/protocol/src/playerProfile';

/** Only the known server receipt may open the welcome award. XP is the actual grant,
 * not a calculation from the current total or the client clock. */
export function parseRegistrationReward(raw: unknown): RegistrationReward | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (
    value.medalId !== 'contribution' ||
    value.grade !== 3 ||
    typeof value.accepted !== 'boolean' ||
    typeof value.xp !== 'number' ||
    !Number.isSafeInteger(value.xp) ||
    value.xp < 0
  )
    return null;
  return { medalId: value.medalId, grade: value.grade, xp: value.xp, accepted: value.accepted };
}
