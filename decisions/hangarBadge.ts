/**
 * ЭСКАДРА НА СТОЯНКЕ — какой значок у базы на карте и что пишет её карточка (концепт
 * «Управление эскадрой», заказ владельца 2026-11-08).
 *
 * До этого решения эскадру на стоянке на карте не было видно: поднять её в удар можно
 * было только из «i» мира или из трюма в карточке носителя. Теперь у своей базы с
 * эскадрами стоит значок ангара, тап по нему выделяет эскадру, и у неё своя карточка.
 *
 * 1. **Значок один на базу, а не на эскадру.** На карте на сто игроков отдельные значки
 *    забили бы экран; число эскадр в значке, имена — в карточке и в списке выбора.
 * 2. **Цвет говорит, можно ли лететь прямо сейчас.** Топливо и перезарядка принадлежат
 *    БАЗЕ (SHU-1.2), поэтому «готова» у всех эскадр места общее: значок яркий, когда
 *    база готова к вылету, и серый с жёлтой точкой, когда ждёт.
 * 3. **Порядок эскадр — порядок ангара.** Он одинаков на всех клиентах, и первый тап по
 *    значку с одной эскадрой выделяет именно её, без догадок.
 * 4. **Чужих значков нет.** Состав чужого порта скрыт туманом; значок рисуется только у
 *    своей базы, и решение об этом принимает вызывающий, передавая только свои места.
 * 5. **Строка состояния — одна на все карточки эскадры:** где стоит и можно ли лететь,
 *    с числом вылетов или часами перезарядки. Причина «нельзя» называется своим словом,
 *    как в ангаре (`hangarPanel.ts`, правило 3).
 */

/** Почему база не может поднять вылет; `null` — может (то же, что `HangarBlock`). */
export type BaseBlock = 'empty' | 'busy' | 'rearming' | 'no-fuel' | null;

/** Что значок знает о месте. */
export interface HangarSpotFacts {
  /** Живые эскадры места в порядке ангара. */
  squadronIds: readonly string[];
  blocked: BaseBlock;
}

/** Значок ангара у базы. */
export interface HangarBadge {
  count: number;
  /** База готова поднять вылет (правило 2). */
  ready: boolean;
  /** Эскадры места в порядке ангара (правило 3). */
  squadronIds: readonly string[];
}

/** Значок места; `null` — эскадр нет, и значка нет (правило 1). */
export function hangarBadge(spot: HangarSpotFacts): HangarBadge | null {
  if (spot.squadronIds.length === 0) return null;
  return {
    count: spot.squadronIds.length,
    ready: spot.blocked === null,
    squadronIds: spot.squadronIds,
  };
}

/** Что пишет строка состояния эскадры на стоянке (правило 5). */
export type ParkedState =
  | { kind: 'ready'; fuel: number | null; maxFuel: number | null }
  | { kind: 'rearming'; hours: number }
  | { kind: 'no-fuel' }
  | { kind: 'busy' };

/** Состояние стоянки по ангару места. Пустого ангара здесь не бывает: в нём нет эскадры. */
export function parkedState(
  blocked: BaseBlock,
  sortie: { fuel: number; maxFuel: number; rearming: number } | undefined,
): ParkedState {
  if (blocked === 'busy') return { kind: 'busy' };
  if (blocked === 'rearming') return { kind: 'rearming', hours: sortie?.rearming ?? 0 };
  if (blocked === 'no-fuel') return { kind: 'no-fuel' };
  return { kind: 'ready', fuel: sortie?.fuel ?? null, maxFuel: sortie?.maxFuel ?? null };
}

/** Точка значка на экране и эскадры за ним — то, что нарисовано в этом кадре. */
export interface BadgeHit {
  x: number;
  y: number;
  /** Половина ширины и высоты цели для пальца или мыши. */
  halfW: number;
  halfH: number;
  squadronIds: readonly string[];
}

/**
 * Значок под тапом: ближайший из тех, чей прямоугольник накрывает точку. Значок — отдельная
 * цель для пальца, не меньше 44 px на телефоне, поэтому ширину цели задаёт вызывающий.
 */
export function badgeAt(hits: readonly BadgeHit[], x: number, y: number): BadgeHit | null {
  let best: BadgeHit | null = null;
  let bestD = Infinity;
  for (const h of hits) {
    if (Math.abs(x - h.x) > h.halfW || Math.abs(y - h.y) > h.halfH) continue;
    const d = Math.hypot(x - h.x, y - h.y);
    if (d < bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

/**
 * Что выбирает тап по значку. Одна эскадра — сразу её. Несколько: на ПК повторный тап по
 * тому же значку берёт следующую по кругу (как стопка флотов, `tapCycle.ts`, правило 2),
 * а на телефоне открывается короткий список (`list`).
 */
export function badgeTap(
  squadronIds: readonly string[],
  current: string | null,
  phone: boolean,
): { pick: string } | { list: readonly string[] } | null {
  if (squadronIds.length === 0) return null;
  if (squadronIds.length === 1) return { pick: squadronIds[0]! };
  if (phone) return { list: squadronIds };
  const at = current === null ? -1 : squadronIds.indexOf(current);
  return { pick: squadronIds[(at + 1) % squadronIds.length]! };
}
