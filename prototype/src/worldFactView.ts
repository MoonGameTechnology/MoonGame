import { t } from '../../localization/runtime';
import type { WorldFact } from '../../decisions/worldFacts';
import { esc, resLine } from './format';
import { LIVE_SLOT, liveTimerHtml, liveTipAttrs } from './liveTimers';

/** Фишка шапки мира (`decisions/worldFacts.ts`). Слова — из локали, значки — те же, что в
 *  остальном интерфейсе: ★ столица, ✦ очки победы, значки ресурсов. */
export function worldFactHtml(f: WorldFact): string {
  const pct = (n: number): string => (n >= 0 ? '+' : '') + Math.round(n * 100) + '%';
  const tone = (n: number): string => (n >= 0 ? 'up' : 'dn');
  switch (f.kind) {
    case 'capital':
      return `<span class="pfact good" data-desc="fact:capital">★ ${t('side.world.capital')}</span>`;
    case 'blackout':
      return `<span class="pfact bad">⚡ ${t('side.world.blackout')}</span>`;
    case 'uncontrolled':
      // Слово на фишке, правило — в досье по тапу/наведению, как у столицы.
      return `<span class="pfact bad" data-desc="fact:uncontrolled">⊘ ${t('side.world.uncontrolled')}</span>`;
    case 'integrating':
      return `<span class="pfact bad" data-desc="fact:integrating">⟳ ${t('side.world.integrating', { p: Math.round(f.share * 100) })}</span>`;
    case 'reclaim':
      // Срок в разметке, цифры ставит живой узел (`liveTimers.ts`).
      return `<span class="pfact good" data-desc="fact:reclaim">↺ ${t('side.world.reclaim')} ${liveTimerHtml(f.until)}</span>`;
    case 'bombard': {
      // Знак и время на фишке, слова — в подсказке: шапка узкая, а на телефоне фишка
      // делит строку с действиями мира. Отсчёт — живой узел, как и время в подсказке.
      const tip = liveTipAttrs(f.at, 'hms', t('side.world.bombard-next', { t: LIVE_SLOT }));
      return `<span class="pfact bad pn-tip"${tip}>⊗ ${liveTimerHtml(f.at, 'hms')}</span>`;
    }
    case 'type': {
      const parts: string[] = [];
      if (f.production !== undefined)
        parts.push(
          `<i class="${tone(f.production)}">${t('side.world.production', { p: pct(f.production) })}</i>`,
        );
      if (f.defense !== undefined)
        parts.push(
          `<i class="${tone(f.defense)}">${t('side.world.defense', { p: pct(f.defense) })}</i>`,
        );
      return `<span class="pfact">${parts.join(' · ')}</span>`;
    }
    case 'cover':
      // Иконка и число, правило — в досье по тапу/наведению (заказ владельца 2026-09-29).
      // Число, а не один значок: защита падает с каждой снесённой постройкой (FORT-5.15).
      return `<span class="pfact" data-desc="fact:cover" aria-label="${esc(t('side.world.mitigation', { n: Math.round(f.share * 100) }))}">🛡 −${Math.round(f.share * 100)}%</span>`;
    case 'output':
      return `<span class="pfact" data-desc="fact:output">${resLine({ ...f.perHour }, { per: 'h' })}</span>`;
  }
}
