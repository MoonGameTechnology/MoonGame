/**
 * Squadron mechanics — the carrier-borne strike wing state machine: which stacks
 * a fleet launches, the sortie fuel/rearm counter, and the strike-radius reach
 * check. Extracted from `game.ts` (REFP-7): pure functions over `Fleet` + `data`,
 * no other game.ts deps. The patrol loop (SQ-4.1) stays in `game.ts` (REFP-23).
 * `game.ts` re-exports the public surface for `main.ts` / `squadron.test.ts`.
 */
import type { Fleet } from '../../packages/shared-core/src/index';
import { data } from './prototypeData';

/** The squadron-trait ship stacks aboard a fleet — what a carrier launches as a strike
 *  wing (squadrons-roadmap SQ-1.1: launch-as-unit). Pure. */
export function squadronTake(fleet: Fleet): Array<{ unit: string; count: number }> {
  return fleet.units
    .filter((st) => st.count > 0 && (data.units[st.unit]?.traits.includes('squadron') ?? false))
    .map((st) => ({ unit: st.unit, count: st.count }));
}

/** A wing's sortie budget: `fuel` strikes left before rearm, `rearming` rounds left on
 *  the rearm cooldown (0 = flight-ready). */
export interface SortieState {
  fuel: number;
  rearming: number;
}

/** The wing's max sortie budget + rearm length, read from its squadron unit's stats
 *  (schema defaults 0). Reads the FIRST squadron-trait stack of the fleet. */
export function sortieSpec(fleet: Fleet): { maxFuel: number; rearmRounds: number } {
  const st = fleet.units.find(
    (s) => s.count > 0 && (data.units[s.unit]?.traits.includes('squadron') ?? false),
  );
  const u = st ? data.units[st.unit]?.stats : undefined;
  return {
    maxFuel: Math.max(0, Math.floor(u?.fuel ?? 0)),
    rearmRounds: Math.max(0, Math.floor(u?.rearmRounds ?? 0)),
  };
}

/** A fresh, fully-fuelled wing. */
export function freshSortie(maxFuel: number): SortieState {
  return { fuel: Math.max(0, Math.floor(maxFuel)), rearming: 0 };
}

/** Flight-ready = not mid-rearm and has fuel to burn. */
export function canSortie(s: SortieState): boolean {
  return s.rearming <= 0 && s.fuel > 0;
}

/** Burn one sortie. When the last of the fuel goes the wing drops onto a rearm cooldown
 *  of `rearmRounds` (unavailable until it counts back down). A spend while not
 *  flight-ready is a no-op — guard with canSortie first. */
export function spendSortie(s: SortieState, rearmRounds: number): SortieState {
  if (!canSortie(s)) return s;
  const fuel = s.fuel - 1;
  return fuel <= 0
    ? { fuel: 0, rearming: Math.max(1, Math.floor(rearmRounds)) }
    : { fuel, rearming: 0 };
}

/** Advance the rearm cooldown one round; when it elapses the wing refuels to max and is
 *  flight-ready again. A wing that isn't rearming is unchanged. */
export function tickRearm(s: SortieState, maxFuel: number): SortieState {
  if (s.rearming <= 0) return s;
  const rearming = s.rearming - 1;
  return rearming <= 0
    ? { fuel: Math.max(0, Math.floor(maxFuel)), rearming: 0 }
    : { fuel: s.fuel, rearming };
}

/** Does this fleet carry a launchable strike wing (squadron-trait ships)? */
export function fleetHasSquadron(f: Fleet | undefined): boolean {
  return (
    !!f &&
    f.units.some((u) => u.count > 0 && (data.units[u.unit]?.traits.includes('squadron') ?? false))
  );
}

/**
 * Что такое ДЕЙСТВУЮЩЕЕ КРЫЛО — один ответ на панель и на обработчики (REFM-135).
 *
 * Крыло — отдельный флот, отколотый от носителя: у него есть `homeBase`, и оно умеет
 * бить в свободном пространстве, возвращаться на базу и вставать в патруль. Условия
 * этих трёх приказов панель и обработчики считали ПО-РАЗНОМУ: панель показывала секцию
 * по владельцу и наличию эскадрилий, а обработчики — только по наличию базы.
 *
 * 1. **Крыло — это флот с базой И с эскадрильями на борту.** Одной базы мало: у крыла,
 *    потерявшего эскадрильи в бою, база остаётся. Приказ от такого флота ядро всё равно
 *    отклонит (`E_NO_SHIPS`), но игрок получит ОТКАЗ вместо неактивной кнопки — интерфейс
 *    пообещал бы то, чего не может.
 * 2. **Чужим крылом не командуют.** Тап по чужому флоту тоже выделяет его, и без
 *    проверки владельца приказ ушёл бы за чужой флот — на сервере это отказ, на экране
 *    непонятное молчание.
 * 3. **Действовать крыло может только вне боя и вне перелёта** — в бою оно занято, в
 *    перелёте у него уже есть приказ, и второй его бы отменил незаметно для игрока.
 * 4. **Вернуться на базу можно только ИЗ свободного пространства.** Крыло, уже стоящее у
 *    носителя, слать домой незачем: ядро такой приказ примет (оно проверяет только базу и
 *    занятость), и получится приказ, который ничего не меняет.
 */

/** Это крыло игрока `me` — флот с базой и с эскадрильями на борту (правила 1–2). */
export function isWing(f: Fleet | undefined, me: string): boolean {
  return !!f && f.owner === me && !!f.homeBase && fleetHasSquadron(f);
}

/** Крыло свободно для приказа: не в бою и не в перелёте (правило 3). */
export function wingCanAct(f: Fleet | undefined): boolean {
  return !!f && !f.battleId && !f.freeMovement;
}

/** Крылу есть откуда возвращаться: оно в свободном пространстве (правило 4). */
export function wingCanReturn(f: Fleet | undefined): boolean {
  return wingCanAct(f) && !!f?.freePosition;
}

/** The wing's strike radius (map units) — the longest `strikeRange` among its live
 *  squadron ships. 0 = carries no strike wing. */
export function squadronStrikeRange(fleet: Fleet): number {
  let r = 0;
  for (const st of fleet.units) {
    if (st.count > 0 && (data.units[st.unit]?.traits.includes('squadron') ?? false)) {
      r = Math.max(r, data.units[st.unit]?.stats.strikeRange ?? 0);
    }
  }
  return r;
}

/** Is `target` within `range` (Euclidean map units) of `from`? Boundary inclusive — a
 *  target sitting exactly on the radius edge is reachable. */
export function withinRange(
  from: { x: number; y: number },
  target: { x: number; y: number },
  range: number,
): boolean {
  return Math.hypot(target.x - from.x, target.y - from.y) <= range;
}

/** Can the wing strike `targetPos` from its launch node at `fromPos`? Only a real strike
 *  wing (range > 0) whose target lies inside the radius (SQ-3.1). */
export function squadronReaches(
  fleet: Fleet,
  fromPos: { x: number; y: number },
  targetPos: { x: number; y: number },
): boolean {
  const r = squadronStrikeRange(fleet);
  return r > 0 && withinRange(fromPos, targetPos, r);
}
