/**
 * Что карточка флота признаёт о его состоянии — полоса меток эффектов (REFM-197).
 *
 * Метки собирались россыпью `if`'ов в `fleetPanelHtml`. Ошибается такая полоса ТИХО: она
 * не падает, она уверенно сообщает о флоте то, чего с ним не происходит, — а игрок по
 * этим меткам решает, посылать ли его в бой.
 *
 * 1. **Долговые метки — только на СВОЁМ флоте.** Задолженность это состояние МОЕЙ казны;
 *    повесив её на чужой флот, панель соврала бы про противника и заодно показала бы мои
 *    долги как его беду.
 * 2. **Голод показывается, только если на борту ЕСТЬ десант.** Голодают люди, а не
 *    корпуса: без войск метка про еду говорит о том, чего на этом флоте нет.
 * 3. **Патруль называет ЛИБО перевооружение, ЛИБО топливо.** Это два состояния одного
 *    вылета, и показать оба значило бы дать два числа там, где действует одно; пока
 *    крыло перевооружается, топливо не расходуется и говорить о нём нечего.
 * 4. **Точечная оборона — сумма по кораблям, и ПУСТЫЕ стопки не считаются.** Стопка с
 *    нулевой численностью остаётся в составе (её не вычёркивают), но стволов у неё нет:
 *    сложив её, панель обещала бы защиту, которой нет. Незнакомый тип корабля тоже не
 *    считается — про его вооружение мы ничего не знаем.
 * 5. **Нулевое зональное ПВО не пишется вовсе.** «🛡 0» читается как «защита есть»;
 *    отсутствие метки читается правильно.
 * 6. **Пустая полоса не рисуется совсем.** Заголовок «Эффекты» без единой метки выглядит
 *    как поломка загрузки, а не как «с флотом всё спокойно».
 */

/** Метка эффекта: вид и числа для подписи. Текст берёт вызывающая сторона из локали. */
export type EffectTag =
  | { kind: 'in-battle' }
  | { kind: 'forced-march' }
  | { kind: 'bombarding' }
  | { kind: 'patrol' }
  | { kind: 'blackout' }
  | { kind: 'hunger' }
  | { kind: 'point-defense'; n: number };

/** Состояние флота, сведённое к тому, о чём говорят метки. */
export interface FleetFacts {
  owner: string;
  inBattle: boolean;
  forcedMarch: boolean;
  bombarding: boolean;
  /** Дежурный вылет, если он есть: сколько крыльев перевооружается и сколько топлива. */
  /** Несёт ли эта база дежурство (SHU-2.2) — флаг, а не счётчик. */
  patrol: boolean;
  /** Сколько десанта на борту — от этого зависит метка голода (правило 2). */
  troops: number;
  /** Суммарное зональное ПВО (см. {@link pointDefenseTotal}). */
  pointDefense: number;
}

/**
 * Правило 4: сумма зонального ПВО по составу. Стопка обобщённая — сюда приходят те же
 * объекты, что лежат в состоянии, и модуль не заводит про них своего типа. `pdOf`
 * возвращает `null` для типа корабля, которого нет в данных: такую стопку не считаем.
 */
export function pointDefenseTotal<T extends { count: number }>(
  stacks: readonly T[],
  pdOf: (stack: T) => number | null,
): number {
  return stacks.reduce((sum, st) => {
    if (st.count <= 0) return sum;
    const pd = pdOf(st);
    return pd === null ? sum : sum + pd * st.count;
  }, 0);
}

/** Правило 1: долговые метки признаются только на своём флоте. */
export function debtTagsShown(owner: string, me: string): boolean {
  return owner === me;
}

/** Правило 2: еда кончилась и есть кому голодать. */
export function hungerShown(arrears: readonly string[], troops: number): boolean {
  return arrears.includes('food') && troops > 0;
}

/** Правило 5: метка защиты — только при ненулевой сумме. */
export function pointDefenseShown(pd: number): boolean {
  return pd > 0;
}

/** Правило 6: полоса рисуется, только когда в ней есть хоть одна метка. */
export function effectsShown(tags: readonly EffectTag[]): boolean {
  return tags.length > 0;
}

/** Полный набор меток флота в том порядке, в каком их читает игрок. */
export function fleetEffects(f: FleetFacts, me: string, arrears: readonly string[]): EffectTag[] {
  const tags: EffectTag[] = [];
  if (f.inBattle) tags.push({ kind: 'in-battle' });
  if (f.forcedMarch) tags.push({ kind: 'forced-march' });
  if (f.bombarding) tags.push({ kind: 'bombarding' });
  // Метка ФЛАГ, а не счётчик: с SHU-2.2 запас вылетов принадлежит БАЗЕ и показан там
  // же, где ангар («вылетов N из M» / «перезарядка»). Дублировать его на карточке
  // значило бы завести второе место, где живёт одно число.
  if (f.patrol) tags.push({ kind: 'patrol' });
  if (debtTagsShown(f.owner, me)) {
    if (arrears.includes('energy')) tags.push({ kind: 'blackout' });
    if (hungerShown(arrears, f.troops)) tags.push({ kind: 'hunger' });
  }
  if (pointDefenseShown(f.pointDefense)) tags.push({ kind: 'point-defense', n: f.pointDefense });
  return tags;
}
