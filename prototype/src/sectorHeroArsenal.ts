/** Карточка героя в арсенале: оснащение, развитие и звёзды. Правила — из профиля. */
import { t, tData } from '../../localization/runtime';
import type { GameData } from '../../packages/shared-core/src/index';
import {
  HERO_UNLOCK_COST,
  sectorHeroSlotItems,
  sectorHeroSlots,
  sectorSkillCard,
  sectorSkillCost,
  sectorSlotItem,
  sectorSkillOpenTo,
  HERO_SHIP_STAR_SLOTS,
  type SectorHero,
  type SectorZeroProgress,
} from '../../decisions/sectorZeroProgress';
import {
  HERO_MAX_STARS,
  heroStarCost,
  heroTokenGoal,
  heroTokenUse,
} from '../../decisions/heroTokens';
import { heroChapter } from '../../decisions/heroRecruits';
import { romanChapter } from '../../decisions/chapterRoute';
import type { UpgradeFx } from '../../decisions/upgradeFx';
import { esc } from './format';
import { heroPortraitHtml } from '../../packages/client/src/heroPortraits';

export type HeroArsenalTab = 'battle' | 'tree' | 'stars' | 'ship';
export interface HeroArsenalView {
  heroId: string;
  tab: HeroArsenalTab;
  skill: string | null;
  fx: UpgradeFx | null;
}
const button = (
  action: string,
  id: string,
  label: string,
  disabled = false,
  selected = false,
): string =>
  `<button type="button" data-prep="${action}" data-id="${esc(id)}"${disabled ? ' disabled' : ''}${selected ? ' class="selected"' : ''} aria-pressed="${selected}">${label}</button>`;
const face = (id: string, name: string, locked = false): string =>
  `<span class="sz-face${locked ? ' sz-face-locked' : ''}">${heroPortraitHtml(id) || esc(name.charAt(0))}</span>`;

