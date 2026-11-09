/**
 * ПУСК РАКЕТ В ХОДЕ БОТА (missiles-roadmap, шаг ботов).
 *
 * Ракеты стоят эскадрой в ангаре порта или в трюме носителя. Бот пускает их только по
 * видимому флоту врага в дальности ракеты: ракета бьёт наверняка, а по миру залп лишь
 * изнашивает здания, и запас ракет нужнее против кораблей. Цель — ближайшая, тай-брейк
 * по id; размер залпа — `missileSalvoSize` (`/decisions`): корпус цели и одна ракета
 * сверху, за вычетом своих ракет, которые уже летят в неё. Один залп за ход.
 */
import {
  MISSILE_SALVO,
  isMissileStack,
  squadronSize,
  type Fleet,
} from '../../../packages/shared-core/src/index';
import { launchMissiles } from '../../../decisions/actions';
import { missileSalvoSize } from '../../../decisions/missileSalvo';
import { canOrder } from '../protoKernel';
import { data } from '../gameData';
import type { Sorties } from './shuttles';
import type { AiTurn } from './turn';

/** Запас прочности флота: полные корпуса и остаток у раненого головного. */
function fleetHp(fl: Fleet): number {
  let hp = 0;
  for (const st of fl.units) {
    const max = data.units[st.unit]?.stats.hp ?? 0;
    if (st.count <= 0) continue;
    hp += (st.count - 1) * max + Math.min(max, st.hp ?? max);
  }
  return hp;
}

/** Своих ракет, которые уже летят в этот флот. */
function incomingAt(bot: AiTurn, fleetId: string): number {
  const guidance = bot.state.ordnance?.guidance ?? {};
  let n = 0;
  for (const [id, g] of Object.entries(guidance))
    if (g.fleetId === fleetId && bot.state.fleets[id]?.owner === bot.ai) n += 1;
  return n;
}

export function missileSalvo(bot: AiTurn, s: Sorties): void {
  const { ai, out, d, state } = bot;
  const { launchpads, taken, nearestBy, foeFleets, foeFleetPos } = s;
  for (const pad of launchpads) {
    const squad = pad.hangar.find(
      (q) =>
        !taken.has(q.id) &&
        q.units.length > 0 &&
        q.units.every((st) => st.count <= 0 || isMissileStack(st, data)),
    );
    if (!squad) continue;
    const unit = squad.units.find((st) => st.count > 0)?.unit;
    const def = unit ? data.units[unit] : undefined;
    const reach = def?.stats.strikeRange ?? 0;
    const warhead = def?.warhead?.damage ?? 0;
    if (!(reach > 0) || !(warhead > 0)) continue;
    const foes = foeFleets.filter((fl) => d(pad.at, foeFleetPos(fl)) <= reach);
    for (let left = foes; left.length > 0; ) {
      const foe = nearestBy(left, pad.at, foeFleetPos);
      if (!foe) break;
      const count = missileSalvoSize({
        targetHp: fleetHp(foe),
        warhead,
        incoming: incomingAt(bot, foe.id),
        available: squadronSize(squad),
        max: MISSILE_SALVO,
      });
      const order =
        count > 0
          ? launchMissiles(ai, pad.base, squad.id, { targetFleetId: foe.id }, count)
          : null;
      if (order && canOrder(state, order) === null) {
        out.push(order);
        taken.add(squad.id);
        return;
      }
      left = left.filter((fl) => fl.id !== foe.id);
    }
  }
}
