/**
 * Доктрина бота: ветка дерева технологий, которую место ведёт весь матч, и армия под неё
 * (решение владельца 2026-10-08: «если бот будет качать разные ветки и собирать разную
 * армию»).
 *
 * Без доктрины бот брал самый дешёвый доступный узел, пока хватало кредитов, и строил одну
 * и ту же армию. После BAL-6 боевой бонус узла идёт только своему роду войск
 * (`damageScope`), так что такой бот платил за бонусы, которыми почти не пользовался.
 *
 * ВЕТКУ ДАЁТ СОВЕТ. Совет учёных выбирается до старта и внутри матча неизменен (GDD §5.2),
 * у бота он свой на каждую партию (`botCouncil`: хеш сида и места), и у каждого учёного,
 * кроме генералиста, есть ветка. Поэтому доктрину не нужно ни хранить в состоянии, ни
 * выдумывать: бот качает ветку своего учёного. Боевая ветка (та, у узлов которой есть
 * `damageScope`) идёт первой, иначе армию было бы не под что собирать.
 */

/** Минимум полей узла, который нужен доктрине; совместим с `data.technologies[id]`. */
interface DoctrineTech {
  branch?: string;
  tier?: number;
  prerequisites?: readonly string[];
  grantOnly?: boolean;
  damageScope?: string;
}

/** Ветка доктрины места по его совету; совета или веток у учёных нет — `undefined`. */
export function seatDoctrine(
  council: readonly { id: string }[] | undefined,
  scientists: Readonly<Record<string, { branch?: string } | undefined>>,
  technologies: Readonly<Record<string, DoctrineTech | undefined>>,
): string | undefined {
  const scopes = new Set(Object.values(technologies).map((t) => t?.damageScope));
  const branches = (council ?? []).map((c) => scientists[c.id]?.branch);
  return branches.find((b) => b !== undefined && scopes.has(b)) ?? branches.find((b) => !!b);
}

/**
 * Ранг каждого узла для доктрины `branch` (нет в карте — ранг 2, чужой узел).
 *
 * 0 — путь к боевым узлам ветки (её `damageScope`) со всеми предпосылками, даже из чужой
 * ветки: наземные бастионы стоят на автоматизации промышленности из космической. У ветки
 * без боевых узлов (командование) путь ведёт к её высшему тиру. 1 — прочие узлы ветки.
 * Всё читается из ДАННЫХ: новый узел ветки сам займёт своё место.
 */
export function doctrineRanks(
  technologies: Readonly<Record<string, DoctrineTech | undefined>>,
  branch: string,
  inMatch: (id: string) => boolean = () => true,
): Map<string, number> {
  const own = Object.keys(technologies)
    .filter((id) => {
      const def = technologies[id];
      return def !== undefined && !def.grantOnly && def.branch === branch && inMatch(id);
    })
    .sort();
  const combat = own.filter((id) => technologies[id]?.damageScope === branch);
  const top = Math.max(...own.map((id) => technologies[id]?.tier ?? 0));
  const ranks = new Map<string, number>();
  for (const id of own) ranks.set(id, 1);
  const stack =
    combat.length > 0 ? combat : own.filter((id) => (technologies[id]?.tier ?? 0) === top);
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (ranks.get(id) === 0 || !inMatch(id)) continue;
    ranks.set(id, 0);
    for (const pre of technologies[id]?.prerequisites ?? []) stack.push(pre);
  }
  return ranks;
}
