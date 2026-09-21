import { t, tData } from '../../localization/runtime';
import type { swarmDossier } from '../../decisions/swarmDossier';
import type { JournalRow } from '../../decisions/swarmJournal';
import { esc, clockHM } from './format';

/**
 * PVR-4.5: журнал адаптаций идёт ПЕРВЫМ блоком досье. Порядок содержательный: игрок
 * открывает панель, чтобы понять, почему его тактика перестала работать, и ответ на
 * это — журнал, а не список контактов. Каждая строка помечена уверенностью, иначе
 * гипотеза читается как факт, а адаптация — как читерство ИИ (§3.4).
 */
function journalHtml(rows: JournalRow[]): string {
  return (
    `<section class="swarm-journal"><h3>${esc(t('swarm.journal.title'))}</h3><ul>` +
    rows
      .map(
        (r) =>
          `<li class="j-${esc(r.tier)}"><b>${esc(t('swarm.journal.tier.' + r.tier))}</b> ` +
          `${esc(t(r.key, r.vars ?? {}))}</li>`,
      )
      .join('') +
    `</ul></section>`
  );
}

export function swarmDossierHtml(
  contacts: ReturnType<typeof swarmDossier>,
  journal: JournalRow[] = [],
): string {
  return (journal.length ? journalHtml(journal) : '') + `<p class="hint">${esc(t('swarm.intel.lore'))}</p>` +
    `<details class="swarm-biology"><summary>${esc(t('data.brood-chamber'))}</summary>` +
    `<p>${esc(t('swarm.intel.economy'))}</p><p>${esc(t('swarm.intel.brood'))}</p>` +
    `<p>${esc(t('swarm.brood.desc'))}</p></details>` + (contacts.length
    ? contacts.map(c => `<section class="swarm-contact"><h3>${esc(t('swarm.intel.contact', { id: c.id, location: c.location }))}</h3>` +
      `<p>${esc(c.live ? t('swarm.intel.live') : t('swarm.intel.stale'))} · ${esc(t('swarm.intel.time', { day: Math.floor(c.at / 86400000) + 1, time: clockHM(c.at) }))}</p>` +
      `<ul>${c.units.map(u => `<li>${esc(tData(u.unit.replace(/_/g, ' ')))} <b>×${u.count}</b></li>`).join('')}</ul></section>`).join('')
    : `<p>${esc(t('swarm.intel.empty'))}</p>`);
}
