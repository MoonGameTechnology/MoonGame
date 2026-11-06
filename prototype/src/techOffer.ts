/**
 * Предложение изучить технологию у юнита или здания, запертого ею (`E_TECH_LOCKED`): строка
 * причины называет технологию, кнопка ведёт в её досье в окне технологий. Тот же путь, что у
 * космической крепости (FORT-0.2, `worldCard.ts`): раньше строка окна стройки говорила
 * безымянное «нужна технология», и что изучить, игрок искал по всем веткам дерева.
 *
 * ЧТО изучить, решает `decisions/techNeed.ts` (список ядра); здесь только слова и разметка —
 * общие для окна стройки и карточки справочника, чтобы оба места говорили одно и то же.
 */
import { t, tData } from '../../localization/runtime';
import type { TechNeed } from '../../decisions/techNeed';
import { data } from './gameData';
import { esc } from './format';

/** «🔒 Нужна технология «X»» — несколько открывающих называются через «или», как у крепости. */
export function techWhyHtml(need: TechNeed): string {
  const names = need.needs
    .map((id) => `«${tData(data.technologies[id]?.name ?? id)}»`)
    .join(t('side.fortress.or'));
  return `<div class="bw-why">🔒 ${esc(t('build.tech.needs', { tech: names }))}</div>`;
}

/** Подпись кнопки — где технология сейчас: идёт уже — «Исследуется», стоит в очереди — её
 *  место, иначе «Исследовать». Кнопка ведёт в досье во всех трёх случаях: там срок и очередь. */
export function techOfferLabel(need: TechNeed): string {
  if (need.status === 'running') return `⚗ ${esc(t('tech.state.running'))}`;
  if (need.status === 'queued') return `⏳ ${esc(t('tech.state.queued', { n: need.queuePos }))}`;
  return `⚗ ${esc(t('tech.action.research'))}`;
}
