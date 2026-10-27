/**
 * База корпорации во вкладке хаба (CORP-3): что показать о зданиях и уровне корпорации.
 *
 * Сервер (`GET /corps/:id/infrastructure`) отдаёт уровни зданий, казну, текущую стройку и
 * для каждого здания код отказа `blocked` — тот самый, которым он ответит на заказ. Здесь
 * решается всё между этим ответом и разметкой: какой уровень у корпорации, в каком
 * состоянии участок панорамы, что написать на карточке здания, что нужно для следующего
 * уровня и что он откроет. Текста здесь нет — фразу по ключу собирает экран.
 *
 * 1. **Уровень корпорации — это уровень штаба** (решение владельца 2026-10-21). Нет штаба в
 *    ответе — нет и уровня (`null`), а не «нулевой уровень».
 * 2. **Участок панорамы:** идёт стройка этого здания — «стройка»; уровень есть —
 *    «построено»; первый уровень доступен по штабу — «можно построить»; иначе «закрыто».
 * 3. **Строка под зданием читается в любой роли.** Не главе сервер отвечает одним
 *    `E_FORBIDDEN` и настоящей причины не называет, поэтому причину выводим из самих данных
 *    в том порядке, в каком она важна игроку: идёт стройка этого здания → уровень
 *    последний → нужен штаб выше → мало участников → мало сыгранных битв → очередь
 *    занята → не хватает влияния → можно. Участников и битвы (CORP-6) сервер считает сам
 *    и присылает вместе с базой.
 * 4. **Кнопку заказа включает только сервер:** `canBuild` и `blocked === null`. Вывод из
 *    пункта 3 её не включает, так что расхождение с сервером оставляет кнопку выключенной.
 * 5. **Что откроет уровень штаба** — уровни других зданий, которым нужен ровно он. Первый
 *    уровень здания — это новое здание, остальные — улучшения.
 */
import type {
  CorpBuildingLevel,
  CorpBuildingView,
  CorpInfrastructureView,
} from '../packages/protocol/src/corpInfrastructure';

/** Здание, чей уровень и есть уровень корпорации. */
export const CORP_HQ = 'headquarters';

/** Состояние участка на панораме базы. */
export type CorpLotState = 'built' | 'build' | 'open' | 'locked';

/** Строка состояния под карточкой здания. `first` — заказ первого уровня (постройка, а
 *  не улучшение). Время стройки — уже с поправкой инженерного комплекса. */
export type CorpBuildingStatus =
  | { kind: 'job'; level: number }
  | { kind: 'max' }
  | { kind: 'locked'; headquarters: number; first: boolean }
  | { kind: 'members'; need: number; have: number }
  | { kind: 'battles'; need: number; have: number }
  | { kind: 'busy' }
  | { kind: 'short'; missing: number; cost: number }
  | { kind: 'can'; cost: number; durationMs: number; first: boolean }
  | { kind: 'view'; cost: number; durationMs: number; first: boolean };

/** Условие уровня сверх штаба и влияния (CORP-6): столько участников без рекрутов или
 *  столько сыгранных битв корпорации. */
export type CorpCondition =
  | { kind: 'members'; need: number; have: number; ok: boolean }
  | { kind: 'battles'; need: number; have: number; ok: boolean };

/** Уровень другого здания, который открывает штаб. */
export interface CorpOpening {
  buildingId: string;
  nameKey: string;
  level: number;
}

/** Уровень корпорации сейчас и путь к следующему. */
export interface CorpLevelPlan {
  level: number;
  max: number;
  /** null — уровень высший. */
  next: {
    level: number;
    cost: number;
    durationMs: number;
    enough: boolean;
    conditions: CorpCondition[];
    opens: CorpOpening[];
  } | null;
}

/** Строка таблицы уровней: штаб уровня `level` и что он открывает. Время — по каталогу,
 *  без поправки инженерного комплекса: таблица — справка о правилах, а не расчёт заказа. */
export interface CorpLevelRow {
  level: number;
  cost: number;
  durationMs: number;
  conditions: CorpCondition[];
  opens: CorpOpening[];
  current: boolean;
}

/** Условие следующего уровня здания для его листа. */
export type CorpRequirement =
  | { kind: 'hq'; level: number; ok: boolean }
  | CorpCondition
  | { kind: 'cost'; cost: number; treasury: number; ok: boolean }
  | { kind: 'queue'; ok: boolean; busyWith: string | null }
  | { kind: 'time'; durationMs: number; reduction: number };

const hqOf = (view: CorpInfrastructureView): CorpBuildingView | undefined =>
  view.buildings.find((b) => b.id === CORP_HQ);

/** Условия уровня `level` сверх штаба и влияния — по тому, что прислал сервер. */
export function corpConditions(
  view: CorpInfrastructureView,
  level: CorpBuildingLevel,
): CorpCondition[] {
  const out: CorpCondition[] = [];
  if (level.members)
    out.push({
      kind: 'members',
      need: level.members,
      have: view.members,
      ok: view.members >= level.members,
    });
  if (level.battles)
    out.push({
      kind: 'battles',
      need: level.battles,
      have: view.battles,
      ok: view.battles >= level.battles,
    });
  return out;
}

