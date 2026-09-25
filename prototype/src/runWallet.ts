/**
 * Кошелёк профиля в шапке забега Sector Zero (решение владельца 2026-09-24).
 *
 * В забеге шапка основной игры теряет эмблему с названием и местом, очки победы и день —
 * они про соревнование и сутки мира, а не про забег. Освободившийся ряд занимают три
 * валюты ПРОФИЛЯ: данные экспедиций ◇, Варранты ⌖ и Суверены (самоцвет `SOV_SVG` основной
 * игры). Цвета — общие `--cur-*`.
 *
 * Числа живые: кадр перерисовывает кошелёк из профиля, поэтому награда или ролик посреди
 * забега видны сразу, а не после выхода в меню.
 *
 * «+» у Суверенов — ролик за Суверены прямо в забеге (`run.sovereigns`, решение владельца
 * 2026-09-24). Порция и дневной лимит — те же, что у кнопки магазина: это один кран с двумя
 * входами, а не второй кран.
 *
 * Тап по валюте раскрывает её описание (заказ владельца 2026-09-24: подпись в `title` на
 * телефоне не видна вовсе). Числа в описании — не из текста, а из правил профиля и данных
 * (`WalletRules`): поправь цену пакета в `sectorZeroShop.json` — поправится и строка.
 */
import { t } from '../../localization/runtime';
import { adRefusalKey, type AdOutcome, type AdPlacement } from '../../decisions/adPlacements';
import { kfmt } from './format';
import { SOV_SVG } from './icons';

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

/** Валюта кошелька — она же класс плашки (`tw-data` …) и ключ её описания. */
export type WalletCur = 'data' | 'warrants' | 'sovereigns';

/** Числа, которые называет описание валюты, — из правил профиля и данных, а не из текста. */
export interface WalletRules {
  /** Варрантов за очко награды экспедиции. */
  warrantsPerReward: number;
  /** Корпуса за один Суверен в мгновенном ремонте. */
  repairHp: number;
  /** Цена пакета снабжения в Суверенах. */
  supplyPrice: number;
  /** Суверенов за ролик и роликов в сутки. */
  adAmount: number;
  adPerDay: number;
}

/** Раскрытое описание: какая валюта и правила для её чисел. */
export interface WalletInfo {
  cur: WalletCur;
  rules: WalletRules;
}

/** Описание валюты — одна строка справки с настоящими числами. */
export function walletInfoText(cur: WalletCur, r: WalletRules): string {
  if (cur === 'data') return t('sector-zero.wallet.data');
  if (cur === 'warrants') return t('sector-zero.wallet.warrants', { n: r.warrantsPerReward });
  return t('sector-zero.wallet.sovereigns', {
    hp: r.repairHp,
    supply: r.supplyPrice,
    ad: r.adAmount,
    day: r.adPerDay,
  });
}

/** Разметка кошелька. Подпись с полным именем валюты — в `title` и для скринридера; тап по
 *  валюте раскрывает её описание (`info`). */
export function runWalletHtml(
  w: RunWallet,
  ad: WalletAd | null = null,
  info: WalletInfo | null = null,
): string {
  const cur = (cls: WalletCur, glyph: string, n: number, label: string): string =>
    `<button type="button" class="tw-cur tw-${cls}" data-wallet="info" data-cur="${cls}" aria-expanded="${info?.cur === cls}" title="${label}" aria-label="${label}"><i aria-hidden="true">${glyph}</i>${kfmt(n)}</button>`;
  // «+» только раскрывает выбор: на самой кнопке ролика сказано И что будет реклама, И что
  // придёт (требование площадки 4.5.1) — голый «+» не говорит ни того, ни другого.
  const offer = ad ? t('sector-zero.shop.ad-sovereigns', { n: ad.amount, left: ad.left }) : '';
  const plus = ad
    ? `<button type="button" class="tw-plus" data-wallet="more" aria-expanded="${ad.open}" title="${offer}" aria-label="${offer}">+</button>` +
      (ad.open ? `<button type="button" class="tw-ad" data-wallet="watch">${offer}</button>` : '')
    : '';
  const note = info
    ? `<p class="tw-info tw-${info.cur}" role="note">${walletInfoText(info.cur, info.rules)}</p>`
    : '';
  return (
    cur('data', '◇', w.research, t('sector-zero.prep.research', { n: w.research })) +
    cur('warrants', '⌖', w.warrants, t('sector-zero.forge.warrants', { n: w.warrants })) +
    // Суверены — самоцвет основной игры (`SOV_SVG`, как фишка «500 +»), а не текстовый ◆
    // (заказ владельца 2026-09-25: «иконку золотой валюты — как в основной игре»).
    cur('sovereigns', SOV_SVG, w.sovereigns, t('sector-zero.shop.sovereigns', { n: w.sovereigns })) +
    plus +
    note
  );
}

/** Что кошельку нужно от игры. Дверь к ролику — та же `watchAd`, что у двух экранов. */
export interface RunWalletHost {
  root: HTMLElement;
  /** Валюты профиля; `null` — не забег, кошелька нет. */
  wallet(): RunWallet | null;
  /** Порция и остаток ролика на сегодня; `null` — ролика нет. */
  offer(): { amount: number; left: number } | null;
  /** Числа для описаний валют. */
  rules(): WalletRules;
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
  /** Валюта с раскрытым описанием; одно раскрытое за раз, как и выбор ролика. */
  let info: WalletCur | null = null;
  let lastHtml = '';

  function render(): void {
    const w = h.wallet();
    const offer = w && !watching ? h.offer() : null;
    if (!offer) open = false;
    if (!w) info = null;
    const html = w
      ? runWalletHtml(w, offer && { ...offer, open }, info && { cur: info, rules: h.rules() })
      : '';
    if (html === lastHtml) return;
    h.root.innerHTML = html;
    h.root.hidden = !html;
    lastHtml = html;
  }

  h.root.addEventListener('click', (ev) => {
    const btn = (ev.target as Element).closest<HTMLElement>('[data-wallet]');
    const which = btn?.dataset.wallet;
    if (which === 'info') {
      const cur = btn?.dataset.cur as WalletCur | undefined;
      info = cur === undefined || info === cur ? null : cur;
      open = false;
    }
    if (which === 'more') {
      open = !open;
      info = null;
    }
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

  // Раскрытое (кнопка ролика или описание валюты) закрывается тапом мимо и Escape: на
  // планшете кнопка ролика висела поверх ресурсов шапки и закрывалась только повторным «+»
  // (нашёл прогон «потыкать все кнопки», 2026-09-25).
  const collapse = (): void => {
    if (!open && info === null) return;
    open = false;
    info = null;
    render();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', (ev) => {
      if (!h.root.contains(ev.target as Node)) collapse();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') collapse();
    });
  }

  return { render };
}
