import type { UnitStack } from './gameState';
import type { GameData } from '../data/schemas';
import { damageByClass, damageUnits, MAX_COMBAT_ROUNDS, stackHull } from '../util/combat';
import {
  addPools,
  hasGroundTargets,
  poolsTotal,
  splitDealt,
  targetedVolley,
  type ClassPools,
  type FireRole,
} from '../util/groundTargets';
import { cappedUnitStat } from '../util/stacks';
import { volleyShare } from '../util/volley';
import { effectiveStats } from '../util/loadout';
import { deepClone } from '../util/clone';

/**
 * Combat preview — «если атакую — что будет?» (ONB-6 / G4, onboarding-roadmap §ONB-6).
 *
 * A PURE what-if over the combat module's own round engine: the same simultaneous
 * round — aggressor fires `attack`, the standing side answers with `defense` — the
 * same tier-ordered pure damage model (`damageUnits`: front→mid→rear,
 * ablative shields first, whole units lost as pools drop), the same stalemate
 * valve. Inputs are never mutated (the sim runs on deep clones); no bus, no
 * schedule, no RNG — combat resolution is fully deterministic.
 *
 * It is a FORECAST, not an oracle (the spec's bar is sign-agreement, not
 * equality): the live battle additionally pipes each round through the
 * `combat.damage` hook — terrain, planet type, standing fortifications, faction
 * and technology passives, hero auras. Those are deliberately NOT folded in:
 * a module-faithful preview would need the match kernel, and — worse — would
 * leak the ENEMY's hidden bonuses (their researched techs, faction passives,
 * hero fittings) through the predicted numbers. The base model reads only unit
 * compositions, which is exactly what the viewer legitimately sees; when hidden
 * bonuses flip a close fight, that is the fog of war doing its job.
 *
 * Fog discipline is the CALLER's: feed it sides the viewer legitimately knows
 * (own units vs an identified world's garrison / an identified fleet; a client
 * naturally holds only the fog-projected state, so this is structural there).
 */

/** One side's forecast: what's left and what it cost. */
export interface BattlePreviewSide {
  /** Surviving stacks (count > 0) at the forecast's end. */
  survivors: UnitStack[];
  /** Units lost, aggregated per unit id. */
  losses: UnitStack[];
  /** Share of this side's HULL the forecast says it loses, in [0,1] — the
   *  «ответный урон» number a commit-or-retreat rule thresholds on (ST-3.1).
   *  Measured on hull pools ({@link hullPool}): a wing ground down to 1% hp
   *  reads as ~1, where a whole-units count would read ~0. An empty side is 0
   *  (nothing to lose) — callers gate on emptiness separately. */
  damageFraction: number;
}

/** Current HULL pool of a stack list: Σ per-stack residual `hp` (a battle-worn
 *  stack keeps its partial pool), or full `count × effective hp` when healthy.
 *  The per-stack arithmetic IS `damageUnits`' own (`stackHull`, one shared
 *  copy), so a fraction of this pool is a fraction of what the damage model
 *  actually chews through. Shields are deliberately EXCLUDED: they regenerate
 *  between engagements, so only lasting hull damage counts. */
export function hullPool(units: readonly UnitStack[], data: GameData): number {
  let total = 0;
  for (const s of units) {
    const def = data.units[s.unit];
    if (!def || s.count <= 0) continue;
    total += stackHull(s, effectiveStats(def, s, data).hp).pool;
  }
  return total;
}

/** The forecast: winner (by the combat module's rule — the side left standing;
 *  both dead or the 240-round valve → `stalemate`), rounds fought, both sides. */
export interface BattlePreview {
  outcome: 'attacker' | 'defender' | 'stalemate';
  roundsEst: number;
  attacker: BattlePreviewSide;
  defender: BattlePreviewSide;
}

const alive = (units: UnitStack[]): boolean => units.some((s) => s.count > 0);

/** Losses = per-unit difference between the input and the surviving counts.
 *  Insertion order of the input pins the output order (deterministic). */
function lossesOf(before: readonly UnitStack[], after: UnitStack[]): UnitStack[] {
  const beforeN = new Map<string, number>();
  for (const s of before) beforeN.set(s.unit, (beforeN.get(s.unit) ?? 0) + s.count);
  const afterN = new Map<string, number>();
  for (const s of after) afterN.set(s.unit, (afterN.get(s.unit) ?? 0) + s.count);
  const out: UnitStack[] = [];
  for (const [unit, n] of beforeN) {
    const lost = n - (afterN.get(unit) ?? 0);
    if (lost > 0) out.push({ unit, count: lost });
  }
  return out;
}

