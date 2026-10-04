/**
 * Окно «Связь с союзником» (глава IV, `docs/sector-zero-map-concepts.md` §6.5, кирпич
 * PVR-7.5). Порядок, как в дизайне: **открыть связь → выбрать приказ → указать цель на
 * карте**. Выбор приказа взводит прицел у хозяина (следующий тап по карте — цель), а окно
 * закрывается, чтобы карта была видна. Карточка операции показывает вид, цель и шаг
 * операции — тем же планом, по которому ходит бот союзника (`decisions/allyPanel.ts`), —
 * и даёт найти силы союзника и отменить приказ.
 *
 * Глава VI (PVR-8.5): когда главные силы врага видимо идут к найденным докам, союзник
 * предлагает их охранять (§8.7, `refugeGuardOffer`) — одна кнопка вместо прицела на карте.
 *
 * Та же форма, что у окна торговца: разметка чистая (`allyBoxHtml`), хозяина окно трогает
 * только через крючки `AllyScreenHost`.
 */
import type { Action, Fleet, GameData, GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { esc } from './format';
import { allyCancel, allyOrder } from '../../decisions/actions';
import { refugeGuardOffer } from '../../decisions/refugeThreat';
import {
  ALLY_ORDER_KINDS,
  allyPanelView,
  type AllyOrderKind,
  type AllyPanelView,
} from '../../decisions/allyPanel';

/** Эмблема союзного отряда — один знак на кнопке, в окне и на карте. */
export const ALLY_EMBLEM = '⬡';

/** Строка шага операции: «Сбор: ожидаем десант», «Выдвижение», «Нужна помощь: …». */
function stepLine(v: AllyPanelView): string {
  const step = t(`ally.step.${v.step}`);
  return v.reason ? `${step}: ${t(`ally.reason.${v.reason}`)}` : step;
}

/** Всё окно разметкой. `targetName` — подпись цели (имя провинции или флота); `offer` —
 *  предложение союзника охранять место эвакуации (глава VI), `null` — его нет. */
export function allyBoxHtml(
  v: AllyPanelView,
  targetName: (planet?: string, fleet?: string) => string,
  armed: AllyOrderKind | null,
  status: string,
  offer: { at: string } | null = null,
): string {
  const op = v.op;
  const card = op
    ? `<div class="al-op${op.source === 'own' ? ' own' : ''}">` +
      `<div class="al-op-head"><b>${esc(t(`ally.kind.${op.kind}`))}</b> <span class="al-target">${esc(targetName(op.planet, op.fleet))}</span></div>` +
      (op.source === 'own' ? `<p class="al-own">${esc(t('ally.own-task'))}</p>` : '') +
      `<p class="al-step al-${v.step}" role="status">${esc(stepLine(v))}</p>` +
      `<div class="al-op-acts">` +
      (v.group.length > 0
        ? `<button type="button" class="al-act" data-ally="find">${esc(t('ally.find'))}</button>`
        : '') +
      (op.source === 'order'
        ? `<button type="button" class="al-act" data-ally="cancel">${esc(t('ally.cancel'))}</button>`
        : '') +
      `</div></div>`
    : `<p class="al-idle">${esc(v.alive ? t('ally.idle') : stepLine(v))}</p>`;
  const offerHtml =
    offer && v.alive
      ? `<div class="al-op al-offer"><p class="al-step" role="status">${esc(t('refuge.offer'))}</p>` +
        `<div class="al-op-acts"><button type="button" class="al-act" data-ally="guard-offer">${esc(t('refuge.offer.accept'))}</button></div></div>`
      : '';
  const orders = ALLY_ORDER_KINDS.map(
    (k) =>
      `<button type="button" class="al-order${armed === k ? ' on' : ''}" data-ally-order="${k}"${v.alive ? '' : ' disabled'}>` +
      `<b>${esc(t(`ally.kind.${k}`))}</b><span>${esc(t(`ally.kind.${k}.hint`))}</span></button>`,
  ).join('');
  return (
    `<div class="albox"><div class="lw-head"><b><i class="al-emblem" aria-hidden="true">${ALLY_EMBLEM}</i> ${esc(t('ally.title'))}</b>` +
    `<span class="al-tag">${esc(t('ally.label'))}</span>` +
    `<button type="button" class="al-close" aria-label="${esc(t('card.close'))}">✕</button></div>` +
    `<div class="al-body">${offerHtml}${card}<div class="al-lbl">${esc(t('ally.orders'))}</div><div class="al-orders">${orders}</div>` +
    `<div class="al-status" role="status" aria-live="polite">${esc(status)}</div></div></div>`
  );
}

/** Что окну нужно от экрана матча. */
export interface AllyScreenHost {
  root(): HTMLElement;
  state(): GameState;
  me(): string;
  data(): GameData;
  /** Подпись цели: имя провинции или флота. */
  targetName(planet?: string, fleet?: string): string;
  /** Взвести прицел приказа: следующий тап по карте — цель. */
  arm(kind: AllyOrderKind): void;
  /** Какой приказ сейчас взведён (или `null`). */
  armed(): AllyOrderKind | null;
  /** Камера к флоту союзника. */
  findFleet(fleetId: string): void;
  /** Отдать приказ обычным путём хоста; `true` — не отвергнут. */
  order(action: Action): boolean;
  /** Виден ли флот игроку — для предложения охранять доки (глава VI). Нет — предложений нет. */
  sees?(fleet: Fleet): boolean;
}

export function initAllyScreen(host: AllyScreenHost): {
  open: () => void;
  refresh: () => void;
  isOpen: () => boolean;
  close: () => void;
} {
  let status = '';
  let painted = '';

  /** Предложение союзника охранять место эвакуации (`refugeGuardOffer`), если оно есть. */
  function offerOf(v: AllyPanelView): { at: string } | null {
    return host.sees
      ? refugeGuardOffer(host.state(), host.me(), v.ally, (f) => host.sees?.(f) === true)
      : null;
  }

  function paint(): void {
    const v = allyPanelView(host.state(), host.me(), host.data());
    if (!v) return close();
    const html = allyBoxHtml(v, host.targetName, host.armed(), status, offerOf(v));
    // Шаг операции меняется редко, а кадр — часто: новый DOM только при изменении.
    if (html === painted) return;
    painted = html;
    host.root().innerHTML = html;
  }
  const isOpen = (): boolean => host.root().classList.contains('show');
  function close(): void {
    host.root().classList.remove('show');
  }

  host.root().addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    if (tg === host.root() || tg.closest('.al-close')) return close();
    const kind = (tg.closest('[data-ally-order]:not([disabled])') as HTMLElement | null)?.dataset
      .allyOrder;
    if (kind && (ALLY_ORDER_KINDS as readonly string[]).includes(kind)) {
      status = '';
      host.arm(kind as AllyOrderKind);
      return close();
    }
    const act = (tg.closest('[data-ally]') as HTMLElement | null)?.dataset.ally;
    const v = allyPanelView(host.state(), host.me(), host.data());
    if (!act || !v) return;
    if (act === 'find' && v.group[0]) {
      host.findFleet(v.group[0]);
      return close();
    }
    if (act === 'cancel') {
      status = host.order(allyCancel(host.me(), v.ally)) ? t('ally.cancelled') : '';
      paint();
    }
    const offer = act === 'guard-offer' ? offerOf(v) : null;
    if (offer) {
      const guard = allyOrder(host.me(), v.ally, 'guard', { planet: offer.at });
      status = host.order(guard) ? t('ally.ordered') : '';
      paint();
    }
  });

  return {
    open: () => {
      status = '';
      painted = '';
      host.root().classList.add('show');
      paint();
    },
    refresh: () => {
      if (isOpen()) paint();
    },
    isOpen,
    close,
  };
}
