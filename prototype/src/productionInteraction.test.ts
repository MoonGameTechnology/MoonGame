import { describe, expect, it } from 'vitest';
import { productionClick } from './productionInteraction';
import type { YardHost } from './shipyard';
import type { Action } from '../../packages/shared-core/src/index';
const tap = (attributes: Record<string, string>) =>
  ({
    closest: (selector: string) =>
      selector.split(',').some((s) => Object.hasOwn(attributes, s.slice(1, -1)))
        ? {
            dataset: Object.fromEntries(
              Object.entries(attributes).map(([key, value]) => [
                key.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()),
                value,
              ]),
            ),
          }
        : null,
  }) as unknown as HTMLElement;
function setup() {
  const sent: Action[] = [];
  const cards: string[] = [];
  const technologies: string[] = [];
  const navigation: string[] = [];
  const host = {
    me: () => 'p1',
    order: (a: Action) => sent.push(a),
    openInfo: (key: string, world: string) => cards.push(`${key}@${world}`),
    openTech: (id: string) => technologies.push(id),
  } as unknown as YardHost;
  const nav = {
    planet: 'world-a',
    repaint: () => {},
    open: (_tab: string, building?: string) => navigation.push(building ?? _tab),
    category: () => {},
  };
  return {
    sent,
    cards,
    technologies,
    navigation,
    click: (attrs: Record<string, string>) => productionClick(tap(attrs), host, nav),
  };
}
describe('one production workspace dispatcher', () => {
  it('sends building and upgrade through the existing action path on the selected world', () => {
    const f = setup();
    f.click({ 'data-bw-go': 'barracks' });
    f.click({ 'data-bw-up': 'shipyard' });
    expect(f.sent.map((a) => a.type)).toEqual(['building.construct', 'building.upgrade']);
    expect(f.sent.map((a) => a.payload)).toEqual([
      { planetId: 'world-a', building: 'barracks' },
      { planetId: 'world-a', building: 'shipyard' },
    ]);
    expect(f.cards).toEqual([]);
  });
  it('info, facility resolution and research navigate without issuing orders', () => {
    const f = setup();
    f.click({ 'data-pw-info': 'unit:tank' });
    f.click({ 'data-pw-building': 'factory' });
    f.click({ 'data-bw-tech': 'vehicle_works' });
    expect(f.cards).toEqual(['u:tank@world-a']);
    expect(f.navigation).toEqual(['factory']);
    expect(f.technologies).toEqual(['vehicle_works']);
    expect(f.sent).toEqual([]);
  });
});
