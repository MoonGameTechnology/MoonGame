import type { GameState, PlayerId } from './gameState';

/**
 * COAL-1 — коалиция как СУЩНОСТЬ сессии: состав, эмблема, описание, вместимость.
 *
 * До неё коалицией называлась только союзная клика (`victory.ts`): у неё не было ни
 * имени, ни эмблемы, ни потолка, и любой мог собрать союз со всей картой. Теперь союз
 * (`alliance`) заключается ТОЛЬКО внутри коалиции: игрок основывает её сам, принятое
 * предложение союза создаёт коалицию или вводит свободного игрока в чужую. Выход из
 * неё снимает союз со всеми её членами. Так клика победы и состав коалиции совпадают
 * по построению, а вместимость держит сервер — ядро отбивает вступление сверх потолка.
 *
 * Здесь — чистые примитивы над `GameState.coalitions`; действия живут в
 * `modules/diplomacy.ts` (союз — ступень той же лестницы стоек).
 */

/** Одна коалиция. Состав отсортирован по id — порядок не зависит от истории вступлений. */
export interface Coalition {
  id: string;
  /** Founder, or their successor after departure; used for the coalition's title. */
  founder: PlayerId;
  members: PlayerId[];
  /** Id эмблемы из {@link COALITION_EMBLEMS}. */
  emblem: string;
  /** Описание от членов коалиции; текст игрока, рисуется только экранированным. */
  description: string;
}

/** Эмблемы, из которых выбирает коалиция. Ядро хранит id; картинку даёт клиент. */
export const COALITION_EMBLEMS = [
  'star',
  'sun',
  'moon',
  'comet',
  'swords',
  'crown',
  'skull',
  'gear',
  'atom',
  'trident',
  'eye',
  'shield',
] as const;

/** Потолок длины описания (символов). */
export const COALITION_DESC_MAX = 160;

/** Доля мест карты, которую вмещает одна коалиция: карта на 20 — коалиция на 3. */
const CAPACITY_NUM = 3;
const CAPACITY_DEN = 20;

/**
 * Вместимость коалиции на этой карте: 15% мест (округление вниз), но не меньше двух —
 * иначе на дуэли и FFA на четверых союз был бы невозможен вовсе. Места NPC (пираты,
 * нейтралы, Рой) не считаются: это не игроки карты. 20 мест → 3, 50 → 7, 8 → 2.
 */
export function coalitionCapacity(state: GameState): number {
  let seats = 0;
  for (const p of Object.values(state.players)) if (!p.npc) seats += 1;
  return Math.max(2, Math.floor((seats * CAPACITY_NUM) / CAPACITY_DEN));
}

/** Коалиция игрока или null. Игрок состоит не больше чем в одной. */
export function coalitionOf(state: GameState, playerId: PlayerId): Coalition | null {
  const all = state.coalitions;
  if (!all) return null;
  for (const id of Object.keys(all).sort()) {
    const c = all[id]!;
    if (c.members.includes(playerId)) return c;
  }
  return null;
}

/** Found a singleton, or a pair after a mutually accepted alliance. Draft mutator. */
export function foundCoalition(state: GameState, founder: PlayerId, other?: PlayerId): Coalition {
  const seq = (state.coalitionSeq ?? 0) + 1;
  state.coalitionSeq = seq;
  const c: Coalition = {
    id: `c${seq}`,
    founder,
    members: other === undefined || other === founder ? [founder] : [founder, other].sort(),
    emblem: COALITION_EMBLEMS[(seq - 1) % COALITION_EMBLEMS.length]!,
    description: '',
  };
  (state.coalitions ??= {})[c.id] = c;
  return c;
}

/** Ввести игрока в коалицию. Draft-мутатор. */
export function addMember(state: GameState, coalitionId: string, playerId: PlayerId): void {
  const c = state.coalitions?.[coalitionId];
  if (!c || c.members.includes(playerId)) return;
  c.members = [...c.members, playerId].sort();
}

/**
 * Remove a member and return those who remain; the caller clears their treaties.
 * Empty coalitions dissolve; a singleton persists and can invite new allies.
 */
export function removeMember(state: GameState, playerId: PlayerId): PlayerId[] {
  const c = coalitionOf(state, playerId);
  if (!c) return [];
  const rest = c.members.filter((id) => id !== playerId);
  if (rest.length === 0) {
    delete state.coalitions![c.id];
    if (Object.keys(state.coalitions!).length === 0) delete state.coalitions;
  } else {
    c.members = rest;
    if (c.founder === playerId) c.founder = [...rest].sort()[0]!;
  }
  return rest;
}
