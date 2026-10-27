/**
 * «Магазин» хаба (заказ владельца 2026-10-20, макет одобрен: «норм, реализовывай»; иконки
 * валют — имеющиеся, `SOV_SVG` и ⌖).
 *
 * Четыре полки: пакеты Суверенов (товары Commerce за деньги площадки — пока провайдера нет,
 * видны и недоступны), премиум, наборы модулей и материалы за ◆. Цены, запреты и бонусы
 * премиума решает сервер (`/meta-economy/me` → `store`, `premiumDaily`, `ads`); что из этого
 * показать и что говорит кнопка — `decisions/shopView.ts`; здесь разметка и проводка.
 * Магазин — единственное место покупок: раздел «Магазин» ушёл из «Снабжения», а Арсенал
 * ведёт сюда, на вкладку модулей.
 *
 * Раскладка как у Арсенала: на ПК карточка товара рядом со списком, на узкой вкладке
 * (телефон) — шторкой поверх хаба. Покупка — в два нажатия: «Купить» показывает
 * подтверждение с суммой, списание идёт только после него.
 *
 * Пятая полка, «Стили» (CORP-14), — стили базы корпорации: покупает глава за свои ◆
 * для всей корпорации, и он же применяет купленный стиль здесь или на вкладке «Корпорация».
 * Кнопку стиля решает `decisions/corpStyle.ts` по ответу `/meta-economy/corp-style`.
 */
import { CORP_HQ } from '../../decisions/corpBase';
import { styleOfferState, type StyleOfferState } from '../../decisions/corpStyle';
import type { CommerceOffer } from '../../packages/protocol/src/commerce';
import type { MetaCorpStyleView } from '../../packages/protocol/src/corpStyle';
import type {
  MetaEconomyView,
  MetaStoreOfferView,
} from '../../packages/protocol/src/metaEconomyView';
import { t, tData } from '../../localization/runtime';
import {
  adSupply,
  bestPack,
  buyState,
  defaultPick,
  discountOf,
  packTotal,
  premiumDaysLeft,
  premiumSavings,
  recipeCoverage,
  shelf,
  sovereignPacks,
  SHOP_TABS,
  type ShopTab,
} from '../../decisions/shopView';
import { CORP_ART_BUILDINGS, corpArt, corpStyleName } from './corpArt';
import { data } from './gameData';
import { esc, nfmt } from './format';
import { SOV_SVG } from './icons';
import { moduleIcon } from './moduleIcons';
import { detach } from './detach';
import {
  createMetaEconomyClient,
  type MetaEconomyStatus,
  type MetaSession,
} from './metaEconomyClient';

const TAB_KEY: Record<ShopTab, string> = {
  sovereigns: 'shop.tab.sovereigns',
  premium: 'shop.tab.premium',
  modules: 'shop.tab.modules',
  materials: 'shop.tab.materials',
  styles: 'shop.tab.styles',
};
const TAB_ICON: Record<ShopTab, string> = {
  sovereigns: `<i class="sh-sv">${SOV_SVG}</i>`,
  premium: '★',
  modules: '⬡',
  materials: '⬢',
  styles: '◈',
};
/** Кнопка стиля, которую нельзя нажать: почему. */
const STYLE_BLOCKED_KEY: Record<Extract<StyleOfferState, { kind: 'blocked' }>['reason'], string> = {
  offline: 'shop.style.offline',
  corp: 'shop.style.no-corp',
  head: 'shop.style.head',
  owned: 'corp.style.owned',
};
/** Подсказка под вкладкой — только то, что карточки не говорят сами. */
const TAB_HINT: Partial<Record<ShopTab, string>> = {
  sovereigns: 'shop.hint.sovereigns',
};
const BLOCKED_KEY: Record<NonNullable<MetaStoreOfferView['blocked']>, string> = {
  owned: 'shop.blocked.owned',
  limit: 'shop.blocked.limit',
  season: 'shop.blocked.season',
};
const RARITY_KEY: Record<string, string> = {
  simple: 'rarity.simple',
  unique: 'rarity.unique',
  mythic: 'rarity.mythic',
  legendary: 'rarity.legendary',
};

const moduleName = (id: string): string => tData(data.modules[id]?.name ?? id);
const rarityOf = (id: string): string => data.modules[id]?.rarity ?? 'simple';
const materialName = (view: MetaEconomyView, id: string): string =>
  t(view.materials.find((m) => m.id === id)?.nameKey ?? `meta.material.${id}`);
