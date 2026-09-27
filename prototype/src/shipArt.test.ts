import { describe, expect, it } from 'vitest';
import { data } from './gameData';
import { catalogPortraitHtml } from './shipArt';
import { catalogRowHtml, catalogTileHtml } from './catalogTile';
import { YARD_HULLS, YARD_SQUAD_HULLS } from './shipyard';
import { SWARM_UNIT_SHAPE } from '../../packages/client/src/shipShapes';
import { SWARM_SHAPES } from '../../packages/client/src/swarmShapes';

describe('realistic build portraits', () => {
  it('covers every buildable ship and wing, including the frigate and the landing shuttle', () => {
    const portraits = new Set<string>();
    for (const id of [...YARD_HULLS, ...YARD_SQUAD_HULLS, 'hero']) {
      const html = catalogPortraitHtml('u', id, data);
      expect(html, id).toContain('<img');
      const src = html.match(/src="([^"]+)"/)?.[1];
      expect(src, id).toBeTruthy();
      expect(portraits.has(src!), `${id} must not borrow another buildable hull's portrait`).toBe(false);
      portraits.add(src!);
    }
    expect(catalogPortraitHtml('u', 'frigate', data)).toContain('data-ship-art="frigate"');
    expect(catalogPortraitHtml('u', 'landing_shuttle', data)).toContain('data-ship-art="dropship"');
    // Owner decision 2026-09-26: the Carrier is one hull (carrier + landing ship) on the freighter.
    expect(catalogPortraitHtml('u', 'shuttle_carrier', data)).toContain('data-ship-art="transport"');
    expect(catalogPortraitHtml('b', 'starfort', data)).toContain('data-ship-art="station"');
    expect(catalogPortraitHtml('b', 'metal_station', data)).toContain('data-ship-art="station"');
  });

  it('gives every ground type its own portrait, including Swarm and pirate troops', () => {
    const portraits = new Set<string>();
    for (const [id, def] of Object.entries(data.units)) {
      if (def.domain !== 'ground') continue;
      const html = catalogPortraitHtml('u', id, data);
      expect(html, id).toContain('<img');
      const src = html.match(/src="([^"]+)"/)?.[1];
      expect(src, id).toBeTruthy();
      expect(portraits.has(src!), id).toBe(false);
      portraits.add(src!);
    }
  });

  it('does not assign unit portraits to mining buildings or unknown content', () => {
    expect(catalogPortraitHtml('u', 'unknown', data)).toBe('');
    expect(catalogPortraitHtml('b', 'mine', data)).toBe('');
  });

  it('shows a mine only for a defined minelayer module, never as a buildable hull', () => {
    // Integration fixture for the minelayer catalogue from PR #1320. Main does not
    // ship that mechanic yet; the portrait must not invent it or unlock a unit.
    const withLayer = {
      ...data,
      modules: { ...data.modules, mine_layer: { ...data.modules.cargo_bay!, name: 'Minelayer' } },
    };
    const { mine_layer: _layer, ...withoutLayer } = withLayer.modules;
    expect(catalogPortraitHtml('md', 'mine_layer', { ...data, modules: withoutLayer })).toBe('');
    expect(catalogPortraitHtml('md', 'mine_layer', withLayer)).toContain(
      'data-ship-art="roadMine"',
    );
    expect(catalogPortraitHtml('md', 'cargo_bay', withLayer)).toBe('');
    expect(catalogPortraitHtml('u', 'mine_layer', withLayer)).toBe('');
    expect(catalogPortraitHtml('b', 'mine', withLayer)).toBe('');
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
    expect(catalogPortraitHtml('u', 'swarm_lander', data, 'portrait', 'swarm')).toContain('data-ship-art="swarm_lander"');
  });

  it('pirate ships have their own portraits instead of borrowing human hull art', () => {
    for (const [pirate, human] of [['pirate_skiff', 'scout'], ['pirate_frigate', 'frigate'], ['pirate_cruiser', 'cruiser']]) {
      const html = catalogPortraitHtml('u', pirate!, data);
      expect(html, pirate).toContain('<img');
      expect(html).not.toBe(catalogPortraitHtml('u', human!, data));
    }
  });
});
