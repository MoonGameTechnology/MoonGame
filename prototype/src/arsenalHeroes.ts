import { t, tData } from '../../localization/runtime';
import { heroPortraitHtml } from '../../packages/client/src/heroPortraits';
import { data } from './gameData';
import { esc } from './format';

/** Каталог не выдаёт героя аккаунту: в Galactic War состав определяется партией. */
export function arsenalHeroesHtml(selected: string | undefined): string {
  const roster = Object.entries(data.heroes).filter(([, hero]) => !hero.boss);
  const id = roster.some(([id]) => id === selected) ? selected! : roster[0]?.[0];
  const hero = id ? data.heroes[id] : undefined;
  const cards = roster
    .map(
      ([key, def]) =>
        `<button type="button" class="ar-hero" data-ar-hero="${esc(key)}" aria-pressed="${key === id}">${heroPortraitHtml(key)}<b>${esc(tData(def.name))}</b></button>`,
    )
    .join('');
  if (!hero || !id) return '';
  const skills = [...(hero.startAbilities ?? []), ...(hero.startPassives ?? [])]
    .flatMap((key) => {
      const def = data.heroAbilities[key] ?? data.heroPassives[key];
      return def
        ? [
            `<article class="ar-hero-skill"><h4>${esc(tData(def.name))}</h4><p>${esc(t(def.description ?? ''))}</p></article>`,
          ]
        : [];
    })
    .join('');
  return `<section class="ar-heroes"><div class="ar-hero-roster">${cards}</div>
    <article class="ar-hero-detail"><h3>${esc(tData(hero.name))}</h3><p>${esc(t(hero.description ?? ''))}</p>
      <h4>${t('arsenal.heroes.skills')}</h4><div class="ar-hero-skills">${skills}</div>
      <div class="ar-hero-match"><p>${t('arsenal.heroes.match')}</p><button type="button" data-ar-hero-match>${t('arsenal.heroes.open-match')}</button></div>
    </article></section>`;
}
