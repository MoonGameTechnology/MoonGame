/**
 * Выход из проигранного боя — недостающая половина боевого репертуара бота (AI-BAL-7).
 *
 * Тест-бот звал из боевого репертуара ядра только `fleet.assault` и `fleet.engage`, то есть
 * умел начинать драку и не умел её заканчивать: флот дрался до нуля, и **размен всегда был
 * полным**. Любой боевой замер на таком приборе систематически смещён — он мерит игру, в
 * которой никто не отступает, а такой игры нет.
 *
 * 1. **Прогноз — тот же, что у Хранителя, а не второй.** `previewBattle` уже написан и
 *    работает в `stewardGuard.ts`; заводить рядом вторую модель боя значило бы завести
 *    вторую правду о том, чем кончится драка (этот проект уже наелся таким классом — блок
 *    CONV).
 * 2. **Триггер — «прогноз ПРОИГРАН», а не «потери выше порога».** Выход стоит 40%
 *    ТЕКУЩЕГО корпуса и щита (`fleet.retreat` в `combat.ts`), поэтому бежать от дорогой, но
 *    выигранной драки убыточно: победа оставляет и флот, и убитого врага, а бегство платит
 *    пошлину и не даёт ничего. Отступление окупается ровно тогда, когда альтернатива —
 *    потерять флот целиком. По той же причине здесь НЕ применяется `STEWARD_LOSS_LIMIT`:
 *    он отвечает на другой вопрос — «стоять ли у своего узла», где выбор между боем и
 *    отходом БЕЗ пошлины.
 * 3. **Ничья (240-раундовый клапан) — не повод отступать.** Обе стороны остаются живы,
 *    и выход стоил бы 40% ни за что. Ветка защитная: ничья требует нулевого урона с обеих
 *    сторон, а в контенте прототипа юнита с `attack=0 defense=0` нет — поэтому на живых
 *    данных этот исход не встречается, но правило записано, чтобы новый юнит не открыл дыру.
 * 4. **Отступает только сторона КОРАБЛЕЙ.** Десант в разгаре высадки выйти не может —
 *    ядро отвечает `E_CANNOT_RETREAT`. Слать заведомо отклоняемое значит гнать мусор в
 *    редьюсер и портить статистику реджектов, по которой читают здоровье прогона.
 * 5. **Вне боя приказа нет** (`E_NOT_IN_BATTLE`) — по той же причине.
 * 6. **Почему это не бесконечная пошлина.** Выход не уводит флот с узла, и напрашивается
 *    опасение «вышел → тут же снова в бою → снова −40%». Его снимает сам триггер боя в
 *    ядре: `combatModule` начинает бой на СОБЫТИЯХ `fleet.arrived` / `fleet.transit` /
 *    `fleet.intercept`, а не на факте соседства, плюс по явному `fleet.engage` (его зовут
 *    только патруль и Хранитель). Значит вышедший флот стоит свободным до чьего-то нового
 *    ПРИЛЁТА, а свой следующий тик уводит его обычным `fleet.move` — и ядро ещё даёт ему
 *    на это `retreatHasteUntil` (ускорение отхода).
 */

import {
  previewBattle,
  type Action,
  type GameState,
  type PlayerId,
} from '../../packages/shared-core/src/index';
import { sideUnits } from '../../packages/shared-core/src/util/combat';
import { retreatFleet } from './actions';
import { data } from './prototypeData';

/** Приказы на выход из боёв, которые этот игрок уже проигрывает (правила 1–5). */
export function retreatOrders(state: GameState, ai: PlayerId): Action[] {
  const out: Action[] = [];
  for (const battle of Object.values(state.battles ?? {})) {
    // Наша сторона в ЭТОМ бою — и роль (кто бьёт `attack`, кто отвечает `defense`).
    const asAttacker = battle.attacker.owner === ai;
    const mine = asAttacker ? battle.attacker : battle.defender;
    const theirs = asAttacker ? battle.defender : battle.attacker;
    if (mine.owner !== ai) continue; // чужой бой
    if (mine.ref.kind !== 'fleet') continue; // правило 4: десант выйти не может

    const fleet = state.fleets[mine.ref.fleetId];
    if (!fleet || fleet.battleId == null) continue; // правило 5

    const myUnits = sideUnits(state, mine.ref);
    const theirUnits = sideUnits(state, theirs.ref);
    if (!myUnits?.length || !theirUnits?.length) continue;

    // Правило 1: прогноз считается в РОЛЯХ боя — атакующий бьёт `attack`, обороняющийся
    // отвечает `defense`, ровно как в живом раунде.
    const preview = asAttacker
      ? previewBattle(myUnits, theirUnits, data)
      : previewBattle(theirUnits, myUnits, data);
    const iWin = preview.outcome === (asAttacker ? 'attacker' : 'defender');
    const stalemate = preview.outcome === 'stalemate';
    if (iWin || stalemate) continue; // правила 2–3

    out.push(retreatFleet(ai, fleet.id));
  }
  return out;
}