/** Одна сторона в многостороннем прогнозе: чем она бьёт и кому враждебна. */
export interface PreviewSideInput {
  units: readonly UnitStack[];
  /** Роль в ИДУЩЕМ бою: атакующий бьёт `attack`, обороняющийся отвечает `defense`. В
   *  следующих звеньях цепочки роли раздаёт правило пересцепки (см. {@link previewSides}). */
  role: 'attacker' | 'defender';
  /** Владелец — нужен только чтобы спросить вражду; для безымянной дуэли не нужен. */
  owner?: string | null;
  /** Порядок пересцепки после гибели: живой бой обходит выживших флоты по id. Ключи — у
   *  всех сторон или ни у одной; без них порядок — порядок входа. */
  key?: string;
  /** Сторона держит мир — гарнизон наземного боя. Есть такая сторона — бой наземный: она
   *  обороняется в каждом звене, а выжившие между звеньями отдыхают (см. {@link previewSides}). */
  holds?: boolean;
}

export interface MultiBattlePreview {
  /** `decided` — в конце цепочки осталась ровно одна сторона (как `winner` живого боя,
   *  MSB-3). `stalemate` — всё остальное: предохранитель, никто никому не враг, погибли
   *  все или устояли несколько невраждующих. */
  outcome: 'decided' | 'stalemate';
  /** Раундов во всех звеньях цепочки вместе. */
  roundsEst: number;
  /** В ТОМ ЖЕ порядке, что и вход. */
  sides: BattlePreviewSide[];
}

type Role = PreviewSideInput['role'];

/**
 * ПРОГНОЗ НА N СТОРОН (MSB-6, UIX-6.3) — зеркало живого боя, правило в правило.
 *
 * РАУНД — тот же, что `combat.tick` 3.x. Предраундовый снимок (сперва ВСЕ залпы, потом
 * весь урон), кап линии огня на сторону. Атакующий делит свой `attack` между всеми
 * враждебными живыми (`volleyShare`, MSB-2), а обороняющийся отвечает КАЖДОМУ атакующему,
 * который его бьёт, полным `defense` по нему одному (§0.0 №1, уточнение 2026-09-28). Сам
 * обороняющийся первым не стреляет: двое обороняющихся друг друга не бьют. Часы у всех
 * атакующих общие — разнесённые «В атаку» по времени залпы прогноз сводит в один раунд.
 *
 * ЦЕПОЧКА (§0.0 №5). Гибель любой стороны закрывает бой, но выжившие тут же сцепляются
 * заново, поэтому прогноз досчитывает все звенья до конца:
 *  · на орбите — как `finishBattle`→`engageFleets`: первый по ключу выживший, у которого
 *    есть враг, нападает; его первый по ключу враг обороняется; все, кто враждебен
 *    кому-нибудь в новом бою, вступают атакующими. Корабли уносят урон в новое звено;
 *  · на земле (есть сторона `holds`) — как штурм после гибели: мир держит обороняющийся,
 *    враждебные ему берега атакуют. Пал гарнизон — мир берёт первый уцелевший берег этого
 *    звена и уже сам обороняется. Между звеньями наземные стороны возвращаются в покой —
 *    полный корпус и щит у уцелевших стеков, как после любого наземного боя.
 * Цепочку обрывает предохранитель `MAX_COMBAT_ROUNDS` в любом звене (после ничьей никто
 * не сцепляется, CMB-6) или бой, где стрелять некому.
 *
 * Чего прогноз не знает: что в звено вступят флоты, которых нет во входе, и что выжившие
 * разобьются на два независимых боя (он ведёт один бой за раз). Союзные берега после
 * захвата садятся на флоты или вливаются в гарнизон — это уже не бой, и этого он тоже не
 * считает.
 *
 * `hostile` спрашивается у вызывающего, потому что вражда живёт в состоянии, а прогноз
 * чистый: у него нет ни шины, ни дипломатии. Не передали — все против всех (так считает
 * и ядро без модуля дипломатии, `isHostile` вырождается в «разные владельцы враждебны»).
 */
