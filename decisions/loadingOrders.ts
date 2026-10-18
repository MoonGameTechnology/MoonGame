/**
 * Приказ флоту, который грузит или выгружает десант (жалоба владельца 2026-10-17).
 *
 * Вылет снимает идущую погрузку (`army.ts`: улёт — кнопка «отменить»), и раньше это
 * случалось молча по любому приказу: игрок жал «лететь», а час погрузки пропадал. Теперь
 * такой приказ сперва спрашивает, что делать: поставить его в план флота ПОСЛЕ погрузки
 * или сбросить погрузку и лететь сразу.
 *
 * 1. **Занят тот, у кого есть ЗАЯВКА** — погрузка или выгрузка (`fleet.loading` /
 *    `fleet.unloading`). Обе снимаются вылетом одинаково, поэтому и спрашивают одинаково.
 * 2. **Свободные флоты выбора не ждут ответа.** Окно касается только занятых: остальные
 *    уходят по приказу сразу, как и без окна.
 * 3. **«После погрузки» — шаг плана флота, а не память вкладки.** План (`order.chain`)
 *    гонит хост, и его драйвер ждёт, пока флот свободен, а флот с заявкой не свободен
 *    (`fleetIdle`). Так отложенный приказ переживает закрытую вкладку и офлайн.
 * 4. **Уже составленный план не теряется:** новый приказ встаёт ПЕРЕД ним, как и прямой
 *    приказ флоту, после которого план возобновляется. Длина режется по пределу ядра.
 * 5. **Точку на лейне в план не поставить** — шаг плана умеет только мир. Для такого
 *    приказа остаётся выбор «сбросить и лететь».
 * 6. **Сколько ждать — по самой поздней заявке**, округлённо вверх до минуты: окно
 *    не должно обещать «0 мин», пока погрузка ещё идёт.
 */
import type { ChainStep } from '../packages/shared-core/src/index';

/** Флот в том виде, в каком его различает окно: только заявки. */
export interface LoadingFleetLike {
  id: string;
  loading?: readonly { doneAt: number }[];
  unloading?: readonly { doneAt: number }[];
}

/** Ждёт ли флот конца погрузки или выгрузки (правило 1). */
export function isLoadingBusy(f: LoadingFleetLike): boolean {
  return (f.loading?.length ?? 0) > 0 || (f.unloading?.length ?? 0) > 0;
}

/** Разбор выбора: кого спросить, кто летит сразу и сколько минут ждать (правила 2, 6). */
export function splitByLoading(
  fleets: readonly LoadingFleetLike[],
  now: number,
): { busy: string[]; free: string[]; minutesLeft: number } {
  const busy: string[] = [];
  const free: string[] = [];
  let doneAt = now;
  for (const f of fleets) {
    if (!isLoadingBusy(f)) {
      free.push(f.id);
      continue;
    }
    busy.push(f.id);
    for (const c of [...(f.loading ?? []), ...(f.unloading ?? [])]) doneAt = Math.max(doneAt, c.doneAt);
  }
  return { busy, free, minutesLeft: busy.length ? Math.max(1, Math.ceil((doneAt - now) / 60_000)) : 0 };
}

/** Приказ, который окно умеет отложить: курс в мир или штурм мира. */
export type DeferredOrder = { kind: 'move'; to: string } | { kind: 'assault'; to: string };

/** План флота с отложенным приказом во главе (правила 3–4). `max` — предел шагов ядра. */
export function afterLoadSteps(
  order: DeferredOrder,
  existing: readonly ChainStep[],
  max: number,
): ChainStep[] {
  const head: ChainStep[] =
    order.kind === 'assault'
      ? [{ kind: 'move', to: order.to }, { kind: 'assault' }]
      : [{ kind: 'move', to: order.to }];
  return [...head, ...existing].slice(0, max);
}
