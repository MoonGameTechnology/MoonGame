/**
 * Когда сказать игроку — и когда ПРОМОЛЧАТЬ (REFM-29).
 *
 * Два оповещения прототипа устроены одинаково: тревога «враг у ваших рубежей»
 * (THREAT-HUD) и засечка радарной развёртки. Оба обязаны сработать РОВНО ОДИН РАЗ за
 * эпизод, иначе интерфейс превращается в трель: висящий у границы флот и медленно
 * вращающаяся рука радара иначе кричали бы каждый кадр.
 *
 * Три правила, которые стоит проверять тестом, а не глазами:
 *
 *  · **дроссель считает игровые ЧАСЫ, а не кадры.** Соло двигает `s.time` каждый кадр,
 *    поэтому сравнение «прошло ли время» было бы бессмысленным, а обход угроз пошёл бы
 *    по кадрам. Угрозы летят часами — часовой шаг ничего не теряет.
 *  · **эпизод забывается, когда закончился.** Пока флот у границы, повторно не звеним;
 *    ушёл и вернулся — это НОВЫЙ подход, и он снова достоин тревоги.
 *  · **рука развёртки переходит через ноль.** Пересечение угла считается по дуге,
 *    пройденной за кадр, — наивное сравнение «prev < target < cur» теряет каждую
 *    засечку на стыке круга.
 */

/** Полный оборот в радианах. */
const TAU = Math.PI * 2;

/** Часовой шаг дросселя: в какой «корзине» игрового времени мы находимся. */
export function hourBucket(time: number, hourMs: number): number {
  return Math.floor(time / hourMs);
}

/** Ключ эпизода: одна тревога на пару «узел + флот», а не на каждый её кадр. */
export function episodeKey(node: string, fleetId: string): string {
  return `${node}|${fleetId}`;
}

/**
 * Что из увиденного СЕЙЧАС ещё не объявлено. Память при этом пополняется: следующий
 * кадр по тем же ключам промолчит.
 */
export function freshEpisodes(memory: Set<string>, live: readonly string[]): string[] {
  const fresh: string[] = [];
  for (const key of live) {
    if (memory.has(key)) continue;
    memory.add(key);
    fresh.push(key);
  }
  return fresh;
}

/** Забыть эпизоды, которых больше нет: новый подход к тому же узлу снова прозвенит. */
export function forgetEnded(memory: Set<string>, live: ReadonlySet<string>): void {
  for (const key of memory) if (!live.has(key)) memory.delete(key);
}

/**
 * Прошла ли рука развёртки через угол `target` между прошлым кадром и этим.
 *
 * Считается по ДУГЕ, пройденной за кадр, поэтому переход через ноль обрабатывается сам
 * собой. `prev < 0` означает «прошлого кадра не было» — на первом кадре не засекаем
 * ничего, иначе развёртка «нашла» бы разом всю карту.
 */
export function sweptArc(prev: number, cur: number, target: number): boolean {
  if (prev < 0) return false;
  const arc = (cur - prev + TAU) % TAU; // сколько рука прошла за кадр
  if (arc <= 0) return false;
  const to = ((((target % TAU) + TAU) % TAU) - prev + TAU) % TAU;
  return to > 0 && to <= arc;
}

/** Рука развёртки: точка опоры на экране и её досягаемость. */
export interface SweepArm {
  x: number;
  y: number;
  r: number;
}

/**
 * Красит ли развёртка эту точку в текущем кадре: рука должна и ДОСТАВАТЬ до неё
 * (радарный диск), и пройти через её угол. Одного покрытия мало — иначе контакт
 * «засекался» бы непрерывно, а не раз в оборот.
 */
export function paintedThisFrame(
  arms: readonly SweepArm[],
  pos: { x: number; y: number },
  prev: number,
  cur: number,
): boolean {
  return arms.some((a) => {
    const dx = pos.x - a.x;
    const dy = pos.y - a.y;
    if (dx * dx + dy * dy > a.r * a.r) return false;
    return sweptArc(prev, cur, Math.atan2(dy, dx));
  });
}

/** Тусклый уровень, до которого оседает отметка между проходами руки. */
export const CONTACT_FLOOR = 0.32;

/** Сколько миллисекунд отметка ярко горит сразу после засечки. */
export const CONTACT_FLASH_MS = 1400;

/** Полтора оборота без повторной засечки — контакт ушёл. */
export const CONTACT_LIFE_TURNS = 1.25;

/** Яркость отметки по возрасту: вспышка сразу после засечки, затем тусклый призрак. */
export function contactAlpha(ageMs: number, flashMs = CONTACT_FLASH_MS): number {
  return CONTACT_FLOOR + (1 - CONTACT_FLOOR) * Math.max(0, 1 - ageMs / flashMs);
}

/** Пора ли забыть отметку: целый оборот прошёл, а рука её не подтвердила. */
export function contactLost(ageMs: number, sweepPeriodMs: number): boolean {
  return ageMs > sweepPeriodMs * CONTACT_LIFE_TURNS;
}
