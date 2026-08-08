/**
 * Какие способности героя-флагмана можно применить прямо сейчас (REFM-68).
 *
 * Один и тот же вопрос задаётся из ТРЁХ мест: командная полоса решает, показывать ли
 * кнопку ✨ вообще; её поповер рисует список; режим «Приказ» строит из того же списка
 * пункты меню точки. Раньше каждое место отвечало на него своими руками — три копии
 * одного правила, расходящиеся молча.
 *
 * 1. **Герой должен быть ЖИВ и НА БОРТУ выбранного флота.** Иначе меню предложит каст
 *    того, кого в этой группе нет, и приказ уедет в отказ.
 * 2. **Отсутствие поля `alive` значит «жив».** Матчи, начатые до появления флага, не
 *    должны разом лишиться всех героев.
 * 3. **Не всякая способность применяется по цели.** Кастуемые типы приходят снаружи
 *    (`HERO_CASTABLE`) — пассивки и ауры в меню не попадают; пустой слот — не
 *    способность.
 * 4. **Кулдаун не бывает отрицательным.** Он остаток «когда откроется» минус «сейчас»;
 *    без клампа меню показало бы «через −3 ч» на давно готовой способности.
 * 5. **Дальнобойность — это `range > 0`.** По ней решается, нужен ли прицел по карте
 *    (дальняя) или каст бьёт по себе (ближняя).
 */

/** Герой глазами меню: жив ли и на каком он флоте. */
export interface HeroAboard {
  id: string;
  alive?: boolean;
  fleetId?: string;
  abilities?: readonly (string | null)[];
}

/** Способность, уже разрешённая вызывающим по игровым данным. */
export interface AbilitySpec {
  id: string;
  type: string;
  /** Дальность по данным; 0 или отсутствие — каст по себе. */
  range?: number;
  /** Момент, когда способность откроется (игровое время). */
  readyAt?: number;
}

/** Готовый пункт меню. */
export interface CastOption {
  id: string;
  /** Остаток кулдауна в часах; 0 — можно применять. */
  cdH: number;
  ranged: boolean;
}

/** Жив ли герой: поля может не быть — тогда жив (правило 2). */
export function heroAlive(hero: HeroAboard): boolean {
  return hero.alive !== false;
}

/**
 * Герой-флагман выбранной группы: живой, на борту одного из флотов (правило 1).
 * Несколько подходящих — первый по порядку, порядок задаёт вызывающий.
 */
export function heroAboard<H extends HeroAboard>(
  heroes: readonly H[],
  fleetIds: readonly string[],
): H | null {
  return (
    heroes.find((h) => heroAlive(h) && h.fleetId !== undefined && fleetIds.includes(h.fleetId)) ??
    null
  );
}

/** Попадает ли способность в меню (правило 3). */
export function isCastable(type: string | undefined, castableTypes: ReadonlySet<string>): boolean {
  return type !== undefined && castableTypes.has(type);
}

/** Остаток кулдауна в часах, никогда не отрицательный (правило 4). */
export function cooldownLeftH(readyAt: number | undefined, now: number, hourMs: number): number {
  return Math.max(0, ((readyAt ?? 0) - now) / hourMs);
}

/** Нужен ли прицел по карте (правило 5). */
export function isRanged(range: number | undefined): boolean {
  return (range ?? 0) > 0;
}

/**
 * Пункты меню каста: только кастуемые типы, каждый со своим кулдауном и признаком
 * дальнобойности. `specs` — способности героя, уже разрешённые по данным (пустой слот
 * приходит как `null`).
 */
export function castOptions(
  specs: readonly (AbilitySpec | null)[],
  castableTypes: ReadonlySet<string>,
  now: number,
  hourMs: number,
): CastOption[] {
  const out: CastOption[] = [];
  for (const spec of specs) {
    if (!spec || !isCastable(spec.type, castableTypes)) continue;
    out.push({
      id: spec.id,
      cdH: cooldownLeftH(spec.readyAt, now, hourMs),
      ranged: isRanged(spec.range),
    });
  }
  return out;
}
