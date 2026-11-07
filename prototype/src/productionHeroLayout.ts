import { t } from '../../localization/runtime';
import { INFO_ICON } from './infoIcon';
import { esc } from './format';
import { catalogPortraitHtml } from './shipArt';
import { data } from './gameData';
import type { Hero } from '../../packages/shared-core/src/index';
import { heroFlagshipStats } from './heroFlagshipView';
import { displayUnit } from './format';
import { holoIcon } from './holographicIcons';

export function skillInformation(name: string, description: string): string {
  return information(name, esc(description));
}

/** Canonical moduleEffect markup is already escaped by its renderer. */
export function moduleInformation(name: string, effects: string): string { return information(name, effects); }

function information(name: string, content: string): string {
  return `<details class="pw-skill-description"><summary aria-label="${t('production.info')}">${INFO_ICON}<span>${esc(name)}</span></summary><div class="hx-note">${content}</div></details>`;
}

/** Summary first; progression and hardware expand in place as in production-v1. */
export function productionHeroLayout(
  chips: string, identity: string, abilities: string,
  tab: string, selectedBody: string, overview: string, dossier: string, deploy: string,
): string {
  const fold = (key: string, label: string) =>
    `<section class="pw-hero-fold"><button class="hx-tab${tab === key ? ' on' : ''}" data-htab="${key}" aria-expanded="${tab === key}">${t(label)}<span aria-hidden="true">${tab === key ? '⌄' : '›'}</span></button>${tab === key ? `<div class="hx-view">${selectedBody}</div>` : ''}</section>`;
  return chips + `<article class="pw-hero-summary">${identity}${abilities}<footer class="pw-hero-footer"><span>${t('production.mobilization')} · <span class="pw-hero-world"></span></span><span class="hx-dstat">${deploy}</span></footer><details class="pw-hero-dossier"><summary aria-label="${t('production.info')}">${INFO_ICON}<span>${t('hero.person.dossier')}</span></summary>${overview}</details></article>` +
    fold('tree', 'production.hero-development') + fold('ship', 'production.hero-ship') + dossier;
}

/** Hardware keeps the same tile/picker idiom as ordinary ship fittings. */
export function productionHeroEquipment(hero: Hero, hull: string, slots: string, pool: string, caption: string): string {
  const values = heroFlagshipStats(hero, hull);
  const labels = { hp: 'production.stat.hp', attack: 'production.stat.attack', defense: 'production.stat.defense-short', speed: 'production.stat.speed-short' };
  const stats = `<div class="pw-compare pw-hardware-stats">${(['hp','attack','defense','speed'] as const).map(key => `<span data-pw-hardware-stat="${key}" data-hero="${esc(hero.id)}" data-value="${values[key] ?? 0}"><small>${t(labels[key])}</small><b>${values[key] ?? 0}</b></span>`).join('')}</div>`;
  return `<details class="pw-hero-equipment" data-hero="${esc(hero.id)}"><summary>${t('production.hero-equip')}</summary><div class="pw-hardware-current">${catalogPortraitHtml('u', hull, data)}<span><b>${esc(displayUnit(hull))}</b><small>${caption}</small></span></div><button class="btn-second pw-hardware-hull" data-pw-hardware-hull>${t('production.flagship-picker')}</button>${stats}<div class="pw-hardware-stage">${catalogPortraitHtml('u', hull, data)}<div class="hx-bays pw-hardware-bays">${slots}</div></div><section class="pw-hardware-pool" data-hero="${esc(hero.id)}" hidden><header class="pw-module-heading">${t('production.module-pool')}</header><div class="pw-hardware-options">${pool || t('hero.abil.empty')}</div></section><p class="pw-hardware-note">${t(hero.fleetId || hero.mobilization ? 'hero.ship.refit-docked' : 'production.hero-equipment-note')}</p></details>`;
}

export function productionHardwareEmpty(slot: string, label: string, disabled: boolean): string {
  return `<button class="hx-bay off pw-hardware-slot" data-pw-hardware-slot="${slot}" aria-label="${esc(t('hero.ship.empty', { k: label }))}"${disabled ? ' disabled' : ''}><small>${esc(label)}</small>${holoIcon('plus-circle')}<strong>${t('yard.slot.empty')}</strong></button>`;
}
