/**
 * Узлы дерева героя, чья награда у героя уже есть со старта (AUD-22, решение владельца
 * 2026-09-24: «узел уже изучен»).
 *
 * Парковка веток (HERO-11) сделала часть узлов общими, и их награда совпала со
 * стартовым набором архетипа: Командир мог заплатить за «Сонастройку с Пустотой» и
 * получить «Маяк сбора», который у него и так есть. Такой узел считается ИЗУЧЕННЫМ:
 * купить его нельзя ни в матче (`hero.skill.unlock`), ни в Академии и магазине
 * Sector Zero, а узлы, которые его требуют, открыты.
 *
 * Правило одно на ядро и клиентов — поэтому живёт в `util/`, а не в модуле.
 */
import type { GameData } from '../data/schemas';

/** Что узел даёт — ровно поля `grants` каталога. */
interface NodeGrants {
  grants: { ability?: string; passive?: string; passives?: readonly string[] };
}
/** Стартовый набор архетипа. */
interface StartKit {
  startAbilities?: readonly string[];
  startPassives?: readonly string[];
}

/**
 * Изучен ли узел у архетипа от рождения: узел что-то даёт, и ВСЁ это уже есть в
 * стартовом наборе. Узел без наград (ступень способности, `corridor_sustained`)
 * врождённым не бывает — он улучшает, а не выдаёт.
 */
export function nodeInnateTo(
  node: NodeGrants | undefined,
  archetype: StartKit | undefined,
): boolean {
  if (!node || !archetype) return false;
  const abilities = archetype.startAbilities ?? [];
  const passives = archetype.startPassives ?? [];
  const { ability, passive, passives: many = [] } = node.grants;
  const covered: boolean[] = [];
  if (ability !== undefined) covered.push(abilities.includes(ability));
  if (passive !== undefined) covered.push(passives.includes(passive));
  for (const p of many) covered.push(passives.includes(p));
  return covered.length > 0 && covered.every(Boolean);
}

/**
 * Узлы, которые у героя считаются изученными: взятые (`skills`) и врождённые для его
 * архетипа. По этому набору проверяются предпосылки и отказ «уже изучено».
 */
export function knownSkillNodes(
  skills: readonly string[],
  archetype: string | undefined,
  data: Pick<GameData, 'heroes' | 'heroSkillTrees'>,
): Set<string> {
  const known = new Set(skills);
  const kit = archetype !== undefined ? data.heroes[archetype] : undefined;
  for (const [id, node] of Object.entries(data.heroSkillTrees))
    if (nodeInnateTo(node, kit)) known.add(id);
  return known;
}
