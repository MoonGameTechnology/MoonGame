/**
 * Кто встанет в бой «Атаки» — состав, который прицел отдаёт прогнозу (ATK-3).
 *
 * Прогноз честен, только пока считает тот бой, который заведёт ядро. А бой у мира цели
 * втягивает всех свободных, у кого в нём есть враг (S3, MSB-3): и бой прибытия, и с ATK-3 бой
 * «Атаки». Поэтому в прогноз идут не только выделенные флоты и цель.
 *
 * 1. **Цель уже дерётся — бой её.** Прогноз берёт его стороны с их ролями, а выделенные
 *    флоты вступают в него атакующими: идущий бой важнее новой дуэли, и для «Атаки», и для
 *    прибытия.
 * 2. **Иначе бой новый:** выделенные флоты — атакующие, цель — обороняющийся.
 * 3. **Потом втягивание, как `pullInBystanders` ядра.** Свободный флот у мира цели вступает
 *    атакующим, если в бою есть его враг. Проход повторяется, пока кого-то втягивает:
 *    вступивший бывает врагом тому, у кого прошлым проходом врагов в бою не было. Мина не
 *    вступает; корабли, чей десант дерётся на земле, свободны (ASSAULT-1).
 * 4. **Своя колонка — как в окне боя:** мои флоты и флоты союза или пакта (`ally`).
 *
 * Выделенный флот, занятый другим боем, в состав не идёт: приказ он отвергнет. Не идёт ни
 * один — боя «Атаки» не будет, и состав пуст: прогноз не обещает бой, которого не случится
 * (рядом могли бы стоять мои невыделенные флоты, но их приказ не двигает). Выделенный
 * флот вдали идёт стороной сразу, хотя придёт маршем позже: прогноз считает бой, а не дорогу
 * к нему (так было и в UIX-6.3). Туман соблюдён тем, что состав берётся из видимого игроку
 * состояния: кого игрок не видит, того прогноз не знает.
 */
import {
  attacks,
  getStance,
  isMineFleet,
  shipsEngaged,
  type Fleet,
  type GameData,
  type GameState,
} from '../packages/shared-core/src/index';
import type { ForecastSide, Hostility } from './battleForecast';

const alive = (f: Fleet): boolean => f.units.some((u) => u.count > 0);

/** Стороны боя «Атаки» выделенных флотов `selected` по флоту `target` глазами игрока `me`. */
export function engageRoster(
  state: GameState,
  me: string,
  selected: readonly Fleet[],
  target: Fleet,
  data: GameData,
  hostile: Hostility,
): ForecastSide[] {
  const sides: ForecastSide[] = [];
  const taken = new Set<string>();
  const add = (f: Fleet, role: ForecastSide['role']): void => {
    const ally = f.owner !== me && ['alliance', 'pact'].includes(getStance(state, me, f.owner));
    sides.push({
      mine: f.owner === me,
      ...(ally ? { ally } : {}),
      role,
      units: f.units,
      owner: f.owner,
      key: f.id,
    });
    taken.add(f.id);
  };
  const fight =
    shipsEngaged(state, target) && target.battleId ? state.battles[target.battleId] : undefined;
  if (fight) {
    for (const side of fight.sides) {
      const f = side.ref.kind === 'fleet' ? state.fleets[side.ref.fleetId] : undefined;
      if (f && alive(f)) add(f, attacks(side) ? 'attacker' : 'defender');
    }
  } else {
    add(target, 'defender');
  }
  for (const f of selected) {
    if (!taken.has(f.id) && alive(f) && !shipsEngaged(state, f)) add(f, 'attacker');
  }
  // Ни один выделенный флот в бой не попадёт — боя «Атаки» не будет, и считать нечего.
  if (!selected.some((f) => taken.has(f.id))) return [];
  const at = target.location;
  if (!at) return sides;
  const hasEnemy = (owner: string): boolean =>
    sides.some((x) => x.owner !== null && hostile(owner, x.owner));
  for (;;) {
    let joined = false;
    // Тот же порядок, что у ядра: кто вступит раньше, решает сортировка id, а не порядок обхода.
    for (const id of Object.keys(state.fleets).sort()) {
      const f = state.fleets[id]!;
      if (taken.has(id) || f.location !== at || shipsEngaged(state, f)) continue;
      if (!alive(f) || isMineFleet(f, data) || !hasEnemy(f.owner)) continue;
      add(f, 'attacker');
      joined = true;
    }
    if (!joined) return sides;
  }
}
