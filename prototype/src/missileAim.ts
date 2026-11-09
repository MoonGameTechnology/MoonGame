/**
 * Взвести прицел пуска ракет (missiles-roadmap): тот же прицел, что у удара челноков, —
 * круг дальности ракеты и тап по чужому флоту или миру (`mapInput.ts`). «Пуск» шлёт одну
 * ракету, «Залп» — всю эскадру, но не больше `MISSILE_SALVO` за приказ (предел ядра).
 */
import { t } from '../../localization/runtime';
import { MISSILE_SALVO, type Squadron } from '../../packages/shared-core/src/index';
import { note } from './eventFeed';
import { arm } from './interaction';

export function armMissileAim(
  found: { sq: Squadron; base: { planetId: string } | { fleetId: string } } | null,
  squadronId: string,
  salvo: boolean,
): void {
  if (!found) return;
  const all = found.sq.units.reduce((n, st) => n + Math.max(0, st.count), 0);
  const count = salvo ? Math.min(MISSILE_SALVO, all) : 1;
  arm('strikeAim', { from: found.base, squadronId, missile: count });
  note(t('hint.missile-aim', { n: count }));
}
