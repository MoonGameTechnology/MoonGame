/**
 * Урон юнита по целям — разметка (модель — `decisions/unitDamage.ts`). Одна полоса из
 * пяти ячеек, общая для справочника юнита, карточки корабля и подготовки Sector Zero:
 * игрок везде читает один и тот же ряд «корабли · здания · авиация · техника · пехота».
 * Цели, по которым юнит не бьёт вовсе, приглушены — «не достаёт» видно сразу. У наземного
 * юнита ячейки техники и пехоты несут два числа — атаку и оборону по роду (решение владельца
 * 2026-09-25), и под заголовком тогда стоит подпись «атака / оборона».
 */
import { t } from '../../localization/runtime';
import { DAMAGE_TARGET_KEY, type UnitDamageRow } from '../../decisions/unitDamage';
import { esc } from './format';

export function unitDamageHtml(rows: readonly UnitDamageRow[]): string {
  const round = (x: number): number => Math.round(x * 10) / 10;
  const cells = rows
    .map((r) => {
      const v = round(r.value);
      const d = r.defense === undefined ? undefined : round(r.defense);
      const live = v > 0 || (d ?? 0) > 0;
      const num = d === undefined ? (v > 0 ? `${v}` : '—') : `${v}<i>/${d}</i>`;
      return `<div class="udmg-c${live ? '' : ' off'}"><b>${num}</b><span>${esc(t(DAMAGE_TARGET_KEY[r.target]))}</span></div>`;
    })
    .join('');
  const pair = rows.some((r) => r.defense !== undefined)
    ? ` <em>${esc(t('codex.dmg.atk-def'))}</em>`
    : '';
  return `<div class="udmg"><div class="udmg-h">${esc(t('codex.dmg.title'))}${pair}</div><div class="udmg-g">${cells}</div></div>`;
}
