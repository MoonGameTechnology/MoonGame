/**
 * Run mission panel (owner's order 2026-09-24) — what to do, how much is done, what the
 * debrief will pay; a mission with a target on the map is a button: a tap moves the camera
 * to the target, the next tap to the following one.
 *
 * Same REFM shape as the other screens: pure markup (`missionPanelHtml`) +
 * `initMissionPanel(host)` takes its host dependencies explicitly. The rows themselves are
 * decided in `decisions/missionView.ts`; the map rings for targets stay with the renderer.
 */
import { t } from '../../localization/runtime';
import { missionLabelN, type MissionReward, type MissionRow } from '../../decisions/missionView';
import { runClockText } from '../../decisions/runClock';
import { esc } from './format';

export interface MissionPanelHost {
  root: HTMLElement;
  /** Missions of the current run (the same rows as the chip and the map marks). */
  rows: () => MissionRow[];
  /** Training range: missions pay nothing there, so no reward is promised. */
  training: () => boolean;
  /** Move the camera to a mission target. */
  jump: (planetId: string) => void;
  /** Panel opened or closed — the host redraws the chip (`aria-expanded`). */
  onToggle: () => void;
}

/** Mission reward in both currencies — the same glyphs as the header wallet. */
export const missionRewardHtml = (r: MissionReward): string =>
  `<span class="mp-reward"><i class="tw-data">◇ +${r.research}</i><i class="tw-warrants">⌖ +${r.warrants}</i></span>`;

export function missionPanelHtml(rows: readonly MissionRow[], training: boolean): string {
  return (
    `<div class="mp-head"><b>${t('hud.missions.title')}</b><button type="button" class="mp-close" data-missions-close="1" aria-label="${t('hud.close')}">✕</button></div>` +
    // Полигон пока не платит за задачи — награду не обещаем (§14.5: не определяют победу).
    `<p class="mp-hint">${t(training ? 'training.missions.hint' : 'hud.missions.hint')}</p>` +
    rows
      .map(r => {
        // Маяк считает время удержания — реальным временем забега, как его таймеры;
        // проваленная задача (гарнизон пал) говорит об этом, а не висит «0/1».
        const progress = r.failed
          ? t('hud.missions.failed')
          : r.needMs !== undefined
            ? `${runClockText(r.holdMs ?? 0)}/${runClockText(r.needMs)}`
            : `${r.done}/${r.total}`;
        const body =
          `<i class="mp-mark" aria-hidden="true">${r.complete ? '✓' : r.failed ? '✗' : '⚑'}</i>` +
          `<span class="mp-name">${esc(t(r.id, { n: missionLabelN(r) }))}</span>` +
          `<b class="mp-prog">${progress}</b>` +
          (r.kind === 'recruit' ? `<span class="mp-reward">${t('hud.missions.recruit-reward')}</span>` : '') +
          (training ? '' : missionRewardHtml(r.reward)) +
          (r.targets.length ? `<span class="mp-go">${t('hud.missions.show')}</span>` : '');
        return r.targets.length
          ? `<button type="button" class="mp-row" data-mission-go="${esc(r.id)}">${body}</button>`
          : `<div class="mp-row${r.complete ? ' done' : r.failed ? ' failed' : ''}">${body}</div>`;
      })
      .join('')
  );
}

export interface MissionPanel {
  isOpen: () => boolean;
  toggle: (open?: boolean) => void;
  /** Repaint from this frame's rows; no-op while closed, closes itself when rows run out. */
  render: (rows: MissionRow[]) => void;
}

export function initMissionPanel(host: MissionPanelHost): MissionPanel {
  const panel = host.root;
  let open = false;
  let lastHtml = '';
  const focus = new Map<string, number>();

  function toggle(next = !open): void {
    open = next;
    panel.hidden = !next;
    host.onToggle();
    lastHtml = '';
    // На широком экране панель встаёт прямо под чипом: справа её место занято досье Роя.
    // Узкий экран — во всю ширину (CSS), позицию не трогаем.
    const chip = document.querySelector('#devline .dl-missions');
    if (next && chip && window.innerWidth > 700) {
      const r = chip.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 24);
      panel.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - width - 12))}px`;
      panel.style.right = 'auto';
      panel.style.top = `${r.bottom + 8}px`;
    }
  }

  function render(rows: MissionRow[]): void {
    if (!open) return;
    if (rows.length === 0) {
      toggle(false);
      return;
    }
    const html = missionPanelHtml(rows, host.training());
    if (html === lastHtml) return;
    lastHtml = html;
    panel.innerHTML = html;
  }

  panel.addEventListener('click', event => {
    const el = event.target as Element;
    if (el.closest('[data-missions-close]')) {
      toggle(false);
      return;
    }
    const go = el.closest<HTMLElement>('[data-mission-go]')?.dataset.missionGo;
    if (!go) return;
    const row = host.rows().find(r => r.id === go);
    if (!row || row.targets.length === 0) return;
    const i = (focus.get(go) ?? -1) + 1;
    focus.set(go, i);
    // Панель закрывается: иначе она сама закрыла бы цель, к которой ведёт камера.
    toggle(false);
    host.jump(row.targets[i % row.targets.length]!);
  });

  return { isOpen: () => open, toggle, render };
}
