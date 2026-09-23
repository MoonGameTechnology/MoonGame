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
  forgeLadderOf,
  sectorHullIds,
  sectorModuleIds,
  sectorSkillCost,
  WARRANTS_PER_REWARD,
  type SectorProgressAction,
  type SectorZeroProgress,
} from '../../decisions/sectorZeroProgress';
import { workshopRows } from '../../decisions/sectorZeroWorkshop';
import { moduleRarity, starRow } from '../../decisions/itemRarity';
import { statDeltas, type StatDelta } from '../../decisions/itemCompare';
import {
  adSovereigns,
  shopRefresh,
  shopRows,
  type PayKind,
  type ShopCapabilities,
} from '../../decisions/sectorZeroShop';
import { featuredOffer } from '../../decisions/shopFeatured';
import { esc, displayUnit } from './format';
import { catalogPortraitHtml } from './shipArt';
import { splitSupport } from '../../decisions/supportShips';

interface PreparationHost {
  data: GameData;
  /** Что умеет ПЛОЩАДКА (`platform-adapters.md`): решения UI принимаются по capability,
   *  а не по имени площадки. Сегодня оба флага выключены — ни IAP, ни `PlatformAds` в
   *  продукте нет, и рисовать живые кнопки под несуществующую машинерию нельзя. */
  platform: ShopCapabilities;
  /** Показать rewarded-рекламу и дождаться ПОДТВЕРЖДЁННОГО результата. `true` = игрок
   *  досмотрел. Награду выдаёт игра и только после этого (`platform-adapters.md`), поэтому
   *  покупка за рекламу идёт двумя шагами, а не одним. */
  watchAd(placement: string): Promise<boolean>;
  /** Свериться с календарём перед показом экрана: витрина магазина ротируется посуточно
   *  (`SZE-3.2`). Часы живут у хозяина — `decisions/` обязаны оставаться чистыми. */
  sync(): void;
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
  shieldRegen: 'loadout.stat.shield-regen',
  siegeDamage: 'loadout.stat.siege',
};
/** Статы-ДОЛИ за игровой час (`shieldRegen` — доля щита, `construction.ts`). Округление до
 *  десятых превращало +0.02 в «+0»: такие показываются процентом в час (PVR-6.4). */
const PER_HOUR_SHARE = new Set(['shieldRegen']);
/** Вклад звёздного модуля — дробный (6 × 1.1 в плавающей точке даёт 6.6000000000000005),
 *  поэтому показываем округлённым до десятых. Округление ТОЛЬКО для показа: считает
 *  матч по неокруглённому, иначе HUD и бой разошлись бы. */
const num = (value: number): string => String(Math.round(value * 10) / 10);
/** Значение стата для показа; `signed` — со знаком «+», как у прибавки. */
const statValue = (key: string, value: number, signed = false): string => {
  const sign = signed && value > 0 ? '+' : '';
  return PER_HOUR_SHARE.has(key)
    ? t('loadout.stat.share-per-hour', { n: `${sign}${num(value * 100)}` })
    : `${sign}${num(value)}`;
};
const effectText = (values: Record<string, number>): string =>
  Object.entries(values)
    .map(([key, value]) => `${esc(t(stats[key] ?? key))} ${statValue(key, value, true)}`)
    .join(' · ');
/** Порядок строк сравнения — тот же, что у полосы статов корабля. */
const STAT_ORDER = ['attack', 'defense', 'hp', 'shield', 'speed', 'shieldRegen', 'cargoCapacity', 'radarRange', 'pointDefense', 'siegeDamage'];
/**
 * «Было → станет» списком (PVR-6.5): одна разметка на подготовку и Мастерскую. Прибавка
 * зелёная, потеря красная — цвет несёт смысл, а число рядом дублирует его для тех, кто
 * цвет не различает.
 */
const deltaHtml = (rows: readonly StatDelta[]): string =>
  rows.length === 0
    ? ''
    : `<ul class="sz-delta">${rows
        .map(
          (r) =>
            `<li><span>${esc(t(stats[r.key] ?? r.key))}</span><b>${statValue(r.key, r.before)} → ${statValue(r.key, r.after)}</b><em class="${r.diff > 0 ? 'up' : 'down'}">${statValue(r.key, r.diff, true)}</em></li>`,
        )
        .join('')}</ul>`;

