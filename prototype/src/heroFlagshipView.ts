import {
  heroFlagshipChoices,
  heroFlagshipUnit,
} from '../../packages/shared-core/src/state/heroFlagship';
import {
  heroModuleSlots,
  effectiveStats,
  matchHours,
  moduleAllowed,
  type GameState,
  type Hero,
  type ShipSlotType,
} from '../../packages/shared-core/src/index';
import { canInstall } from '../../packages/shared-core/src/util/fitting';
import { t } from '../../localization/runtime';
import { data } from './gameData';
import { displayUnit, esc, fmtDur } from './format';
import { catalogPortraitHtml } from './shipArt';
import { productionInfoButton } from './productionRequirementsView';

export function retainedHeroModules(hero: Hero, unit: string): string[] {
  const def = data.units[unit];
  if (!def) return [];
  const slots = heroModuleSlots(hero, unit, data);
  const kept: string[] = [];
  for (const id of hero.modules ?? []) {
    if (
      canInstall(
        {
          item: (id) => data.modules[id],
          category: (m) => m.slot,
          capacity: (c) => slots[c as ShipSlotType],
          wildcard: def.slots.universal,
          allowed: (m) => moduleAllowed(unit, def, m),
        },
        kept,
        id,
      ).ok
    )
      kept.push(id);
  }
  return kept;
}

export function heroFlagshipHtml(state: GameState, hero: Hero, wanted?: string): string {
  const current = heroFlagshipUnit(hero, data);
  const choices = heroFlagshipChoices(state, hero, data);
  const selected = wanted && choices.includes(wanted) ? wanted : current;
  const stats = (id: string) =>
    effectiveStats(
      data.units[id]!,
      {
        modules: retainedHeroModules(hero, id),
        moduleStars: hero.moduleSnapshot?.stars,
        moduleRarity: hero.moduleSnapshot?.rarity,
      },
      data,
    );
  const reference = stats(selected);
  const readOnly = !!hero.mobilization || !!hero.fleetId;
  const statKeys = {
    hp: 'production.stat.hp',
    attack: 'production.stat.attack',
    defense: 'production.stat.defense',
    speed: 'production.stat.speed',
  };
  const stat = (id: string, key: 'hp' | 'attack' | 'defense' | 'speed') => {
    const value = stats(id)[key] ?? 0;
    const delta = value - (reference[key] ?? 0);
    return `<span class="${delta > 0 ? 'pw-better' : delta < 0 ? 'pw-worse' : ''}">${value}</span>`;
  };
  const lost = (hero.modules?.length ?? 0) - retainedHeroModules(hero, selected).length;
  return `<details class="pw-section" open><summary>${t('production.flagship')}</summary><div class="pw-flagships">${choices
    .map(
      (id) =>
        `<div class="pw-hull-tile"><button class="pw-flagship ${id === selected ? 'on' : ''}" data-hflagship="${esc(id)}"${readOnly ? ' disabled' : ''}>${catalogPortraitHtml('u', id, data, 'thumb')}<b>${esc(displayUnit(id))}</b><div class="pw-compare">${(['hp', 'attack', 'defense', 'speed'] as const).map((k) => `<span>${t(statKeys[k])} ${stat(id, k)}</span>`).join('')}</div><small>${t('yard.slots.count', { n: Object.values(heroModuleSlots(hero, id, data)).reduce((a, b) => a + b, 0) + (data.units[id]!.slots.universal ?? 0) })} · ${fmtDur(matchHours(state, data.units[id]!.buildTimeHours))}</small></button>${productionInfoButton('unit', id)}</div>`,
    )
    .join(
      '',
    )}</div>${lost ? `<div class="pw-order-block">${t('production.flagship-removes', { n: lost })}</div>` : ''}<button class="btn-main" data-hflagapply="${esc(hero.id)}" data-hull="${esc(selected)}"${readOnly || current === selected ? ' disabled' : ''}>${t('production.flagship-apply')}</button></details>`;
}
