import {
  CORP_EMBLEMS,
  corpEmblemId,
  type CorpEmblemId,
} from '../../packages/protocol/src/corpIdentity';
import { t } from '../../localization/runtime';
import { esc } from './format';

/** Hand-drawn vector marks inside the existing corporate hexagon. */
const MARKS: Readonly<Record<CorpEmblemId, string>> = {
  falcon:
    '<path d="M20 16l-4-5-8-2 4 8-5-1 9 10 4 8 4-8 9-10-5 1 4-8-8 2z"/><path d="M16 21l4-5 4 5M17 27h6"/>',
  phoenix:
    '<path d="M20 9c-7 8-2 9-6 13l-7-6 4 11 9 7 9-7 4-11-7 6c-4-3 1-7-6-13z"/><path d="M17 26l3-6 3 6-3 7z"/>',
  wolf: '<path d="M9 11l8 4h6l8-4-2 17-9 7-9-7zM9 11l5 12 6 6 6-6 5-12M14 22l3 1m6 0 3-1m-9 6h6l-3 5z"/>',
  dragon:
    '<path d="M10 31c12 5 20-1 13-7l-6-5 4-8 9 2-2 6-5-2-1 4c12 6 7 14-2 14M20 12l-7-2 3 7-9 5 10 1M24 11l1-4"/>',
  lion: '<path d="M20 8l7 3 5 7-1 10-7 7h-8l-7-7-1-10 5-7zM14 16h12l2 10-8 6-8-6zM14 21l3 1m6 0 3-1m-8 5h4l-2 3z"/>',
  shield:
    '<path d="M20 9l12 5-2 13-10 8-10-8-2-13zM14 20l6-6 6 6-6 10z"/><path d="M12 14l8 4 8-4"/>',
  blade: '<path d="M13 29l15-19 2 2-13 21-4-4zM10 25l11 9M12 32l-3 4m-1-4 5 4M18 27l-2-2"/>',
  compass:
    '<path d="M20 7l4 11 9 4-9 4-4 11-4-11-9-4 9-4zM20 14v16M13 22h14"/><circle cx="20" cy="22" r="3"/>',
  orbit:
    '<circle cx="20" cy="22" r="6"/><ellipse cx="20" cy="22" rx="15" ry="6" transform="rotate(-35 20 22)"/><circle cx="29" cy="13" r="2"/>',
  nova: '<path d="M20 7l3 10 8-6-5 9 9 2-9 3 5 9-8-6-3 9-3-9-8 6 5-9-9-3 9-2-5-9 8 6z"/>',
  comet:
    '<circle cx="24" cy="27" r="7"/><path d="M11 9l10 11M7 17l10 10M20 8l10 13M10 26l5 6M23 25l3 4"/>',
  crystal: '<path d="M20 7l11 14-11 16L9 21zM20 7l-4 14 4 16 4-16zM9 21h22"/>',
  forge: '<path d="M8 22h24l-6 5h-5v5h5v3H13v-3h5v-5h-4zM17 12l5-4 6 6-5 4zM21 17l-6 6"/>',
  beacon:
    '<path d="M14 35l4-19h4l4 19zM17 25h6M20 9v3M12 13l-3-2m19 2 3-2M10 18H6m24 0h4"/><circle cx="20" cy="16" r="3"/>',
  eye: '<path d="M6 22c8-13 20-13 28 0-8 13-20 13-28 0z"/><circle cx="20" cy="22" r="6"/><path d="M20 18v8M12 10l2 4m14-4-2 4m-6-8v5"/>',
  crown: '<path d="M8 15l8 6 4-12 4 12 8-6-4 18H12zM13 28h14M18 25l2-3 2 3-2 3z"/>',
  spire: '<path d="M8 34h24M11 34V21l5-4v17M16 34V15l4-7 4 7v19M24 34V17l5 4v13M19 20h2m-2 6h2"/>',
  wing: '<path d="M10 33C5 22 17 10 32 9c-1 12-11 23-22 24zM10 33l16-17M15 27l-1-9m6 4-1-8m-4 13 10-1m-5-4h9"/>',
  anchor:
    '<circle cx="20" cy="12" r="4"/><path d="M20 16v20M13 20h14M7 25c1 7 6 10 13 11 7-1 12-4 13-11M7 25l-1 6m1-6 6 2m20-2 1 6m-1-6-6 2"/>',
  helix:
    '<path d="M12 8c0 11 16 17 16 28M28 8c0 11-16 17-16 28M13 12h14M16 18h8m-8 8h8m-11 6h14"/>',
};

export const CORP_EMBLEM_LABEL: Readonly<Record<CorpEmblemId, string>> = {
  falcon: 'corp.emblem.falcon',
  phoenix: 'corp.emblem.phoenix',
  wolf: 'corp.emblem.wolf',
  dragon: 'corp.emblem.dragon',
  lion: 'corp.emblem.lion',
  shield: 'corp.emblem.shield',
  blade: 'corp.emblem.blade',
  compass: 'corp.emblem.compass',
  orbit: 'corp.emblem.orbit',
  nova: 'corp.emblem.nova',
  comet: 'corp.emblem.comet',
  crystal: 'corp.emblem.crystal',
  forge: 'corp.emblem.forge',
  beacon: 'corp.emblem.beacon',
  eye: 'corp.emblem.eye',
  crown: 'corp.emblem.crown',
  spire: 'corp.emblem.spire',
  wing: 'corp.emblem.wing',
  anchor: 'corp.emblem.anchor',
  helix: 'corp.emblem.helix',
};

export function corpEmblem(corpId: string, selected?: unknown, size = 40): string {
  const id = corpEmblemId(corpId, selected);
  return (
    `<svg class="cb-emb" data-corp-emblem="${id}" width="${size}" height="${Math.round(size * 1.1)}" viewBox="0 0 40 44" aria-hidden="true">` +
    '<path class="cb-emb-frame" d="M20 1.5L37.5 11.5V32.5L20 42.5L2.5 32.5V11.5Z"/>' +
    `<g class="cb-emb-mark">${MARKS[id]}</g></svg>`
  );
}

/** One picker for creation, the hub sheet and the in-match settings. */
export function corpEmblemPicker(selected: CorpEmblemId, busy: boolean, draft = false): string {
  return (
    `<div class="cb-emblems" role="group" aria-label="${esc(t('corp.emblem.title'))}">` +
    CORP_EMBLEMS.map(
      (id) =>
        `<button type="button" class="cb-emblem-choice" ` +
        `${draft ? `data-corpdraft="${id}"` : `data-corpact="emblem" data-corparg="${id}"`} ` +
        `aria-pressed="${id === selected}" aria-label="${esc(t(CORP_EMBLEM_LABEL[id]))}" title="${esc(t(CORP_EMBLEM_LABEL[id]))}"${busy ? ' disabled' : ''}>` +
        `${corpEmblem('', id, 32)}</button>`,
    ).join('') +
    '</div>'
  );
}
