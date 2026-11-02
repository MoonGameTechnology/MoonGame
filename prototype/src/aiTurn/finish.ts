/** КОНЕЦ ХОДА БОТА (SLIM-3): какие из собранных приказов уходят ядру. */
import { type Action } from '../../../packages/shared-core/src/index';
import { canOrder } from '../protoKernel';
import { netIncome } from '../economy';
import { data } from '../gameData';
import type { AiTurn } from './turn';

/** На сколько часов минуса по кредитам должно хватать казны, чтобы бот заказал новые
 *  войска: каждое из них добавляет содержание, а кредитов оно не приносит. */
const CREDIT_RUNWAY_HOURS = 48;

export function finishTurn(bot: AiTurn): Action[] {
  const { state, ai, out, swarmInhabitant, saving, trailing } = bot;
  // Новая партия начинает только с разведчика: закрытые заказы ждут исследования.
  // Решение о доступности остаётся у ядра, включая войска десантного челнока и героев.
  const unlocked = swarmInhabitant
    ? out.filter((a) => canOrder(state, a) === null)
    : state.techRules?.ruleset === 'main'
    ? out.filter((a) => canOrder(state, a) !== 'E_TECH_LOCKED')
    : out;
  // Production orders are independent intents. Ask the reducer before ordering:
  // bombardment, a full queue or a missing prerequisite can suppress this world.
  // Fleet preparation/course pairs are checked together by the host instead.
  const available = unlocked.filter(
    (a) => !['unit.build', 'building.construct', 'building.upgrade'].includes(a.type) ||
      canOrder(state, a) === null,
  );
  // Копилка доктрины: войска, которые тратят то, на что место копит узел ветки, ждут.
  const held =
    saving.size === 0
      ? available
      : available.filter((a) => {
          if (a.type !== 'unit.build') return true;
          const p = a.payload as { unit: string; modules?: string[]; troop?: string };
          const costs = [
            data.units[p.unit]?.cost,
            ...(p.modules ?? []).map((m) => data.modules[m]?.cost),
            p.troop !== undefined ? data.units[p.troop]?.cost : undefined,
          ];
          return !costs.some((c) => [...saving].some((r) => (c?.[r] ?? 0) > 0));
        });
  // Ведущий не строит войска в долг (решение владельца 2026-10-08). Лишний металл бот
  // переводил в ополчение и разведчиков, их содержание съедало кредиты, и после 20-го дня
  // место жило в долгах треть партии (`econplaytest 30 4 3`: медиана 274 ч из ~721), а в
  // долге постройки, содержащиеся кредитами, работают вполсилы (`BROWNOUT`). Пока кредиты
  // в долге или казны не хватит на CREDIT_RUNWAY_HOURS минуса, заказы `unit.build`
  // снимаются — но только у того, кто не отстаёт: отстающему надо защищаться, и он строит
  // до последнего. Постройки и рынок правило не трогает.
  if (trailing) return held;
  const me = state.players[ai]!;
  const creditFlow = netIncome(state, ai).credits ?? 0;
  const creditsDry =
    (me.arrears ?? []).includes('credits') ||
    (creditFlow < 0 && (me.resources.credits ?? 0) < -creditFlow * CREDIT_RUNWAY_HOURS);
  return creditsDry ? held.filter((a) => a.type !== 'unit.build') : held;
}
