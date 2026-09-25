/**
 * Урон юнита по целям — разметка (модель — `decisions/unitDamage.ts`). Одна полоса из
 * пяти ячеек, общая для справочника юнита, карточки корабля и подготовки Sector Zero:
 * игрок везде читает один и тот же ряд «корабли · здания · авиация · техника · пехота».
 * Цели, по которым юнит не бьёт вовсе, приглушены — «не достаёт» видно сразу.
 */
import { t } from '../../localization/runtime';
import { DAMAGE_TARGET_KEY, type UnitDamageRow } from '../../decisions/unitDamage';
import { esc } from './format';

export function unitDamageHtml(rows: readonly UnitDamageRow[]): string {
  const cells = rows
    .map((r) => {
      const v = Math.round(r.value * 10) / 10;
      return `<div class="udmg-c${v > 0 ? '' : ' off'}"><b>${v > 0 ? v : '—'}</b><span>${esc(t(DAMAGE_TARGET_KEY[r.target]))}</span></div>`;
    })
    .join('');
  return `<div class="udmg"><div class="udmg-h">${esc(t('codex.dmg.title'))}</div><div class="udmg-g">${cells}</div></div>`;
}
