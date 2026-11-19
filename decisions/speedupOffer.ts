/**
 * Что предложить игроку у идущей очереди (TEC-3.2, `docs/time-economy-roadmap.md`): бесплатно
 * закончить, купить ускорение за ◆ или ничего.
 *
 * 1. **Последние минуты — даром.** Остаток не больше `freeFinishMinutes` — кнопка «Закончить»,
 *    ни ◆, ни бюджета (правило ядра `finishesFree`). Она есть в любой партии.
 * 2. **Платная кнопка — шагом в час, не больше бюджета.** Покупается `min(1 ч, остаток бюджета,
 *    остаток очереди − бесплатные минуты)`. Хвост в бесплатные минуты не продаётся: его
 *    закончит кнопка из правила 1, и игрок не платит за то, что получил бы даром. Шаг
 *    округлён вниз до минуты, чтобы подпись не менялась каждый кадр и сервер не отказал
 *    «больше остатка» из-за секунд, прошедших до нажатия.
 * 3. **Платить можно только там, где есть кошелёк.** Сетевая партия с аккаунтом, золото не
 *    выключено (`goldActions`), матрица времени есть — иначе платной кнопки нет совсем, а не
 *    серой: игроку незачем видеть цену того, что здесь не продаётся.
 * 4. **Остаток бюджета — словом рядом с ценой** («можно ещё 3 ч 20 мин»), округлён вниз до
 *    10 минут: число растёт с ходом партии, а подпись не должна дёргаться.
 */
import {
  finishesFree,
  speedupLeftHours,
  speedupPrice,
  type Context,
  type GameState,
  resourceForHours,
} from '../packages/shared-core/src/index';

export type SpeedupOffer =
  | { kind: 'finish' }
  | { kind: 'buy'; hours: number; price: number; leftHours: number }
  | { kind: 'none' };

const MINUTE = 1 / 60;
const floorMinutes = (hours: number, step: number): number =>
  Math.floor(hours / (step * MINUTE) + 1e-9) * step * MINUTE;

/**
 * Предложение для очереди с остатком `remainingHours` игровых часов. `paid` — правило 3 со
 * стороны клиента (сетевая партия и аккаунт); золото и матрицу проверяет само решение.
 */
export function speedupOffer(
  state: GameState,
  me: string,
  remainingHours: number,
  ctx: Context,
  paid: boolean,
): SpeedupOffer {
  const def = ctx.data.timeValue;
  if (!(remainingHours > 0)) return { kind: 'none' };
  if (finishesFree(remainingHours, def)) return { kind: 'finish' };
  if (!paid || state.match.goldActions === false || !(def.sovereignsPerHour > 0)) return { kind: 'none' };
  const left = speedupLeftHours(state, me, def, ctx);
  const tail = remainingHours - def.freeFinishMinutes * MINUTE;
  const hours = floorMinutes(Math.min(1, left, tail), 1);
  if (hours < MINUTE) return { kind: 'none' };
  return {
    kind: 'buy',
    hours,
    price: speedupPrice(state, me, hours, def, ctx),
    leftHours: floorMinutes(left, 10),
  };
}

/** Покупка ресурса за ◆ (TEC-4): тот же бюджет K и та же цена часа, что у ускорения. Шаг —
 *  час, а когда бюджета меньше часа — его остаток (вниз до минуты); ресурс — сколько стоят эти
 *  часы по матрице, вниз до целого. Нечего купить (нет кошелька, золота, матрицы, ресурса в
 *  ней или бюджета) — `null`. */
export function resourceOffer(
  state: GameState,
  me: string,
  resource: string,
  ctx: Context,
  paid: boolean,
): { hours: number; amount: number; price: number; leftHours: number } | null {
  const def = ctx.data.timeValue;
  if (!paid || state.match.goldActions === false || !Object.hasOwn(def.referenceHour, resource)) return null;
  const left = speedupLeftHours(state, me, def, ctx);
  const hours = floorMinutes(Math.min(1, left), 1);
  const amount = Math.floor(resourceForHours(resource, hours, def));
  if (hours < MINUTE || amount < 1) return null;
  return { hours, amount, price: speedupPrice(state, me, hours, def, ctx), leftHours: floorMinutes(left, 10) };
}

/** Ответ сервера окончательный (итог записан или ничего не списано) или запрос надо повторить
 *  тем же `requestId`: 503 и обрыв — итог неизвестен; 401 — сервер запрос не смотрел, а
 *  прежняя попытка под этим номером могла уже списать ◆. */
export function speedupAnswerFinal(status: number): boolean {
  return status !== 503 && status !== 0 && status !== 401;
}
