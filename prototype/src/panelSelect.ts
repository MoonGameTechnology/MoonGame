/**
 * Что показать в боковой панели и где стоит каждый флот группы (REFM-39).
 *
 * Панель одна, а претендентов на неё четверо, и порядок между ними — не вкусовщина:
 *
 * 1. **Устаревший выбор не запирает панель.** `selFleet` может указывать на флот,
 *    которого уже нет (сгорел в бою, слился с другим), и на это НЕЛЬЗЯ отвечать
 *    пустым экраном: игрок ткнул в мир, флот погиб — и панель обязана показать мир,
 *    а не «ничего не выбрано». Поэтому мёртвая ссылка молча проваливается дальше по
 *    списку, а не обрывает выбор.
 * 2. **Группа — это БОЛЬШЕ одного флота.** Рамка, поймавшая ровно один, обязана дать
 *    обычную карточку флота со всеми приказами, а не список из одной строки.
 * 3. **Мир вне сенсоров — отдельная карточка.** Показать неизвестный мир как
 *    известный значит соврать игроку о гарнизоне, которого он не видел.
 *
 * Отдельно — где флот. Проверки идут в жёстком порядке (стоит → в пути → на дуге), и
 * первым идёт `location` не случайно: прилетевший флот может ещё нести остатки
 * `movement`/`edge`, и загляни мы туда раньше, панель писала бы «в пути» про флот,
 * который уже стоит на орбите.
 */
import type { Fleet, GameState, Planet } from '../../packages/shared-core/src/index';

/** Кого показывает панель. `world.known` — мир в зоне сенсоров. */
export type PanelPick =
  | { kind: 'group'; fleets: Fleet[] }
  | { kind: 'fleet'; fleet: Fleet }
  | { kind: 'world'; planet: Planet; known: boolean }
  | { kind: 'empty' };

/** Текущий выбор игрока — ровно то, чем его держит хозяин. */
export interface Selection {
  /** Флоты, пойманные рамкой. */
  fleets: Iterable<string>;
  /** Одиночно выбранный флот. */
  fleet: string | null;
  /** Выбранный мир. */
  planet: string | null;
}

/** Живые флоты выбора в порядке перечисления; исчезнувшие отбрасываются. */
function livingGroup(ids: Iterable<string>, state: Pick<GameState, 'fleets'>): Fleet[] {
  const out: Fleet[] = [];
  for (const id of ids) {
    const f = state.fleets[id];
    if (f) out.push(f);
  }
  return out;
}

/**
 * Кого показать в панели. `known` решает хозяин (у него туман войны), модуль только
 * расставляет приоритет и отсеивает мёртвые ссылки.
 */
export function pickPanel(
  sel: Selection,
  state: Pick<GameState, 'fleets' | 'planets'>,
  known: (p: Planet) => boolean,
): PanelPick {
  const group = livingGroup(sel.fleets, state);
  if (group.length > 1) return { kind: 'group', fleets: group };
  const one = sel.fleet ? state.fleets[sel.fleet] : undefined;
  if (one) return { kind: 'fleet', fleet: one };
  const p = sel.planet ? state.planets[sel.planet] : undefined;
  if (!p) return { kind: 'empty' };
  return { kind: 'world', planet: p, known: known(p) };
}

/** Где флот: стоит на орбите, идёт между мирами, висит на дуге или неизвестно. */
export type FleetWhere =
  | { kind: 'orbit'; at: string }
  | { kind: 'transit'; from: string; to: string }
  | { kind: 'lane'; from: string; to: string }
  | { kind: 'unknown' };

/** Положение флота одной проверкой. Порядок жёсткий — см. шапку модуля. */
export function fleetWhere(f: Fleet): FleetWhere {
  if (f.location) return { kind: 'orbit', at: f.location };
  if (f.movement) return { kind: 'transit', from: f.movement.from, to: f.movement.to };
  if (f.edge) return { kind: 'lane', from: f.edge.from, to: f.edge.to };
  return { kind: 'unknown' };
}

/** Итог тактической группы: сколько бортов и сколько десанта в трюмах. */
export function groupTotals(fleets: readonly Fleet[]): {
  fleets: number;
  ships: number;
  troops: number;
} {
  const count = (stacks: ReadonlyArray<{ count: number }> = []) =>
    stacks.reduce((n, st) => n + st.count, 0);
  return {
    fleets: fleets.length,
    ships: fleets.reduce((n, f) => n + count(f.units), 0),
    troops: fleets.reduce((n, f) => n + count(f.landing ?? []), 0),
  };
}
