import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../packages/shared-core/src/index';
import { swarmDossier } from '../../decisions/swarmDossier';
import { swarmDossierHtml } from './swarmDossier';
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