/** Сумма в Суверенах: число и знак ◆ — та же иконка, что на плашке хаба. */
const sov = (n: number): string =>
  `<b class="sh-sov">${nfmt(n)}<i aria-hidden="true">${SOV_SVG}</i></b>`;
/** Строка локали со знаком ◆: знак рисуется той же иконкой, а не текстовым ромбом. */
const gem = (text: string): string =>
  esc(text).replace(/◆/g, `<i class="sh-gem" aria-hidden="true">${SOV_SVG}</i>`);
const off = (disabled: boolean): string => (disabled ? ' disabled' : '');

/** Одна карточка полки: пакет Суверенов, снабжение за рекламу или товар витрины. */
type Entry =
  | { kind: 'pack'; id: string; offer: CommerceOffer }
  | { kind: 'ad'; id: string; offer: CommerceOffer }
  | { kind: 'store'; id: string; offer: MetaStoreOfferView };

/** Всё, что нужно одной отрисовке. Чистый вход `shopHtml` / `shopDetailHtml`. */
export interface ShopState {
  view: MetaEconomyView | null;
  offers: readonly CommerceOffer[];
  guest: boolean;
  canSignIn: boolean;
  busy: boolean;
  tab: ShopTab;
  pick: string | undefined;
  confirm: boolean;
  status: { text: string; error: boolean } | null;
  /** Итог покупки — в карточке товара. */
  notice: { text: string; error: boolean } | null;
  /** Итог «Забрать ◆» — под самой кнопкой, а не в карточке выбранного срока. */
  dailyNotice: { text: string; error: boolean } | null;
  wide: boolean;
  warrants: number;
  now: number;
  /** Стили корпорации игрока: null — он не в корпорации, undefined — ответа нет. */
  corpStyle: MetaCorpStyleView | null | undefined;
}

function entries(s: ShopState): Entry[] {
  if (!s.view) return [];
  if (s.tab === 'sovereigns')
    return sovereignPacks(s.offers).map((offer) => ({
      kind: 'pack',
      id: offer.productId,
      offer,
    }));
  const list: Entry[] = shelf(s.view.store ?? [], s.tab).map((offer) => ({
    kind: 'store',
    id: offer.id,
    offer,
  }));
  const ad = s.tab === 'materials' ? adSupply(s.offers) : undefined;
  if (ad) list.unshift({ kind: 'ad', id: ad.productId, offer: ad });
  return list;
}

/** Открытый товар: выбранный игроком, иначе первый, который можно купить. Вкладка
 *  «Корпорация» выбирает стиль по его id, а не по id товара. */
export function pickedEntry(s: ShopState): Entry | undefined {
  const list = entries(s);
  const asked = list.find(
    (e) => e.id === s.pick || (e.kind === 'store' && !!s.pick && e.offer.corpStyle === s.pick),
  );
  const id =
    asked?.id ??
    defaultPick(list.map((e) => ({ id: e.id, open: e.kind === 'store' && !e.offer.blocked })));
  return list.find((e) => e.id === id);
}

function storeTitle(view: MetaEconomyView, o: MetaStoreOfferView): string {
  if (o.corpStyle) return t(corpStyleName(o.corpStyle));
  if (o.premiumDays) return t('shop.premium.days', { n: o.premiumDays });
  if (o.premiumSeason) {
    const season = view.seasons.find((x) => x.id === o.premiumSeason);
    return t('shop.season.name', { name: season ? t(season.nameKey) : o.premiumSeason });
  }
  if (o.modules?.length === 1) return moduleName(o.modules[0]!.defId);
  return t(`shop.offer.${o.id}.name`);
}

function entryTitle(view: MetaEconomyView, e: Entry): string {
  if (e.kind === 'pack') return '';
  if (e.kind === 'ad') return t('shop.ad.name');
  return storeTitle(view, e.offer);
}

function materialsSub(view: MetaEconomyView, materials: Record<string, number>): string {
  const rows = Object.entries(materials);
  if (rows.length === 1) return `${materialName(view, rows[0]![0])} ×${nfmt(rows[0]![1])}`;
  return t('shop.materials.kinds', { n: rows.length });
}

/** Стиль базы — зданиями III уровня, самыми полными рисунками: в карточке штаб, в описании
 *  все здания. */
