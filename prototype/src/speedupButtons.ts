/**
 * Кнопка ускорения у идущей очереди (TEC-3.2): подпись из решения `decisions/speedupOffer.ts`
 * и разбор нажатия. Стройка (конвейер мира) и исследование (окошко узла) рисуют её каждый
 * своей разметкой, а предложение и приказ — отсюда, одни на оба места.
 */
import { hoursToMs, type GameState, type QueueRef } from '../../packages/shared-core/src/index';
import { finishQueue } from '../../decisions/actions';
import { speedupOffer } from '../../decisions/speedupOffer';
import { t } from '../../localization/runtime';
import { fmtEta } from './format';
import { playerOrder } from './orderPipeline';
import { ctx } from './protoKernel';
import { requestSpeedup, speedupPaid } from './speedupClient';

export interface SpeedupButton {
  act: string;
  arg: string;
  label: string;
  title: string;
}

/** Кнопка для очереди, которая закончится в `at`: `kind` — стройка (`build`) или наука
 *  (`tech`), `id` — номер заказа или технология. `undefined` — предлагать нечего. */
export function speedupButton(
  s: GameState,
  me: string,
  at: number,
  kind: 'build' | 'tech',
  id: string,
): SpeedupButton | undefined {
  const c = ctx(s.time, s);
  const offer = speedupOffer(s, me, (at - s.time) / hoursToMs(c, 1), c, speedupPaid());
  if (offer.kind === 'finish')
    return { act: `finish${kind}`, arg: id, label: `✓ ${t('speedup.finish')}`, title: t('speedup.finish.title') };
  if (offer.kind !== 'buy') return undefined;
  const time = fmtEta(offer.hours);
  return {
    act: `speed${kind}`,
    arg: `${id}:${offer.hours}`,
    label: t('speedup.buy', { time, n: offer.price }),
    title: t('speedup.buy.title', { time, n: offer.price, left: fmtEta(offer.leftHours) }),
  };
}

const refOf = (kind: string, id: string): QueueRef | null =>
  kind === 'build'
    ? Number.isInteger(Number(id)) && id !== ''
      ? { kind: 'construction', seq: Number(id) }
      : null
    : kind === 'tech' && id
      ? { kind: 'research', technology: id }
      : null;

/** Нажатие кнопки из {@link speedupButton}; `false` — это не она. */
export function speedupAct(act: string, arg: string, me: string): boolean {
  const m = /^(speed|finish)(build|tech)$/.exec(act);
  if (!m) return false;
  const cut = arg.lastIndexOf(':');
  const ref = refOf(m[2]!, m[1] === 'speed' ? arg.slice(0, cut) : arg);
  if (!ref) return true;
  if (m[1] === 'finish') playerOrder(finishQueue(me, ref));
  else {
    const hours = Number(arg.slice(cut + 1));
    if (cut > 0 && hours > 0) requestSpeedup(ref, hours);
  }
  return true;
}
