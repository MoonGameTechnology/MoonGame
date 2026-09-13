import { describe, expect, it } from 'vitest';
import { data } from './gameData';
import { catalogPortraitHtml } from './shipArt';
import { catalogRowHtml, catalogTileHtml } from './catalogTile';
import { YARD_HULLS, YARD_SQUAD_HULLS } from './shipyard';

describe('realistic build portraits', () => {
  it('covers every buildable ship and wing, including the frigate and dropship', () => {
    for (const id of [...YARD_HULLS, ...YARD_SQUAD_HULLS, 'hero']) {
      expect(catalogPortraitHtml('u', id, data), id).toContain('<img');
    }
    expect(catalogPortraitHtml('u', 'frigate', data)).toContain('data-ship-art="frigate"');
    expect(catalogPortraitHtml('u', 'landing_shuttle', data)).toContain('data-ship-art="dropship"');
    expect(catalogPortraitHtml('b', 'starfort', data)).toContain('data-ship-art="station"');
    expect(catalogPortraitHtml('b', 'metal_station', data)).toContain('data-ship-art="station"');
  });

  it('does not assign ship art to ground troops, mines or unknown content', () => {
    expect(catalogPortraitHtml('u', 'tank', data)).toBe('');
    expect(catalogPortraitHtml('u', 'unknown', data)).toBe('');
    expect(catalogPortraitHtml('b', 'mine', data)).toBe('');
  });

  it('portraits keep build and dossier anchors, and cannot bypass a locked order', () => {
    const v = {
      kind: 'u' as const,
      id: 'frigate',
      name: 'Frigate',
      icon: '',
      label: '100',
      orderable: true,
      art: catalogPortraitHtml('u', 'frigate', data, 'thumb'),
    };
    for (const render of [catalogRowHtml, catalogTileHtml]) {
      expect(render(v)).toContain('data-buildorder="unit:frigate"');
      expect(render(v)).toContain('data-codex="u:frigate"');
      expect(render(v)).toContain(v.art);
      const locked = render({ ...v, lock: 'queued' });
      expect(locked).not.toContain('data-buildorder');
      expect(locked).not.toContain('data-codex');
      expect(locked).toContain('data-desc="u:frigate"');
    }
  });
});
