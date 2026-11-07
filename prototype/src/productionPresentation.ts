import { closeTemplateDialog, wireTemplateDialogs } from './productionTemplateDialog';
import { esc } from './format';
import { INFO_ICON } from './infoIcon';
import { t } from '../../localization/runtime';

/** The catalog and the fitting sheet share the existing order controller. */
export function fittingSheet(content: string, title: string, ground = false): string {
  return `<div class="pw-fitting-backdrop"><section class="pw-fitting-dialog" role="dialog" aria-modal="true" aria-label="${t('production.fitting')}"><header><b>${t(ground ? 'production.mobilization' : 'production.fitting')} · ${esc(title)}</b><button class="btn-x" data-pw-fit-close aria-label="${t('production.fitting-close')}">×</button></header><div class="pw-fitting-body">${content}</div><footer class="pw-fitting-footer"></footer></section></div>`;
}

/** Preserve disclosure identity when another pane inserts/removes its own details. */
export function rememberProductionDetails(root: HTMLElement): () => void {
  const key = (d: HTMLDetailsElement) => `${d.closest('.pw-hero-dossier') ? 'dossier/' : ''}${d.className}/${d.classList.contains('pw-fit-stats') ? 'stats' : d.classList.contains('pw-queues') ? 'queue' : d.querySelector('summary')?.textContent}/${d.dataset.hero ?? ''}`;
  const opened = new Map(Array.from(root.querySelectorAll('details')).map(d => [key(d), d.open]));
  return () => root.querySelectorAll('details').forEach(d => { const value = opened.get(key(d)); if (value !== undefined) d.open = value; });
}

const bound = new WeakSet<HTMLElement>();
const positions = new WeakMap<HTMLElement, Map<string, number>>();
const focused = new WeakMap<HTMLElement, [string, string][]>();
const requestedHull = new WeakMap<HTMLElement, { hero: string; hull: string }>();
const requestedPool = new WeakSet<HTMLElement>();
const hardwareSlot = new WeakMap<HTMLElement, { hero: string; slot: string; index: number }>();
const requestedSkill = new WeakMap<HTMLElement, { hero: string; skill: string }>();
const scrollAreas = ['.pw-fitting-body', '.pw-flagship-picker', '.pw-hero-pool', '.pw-hero-equipment', '.pw-hardware-pool'];
function topProductionDetails(root: HTMLElement): HTMLDetailsElement | null {
  for (const selector of ['.pw-fit-stats[open]', '.pw-skill-description[open]', '.pw-hero-dossier[open]', '.pw-hero-pool[open]', '.pw-flagship-picker[open]', '.pw-hero-equipment[open]']) {
    const node = root.querySelector<HTMLDetailsElement>(selector);
    if (node) return node;
  }
  return null;
}

