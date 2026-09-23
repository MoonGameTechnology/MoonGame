/**
 * ДОПОЛНИТЕЛЬНЫЕ ЗАДАЧИ ЗАБЕГА — «миссии на карте» (решение владельца 2026-09-22).
 *
 * Заказ: раскидать по карте 2–3 задачи вроде сбора материалов, с наградой за выполнение.
 *
 * ПОЧЕМУ ЭТО ПРЕДИКАТ, А НЕ СИСТЕМА КВЕСТОВ. Понятия «задача» в игре не было вовсе:
 * награда за забег считалась одной формулой по финальному состоянию матча, и ничего
 * похожего на цель, её отслеживание или показ игроку не существовало. Завести под это
 * секцию состояния и модуль ядра было бы честно, но дорого и НЕ НУЖНО: всё, что владелец
 * назвал задачей, в этом движке уже читается из состояния напрямую — сколько узлов взято,
 * какие постройки снесены, сколько провинций опознано. Значит задача — это ЧИСТОЕ УСЛОВИЕ
 * над `GameState`, а не новая сущность рядом с ним.
 *
 * Что это даёт бесплатно:
 *   · живой прогресс «3 из 5» — ту же функцию зовёт клиент, сколько угодно раз;
 *   · выплату — её зовёт закрытие попытки по тому же финальному состоянию;
 *   · детерминизм — чистая функция состояния, без времени, случайности и сети;
 *   · ноль нового в `GameState`, то есть ни миграций, ни бампа манифеста модулей.
 *
 * Чего НЕ даёт и почему это принято: задача не может зависеть от ИСТОРИИ забега («снеси
 * улей ДО пятой волны»), потому что история в состоянии не лежит. Такие задачи потребуют
 * своей памяти — отдельное решение владельца, а не умолчание этого модуля.
 *
 * Лежит в `/decisions`: условие одинаково нужно и клиенту (показать), и хозяину забега
 * (выплатить), а две копии такого правила разойдутся молча.
 */
import type { GameState, MapObjective, PlayerId } from '../packages/shared-core/src/index';

/**
 * Объявление задачи — это ФОРМА ДАННЫХ КАРТЫ, и живёт она в схеме карты
 * (`MapObjectiveSchema`), а не здесь. Своего типа этот модуль не заводит намеренно:
 * два объявления одной формы — ровно тот разъезд, которым нарисованная карта однажды
 * разошлась с проходимой. Здесь только ЛОГИКА над ним.
 */
export type MissionObjective = MapObjective;
export type ObjectiveKind = MapObjective['kind'];

/** Состояние одной задачи для показа и для выплаты. */
export interface ObjectiveProgress {
  id: string;
  kind: ObjectiveKind;
  done: number;
  total: number;
  complete: boolean;
  reward: number;
}

/** Сколько провинций игрок опознал: ключи его памяти тумана. Нет памяти — ноль, а не
 *  падение: забег мог идти на хосте, который тумана не ведёт. */
function identified(state: GameState, player: PlayerId): number {
  return Object.keys(state.fog?.[player] ?? {}).length;
}

/** Прогресс ОДНОЙ задачи. Чистая функция состояния — зови сколько угодно. */
export function objectiveProgress(
  objective: MissionObjective,
  state: GameState,
  player: PlayerId,
): ObjectiveProgress {
  const base = { id: objective.id, kind: objective.kind, reward: objective.reward };
  if (objective.kind === 'control') {
    const targets = objective.targets ?? [];
    const done = targets.filter((id) => state.planets[id]?.owner === player).length;
    return {
      ...base,
      done,
      total: targets.length,
      complete: targets.length > 0 && done === targets.length,
    };
  }
  if (objective.kind === 'raze') {
    // Считаем ОСТАВШИЕСЯ постройки названных видов у всех, кроме игрока: задача про то,
    // чтобы их не стало, а не про то, кто их снёс. Разрушенное здание (`hp <= 0`) уже не
    // считается стоящим — иначе «снеси» выполнялось бы только полным исчезновением записи.
    const kinds = new Set(objective.targets ?? []);
    let left = 0;
    for (const planet of Object.values(state.planets)) {
      if (planet.owner === player) continue;
      for (const b of planet.buildings) if (kinds.has(b.type) && b.hp > 0) left += 1;
    }
    // Всего — сколько их объявлено в каталоге карты, знать неоткуда, поэтому «всего»
    // это то, что ОСТАЛОСЬ плюс ноль: шкала здесь двоичная, и честнее показать её так.
    return { ...base, done: left === 0 ? 1 : 0, total: 1, complete: left === 0 };
  }
  const need = Math.max(1, Math.trunc(objective.count ?? 1));
  if (objective.kind === 'wave') {
    // «Дожить до волны N» (PVR-5.3): номер текущей волны уже лежит в состоянии забега.
    const done = Math.min(Math.max(0, state.pve?.waveNumber ?? 0), need);
    return { ...base, done, total: need, complete: done >= need };
  }
  if (objective.kind === 'build') {
    // «Держать N построек вида X» (PVR-5.3): стоящие, своих миров. Снесённая не в счёт —
    // задача про то, что стоит сейчас, как и `raze`.
    const kinds = new Set(objective.targets ?? []);
    let have = 0;
    for (const planet of Object.values(state.planets)) {
      if (planet.owner !== player) continue;
      for (const b of planet.buildings) if (kinds.has(b.type) && b.hp > 0) have += 1;
    }
    const done = Math.min(have, need);
    return { ...base, done, total: need, complete: done >= need };
  }
  const done = Math.min(identified(state, player), need);
  return { ...base, done, total: need, complete: done >= need };
}

