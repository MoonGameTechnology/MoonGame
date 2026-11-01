/**
 * Архив донесений шпионажа (SPY-20): последние итоги операций во вкладке «Шпионаж»,
 * отдельно от общего журнала, где они тонут среди боёв и стройки. Само правило операций —
 * в ядре (`espionageModule`); здесь только что положить в архив и как его хранить.
 *
 * 1. **Двадцать записей, новые сверху.** Двадцать первая выталкивает самую старую.
 * 2. **Запись знает мир и операцию.** Мир и вид операции берутся из события, а не из
 *    текста: с записи можно перейти к миру, и значок операции не зависит от языка.
 *    События без мира (провал называет только жертву) записываются без перехода.
 * 3. **Текст уже переведён.** Архив хранит строку, которую игрок прочёл в момент события.
 *    Смена языка старые записи не переводит: их параметры (имена миров, добыча) — та же
 *    прочитанная строка, а не ключ.
 * 4. **Архив едет вместе с сейвом.** Он переживает перезагрузку схватки. Повреждённый архив
 *    в сейве — не архив: {@link parseSpyArchive} отвечает `null`, и сейв отвергается целиком,
 *    как при любой другой порче (`soloSave.ts`). Сейв без архива (записан до SPY-20)
 *    открывается с пустым архивом.
 */
import { SPY_OP_COST, type SpyOp } from '../packages/shared-core/src/index';

export const SPY_ARCHIVE_MAX = 20;

export interface SpyRecord {
  /** Игровое время события. */
  at: number;
  /** Уже локализованная строка донесения. */
  text: string;
  /** Мир операции, если событие его называет. */
  planetId?: string;
  /** Вид операции, если событие его называет. */
  op?: SpyOp;
}

const OPS: ReadonlySet<string> = new Set(Object.keys(SPY_OP_COST));
const isOp = (x: unknown): x is SpyOp => typeof x === 'string' && OPS.has(x);

/** Вид операции по событию: ядро пишет его в `op` (отправка) или `kind` (итог); события
 *  разведки и контрразведки называют операцию самим своим типом. */
function opOf(type: string, payload: Record<string, unknown>): SpyOp | undefined {
  if (isOp(payload.op)) return payload.op;
  if (isOp(payload.kind)) return payload.kind;
  if (type.startsWith('intel.')) return 'recon';
  if (type.startsWith('espionage.counter.') || type === 'espionage.posted') return 'counter';
  return undefined;
}

/** Запись архива из события ядра и строки, которую по нему прочёл игрок. */
export function spyRecordOf(
  type: string,
  payload: Record<string, unknown>,
  at: number,
  text: string,
): SpyRecord {
  const op = opOf(type, payload);
  return {
    at,
    text,
    ...(typeof payload.planetId === 'string' ? { planetId: payload.planetId } : {}),
    ...(op ? { op } : {}),
  };
}

/** Новый архив: запись сверху, сверх {@link SPY_ARCHIVE_MAX} срезано. */
export function pushSpyRecord(archive: readonly SpyRecord[], record: SpyRecord): SpyRecord[] {
  return [record, ...archive].slice(0, SPY_ARCHIVE_MAX);
}

/** Значок операции в строке архива. */
export function spyOpGlyph(op: SpyOp | undefined): string {
  switch (op) {
    case 'recon':
      return '🔭';
    case 'theft':
      return '💰';
    case 'sabotage':
      return '💥';
    case 'delay':
      return '⏸';
    case 'disrupt':
      return '📉';
    case 'research':
      return '🧪';
    case 'counter':
      return '🛡';
    default:
      return '🕵';
  }
}

const optString = (x: unknown) => x === undefined || typeof x === 'string';

/** Архив из сейва. `undefined` (сейв до SPY-20) — пустой архив; что угодно другое кроме
 *  списка честных записей — `null`. Лишнее сверх потолка срезается. */
export function parseSpyArchive(raw: unknown): SpyRecord[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const ok = raw.every((r: unknown) => {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) return false;
    const x = r as Record<string, unknown>;
    return (
      typeof x.at === 'number' &&
      Number.isFinite(x.at) &&
      x.at >= 0 &&
      typeof x.text === 'string' &&
      optString(x.planetId) &&
      (x.op === undefined || isOp(x.op))
    );
  });
  return ok ? (raw as SpyRecord[]).slice(0, SPY_ARCHIVE_MAX) : null;
}
