/**
 * ПРИКАЗЫ ЭСКАДРЫ ПЛИТКАМИ — тот же вид, что у ряда команд флота (заказ владельца
 * 2026-11-09: «кнопки управления как для флота»): значок над подписью, сетка в три
 * колонки, на ПК под заголовком «Приказы». Плитки стоят в карточке эскадры и шлют те же
 * `data-act`, что прежние кнопки, поэтому обработчик у приказа один (`sidePanel.ts`).
 *
 * Телефон: свёрнутый лист показывает ряд прямо под шапкой. Больше трёх приказов — видны
 * два первых и «Ещё» (`decisions/wingOrderRow.ts`); «Ещё» и раскрытый лист открывают
 * остальные. Что открыто «Ещё», помнится по эскадре или вылету: карточка пересобирается
 * на каждом приказе, и класс на узле не пережил бы пересборку.
 */
import { t } from '../../localization/runtime';
import { wingOrderRow } from '../../decisions/wingOrderRow';
import { esc } from './format';
import { skinIcon, type HoloIcon } from './holographicIcons';

/** Один приказ ряда. `glyph` — значок простой обложки, `icon` — голографической. */
export interface WingOrder {
  act: string;
  arg: string;
  icon: HoloIcon;
  glyph: string;
  label: string;
  /** Переключатель включён (патруль держится) — плитка горит, как «Бомбардировка» флота. */
  on?: boolean;
}

/** Вид приказа: значок голографической обложки, значок простой, ключ подписи. Подпись — без
 *  значка, как у команд флота: значок стоит над ней отдельно. */
const LOOK = {
  strike: ['crosshair', '✳', 'cmd.wing.strike'],
  patrol: ['circle-dashed', '◎', 'cmd.wing.patrol'],
  relocate: ['arrows-left-right', '⇄', 'cmd.wing.relocate'],
  load: ['arrow-line-up', '↑', 'cmd.wing.load'],
  unload: ['arrow-line-down', '↓', 'cmd.wing.unload'],
  split: ['arrows-split', '⊟', 'cmd.wing.split'],
  merge: ['arrows-merge', '⛬', 'cmd.merge'],
  keep: ['push-pin', '⟳', 'cmd.wing.keep'],
  recall: ['arrow-u-up-left', '↩', 'cmd.wing.recall'],
  // Ракетная эскадра (missiles-roadmap): одна ракета или залп всей эскадрой.
  launch: ['paper-plane-tilt', '➚', 'side.missile.launch'],
  salvo: ['lightning', '⁂', 'side.missile.salvo'],
} as const satisfies Record<string, readonly [HoloIcon, string, string]>;

export type WingOrderKind = keyof typeof LOOK;

/** Приказ `act` с адресом `arg` в виде `kind`; `on` — у переключателя, `vars` — числа подписи. */
export function wingOrder(
  kind: WingOrderKind,
  act: string,
  arg: string,
  on?: boolean,
  vars?: Record<string, number>,
): WingOrder {
  const [icon, glyph, key] = LOOK[kind];
  return { act, arg, icon, glyph, label: t(key, vars), ...(on === undefined ? {} : { on }) };
}

/** Какой ряд раскрыт кнопкой «Ещё»: id эскадры или вылета. */
let moreFor: string | null = null;

/** «Ещё»: открыть остальные приказы ряда `key`, повторное нажатие — закрыть. */
export function toggleWingMore(key: string): void {
  moreFor = moreFor === key ? null : key;
}

function tile(o: WingOrder, mark: '' | 'extra' | 'wing-more'): string {
  const cls = `btn-second${o.on ? ' on' : ''}${mark ? ` ${mark}` : ''}`;
  const pressed = o.on === undefined ? '' : ` aria-pressed="${o.on}"`;
  return (
    `<button type="button" class="${cls}" data-act="${esc(o.act)}" data-arg="${esc(o.arg)}" title="${esc(o.label)}"${pressed}>` +
    `<span class="ci" aria-hidden="true">${skinIcon(o.icon, o.glyph)}</span><span class="cl">${esc(o.label)}</span></button>`
  );
}

/** Ряд приказов карточки; `key` — id эскадры или вылета, для кнопки «Ещё». Пустые места
 *  (`false`, `null`) — приказы, которых сейчас нет. Без приказов — ''. */
export function wingOrdersHtml(list: readonly (WingOrder | false | null)[], key: string): string {
  const orders = list.filter((o): o is WingOrder => !!o);
  if (orders.length === 0) return '';
  const row = wingOrderRow(orders.length);
  const open = row.more && moreFor === key;
  const tiles = orders.map((o, i) => tile(o, i >= row.main ? 'extra' : '')).join('');
  const more = row.more
    ? tile(
        {
          act: 'wingmore',
          arg: key,
          icon: 'dots-three',
          glyph: '☰',
          label: t('cmd.more'),
          on: open,
        },
        'wing-more',
      )
    : '';
  return (
    `<div class="row aloft-acts wing-orders${open ? ' open' : ''}">` +
    `<div class="fc-title wing-orders-title"><b>${esc(t('fleet.console.orders'))}</b></div>` +
    tiles +
    more +
    `</div>`
  );
}