/** Прогресс ВСЕХ задач карты, в объявленном порядке. */
export function missionProgress(
  objectives: readonly MissionObjective[],
  state: GameState,
  player: PlayerId,
): ObjectiveProgress[] {
  return objectives.map((o) => objectiveProgress(o, state, player));
}

/** Суммарная надбавка за ВЫПОЛНЕННЫЕ задачи. Ноль — законный ответ: задачи
 *  дополнительные, и забег без единой выполненной остаётся нормальным забегом. */
export function objectiveBonus(
  objectives: readonly MissionObjective[],
  state: GameState,
  player: PlayerId,
): number {
  return missionProgress(objectives, state, player)
    .filter((p) => p.complete)
    .reduce((sum, p) => sum + Math.max(0, p.reward), 0);
}

/**
 * ЗАПАС ЗАДАЧ ГЛАВЫ (PVR-5.3, модель закрыта владельцем 2026-09-22).
 *
 * Карта объявляет ЗАПАС (`objectives`) — за забег видна его часть. Выполненная задача
 * закрыта НАВСЕГДА, её место занимает следующая из запаса по порядку объявления. Сколько
 * видно: база главы плюс число уже выполненных, но не больше потолка — поэтому весь запас
 * за один заход не взять, главу проходят несколько раз. Счёт выполненного у КАЖДОЙ главы
 * свой: открытое в одной главе не раздувает список в другой.
 */
export interface ObjectiveSlots {
  base: number;
  cap: number;
}
/** Резолюция владельца: сперва три, потолок «порядка пяти». */
export const DEFAULT_OBJECTIVE_SLOTS: ObjectiveSlots = { base: 3, cap: 5 };

/** Задачи, видимые в этом забеге: открытые из запаса, по порядку, сколько позволяет
 *  правило. Мусор в слотах (ноль, дробь, потолок ниже базы) не ломает показ. */
export function shownObjectives(
  pool: readonly MissionObjective[],
  done: readonly string[],
  slots: ObjectiveSlots = DEFAULT_OBJECTIVE_SLOTS,
): MissionObjective[] {
  const base = Math.max(1, Math.trunc(slots.base) || 1);
  const cap = Math.max(base, Math.trunc(slots.cap) || base);
  const closed = new Set(done);
  const count = Math.min(cap, base + pool.filter((o) => closed.has(o.id)).length);
  return pool.filter((o) => !closed.has(o.id)).slice(0, count);
}

/**
 * Номинал задачи при `shown` видимых (PVR-5.3: «номинал падает с ростом числа задач»).
 * До базы задача платит объявленное; сверх базы общая надбавка остаётся примерно той же:
 * `round(reward × base / shown)`, но не меньше 1. Иначе пять задач по +3 дали бы +15 —
 * больше самого забега (14), и волны стали бы фоном.
 */
export function objectiveNominal(
  reward: number,
  shown: number,
  base = DEFAULT_OBJECTIVE_SLOTS.base,
): number {
  const r = Math.max(0, reward);
  if (r === 0) return 0;
  return shown <= base ? r : Math.max(1, Math.round((r * base) / shown));
}

/** Как задача закрылась в этом забеге — строка итогов (PVR-5.4). */
export interface ObjectiveResult {
  id: string;
  /** Для подписи: `total` подставляется в текст задачи. */
  total: number;
  complete: boolean;
  /** Сколько заплатила: номинал выполненной, 0 — невыполненной. */
  paid: number;
}

/** Итог задач ОДНОГО забега: что показано, что закрыто, сколько заплачено и сколько новых
 *  задач откроется к следующему заходу. Выполненное ДО забега здесь не видно вовсе — оно не
 *  показывается и потому второй раз не платит. */
export function settleObjectives(
  pool: readonly MissionObjective[],
  done: readonly string[],
  state: GameState,
  player: PlayerId,
  slots: ObjectiveSlots = DEFAULT_OBJECTIVE_SLOTS,
): { results: ObjectiveResult[]; bonus: number; done: string[]; unlocked: number } {
  const shown = shownObjectives(pool, done, slots);
  const base = Math.max(1, Math.trunc(slots.base) || 1);
  const results = shown.map((o) => {
    const p = objectiveProgress(o, state, player);
    return {
      id: o.id,
      total: p.total,
      complete: p.complete,
      paid: p.complete ? objectiveNominal(o.reward, shown.length, base) : 0,
    };
  });
  const nowDone = [...done, ...results.filter((r) => r.complete).map((r) => r.id)];
  const before = new Set(shown.map((o) => o.id));
  const unlocked = shownObjectives(pool, nowDone, slots).filter((o) => !before.has(o.id)).length;
  return { results, bonus: results.reduce((sum, r) => sum + r.paid, 0), done: nowDone, unlocked };
}
