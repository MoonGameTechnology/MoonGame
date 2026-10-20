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
  pointDefense: 'stat.point-defense',
  siegeDamage: 'loadout.stat.siege',
  // Доли за игровой час (`perHourShare.ts`): без подписи чип читался бы «+0.05 hullRepair».
  shieldRegen: 'loadout.stat.shield-regen',
  hullRepair: 'loadout.stat.hull-repair',
  retreatPull: 'loadout.stat.retreat-pull',
  salvageBonus: 'loadout.stat.salvage',
  fleetHullRepair: 'loadout.stat.fleet-repair',
  mineCharge: 'loadout.stat.mine-charge',
  mineHit: 'loadout.stat.mine-hit',
};

/** Чип эффекта модуля: доля в час — процентом («+5%/ч»), прочее — как есть. */
export const effectChip = (k: string, v: number): string =>
  `+${
    isPerHourShare(k)
      ? t('loadout.stat.share-per-hour', { n: perHourPercent(v) })
      : isPercentStat(k)
        ? t('loadout.stat.percent', { n: perHourPercent(v) })
        : Math.round(v * 10) / 10
  } ${t(STAT_KEY[k] ?? k)}`;
