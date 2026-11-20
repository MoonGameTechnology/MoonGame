/**
 * Эффект модуля чипом — одинаково на верфи (`shipyard.ts`) и в арсенале хаба
 * (`arsenalScreen.ts`): игрок, выбравший модуль в арсенале за «+4 атака», находит его на
 * верфи под той же подписью.
 */
import { t } from '../../localization/runtime';
import { isPercentStat, isPerHourShare, perHourPercent } from '../../decisions/perHourShare';

// Short stat labels for module-effect chips («+4 атака», «+15 щит»). Нет ключа — `t()`
// отдаёт его как есть («+8 pointDefense»), поэтому сторож в `shipyard.test.ts` сверяет
// словарь со всеми статами модулей из `data/` (UIX-5.1).
export const STAT_KEY: Record<string, string> = {
  attack: 'div.stat.attack',
  defense: 'div.stat.defense',
  hp: 'stat.hp',
  shield: 'stat.shield',
  speed: 'stat.speed',
  cargoCapacity: 'stat.cargo',
  radarRange: 'stat.radar',
  sightRange: 'stat.sight',
  pointDefense: 'stat.point-defense',
  siegeDamage: 'stat.siege',
  shuttleDamage: 'stat.air-damage',
  cloak: 'stat.cloak',
  // Доли за игровой час (`perHourShare.ts`): без подписи чип читался бы «+0.05 hullRepair».
  shieldRegen: 'stat.shield-regen',
  hullRepair: 'stat.hull-repair',
  retreatPull: 'stat.retreat-pull',
  salvageBonus: 'stat.salvage',
  fleetHullRepair: 'stat.fleet-repair',
  mineCharge: 'stat.mine-charge',
  mineHit: 'stat.mine-hit',
};

/** Число стата без знака: доля в час — процентом («5%/ч»), прочее — до десятых. */
const statAmount = (k: string, v: number): string | number =>
  isPerHourShare(k)
    ? t('loadout.stat.share-per-hour', { n: perHourPercent(v) })
    : isPercentStat(k)
      ? t('loadout.stat.percent', { n: perHourPercent(v) })
      : Math.round(v * 10) / 10;

/** Чип эффекта модуля: доля в час — процентом («+5%/ч»), прочее — как есть. */
export const effectChip = (k: string, v: number): string =>
  `+${statAmount(k, v)} ${t(STAT_KEY[k] ?? k)}`;

/** Изменение стата со знаком («−2 атака», «+6 корпус») — плитка модуля в окне оснащения. */
export const deltaChip = (k: string, v: number): string =>
  `${v < 0 ? '−' : '+'}${statAmount(k, Math.abs(v))} ${t(STAT_KEY[k] ?? k)}`;
