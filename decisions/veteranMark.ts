/**
 * ШЕВРОНЫ ВЕТЕРАНА — как отличить ветерана от новичка (заказ владельца 2026-09-25:
 * «ветеранство отображается в карточке? как отличить ветерана от обычного?»).
 *
 * До этого выслугу было видно только в окне боя (надбавка стороны) и в строке состава,
 * которую карточка флота давно сменила плитками: крейсер с тремя боями выглядел ровно как
 * вчерашняя новостройка. Теперь у стека — 1–4 шеврона по степени «Выслуги», а у флота на
 * карте — один шеврон, если в нём есть ветераны.
 *
 * Степень берётся из `medalsOf` — того же правила, по которому считается медаль и её
 * выплата: показать один шеврон, а заплатить за два было бы расхождением, которое никто не
 * заметит. Сколько даёт выслуга в бою — правило ядра (`data.veteran`), и только там, где
 * хост дал ветерану силу (Sector Zero, VET-6): в сетевой партии подсказка о бонусе молчит.
 */
import { medalsOf, type GameData, type UnitStack } from '../packages/shared-core/src/index';
import { t } from '../localization/core';

export interface VeteranMark {
  /** Степень «Выслуги» 1..N — столько шевронов рисовать. */
  grade: number;
  /** Полных пережитых боёв на корабль — для подписи. */
  battles: number;
  /** Подпись: сколько боёв и, где выслуга даёт силу, сколько она даёт. */
  title: string;
}

/** Шевроны стека или `null` — стек не ветеран (нет ни одной степени «Выслуги»). `power` —
 *  даёт ли выслуга силу в этом матче (конфиг хоста `veteranPower`). */
export function veteranMark(
  stack: UnitStack,
  data: Pick<GameData, 'medals' | 'veteran'>,
  power: boolean,
): VeteranMark | null {
  const award = medalsOf(stack, data as GameData).find((a) => a.line === 'service');
  if (!award) return null;
  const battles = Math.floor(stack.battles ?? 0);
  const damage = Math.round(data.veteran.damagePerBattle * (stack.battles ?? 0) * 100);
  const hull = Math.round(data.veteran.hullPerBattle * (stack.battles ?? 0) * 100);
  const bonus = power && (damage > 0 || hull > 0) ? ` · ${t('veteran.mark.power', { d: damage, h: hull })}` : '';
  return { grade: award.grade, battles, title: `${t('veteran.mark', { n: battles })}${bonus}` };
}

/** Высшая степень «Выслуги» среди стеков флота — `0`, если ветеранов нет. Для шеврона у
 *  значка флота на карте: он говорит «здесь есть опытные», подробности — в карточке. */
export function fleetVeteranGrade(
  stacks: readonly UnitStack[],
  data: Pick<GameData, 'medals' | 'veteran'>,
): number {
  let best = 0;
  for (const stack of stacks) {
    if (stack.count <= 0) continue;
    const award = medalsOf(stack, data as GameData).find((a) => a.line === 'service');
    if (award && award.grade > best) best = award.grade;
  }
  return best;
}
