/**
 * Подробный рапорт о СВОЁМ бое в журнале событий (решение владельца 2026-11-01).
 *
 * Строка «бой завершён · победа · потери: Бот −5» не отвечала на три вопроса, которые
 * игрок задаёт после боя: сколько их было, скольких мы выбили и в каком состоянии
 * вернулись. Здесь — из чего собирается ответ; видимость строки по-прежнему решает
 * `eventVisibility.ts`, а сводку потерь по игрокам — `battleLog.ts`.
 *
 * 1. **«Врагов было» — пик, а не первый взгляд.** В идущий бой вступают подкрепления
 *    (MSB-3), и число на старте занижает тех, с кем на деле дрались. Пик считается как
 *    «живы сейчас + уже пали» и никогда не убывает: гибель врага не уменьшает число тех,
 *    кто был.
 * 2. **Корпус — только у кораблей.** Наземные войска после боя возвращаются «в покое» с
 *    полным здоровьем (`combat.ts` стирает `hp`), и «корпус 100%» у гарнизона, только что
 *    потерявшего половину, было бы враньём. Корабли несут урон из боя, поэтому их остаток
 *    — настоящий.
 * 3. **Корпус считается по ВЫЖИВШИМ.** Погибшие уже названы в потерях; «0 из 500» у
 *    флота, которого больше нет, ничего не добавляет.
 * 4. **Пустых частей нет.** Нет врагов в учёте — нет хвоста «врагов: 0»; нет наград —
 *    нет строки наград. Пустая часть удлиняет запись и обесценивает соседние цифры.
 * 5. **Медаль — новая, только если её не было до боя.** Сравнение идёт мультимножеством
 *    «тип юнита + медаль»: два корвета с «Искрой» и третий, получивший её в бою, — одна
 *    новая медаль, а не три.
 */

/** Часть строки журнала: ключ локали и подстановки. Текст собирает клиент. */
export interface ReportPart {
  key: string;
  params?: Record<string, string | number>;
}

/** Сколько юнитов в стеках (у стека без числа — ноль). */
export function headcount(stacks: readonly { count?: number }[]): number {
  let n = 0;
  for (const s of stacks) n += typeof s.count === 'number' && s.count > 0 ? s.count : 0;
  return n;
}

/** Пик врагов боя (правило 1): живые сейчас плюс уже павшие, не меньше прежнего пика. */
export function foesPeak(prev: number, aliveNow: number, fallen: number): number {
  return Math.max(prev, aliveNow + fallen);
}

/** Корпус выживших (правила 2–3): текущий и полный. `hpOf` — корпус одного юнита. */
export function hullLeft(
  stacks: readonly { unit: string; count: number; hp?: number }[],
  hpOf: (unit: string) => number,
): { current: number; max: number } {
  let current = 0;
  let max = 0;
  for (const s of stacks) {
    if (s.count <= 0) continue;
    const full = s.count * hpOf(s.unit);
    max += full;
    current += Math.min(s.hp ?? full, full);
  }
  return { current, max };
}

/** Хвост итога своего боя: сколько было врагов, скольких выбили, корпус выживших. */
export function battleTailParts(r: {
  foes: number;
  destroyed: number;
  hull?: { current: number; max: number };
}): ReportPart[] {
  const parts: ReportPart[] = [];
  if (r.foes > 0) parts.push({ key: 'log.battle.foes', params: { n: r.foes, k: Math.min(r.destroyed, r.foes) } });
  if (r.hull && r.hull.max > 0) {
    const cur = Math.max(0, Math.round(r.hull.current));
    const max = Math.round(r.hull.max);
    parts.push({ key: 'log.battle.hull', params: { cur, max, pct: Math.round((cur / max) * 100) } });
  }
  return parts;
}

/** Новые медали (правило 5): элементы `after`, которых не хватало в `before`. */
export function newMedals(before: readonly string[], after: readonly string[]): string[] {
  const had = new Map<string, number>();
  for (const m of before) had.set(m, (had.get(m) ?? 0) + 1);
  const fresh: string[] = [];
  for (const m of after) {
    const left = had.get(m) ?? 0;
    if (left > 0) had.set(m, left - 1);
    else fresh.push(m);
  }
  return fresh;
}

/** Строка наград за бой: очки, выслуга и новые медали (правило 4 — без пустых частей).
 *  `medals` — уже переведённые «медаль · юнит», их собирает клиент. */
export function rewardParts(r: {
  points: number;
  veterans: number;
  medals: readonly { medal: string; unit: string }[];
}): ReportPart[] {
  const parts: ReportPart[] = [];
  if (r.points !== 0)
    parts.push({ key: 'log.battle.reward.points', params: { sign: r.points > 0 ? '+' : '−', n: Math.abs(r.points) } });
  if (r.veterans > 0) parts.push({ key: 'log.battle.reward.service', params: { n: r.veterans } });
  for (const m of r.medals) parts.push({ key: 'log.battle.reward.medal', params: { medal: m.medal, unit: m.unit } });
  return parts;
}