function styleArtHtml(style: string, all: boolean): string {
  return (
    `<span class="sh-art sh-art-style" aria-hidden="true">` +
    (all ? CORP_ART_BUILDINGS : [CORP_HQ])
      .map((id) => corpArt(id, 3, style))
      .map((art) => (art ? `<img src="${art.src}" alt="">` : ''))
      .join('') +
    '</span>'
  );
}

function artHtml(e: Entry, detail = false): string {
  if (e.kind === 'store' && e.offer.corpStyle) return styleArtHtml(e.offer.corpStyle, detail);
  if (e.kind === 'pack') {
    const n = Math.min(5, 1 + Math.floor(Math.log2(packTotal(e.offer) / 100 + 1)));
    return `<span class="sh-art sh-art-sov" aria-hidden="true">${`<i>${SOV_SVG}</i>`.repeat(n)}</span>`;
  }
  const materials = e.kind === 'ad' ? e.offer.contents.materials : e.offer.materials;
  if (materials)
    return `<span class="sh-art" aria-hidden="true">${Object.keys(materials)
      .map((m) => `<i class="sh-mat m-${esc(m)}"></i>`)
      .join('')}</span>`;
  const store = e.offer as MetaStoreOfferView;
  if (store.modules) {
    const shown = store.modules.slice(0, 4);
    return (
      `<span class="sh-art" aria-hidden="true">${shown
        .map(
          (m) =>
            `<i class="sh-mi r-${rarityOf(m.defId)}${m.owned ? ' own' : ''}">${moduleIcon(m.defId)}</i>`,
        )
        .join('')}` +
      (store.modules.length > 4 ? `<small>+${store.modules.length - 4}</small>` : '') +
      '</span>'
    );
  }
  return `<span class="sh-art sh-art-prem" aria-hidden="true">★</span>`;
}

/** Стиль уже у корпорации — вместо цены сказано, применён он или куплен. */
function stylePill(s: ShopState, view: MetaEconomyView, o: MetaStoreOfferView): string {
  const st = styleOfferState(o, s.corpStyle, view.sovereigns ?? 0);
  if (st.kind === 'applied') return `<span class="sh-pill on">${t('corp.style.applied')}</span>`;
  if (st.kind === 'apply' || (st.kind === 'blocked' && st.reason === 'owned'))
    return `<span class="sh-pill on">${t('corp.style.owned')}</span>`;
  return '';
}

function cardHtml(
  s: ShopState,
  view: MetaEconomyView,
  e: Entry,
  picked: string | undefined,
): string {
  const selected = s.wide && picked === e.id;
  let tag = '';
  let sub = '';
  let price: string;
  if (e.kind === 'pack') {
    const c = e.offer.contents;
    if (c.bonusSovereigns)
      sub = t('shop.pack.gift', { base: nfmt(c.sovereigns ?? 0), bonus: nfmt(c.bonusSovereigns) });
    if (bestPack(sovereignPacks(s.offers)) === e.id) tag = t('shop.tag.best');
    price = `<span class="sh-pill">${t('shop.soon')}</span>`;
  } else if (e.kind === 'ad') {
    const ads = view.ads;
    if (ads) sub = t('shop.ad.left', { n: Math.max(0, ads.limit - ads.used), m: ads.limit });
    price = `<span class="sh-pill free">${t('shop.free')}</span>`;
  } else {
    const o = e.offer;
    if (o.modules && o.modules.length > 1) sub = t('shop.modules.count', { n: o.modules.length });
    else if (o.modules) sub = t(RARITY_KEY[rarityOf(o.modules[0]!.defId)] ?? 'rarity.simple');
    else if (o.materials) sub = materialsSub(view, o.materials);
    else if (o.premiumDays) {
      const saving = premiumSavings(shelf(view.store ?? [], 'premium'))[o.id];
      if (saving) sub = t('shop.premium.saving', { n: saving });
    } else if (o.premiumSeason) sub = t('shop.season.track');
    else if (o.corpStyle) sub = t('shop.style.sub');
    const discount = discountOf(o);
    if (discount) tag = t('shop.discount', { n: discount });
    price =
      (o.corpStyle ? stylePill(s, view, o) : '') ||
      (o.blocked
        ? `<span class="sh-pill">${t(BLOCKED_KEY[o.blocked])}</span>`
        : (o.fullPrice && o.fullPrice > o.price ? `<s>${nfmt(o.fullPrice)}</s>` : '') +
          sov(o.price));
  }
  const title =
    e.kind === 'pack'
      ? `<span class="sh-nm sh-gold">${sov(packTotal(e.offer))}</span>`
      : `<span class="sh-nm">${esc(entryTitle(view, e))}</span>`;
  const dim = e.kind === 'store' && e.offer.blocked ? ' off' : '';
  return (
    `<button type="button" class="sh-card${dim}" data-sh-pick="${esc(e.id)}" aria-pressed="${selected}">` +
    (tag ? `<span class="sh-tag">${esc(tag)}</span>` : '') +
    artHtml(e) +
    title +
    (sub ? `<span class="sh-sub">${esc(sub)}</span>` : '') +
    `<span class="sh-price">${price}</span></button>`
  );
}