export function sectorHeroArsenalHtml(
  p: SectorZeroProgress,
  data: GameData,
  view: HeroArsenalView,
  ship: () => string,
): string {
  const h = { data };
  const { heroId, fx } = view;
  const heroTab = view.tab;
  const skillSel = view.skill;
  function heroes(p: SectorZeroProgress): string {
    const data = h.data;
    // Босс Роя (PVR-4.7) — не герой игрока: его не нанимают и не открывают.
    const roster = Object.entries(data.heroes)
      .filter(([, def]) => !def.boss)
      .map(([id, def]) => {
        const hero = p.heroes[id];
        const chapter = heroChapter(id);
        const state = !hero
          ? chapter !== null
            ? t('sector-zero.academy.by-chapter', { n: romanChapter(chapter) })
            : heroTokenUse(p, id, data) === 'join'
              ? t('sector-zero.academy.tokens', {
                  n: p.heroTokens[id] ?? 0,
                  goal: heroTokenGoal(p, id, data) ?? 0,
                })
              : t('sector-zero.academy.locked')
          : p.selectedHero === id
            ? t('sector-zero.prep.hero-selected')
            : t('sector-zero.academy.rank', { n: hero.level });
        return button(
          'hero',
          id,
          `${face(id, tData(def.name), !hero)}<span><b>${esc(tData(def.name))}</b><small>${state}</small></span>`,
          false,
          heroId === id,
        );
      })
      .join('');
    const def = data.heroes[heroId];
    if (!def) return `<div class="sz-roster">${roster}</div>`;
    const hero = p.heroes[heroId];
    const name = esc(tData(def.name));
    let body = `<div class="sz-hero">${face(heroId, tData(def.name), !hero)}<div><h2>${name}</h2><p class="sz-sub">${esc(t(def.description ?? ''))}</p>`;
    const byChapter = heroChapter(heroId);
    // Жетоны героя (`heroTokens.ts`): до прихода — счёт до 10, после — до следующей звезды.
    const tokens = p.heroTokens[heroId] ?? 0;
    const goal = heroTokenGoal(p, heroId, data);
    if (!hero)
      return `<div class="sz-roster">${roster}</div>${body}${
        byChapter !== null
          ? `<p class="sz-hero-reward">${t('sector-zero.academy.by-chapter.hint', { n: romanChapter(byChapter) })}</p>`
          : goal !== null
            ? `<p class="sz-hero-reward">${t('sector-zero.academy.tokens.join', { n: tokens, goal })}</p>`
            : ''
      }${button('unlock-hero', heroId, t('sector-zero.prep.unlock', { n: HERO_UNLOCK_COST }), p.research < HERO_UNLOCK_COST)}</div></div>`;
    const selected = p.selectedHero === heroId;
    const slots = sectorHeroSlots(hero, data);
    // Звёздность героя — делениями: все звёзды видны сразу, а не угадываются из текста.
    // Звезда стоит жетоны этого героя и открывает слот навыка (`heroTokens.ts`). Только что
    // полученная вспыхивает (`upgradeFx.ts`).
    const freshPip = fx?.kind === 'hero-star' && fx.id === heroId ? fx.star - 1 : -1;
    const pips = Array.from(
      { length: HERO_MAX_STARS },
      (_, i) => `<i class="${i < hero.level ? 'lit' : ''}${i === freshPip ? ' sz-new' : ''}">★</i>`,
    ).join('');
    body += `<div class="sz-hero-head"><span><span class="sz-pips sz-stars" aria-hidden="true">${pips}</span>${t('sector-zero.prep.hero-level', { n: hero.level, slots })}</span>${button('select-hero', heroId, t(selected ? 'sector-zero.prep.hero-selected' : 'sector-zero.prep.hero-select'), selected, selected)}</div></div></div>`;
    const heroTabButton = (id: HeroArsenalTab, key: string): string =>
      button('hero-tab', id, t(key), false, heroTab === id);
    body += `<div class="sz-subtabs">${heroTabButton('ship', 'hero.hq.tab.ship')}${heroTabButton('battle', 'sector-zero.academy.tab.battle')}${heroTabButton('tree', 'sector-zero.academy.tab.tree')}${heroTabButton('stars', 'sector-zero.academy.tab.stars')}</div>`;
    const page =
      heroTab === 'ship'
        ? ship()
        : heroTab === 'tree'
          ? skillTree(p, hero)
          : heroTab === 'stars'
            ? starsPage(hero, tokens, goal)
            : battlePage(hero, slots);
    return `<div class="sz-roster">${roster}</div>${body}${page}`;
  }

  /** «В бой»: что герой возьмёт в экспедицию — навыки и пассивки в слотах. */
  function battlePage(hero: SectorHero, slots: number): string {
    const data = h.data;
    let out = `<h3>${t('sector-zero.prep.abilities')} · ${hero.equipped.length}/${slots}</h3><div class="sz-cards ha-equipped">`;
    // В слоты идут способности и надеваемые пассивки (PVR-6.16) — один список, один бюджет.
    for (const id of sectorHeroSlotItems(heroId, hero, data)) {
      if (data.heroAbilities[id]?.type.startsWith('spawn_')) continue;
      const item = sectorSlotItem(id, data)!;
      const equipped = hero.equipped.includes(id);
      out += `<article class="sz-card ha-skill${equipped ? ' selected' : ''}"><i aria-hidden="true">✦</i><h3>${esc(tData(item.name))}</h3><p>${esc(t(item.description ?? ''))}</p>${button('ability', id, t(equipped ? 'hero.slot.remove' : 'hero.slot.equip'), !equipped && hero.equipped.length >= slots, equipped)}</article>`;
    }
    const empty = Math.max(0, slots - hero.equipped.length);
    out += Array.from(
      { length: empty },
      () => `<div class="ha-empty"><i aria-hidden="true">＋</i>${t('hero.slot.empty')}</div>`,
    ).join('');
    return `${out}</div>`;
  }

  /**
   * «Развитие»: дерево навыков линиями (`skillTreeLayout` + `academyTree.ts`) и карточка
   * выбранного узла с покупкой. Изученное, доступное и закрытое различимы без текста; что
   * именно не хватает закрытому, называет карточка.
   */
  function skillTree(p: SectorZeroProgress, hero: SectorHero): string {
    const data = h.data;
    const ids = Object.keys(data.heroSkillTrees).filter((id) =>
      sectorSkillOpenTo(data.heroSkillTrees[id]!, heroId, data),
    );
    const cards = Object.fromEntries(
      ids.map((id) => [id, sectorSkillCard(heroId, hero, id, data)]),
    );
    const sel =
      skillSel !== null && cards[skillSel]
        ? skillSel
        : (ids.find((id) => !cards[id]!.owned && !cards[id]!.missing.length) ?? ids[0]);
    const tree = `<div class="ha-skills">${ids
      .map((id) => {
        const card = cards[id]!;
        const state = card.owned ? 'owned' : card.missing.length ? 'locked' : 'open';
        const label = t(
          card.owned
            ? 'sector-zero.academy.node.owned'
            : card.missing.length
              ? 'sector-zero.academy.node.locked'
              : 'sector-zero.academy.node.open',
        );
        return `<button type="button" class="ha-skill ${state}" data-prep="skill-node" data-id="${esc(id)}" aria-pressed="${sel === id}"><i aria-hidden="true">${card.owned ? '✦' : card.missing.length ? '◇' : '＋'}</i><b>${esc(tData(data.heroSkillTrees[id]!.name))}</b><small>${esc(label)}</small></button>`;
      })
      .join('')}</div>`;
    const hint = `<p class="sz-sub">${t('sector-zero.prep.skill-hint')}</p>`;
    if (sel === undefined) return `${hint}${tree}`;
    const node = data.heroSkillTrees[sel]!;
    const { owned, missing } = cards[sel]!;
    const cost = sectorSkillCost(sel, data);
    // Предпосылки называются только когда их НЕ хватает: у открытого узла это шум.
    const prereq = missing.length
      ? `<p class="sz-prereq">${t('hero.tree.requires')}: ${missing.map((r) => esc(tData(data.heroSkillTrees[r]!.name))).join(', ')}</p>`
      : '';
    const card = `<article class="sz-card sz-tree-card${owned ? ' selected' : missing.length ? ' sz-locked' : ''}"><h3>${esc(tData(node.name))}</h3><p>${esc(t(node.description ?? ''))}</p>${prereq}${button('skill', sel, owned ? t('sector-zero.prep.owned') : t('sector-zero.prep.skill-buy', { n: cost }), owned || missing.length > 0 || p.research < cost, owned)}</article>`;
    // На широком экране карточка стоит справа от дерева, на телефоне — под ним.
    return `${hint}<div class="sz-tree-page">${tree}${card}</div>`;
  }

  /**
   * «Звёзды»: жетоны героя и лестница звёзд — что даёт каждая (слоты навыков и слот
   * корабля, `HERO_SHIP_STAR_SLOTS`). Взятые звёзды горят, следующая выделена, у неё — цена.
   */
  function starsPage(hero: SectorHero, tokens: number, goal: number | null): string {
    const data = h.data;
    const ladder = Array.from({ length: HERO_MAX_STARS }, (_, i) => {
      const star = i + 1;
      const ship = HERO_SHIP_STAR_SLOTS[star];
      const text =
        t('sector-zero.academy.star.row', {
          star,
          slots: sectorHeroSlots({ ...hero, level: star }, data),
        }) +
        (ship ? ` · ${t('sector-zero.academy.star.ship', { slot: t(`yard.slot.${ship}`) })}` : '');
      const cls =
        star <= hero.level ? ' class="lit"' : star === hero.level + 1 ? ' class="next"' : '';
      return `<li${cls}>${esc(text)}</li>`;
    }).join('');
    const cost = heroStarCost(hero.level);
    const tokenLine =
      goal !== null
        ? `<p class="sz-tokens">${t('sector-zero.academy.tokens', { n: tokens, goal })}</p>`
        : '';
    return `<ol class="sz-star-ladder">${ladder}</ol>${tokenLine}${button('upgrade-hero', heroId, cost === null ? t('sector-zero.prep.hero-max') : t('sector-zero.prep.hero-upgrade', { star: hero.level + 1, n: cost }), cost === null || tokens < cost)}`;
  }

  return heroes(p);
}
