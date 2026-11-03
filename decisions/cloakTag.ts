/**
 * Метка маскировочного поля на карточке СВОЕГО флота (SM-4.3): сила поля в процентах и
 * срыв. Таймер возврата — только когда поле сорвано на время после боя, обстрела или
 * вылета шаттлов; пока идёт бой или обстрел, срок неизвестен, и метка говорит «сорвана».
 */
import {
  cloakBroken,
  fleetCloakRating,
  type Fleet,
  type GameData,
  type GameState,
} from '../packages/shared-core/src/index';

export interface CloakFacts {
  pct: number;
  broken: boolean;
  brokenUntil: number | null;
}

export function cloakFacts(s: Pick<GameState, 'time'>, f: Fleet, data: GameData): CloakFacts | undefined {
  const rating = fleetCloakRating(f, data);
  if (rating <= 0) return undefined;
  const broken = cloakBroken(s, f);
  const waiting = broken && !f.battleId && !f.bombarding && (f.cloakBrokenUntil ?? 0) > s.time;
  return { pct: Math.round(rating * 100), broken, brokenUntil: waiting ? f.cloakBrokenUntil! : null };
}
