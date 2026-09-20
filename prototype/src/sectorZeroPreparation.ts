import { t, tData } from '../../localization/runtime';
import {
  canEquip,
  effectiveStats,
  moduleAllowed,
  type GameData,
} from '../../packages/shared-core/src/index';
import {
  HERO_UNLOCK_COST,
  MODULE_UNLOCK_COST,
  sectorHeroAbilities,
  sectorHeroSlots,
  sectorHeroUpgradeCost,
  sectorHullIds,
  sectorSkillCost,
  type SectorProgressAction,
  type SectorZeroProgress,
} from '../../decisions/sectorZeroProgress';
import { esc, displayUnit } from './format';

interface PreparationHost {
  data: GameData;
  progress(): SectorZeroProgress;
  change(action: SectorProgressAction): boolean;
}
const stats: Record<string, string> = {
  attack: 'loadout.stat.attack',
  defense: 'loadout.stat.defense',
  hp: 'loadout.stat.hp',
  shield: 'loadout.stat.shield',
  speed: 'loadout.stat.speed',
  cargoCapacity: 'loadout.stat.cargo',
  radarRange: 'loadout.stat.radar',
  pointDefense: 'data.area-defense-array',
};
const effectText = (values: Record<string, number>): string =>
  Object.entries(values)
    .map(([key, value]) => `${esc(t(stats[key] ?? key))} ${value > 0 ? '+' : ''}${value}`)
    .join(' · ');

