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
 */
import { t } from '../../localization/runtime';
import { kfmt } from './format';

export interface RunWallet {
  research: number;
  warrants: number;
  sovereigns: number;
}

/** Разметка кошелька. Подпись с полным именем валюты — в `title` и для скринридера. */
export function runWalletHtml(w: RunWallet): string {
  const cur = (cls: string, glyph: string, n: number, label: string): string =>
    `<span class="tw-cur tw-${cls}" title="${label}" aria-label="${label}"><i aria-hidden="true">${glyph}</i>${kfmt(n)}</span>`;
  return (
    cur('data', '◇', w.research, t('sector-zero.prep.research', { n: w.research })) +
    cur('warrants', '⌖', w.warrants, t('sector-zero.forge.warrants', { n: w.warrants })) +
    cur('sovereigns', '◆', w.sovereigns, t('sector-zero.shop.sovereigns', { n: w.sovereigns }))
  );
}
