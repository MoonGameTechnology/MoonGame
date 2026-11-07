import { heroDisplayName } from './heroStaff';
import { orderLane, type GameState, type BuildLane } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { data } from './gameData';
import { displayUnit, buildingName, esc } from './format';
import { liveTimerHtml } from './liveTimers';
import { buildDurationHours, constructionPayload, barPct } from './buildProgress';
import { HOUR } from './time';

const LANES: [BuildLane, string, string][] = [
  ['buildings', 'production.buildings', 'buildings'],
  ['ships', 'yard.tab.ships', 'ships'],
  ['shuttles', 'yard.tab.squads', 'squads'],
  ['mobilization', 'production.mobilization', 'infantry'],
];
/** Four lanes, including idle ones. Legacy simultaneous jobs remain visible until completed. */
export function productionQueueHtml(
  state: GameState,
  world: string,
  options: { lane?: BuildLane; readOnly?: boolean } = {},
): string {
  if (!state.planets[world]) return '';
  const cancel = (attribute: string) =>
    options.readOnly
      ? ''
      : `<button class="btn-x" ${attribute} aria-label="${t('side.conveyor.cancel.title')}">×</button>`;
  const rows = LANES.filter(([lane]) => !options.lane || lane === options.lane).map(
    ([lane, key, tab]) => {
      const jobs: { seq: number; html: string }[] = [];
      for (const e of state.scheduled) {
        const p = e.type === 'construction.complete' ? constructionPayload(e.payload) : null;
        if (!p || p.planetId !== world || orderLane(data, p) !== lane) continue;
        const label = p.unit
          ? `${displayUnit(p.unit)} ×${p.count ?? 1}`
          : buildingName(data.buildings[p.building ?? '']?.name, p.building ?? '');
        const duration = buildDurationHours(p, data, state) * HOUR;
        jobs.push({
          seq: -1,
          html: `<div class="pw-job"><b>${esc(label)}</b>${liveTimerHtml(e.at, 'hms')}${cancel(`data-pw-cancel="${e.seq}"`)}<progress max="100" value="${barPct(e.at, duration, state.time)}"></progress></div>`,
        });
      }
      for (const q of state.planets[world]!.buildQueue ?? []) {
        if (orderLane(data, q) !== lane) continue;
        const label = q.unit
          ? `${displayUnit(q.unit)} ×${q.count ?? 1}`
          : buildingName(data.buildings[q.building ?? '']?.name, q.building ?? '');
        jobs.push({
          seq: q.id,
          html: `<div class="pw-job waiting"><span>${esc(label)}</span>${cancel(`data-pw-cancel="${q.id}"`)}</div>`,
        });
      }
      if (lane === 'mobilization')
        for (const h of Object.values(state.heroes ?? {})) {
          const p = h.mobilization;
          if (!p || p.target !== world) continue;
          const title = heroDisplayName(h);
          jobs.push({
            seq: p.queued ? (p.orderId ?? 0) : -1,
            html: `<div class="pw-job"><b>${esc(title)}</b>${p.queued ? `<span>${t('build.state.waiting')}</span>${cancel(`data-pw-hero-cancel="${esc(h.id)}"`)}` : liveTimerHtml(p.readyAt, 'hms')}</div>`,
          });
        }
      const paused = options.readOnly
        ? ''
        : (state.planets[world]!.pausedConstruction ?? [])
            .filter((p) => orderLane(data, p) === lane)
            .map(
              (p) =>
                `<button class="pw-paused" data-pw-resume="${p.id}">${t('side.conveyor.resume.title')} · ${esc(p.unit ? displayUnit(p.unit) : buildingName(data.buildings[p.building ?? '']?.name, p.building ?? ''))} · ${Math.round(p.progress * 100)}%</button>`,
            )
            .join('');
      return `<section class="pw-lane"><b>${t(key)}</b>${
        jobs.length
          ? jobs
              .sort((a, b) => a.seq - b.seq)
              .map((j) => j.html)
              .join('')
          : `${options.readOnly ? `<span>${t('side.conveyor.idle')}</span>` : `<button class="pw-empty" data-pw-empty="${tab}">＋ ${t('side.conveyor.idle')}</button>`}`
      }${paused}</section>`;
    },
  );
  return `<details class="pw-section pw-queues" open><summary>${t('production.queue')}</summary><div class="pw-lanes${options.lane ? ' single' : ''}">${rows.join('')}</div></details>`;
}
