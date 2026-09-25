import { t, tData } from '../../localization/runtime';
import {
  canEquip,
  effectiveStats,
  rarityOf,
  starsOf,
  type GameData,
} from '../../packages/shared-core/src/index';
import {
  HERO_UNLOCK_COST,
  MODULE_UNLOCK_COST,
  sectorHeroSlotItems,
  sectorHeroSlots,
  forgeLadderOf,
  sectorHullIds,
  sectorModulesFor,
  sectorHeroShipSlots,
  sectorHeroShipUnit,
  HERO_SHIP_STAR_SLOTS,
  sectorSkillCard,
  sectorSkillCost,
  sectorSlotItem,
  sectorSkillOpenTo,
  lastRunWarrants,
  type SectorProgressAction,
  type SectorZeroProgress,
} from '../../decisions/sectorZeroProgress';
import { contribution, workshopRows, type WorkshopRow } from '../../decisions/sectorZeroWorkshop';
import { starRow } from '../../decisions/itemRarity';
import { moduleLadder, profileRarity, raiseCheck, rarityOffered, RARITY_COPIES } from '../../decisions/moduleRarity';
import { statDeltas, type StatDelta } from '../../decisions/itemCompare';
import { adRefusalKey, type AdOutcome, type AdPlacement } from '../../decisions/adPlacements';
import {
  adSovereigns,
  doubleReward,
  shopRefresh,
  shopRows,
  type PayKind,
  type ShopCapabilities,
} from '../../decisions/sectorZeroShop';
import { featuredOffer } from '../../decisions/shopFeatured';
import { HERO_MAX_STARS, heroStarCost, heroTokenGoal, heroTokenUse } from '../../decisions/heroTokens';
import { esc, displayUnit } from './format';
import { catalogPortraitHtml } from './shipArt';
import { unitDamageHtml } from './unitDamageView';
import { unitDamageProfile } from '../../decisions/unitDamage';
import { heroPortraitHtml } from '../../packages/client/src/heroPortraits';
import { splitSupport } from '../../decisions/supportShips';
import { heroChapter } from '../../decisions/heroRecruits';
import { romanChapter } from '../../decisions/chapterRoute';

