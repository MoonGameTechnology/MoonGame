import {
  FORTRESS_BODY, FORTRESS_DEPLOY_COST, fortressLoadoutHull, issuedFortressModule,
  matchCost, matchHours, type Action, type GameState,
} from '../../packages/shared-core/src/index';
import { createLoadoutEditor, applyLoadoutAction } from '../../packages/client/src/loadoutEditor';
import { deployStation, deployForkFortress } from '../../decisions/actions';
import { refusalText } from '../../decisions/refusalText';
import { t, tData } from '../../localization/runtime';
import { data } from './gameData';
import { cost, esc, fmtEta } from './format';
import { effectChip } from './moduleEffect';

interface FortressDialogHost {
  state(): GameState;
  me(): string;
  probe(action: Action): string | null;
  order(action: Action): boolean;
  placed(): void;
}

export function isFortressDialogOpen(): boolean {
  return (document.getElementById('fortress-order') as HTMLDialogElement | null)?.open === true;
}

export function closeFortressDialog(): void {
  (document.getElementById('fortress-order') as HTMLDialogElement | null)?.close();
}

/** Uses the ordinary loadout reducer, with the building bays reserved by the core. */
export function openFortressDialog(host: FortressDialogHost, province: string, trail?: number): void {
  if (document.getElementById('fortress-order')) return;
  const hull = fortressLoadoutHull(data);
  if (!hull) return;
  const fitting = { ...data, units: { ...data.units, [FORTRESS_BODY]: hull },
    modules: Object.fromEntries(Object.entries(data.modules).filter(([id]) => !issuedFortressModule(id))) };
  let modules: string[] = [];
  const order = (): Action => trail === undefined ? deployStation(host.me(), province, modules)
    : deployForkFortress(host.me(), province, trail, modules);
  const dialog = document.createElement('dialog');
  dialog.id = 'fortress-order';
  dialog.setAttribute('aria-labelledby', 'fortress-order-title');
  const render = (): void => {
    const state = host.state();
    const resources = state.players[host.me()]?.resources ?? {};
    const arsenal = state.players[host.me()]?.arsenal;
    const model = createLoadoutEditor(FORTRESS_BODY, fitting, resources, { modules, pricing: state.pricing,
      ...(arsenal ? { ownedModules: new Set(arsenal.modules), moduleStars: arsenal.stars, moduleRarity: arsenal.rarity } : {}),
    });
    if (!model.ok) return;
    const price = matchCost(state, FORTRESS_DEPLOY_COST);
    for (const [key, value] of Object.entries(model.modulesCost)) price[key] = (price[key] ?? 0) + value;
    const block = host.probe(order());
    const palette = model.palette.filter((o) => o.installable || modules.includes(o.id)).map((o) => {
      const equipped = modules.includes(o.id);
      return `<button type="button" class="fortress-module btn-second${equipped ? ' on' : ''}" data-fit="${esc(o.id)}" aria-pressed="${equipped}">` +
        `<b>${equipped ? '✓ ' : '＋ '}${esc(tData(o.name))}</b><span>${esc(Object.entries(o.effect).map(([key, value]) => effectChip(key, value)).join(' · '))}</span>` +
        `<span>${cost(o.cost, resources)}</span></button>`;
    }).join('');
    dialog.innerHTML = `<h2 id="fortress-order-title">${esc(t('fortress.order-title'))}</h2>` +
      `<p>${esc(t('fortress.order-note'))}</p><div class="fortress-modules">${palette}</div>` +
      `<p>${cost(price, resources)} · ${fmtEta(matchHours(state, data.buildings.starfort?.buildTimeHours ?? 0))}</p>` +
      (block ? `<p role="status">${esc(refusalText(block))}</p>` : '') +
      `<div class="fortress-dialog-actions"><button type="button" class="btn-second" data-fort-close>${t('browser.description.close')}</button>` +
      `<button type="button" class="btn-main" data-fort-build${block ? ' disabled' : ''}>${t('side.fortress.raise')}</button></div>`;
  };
  dialog.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-fort-close]')) dialog.close();
    else if (target.closest('[data-fort-build]')) {
      if (host.order(order())) { dialog.close(); host.placed(); }
      else render();
    } else {
      const id = target.closest<HTMLElement>('[data-fit]')?.dataset.fit;
      if (!id) return;
      const state = host.state();
      const arsenal = state.players[host.me()]?.arsenal;
      const model = createLoadoutEditor(FORTRESS_BODY, fitting, state.players[host.me()]?.resources ?? {}, { modules, pricing: state.pricing,
        ...(arsenal ? { ownedModules: new Set(arsenal.modules), moduleStars: arsenal.stars, moduleRarity: arsenal.rarity } : {}),
      });
      if (!model.ok) return;
      const next = applyLoadoutAction({ kind: modules.includes(id) ? 'unequip' : 'equip', moduleId: id }, model, fitting,
        state.players[host.me()]?.resources ?? {});
      if (next.ok) modules = next.modules;
      render();
    }
  });
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('close', () => dialog.remove());
  render();
  document.body.appendChild(dialog);
  dialog.showModal();
}
