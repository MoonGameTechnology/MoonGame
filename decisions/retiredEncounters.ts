import type { GameState, MapObjective } from '../packages/shared-core/src/index';

/**
 * Встреча, закрытая задачей главы, в следующий заход не возвращается (решение владельца
 * 2026-09-25): «Штурм логова пиратов тоже одноразовая миссия — если выполнил на этой
 * карте, уже не появится». Задача уже одноразовая (`objectivesDone` в профиле), а её цель
 * — нет: карта каждый заход строится заново, и логово, патруль и карточка «Первый бой»
 * вставали снова, хотя награды за них больше нет.
 *
 * Спасённый герой (`recruit`) также не ждёт повторного спасения: станция остаётся,
 * но её `recruitHero` снимается. Награда коллекции за победу в главе не меняется.
 * Для задачи ЗАХВАТА (`control`) списывается только цель, которой на
 * старте владеет NPC (`players[owner].npc`): свой мир, Рой и ничья провинция — не
 * встреча. Цель становится ничьей и без гарнизона, флоты этого NPC уходят, а NPC без
 * провинций — и сам игрок вместе со своими войнами: без него `pirateEncounter` молчит. Вход не меняется.
 */
export function retireDoneEncounters(
  state: GameState,
  objectives: readonly MapObjective[],
  done: readonly string[],
): GameState {
  const retired = new Set<string>();
  const recruited = new Set<string>();
  for (const o of objectives) {
    if (o.kind === 'recruit' && done.includes(o.id))
      for (const id of o.targets) if (state.planets[id]?.recruitHero) recruited.add(id);
    if (o.kind !== 'control' || !done.includes(o.id)) continue;
    for (const id of o.targets) {
      const owner = state.planets[id]?.owner;
      if (owner && state.players[owner]?.npc) retired.add(id);
    }
  }
  if (!retired.size && !recruited.size) return state;
  const next: GameState = JSON.parse(JSON.stringify(state));
  for (const id of recruited) delete next.planets[id]!.recruitHero;
  const npcs = new Set<string>();
  for (const id of retired) {
    const planet = next.planets[id]!;
    npcs.add(planet.owner!);
    planet.owner = null;
    planet.garrison = [];
  }
  for (const [id, f] of Object.entries(next.fleets)) if (npcs.has(f.owner)) delete next.fleets[id];
  for (const npc of npcs) {
    if (Object.values(next.planets).some((p) => p.owner === npc)) continue;
    delete next.players[npc];
    for (const pair of Object.keys(next.diplomacy ?? {}))
      if (pair.split('|').includes(npc)) delete next.diplomacy![pair];
  }
  return next;
}
