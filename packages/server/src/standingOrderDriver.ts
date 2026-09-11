/**
 * Server-side standing-order drivers — the missing "who decides, and when" half of
 * `standingOrdersModule` (`@void/shared-core`, CC-2 auto-storm / CC-4 дежурный вылет).
 * The core module only stores/validates a player's INTENT
 * (`state.autoAssault`/`state.patrols`) and garbage-collects it for dead fleets and
 * lost worlds; nothing decided WHEN to act on it in a real multiplayer room —
 * `clockDriver.ts`'s own doc comment flags this exact gap ("the prototype host reads
 * [onTick's `progressed`] to skip its AI/standing-order drivers on a stalled tick").
 *
 * Port of the prototype's `serverAutoAssaultActions`/`serverPatrolActions`
 * (`prototype/src/serverDrivers.ts`, REFP-24), adapted to canon's action set.
 *
 * **CC-4 ПЕРЕЕХАЛ НА БАЗУ (SHU-2.2).** Раньше драйвер гонял ФЛОТ челноков
 * (`fleet.engage`/`fleet.move`) и сам вёл его топливо серверным штампом `patrol.stamp`.
 * Теперь дежурит БАЗА — мир с портом или носитель, — и вылет идёт обычным
 * `shuttle.strike`: топливо, перезарядку, дальность и враждебность цели считает ЯДРО
 * в момент удара, драйверу остаётся только чтение мира (туман + дипломатия) и выбор
 * цели. Само правило выбора живёт в ядре (`patrolTarget`) — до этого кирпича здесь
 * лежала ВТОРАЯ его копия, своя у сервера и своя у прототипа.
 *
 * `serverChainActions` (CC-1 order chains) is NOT ported here — a separate,
 * larger follow-up (more step kinds, hero-ability cooldown tracking).
 *
 * Both functions are pure: given `(state, data)` they return the actions to submit —
 * via `MatchRoom.submitServerAction`, bypassing the ActionGate like the AI/AvA
 * drivers. The caller applies them; a rejected action is simply skipped, never
 * retried forever (the CC-2 rejected-churn lesson the prototype already learned).
 */
import {
  patrolScrambles,
  type Action,
  type GameData,
  type GameState,
  type PatrolScramble,
} from '@void/shared-core';

let seq = 0;
/** A driver-issued action id: deterministic enough to read at a glance in logs,
 *  unique enough per tick that two decisions never collide (`submitServerAction`
 *  dedups by id — a genuine retry of the SAME decision should reuse one, but this
 *  driver never retries its own submissions, only re-decides next tick). */
function driverActionId(kind: string, fleetId: string): string {
  return `driver:${kind}:${fleetId}:${seq++}`;
}

/**
 * One tick of the CC-2 auto-storm driver: every fleet flagged in `state.autoAssault`
 * whose storm orders the KERNEL would accept gets them issued (orbit first if not
 * already in orbit, then assault).
 *
 * RULES-3. Правила штурма — захватываемость цели, владелец, дипломатия, чужой флот на
 * узле, наличие десанта, уже идущий наземный бой — здесь БОЛЬШЕ НЕ ПЕРЕПИСЫВАЮТСЯ.
 * Их называет ядро через `probe` (`MatchRoom.canApplyAll`) тем же кодом, каким отбило
 * бы сам приказ. Флаг игрока (`autoAssault`) остаётся: это не правило, а согласие.
 *
 * Спрашивается вся ПАРА сразу — штурм нелегален с дальней орбиты, так что вопрос об
 * одном лишь штурме вернул бы `E_WRONG_ORBIT` про мир ДО первого действия пары. Заодно
 * бесплатно закрылись отказы, которых рукописные условия не знали (`E_NO_TROOPS`,
 * `E_UNDER_ASSAULT`) и которые драйвер поэтому выдавал каждый тик — ровно тот
 * rejected-churn, против которого была написана вся остальная защита.
 *
 * `probe` не опционален СПЕЦИАЛЬНО: дефолт «если ядра не дали — решай сам» вернул бы
 * вторую копию правил через чёрный ход.
 */
export function autoAssaultActions(
  state: GameState,
  probe: (state: GameState, actions: readonly Action[]) => string | null,
): Array<{ playerId: string; action: Action }> {
  const flagged = state.autoAssault ?? {};
  const out: Array<{ playerId: string; action: Action }> = [];
  for (const fid of Object.keys(flagged).sort()) {
    const f = state.fleets[fid];
    if (!f) continue; // нет флота — не из чего собрать приказ (нужен f.owner)
    const orbit: Action = {
      id: driverActionId('orbit', fid),
      type: 'fleet.orbit',
      playerId: f.owner,
      payload: { fleetId: fid, orbit: 'near' },
      issuedAt: state.time,
    };
    const assault: Action = {
      id: driverActionId('assault', fid),
      type: 'fleet.assault',
      playerId: f.owner,
      payload: { fleetId: fid },
      issuedAt: state.time,
    };
    const pair = f.orbit !== 'near' ? [orbit, assault] : [assault];
    if (probe(state, pair) !== null) continue;
    for (const action of pair) out.push({ playerId: f.owner, action });
  }
  return out;
}
/**
 * Один тик драйвера ДЕЖУРНОГО ВЫЛЕТА (CC-4, на базе с SHU-2.2) — обёртка над ядром.
 *
 * Решение целиком в `patrolScrambles` (`shared-core/state/patrol.ts`): и выбор цели, и
 * чтение мира. Здесь остаётся ровно одно — завернуть его в канонический `shuttle.strike`
 * с детерминированным id действия. До SHU-2.2 тут лежала ВТОРАЯ копия правил (своя у
 * сервера, своя у прототипа), и они уже разошлись мелочами.
 */
export function patrolActions(
  state: GameState,
  data: GameData,
): Array<{ playerId: string; action: Action }> {
  return patrolScrambles(state, data).map((sc: PatrolScramble) => ({
    playerId: sc.owner,
    action: {
      id: driverActionId('scramble', sc.base.id),
      type: 'shuttle.strike',
      playerId: sc.owner,
      payload: {
        ...(sc.base.kind === 'planet' ? { planetId: sc.base.id } : { fleetId: sc.base.id }),
        squadronId: sc.squadronId,
        targetFleetId: sc.targetFleetId,
      },
      issuedAt: state.time,
    },
  }));
}

/** Both drivers for one tick, in a fixed order (auto-storm then patrol) — the
 *  single call site `serverWiring.ts` needs. `probe` is the room's kernel verdict
 *  (`MatchRoom.canApplyAll`): auto-storm asks it instead of re-stating the assault
 *  rules (RULES-3). */
export function standingOrderTickActions(
  state: GameState,
  data: GameData,
  probe: (state: GameState, actions: readonly Action[]) => string | null,
): Array<{ playerId: string; action: Action }> {
  return [...autoAssaultActions(state, probe), ...patrolActions(state, data)];
}