/** Статус премиума над его полкой: срок, бонусы и сегодняшние ◆. */
function premiumBoxHtml(s: ShopState, view: MetaEconomyView): string {
  const days = premiumDaysLeft(view.premiumUntil, s.now);
  const daily = view.premiumDaily;
  const perks = view.premiumPerks;
  const list = [
    perks?.dailySovereigns ? t('shop.premium.perk.daily', { n: perks.dailySovereigns }) : '',
    perks?.extraDailyAds ? t('shop.premium.perk.ads', { n: perks.extraDailyAds }) : '',
    t('shop.premium.perk.chat'),
    t('shop.premium.perk.frame'),
  ].filter(Boolean);
  return (
    `<section class="sh-prem"><div class="sh-prem-h"><b>★ ${t('shop.premium.title')}</b>` +
    `<span class="sh-pill${days ? ' on' : ''}">${days ? t('shop.premium.active', { n: days }) : t('shop.premium.off')}</span></div>` +
    `<ul>${list.map((p) => `<li>${gem(p)}</li>`).join('')}</ul>` +
    (daily
      ? `<button type="button" class="btn-main" data-sh-daily${off(daily.claimed || s.busy)}>${gem(daily.claimed ? t('shop.premium.claimed') : t('shop.premium.claim', { n: daily.amount }))}</button>`
      : '') +
    statusHtml(s.dailyNotice) +
    `<p class="sh-note">${t('shop.premium.note')}</p></section>`
  );
}

function guestHtml(s: ShopState): string {
  return (
    `<section class="sh-guest"><div><b>${t('shop.guest.title')}</b><p>${t('shop.guest.body')}</p></div>` +
    (s.canSignIn
      ? `<button type="button" class="btn-main" data-sh-sign-in>${t('shop.guest.sign-in')}</button>`
      : '') +
    '</section>'
  );
}

function statusHtml(st: { text: string; error: boolean } | null, retry = false): string {
  if (!st?.text) return '';
  return (
    `<p class="sh-status${st.error ? ' error' : ''}" role="status">${esc(st.text)}` +
    (retry
      ? ` <button type="button" class="btn-quiet" data-sh-refresh>${t('shop.retry')}</button>`
      : '') +
    '</p>'
  );
}

/** Вкладка целиком: шапка с кошельком, разделы, полка и на широкой вкладке карточка рядом. */
export function shopHtml(s: ShopState): string {
  const view = s.view;
  const days = view ? premiumDaysLeft(view.premiumUntil, s.now) : 0;
  const wallet =
    `<div class="sh-wallet">` +
    (view
      ? `<span class="sh-cur sov" title="${esc(t('hub.sovereigns'))}"><i aria-hidden="true">${SOV_SVG}</i>${nfmt(view.sovereigns ?? 0)}</span>`
      : '') +
    `<span class="sh-cur war" title="${esc(t('hub.wallet.auction', { n: s.warrants }))}"><i aria-hidden="true">⌖</i>${nfmt(s.warrants)}</span>` +
    (days ? `<span class="sh-cur prem">★ ${t('shop.premium.badge')}</span>` : '') +
    '</div>';
  const tabs = SHOP_TABS.map(
    (id) =>
      `<button type="button" class="sh-tab" role="tab" data-sh-tab="${id}" aria-selected="${s.tab === id}">` +
      `<span class="sh-tab-ic" aria-hidden="true">${TAB_ICON[id]}</span>${t(TAB_KEY[id])}</button>`,
  ).join('');
  const head = `<div class="sh-head"><h2>${t('shop.title')}</h2>${wallet}</div>`;
  if (s.guest || !view)
    return head + statusHtml(s.status, s.status?.error === true) + (s.guest ? guestHtml(s) : '');
  const picked = pickedEntry(s)?.id;
  const hint = TAB_HINT[s.tab];
  const cards = entries(s)
    .map((e) => cardHtml(s, view, e, picked))
    .join('');
  return (
    head +
    statusHtml(s.status, s.status?.error === true) +
    `<div class="sh-main"><nav class="sh-tabs" role="tablist" aria-label="${esc(t('shop.tabs'))}">${tabs}</nav>` +
    `<div class="sh-list" role="tabpanel">` +
    (s.tab === 'premium' ? premiumBoxHtml(s, view) : '') +
    (hint ? `<p class="sh-hint">${t(hint)}</p>` : '') +
    `<div class="sh-grid">${cards}</div></div>` +
    (s.wide ? `<aside class="sh-detail">${shopDetailHtml(s)}</aside>` : '') +
    '</div>'
  );
}