export function initSectorZeroPreparation(h: PreparationHost) {
  const panel = document.getElementById('sz-workshop')!;
  const home = document.getElementById('sz-home')!;
  let tab: 'ships' | 'heroes' = 'ships';
  let hull = sectorHullIds(h.data).includes('cruiser')
    ? 'cruiser'
    : (sectorHullIds(h.data)[0] ?? '');
  let heroId = h.progress().selectedHero;
  let message = '';
  const button = (
    action: string,
    id: string,
    label: string,
    disabled = false,
    selected = false,
  ): string =>
    `<button type="button" data-prep="${action}" data-id="${esc(id)}"${disabled ? ' disabled' : ''}${selected ? ' class="selected"' : ''}>${label}</button>`;

  function ships(p: SectorZeroProgress): string {
    const data = h.data;
    const def = data.units[hull];
    if (!def) return '';
    const selected = p.loadouts[hull] ?? [];
    const statsNow = effectiveStats(def, { modules: selected }, data);
    const hulls = sectorHullIds(data)
      .map((id) => button('hull', id, esc(displayUnit(id)), false, hull === id))
      .join('');
    const bays = Object.entries(def.slots)
      .filter(([, n]) => n > 0)
      .map(([slot, n]) => {
        const modules = selected.filter((id) => data.modules[id]?.slot === slot);
        return `<div class="sz-bay"><b>${esc(t(`yard.slot.${slot}`))} · ${modules.length}/${n}</b><span>${modules.map((id) => esc(tData(data.modules[id]!.name))).join(', ') || t('hero.slot.empty')}</span></div>`;
      })
      .join('');
    const modules = Object.entries(data.modules)
      .map(([id, module]) => {
        const owned = p.modules.includes(id);
        const fitted = selected.includes(id);
        const fits = canEquip(hull, def, selected, id, data).ok;
        const allowed = moduleAllowed(hull, def, module);
        const label = !owned
          ? t('sector-zero.prep.unlock', { n: MODULE_UNLOCK_COST })
          : fitted
            ? t('sector-zero.prep.equipped')
            : !allowed
              ? t('sector-zero.prep.incompatible')
              : !fits
                ? t('sector-zero.prep.full')
                : t('sector-zero.prep.equip');
        return `<article class="sz-card${fitted ? ' selected' : ''}"><div class="sz-card-type">${t(`yard.slot.${module.slot}`)}</div><h3>${esc(tData(module.name))}</h3><p>${effectText(module.effects.stats)}</p>${button(owned ? 'fit' : 'unlock-module', id, label, owned ? !fits && !fitted : p.research < MODULE_UNLOCK_COST, fitted)}</article>`;
      })
      .join('');
    return `<div class="sz-picker">${hulls}</div><p class="sz-sub">${t('sector-zero.prep.ship-hint')}</p><div class="sz-bays">${bays}</div><div class="sz-stats">${['attack', 'defense', 'hp', 'shield', 'speed'].map((key) => `<span>${esc(t(stats[key]!))}<b>${statsNow[key] ?? 0}</b></span>`).join('')}</div><div class="sz-cards">${modules}</div>`;
  }

  function heroes(p: SectorZeroProgress): string {
    const data = h.data;
    const roster = Object.entries(data.heroes)
      .map(([id, def]) => button('hero', id, esc(tData(def.name)), false, heroId === id))
      .join('');
    const def = data.heroes[heroId];
    if (!def) return roster;
    const hero = p.heroes[heroId];
    let body = `<h2>${esc(tData(def.name))}</h2><p class="sz-sub">${esc(t(def.description ?? ''))}</p>`;
    if (!hero)
      return `<div class="sz-picker">${roster}</div>${body}${button('unlock-hero', heroId, t('sector-zero.prep.unlock', { n: HERO_UNLOCK_COST }), p.research < HERO_UNLOCK_COST)}`;
    const selected = p.selectedHero === heroId;
    body += `<div class="sz-hero-head"><span>${t('sector-zero.prep.hero-level', { n: hero.level, slots: sectorHeroSlots(hero, data) })}</span>${button('select-hero', heroId, t(selected ? 'sector-zero.prep.hero-selected' : 'sector-zero.prep.hero-select'), selected, selected)}${button('upgrade-hero', heroId, hero.level >= 3 ? t('sector-zero.prep.hero-max') : t('sector-zero.prep.hero-upgrade', { n: sectorHeroUpgradeCost(hero) }), hero.level >= 3 || p.research < sectorHeroUpgradeCost(hero))}</div>`;
    body += `<h3>${t('sector-zero.prep.abilities')} · ${hero.equipped.length}/${sectorHeroSlots(hero, data)}</h3><div class="sz-cards">`;
    for (const id of sectorHeroAbilities(heroId, hero, data)) {
      const ability = data.heroAbilities[id]!;
      if (ability.type.startsWith('spawn_')) continue;
      const equipped = hero.equipped.includes(id);
      body += `<article class="sz-card${equipped ? ' selected' : ''}"><h3>${esc(tData(ability.name))}</h3><p>${esc(t(ability.description ?? ''))}</p>${button('ability', id, t(equipped ? 'hero.slot.remove' : 'hero.slot.equip'), !equipped && hero.equipped.length >= sectorHeroSlots(hero, data), equipped)}</article>`;
    }
    body += `</div><h3>${t('sector-zero.prep.skills')}</h3><p class="sz-sub">${t('sector-zero.prep.skill-hint')}</p><div class="sz-cards">`;
    for (const [id, node] of Object.entries(data.heroSkillTrees)) {
      if (node.branch !== def.branch) continue;
      const owned = hero.skills.includes(id);
      const prerequisites = node.requires.every((r) => hero.skills.includes(r));
      const cost = sectorSkillCost(id, data);
      body += `<article class="sz-card${owned ? ' selected' : ''}"><h3>${esc(tData(node.name))}</h3><p>${esc(t(node.description ?? ''))}</p>${node.requires.length ? `<p class="sz-prereq">${t('hero.tree.requires')}: ${node.requires.map((r) => esc(tData(data.heroSkillTrees[r]!.name))).join(', ')}</p>` : ''}${button('skill', id, owned ? t('sector-zero.prep.owned') : t('sector-zero.prep.skill-buy', { n: cost }), owned || !prerequisites || p.research < cost, owned)}</article>`;
    }
    return `<div class="sz-picker">${roster}</div>${body}`;
  }

  function render(): void {
    const p = h.progress();
    const active = document.activeElement as HTMLElement | null;
    const focusAction = active?.dataset.prep;
    const focusId = active?.dataset.id;
    panel.innerHTML = `<div class="sz-workhead">${button('back', '', t('sector-zero.prep.back'))}<b>${t('sector-zero.prep.research', { n: p.research })}</b></div><h1>${t('sector-zero.prep')}</h1><p class="sz-sub">${t('sector-zero.prep.hint')}</p><p class="sz-reward">${p.lastReward ? t('sector-zero.prep.reward', { n: p.lastReward }) : t('sector-zero.prep.earn')}</p><div class="sz-tabs">${button('tab', 'ships', t('sector-zero.prep.modules'), false, tab === 'ships')}${button('tab', 'heroes', t('sector-zero.prep.heroes'), false, tab === 'heroes')}</div><div id="sz-prep-status" role="status" aria-live="polite">${esc(message)}</div>${tab === 'ships' ? ships(p) : heroes(p)}`;
    // Preserve keyboard position after a purchase or fit without interpolating an id
    // from external storage into a selector.
    if (focusAction)
      for (const el of panel.querySelectorAll<HTMLButtonElement>('[data-prep]')) {
        if (el.dataset.prep === focusAction && el.dataset.id === focusId && !el.disabled) {
          el.focus({ preventScroll: true });
          break;
        }
      }
  }
  const close = (): void => {
    panel.hidden = true;
    home.hidden = false;
    document.getElementById('sz-prep')?.focus({ preventScroll: true });
  };
  panel.addEventListener('click', (event) => {
    const target = (event.target as Element).closest<HTMLButtonElement>('[data-prep]');
    if (!target || target.disabled) return;
    const kind = target.dataset.prep;
    const id = target.dataset.id ?? '';
    message = '';
    if (kind === 'back') {
      close();
      return;
    }
    if (kind === 'tab') tab = id === 'heroes' ? 'heroes' : 'ships';
    else if (kind === 'hull') hull = id;
    else if (kind === 'hero') heroId = id;
    else {
      let action: SectorProgressAction | null = null;
      if (kind === 'fit') action = { kind, hull, id };
      else if (kind === 'skill' || kind === 'ability') action = { kind, hero: heroId, id };
      else if (
        kind === 'unlock-module' ||
        kind === 'unlock-hero' ||
        kind === 'select-hero' ||
        kind === 'upgrade-hero'
      )
        action = { kind, id };
      if (action)
        message = t(h.change(action) ? 'sector-zero.prep.saved' : 'sector-zero.prep.unavailable');
    }
    render();
  });
  return {
    open: (): void => {
      heroId = h.progress().selectedHero;
      message = '';
      home.hidden = true;
      panel.hidden = false;
      render();
      panel.querySelector<HTMLButtonElement>('[data-prep="back"]')?.focus({ preventScroll: true });
    },
    close,
    isOpen: (): boolean => !panel.hidden,
  };
}
