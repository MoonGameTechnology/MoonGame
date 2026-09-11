/**
 * ДЕЖУРНЫЙ ВЫЛЕТ (CC-4) — по кому бьёт база, у которой он включён.
 *
 * До SHU-2.2 дежурство армилось на ФЛОТ: «крыло» было флотом челноков, летало мимо
 * графа линий и держало собственный запас топлива. С SHU-1.1 такого флота не бывает
 * (челнок живёт в ангаре, в `Fleet.units` не попадает ниоткуда), поэтому дежурство
 * переехало на БАЗУ — мир с портом или носитель, — а вылет идёт обычным
 * `shuttle.strike`.
 *
 * Правило выбора цели живёт ЗДЕСЬ, в ядре, а не у драйверов, потому что драйверов ДВА
 * (прототипный и серверный) и до этого кирпича у каждого была своя копия: два
 * рукописных списка условий на одно правило — это вопрос времени, когда они разойдутся.
 *
 * 1. **Ближний раньше дальнего, при равной дистанции — меньший id.** Ровно то же
 *    правило, по которому выбирает цель ПЕРЕХВАТ (`shuttle.ts`, SHU-1.3): дежурный
 *    вылет и встречное звено поднимает одна и та же база из одного ангара, и два разных
 *    прицела у одного оружия объяснить игроку нечем. Сравнение по КВАДРАТУ расстояния —
 *    корень монотонен, а лишний `Math.sqrt` на каждом контакте не нужен.
 * 2. **Граница включительна** — та же мерка `withinRange`, по которой ядро пускает удар:
 *    цель, стоящая ровно на радиусе, достижима, иначе круг на карте обещал бы больше,
 *    чем разрешает вылет.
 * 3. **Нулевой радиус не бьёт вовсе.** Звена без дальности в ангаре не бывает, но если
 *    оно там окажется, дежурство обязано молчать, а не бить в упор.
 * 4. **Драйвер только ЧИТАЕТ мир, а правила удара спрашивает у ядра.** `patrolScrambles`
 *    ниже отбирает цели по туману владельца и объявленной войне — это чтение, а не
 *    правило. Топливо, перезарядку, дальность, «носитель стоит» и враждебность проверит
 *    сам `shuttle.strike` в момент вылета: вторая копия его условий разъехалась бы с ним
 *    на первой правке. Единственное, что драйвер всё же смотрит сам, — запас вылетов
 *    базы: подавать заведомо отклоняемый приказ каждое пробуждение уже пробовали (урок
 *    CC-2 про «обречённую пару»).
 * 5. **Порядок обхода баз сортирован.** JSONB не хранит порядок ключей, и без сортировки
 *    то, чей вылет уйдёт первым, зависело бы от хоста и от цикла гибернации
 *    (инвариант #6).
 */
import type { GameData } from '../data/schemas';
import type { GameState, Squadron } from './gameState';
import { getStance } from './diplomacy';
import { identifiedNodes } from './visibility';
import { canSortie, freshSortie, hangarMachines, squadronReach, withinRange } from './shuttle';

/** Точка на карте. */
export interface PatrolPoint {
  x: number;
  y: number;
}

/** Опознанный враждебный контакт — кандидат в цели. Кто попадает в список (туман,
 *  дипломатия, «стоит на узле»), решает драйвер: это чтение мира, а не правило. */
export interface PatrolContact {
  id: string;
  pos: PatrolPoint;
}

/** По кому бьёт дежурная база: ближайший контакт в радиусе (правила 1–3).
 *  `null` — бить некого. */
