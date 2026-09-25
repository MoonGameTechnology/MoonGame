import { describe, expect, it } from 'vitest';
import { data } from './gameData';
import { catalogPortraitHtml } from './shipArt';
import { catalogRowHtml, catalogTileHtml } from './catalogTile';
import { YARD_HULLS, YARD_SQUAD_HULLS } from './shipyard';
import { SWARM_UNIT_SHAPE } from '../../packages/client/src/shipShapes';
import { SWARM_SHAPES } from '../../packages/client/src/swarmShapes';

describe('realistic build portraits', () => {
  it('covers every buildable ship and wing, including the frigate and dropship', () => {
    for (const id of [...YARD_HULLS, ...YARD_SQUAD_HULLS, 'hero']) {
      expect(catalogPortraitHtml('u', id, data), id).toContain('<img');
    }
    expect(catalogPortraitHtml('u', 'frigate', data)).toContain('data-ship-art="frigate"');
    expect(catalogPortraitHtml('u', 'landing_shuttle', data)).toContain('data-ship-art="dropship"');
    // Owner decision 2026-09-24: the landing ship and the carrier no longer share a picture.
    expect(catalogPortraitHtml('u', 'strike_carrier', data)).toContain('data-ship-art="dropship"');
    expect(catalogPortraitHtml('u', 'shuttle_carrier', data)).toContain('data-ship-art="transport"');
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

  // Лист владельца «Рой» (2026-09-25): восемь форм 01–08 — те же, что у векторов карты.
  it('a Swarm-owned hull shows its Swarm form, and all eight forms have a portrait', () => {
    const shown = new Set<string>();
    for (const [unit, shape] of Object.entries(SWARM_UNIT_SHAPE)) {
      if (data.units[unit]?.domain === 'ground' || !data.units[unit]) continue;
      const html = catalogPortraitHtml('u', unit, data, 'portrait', 'swarm');
      expect(html, unit).toContain(`data-ship-art="${shape}"`);
      expect(html, unit).toContain('<img');
      shown.add(shape);
    }
    expect([...shown].sort()).toEqual(Object.keys(SWARM_SHAPES).sort());
  });

  it('the owner picks the family: the same hull stays human without the Swarm', () => {
    expect(catalogPortraitHtml('u', 'cruiser', data)).toContain('data-ship-art="cruiser"');
    expect(catalogPortraitHtml('u', 'cruiser', data, 'portrait', 'vanguard')).toContain('data-ship-art="cruiser"');
    expect(catalogPortraitHtml('u', 'cruiser', data, 'thumb', 'swarm')).toContain('data-ship-art="swarmHunter"');
    // Юнит самого Роя в кодексе — без владельца, по `def.faction`.
    expect(catalogPortraitHtml('u', 'swarm_brood_mother', data)).toContain('data-ship-art="swarmMatriarch"');
    // Наземный десант Роя остаётся со своей иконкой.
    expect(catalogPortraitHtml('u', 'swarm_lander', data, 'portrait', 'swarm')).toBe('');
  });
});
