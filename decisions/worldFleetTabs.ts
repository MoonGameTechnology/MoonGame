/**
 * Свой мир со своим флотом — одна карточка с вкладками «Флот» и «Мир» (UIX-7.1).
 *
 * Касание по своему миру, у которого стоит свой флот, открывало список «флот или мир»: лишний
 * шаг на самом частом жесте партии. Теперь касание сразу открывает карточку, а вкладки над
 * ней переключают флот и мир. Правила:
 *
 * 1. **Пара — свой мир и РОВНО ОДИН свой флот у него.** Два своих флота у мира — вкладка
 *    «Флот» не знала бы, какой показать; там остаётся прежний список. Чужой флот или своя
 *    эскадра в воздухе в спорном касании тоже оставляют список: вкладок для них нет.
 * 2. **Открыта вкладка, которую выбирали в прошлый раз.** Игрок, который ходит к флоту,
 *    ходит к нему и дальше; выбора ещё не было — «Флот»: под приказ касаются флота чаще.
 * 3. **Вкладки видны и тогда, когда пару выбрали напрямую.** Выбран флот у своего мира или
 *    свой мир с одним флотом — карточка та же, с вкладками: иначе один и тот же объект
 *    выглядел бы по-разному в зависимости от того, куда попал палец.
 */
import type { TapPick } from './tapCycle';

export type CardTab = 'fleet' | 'world';

/** Свой мир и его единственный свой флот. */
export interface WorldFleetPair {
  world: string;
  fleet: string;
}

/** Что известно про объекты под касанием. */
export interface PairFacts {
  /** Мир мой. */
  ownWorld(id: string): boolean;
  /** Флот мой и стоит у мира: его id, иначе `null`. */
  parkedAt(fleetId: string): string | null;
}

/** Правило 1 для спорного касания: список кандидатов складывается в пару — или нет. */
export function pairOfChoices(
  choices: readonly TapPick[],
  facts: PairFacts,
): WorldFleetPair | null {
  const worlds = choices.filter((c) => c.kind === 'planet');
  const fleets = choices.filter((c) => c.kind === 'fleet');
  if (
    worlds.length !== 1 ||
    fleets.length !== 1 ||
    worlds.length + fleets.length !== choices.length
  )
    return null;
  const world = worlds[0]!.id;
  const fleet = fleets[0]!.id;
  if (!facts.ownWorld(world) || facts.parkedAt(fleet) !== world) return null;
  return { world, fleet };
}

/** Правило 2: какую вкладку открыть. */
export function openTab(last: CardTab | null): CardTab {
  return last ?? 'fleet';
}

/** Выбор, который соответствует вкладке. */
export function tabPick(pair: WorldFleetPair, tab: CardTab): TapPick {
  return tab === 'fleet' ? { kind: 'fleet', id: pair.fleet } : { kind: 'planet', id: pair.world };
}

/** Правило 3: есть ли у текущего выбора вкладки и какая из них открыта.
 *  `ownFleetsAt(world)` — свои флоты, стоящие у своего мира (у чужого — пусто). */
export function tabsForSelection(
  sel: TapPick | null,
  facts: PairFacts & { ownFleetsAt(worldId: string): readonly string[] },
): { pair: WorldFleetPair; active: CardTab } | null {
  if (!sel) return null;
  if (sel.kind === 'fleet') {
    const world = facts.parkedAt(sel.id);
    if (!world || !facts.ownWorld(world)) return null;
    if (facts.ownFleetsAt(world).length !== 1) return null;
    return { pair: { world, fleet: sel.id }, active: 'fleet' };
  }
  if (sel.kind === 'planet') {
    if (!facts.ownWorld(sel.id)) return null;
    const fleets = facts.ownFleetsAt(sel.id);
    if (fleets.length !== 1) return null;
    return { pair: { world: sel.id, fleet: fleets[0]! }, active: 'world' };
  }
  return null;
}

/** Память вкладки: читается как есть, мусор — «выбора не было». */
export function parseTab(raw: string | null): CardTab | null {
  return raw === 'fleet' || raw === 'world' ? raw : null;
}