interface PreparationHost {
  data: GameData;
  /** Что умеет ПЛОЩАДКА (`platform-adapters.md`): решения UI принимаются по capability,
   *  а не по имени площадки. Сегодня оба флага выключены — ни IAP, ни `PlatformAds` в
   *  продукте нет, и рисовать живые кнопки под несуществующую машинерию нельзя. */
  platform: ShopCapabilities;
  /** Показать rewarded-рекламу и дождаться ПОДТВЕРЖДЁННОГО результата. `true` = игрок
   *  досмотрел. Награду выдаёт игра и только после этого (`platform-adapters.md`), поэтому
   *  покупка за рекламу идёт двумя шагами, а не одним. */
  /** Показать rewarded-ролик и вернуть ИСХОД (`YAG-3.2`): «не досмотрел» и «рекламы
   *  нет» игрок видит по-разному. `props` — к аналитике, в id места не входят. */
  watchAd(placement: AdPlacement, props?: Record<string, string>): Promise<AdOutcome>;
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
 * «Было → станет» списком (PVR-6.5): одна разметка на корабль и на улучшение модуля. Прибавка
 * зелёная, потеря красная — цвет несёт смысл, а число рядом дублирует его для тех, кто
 * цвет не различает. `signed` — для вклада самого модуля («+6 → +6.6», как строка «Трюм +6»
 * над ним), чтобы он не путался со статом корабля («5 → 11») в той же карточке.
 */
const deltaHtml = (rows: readonly StatDelta[], signed = false): string =>
  rows.length === 0
    ? ''
    : `<ul class="sz-delta">${rows
        .map(
          (r) =>
            `<li><span>${esc(t(stats[r.key] ?? r.key))}</span><b>${statValue(r.key, r.before, signed)} → ${statValue(r.key, r.after, signed)}</b><em class="${r.diff > 0 ? 'up' : 'down'}">${statValue(r.key, r.diff, true)}</em></li>`,
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
  let tab: 'ships' | 'heroes' | 'shop' = 'ships';
  let hull = sectorHullIds(h.data).includes('cruiser')
    ? 'cruiser'
    : (sectorHullIds(h.data)[0] ?? '');
  let heroId = h.progress().selectedHero;
  /** Во вкладке «Корабли» открыт корабль героя, а не корпус флота (PVR-6.24). */
  let heroShip = false;
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
    // Корабль героя (PVR-6.24, решение владельца 2026-09-25) — такой же корпус со своим
    // набором, только набор у каждого героя свой, а слотов прибавляют его звёзды. В забег
    // едет корабль ВЫБРАННОГО героя, поэтому и показывается он.
    const captain = p.heroes[p.selectedHero];
    const onHero = heroShip && captain !== undefined;
    const unit = onHero ? sectorHeroShipUnit(p.selectedHero, data) : hull;
    const base = data.units[unit];
    if (!base) return '';
    const def = onHero ? { ...base, slots: sectorHeroShipSlots(p.selectedHero, captain, data) } : base;
    const selected = onHero ? (captain.ship ?? []) : (p.loadouts[hull] ?? []);
    // Сравнение — с теми же звёздами и редкостью, что поедут в забег (`prepareSectorZeroRun`):
    // без них карточка показывала бы голый модуль, а в бою он сильнее.
    const statsWith = (mods: string[]) =>
      effectiveStats(
        def,
        {
          modules: mods,
          moduleStars: starsOf(mods, p.stars),
          moduleRarity: rarityOf(mods, p.moduleRarity),
        },
        data,
      );
    const statsNow = statsWith(selected);
    // Корпус выбирают по картинке, а не по слову (PVR-6.6): тот же арт, что в
    // конструкторе основной игры. Нет арта у корпуса — остаётся имя, без пустой рамки.
    const hullTile = (id: string): string =>
      button('hull', id, `${catalogPortraitHtml('u', id, data, 'thumb')}<span>${esc(displayUnit(id))}</span>`, false, !onHero && hull === id);
    const heroTile = captain
      ? button(
          'hero-ship',
          p.selectedHero,
          `${catalogPortraitHtml('u', sectorHeroShipUnit(p.selectedHero, data), data, 'thumb')}<span>${t('sector-zero.prep.hero-ship')}</span>`,
          false,
          onHero,
        )
      : '';
    // Корабли линии, поддержка и челноки — рядами, как вкладки Производства (ROS-SUP-1);
    // признаки из данных.
    const groups = splitSupport(sectorHullIds(data), data);
    const hulls = (
      [
        ['yard.tab.ships', groups.line],
        ['yard.tab.support', groups.support],
        ['yard.tab.squads', groups.shuttles],
      ] as const
    )
      .filter(([, ids]) => ids.length > 0)
      .map(
        ([key, ids]) =>
          `<p class="sz-tier">${t(key)}</p><div class="sz-picker sz-hulls">${key === 'yard.tab.ships' ? heroTile : ''}${ids.map(hullTile).join('')}</div>`,
      )
      .join('');
    const bays = Object.entries(def.slots)
      .filter(([, n]) => n > 0)
      .map(([slot, n]) => {
        const modules = selected.filter((id) => data.modules[id]?.slot === slot);
        return `<div class="sz-bay"><b>${esc(t(`yard.slot.${slot}`))} · ${modules.length}/${n}</b><span>${modules.map((id) => esc(tData(data.modules[id]!.name))).join(', ') || t('hero.slot.empty')}</span></div>`;
      })
      .join('');
    // Улучшение живёт в карточке модуля (решение владельца 2026-09-25): надел и тут же
    // прокачал — отдельной вкладки «Мастерская» больше нет.
    const forge = new Map(workshopRows(p, data).map((row) => [row.id, row] as const));
    // Только то, что встаёт на ЭТОТ корпус (решение владельца 2026-09-25): карточка
    // «не подходит» занимала место и звала открыть то, что сюда не встанет никогда.
    const modules = sectorModulesFor(unit, selected, data)
      .map((id) => [id, data.modules[id]!] as const)
      .map(([id, module]) => {
        const owned = p.modules.includes(id);
        const fitted = selected.includes(id);
        const fits = canEquip(unit, def, selected, id, data).ok;
        const label = !owned
          ? t('sector-zero.prep.unlock', { n: MODULE_UNLOCK_COST })
          : fitted
            ? t('sector-zero.prep.equipped')
            : !fits
              ? t('sector-zero.prep.full')
              : t('sector-zero.prep.equip');
        const head = itemHead(id, p);
        // Что станет с ЭТИМ корпусом: надетый — если снять, ненадетый — если надеть.
        // Слот занят — сравнивать не с чем, строки нет.
        const compare =
          fitted || fits
            ? deltaHtml(
                statDeltas(
                  statsNow,
                  statsWith(fitted ? selected.filter((m) => m !== id) : [...selected, id]),
                  STAT_ORDER,
                ),
              )
            : '';
        const row = owned ? forge.get(id) : undefined;
        return `<article class="sz-card${head.cls}${fitted ? ' selected' : ''}">${head.html}<p>${effectText(module.effects.stats)}</p>${compare}${button(owned ? (onHero ? 'fit-hero' : 'fit') : 'unlock-module', id, label, owned ? !fits && !fitted : p.research < MODULE_UNLOCK_COST, fitted)}${row ? upgradeHtml(row, p) : ''}</article>`;
      })
      .join('');
    // Правило кузни одно на все карточки — строкой над ними (PVR-6.6), чертежи — только когда
    // они есть: без чертежа путь к редкости закрыт, и счёт «0 · 0 · 0» был бы шумом.
    const blueprints = (['unique', 'mythic', 'legendary'] as const).filter((r) => (p.blueprints[r] ?? 0) > 0);
    const forgeNote =
      forge.size > 0
        ? `<p class="sz-sub sz-forge-rule">${t('sector-zero.forge.burn')}</p>${
            blueprints.length
              ? `<p class="sz-blueprints"><b>${t('sector-zero.rarity.blueprints')}</b>${blueprints.map((r) => `<span class="r-${r}">${t(`rarity.${r}`)} ${p.blueprints[r]}</span>`).join('')}</p><p class="sz-sub">${t('sector-zero.rarity.hint', { n: RARITY_COPIES })}</p>`
              : ''
          }`
        : '';
    // Что даст следующая звезда героя кораблю — прямо под заголовком, где видны слоты.
    const nextSlot = onHero ? HERO_SHIP_STAR_SLOTS[captain.level + 1] : undefined;
    const title = onHero
      ? `${t('sector-zero.prep.hero-ship')} · ${esc(tData(data.heroes[p.selectedHero]!.name))}`
      : esc(displayUnit(hull));
    const hint = onHero
      ? `${t('sector-zero.prep.hero-ship.hint')}${nextSlot ? ` ${t('sector-zero.prep.hero-ship.next', { n: captain.level + 1, slot: t(`yard.slot.${nextSlot}`).toLocaleLowerCase() })}` : ''}`
      : t('sector-zero.prep.ship-hint');
    return `${hulls}<div class="sz-hull">${catalogPortraitHtml('u', unit, data)}<div><h2>${title}</h2><p class="sz-sub">${hint}</p><div class="sz-stats">${['attack', 'defense', 'hp', 'shield', 'speed'].map((key) => `<span>${esc(t(stats[key]!))}<b>${num(statsNow[key] ?? 0)}</b></span>`).join('')}</div>${unitDamageHtml(unitDamageProfile(base, statsNow))}<div class="sz-bays">${bays}</div></div></div>${forgeNote}<div class="sz-cards">${modules}</div>`;
  }

  /**
   * Шапка карточки ПРЕДМЕТА — одна на подготовку, Мастерскую и Магазин (PVR-6.4): слот,
   * ступень редкости и звёзды. Цвет рамки карточки задаёт класс `r-<редкость>`, звёзды —
   * символами, а не картинкой: самодостаточному HTML лишний ассет ни к чему. Число звёзд
   * дублируется для экранного диктора, иначе ряд значков он прочитал бы как мусор.
   */
  const itemHead = (id: string, p: SectorZeroProgress): { cls: string; html: string } => {
    const module = h.data.modules[id]!;
    // Ступень — из профиля (поднятая за чертёж и дубли, SZE-5.2), потолок звёзд — от неё.
    const rarity = profileRarity(p, id, h.data);
    const cap = moduleLadder(forgeLadderOf(h.data), rarity).cap;
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

  /**
   * Блок «Улучшение ★» в карточке ОТКРЫТОГО модуля (решение владельца 2026-09-25: Мастерская
   * живёт в «Кораблях»). Шанс и цена стоят ВСЕГДА, даже когда нажать нельзя: `EC-2.3`
   * требует, чтобы игрок понимал стоимость до того, как сможет заплатить. Поток осколков —
   * только там, где у ступени ЕСТЬ потолок попыток: на гарантированной копить нечего.
   * Редкость — только с чертежом следующей ступени (`rarityOffered`).
   */
  const upgradeHtml = (row: WorkshopRow, p: SectorZeroProgress): string => {
    const label = row.can
      ? t('sector-zero.forge.price', { n: row.warrants })
      : row.reason === 'E_FORGE_NOT_ENOUGH'
        ? t('sector-zero.forge.poor')
        : t('sector-zero.forge.cap');
    const shards =
      row.next && row.pity > 0
        ? `<p class="sz-forge-shards">${t('sector-zero.forge.shards', { n: row.shards, cap: row.pity })}${row.shards >= row.pity - 1 ? ` · ${t('sector-zero.forge.sure')}` : ''}</p>`
        : '';
    const star = row.next
      ? `${oddsHtml(row.chance, row.warrants)}${deltaHtml(statDeltas(row.now, row.next, STAT_ORDER), true)}${shards}${button('forge', row.id, label, !row.can)}`
      : `<p class="sz-forge-gain">${t('sector-zero.forge.cap')}</p>`;
    const rarity = rarityOffered(p, row.id, h.data) ? rarityHtml(row, p) : '';
    return `<div class="sz-upgrade"><p class="sz-upgrade-title">${t('sector-zero.forge.title')}</p>${star}${rarity}</div>`;
  };

  /**
   * Блок редкости в карточке модуля (SZE-5.4): до какой ступени поднять, какой
   * параметр она даст (числом, с учётом звёзд) и чего не хватает — «чертёж 1/1 · дубли
   * 2/3». Встаёт только с чертежом на руках (`rarityOffered`).
   */
  const rarityHtml = (row: { id: string; star: number; now: Record<string, number> }, p: SectorZeroProgress): string => {
    const check = raiseCheck(p, row.id, h.data);
    if (!check.to) return '';
    const gain = deltaHtml(statDeltas(row.now, contribution(row.id, row.star, h.data, check.to), STAT_ORDER), true);
    const need = t('sector-zero.rarity.need', {
      b: Math.min(check.blueprints, 1),
      c: Math.min(check.copies, RARITY_COPIES),
      m: RARITY_COPIES,
    });
    return (
      `<div class="sz-rarity-up r-${check.to}"><p><b>${t('sector-zero.rarity.to', { r: t(`rarity.${check.to}`) })}</b></p>${gain}` +
      `<p class="sz-need">${need}</p>${button('raise-rarity', row.id, t('sector-zero.rarity.raise'), !check.can)}</div>`
    );
  };

  const PAY_LABEL: Record<PayKind, string> = {
    warrants: 'sector-zero.shop.pay.warrants',
    sovereigns: 'sector-zero.shop.pay.sovereigns',
    ad: 'sector-zero.shop.pay.ad',
  };

  function shop(p: SectorZeroProgress): string {
    const rows = shopRows(p, h.data, h.platform);
    // Витрины нет в каталоге вовсе — магазин выключен данными. Раскупленный прилавок — другое:
    // кнопки роликов остаются, а вместо карточек — «приходите завтра».
    if (Object.keys(h.data.sectorZeroShop.offers).length === 0)
      return `<p class="sz-sub">${t('sector-zero.shop.empty')}</p>`;
    const featured = featuredOffer(rows, h.data);
    const cards = rows
      .map((row) => {
        const title =
          row.kind === 'module'
            ? esc(tData(h.data.modules[row.grants]?.name ?? row.grants))
            : row.kind === 'skill'
              ? esc(tData(h.data.heroSkillTrees[row.grants]?.name ?? row.grants))
              : row.kind === 'blueprint'
                ? t('sector-zero.shop.blueprint', { r: t(`rarity.${row.grants}`) })
                : row.kind === 'hero-tokens'
                  ? t('sector-zero.shop.tokens', { name: esc(tData(h.data.heroes[row.grants]?.name ?? row.grants)), n: row.amount })
                  : t(`sector-zero.shop.grants.${row.grants}`, { n: row.amount });
        const what =
          row.kind === 'resource' ? '' : `<div class="sz-card-type">${t(`sector-zero.shop.grants.${row.kind}`)}</div>`;
        // Что товар ДАЁТ — одной строкой (PVR-6.7): у модуля — его статы, у узла навыка —
        // его описание. Ресурс говорит за себя заголовком «+12 данных».
        const gives =
          row.kind === 'module'
            ? effectText(h.data.modules[row.grants]?.effects.stats ?? {}) +
              // Открытый модуль приходит дублем — материалом для редкости (SZE-5.3).
              (row.owned ? ` · ${t('sector-zero.shop.duplicate')}` : '')
            : row.kind === 'blueprint'
              ? t('sector-zero.shop.blueprint.gives', { n: RARITY_COPIES })
            : row.kind === 'skill'
              ? esc(t(h.data.heroSkillTrees[row.grants]?.description ?? ''))
              : row.kind === 'hero-tokens' && heroTokenGoal(p, row.grants, h.data) !== null
                ? t('sector-zero.academy.tokens', { n: p.heroTokens[row.grants] ?? 0, goal: heroTokenGoal(p, row.grants, h.data)! })
                : '';
        // Значок у товаров без арта: ресурс — фишкой своей валюты, узел навыка — звездой Академии.
        const glyph =
          row.kind === 'module'
            ? ''
            : `<span class="sz-glyph sz-glyph-${row.kind === 'skill' ? 'skill' : row.kind === 'blueprint' ? `blueprint r-${esc(row.grants)}` : row.kind === 'hero-tokens' ? 'tokens' : esc(row.grants)}" aria-hidden="true">${row.kind === 'skill' ? '✦' : row.kind === 'blueprint' ? '📐' : row.kind === 'hero-tokens' ? '★' : row.grants === 'warrants' ? '⌖' : '◇'}</span>`;
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
        const tokensLot = row.kind === 'hero-tokens';
        const note =
          blocked === 'E_SHOP_OWNED' || blocked === 'E_SHOP_LOCKED'
            ? `<p class="sz-sub">${t(
                blocked === 'E_SHOP_OWNED'
                  ? tokensLot ? 'sector-zero.shop.tokens.max' : 'sector-zero.shop.owned'
                  : tokensLot ? 'sector-zero.shop.tokens.locked' : 'sector-zero.shop.locked',
              )}</p>`
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
    return `<p class="sz-sub">${t('sector-zero.shop.hint')}</p>${refreshButton || tapButton ? `<div class="sz-shopbar">${refreshButton}${tapButton}</div>` : ''}${rows.length ? `<div class="sz-cards sz-shelf">${cards}</div>` : `<p class="sz-sub">${t('sector-zero.shop.sold-out')}</p>`}`;
  }

  /** Глубина узла в дереве навыков: без предпосылок — 1, иначе на один глубже самой
   *  глубокой. Ступени делают дерево читаемым: что открыть сначала, что потом. */
  const skillTier = (id: string): number => Math.max(1, sectorSkillCost(id, h.data) / 2);
  /** Герб героя — первая буква имени в ромбе: запас для героя без портрета. */
  const crest = (name: string): string =>
    `<span class="sz-crest" aria-hidden="true"><em>${esc(name.charAt(0).toUpperCase())}</em></span>`;
  /**
   * Лицо героя — портрет из общего атласа (`heroPortraits.ts`), того же, что на карте и в
   * штабе. Герою без портрета достаётся герб: пустая рамка хуже буквы. Закрытый герой —
   * приглушённым лицом: кто уже в строю, ростер говорит ещё до подписи под карточкой.
   */
  const face = (id: string, name: string, locked: boolean): string => {
    const portrait = heroPortraitHtml(id);
    return portrait
      ? `<span class="sz-face${locked ? ' sz-face-locked' : ''}">${portrait}</span>`
      : crest(name);
  };

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
        const chapter = heroChapter(id);
        const state = !hero
          ? chapter !== null
            ? t('sector-zero.academy.by-chapter', { n: romanChapter(chapter) })
            : heroTokenUse(p, id, data) === 'join'
              ? t('sector-zero.academy.tokens', { n: p.heroTokens[id] ?? 0, goal: heroTokenGoal(p, id, data) ?? 0 })
              : t('sector-zero.academy.locked')
          : p.selectedHero === id
            ? t('sector-zero.prep.hero-selected')
            : t('sector-zero.academy.rank', { n: hero.level });
        return button('hero', id, `${face(id, tData(def.name), !hero)}<span><b>${esc(tData(def.name))}</b><small>${state}</small></span>`, false, heroId === id);
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
    // Звезда стоит жетоны этого героя и открывает слот навыка (`heroTokens.ts`).
    const pips = Array.from({ length: HERO_MAX_STARS }, (_, i) => `<i class="${i < hero.level ? 'lit' : ''}">★</i>`).join('');
    const cost = heroStarCost(hero.level);
    const tokenLine = goal !== null ? `<small class="sz-tokens">${t('sector-zero.academy.tokens', { n: tokens, goal })}</small>` : '';
    body += `<div class="sz-hero-head"><span><span class="sz-pips sz-stars" aria-hidden="true">${pips}</span>${t('sector-zero.prep.hero-level', { n: hero.level, slots })}${tokenLine}</span>${button('select-hero', heroId, t(selected ? 'sector-zero.prep.hero-selected' : 'sector-zero.prep.hero-select'), selected, selected)}${button('upgrade-hero', heroId, cost === null ? t('sector-zero.prep.hero-max') : t('sector-zero.prep.hero-upgrade', { star: hero.level + 1, n: cost }), cost === null || tokens < cost)}</div></div></div>`;
    body += `<h3>${t('sector-zero.prep.abilities')} · ${hero.equipped.length}/${slots}</h3><div class="sz-cards">`;
    // В слоты идут способности и надеваемые пассивки (PVR-6.16) — один список, один бюджет.
    for (const id of sectorHeroSlotItems(heroId, hero, data)) {
      if (data.heroAbilities[id]?.type.startsWith('spawn_')) continue;
      const item = sectorSlotItem(id, data)!;
      const equipped = hero.equipped.includes(id);
      body += `<article class="sz-card${equipped ? ' selected' : ''}"><h3>${esc(tData(item.name))}</h3><p>${esc(t(item.description ?? ''))}</p>${button('ability', id, t(equipped ? 'hero.slot.remove' : 'hero.slot.equip'), !equipped && hero.equipped.length >= slots, equipped)}</article>`;
    }
    body += `</div><h3>${t('sector-zero.prep.skills')}</h3><p class="sz-sub">${t('sector-zero.prep.skill-hint')}</p>`;
    const tiers = new Map<number, string[]>();
    for (const [id, node] of Object.entries(data.heroSkillTrees)) {
      if (!sectorSkillOpenTo(node, heroId, data)) continue;
      const tier = skillTier(id);
      tiers.set(tier, [...(tiers.get(tier) ?? []), id]);
    }
    for (const tier of [...tiers.keys()].sort((x, y) => x - y)) {
      body += `<p class="sz-tier">${t('sector-zero.academy.tier', { n: tier })}</p><div class="sz-cards">`;
      for (const id of tiers.get(tier)!) {
        const node = data.heroSkillTrees[id]!;
        const { owned, missing } = sectorSkillCard(heroId, hero, id, data);
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
    // Двойная награда за забег (`YAG-3.2`) — рядом с самой наградой, и на кнопке видно,
    // СКОЛЬКО придёт (п. 4.5.1: и что будет реклама, и что игрок получит).
    const twice = doubleReward(p, h.platform);
    const doubleButton =
      twice.state === 'ready'
        ? button(
            'double-reward',
            '',
            t('sector-zero.prep.double', { n: twice.research, m: twice.warrants }),
          )
        : '';
    const tabButton = (id: typeof tab, icon: string, key: string): string =>
      button('tab', id, `<i aria-hidden="true">${icon}</i><span>${t(key)}</span>`, false, tab === id);
    // Шапка: «назад», одна строка подсказки (PVR-6.6: меньше абзацев), вкладки с иконкой —
    // на телефоне в ряд, без переполнения (Мастерская — в «Кораблях»). Кошелёк прилипает к
    // верху ВМЕСТЕ с вкладками (замечание владельца 2026-09-25: «прокрутил вниз и не вижу,
    // сколько у меня ресурсов для прокачки»): цена стоит у кнопки внизу, а запас — всегда на виду.
    panel.innerHTML = `<div class="sz-workhead">${button('back', '', t('sector-zero.prep.back'))}</div><h1>${t('sector-zero.prep')}</h1><p class="sz-sub">${t('sector-zero.prep.hint')} <span class="sz-reward">${p.lastReward ? `${t('sector-zero.prep.reward', { n: p.lastReward })} · ${t('sector-zero.prep.warrants', { n: lastRunWarrants(p) })}` : t('sector-zero.prep.earn')}</span></p>${doubleButton}<div class="sz-stick"><div class="sz-purse"><b class="sz-cur sz-cur-data">${t('sector-zero.prep.research', { n: p.research })}</b><b class="sz-cur sz-cur-warrants">${t('sector-zero.forge.warrants', { n: p.warrants })}</b>${h.platform.sovereigns ? `<b class="sz-cur sz-cur-sovereigns">${t('sector-zero.shop.sovereigns', { n: p.sovereigns })}</b>` : ''}</div><div class="sz-tabs">${tabButton('ships', '⬡', 'sector-zero.prep.modules')}${tabButton('shop', '◈', 'sector-zero.prep.shop')}${tabButton('heroes', '✦', 'sector-zero.prep.heroes')}</div></div><div id="sz-prep-status" role="status" aria-live="polite">${esc(message)}</div>${tab === 'ships' ? ships(p) : tab === 'shop' ? shop(p) : heroes(p)}`;
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
  /**
   * Ролик по нажатию, потом действие — единственный путь к рекламе на этом экране
   * (`YAG-3.2`). Порядок жёсткий: сперва подтверждённый показ, потом выдача; не досмотрел
   * или рекламы нет — действие не зовётся, попытка не тратится и ничего не списано.
   * Сломавшийся адаптер (отклонённый промис) читается как «рекламы нет» — fail-secure:
   * исключение в SDK площадки не должно превращаться в бесплатную награду.
   */
  /** Ролик уже идёт (AUD-25): второе нажатие до его исхода — не второй ролик. Кнопки
   *  кошелька и итогов держат то же правило своим флагом. */
  let watching = false;
  const viaAd = (
    placement: AdPlacement,
    onWatched: () => string,
    props?: Record<string, string>,
  ): void => {
    if (watching) return;
    watching = true;
    const settle = (status: AdOutcome): void => {
      watching = false;
      message = status === 'ok' ? onWatched() : t(adRefusalKey(status));
      render();
    };
    void h.watchAd(placement, props).then(settle, () => settle('unavailable'));
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
      tab = id === 'heroes' ? 'heroes' : id === 'shop' ? 'shop' : 'ships';
    else if (kind === 'hull') {
      hull = id;
      heroShip = false;
    } else if (kind === 'hero-ship') heroShip = true;
    else if (kind === 'hero') heroId = id;
    else {
      let action: SectorProgressAction | null = null;
      if (kind === 'double-reward') {
        viaAd('run.double', () => {
          const { research, warrants } = doubleReward(h.progress(), h.platform);
          return h.change({ kind: 'double-reward' })
            ? t('sector-zero.prep.doubled', { n: research, m: warrants })
            : t('sector-zero.prep.unavailable');
        });
        return;
      }
      if (kind === 'ad-sovereigns') {
        // Сутки сверяются перед начислением — лимит считается по сегодняшним, а не
        // вчерашним.
        viaAd('shop.sovereigns', () => {
          h.sync();
          const amount = h.data.sectorZeroShop.adSovereigns.amount;
          return h.change({ kind: 'ad-sovereigns' })
            ? t('sector-zero.shop.ad-sovereigns.got', { n: amount })
            : t('sector-zero.prep.unavailable');
        });
        return;
      }
      if (kind === 'refresh-shop') {
        // Сутки сверяются ПЕРЕД действием: иначе ролик, досмотренный после полуночи,
        // обновил бы уже вчерашнюю витрину.
        viaAd('shop.refresh', () => {
          h.sync();
          return t(
            h.change({ kind: 'refresh-shop' })
              ? 'sector-zero.shop.refreshed'
              : 'sector-zero.prep.unavailable',
          );
        });
        return;
      }
      if (kind?.startsWith('buy:')) {
        const pay = kind.slice(4) as PayKind;
        if (pay === 'ad') {
          viaAd(
            'shop.lot',
            () =>
              t(
                h.change({ kind: 'buy', id, pay })
                  ? 'sector-zero.shop.bought'
                  : 'sector-zero.prep.unavailable',
              ),
            { lot: id },
          );
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
      if (kind === 'raise-rarity') {
        const ok = h.change({ kind, id });
        message = ok
          ? t('sector-zero.rarity.raised', { r: t(`rarity.${profileRarity(h.progress(), id, h.data)}`) })
          : t('sector-zero.prep.unavailable');
        render();
        return;
      }
      if (kind === 'fit') action = { kind, hull, id };
      else if (kind === 'fit-hero') action = { kind, hero: h.progress().selectedHero, id };
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
