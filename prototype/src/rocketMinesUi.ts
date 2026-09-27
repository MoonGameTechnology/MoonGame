import type { Action, GameData, GameState, RocketMine } from '../../packages/shared-core/src/index';
import { rocketMinelayer } from '../../packages/shared-core/src/index';
import { deployRocketMine, disarmRocketMine, setRocketMineMode } from '../../decisions/actions';
import { t } from '../../localization/runtime';
import { esc } from '../../packages/client/src/hudView';

interface MineUiDeps {
  state(): GameState;
  viewer(): string;
  visible(): GameState['ordnance'];
  data: GameData;
  hourMs(): number;
  issue(action: Action): boolean;
  verdict(action: Action): string | null;
  portrait(moduleId: string): string;
}
const modes = ['confirmed', 'any'] as const;
const MODE_KEY = { any: 'mine.mode.any', confirmed: 'mine.mode.confirmed' } as const;
const HINT_KEY = { any: 'mine.mode.any-hint', confirmed: 'mine.mode.confirmed-hint' } as const;

/** A card in the existing codex surface; it sends intents through the normal gate. */
export function rocketMinesUi(deps: MineUiDeps) {
  let selected: { fleetId: string } | { mineId: string } | null = null;
  let last = '';
  const el = document.getElementById('codex');
  function mineHtml(m: RocketMine): string {
    const own = m.owner === deps.viewer();
    return (
      `<section class="rm-card" data-mine-id="${esc(m.id)}"><p>${esc(t(own ? 'mine.ready' : 'mine.detected'))}</p>` +
      (own
        ? modes
            .map(
              (mode) =>
                `<button data-rm="mode" data-id="${esc(m.id)}" data-mode="${mode}" aria-pressed="${m.mode === mode}" title="${esc(t(HINT_KEY[mode]))}">${esc(t(MODE_KEY[mode]))}${m.mode === mode ? ' ✓' : ''}</button>`,
            )
            .join('') +
          `<button data-rm="disarm" data-id="${esc(m.id)}">${esc(t('mine.disarm'))}</button>`
        : '') +
      '</section>'
    );
  }
  function render(): void {
    if (!el || !selected) return;
    const state = deps.state();
    const ord = deps.visible();
    let body = '';
    let moduleId: string;
    if ('fleetId' in selected) {
      const fleet = state.fleets[selected.fleetId];
      const layer = fleet?.owner === deps.viewer() && rocketMinelayer(fleet, deps.data);
      if (!fleet || !layer) {
        close();
        return;
      }
      moduleId = layer.id;
      const def = layer.def;
      body += `<p>${esc(t('mine.rules', { minutes: def.armHours * 60, radar: def.radarRange, sight: def.sightRange, damage: def.damage }))}</p>`;
      for (const mode of modes) {
        const action = deployRocketMine(deps.viewer(), fleet.id, mode);
        const code = deps.verdict(action);
        const reason = code ? t(`err.${code.slice(2).toLowerCase().replaceAll('_', '-')}`) : '';
        body += `<p><button data-rm="deploy" data-mode="${mode}"${code ? ' disabled' : ''}>${esc(t(MODE_KEY[mode]))}</button> <span>${esc(reason || t(HINT_KEY[mode]))}</span></p>`;
      }
      for (const job of ord?.installations ?? []) {
        const remaining = Math.max(0, Math.ceil(((job.readyAt - state.time) / deps.hourMs()) * 60));
        body += `<p>${esc(t('mine.installing', { minutes: remaining }))}<button data-rm="disarm" data-id="${esc(job.id)}">${esc(t('mine.disarm'))}</button></p>`;
      }
      const mines = ord?.mines.filter((m) => m.owner === deps.viewer()) ?? [];
      body += mines.length ? mines.map(mineHtml).join('') : `<p>${esc(t('mine.empty'))}</p>`;
    } else {
      const id = selected.mineId;
      const mine = ord?.mines.find((m) => m.id === id);
      if (!mine) {
        close();
        return;
      }
      moduleId = mine.moduleId;
      body = mineHtml(mine);
    }
    const html = `<div class="cxbox" data-rm-root><h2>${esc(t('data.rocket-mine'))}</h2>${deps.portrait(moduleId)}${body}<button class="cx-close">${esc(t('codex.close'))}</button></div>`;
    if (html !== last) {
      el.innerHTML = html;
      last = html;
    }
    el.classList.add('show');
  }
  function close(): void {
    selected = null;
    last = '';
    el?.classList.remove('show');
  }
  el?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-rm]');
    if (!button || button.disabled || !selected) return;
    event.stopImmediatePropagation();
    const mode = button.dataset.mode;
    if (
      button.dataset.rm === 'deploy' &&
      'fleetId' in selected &&
      (mode === 'any' || mode === 'confirmed')
    ) {
      deps.issue(deployRocketMine(deps.viewer(), selected.fleetId, mode));
    } else if (
      button.dataset.rm === 'mode' &&
      button.dataset.id &&
      (mode === 'any' || mode === 'confirmed')
    ) {
      deps.issue(setRocketMineMode(deps.viewer(), button.dataset.id, mode));
    } else if (button.dataset.rm === 'disarm' && button.dataset.id) {
      deps.issue(disarmRocketMine(deps.viewer(), button.dataset.id));
    }
    render();
  });
  return {
    openFleet(fleetId: string) {
      selected = { fleetId };
      last = '';
      render();
    },
    openMine(mineId: string) {
      selected = { mineId };
      last = '';
      render();
    },
    refresh() {
      if (!el?.classList.contains('show') || !el.querySelector('[data-rm-root]')) {
        selected = null;
        last = '';
        return;
      }
      render();
    },
  };
}
