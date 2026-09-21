import { t, tData } from '../../localization/runtime';
import type { swarmDossier } from '../../decisions/swarmDossier';
import { esc, clockHM } from './format';

export function swarmDossierHtml(contacts: ReturnType<typeof swarmDossier>): string {
  return `<p class="hint">${esc(t('swarm.intel.lore'))}</p>` +
    `<details class="swarm-biology"><summary>${esc(t('data.brood-chamber'))}</summary>` +
    `<p>${esc(t('swarm.intel.economy'))}</p><p>${esc(t('swarm.intel.brood'))}</p>` +
    `<p>${esc(t('swarm.brood.desc'))}</p></details>` + (contacts.length
    ? contacts.map(c => `<section class="swarm-contact"><h3>${esc(t('swarm.intel.contact', { id: c.id, location: c.location }))}</h3>` +
      `<p>${esc(c.live ? t('swarm.intel.live') : t('swarm.intel.stale'))} · ${esc(t('swarm.intel.time', { day: Math.floor(c.at / 86400000) + 1, time: clockHM(c.at) }))}</p>` +
      `<ul>${c.units.map(u => `<li>${esc(tData(u.unit.replace(/_/g, ' ')))} <b>×${u.count}</b></li>`).join('')}</ul></section>`).join('')
    : `<p>${esc(t('swarm.intel.empty'))}</p>`);
}