/** Правило 1: уровень корпорации — уровень штаба. */
export function corpLevel(view: CorpInfrastructureView): number | null {
  return hqOf(view)?.level ?? null;
}

/** Правило 2: состояние участка панорамы. */
export function corpLotState(view: CorpInfrastructureView, b: CorpBuildingView): CorpLotState {
  if (view.construction?.buildingId === b.id) return 'build';
  if (b.level > 0) return 'built';
  const first = b.levels[0];
  return first && first.headquarters <= (corpLevel(view) ?? 0) ? 'open' : 'locked';
}

/** Правило 4: заказ разрешает сервер. */
export function corpCanOrder(view: CorpInfrastructureView, b: CorpBuildingView): boolean {
  return view.canBuild && b.blocked === null && b.next !== null;
}

/** Правило 3: строка состояния здания. */
export function corpBuildingStatus(
  view: CorpInfrastructureView,
  b: CorpBuildingView,
): CorpBuildingStatus {
  const job = view.construction;
  if (job?.buildingId === b.id) return { kind: 'job', level: job.level };
  const next = b.next;
  if (!next) return { kind: 'max' };
  const first = b.level === 0;
  if (next.headquarters > (corpLevel(view) ?? 0))
    return { kind: 'locked', headquarters: next.headquarters, first };
  const unmet = corpConditions(view, next).find((c) => !c.ok);
  if (unmet) return { kind: unmet.kind, need: unmet.need, have: unmet.have };
  if (job) return { kind: 'busy' };
  if (view.influence < next.cost)
    return { kind: 'short', missing: next.cost - view.influence, cost: next.cost };
  return {
    kind: corpCanOrder(view, b) ? 'can' : 'view',
    cost: next.cost,
    durationMs: next.actualDurationMs,
    first,
  };
}

/** Правило 5: уровни других зданий, которым нужен штаб ровно уровня `hq`. */
export function corpOpensAt(view: CorpInfrastructureView, hq: number): CorpOpening[] {
  const out: CorpOpening[] = [];
  for (const b of view.buildings) {
    if (b.id === CORP_HQ) continue;
    b.levels.forEach((l, i) => {
      if (l.headquarters === hq) out.push({ buildingId: b.id, nameKey: b.nameKey, level: i + 1 });
    });
  }
  return out;
}

/** Карточка уровня: где корпорация сейчас, сколько стоит следующий штаб и что он откроет. */
export function corpLevelPlan(view: CorpInfrastructureView): CorpLevelPlan | null {
  const hq = hqOf(view);
  if (!hq) return null;
  const next = hq.next;
  return {
    level: hq.level,
    max: hq.levels.length,
    next: next
      ? {
          level: hq.level + 1,
          cost: next.cost,
          durationMs: next.actualDurationMs,
          enough: view.influence >= next.cost,
          conditions: corpConditions(view, next),
          opens: corpOpensAt(view, hq.level + 1),
        }
      : null,
  };
}

/** Таблица всех уровней корпорации. */
export function corpLevelTable(view: CorpInfrastructureView): CorpLevelRow[] {
  const hq = hqOf(view);
  if (!hq) return [];
  return hq.levels.map((l, i) => ({
    level: i + 1,
    cost: l.cost,
    durationMs: l.durationMs,
    conditions: corpConditions(view, l),
    opens: corpOpensAt(view, i + 1),
    current: hq.level === i + 1,
  }));
}

/** Условия следующего уровня здания: штаб (у самого штаба его нет — он и есть уровень),
 *  участники и сыгранные битвы, если уровень их просит, влияние в казне, свободная
 *  очередь и время с поправкой инженерного комплекса. Пусто — уровень последний. */
export function corpRequirements(
  view: CorpInfrastructureView,
  b: CorpBuildingView,
): CorpRequirement[] {
  const next = b.next;
  if (!next) return [];
  const job = view.construction;
  const out: CorpRequirement[] = [];
  if (b.id !== CORP_HQ)
    out.push({
      kind: 'hq',
      level: next.headquarters,
      ok: (corpLevel(view) ?? 0) >= next.headquarters,
    });
  out.push(...corpConditions(view, next));
  out.push({ kind: 'cost', cost: next.cost, treasury: view.influence, ok: view.influence >= next.cost });
  out.push({
    kind: 'queue',
    ok: !job,
    busyWith: job ? (view.buildings.find((x) => x.id === job.buildingId)?.nameKey ?? null) : null,
  });
  out.push({ kind: 'time', durationMs: next.actualDurationMs, reduction: view.constructionReduction });
  return out;
}

/** Знак на гербе корпорации. Тега сервер не хранит, поэтому знак — первые буквы двух
 *  первых слов названия, а у названия из одного слова — его первые две буквы. */
export function corpInitials(name: string): string {
  const words = name
    .trim()
    .split(/[\s\-–—_.]+/u)
    .filter(Boolean);
  const letters =
    words.length > 1
      ? words
          .slice(0, 2)
          .map((w) => Array.from(w)[0] ?? '')
          .join('')
      : Array.from(words[0] ?? '')
          .slice(0, 2)
          .join('');
  return (letters || '?').toUpperCase();
}
