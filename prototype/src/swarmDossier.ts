import { t, tData } from '../../localization/runtime';
import type { swarmDossier } from '../../decisions/swarmDossier';
import { orderContacts, swarmDossierSummary } from '../../decisions/swarmDossier';
import type { JournalRow } from '../../decisions/swarmJournal';
import { esc } from './format';

/**
 * Досье Роя — что игрок знает о противнике (PVR-4.5; пересобрано по заказу владельца
 * 2026-09-23: «окошко информации о Рое неинтуитивное, пусть справа открывается и
 * сворачивается»).
 *
 * Прежняя лента шла в порядке РАЗРАБОТКИ, а не вопросов игрока: абзац лора, раскрывашка
 * про биологию, контакты вида «Контакт swarm-3 · C5R2» с часами наблюдения. Теперь порядок —
 * вопросами, которые игрок задаёт, открывая досье:
 *
 * 1. **Сколько их и что видно сейчас** — сводка сверху. Она же остаётся в шапке, когда
 *    досье свёрнуто, поэтому отвечает без раскрытия.
 * 2. **Почему моя тактика перестала работать** — журнал адаптаций, с меткой уверенности
 *    чипом: гипотеза не должна читаться как факт, а адаптация — как читерство ИИ (§3.4).
 * 3. **Где они** — карточки сил: мир (нажатие ведёт туда камеру), на радаре ли сейчас и
 *    состав. Порядок — `orderContacts`: живое сверху, затем свежее.
 * 4. **Что такое Рой** — лор и биология свёрнуты внизу: их читают один раз.
 *
 * Часов наблюдения в досье больше нет (заказ владельца: «цифры подсчёта времени там не
 * нужны»). Устаревшее наблюдение говорит, что оно устарело, словами.
 */

type Contact = ReturnType<typeof swarmDossier>[number];

/** Сводка одной строкой — для шапки, в том числе свёрнутой. */
export function swarmDossierBadge(contacts: readonly Contact[]): string {
  const { seen, live } = swarmDossierSummary(contacts);
  return seen === 0 ? t('swarm.intel.badge.none') : t('swarm.intel.badge', { seen, live });
}

function journalHtml(rows: JournalRow[]): string {
  return (
    `<section class="sd-sec sd-adapt"><h3>${esc(t('swarm.journal.title'))}</h3><ul class="sd-journal">` +
    rows
      .map(
        (r) =>
          `<li class="j-${esc(r.tier)}"><span class="sd-tag">${esc(t('swarm.journal.tier.' + r.tier))}</span>` +
          `<span>${esc(t(r.key, r.vars ?? {}))}</span></li>`,
      )
      .join('') +
    `</ul></section>`
  );
}

function contactHtml(c: Contact, placeName: (id: string) => string): string {
  const status = c.live ? t('swarm.intel.live') : t('swarm.intel.stale.short');
  return (
    `<article class="sd-contact${c.live ? ' live' : ''}">` +
    `<header><button type="button" class="sd-loc" data-jump="${esc(c.location)}" ` +
    `title="${esc(t('swarm.intel.jump'))}">${esc(placeName(c.location))}</button>` +
    `<span class="sd-chip">${esc(status)}</span></header>` +
    `<ul class="sd-units">${c.units
      .map((u) => `<li><span>${esc(tData(u.unit.replace(/_/g, ' ')))}</span><b>×${u.count}</b></li>`)
      .join('')}</ul>` +
    (c.live ? '' : `<p class="sd-note">${esc(t('swarm.intel.stale'))}</p>`) +
    `</article>`
  );
}

/** `placeName` — имя провинции контакта (PVR-6.19); без него — id узла, как было. */
export function swarmDossierHtml(
  contacts: ReturnType<typeof swarmDossier>,
  journal: JournalRow[] = [],
  /** Раздел «О Рое»: в первой главе забега его нет — природу Роя расскажет учёный после
   *  неё (`decisions/swarmLore.ts`). */
  lore = true,
  placeName: (id: string) => string = (id) => id,
): string {
  const ordered = orderContacts(contacts);
  return (
    `<p class="sd-summary">${esc(swarmDossierBadge(contacts))}</p>` +
    (journal.length ? journalHtml(journal) : '') +
    `<section class="sd-sec sd-forces"><h3>${esc(t('swarm.intel.forces'))}</h3>` +
    (ordered.length
      ? ordered.map((c) => contactHtml(c, placeName)).join('')
      : `<p class="sd-empty">${esc(t('swarm.intel.empty'))}</p>`) +
    `</section>` +
    (lore
      ? `<details class="sd-sec swarm-biology"><summary>${esc(t('swarm.intel.about'))}</summary>` +
        `<p>${esc(t('swarm.intel.lore'))}</p>` +
        `<p>${esc(t('swarm.intel.network'))}</p>` +
        `<h4>${esc(t('data.brood-chamber'))}</h4>` +
        `<p>${esc(t('swarm.intel.economy'))}</p><p>${esc(t('swarm.intel.brood'))}</p>` +
        `<p>${esc(t('swarm.brood.desc'))}</p></details>`
      : '')
  );
}
