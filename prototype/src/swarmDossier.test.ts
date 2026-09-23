import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../packages/shared-core/src/index';
import { swarmDossier } from '../../decisions/swarmDossier';
import { swarmDossierBadge, swarmDossierHtml } from './swarmDossier';
import { t } from '../../localization/runtime';

describe('Swarm dossier readout', () => {
  it('shows no roster before contact and labels remembered composition honestly', () => {
    const s = createInitialState({ seed: 'dossier', version: { data: '1', manifest: '1' } });
    expect(swarmDossierHtml(swarmDossier(s, 'p1', new Set()))).toContain(t('swarm.intel.empty'));
    s.swarmIntel = { p1: { encounter: { owner: 'p2', location: 'A', at: 1000,
      units: [{ unit: 'swarm_drone', count: 7 }] } } };
    const html = swarmDossierHtml(swarmDossier(s, 'p1', new Set()));
    expect(html).toContain('×7');
    expect(html).toContain(t('swarm.intel.stale'));
    expect(html).toContain(t('swarm.intel.lore'));
  });

});

describe('досье Роя — пересборка 2026-09-23 (справа, сворачивается, понятнее)', () => {
  const contacts = [
    { id: 'b-old', owner: 'p2', location: 'A', at: 1000, units: [{ unit: 'swarm_drone', count: 3 }], live: false },
    { id: 'z-live', owner: 'p2', location: 'B', at: 5000, units: [{ unit: 'swarm_guard', count: 9 }], live: true },
  ];

  it('сводка отвечает без раскрытия: сколько сил знаем и сколько на радаре', () => {
    expect(swarmDossierBadge([])).toBe(t('swarm.intel.badge.none'));
    expect(swarmDossierBadge(contacts)).toBe(t('swarm.intel.badge', { seen: 2, live: 1 }));
    expect(swarmDossierHtml(contacts)).toContain(t('swarm.intel.badge', { seen: 2, live: 1 }));
  });

  it('живое сверху: карточка на радаре идёт раньше давнего наблюдения', () => {
    const html = swarmDossierHtml(contacts);
    expect(html.indexOf('data-jump="B"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-jump="B"')).toBeLessThan(html.indexOf('data-jump="A"'));
  });

  it('мир в карточке — ссылка на карту, а не голый id флота', () => {
    const html = swarmDossierHtml(contacts);
    expect(html).toContain('class="sd-loc" data-jump="A"');
    expect(html).not.toContain('b-old'); // id флота игроку ничего не говорит
  });

  it('часов наблюдения нет — «цифры подсчёта времени не нужны»', () => {
    const html = swarmDossierHtml(contacts);
    expect(html).not.toMatch(/\d{1,2}:\d{2}/);
    // Устаревшее говорит, что устарело, словами.
    expect(html).toContain(t('swarm.intel.stale.short'));
    expect(html).toContain(t('swarm.intel.stale'));
  });

  it('лор и биология свёрнуты внизу: их читают один раз', () => {
    const html = swarmDossierHtml(contacts);
    expect(html).toMatch(/<details class="sd-sec swarm-biology"><summary>/);
    expect(html.indexOf('swarm-biology')).toBeGreaterThan(html.indexOf('sd-forces'));
  });
});