/** Shared by the game's Escape/Android-Back ladder; closes one nested surface. */
export function closeProductionOverlay(root: HTMLElement): boolean {
  if (root.nodeType !== 1) return false;
  if (closeTemplateDialog(root)) return true;
  const templates = root.querySelector<HTMLElement>('.pw-template-picker [data-cntpl]');
  if (templates) { templates.click(); return true; }
  const details = topProductionDetails(root);
  if (details) { details.open = false; details.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true }); return true; }
  if (!root.classList.contains('pw-fitting-open')) return false;
  root.classList.remove('pw-fitting-open');
  root.querySelector<HTMLElement>('.cn-hbtn.on')?.focus({ preventScroll: true });
  return true;
}
/** Reattach presentation after a repaint without duplicating order handlers or drafts. */
export function presentProduction(root: HTMLElement): void {
  if (root.nodeType !== 1) return;
  root.classList.add('pw-production');
  wireTemplateDialogs(root);
  compareHardwareStats(root);
  const footer = root.querySelector('.pw-fitting-footer');
  const order = root.querySelector('.cnbox > .cn-order');
  if (footer && order) {
    order.querySelector('#cn-planet')?.remove();
    footer.append(order);
  }
  const stats = root.querySelector('.pw-fit-stats');
  if (stats) { const summary = stats.querySelector('summary'); if (summary) { summary.setAttribute('aria-label', t('yard.stats')); summary.innerHTML = INFO_ICON; } root.querySelector('.pw-fitting-dialog > header .btn-x')?.before(stats); }
  const body = root.querySelector('.pw-fitting-body');
  const card = body?.querySelector('.cn-card');
  if (card) appendFittingControls(card);
  const paletteHeading = root.querySelector('.pw-fitting-body .cn-ph');
  const slotName = card?.querySelector('.cn-bay.sel .cn-bt')?.textContent;
  if (paletteHeading && slotName) paletteHeading.textContent = slotName;
  const templates = root.querySelector('.cnbox > .cn-tpl');
  if (templates) {
    const picker = root.ownerDocument.createElement('div');
    picker.className = 'pw-template-picker';
    picker.innerHTML = `<section role="dialog" aria-modal="true" aria-label="${t('yard.tpl.title')}"><header><b>${t('yard.tpl.title')}</b><button class="btn-x" data-cntpl aria-label="${t('production.fitting-close')}">×</button></header></section>`;
    picker.firstElementChild!.append(templates);
    root.querySelector('.cnbox')!.append(picker);
    picker.querySelector<HTMLElement>('[data-cntpl]')?.focus();
  }
  const chosenHardware = hardwareSlot.get(root);
  const equipment = root.querySelector<HTMLElement>('.pw-hero-equipment');
  if (chosenHardware && chosenHardware.hero === equipment?.dataset.hero) {
    const bay = root.querySelectorAll<HTMLElement>('[data-pw-hardware-slot]')[chosenHardware.index];
    if (bay?.dataset.pwHardwareSlot === chosenHardware.slot) showHardwareOptions(root, chosenHardware.slot, chosenHardware.index);
    else hardwareSlot.delete(root);
  }
  const requested = requestedHull.get(root);
  const skill = requestedSkill.get(root);
  if (skill && Array.from(root.querySelectorAll<HTMLElement>('.hx-bays [data-hunequip]')).some(el => el.dataset.hunequip === skill.hero && el.dataset.ab === skill.skill)) {
    const pool = root.querySelector<HTMLDetailsElement>('.pw-hero-pool');
    if (pool) pool.open = false;
    requestedSkill.delete(root);
  }
  if (requestedPool.has(root)) {
    const pool = root.querySelector<HTMLDetailsElement>('.pw-hero-pool');
    if (pool) { pool.open = true; pool.querySelector<HTMLElement>('summary')?.focus(); }
    requestedPool.delete(root);
  }
  const flagship = root.querySelector<HTMLDetailsElement>('.pw-flagship-picker');
  if (requested && flagship?.dataset.hero === requested.hero && flagship.dataset.currentHull === requested.hull) {
    flagship.open = false;
    requestedHull.delete(root);
  }
  for (const selector of scrollAreas) {
    const area = root.querySelector(selector);
    if (area) area.scrollTop = positions.get(root)?.get(selector) ?? 0;
  }
  if (root.classList.contains('pw-fitting-open')) {
    const dialog = root.querySelector('.pw-fitting-dialog');
    const saved = focused.get(root) ?? [];
    const candidate = saved.length ? Array.from(dialog?.querySelectorAll<HTMLElement>('button,select') ?? [])
      .find(el => saved.every(([key, value]) => el.getAttribute(key) === value)) : undefined;
    (candidate ?? dialog?.querySelector<HTMLElement>('.cn-bay.sel,[data-cnmod],button'))?.focus({ preventScroll: true });
  }
  const content = root.querySelector('.pw-content');
  const subnav = root.querySelector('.cnbox > .pw-subtabs');
  if (content && subnav) content.prepend(subnav);
  const context = content?.querySelector('#cn-planet');
  const income = content?.querySelector('.pw-income');
  const tabs = root.querySelector('.pw-main-tabs');
  if (tabs && context && income) {
    const row = document.createElement('div');
    row.className = 'pw-context';
    row.append(context, income);
    tabs.before(row);
  }
  const heroWorld = root.querySelector('.pw-hero-world');
  if (heroWorld) heroWorld.textContent = (root.querySelector('#cn-planet') as HTMLSelectElement | null)?.selectedOptions[0]?.textContent ?? '';
  if (bound.has(root)) return;
  bound.add(root);
  root.addEventListener('scroll', event => {
    const target = event.target as HTMLElement;
    const selector = scrollAreas.find(key => target.matches?.(key));
    if (!selector) return;
    const state = positions.get(root) ?? new Map<string, number>();
    state.set(selector, target.scrollTop);
    positions.set(root, state);
  }, true);
  root.addEventListener('focusin', event => {
    const target = event.target as HTMLElement;
    if (!target.closest('.pw-fitting-dialog')) return;
    focused.set(root, Array.from(target.attributes).filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value]));
  });
  root.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    if (target.classList.contains('pw-template-picker')) {
      event.stopImmediatePropagation();
      target.querySelector<HTMLElement>('[data-cntpl]')?.click();
      return;
    }
    const popup = topProductionDetails(root);
    if (popup && !popup.contains(target)) {
      popup.open = false;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const hardwareBay = target.closest<HTMLElement>('[data-pw-hardware-slot]');
    if (target.closest('[data-pw-hardware-hull]')) {
      const chooser = root.querySelector<HTMLDetailsElement>('.pw-flagship-picker');
      if (chooser) { chooser.open = true; chooser.querySelector<HTMLElement>('summary')?.focus(); }
      event.stopImmediatePropagation();
      return;
    }
    if (hardwareBay && !target.closest('[data-huninstall],.pw-skill-description')) {
      const slot = hardwareBay.dataset.pwHardwareSlot!;
      const equipment = root.querySelector<HTMLElement>('.pw-hero-equipment');
      const index = Array.from(root.querySelectorAll('[data-pw-hardware-slot]')).indexOf(hardwareBay);
      if (equipment?.dataset.hero) hardwareSlot.set(root, { hero: equipment.dataset.hero, slot, index });
      showHardwareOptions(root, slot, index);
      event.stopImmediatePropagation();
      return;
    }
    if (target.closest('.hx-bay.off[data-htab="abilities"]')) requestedPool.add(root);
    if (popup?.classList.contains('pw-hero-pool') && target.closest('[data-htab="tree"]')) popup.open = false;
    const equip = target.closest<HTMLElement>('[data-hequip]');
    if (equip?.dataset.hequip && equip.dataset.ab) requestedSkill.set(root, { hero: equip.dataset.hequip, skill: equip.dataset.ab });
    const apply = target.closest<HTMLElement>('[data-hflagapply]');
    if (apply?.dataset.hflagapply && apply.dataset.hull) requestedHull.set(root, { hero: apply.dataset.hflagapply, hull: apply.dataset.hull });
    const chooser = root.querySelector<HTMLDetailsElement>('.pw-skill-description[open],.pw-hero-dossier[open],.pw-flagship-picker[open]');
    if (target === root && chooser) {
      chooser.open = false;
      event.stopImmediatePropagation();
      return;
    }
    if (target.closest('[data-pw-fit-close]') || target.classList.contains('pw-fitting-backdrop')) {
      root.classList.remove('pw-fitting-open');
      event.stopImmediatePropagation();
      root.querySelector<HTMLElement>('.cn-hbtn.on')?.focus();
    } else if (target.closest('.cn-hbtn,[data-cntpluse],[data-cnagain]')) {
      positions.delete(root);
      focused.delete(root);
      root.classList.add('pw-fitting-open');
    } else if (target.closest('.cn-tab,.cn-close,[data-pw-queue]')) {
      root.classList.remove('pw-fitting-open');
    }
  }, true);
  root.addEventListener('keydown', event => {
    const templates = root.querySelector('.pw-template-picker');
    const scope = root.querySelector('.pw-template-editor[open]') ?? templates ?? topProductionDetails(root) ?? (root.classList.contains('pw-fitting-open') ? root.querySelector('.pw-fitting-dialog') : null);
    if (!scope) return;
    if (event.key === 'Tab') {
      const controls = Array.from(scope.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,summary,[tabindex="0"]'))
        .filter(el => el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && root.ownerDocument.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && root.ownerDocument.activeElement === last) { event.preventDefault(); first?.focus(); }
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && (event.target as HTMLElement).matches('.cn-bay[role=button],.pw-hardware-slot[role=button]')) {
      event.preventDefault(); (event.target as HTMLElement).click(); return;
    }

  }, true);
}