function line(label: string, value: string): string {
  return `<div class="sh-line"><span>${esc(label)}</span><b>${value}</b></div>`;
}

/** Кнопка покупки товара витрины с подтверждением в два нажатия. */
function buyHtml(
  s: ShopState,
  view: MetaEconomyView,
  o: MetaStoreOfferView,
  title: string,
): string {
  const state = buyState(o, view.sovereigns ?? 0);
  if (state.kind === 'blocked')
    return `<button type="button" class="btn-main" disabled>${t(BLOCKED_KEY[state.reason])}</button>`;
  return payHtml(s, o, title, state.kind === 'short' ? state.lack : 0);
}

/** Кнопка стиля базы: купить (глава), применить купленный или почему нельзя. */
function styleHtml(
  s: ShopState,
  view: MetaEconomyView,
  o: MetaStoreOfferView,
  title: string,
): string {
  const state = styleOfferState(o, s.corpStyle, view.sovereigns ?? 0);
  if (state.kind === 'blocked')
    return `<button type="button" class="btn-main" disabled>${t(STYLE_BLOCKED_KEY[state.reason])}</button>`;
  if (state.kind === 'applied')
    return `<button type="button" class="btn-main" disabled>${t('corp.style.applied')}</button>`;
  if (state.kind === 'apply')
    return `<button type="button" class="btn-main" data-sh-apply="${esc(o.corpStyle ?? '')}"${off(s.busy)}>${t('corp.style.apply')}</button>`;
  return payHtml(s, o, title, state.kind === 'short' ? state.lack : 0);
}

/** Оплата ◆: недостача с дорогой к Суверенам, подтверждение или «Купить». */
function payHtml(s: ShopState, o: MetaStoreOfferView, title: string, lack: number): string {
  if (lack > 0)
    return (
      `<button type="button" class="btn-main" disabled>${t('shop.short')} ${sov(lack)}</button>` +
      `<button type="button" class="btn-second" data-sh-tab="sovereigns">${t('shop.topup')}</button>`
    );
  if (s.confirm)
    return (
      `<div class="sh-confirm" role="group"><p>${gem(t('shop.confirm', { item: title, n: nfmt(o.price) }))}</p>` +
      `<div class="sh-row2"><button type="button" class="btn-main" data-sh-buy-do="${esc(o.id)}"${off(s.busy)}>${t('shop.confirm.ok')}</button>` +
      `<button type="button" class="btn-quiet" data-sh-cancel>${t('shop.cancel')}</button></div></div>`
    );
  return `<button type="button" class="btn-main" data-sh-buy="${esc(o.id)}"${off(s.busy)}>${t('shop.buy')} ${sov(o.price)}</button>`;
}