export function previewSides(
  input: readonly PreviewSideInput[],
  data: GameData,
  hostile?: (a: string | null | undefined, b: string | null | undefined) => boolean,
): MultiBattlePreview {
  // damageUnits мутирует то, что ему дали, — симуляция идёт по приватным копиям.
  const live = input.map((s) => deepClone(s.units as UnitStack[]).filter((x) => x.count > 0));
  const up = (i: number): boolean => alive(live[i]!);
  const foes = (i: number, j: number): boolean =>
    i !== j && (hostile ? hostile(input[i]!.owner, input[j]!.owner) : true);
  // Порядок пересцепки: по ключу, если он есть у всех, иначе порядок входа.
  const order = input.map((_, i) => i);
  if (input.length > 0 && input.every((s) => s.key !== undefined)) {
    order.sort((a, b) => {
      const ka = input[a]!.key!;
      const kb = input[b]!.key!;
      return ka < kb ? -1 : ka > kb ? 1 : a - b;
    });
  }
  const ground = input.some((s) => s.holds);
  let holder = input.findIndex((s) => s.holds);

  /** Один раунд звена `link`. Ложь — стрелять некому (никто из атакующих не враг никому). */
  const round = (link: readonly number[], roles: readonly Role[]): boolean => {
    const incoming = new Array<number>(input.length).fill(0);
    // Урон по роду войск — то же правило, что в живом раунде (`util/groundTargets.ts`):
    // против наземных войск залп считается под состав цели и ложится по родам.
    const byClass = new Array<ClassPools | undefined>(input.length).fill(undefined);
    const fire = (from: number, targets: readonly number[], role: FireRole): void => {
      if (targets.some((j) => hasGroundTargets(live[j]!, data))) {
        for (const j of targets) {
          const shot = targetedVolley(live[from]!, live[j]!, data, role);
          const share = volleyShare(shot.total, targets.length);
          incoming[j]! += share;
          const pools = splitDealt(shot.pools, shot.total, share);
          byClass[j] = byClass[j] ? addPools(byClass[j]!, pools) : pools;
        }
        return;
      }
      const share = volleyShare(cappedUnitStat(live[from]!, data, role), targets.length);
      for (const j of targets) incoming[j]! += share;
    };
    // Порядок обмена — порядок живого такта: атакующий бьёт, и тут же ему отвечают
    // обороняющиеся из его врагов. Числа те же при любом порядке; порядок держит
    // сложение долей бит в бит.
    let fired = false;
    for (const i of link) {
      if (roles[i] !== 'attacker') continue;
      const targets = link.filter((j) => foes(i, j));
      if (targets.length === 0) continue;
      fired = true;
      fire(i, targets, 'attack');
      for (const j of targets) if (roles[j] === 'defender') fire(j, [i], 'defense');
    }
    if (!fired) return false;
    for (const i of link) {
      if (!(incoming[i]! > 0)) continue;
      const pools = byClass[i];
      live[i] = pools
        ? damageByClass(
            live[i]!,
            { ...pools, other: pools.other + Math.max(0, incoming[i]! - poolsTotal(pools)) },
            data,
          ).survivors
        : damageUnits(live[i]!, incoming[i]!, data).survivors;
    }
    return true;
  };

  /** Следующее звено цепочки: участники в порядке сторон нового боя и их роли, либо
   *  null — враждебной пары среди выживших больше нет. */
  const relink = (last: readonly number[]): [number[], Role[]] | null => {
    const standing = order.filter(up);
    const rolesFor = (defender: number): Role[] =>
      input.map((_, i) => (i === defender ? 'defender' : 'attacker'));
    if (ground) {
      // Мир взят — его держит первый уцелевший берег этого звена (MSB-4, §0.0 №4).
      if (!up(holder)) {
        const captor = standing.find((i) => last.includes(i));
        if (captor === undefined) return null;
        holder = captor;
      }
      const attackers = standing.filter((i) => foes(i, holder));
      if (attackers.length === 0) return null;
      return [[attackers[0]!, holder, ...attackers.slice(1)], rolesFor(holder)];
    }
    const first = standing.find((i) => standing.some((j) => foes(i, j)));
    if (first === undefined) return null;
    const defender = standing.find((j) => foes(first, j))!;
    const link = [first, defender];
    // Втягиваются все, кому в новом бою есть с кем драться; проходы — пока кто-то вступает
    // (вступивший мог стать врагом тому, кто прошлым проходом врагов не имел).
    for (let joined = true; joined;) {
      joined = false;
      for (const i of standing) {
        if (link.includes(i) || !link.some((j) => foes(i, j))) continue;
        link.push(i);
        joined = true;
      }
    }
    return [link, rolesFor(defender)];
  };

  // Звено первое — бой как он есть: все стороны, роли со входа.
  let link = input.map((_, i) => i);
  let roles: Role[] = input.map((s) => s.role);
  let rounds = 0;
  let stalemate = false;
  for (;;) {
    let linkRounds = 0;
    while (link.every(up)) {
      rounds += 1;
      linkRounds += 1;
      // Как и у живого предохранителя: счётчик ПРЕВЫШАЕТ кап, сам раунд не считается.
      // Никто никому не враг — бой не идёт вовсе, и крутить его до предохранителя значило
      // бы обещать игроку 240 раундов там, где не будет ни одного (живой такт закрывает
      // такой бой перемирием, CMB-7).
      if (linkRounds > MAX_COMBAT_ROUNDS || !round(link, roles)) {
        stalemate = true;
        break;
      }
    }
    if (stalemate) break;
    // Наземный бой отпускает выживших «в покое» (`finishBattle`): частичный корпус и щит
    // стеков сбрасываются, и новое звено они начинают целыми.
    if (ground) {
      for (const i of link) {
        for (const st of live[i]!) {
          delete st.hp;
          delete st.shieldHp;
        }
      }
    }
    const next = relink(link);
    if (!next) break;
    [link, roles] = next;
  }
  const survivorCount = live.filter((u) => alive(u)).length;
  const sideOf = (before: readonly UnitStack[], after: UnitStack[]): BattlePreviewSide => {
    const total = hullPool(before, data);
    const fraction = total > 0 ? 1 - hullPool(after, data) / total : 0;
    return { survivors: after, losses: lossesOf(before, after), damageFraction: fraction };
  };
  return {
    outcome: !stalemate && survivorCount === 1 ? 'decided' : 'stalemate',
    roundsEst: rounds,
    sides: input.map((s, i) => sideOf(s.units, live[i]!)),
  };
}

