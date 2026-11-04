/** Настройки новой партии сверх карты и режима: скорость времени и действия за золото.
 *  Хост, который их не применяет, их и не объявляет, и тогда поле в теле — отказ, а не
 *  молча проигнорированное обещание. */
export interface MatchSettingsPolicy {
  /** Допустимые скорости; отсутствует — выбора скорости нет. */
  readonly speeds?: readonly number[];
  /** Скорость хоста по умолчанию (подсказка клиенту). */
  readonly defaultSpeed?: number;
  /** Хост принимает переключатель действий за золото. */
  readonly goldActions?: boolean;
}

export interface MatchSettings {
  readonly timeScale?: number;
  readonly goldActions?: boolean;
}

export type MatchSettingsResult =
  | { ok: true; settings: MatchSettings }
  | { ok: false; code: 'E_BAD_SPEED' | 'E_BAD_SETTINGS' };

/** Разобрать `timeScale` и `goldActions` из тела `POST /matches`. */
export function parseMatchSettings(
  body: Record<string, unknown> | undefined,
  policy: MatchSettingsPolicy,
): MatchSettingsResult {
  const settings: { timeScale?: number; goldActions?: boolean } = {};
  const speed = body?.timeScale;
  if (speed !== undefined) {
    if (typeof speed !== 'number' || !policy.speeds?.includes(speed)) return { ok: false, code: 'E_BAD_SPEED' };
    settings.timeScale = speed;
  }
  const gold = body?.goldActions;
  if (gold !== undefined) {
    if (typeof gold !== 'boolean' || !policy.goldActions) return { ok: false, code: 'E_BAD_SETTINGS' };
    settings.goldActions = gold;
  }
  return { ok: true, settings };
}

/** Скорости на выбор при создании: игровых часов за реальный час. Клиент получает
 *  список из `/matches/capabilities` и своего не держит. */
export const MATCH_SPEEDS: readonly number[] = [1, 2, 4, 8, 12, 24];

/** Скорости, которые объявляет хост: общий список плюс его собственная по умолчанию. */
export function hostSpeeds(defaultSpeed: number): number[] {
  return [...new Set([...MATCH_SPEEDS, defaultSpeed])].sort((a, b) => a - b);
}

/** Что объявляет хост прототипа: скорости вокруг своей и переключатель золота. */
export function hostMatchSettings(defaultSpeed: number): MatchSettingsPolicy {
  return { speeds: hostSpeeds(defaultSpeed), defaultSpeed, goldActions: true };
}

/** Закрепить выбор «действия за золото» в мире новой партии; не выбран — мир как есть. */
export function withGoldActions<S extends { match: object }>(state: S, goldActions: boolean | undefined): S {
  return goldActions === undefined ? state : { ...state, match: { ...state.match, goldActions } };
}