export function patrolTarget(
  center: PatrolPoint,
  radius: number,
  contacts: readonly PatrolContact[],
): string | null {
  if (radius <= 0) return null; // правило 3
  let bestId: string | null = null;
  let bestD2 = Infinity;
  for (const c of contacts) {
    if (!withinRange(center, c.pos, radius)) continue; // правило 2
    const dx = c.pos.x - center.x;
    const dy = c.pos.y - center.y;
    const d2 = dx * dx + dy * dy;
    // Правило 1: ближе — раньше; на равной дистанции побеждает меньший id.
    if (d2 < bestD2 || (d2 === bestD2 && bestId !== null && c.id < bestId)) {
      bestId = c.id;
      bestD2 = d2;
    }
  }
  return bestId;
}

/** Один готовый дежурный вылет: кому лететь и по кому. Драйвер хоста заворачивает это
 *  в свой `shuttle.strike` — форма действия у прототипа и у сервера своя, а решение
 *  одно. */
export interface PatrolScramble {
  owner: string;
  base: { kind: 'planet' | 'fleet'; id: string };
  squadronId: string;
  targetFleetId: string;
}

/** Вылеты, которые дежурные базы поднимают в этот тик (правила 1–5). Чистая функция от
 *  состояния: та же на обоих хостах, поэтому расходиться нечему. */
export function patrolScrambles(state: GameState, data: GameData): PatrolScramble[] {
  const patrols = state.patrols ?? {};
  const out: PatrolScramble[] = [];
  const identify = new Map<string, Set<string>>(); // владелец → опознанные узлы

  for (const baseId of Object.keys(patrols).sort()) {
    // правило 5
    const ref = patrols[baseId]!;
    const host =
      ref.kind === 'fleet'
        ? Object.prototype.hasOwnProperty.call(state.fleets, baseId)
          ? state.fleets[baseId]
          : undefined
        : Object.prototype.hasOwnProperty.call(state.planets, baseId)
          ? state.planets[baseId]
          : undefined;
    if (!host || host.owner === null) continue; // база исчезла — её подчистит GC модуля
    const owner: string = host.owner;

    // Носитель В ПУТИ не вылетает (`shuttle.strike` отбивает `E_FLEET_BUSY`), и точки
    // для радиуса у него тоже нет.
    let at: { x: number; y: number } | null;
    if (ref.kind === 'fleet') {
      const f = state.fleets[baseId]!;
      at = f.location ? (state.planets[f.location]?.position ?? null) : null;
    } else {
      at = state.planets[baseId]!.position;
    }
    if (!at) continue;

    const hangar: readonly Squadron[] = (host as { hangar?: Squadron[] }).hangar ?? [];
    const squad = hangar.find((q) => q.units.some((st) => st.count > 0));
    if (!squad) continue; // дежурить нечем
    const radius = squadronReach(squad, data);

    // Запас вылетов принадлежит БАЗЕ (SHU-1.2) и тратится тем же `shuttle.strike`.
    const machine = hangarMachines({ hangar: [...hangar] })[0];
    const maxFuel = Math.max(0, Math.floor(data.units[machine?.unit ?? '']?.stats.fuel ?? 0));
    const sortie = (host as { sortie?: { fuel: number; rearming: number } }).sortie ??
      freshSortie(maxFuel);
    if (!canSortie(sortie)) continue;

    let seen = identify.get(owner);
    if (!seen) {
      seen = identifiedNodes(state, owner, data);
      identify.set(owner, seen);
    }
    const targets: PatrolContact[] = [];
    for (const g of Object.values(state.fleets)) {
      if (g.owner === owner || !g.location || g.movement) continue;
      if (!g.units.some((u) => u.count > 0)) continue;
      if (getStance(state, owner, g.owner) !== 'war') continue; // только объявленная война
      if (!seen.has(g.location)) continue; // опознанные контакты — честно по туману
      const pos = state.planets[g.location]?.position;
      if (pos) targets.push({ id: g.id, pos });
    }
    const pick = patrolTarget(at, radius, targets);
    if (pick === null) continue;
    out.push({
      owner,
      base: { kind: ref.kind, id: baseId },
      squadronId: squad.id,
      targetFleetId: pick,
    });
  }
  return out;
}