/** Карточка открытого товара: рядом со списком на ПК, в шторке на телефоне. */
export function shopDetailHtml(s: ShopState): string {
  const view = s.view;
  const e = view ? pickedEntry(s) : undefined;
  if (!view || !e) return '';
  let title: string;
  let lines = '';
  let note = '';
  let action: string;
  if (e.kind === 'pack') {
    const c = e.offer.contents;
    title = t('shop.pack.title', { n: nfmt(packTotal(e.offer)), count: packTotal(e.offer) });
    lines =
      line(t('shop.tab.sovereigns'), nfmt(c.sovereigns ?? 0)) +
      (c.bonusSovereigns ? line(t('shop.detail.gift'), `+${nfmt(c.bonusSovereigns)}`) : '') +
      line(t('shop.detail.after'), sov((view.sovereigns ?? 0) + packTotal(e.offer)));
    note = t('shop.pay.note');
    action = `<button type="button" class="btn-main" disabled>${t('shop.pay.soon')}</button>`;
  } else if (e.kind === 'ad') {
    title = t('shop.ad.name');
    lines = Object.entries(e.offer.contents.materials ?? {})
      .map(([m, q]) => line(materialName(view, m), `×${nfmt(q)}`))
      .join('');
    if (view.ads)
      lines += line(
        t('shop.ad.today'),
        t('shop.ad.count', { n: Math.max(0, view.ads.limit - view.ads.used), m: view.ads.limit }),
      );
    note = t('shop.ad.note');
    action = `<button type="button" class="btn-main" disabled>${t('shop.ad.unavailable')}</button>`;
  } else {
    const o = e.offer;
    title = storeTitle(view, o);
    if (o.premiumDays) {
      const running = premiumDaysLeft(view.premiumUntil, s.now) > 0;
      lines = line(t('shop.premium.term'), esc(t('shop.premium.days', { n: o.premiumDays })));
      note = t(running ? 'shop.premium.extend' : 'shop.premium.no-renew');
    } else if (o.premiumSeason) {
      const season = view.seasons.find((x) => x.id === o.premiumSeason);
      if (season) lines = line(t('shop.season.levels'), nfmt(season.levels));
      note = t('shop.season.note');
    } else if (o.modules) {
      lines = o.modules
        .map(
          (m) =>
            `<div class="sh-line sh-mline r-${rarityOf(m.defId)}"><span><i class="sh-mi" aria-hidden="true">${moduleIcon(m.defId)}</i>${esc(moduleName(m.defId))}</span>` +
            `<b>${m.owned ? t('shop.owned') : esc(t(RARITY_KEY[rarityOf(m.defId)] ?? 'rarity.simple'))}</b></div>`,
        )
        .join('');
      if (o.fullPrice && o.fullPrice > o.price)
        lines += line(t('shop.detail.separately'), `<s>${nfmt(o.fullPrice)}</s>`);
      note =
        (o.modules.some((m) => m.owned) && !o.blocked ? `${t('shop.modules.owned-note')} ` : '') +
        t('shop.modules.note');
    } else if (o.materials) {
      lines = Object.entries(o.materials)
        .map(([m, q]) => line(materialName(view, m), `×${nfmt(q)}`))
        .join('');
      const cover = recipeCoverage(o.materials, view.recipes);
      if (cover.length)
        lines +=
          `<h4 class="sh-sec">${t('shop.coverage')}</h4>` +
          cover.map((c) => line(moduleName(c.defId), `${c.percent}%`)).join('');
      note = t('shop.materials.note');
    } else if (o.corpStyle) note = t('corp.style.note');
    action = o.corpStyle ? styleHtml(s, view, o, title) : buyHtml(s, view, o, title);
  }
  return (
    `<div class="sh-dt"><h3 id="sh-dt-title">${e.kind === 'pack' ? sov(packTotal(e.offer)) : esc(title)}</h3>` +
    statusHtml(s.notice) +
    artHtml(e, true) +
    `<div class="sh-lines">${lines}</div>` +
    (note ? `<p class="sh-note">${esc(note)}</p>` : '') +
    `<div class="sh-acts">${action}</div></div>`
  );
}

/** Что вкладке нужно от хаба. */
export interface ShopHost {
  /** Контейнер вкладки (`#hp-shop`): рисуется и ловит нажатия здесь. */
  root(): HTMLElement;
  /** Шторка телефона (`#shop-sheet`) вне прокрутки хаба. */
  sheet(): HTMLElement;
  /** Вкладка слишком узкая для карточки рядом со списком. */
  narrow(): boolean;
  authorizedBase(): Promise<MetaSession | null>;
  canSignIn(): boolean;
  signIn(): void;
  /** Кошелёк аукциона ⌖ — последний известный хабу. */
  warrants(): number;
  now(): number;
  /** Пришёл свежий ответ аккаунта (или его не стало): кошелёк хаба и цвет чата следуют. */
  accountChanged(view: MetaEconomyView | null): void;
  /** После подтверждённой покупки: Арсенал и аукцион перечитываются. */
  changed?(): Promise<void>;
  requestId?(): string;
}