/**
 * Forecast a battle between `attacker` (the aggressor: strikes with `attack`)
 * and `defender` (returns fire with `defense`) — fleet vs fleet, or a landing
 * force vs a garrison (the engine is the same for every combatant kind).
 * Pure and deterministic; the inputs are never mutated.
 */
export function previewBattle(
  attacker: readonly UnitStack[],
  defender: readonly UnitStack[],
  data: GameData,
): BattlePreview {
  // Дуэль — ЧАСТНЫЙ СЛУЧАЙ многостороннего расклада, а не отдельный алгоритм (MSB-6).
  // Двусторонняя петля, стоявшая здесь, повторяла правила боя своими словами; теперь
  // они произносятся один раз в `previewSides`, и разойтись двум прогнозам негде.
  const sim = previewSides(
    [
      { units: attacker, role: 'attacker' },
      { units: defender, role: 'defender' },
    ],
    data,
  );
  const a = sim.sides[0]!.survivors;
  const d = sim.sides[1]!.survivors;
  const rounds = sim.roundsEst;
  const stalemate = sim.outcome === 'stalemate';
  const aAlive = alive(a);
  const dAlive = alive(d);
  const outcome: BattlePreview['outcome'] =
    !stalemate && aAlive && !dAlive
      ? 'attacker'
      : !stalemate && dAlive && !aAlive
        ? 'defender'
        : 'stalemate';
  // No clamp needed: survivors are a subset of `before` whose pools only ever
  // shrink (damageUnits subtracts, never adds), so the ratio is in [0,1] by
  // construction — same insertion order, term-wise smaller, monotone float sum.
  const side = (before: readonly UnitStack[], after: UnitStack[]): BattlePreviewSide => {
    const total = hullPool(before, data);
    const fraction = total > 0 ? 1 - hullPool(after, data) / total : 0;
    return { survivors: after, losses: lossesOf(before, after), damageFraction: fraction };
  };
  return {
    outcome,
    roundsEst: rounds,
    attacker: side(attacker, a),
    defender: side(defender, d),
  };
}

/** Total units lost by a forecast side — the one-glance number for a HUD readout. */
export function previewLossCount(side: BattlePreviewSide): number {
  return side.losses.reduce((n, s) => n + s.count, 0);
}
