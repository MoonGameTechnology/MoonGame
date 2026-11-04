/** Creation is offered only after an explicit successful server grant. Missing
 * endpoints, malformed bodies and failures never turn into permission. */
export function matchCreationAllowed(reply: { status: number; body: unknown } | null): boolean {
  if (reply?.status !== 200) return false;
  const body = reply.body;
  return body !== null && typeof body === 'object' && !Array.isArray(body) &&
    Object.hasOwn(body, 'canCreate') && (body as { canCreate?: unknown }).canCreate === true;
}

/** Что сервер позволяет настроить в новой партии. Пусто — только карта. */
export interface MatchCreationSettings {
  readonly speeds: readonly number[];
  readonly defaultSpeed: number | null;
  readonly goldActions: boolean;
}

const NO_SETTINGS: MatchCreationSettings = { speeds: [], defaultSpeed: null, goldActions: false };

/** Настройки из ответа `/matches/capabilities`. Кривое поле не превращается в выбор:
 *  неположительная или дробная скорость отбрасывается, флаг золота — только `true`. */
export function matchCreationSettings(body: unknown): MatchCreationSettings {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return NO_SETTINGS;
  const raw = (body as { settings?: unknown }).settings;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return NO_SETTINGS;
  const s = raw as { speeds?: unknown; defaultSpeed?: unknown; goldActions?: unknown };
  const speed = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
  const speeds = Array.isArray(s.speeds) ? [...new Set(s.speeds.filter(speed))].sort((a, b) => a - b) : [];
  return {
    speeds,
    defaultSpeed: speed(s.defaultSpeed) && speeds.includes(s.defaultSpeed) ? s.defaultSpeed : null,
    goldActions: s.goldActions === true,
  };
}