/** Шанс кузни полосой: доля читается глазом раньше, чем цифра (PVR-6.6). Цена стоит
 *  рядом всегда — `EC-2.3`: стоимость видна до того, как хватит Варрантов. */
const oddsHtml = (chance: number, warrants: number): string => {
  const pct = Math.round(chance * 100);
  return `<div class="sz-odds"><p class="sz-forge-odds">${t('sector-zero.forge.chance', { n: pct })} · ${t('sector-zero.forge.cost', { n: warrants })}</p><span class="sz-bar" style="--p:${pct}%"></span></div>`;
};

export function initSectorZeroPreparation(h: PreparationHost) {
  const panel = document.getElementById('sz-workshop')!;
  const home = document.getElementById('sz-home')!;
  let tab: 'ships' | 'heroes' | 'workshop' | 'shop' = 'ships';
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
    // Корпус выбирают по картинке, а не по слову (PVR-6.6): тот же арт, что в
    // конструкторе основной игры. Нет арта у корпуса — остаётся имя, без пустой рамки.
    const hullTile = (id: string): string =>
      button('hull', id, `${catalogPortraitHtml('u', id, data, 'thumb')}<span>${esc(displayUnit(id))}</span>`, false, hull === id);
    // Корабли линии и корабли поддержки — двумя рядами (ROS-SUP-1), признак из данных.
    const groups = splitSupport(sectorHullIds(data), data);
    const hulls = (
      [
        ['yard.tab.ships', groups.line],
        ['yard.tab.support', groups.support],
      ] as const
    )
      .filter(([, ids]) => ids.length > 0)
      .map(([key, ids]) => `<p class="sz-tier">${t(key)}</p><div class="sz-picker sz-hulls">${ids.map(hullTile).join('')}</div>`)
      .join('');
    const bays = Object.entries(def.slots)
      .filter(([, n]) => n > 0)
      .map(([slot, n]) => {
        const modules = selected.filter((id) => data.modules[id]?.slot === slot);
        return `<div class="sz-bay"><b>${esc(t(`yard.slot.${slot}`))} · ${modules.length}/${n}</b><span>${modules.map((id) => esc(tData(data.modules[id]!.name))).join(', ') || t('hero.slot.empty')}</span></div>`;
      })
      .join('');
    const modules = sectorModuleIds(data)
      .map((id) => [id, data.modules[id]!] as const)
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
        const head = itemHead(id, p);
        // Что станет с ЭТИМ корпусом: надетый — если снять, ненадетый — если надеть.
        // Не влезает или не подходит — сравнивать не с чем, строки нет.
        const compare =
          allowed && (fitted || fits)
            ? deltaHtml(
                statDeltas(
                  statsNow,
                  effectiveStats(
                    def,
                    { modules: fitted ? selected.filter((m) => m !== id) : [...selected, id] },
                    data,
                  ),
                  STAT_ORDER,
                ),
              )
            : '';
        // Не встаёт на ЭТОТ корпус — сказать, на какие встаёт, ДО того как игрок заплатит
        // данные за открытие: «Открыть» на радаре у крейсера обещало то, чего не будет.
        const fitsOnly = allowed
          ? ''
          : `<p class="sz-prereq">${t('sector-zero.prep.fits-only', {
              list: sectorHullIds(data)
                .filter((other) => moduleAllowed(other, data.units[other]!, module))
                .map((other) => esc(displayUnit(other)))
                .join(', '),
            })}</p>`;
        return `<article class="sz-card${head.cls}${fitted ? ' selected' : ''}">${head.html}<p>${effectText(module.effects.stats)}</p>${compare}${fitsOnly}${button(owned ? 'fit' : 'unlock-module', id, label, owned ? !fits && !fitted : p.research < MODULE_UNLOCK_COST, fitted)}</article>`;
      })
      .join('');
    return `${hulls}<div class="sz-hull">${catalogPortraitHtml('u', hull, data)}<div><h2>${esc(displayUnit(hull))}</h2><p class="sz-sub">${t('sector-zero.prep.ship-hint')}</p><div class="sz-stats">${['attack', 'defense', 'hp', 'shield', 'speed'].map((key) => `<span>${esc(t(stats[key]!))}<b>${num(statsNow[key] ?? 0)}</b></span>`).join('')}</div><div class="sz-bays">${bays}</div></div></div><div class="sz-cards">${modules}</div>`;
  }

  /**
   * Шапка карточки ПРЕДМЕТА — одна на подготовку, Мастерскую и Магазин (PVR-6.4): слот,
   * ступень редкости и звёзды. Цвет рамки карточки задаёт класс `r-<редкость>`, звёзды —
   * символами, а не картинкой: самодостаточному HTML лишний ассет ни к чему. Число звёзд
   * дублируется для экранного диктора, иначе ряд значков он прочитал бы как мусор.
   */
  const itemHead = (id: string, p: SectorZeroProgress): { cls: string; html: string } => {
    const module = h.data.modules[id]!;
    const rarity = moduleRarity(module);
    const cap = forgeLadderOf(h.data).cap;
    const { lit, empty } = starRow(p.stars[id] ?? 0, cap);
    const stars =
      cap > 0
        ? `<div class="sz-stars" role="img" aria-label="${esc(t('sector-zero.forge.stars', { n: lit, cap }))}"><span class="lit">${'★'.repeat(lit)}</span>${'★'.repeat(empty)}</div>`
        : '';
    return {
      cls: ` sz-item r-${rarity}`,
      html: `<div class="sz-card-type"><span>${t(`yard.slot.${module.slot}`)}</span><span class="sz-rarity">${t(`rarity.${rarity}`)}</span></div><h3>${esc(tData(module.name))}</h3>${stars}`,
    };
  };

  function workshop(p: SectorZeroProgress): string {
    const rows = workshopRows(p, h.data);
    if (rows.length === 0)
      return `<p class="sz-sub">${t('sector-zero.forge.empty')}</p>`;
    const cards = rows
      .map((row) => {
        const label = row.can
          ? t('sector-zero.forge.price', { n: row.warrants })
          : row.reason === 'E_FORGE_NOT_ENOUGH'
            ? t('sector-zero.forge.poor')
            : t('sector-zero.forge.cap');
        // Шанс и цена стоят в карточке ВСЕГДА, даже когда нажать нельзя: `EC-2.3`
        // требует, чтобы игрок понимал стоимость до того, как сможет заплатить.
        // Поток осколков виден только там, где у ступени ЕСТЬ потолок попыток: на
        // гарантированных ступенях копить нечего, и счётчик 0/0 был бы шумом.
        const shards =
          row.next && row.pity > 0
            ? `<p class="sz-forge-shards">${t('sector-zero.forge.shards', { n: row.shards, cap: row.pity })}${row.shards >= row.pity - 1 ? ` · ${t('sector-zero.forge.sure')}` : ''}</p>`
            : '';
        const offer = row.next
          ? `${oddsHtml(row.chance, row.warrants)}${deltaHtml(statDeltas(row.now, row.next, STAT_ORDER))}${shards}`
          : `<p class="sz-forge-gain">${t('sector-zero.forge.has')}: ${effectText(row.now)}</p>`;
        const head = itemHead(row.id, p);
        return `<article class="sz-card${head.cls}">${head.html}${offer}${button('forge', row.id, label, !row.can)}</article>`;
      })
      .join('');
    // Правило «при неудаче Варранты сгорают» одно на всю кузню — оно стоит один раз над
    // карточками, а не повторяется в каждой (PVR-6.6).
    return `<p class="sz-sub">${t('sector-zero.forge.hint')} ${t('sector-zero.forge.burn')}</p><div class="sz-cards">${cards}</div>`;
  }

  const PAY_LABEL: Record<PayKind, string> = {
    warrants: 'sector-zero.shop.pay.warrants',
    sovereigns: 'sector-zero.shop.pay.sovereigns',
    ad: 'sector-zero.shop.pay.ad',
  };

  function shop(p: SectorZeroProgress): string {
    const rows = shopRows(p, h.data, h.platform);
    if (rows.length === 0) return `<p class="sz-sub">${t('sector-zero.shop.empty')}</p>`;
    const featured = featuredOffer(rows, h.data);
    const cards = rows
      .map((row) => {
        const title =
          row.kind === 'module'
            ? esc(tData(h.data.modules[row.grants]?.name ?? row.grants))
            : row.kind === 'skill'
              ? esc(tData(h.data.heroSkillTrees[row.grants]?.name ?? row.grants))
              : t(`sector-zero.shop.grants.${row.grants}`, { n: row.amount });
        const what =
          row.kind === 'resource' ? '' : `<div class="sz-card-type">${t(`sector-zero.shop.grants.${row.kind}`)}</div>`;
        // Что товар ДАЁТ — одной строкой (PVR-6.7): у модуля — его статы, у узла навыка —
        // его описание. Ресурс говорит за себя заголовком «+12 данных».
        const gives =
          row.kind === 'module'
            ? effectText(h.data.modules[row.grants]?.effects.stats ?? {})
            : row.kind === 'skill'
              ? esc(t(h.data.heroSkillTrees[row.grants]?.description ?? ''))
              : '';
        // Значок у товаров без арта: ресурс — фишкой своей валюты, узел навыка — звездой Академии.
        const glyph =
          row.kind === 'module'
            ? ''
            : `<span class="sz-glyph sz-glyph-${row.kind === 'skill' ? 'skill' : esc(row.grants)}" aria-hidden="true">${row.kind === 'skill' ? '✦' : row.grants === 'warrants' ? '⌖' : '◇'}</span>`;
        // Способ, которого НЕТ У ПЛОЩАДКИ, не рисуется вовсе — это прямое требование
        // `platform-adapters.md` («если `rewardedAds === false`, кнопка не показывается»),
        // а не экономия места. Погашенная кнопка «за рекламу» там, где рекламы не бывает,
        // обещает игроку механику, которой у него не будет никогда.
        const offered = row.prices.filter((price) => price.available);
        // купить нечем ни одним способом — не показываем
        if (offered.length === 0) return { star: false, card: '' };
        // Цена остаётся видимой даже у погашенной кнопки (не хватает денег, узел закрыт):
        // `EC-2.3` требует понимать стоимость до того, как сможешь заплатить.
        const buttons = offered
          .map((price) =>
            button(`buy:${price.kind}`, row.id, t(PAY_LABEL[price.kind], { n: price.amount }), !price.can),
          )
          .join('');
        // Подпись — только когда купить нельзя НИЧЕМ из показанного: иначе она висела бы
        // над живой кнопкой и объясняла не то, на что игрок смотрит.
        const blocked = offered.every((price) => !price.can) ? offered[0]!.reason : null;
        const note =
          blocked === 'E_SHOP_OWNED' || blocked === 'E_SHOP_LOCKED'
            ? `<p class="sz-sub">${t(blocked === 'E_SHOP_OWNED' ? 'sector-zero.shop.owned' : 'sector-zero.shop.locked')}</p>`
            : '';
        // Модуль в витрине — та же карточка предмета, что в подготовке и Мастерской (PVR-6.4).
        const head =
          row.kind === 'module' && h.data.modules[row.grants] ? itemHead(row.grants, p) : null;
        const star = row.id === featured;
        const card = `<article class="sz-card sz-offer${head?.cls ?? ''}${row.owned ? ' selected' : ''}${star ? ' sz-featured' : ''}">${star ? `<span class="sz-ribbon">${t('sector-zero.shop.featured')}</span>` : ''}${glyph}${head ? head.html : `${what}<h3>${title}</h3>`}${gives ? `<p>${gives}</p>` : ''}${note}${buttons}</article>`;
        return { star, card };
      })
      // Главное предложение — первым и шире остальных (`featuredOffer`, PVR-6.7).
      .sort((a, b) => Number(b.star) - Number(a.star))
      .map((offer) => offer.card)
      .join('');
    // Обновление витрины за ролик (`SZE-3.4`): нет рекламы у площадки — кнопки нет вовсе;
    // сегодняшнее потрачено — погашена, но видна: возможность вернётся завтра.
    const refresh = shopRefresh(p, h.platform);
    const refreshButton =
      refresh === 'hidden'
        ? ''
        : button(
            'refresh-shop',
            '',
            t(refresh === 'ready' ? 'sector-zero.shop.refresh' : 'sector-zero.shop.refresh.used'),
            refresh !== 'ready',
          );
    // Суверены за ролик (`SZE-3.5`): те же правила — нет рекламы или кран выключен
    // данными — кнопки нет; попытки на сегодня кончились — погашена, но видна.
    const tap = adSovereigns(p, h.data, h.platform);
    const tapButton =
      tap.state === 'hidden'
        ? ''
        : button(
            'ad-sovereigns',
            '',
            tap.state === 'ready'
              ? t('sector-zero.shop.ad-sovereigns', { n: tap.amount, left: tap.left })
              : t('sector-zero.shop.ad-sovereigns.used'),
            tap.state !== 'ready',
          );
    return `<p class="sz-sub">${t('sector-zero.shop.hint')}</p>${refreshButton || tapButton ? `<div class="sz-shopbar">${refreshButton}${tapButton}</div>` : ''}<div class="sz-cards sz-shelf">${cards}</div>`;
  }

  /** Глубина узла в дереве навыков: без предпосылок — 1, иначе на один глубже самой
   *  глубокой. Ступени делают дерево читаемым: что открыть сначала, что потом. */
  const skillTier = (id: string, seen: Set<string> = new Set()): number => {
    const node = h.data.heroSkillTrees[id];
    if (!node || seen.has(id) || node.requires.length === 0) return 1;
    seen.add(id);
    return 1 + Math.max(...node.requires.map((r) => skillTier(r, seen)));
  };
  /** Герб героя — первая буква имени в ромбе: арта героев нет, а пустая рамка хуже. */
  const crest = (name: string): string =>
    `<span class="sz-crest" aria-hidden="true"><em>${esc(name.charAt(0).toUpperCase())}</em></span>`;

  /**
   * Академия (PVR-6.6, была «Герои и навыки»): ростер — карточки с гербом и состоянием
   * («в забеге», «закрыт», ступень подготовки); навыки героя — ступенями, закрытое
   * приглушено и говорит, чего ему не хватает.
   */
  function heroes(p: SectorZeroProgress): string {
    const data = h.data;
    const roster = Object.entries(data.heroes)
      .map(([id, def]) => {
        const hero = p.heroes[id];
        const state = !hero
          ? t('sector-zero.academy.locked')
          : p.selectedHero === id
            ? t('sector-zero.prep.hero-selected')
            : t('sector-zero.academy.rank', { n: hero.level });
        return button('hero', id, `${crest(tData(def.name))}<span><b>${esc(tData(def.name))}</b><small>${state}</small></span>`, false, heroId === id);
      })
      .join('');
    const def = data.heroes[heroId];
    if (!def) return `<div class="sz-roster">${roster}</div>`;
    const hero = p.heroes[heroId];
    const name = esc(tData(def.name));
    let body = `<div class="sz-hero">${crest(tData(def.name))}<div><h2>${name}</h2><p class="sz-sub">${esc(t(def.description ?? ''))}</p>`;
    if (!hero)
      return `<div class="sz-roster">${roster}</div>${body}${button('unlock-hero', heroId, t('sector-zero.prep.unlock', { n: HERO_UNLOCK_COST }), p.research < HERO_UNLOCK_COST)}</div></div>`;
    const selected = p.selectedHero === heroId;
    const slots = sectorHeroSlots(hero, data);
    // Ступень подготовки — делениями: 3 ступени видны сразу, а не угадываются из текста.
    const pips = [1, 2, 3].map((n) => `<i class="${n <= hero.level ? 'lit' : ''}"></i>`).join('');
    body += `<div class="sz-hero-head"><span><span class="sz-pips" aria-hidden="true">${pips}</span>${t('sector-zero.prep.hero-level', { n: hero.level, slots })}</span>${button('select-hero', heroId, t(selected ? 'sector-zero.prep.hero-selected' : 'sector-zero.prep.hero-select'), selected, selected)}${button('upgrade-hero', heroId, hero.level >= 3 ? t('sector-zero.prep.hero-max') : t('sector-zero.prep.hero-upgrade', { n: sectorHeroUpgradeCost(hero) }), hero.level >= 3 || p.research < sectorHeroUpgradeCost(hero))}</div></div></div>`;
    body += `<h3>${t('sector-zero.prep.abilities')} · ${hero.equipped.length}/${slots}</h3><div class="sz-cards">`;
    for (const id of sectorHeroAbilities(heroId, hero, data)) {
      const ability = data.heroAbilities[id]!;
      if (ability.type.startsWith('spawn_')) continue;
      const equipped = hero.equipped.includes(id);
      body += `<article class="sz-card${equipped ? ' selected' : ''}"><h3>${esc(tData(ability.name))}</h3><p>${esc(t(ability.description ?? ''))}</p>${button('ability', id, t(equipped ? 'hero.slot.remove' : 'hero.slot.equip'), !equipped && hero.equipped.length >= slots, equipped)}</article>`;
    }
    body += `</div><h3>${t('sector-zero.prep.skills')}</h3><p class="sz-sub">${t('sector-zero.prep.skill-hint')}</p>`;
    const tiers = new Map<number, string[]>();
    for (const [id, node] of Object.entries(data.heroSkillTrees)) {
      if (node.branch !== def.branch) continue;
      const tier = skillTier(id);
      tiers.set(tier, [...(tiers.get(tier) ?? []), id]);
    }
    for (const tier of [...tiers.keys()].sort((x, y) => x - y)) {
      body += `<p class="sz-tier">${t('sector-zero.academy.tier', { n: tier })}</p><div class="sz-cards">`;
      for (const id of tiers.get(tier)!) {
        const node = data.heroSkillTrees[id]!;
        const owned = hero.skills.includes(id);
        const missing = node.requires.filter((r) => !hero.skills.includes(r));
        const cost = sectorSkillCost(id, data);
        // Предпосылки называются только когда их НЕ хватает: у открытого узла это шум.
        const prereq = missing.length
          ? `<p class="sz-prereq">${t('hero.tree.requires')}: ${missing.map((r) => esc(tData(data.heroSkillTrees[r]!.name))).join(', ')}</p>`
          : '';
        body += `<article class="sz-card${owned ? ' selected' : missing.length ? ' sz-locked' : ''}"><h3>${esc(tData(node.name))}</h3><p>${esc(t(node.description ?? ''))}</p>${prereq}${button('skill', id, owned ? t('sector-zero.prep.owned') : t('sector-zero.prep.skill-buy', { n: cost }), owned || missing.length > 0 || p.research < cost, owned)}</article>`;
      }
      body += '</div>';
    }
    return `<div class="sz-roster">${roster}</div>${body}`;
  }

  function render(): void {
    const p = h.progress();
    const active = document.activeElement as HTMLElement | null;
    const focusAction = active?.dataset.prep;
    const focusId = active?.dataset.id;
    const tabButton = (id: typeof tab, icon: string, key: string): string =>
      button('tab', id, `<i aria-hidden="true">${icon}</i><span>${t(key)}</span>`, false, tab === id);
    // Шапка: назад + кошелёк одной строкой, одна строка подсказки (PVR-6.6: меньше
    // абзацев), вкладки с иконкой — на телефоне четыре в ряд, без переполнения.
    panel.innerHTML = `<div class="sz-workhead">${button('back', '', t('sector-zero.prep.back'))}<div class="sz-purse"><b class="sz-cur sz-cur-data">${t('sector-zero.prep.research', { n: p.research })}</b><b class="sz-cur sz-cur-warrants">${t('sector-zero.forge.warrants', { n: p.warrants })}</b>${h.platform.sovereigns ? `<b class="sz-cur sz-cur-sovereigns">${t('sector-zero.shop.sovereigns', { n: p.sovereigns })}</b>` : ''}</div></div><h1>${t('sector-zero.prep')}</h1><p class="sz-sub">${t('sector-zero.prep.hint')} <span class="sz-reward">${p.lastReward ? `${t('sector-zero.prep.reward', { n: p.lastReward })} · ${t('sector-zero.prep.warrants', { n: p.lastReward * WARRANTS_PER_REWARD })}` : t('sector-zero.prep.earn')}</span></p><div class="sz-tabs">${tabButton('ships', '⬡', 'sector-zero.prep.modules')}${tabButton('workshop', '⚒\uFE0E', 'sector-zero.prep.workshop')}${tabButton('shop', '◈', 'sector-zero.prep.shop')}${tabButton('heroes', '✦', 'sector-zero.prep.heroes')}</div><div id="sz-prep-status" role="status" aria-live="polite">${esc(message)}</div>${tab === 'ships' ? ships(p) : tab === 'workshop' ? workshop(p) : tab === 'shop' ? shop(p) : heroes(p)}`;
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
    if (kind === 'tab')
      tab =
        id === 'heroes' ? 'heroes' : id === 'workshop' ? 'workshop' : id === 'shop' ? 'shop' : 'ships';
    else if (kind === 'hull') hull = id;
    else if (kind === 'hero') heroId = id;
    else {
      let action: SectorProgressAction | null = null;
      if (kind === 'ad-sovereigns') {
        // Сперва подтверждённый показ, потом начисление; отказ попытку не тратит. Сутки
        // сверяются перед начислением — лимит считается по сегодняшним, а не вчерашним.
        const settle = (watched: boolean): void => {
          if (watched) h.sync();
          const amount = h.data.sectorZeroShop.adSovereigns.amount;
          message = !watched
            ? t('sector-zero.shop.ad-declined')
            : h.change({ kind: 'ad-sovereigns' })
              ? t('sector-zero.shop.ad-sovereigns.got', { n: amount })
              : t('sector-zero.prep.unavailable');
          render();
        };
        void h.watchAd('shop:sovereigns').then(settle, () => settle(false));
        return;
      }
      if (kind === 'refresh-shop') {
        // Как покупка за рекламу: сперва подтверждённый показ, потом действие. Отказ от
        // ролика действие не зовёт — попытка не тратится и витрина не меняется. Сутки
        // сверяются ПЕРЕД действием: иначе ролик, досмотренный после полуночи, обновил бы
        // уже вчерашнюю витрину.
        const settle = (watched: boolean): void => {
          if (watched) h.sync();
          message = !watched
            ? t('sector-zero.shop.ad-declined')
            : t(
                h.change({ kind: 'refresh-shop' })
                  ? 'sector-zero.shop.refreshed'
                  : 'sector-zero.prep.unavailable',
              );
          render();
        };
        void h.watchAd('shop:refresh').then(settle, () => settle(false));
        return;
      }
      if (kind?.startsWith('buy:')) {
        const pay = kind.slice(4) as PayKind;
        if (pay === 'ad') {
          // Два шага, а не один: сперва подтверждённый показ, потом выдача. Отказ от
          // рекламы не должен ничего ломать и не должен ничего отнимать, поэтому при
          // `false` мы просто не зовём выдачу — списывать тут нечего по определению.
          // Сломавшийся адаптер читается как «не досмотрел»: fail-secure, товар не
          // выдаётся. Иначе исключение в SDK площадки превратилось бы в бесплатный лот.
          const settle = (watched: boolean): void => {
            message = !watched
              ? t('sector-zero.shop.ad-declined')
              : t(h.change({ kind: 'buy', id, pay }) ? 'sector-zero.shop.bought' : 'sector-zero.prep.unavailable');
            render();
          };
          void h.watchAd(`shop:${id}`).then(settle, () => settle(false));
          return;
        }
        message = t(h.change({ kind: 'buy', id, pay }) ? 'sector-zero.shop.bought' : 'sector-zero.prep.unavailable');
        render();
        return;
      }
      if (kind === 'forge') {
        // Исход читаем по ЗВЁЗДНОСТИ, а не по «удалось ли изменить профиль»: неудачная
        // попытка тоже меняет профиль (сгорели Варранты, вырос счётчик), и по успеху
        // вызова их было бы не отличить. Никакой «почти удачи» — ровно два сообщения.
        const before = h.progress().stars[id] ?? 0;
        if (h.change({ kind, id })) {
          const after = h.progress().stars[id] ?? 0;
          message =
            after > before
              ? t('sector-zero.forge.won', { n: after })
              : t('sector-zero.forge.lost');
        } else message = t('sector-zero.prep.unavailable');
        render();
        return;
      }
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
      h.sync();
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