/** The mockup's quantity → quote → submit hierarchy, fed by the existing order model. */
export function productionOrderHtml(view: {
  count: number; max: number; world: string; worldName: string; price: string; time: string;
  queue: string; where: string; affordable: boolean; canBuild: boolean; block: string;
}): string {
  return `<div class="cn-order"><div class="cn-step"><span class="pw-quantity-label">${t('production.quantity')}</span><button data-cncount="-"${view.count <= 1 ? ' disabled' : ''}>−</button><span class="cn-sv">${view.count}</span><button data-cncount="+"${view.count >= view.max ? ' disabled' : ''}>+</button></div>` +
    `<div class="pw-order-quote"><span>${t('production.planet')}</span><b>${esc(view.worldName)}</b><span>${t('production.cost')}</span><div class="cn-oprice">${view.price}</div><span>${t('production.duration')}</span><span class="cn-otime">${view.time}</span></div>` +
    `<div class="cn-oworld">${view.queue || view.where}</div>` +
    (view.block ? `<span class="pw-order-block">${esc(view.block)}</span>` : '') +
    (!view.affordable ? `<button class="pw-order-income" data-pw-income="${esc(view.world)}">${t('production.planet-income')} ›</button>` : '') +
    `<div class="cn-ogo"><button class="cn-build btn-main" data-cnbuild${view.canBuild ? '' : ' disabled'}>${t('production.add-order')}</button></div></div>`;
}

