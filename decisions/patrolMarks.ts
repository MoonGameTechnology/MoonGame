import type { ShuttleStrike, Squadron, StrikeBase } from '../packages/shared-core/src/index';

/**
 * ПАТРУЛЬ ГЛАЗАМИ ИГРОКА (SHU-6.3) — что карта и панель базы показывают про свои патрули.
 *
 * Ядро держит патруль обычным вылетом (SHU-6.2): цель `{ kind: 'point' }`, поле
 * `patrol { hours, radius }` и ноги `out` → `patrol` → `back`. Значок над точкой уже
 * ставит трасса (`strikeTrail.ts`); здесь то, чего трасса не знает: круг, в котором
 * патруль бьёт, сколько ему ещё висеть и какой вылет можно вернуть.
 *
 * 1. **Только свои.** `visibleState` снимает чужие вылеты целиком, и соло обязано
 *    повторить этот фильтр (правило 1 `strikeTrail.ts`): метка несёт базу, срок и
 *    «Вернуть» — это тыл и планы хозяина. Чужой висящий патруль в обзоре виден иначе:
 *    кругом и составом из `patrolsSeenBy` ядра (SHU-6.10), без отсчёта и без базы.
 * 2. **Метка живёт, пока патруль не повернул домой.** На пути к точке (`out`) круг уже
 *    виден, чтобы игрок знал, где эскадра встанет, но без отсчёта: бить она ещё не
 *    начала. Над точкой (`patrol`) у круга есть остаток. Обратная нога (`back`) метки не
 *    получает: круг обещал бы прикрытие, которого уже нет.
 * 3. **Остаток — до `arrivesAt` ноги `patrol`.** Ровно туда ядро ставит разворот, и
 *    отсчёт обязан кончиться в тот же миг. Кадр, опередивший тик, даёт ноль, а не минус.
 * 4. **Вернуть можно и в пути, и над точкой** — ровно там, где ядро примет
 *    `shuttle.recall` (`E_NOT_PATROLLING` у него только на обратной ноге). Поэтому адрес
 *    приказа (`id` вылета) есть у каждой метки.
 * 5. **Круг без радиуса не рисуется:** «радиус 0» — не факт о мире (то же правило, что у
 *    круга прицела `aimRing`).
 * 6. **«Держать патруль» видно у метки** (SHU-6.6): `hold` — тот же флаг, по которому
 *    ядро поднимет эскадру снова, поэтому переключатель в строке патруля читает его, а
 *    не свою копию.
 * 7. **База держит патруль и тогда, когда метки нет** ({@link holdsPatrol}): удержание
 *    живёт у патруля на ЛЮБОЙ ноге — повернувший домой по сроку сядет с ним — и у
 *    эскадры, которая ждёт дома перезарядки. Спроси «держит ли база» по меткам, и
 *    ответ гас бы на каждой обратной ноге, хотя патруль встанет снова.
 */

/** Один свой патруль: где он, какой у него круг и сколько ему ещё висеть. */
export interface PatrolMark {
  /** id вылета — адрес `shuttle.recall`. */
  id: string;
  /** id эскадры: позывной строится из него, как у карточки в ангаре. */
  squadronId: string;
  /** Откуда поднялся патруль — туда он и вернётся. */
  base: StrikeBase;
  /** Точка патруля (мировые координаты). */
  at: { x: number; y: number };
  /** Круг, в котором патруль бьёт. */
  radius: number;
  /** Висит над точкой (`true`) или ещё летит к ней (правило 2). */
  active: boolean;
  /** Сколько ещё висеть, мс; у летящего к точке — `null` (правило 2). */
  leftMs: number | null;
  /** «Держать патруль» (правило 6): вернувшись, эскадра встанет снова сама. */
  hold: boolean;
}

/** Метки своих патрулей (правила 1–3, 5). */
export function patrolMarks(
  strikes: readonly ShuttleStrike[] | undefined,
  opts: { me: string; now: number },
): PatrolMark[] {
  const out: PatrolMark[] = [];
  for (const st of strikes ?? []) {
    if (st.owner !== opts.me) continue; // правило 1
    if (st.target.kind !== 'point' || st.leg === 'back') continue; // правило 2
    const radius = st.patrol?.radius ?? 0;
    if (!(radius > 0)) continue; // правило 5
    const active = st.leg === 'patrol';
    out.push({
      id: st.id,
      squadronId: st.squadronId,
      base: st.base,
      at: { x: st.to.x, y: st.to.y },
      radius,
      active,
      leftMs: active ? Math.max(0, st.arrivesAt - opts.now) : null, // правило 3
      hold: st.patrol?.hold === true, // правило 6
    });
  }
  return out;
}

/** Патрули, поднятые с этой базы: их показывает панель базы вместе с «Вернуть»
 *  (правило 4). База — мир или корабль: id мира и id флота живут в разных картах, поэтому
 *  сравнивается и вид, и id. */
export function basePatrols(marks: readonly PatrolMark[], base: StrikeBase): PatrolMark[] {
  return marks.filter((m) => m.base.kind === base.kind && m.base.id === base.id);
}

/** Держит ли база патруль (правило 7): свой удерживаемый патруль с неё в воздухе на любой
 *  ноге или эскадра с удержанием в её ангаре. */
export function holdsPatrol(
  strikes: readonly ShuttleStrike[] | undefined,
  hangar: readonly Squadron[] | undefined,
  base: StrikeBase,
  me: string,
): boolean {
  if ((hangar ?? []).some((sq) => sq.hold !== undefined)) return true;
  return (strikes ?? []).some(
    (st) =>
      st.owner === me &&
      st.base.kind === base.kind &&
      st.base.id === base.id &&
      st.patrol?.hold === true,
  );
}