/** Собрать вкладку. Зовётся один раз при загрузке: вешает делегатов нажатий. */
export function initShop(host: ShopHost): {
  refresh(): Promise<void>;
  /** Тихо перечитать аккаунт ради кошелька хаба (вкладка может быть скрыта). */
  sync(): Promise<void>;
  /** Открыть раздел и, если задан, товар (хаб показывает вкладку сам). */
  show(tab: ShopTab, pick?: string): void;
  sovereigns(): number | null;
  relayout(): void;
  isOpen(): boolean;
  close(): void;
} {
  let tab: ShopTab = 'sovereigns';
  let pick: string | undefined;
  let confirm = false;
  let sheetOpen = false;
  /** The sheet is on screen: open AND there is a loaded item to show in it. */
  let sheetShown = false;
  let wide = !host.narrow();
  let returnTo: string | null = null;
  /** Где показать итог команды: в карточке товара или под кнопкой «Забрать»; false — нигде. */
  let acting: 'detail' | 'daily' | false = false;
  let lastView: MetaEconomyView | null = null;

  const client = createMetaEconomyClient({
    authorizedBase: () => host.authorizedBase(),
    paint: () => paint(),
    // Нарисовать до того, как принять ответ: битая вложенность не заменит рабочий вид.
    accept: (view, offers) => {
      void shopHtml({ ...state(), view, offers, wide: true });
      lastView = view; // the hub wallet reads the balance before the client takes the answer
      host.accountChanged(view);
    },
    ...(host.changed ? { changed: () => host.changed!() } : {}),
    ...(host.requestId ? { requestId: () => host.requestId!() } : {}),
    corpStyle: true,
  });

  const readStatus = (st: MetaEconomyStatus): ShopState['status'] => {
    if (st.kind === 'loading' && !lastView) return { text: t('shop.loading'), error: false };
    if (st.kind === 'unavailable') return { text: t('shop.unavailable'), error: true };
    return null;
  };
  const actionNotice = (st: MetaEconomyStatus): ShopState['notice'] => {
    if (!acting) return null;
    if (st.kind === 'pending') return { text: t('shop.pending'), error: false };
    if (st.kind === 'done') return st.key ? { text: t(st.key), error: false } : null;
    if (st.kind === 'failed') return { text: t(st.key ?? 'shop.failed'), error: true };
    return null;
  };

  function state(): ShopState {
    const st = client.status();
    const live = client.view();
    if (live) lastView = live;
    else if (!client.busy()) lastView = null;
    const guest = st.kind === 'guest';
    return {
      view: guest ? null : (live ?? lastView),
      offers: client.offers(),
      guest,
      canSignIn: host.canSignIn(),
      busy: client.busy(),
      tab,
      pick,
      confirm,
      status: readStatus(st),
      notice: acting === 'detail' ? actionNotice(st) : null,
      dailyNotice: acting === 'daily' ? actionNotice(st) : null,
      wide,
      warrants: host.warrants(),
      now: host.now(),
      corpStyle: client.corpStyle(),
    };
  }

  function paint(): void {
    const s = state();
    const root = host.root();
    const list = root.querySelector?.('.sh-list');
    const keep = list?.scrollTop ?? 0;
    root.innerHTML = shopHtml(s);
    const fresh = root.querySelector?.('.sh-list');
    if (fresh) fresh.scrollTop = keep;
    // An item asked for before the account loaded waits for it instead of an empty sheet.
    sheetShown = sheetOpen && !!s.view && !!pickedEntry(s);
    const sheet = host.sheet();
    sheet.innerHTML = sheetShown
      ? `<div class="ar-scrim" data-sh-close></div><div class="ar-sheet" role="dialog" aria-modal="true" aria-labelledby="sh-dt-title">` +
        `<div class="ar-sheet-top"><button type="button" class="btn-x" data-sh-close aria-label="${esc(t('shop.close'))}">✕</button></div>` +
        `<div class="ar-sheet-body">${shopDetailHtml(s)}</div></div>`
      : '';
    sheet.classList.toggle('open', sheetShown);
  }

  const detailBox = (): Element | null | undefined =>
    sheetShown
      ? host.sheet().querySelector?.('.ar-sheet-body')
      : host.root().querySelector?.('.sh-detail');

  function open(id: string, from?: string): void {
    pick = id;
    confirm = false;
    acting = false;
    if (!wide && !sheetOpen) {
      sheetOpen = true;
      returnTo = from ?? null;
    }
    paint();
    const box = detailBox();
    if (box) box.scrollTop = 0;
    if (sheetShown)
      host.sheet().querySelector?.<HTMLElement>('.btn-x')?.focus({ preventScroll: true });
  }

  function close(): void {
    if (!sheetOpen) return;
    sheetOpen = false;
    sheetShown = false;
    confirm = false;
    acting = false;
    paint();
    if (returnTo)
      host.root().querySelector?.<HTMLElement>(returnTo)?.focus({ preventScroll: true });
    returnTo = null;
  }

  function act(
    path: string,
    body: Record<string, unknown>,
    successKey: string,
    at: 'detail' | 'daily',
  ): void {
    confirm = false;
    acting = at;
    detach('магазин: покупка', client.mutate(path, body, successKey));
  }

  function onClick(ev: Event): void {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('button, [data-sh-close]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    const d = el.dataset;
    if (d.shClose !== undefined) return close();
    if (d.shTab) {
      tab = (SHOP_TABS as readonly string[]).includes(d.shTab) ? (d.shTab as ShopTab) : tab;
      pick = undefined;
      confirm = false;
      acting = false;
      sheetOpen = false;
      return paint();
    }
    if (d.shPick) return open(d.shPick, `[data-sh-pick="${d.shPick.replace(/["\\]/g, '\\$&')}"]`);
    if (d.shSignIn !== undefined) return host.signIn();
    if (d.shRefresh !== undefined) {
      detach('магазин: обновление', client.refresh());
      return;
    }
    if (d.shCancel !== undefined) {
      confirm = false;
      return paint();
    }
    const view = client.view();
    if (client.busy() || !view) return;
    // Стиль базы покупает глава для корпорации — его кнопку решает не `buyState`.
    const canBuy = (o: MetaStoreOfferView): boolean =>
      (o.corpStyle
        ? styleOfferState(o, client.corpStyle(), view.sovereigns ?? 0)
        : buyState(o, view.sovereigns ?? 0)
      ).kind === 'buy';
    if (d.shDaily !== undefined) {
      if (!view.premiumDaily || view.premiumDaily.claimed) return;
      return act('/meta-economy/premium/daily', {}, 'shop.premium.daily-done', 'daily');
    }
    if (d.shBuy) {
      const o = view.store?.find((x) => x.id === d.shBuy);
      if (!o || !canBuy(o)) return;
      pick = o.id;
      confirm = true;
      acting = false;
      paint();
      detailBox()?.querySelector?.('.sh-confirm')?.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    if (d.shBuyDo) {
      const o = view.store?.find((x) => x.id === d.shBuyDo);
      if (!o || !confirm || pick !== o.id || !canBuy(o)) return;
      if (o.corpStyle)
        return act('/meta-economy/corp-style/buy', { offerId: o.id }, 'shop.done.style', 'detail');
      const done =
        o.premiumDays || o.premiumSeason
          ? 'shop.done.premium'
          : o.modules
            ? 'shop.done.modules'
            : 'shop.done.materials';
      return act('/meta-economy/store/buy', { offerId: o.id }, done, 'detail');
    }
    if (d.shApply) {
      const o = view.store?.find((x) => x.corpStyle === d.shApply);
      if (!o || styleOfferState(o, client.corpStyle(), view.sovereigns ?? 0).kind !== 'apply')
        return;
      return act(
        '/meta-economy/corp-style/apply',
        { styleId: d.shApply },
        'shop.done.style-applied',
        'detail',
      );
    }
  }

  host.root().addEventListener('click', onClick);
  host.sheet().addEventListener('click', onClick);

  const refresh = async (): Promise<void> => {
    acting = false;
    await client.refresh();
    host.accountChanged(client.view());
  };

  return {
    refresh,
    sync: refresh,
    show: (next, id) => {
      tab = next;
      pick = id;
      confirm = false;
      acting = false;
      sheetOpen = !!id && !wide;
      paint();
    },
    sovereigns: () => client.view()?.sovereigns ?? lastView?.sovereigns ?? null,
    relayout: () => {
      const next = !host.narrow();
      if (next === wide) return;
      wide = next;
      if (wide) sheetOpen = false;
      paint();
    },
    isOpen: () => sheetShown,
    close,
  };
}
