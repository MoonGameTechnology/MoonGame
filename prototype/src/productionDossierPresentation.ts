import { moduleAllowed } from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { data } from './gameData';
import { esc } from './format';
import { holoIcon } from './holographicIcons';
import { moduleIcon, SLOT_KEY } from './moduleIcons';
import { termHtml } from './termTip';

/** The same canonical codex values, arranged as the approved entity sheet. */
export function presentProductionDossier(root: HTMLElement, kind: string, id: string, world: string): void {
  if (root.nodeType !== 1) return;
  const entity = kind === 'b' || kind === 'u';
  root.classList.toggle('pw-entity-card', entity);
  if (!entity) return;
  const box = root.querySelector<HTMLElement>('.cxbox');
  const head = box?.querySelector<HTMLElement>('.cx-head');
  const title = head?.querySelector('b');
  const close = box?.querySelector<HTMLButtonElement>('.cx-close');
  if (!box || !head || !title || !close) return;
  const header = root.ownerDocument.createElement('header');
  header.className = 'pw-dossier-title';
  close.classList.add('btn-quiet');
  close.setAttribute('aria-label', t('codex.close'));
  close.innerHTML = holoIcon('caret-left');
  header.append(title, close);
  box.prepend(header);
  const meta = root.ownerDocument.createElement('span');
  meta.className = 'pw-dossier-world';
  meta.textContent = world;
  head.prepend(meta);
  const pager = box.querySelector('.cx-lvls');
  if (pager) { presentLevels(pager); head.append(pager); }
  if (kind === 'b') box.querySelector(':scope > .ship-art')?.remove();
  else {
    const art = box.querySelector(':scope > .ship-art');
    const hero = root.ownerDocument.createElement('div');
    hero.className = 'pw-unit-card-hero';
    const copy = root.ownerDocument.createElement('p');
    const description = box.querySelector('.cx-desc')?.textContent ?? '';
    copy.textContent = description.split(/(?<=[.!?])\s/)[0] ?? '';
    // A locked unit's requirement block lies over its portrait, as on the catalog card.
    const needs = box.querySelector(':scope > .pw-requirements');
    if (art && needs) {
      const visual = root.ownerDocument.createElement('div');
      visual.className = 'pw-dossier-visual';
      visual.append(art, needs);
      hero.classList.add('locked');
      hero.append(visual);
    } else if (art) hero.append(art);
    hero.append(copy); head.replaceWith(hero);
  }
  const values = box.querySelector<HTMLElement>('.pw-section .cx-stats');
  if (values) {
    const costs = root.ownerDocument.createElement('details');
    costs.className = 'pw-section pw-dossier-costs';
    costs.innerHTML = `<summary>${t('production.cost-upkeep')}</summary><div class="cx-stats"></div>`;
    const rows = Array.from(values.children);
    rows.forEach((row, i) => {
      if (i < 2 || row.querySelector('.cx-k')?.textContent === t('codex.row.upkeep'))
        costs.lastElementChild!.append(row);
    });
    const stats = values.closest('details')!;
    const damage = box.querySelector(':scope > .udmg');
    if (damage) {
      const section = root.ownerDocument.createElement('details');
      section.className = 'pw-section';
      section.innerHTML = `<summary>${t('codex.dmg.title')}</summary>`;
      section.append(damage); stats.after(section);
    }
    stats.after(costs);
    const equipment = kind === 'u' ? equipmentHtml(id) : '';
    if (equipment) stats.insertAdjacentHTML('afterend', equipment);
  }
  const unlocks = box.querySelector('.pw-unlock')?.closest('details');
  if (unlocks) head.after(unlocks);
  wireTerms(box);
  box.querySelectorAll('.cx-build').forEach(button => button.classList.add('btn-main'));
  const body = root.ownerDocument.createElement('div');
  body.className = 'pw-dossier-body';
  const actions = root.ownerDocument.createElement('footer');
  actions.className = 'pw-dossier-actions';
  for (const child of Array.from(box.children)) {
    if (child === header) continue;
    (child.matches('.cx-build,.pw-order-block') ? actions : body).append(child);
  }
  box.append(body);
  if (actions.childElementCount) box.append(actions);
}

function presentLevels(pager: Element): void {
  const options = Array.from(pager.querySelectorAll<HTMLButtonElement>('button'));
  const index = options.findIndex(button => button.classList.contains('on'));
  if (index < 0) return;
  const previous = options[Math.max(0, index - 1)]!.cloneNode(true) as HTMLButtonElement;
  const next = options[Math.min(options.length - 1, index + 1)]!.cloneNode(true) as HTMLButtonElement;
  previous.disabled = index === 0; next.disabled = index === options.length - 1;
  previous.classList.remove('on'); next.classList.remove('on');
  previous.textContent = '−'; next.textContent = '+';
  previous.setAttribute('aria-label', t('production.previous-level'));
  next.setAttribute('aria-label', t('production.next-level'));
  const caption = pager.ownerDocument.createElement('b');
  caption.textContent = `${index + 1} / ${options.length}`;
  pager.replaceChildren(previous, caption, next);
}

function equipmentHtml(id: string): string {
  const def = data.units[id];
  if (!def || def.domain === 'ground') return '';
  const slots = Object.entries(def.slots).filter(([, n]) => n > 0);
  const count = slots.reduce((sum, [, n]) => sum + n, 0);
  const rows = slots.map(([key, n]) => `<div class="cx-row"><span class="cx-k">${t(SLOT_KEY[key] ?? key)}</span><span class="cx-v">${n}</span></div>`).join('');
  const modules = Object.entries(data.modules).filter(([, md]) => moduleAllowed(id, def, md) && ((def.slots[md.slot] ?? 0) > 0 || (def.slots.universal ?? 0) > 0));
  return `<details class="pw-section"><summary>${t('production.equipment-slots', { n: count })}</summary><div class="cx-stats">${rows}</div><div class="pw-dossier-modules">${modules.map(([mid, md]) => `<span class="r-${esc(md.rarity ?? 'simple')}">${moduleIcon(mid)}<small>${esc(tData(md.name))}</small></span>`).join('')}</div></details>`;
}

function wireTerms(box: HTMLElement): void {
  const labels: Array<[string, string]> = [
    ['codex.row.hull', 'hull'], ['codex.row.hp', 'hull'], ['codex.row.speed', 'speed'],
    ['codex.row.signature', 'signature'], ['codex.row.radar', 'radar'],
    ['codex.row.radar-level', 'radar'], ['codex.row.radar-detects', 'radar'],
    ['codex.row.upkeep', 'upkeep'], ['codex.row.world-mitigation', 'defense'],
  ];
  for (const label of box.querySelectorAll<HTMLElement>('.cx-k')) {
    const entry = labels.find(([key]) => t(key) === label.textContent);
    if (entry) label.innerHTML = termHtml(entry[1], label.textContent ?? '');
  }
}
