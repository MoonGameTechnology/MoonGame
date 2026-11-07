import { esc, resLine } from './format';

/** Green always means preferable: costs/time invert the ordinary stat direction. */
export function comparisonHtml(
  value: number,
  reference: number,
  label = String(value),
  lowerIsBetter = false,
): string {
  const delta = (value - reference) * (lowerIsBetter ? -1 : 1);
  return `<span class="${delta > 0 ? 'pw-better' : delta < 0 ? 'pw-worse' : ''}">${esc(label)}</span>`;
}
export function resourceComparisonHtml(
  values: Record<string, number>,
  reference: Record<string, number>,
  per?: 'h' | 'd',
  lowerIsBetter = false,
): string {
  return Object.entries(values)
    .map(([key, value]) => {
      const delta = (value - (reference[key] ?? 0)) * (lowerIsBetter ? -1 : 1);
      return `<span class="pw-resource ${delta > 0 ? 'pw-better' : delta < 0 ? 'pw-worse' : ''}">${resLine({ [key]: value }, { per })}</span>`;
    })
    .join(' ');
}
