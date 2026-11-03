/**
 * Казна корпорации во вкладке хаба (CORP-3): движение влияния и доход в сутки.
 *
 * Сервер не держит отдельной ведомости казны: движение влияния лежит в журнале корпорации
 * (`GET /corps/:id/audit`, от новых к старым) среди приёма заявок и смены ролей. Здесь
 * из журнала выбирается то, что меняло казну.
 *
 * 1. **Только то, что меняло казну:** доход зданий, оплата стройки и влияние битв (вызов,
 *    победа, возврат вызова). Окончание стройки, аренда снаряжения и бесплатная стройка
 *    казну не трогают — в движении влияния их нет.
 * 2. **Доход зданий — одной строкой на отрезок.** Сервер записывает его при каждом чтении
 *    базы мелкими долями; доли подряд (между другими движениями) складываются в одну
 *    строку со временем самой свежей — иначе журнал пришлось бы листать ради «+1 ⟡».
 * 3. **Сумма влияния битв — только из числа записи:** `n` в `{"n":…,"kind":…}` (CORP-19)
 *    или число в начале старой записи (`+150: …`). Запись без числа выпадает: неизвестная
 *    сумма в казне хуже пропуска.
 * 4. **Доход в сутки — по зданиям**, чтобы было видно, откуда он берётся.
 */
import type { CorpInfrastructureView } from '../packages/protocol/src/corpInfrastructure';

/** Запись журнала корпорации — в той форме, в какой её отдаёт сервер. */
export interface CorpJournalEntry {
  at: number;
  action: string;
  target?: string;
  detail?: string;
}

/** Строка «Движения влияния». `delta` — со знаком. */
export type CorpLedgerRow =
  | { kind: 'income'; at: number; delta: number }
  | { kind: 'build'; at: number; delta: number; buildingId: string; level: number }
  | { kind: 'battle'; at: number; delta: number };

/** Доля здания в доходе за сутки. */
export interface CorpIncomePart {
  buildingId: string;
  nameKey: string;
  perDay: number;
}

const amount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

/** Правила 1–3: движение влияния, от новых к старым, как и журнал. */
export function corpLedger(journal: readonly CorpJournalEntry[]): CorpLedgerRow[] {
  const out: CorpLedgerRow[] = [];
  for (const e of journal) {
    if (e.action === 'building_income') {
      const n = Number(e.detail);
      if (!amount(n) || n <= 0) continue;
      const last = out[out.length - 1];
      if (last?.kind === 'income') last.delta += n;
      else out.push({ kind: 'income', at: e.at, delta: n });
    } else if (e.action === 'building_start') {
      let detail: { level?: unknown; cost?: unknown } | null;
      try {
        detail = JSON.parse(e.detail ?? '') as { level?: unknown; cost?: unknown } | null;
      } catch {
        continue;
      }
      if (!e.target || !detail || !amount(detail.level) || !amount(detail.cost)) continue;
      if (detail.cost <= 0) continue;
      out.push({
        kind: 'build',
        at: e.at,
        delta: -detail.cost,
        buildingId: e.target,
        level: detail.level,
      });
    } else if (e.action === 'influence') {
      const n = influenceEntry(e.detail)?.n ?? NaN;
      if (amount(n) && n !== 0) out.push({ kind: 'battle', at: e.at, delta: n });
    }
  }
  return out;
}

/** Почему двигалось влияние (CORP-19): сервер пишет только структуру, слова — ключ локали. */
export type InfluenceKind = 'challenge' | 'refund' | 'win' | 'start';
/** Ключ локали строки журнала по причине; `{n}` — сумма со знаком, `{corp}` — соперник. */
export const INFLUENCE_AUDIT_KEY: Record<InfluenceKind, string> = {
  challenge: 'corp.audit.influence.challenge',
  refund: 'corp.audit.influence.refund',
  win: 'corp.audit.influence.win',
  start: 'corp.audit.influence.start',
};
const INFLUENCE_KINDS: readonly string[] = Object.keys(INFLUENCE_AUDIT_KEY);

/** Запись `influence` журнала: `{"n":…,"kind":…,"ref"?:…}`, а у старых записей — `+150: …`
 *  (сумма без причины, `kind` тогда нет). Неразборчивая запись — null. */
export function influenceEntry(
  detail: string | undefined,
): { n: number; kind?: InfluenceKind; ref?: string } | null {
  const legacy = /^([+-]\d+)(?::|$)/.exec(detail ?? '');
  if (legacy) return { n: Number(legacy[1]) };
  try {
    const d = JSON.parse(detail ?? '') as { n?: unknown; kind?: unknown; ref?: unknown } | null;
    if (!d || !amount(d.n) || typeof d.kind !== 'string' || !INFLUENCE_KINDS.includes(d.kind))
      return null;
    return {
      n: d.n,
      kind: d.kind as InfluenceKind,
      ...(typeof d.ref === 'string' ? { ref: d.ref } : {}),
    };
  } catch {
    return null;
  }
}

/** Правило 4: доход в сутки по зданиям текущих уровней. */
export function corpIncomeParts(view: CorpInfrastructureView): CorpIncomePart[] {
  const out: CorpIncomePart[] = [];
  for (const b of view.buildings) {
    const perDay = b.levels[b.level - 1]?.influencePerDay ?? 0;
    if (perDay > 0) out.push({ buildingId: b.id, nameKey: b.nameKey, perDay });
  }
  return out;
}
