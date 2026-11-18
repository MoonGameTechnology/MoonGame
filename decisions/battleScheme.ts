/**
 * Схема окна боя: кто в каком ряду, чьи залпы видно стрелками, что свернуть в «+N»
 * (заказ владельца 2026-11-17: «флоты плитками, стрелочками на плитку флота, которую
 * атакуют; куда целится враг — не видно; ряды, приказы — внизу»).
 *
 * Здесь только ОТВЕТ «что показать»; плитки, стрелки и их геометрия — у хозяина экрана.
 *
 * 1. **Два ряда: свои снизу, остальные сверху.** Свои — мои стороны и стороны союзников
 *    (моя первой). Нейтрал, который дерётся с нашим врагом, всё равно сверху: приказать
 *    ему нельзя, а за него игрок не отвечает. В чужом бою «своих» нет — снизу встают те,
 *    кто не враждует с первой стороной боя, сверху — их противники.
 * 2. **Стрелки — только наши.** Залп атакующей стороны ядро делит поровну между ВСЕМИ живыми
 *    враждебными ей сторонами (`util/volley.ts`), и каждая обороняющаяся цель отвечает
 *    стрелку (`util/combatSequence.ts`). Игроку видны залпы своих и союзников и ответы
 *    наших обороняющихся — по ним уже попали, так что стрелок известен. Куда бьёт враг —
 *    не видно; в чужом бою стрелок нет вовсе.
 * 3. **Доля залпа на стрелке — первый проход.** Остаток с погибшей цели уходит в живых
 *    (MSB-10, `util/overflow.ts`), но это случится только в раунде, а схема показывает
 *    расклад сейчас: «½» значит «каждому из двух поровну».
 * 4. **Ряд длиннее {@link LANE_MAX} — хвост сворачивается в «+N»** (вариант владельца:
 *    «сколько максимум участников и как это отрисуется — можно ли так сломать игру»).
 *    Предела числа сторон в ядре нет, а плитка должна оставаться пальцевой. Свои стороны
 *    не сворачиваются никогда: приказ отдаётся тапом по своей плитке.
 * 5. **Перегруз линии — по державе** (MSB-11): N — все живые юниты державы во всех её
 *    сторонах боя, предел L — 10 кораблей или 20 наземных. N > L — каждый бьёт на L/N, и
 *    это окно называет числом, а не тихо съедает урон.
 * 6. **Кому достанется мир — когда плацдармов в бою два и больше.** Правило ядра
 *    (`modules/combat.ts`, MSB-4): мир получает владелец САМОГО РАННЕГО ВЫЖИВШЕГО
 *    плацдарма, по порядку высадки. С одним плацдармом вопроса нет — и строки нет.
 */
import {
  COMBAT_UNIT_CAP,
  GROUND_COMBAT_UNIT_CAP,
  combatEfficiency,
} from '../packages/shared-core/src/util/stacks';
import type { Hostility } from './battleForecast';

/** Сколько плиток в ряду без сворачивания (правило 4). */
export const LANE_MAX = 8;

/** Сторона боя в том виде, в каком её читает схема. */
export interface SchemeSide {
  key: string;
  owner: string | null;
  mine: boolean;
  ally?: boolean;
  /** Сторона атакует своим залпом; иначе — только отвечает. */
  attacks: boolean;
  alive: boolean;
}

export interface SchemeLanes<T> {
  /** Нижний ряд: свои и союзники (в чужом бою — первая сторона и её не-враги). */
  ours: T[];
  /** Верхний ряд: все остальные. */
  theirs: T[];
  /** Игрока в бою нет: ни приказов, ни стрелок. */
  observer: boolean;
}

/** Ряды схемы (правило 1). */
export function schemeLanes<T extends SchemeSide>(
  sides: readonly T[],
  hostile: Hostility,
): SchemeLanes<T> {
  if (sides.some((s) => s.mine)) {
    const ours = [...sides.filter((s) => s.mine), ...sides.filter((s) => !s.mine && s.ally)];
    return { ours, theirs: sides.filter((s) => !ours.includes(s)), observer: false };
  }
  const lead = sides[0];
  const ours = lead ? sides.filter((s) => !hostile(lead.owner, s.owner)) : [];
  return { ours, theirs: sides.filter((s) => !ours.includes(s)), observer: true };
}

/** Видимый залп: от `from` к `to`; `of` — на сколько целей он делится, `reply` — ответ. */
export interface SchemeVolley {
  from: string;
  to: string;
  of: number;
  reply: boolean;
}

/** Стрелки, которые игрок вправе видеть (правила 2–3). */
export function visibleVolleys(sides: readonly SchemeSide[], hostile: Hostility): SchemeVolley[] {
  if (!sides.some((s) => s.mine)) return [];
  const ours = (s: SchemeSide): boolean => s.mine || s.ally === true;
  const live = sides.filter((s) => s.alive);
  const shots: SchemeVolley[] = [];
  const replies: SchemeVolley[] = [];
  for (const source of live) {
    if (!source.attacks) continue;
    const targets = live.filter((t) => t !== source && hostile(source.owner, t.owner));
    for (const target of targets) {
      if (ours(source))
        shots.push({ from: source.key, to: target.key, of: targets.length, reply: false });
      if (!target.attacks && ours(target))
        replies.push({ from: target.key, to: source.key, of: 1, reply: true });
    }
  }
  return [...shots, ...replies];
}

/** Ряд после сворачивания: что видно плитками и что ушло в «+N» (правило 4). */
export function foldLane<T extends { mine: boolean }>(
  list: readonly T[],
  open: boolean,
  max = LANE_MAX,
): { shown: T[]; folded: T[] } {
  if (open || list.length <= max) return { shown: [...list], folded: [] };
  // Свои остаются на виду при любом числе соседей.
  const own = list.filter((s) => s.mine);
  const room = Math.max(own.length, max - 1);
  const shown: T[] = [];
  let others = room - own.length;
  for (const s of list) {
    if (s.mine) shown.push(s);
    else if (others > 0) {
      shown.push(s);
      others -= 1;
    }
  }
  return { shown, folded: list.filter((s) => !shown.includes(s)) };
}

/** Перегруз линии державы (правило 5) или `null`, когда линия не перегружена. */
export interface LineOverload {
  /** Живых юнитов державы в бою. */
  count: number;
  /** Предел линии. */
  cap: number;
  /** С какой силой бьёт каждый, в процентах. */
  pct: number;
}

/**
 * `units` — все живые стеки моих сторон боя, `ground` — наземный ли род войск.
 * Предел — как у ядра (`cappedUnitBreakdown`): 20, когда все юниты наземные, иначе 10.
 */
export function lineOverload(
  units: readonly { unit: string; count: number }[],
  ground: (unit: string) => boolean,
): LineOverload | null {
  const live = units.filter((u) => u.count > 0);
  const count = live.reduce((n, u) => n + u.count, 0);
  const cap =
    live.length > 0 && live.every((u) => ground(u.unit)) ? GROUND_COMBAT_UNIT_CAP : COMBAT_UNIT_CAP;
  if (!(count > cap)) return null;
  return { count, cap, pct: Math.floor(combatEfficiency(count, cap) * 100) };
}

/**
 * Кому достанется мир (правило 6). `beachheads` — плацдармы этого боя В ПОРЯДКЕ ВЫСАДКИ.
 * Живых меньше двух — `null`: вопроса нет.
 */
export function worldHeir(
  beachheads: readonly { owner: string | null; alive: boolean }[],
): string | null {
  const alive = beachheads.filter((b) => b.alive && b.owner !== null);
  return alive.length >= 2 ? alive[0]!.owner : null;
}