function showHardwareOptions(root: HTMLElement, slot: string, index: number): void {
  const pool = root.querySelector<HTMLElement>('.pw-hardware-pool');
  if (pool) pool.hidden = false;
  root.querySelectorAll<HTMLElement>('.pw-hardware-option').forEach(el => { el.hidden = slot !== 'universal' && el.dataset.slot !== slot; });
  root.querySelectorAll<HTMLElement>('[data-pw-hardware-slot]').forEach((el, i) => el.classList.toggle('sel', i === index));
}

const previousHardware = new WeakMap<HTMLElement, { hero: string; values: Record<string, number>; changes: Record<string, number> }>();
/** Compare accepted configurations; equal repaints retain the last selection's comparison. */
function compareHardwareStats(root: HTMLElement): void {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-pw-hardware-stat]'));
  if (!nodes.length) return;
  const hero = nodes[0]!.dataset.hero!;
  const values = Object.fromEntries(nodes.map(node => [node.dataset.pwHardwareStat!, Number(node.dataset.value)]));
  const previous = previousHardware.get(root);
  const changed = previous?.hero === hero && Object.keys(values).some(key => values[key] !== previous.values[key]);
  const changes = changed ? Object.fromEntries(Object.keys(values).map(key => [key, values[key]! - (previous.values[key] ?? 0)])) : previous?.hero === hero ? previous.changes : {};
  for (const node of nodes) {
    const delta = changes[node.dataset.pwHardwareStat!] ?? 0;
    node.classList.toggle('pw-better', delta > 0);
    node.classList.toggle('pw-worse', delta < 0);
  }
  previousHardware.set(root, { hero, values, changes });
}

/** Labels are text nodes: translations and slot counts never enter an HTML sink. */
function appendFittingControls(card: Element): void {
  const doc = card.ownerDocument;
  const bays = card.querySelectorAll('.cn-bay');
  if (bays.length) {
    const caption = doc.createElement('div');
    caption.className = 'pw-fit-caption';
    for (const label of [t('production.fitting'), t('production.fitting-slots', {
      u: card.querySelectorAll('.cn-bay.filled').length, n: bays.length,
    })]) {
      const span = doc.createElement('span');
      span.textContent = label;
      caption.append(span);
    }
    card.append(caption);
  }
  const controls = doc.createElement('div');
  controls.className = 'pw-fitting-tools';
  for (const [attribute, label] of [['data-cntplsave', 'yard.tpl.save'], ['data-cntpl', 'yard.tpl.title']] as const) {
    const button = doc.createElement('button');
    button.setAttribute(attribute, '');
    button.textContent = t(label);
    controls.append(button);
  }
  card.after(controls);
}
