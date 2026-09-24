/**
 * Кошелёк профиля в шапке забега Sector Zero (решение владельца 2026-09-24).
 *
 * В забеге шапка основной игры теряет эмблему с названием и местом, очки победы и день —
 * они про соревнование и сутки мира, а не про забег. Освободившийся ряд занимают три
 * валюты ПРОФИЛЯ: данные экспедиций ◇, Варранты ⌖ и Суверены ◆. Значки — те же, что на
 * экране подготовки, цвета — общие `--cur-*`.
 *
 * Числа живые: кадр перерисовывает кошелёк из профиля, поэтому награда или ролик посреди
 * забега видны сразу, а не после выхода в меню.
 *
 * «+» у Суверенов — ролик за Суверены прямо в забеге (`run.sovereigns`, решение владельца
 * 2026-09-24). Порция и дневной лимит — те же, что у кнопки магазина: это один кран с двумя
 * входами, а не второй кран.
 */
import { t } from '../../localization/runtime';
import { adRefusalKey, type AdOutcome, type AdPlacement } from '../../decisions/adPlacements';
import { kfmt } from './format';

export interface RunWallet {
  research: number;
  warrants: number;
  sovereigns: number;
}

/** Суверены за ролик прямо в забеге (`run.sovereigns`): порция, остаток на сегодня и раскрыт
 *  ли выбор. `null` — ролика нет (площадка без рекламы или сегодняшние попытки кончились). */
export interface WalletAd {
  amount: number;
  left: number;
  open: boolean;
}

/** Разметка кошелька. Подпись с полным именем валюты — в `title` и для скринридера. */
export function runWalletHtml(w: RunWallet, ad: WalletAd | null = null): string {
  const cur = (cls: string, glyph: string, n: number, label: string): string =>
    `<span class="tw-cur tw-${cls}" title="${label}" aria-label="${label}"><i aria-hidden="true">${glyph}</i>${kfmt(n)}</span>`;
  // «+» только раскрывает выбор: на самой кнопке ролика сказано И что будет реклама, И что
  // придёт (требование площадки 4.5.1) — голый «+» не говорит ни того, ни другого.
  const offer = ad ? t('sector-zero.shop.ad-sovereigns', { n: ad.amount, left: ad.left }) : '';
  const plus = ad
    ? `<button type="button" class="tw-plus" data-wallet="more" aria-expanded="${ad.open}" title="${offer}" aria-label="${offer}">+</button>` +
      (ad.open ? `<button type="button" class="tw-ad" data-wallet="watch">${offer}</button>` : '')
    : '';
  return (
    cur('data', '◇', w.research, t('sector-zero.prep.research', { n: w.research })) +
    cur('warrants', '⌖', w.warrants, t('sector-zero.forge.warrants', { n: w.warrants })) +
    cur('sovereigns', '◆', w.sovereigns, t('sector-zero.shop.sovereigns', { n: w.sovereigns })) +
    plus
  );
}

/** Что кошельку нужно от игры. Дверь к ролику — та же `watchAd`, что у двух экранов. */
export interface RunWalletHost {
  root: HTMLElement;
  /** Валюты профиля; `null` — не забег, кошелька нет. */
  wallet(): RunWallet | null;
  /** Порция и остаток ролика на сегодня; `null` — ролика нет. */
  offer(): { amount: number; left: number } | null;
  watchAd(placement: AdPlacement): Promise<AdOutcome>;
  /** Начислить Суверены за досмотренный ролик; `false` — правило профиля не пустило. */
  apply(): boolean;
  /** Итог нажатия — строкой в ленту событий и тостом. */
  note(msg: string): void;
}

/**
 * Кошелёк в шапке: кадр зовёт `render`, нажатия ловит сам кошелёк. Ролик зовётся ТОЛЬКО
 * из обработчика нажатия на раскрытую кнопку (`platform/adPlacementGuard.test.ts`): ни
 * кадр, ни таймер рекламы не показывают. Не досмотрел или рекламы нет — ничего не
 * начислено; сломанный адаптер читается как «рекламы нет» (fail-secure).
 */
export function initRunWallet(h: RunWalletHost): { render(): void } {
  let open = false;
  let watching = false;
  let lastHtml = '';

  function render(): void {
    const w = h.wallet();
    const offer = w && !watching ? h.offer() : null;
    if (!offer) open = false;
    const html = w ? runWalletHtml(w, offer && { ...offer, open }) : '';
    if (html === lastHtml) return;
    h.root.innerHTML = html;
    h.root.hidden = !html;
    lastHtml = html;
  }

  h.root.addEventListener('click', (ev) => {
    const which = (ev.target as Element).closest<HTMLElement>('[data-wallet]')?.dataset.wallet;
    if (which === 'more') open = !open;
    if (which === 'watch') {
      const offer = h.offer();
      if (!offer || watching) return;
      watching = true;
      open = false;
      const settle = (status: AdOutcome): void => {
        watching = false;
        h.note(
          status !== 'ok'
            ? t(adRefusalKey(status))
            : h.apply()
              ? t('sector-zero.shop.ad-sovereigns.got', { n: offer.amount })
              : t('sector-zero.prep.unavailable'),
        );
        render();
      };
      void h.watchAd('run.sovereigns').then(settle, () => settle('unavailable'));
    }
    render();
  });

  return { render };
}
