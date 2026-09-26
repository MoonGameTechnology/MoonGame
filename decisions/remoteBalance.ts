/**
 * Удалённый конфиг баланса (`YAG-6.3`): флаги площадки → ЧИСЛА каталога игры.
 *
 * Зачем. Правка баланса через новую сборку проходит модерацию площадки, а это 3–5 рабочих
 * дней. Флаги (`ysdk.getFlags()`) меняются в консоли без пересдачи — для цели «проверить
 * баланс на живых игроках» это итерация в день вместо итерации в неделю.
 *
 * ## Флаг крутит ЧИСЛО, а не правило
 *
 * Граница кирпича: удалённое состояние не имеет права решать, КАК устроен мир, — иначе
 * детерминизм и тесты будут зависеть от того, что сегодня стоит в консоли. Поэтому флаги
 * не адресуют каталог путём («modes.pve_waves.pve.npcFaction» ничего не сделает): имя
 * флага — ключ закрытого списка {@link BALANCE_FLAGS}, и у каждого ключа свои путь,
 * границы и целочисленность. Флага нет в списке — он не читается вовсе.
 *
 * ## Любая ошибка = умолчание поставки
 *
 * Площадка отдаёт значения строками, и строка бывает любой. Не число, не целое там, где
 * нужно целое, вне границ — флаг отбрасывается, и число остаётся тем, что лежит в
 * `data/*.json`. Нет поля в каталоге (режим переименовали, у режима нет босса) — флаг тоже
 * ничего не создаёт: он заменяет существующее число, а не дописывает новое. Границы при
 * этом держат и схему каталога (`waves` — целое положительное), поэтому повторная проверка
 * zod после подстановки не нужна.
 *
 * ## Когда числа применяются
 *
 * Один раз, при загрузке каталога — до первого забега сессии. Забег, продолженный после
 * смены флагов, доигрывает уже назначенные события (следующая волна, конец удержания) по
 * прежним числам, а следующие — по новым: назначенное событие в мире не пересчитывается.
 */
import type { GameData } from '../packages/shared-core/src/index';

/** Одна ручка баланса: где лежит число и в каких пределах его можно крутить. */
export interface BalanceKnob {
  /** Путь в каталоге игры. Последний сегмент — поле с числом. */
  path: readonly string[];
  min: number;
  max: number;
  integer: boolean;
}

/** Режим глав Sector Zero — все три карты играются под ним (`data/maps/pve-*.json`). */
const PVE = ['modes', 'pve_waves', 'pve'] as const;

/**
 * Закрытый список флагов. Имена — `snake_case` без точек: так их без сюрпризов примет
 * консоль площадки. Границы — «разумная рамка для живого эксперимента», а не баланс:
 * они не дают опечатке в консоли сделать главу из одной волны или нулевого удержания.
 */
export const BALANCE_FLAGS: Readonly<Record<string, BalanceKnob>> = {
  /** Сколько волн в главе — длина атаки. */
  pve_waves: { path: [...PVE, 'waves'], min: 1, max: 30, integer: true },
  /** Игровых часов между волнами. */
  pve_wave_interval_hours: { path: [...PVE, 'waveIntervalHours'], min: 1, max: 48, integer: false },
  /** Сколько часов выстоять после последней волны (PVR-2.5). */
  pve_hold_hours: { path: [...PVE, 'holdHours'], min: 1, max: 72, integer: false },
  /** Доля скорости кораблей Роя в экспедиции (PVR-6.28). Схема режима держит её ≤ 1:
   *  Рой можно замедлить, но не ускорить сверх обычной скорости. */
  pve_swarm_speed: { path: [...PVE, 'npcSpeedFactor'], min: 0.25, max: 1, integer: false },
  /** Награда за убитого босса (PVR-4.7), в единицах награды забега. */
  pve_boss_reward: { path: [...PVE, 'boss', 'reward'], min: 0, max: 50, integer: true },
};

/** Разобранные флаги: только известные ключи с допустимыми значениями. */
export type BalanceOverrides = Readonly<Record<string, number>>;

/** Значение флага → число ручки; `null` — флаг отбрасывается. */
function knobValue(knob: BalanceKnob, raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  if (knob.integer && !Number.isInteger(value)) return null;
  if (value < knob.min || value > knob.max) return null;
  return value;
}

/** Флаги площадки как пришли (объект строк или что угодно) → проверенные числа. */
export function parseBalanceFlags(raw: unknown): BalanceOverrides {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [name, knob] of Object.entries(BALANCE_FLAGS)) {
    if (!Object.prototype.hasOwnProperty.call(raw, name)) continue;
    const value = knobValue(knob, (raw as Record<string, unknown>)[name]);
    if (value !== null) out[name] = value;
  }
  return out;
}

type Json = Record<string, unknown>;

/** Копия `node` с числом по `path`, если число там уже есть; иначе `node` как был. */
function withNumber(node: unknown, path: readonly string[], value: number): unknown {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
  const [head, ...rest] = path as [string, ...string[]];
  if (!Object.prototype.hasOwnProperty.call(node, head)) return node;
  const current = (node as Json)[head];
  if (rest.length === 0) {
    return typeof current === 'number' ? { ...(node as Json), [head]: value } : node;
  }
  const next = withNumber(current, rest, value);
  return next === current ? node : { ...(node as Json), [head]: next };
}

/**
 * Каталог с числами из флагов. Вход не меняется: правка идёт копией по пути, всё
 * остальное — те же объекты. Пустые флаги — тот же каталог.
 */
export function applyBalanceFlags(data: GameData, overrides: BalanceOverrides): GameData {
  let out: unknown = data;
  for (const [name, value] of Object.entries(overrides)) {
    if (!Object.prototype.hasOwnProperty.call(BALANCE_FLAGS, name)) continue;
    const knob = BALANCE_FLAGS[name]!;
    if (knobValue(knob, value) === null) continue;
    out = withNumber(out, knob.path, value);
  }
  return out as GameData;
}
