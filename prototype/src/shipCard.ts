/**
 * Карточка корабля — разметка (заказ владельца 2026-09-24: «когда выбираешь карточку
 * корабля, там должно быть видно, какие модули надеты. Как в Stellaris примерно»).
 *
 * Модель — `decisions/shipCard.ts`; здесь только вид. Язык тот же, что у конструктора
 * (`shipyard.ts`): отсеки `cn-bay` с тем же значком модуля и строки характеристик
 * «корпус → с оснащением» — корабль в карточке выглядит так же, как когда его собирали.
 *
 * 1. **Сверху — корпус и сколько их в стеке**, под ним корпус стека в процентах.
 * 2. **Отсеки — по типам, пустые видны пустыми.** Надетый модуль — значок, имя, звёзды,
 *    редкость и что он даёт одному кораблю. Лишний отсек (модуль сверх ёмкости) помечен.
 * 3. **Характеристики — одного корабля**, с приростом от оснащения.
 * 4. **Справочник корпуса — отдельной кнопкой.** Раньше тап по кораблю открывал сразу
 *    справочник, где про надетое не было ни слова.
 */
import { t } from '../../localization/runtime';
import { esc } from './format';
import { moduleIcon, SLOT_ICON, SLOT_KEY } from './moduleIcons';
import type { ShipCardModel, ShipCardStat } from '../../decisions/shipCard';
import { unitDamageHtml } from './unitDamageView';

/** Чем карточка рисует корпус и модуль. */
export interface ShipCardHooks {
  /** Арт корпуса (пусто — арта нет). */
  portrait: (unit: string) => string;
  /** Значок корпуса в цвете стороны. */
  icon: (unit: string) => string;
  unitName: (unit: string) => string;
  moduleName: (module: string) => string;
}

/** Подпись характеристики. */
const STAT_LABEL: Record<string, string> = {
  attack: 'loadout.stat.attack',
  defense: 'loadout.stat.defense',
  hp: 'loadout.stat.hp',
  shield: 'loadout.stat.shield',
  shieldRegen: 'loadout.stat.shield-regen',
  speed: 'loadout.stat.speed',
  radarRange: 'loadout.stat.radar',
  cargoCapacity: 'loadout.stat.cargo',
  shuttleBay: 'loadout.stat.bay',
  pointDefense: 'shipcard.stat.pd',
  siegeDamage: 'loadout.stat.siege',
};

/** Значение для глаза: доля восстановления щита — процентом в час, прочее — до десятых. */
function value(stat: string, v: number): string {
  if (stat === 'shieldRegen') return t('loadout.stat.share-per-hour', { n: Math.round(v * 1000) / 10 });
  return String(Math.round(v * 10) / 10);
}

function signed(stat: string, v: number): string {
  return `${v > 0 ? '+' : '−'}${value(stat, Math.abs(v))}`;
}

function statRow(s: ShipCardStat, max: number): string {
  const basePct = max > 0 ? Math.min(100, (Math.max(0, s.base) / max) * 100) : 0;
  const deltaPct = max > 0 ? Math.min(100 - basePct, (Math.max(0, s.delta) / max) * 100) : 0;
  const val =
    Math.abs(s.delta) > 1e-9
      ? `${value(s.stat, s.base)} <span class="dim">→</span> <b>${value(s.stat, s.effective)}</b> <span class="cn-up">${signed(s.stat, s.delta)}</span>`
      : `<b>${value(s.stat, s.effective)}</b>`;
  return (
    `<div class="cn-stat"><div class="cn-srow"><span class="cn-snm">${esc(t(STAT_LABEL[s.stat] ?? s.stat))}</span><span class="cn-sval">${val}</span></div>` +
    `<div class="cn-strack"><span class="cn-sbar" style="width:${basePct}%"></span><span class="cn-sdelta" style="width:${deltaPct}%"></span></div></div>`
  );
}

/** Карточка стека целиком (правила 1–4). `hpPct` — корпус стека, `fleetName` — чей он. */
export function shipCardHtml(
  m: ShipCardModel,
  hooks: ShipCardHooks,
  opts: { hpPct: number; fleetName?: string },
): string {
  const portrait = hooks.portrait(m.unit);
  const hp = Math.max(0, Math.min(100, Math.round(opts.hpPct)));
  const head =
    `<div class="cn-hull sc-head${portrait ? ' with-art' : ''}">${portrait}<div class="cn-hull-info">` +
    `<div class="cn-hic">${hooks.icon(m.unit)}</div><div><div class="cn-hn">${esc(hooks.unitName(m.unit))} <span class="sc-n">×${m.count}</span></div>` +
    (opts.fleetName ? `<div class="cn-hm">${esc(opts.fleetName)}</div>` : '') +
    `</div></div></div>` +
    `<div class="sc-hp"><span>${t('loadout.stat.hp')}</span><span class="sc-hpbar${hp < 30 ? ' low' : ''}"><i style="width:${hp}%"></i></span><b>${hp}%</b></div>`;
  const filled = m.bays.filter((b) => b.module).length;
  const bays = m.bays
    .map((b) => {
      const slot = `<div class="cn-bt">${t(SLOT_KEY[b.type] ?? b.type)}${b.extra ? ` · ${t('shipcard.extra')}` : ''}</div>`;
      if (!b.module) {
        return `<div class="cn-bay empty"><div class="cn-bic">${SLOT_ICON[b.type] ?? '＋'}</div><div>${slot}<div class="cn-bn">${t('shipcard.empty')}</div></div></div>`;
      }
      const stars = b.stars > 0 ? ` <span class="sc-stars" aria-label="${t('shipcard.stars', { n: b.stars })}">${'★'.repeat(b.stars)}</span>` : '';
      const rarity = b.rarity ? ` <span class="sc-rar sc-rar-${esc(b.rarity)}">${esc(t(`rarity.${b.rarity}`))}</span>` : '';
      const effect = Object.entries(b.effect)
        .map(([k, v]) => `${signed(k, v)} ${esc(t(STAT_LABEL[k] ?? k))}`)
        .join(' · ');
      return (
        `<div class="cn-bay filled sc-bay${b.extra ? ' sc-extra' : ''}"><div class="cn-bic">${moduleIcon(b.module)}</div>` +
        `<div>${slot}<div class="cn-bn">${esc(hooks.moduleName(b.module))}${stars}${rarity}</div></div>` +
        (effect ? `<div class="cn-bd">${effect}</div>` : '') +
        `</div>`
      );
    })
    .join('');
  const loadout = m.bays.length
    ? `<div class="sc-sec">${t('shipcard.loadout', { n: filled, m: m.bays.length })}</div>${bays}`
    : `<div class="sc-sec">${t('shipcard.loadout.none')}</div>`;
  const max = Math.max(1, ...m.stats.map((s) => Math.max(s.base, s.effective)));
  const stats = `<div class="sc-sec">${t('shipcard.stats')}</div>${m.stats.map((s) => statRow(s, max)).join('')}`;
  return (
    `<div class="sc">${head}${loadout}${stats}${unitDamageHtml(m.damage)}` +
    `<button type="button" class="sc-codex" data-codex="u:${esc(m.unit)}">${t('shipcard.codex')}</button></div>`
  );
}
