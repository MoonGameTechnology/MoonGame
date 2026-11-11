import { holoIcon } from './holographicIcons';
import { heroDisplayName } from './heroStaff';
import { matchUnitHours, orderLane, type GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { data } from './gameData';
import { displayUnit, buildingName, esc } from './format';
import { liveTimerHtml } from './liveTimers';
import { buildDurationHours, constructionPayload, barPct, queuedOrderHours } from './buildProgress';
import { HOUR } from './time';
import { catalogPortraitHtml } from './shipArt';
import { BUILD_ICON } from './icons';
import { heroFlagshipUnit } from '../../packages/shared-core/src/state/heroFlagship';
import { YARD_GROUND_HULLS, YARD_HULLS, YARD_SQUAD_HULLS } from './productionRoster';
import { PRODUCTION_LANES, type ProductionLane } from '../../decisions/productionSections';
import { laneCanResume, laneReadyTimes, laneVisibleRows } from '../../decisions/laneQueue';

/** Имя линии в списке и в шапке каталога. */
export const LANE_NAME: Record<ProductionLane, string> = {
  buildings: 'production.buildings',
  ships: 'production.lane.shipyard',
  shuttles: 'production.lane.spaceport',
  mobilization: 'production.mobilization',
};

/** Корпус, чей силуэт стоит у свободной линии: что она строит, видно до нажатия. */
const LANE_ART: Record<ProductionLane, string | undefined> = {
  buildings: undefined,
  ships: YARD_HULLS[0],
  shuttles: YARD_SQUAD_HULLS[0],
  mobilization: YARD_GROUND_HULLS[0],
};

interface LaneJob {
  /** Порядок ждущих; у идущих −1, они всегда первыми. */
  seq: number;
  label: string;
  unit?: string;
  building?: string;
  /** Идёт: когда закончится. Идёт и ждёт: сколько длится (полоса и срок ждущего). */
  at?: number;
  duration?: number;
  /** Атрибут кнопки отмены; пусто — отменить нельзя. */
  cancel: string;
  /** Подпись отмены: идущий встаёт на паузу с возвратом, ждущий просто убирается. */
  cancelTitle?: string;
}

const hoursMs = (h: number | undefined): number | undefined => (h === undefined ? undefined : h * HOUR);

/** Обычный случай — один корабль — не подписан: «×N» только при N > 1. */
const orderLabel = (o: { unit?: string; count?: number; building?: string }): string =>
  o.unit
    ? `${displayUnit(o.unit)}${(o.count ?? 1) > 1 ? ` ×${o.count}` : ''}`
    : buildingName(data.buildings[o.building ?? '']?.name, o.building ?? '');

/** Заказы одной линии мира: идущие (их может быть несколько у старых сохранений), ждущие
 *  в очереди и герои в мобилизации. Отдельно — заказы, поставленные на паузу. */
function laneJobs(state: GameState, world: string, lane: ProductionLane) {
  const planet = state.planets[world];
  const jobs: LaneJob[] = [];
  if (!planet) return { jobs, paused: [] };
  for (const e of state.scheduled) {
    const p = e.type === 'construction.complete' ? constructionPayload(e.payload) : null;
    if (!p || p.planetId !== world || orderLane(data, p) !== lane) continue;
    jobs.push({
      seq: -1, label: orderLabel(p), unit: p.unit, building: p.building, at: e.at,
      duration: buildDurationHours(p, data, state) * HOUR, cancel: `data-pw-cancel="${esc(String(e.seq))}"`,
      cancelTitle: 'side.conveyor.cancel.title',
    });
  }
  for (const q of planet.buildQueue ?? []) {
    if (orderLane(data, q) !== lane) continue;
    jobs.push({
      seq: q.id, label: orderLabel(q), unit: q.unit, building: q.building,
      duration: hoursMs(queuedOrderHours(q, data, state)),
      cancel: `data-pw-cancel="${esc(String(q.id))}"`, cancelTitle: 'side.conveyor.dequeue.title',
    });
  }
  if (lane === 'mobilization')
    for (const h of Object.values(state.heroes ?? {})) {
      const p = h.mobilization;
      if (!p || p.target !== world) continue;
      const unit = heroFlagshipUnit(h, data);
      jobs.push({
        seq: p.queued ? (p.orderId ?? 0) : -1, label: heroDisplayName(h), unit,
        // Срок героя — срок его флагмана, как считает ядро: без него у ждущего героя и у
        // всех заказов за ним не было бы времени готовности. Идущую мобилизацию ядро не
        // отменяет: крестик только у ждущего героя.
        ...(p.queued
          ? {
              duration: matchUnitHours(state, data.units[unit]?.buildTimeHours || 10) * HOUR,
              cancel: `data-pw-hero-cancel="${esc(h.id)}"`, cancelTitle: 'side.conveyor.dequeue.title',
            }
          : { at: p.readyAt, duration: p.readyAt - p.startedAt, cancel: '' }),
      });
    }
  jobs.sort((a, b) => a.seq - b.seq);
  const paused = (planet.pausedConstruction ?? []).filter((p) => orderLane(data, p) === lane);
  return { jobs, paused };
}

function jobArt(job: Pick<LaneJob, 'unit' | 'building'>): string {
  return (job.unit ? catalogPortraitHtml('u', job.unit, data, 'thumb') : '') || BUILD_ICON[job.building ?? ''] || '';
}

function laneCard(state: GameState, world: string, lane: ProductionLane, active: ProductionLane | null): string {
  const { jobs, paused } = laneJobs(state, world, lane);
  const run = jobs[0];
  const more = jobs.length - 1 + paused.length;
  const idleArt = LANE_ART[lane] ? catalogPortraitHtml('u', LANE_ART[lane]!, data, 'thumb') : holoIcon('hammer');
  const bar =
    run?.at !== undefined && run.duration
      ? `<progress max="100" value="${barPct(run.at, run.duration, state.time)}"></progress>`
      : '';
  const status = run
    ? `<b>${esc(run.label)}</b>${bar}`
    : `<b class="pw-lane-free">${t(paused.length ? 'production.lane.paused' : 'production.lane.free')}</b>`;
  const end = run
    ? `${run.at !== undefined ? liveTimerHtml(run.at, 'hms') : `<span>${t('build.state.waiting')}</span>`}${more > 0 ? `<span class="pw-lane-more">+${more}</span>` : ''}`
    : holoIcon('plus-circle');
  return (
    `<button class="pw-lane-card${lane === active ? ' on' : ''}${run ? '' : ' idle'}" data-pw-lane="${lane}" aria-pressed="${lane === active}">` +
    `<span class="pw-lane-art${run ? '' : ' dim'}">${run ? jobArt(run) || idleArt : idleArt}</span>` +
    `<span class="pw-lane-text"><small>${t(LANE_NAME[lane])}</small>${status}</span>` +
    `<span class="pw-lane-end">${end}</span></button>`
  );
}

/** Главный экран окна: четыре линии мира, свободные тоже. Нажатие на линию открывает её
 *  каталог; идущий заказ, его остаток и число ждущих видны без каталога. */
export function productionLanesHtml(state: GameState, world: string, active: ProductionLane | null): string {
  if (!state.planets[world]) return '';
  return PRODUCTION_LANES.map((lane) => laneCard(state, world, lane, active)).join('');
}

/** Раскрыта ли очередь открытой линии; переживает перерисовки окна, но не смену линии
 *  или мира: раскрывали ту очередь, а не эту. */
let stripOpen = false;
let stripOf = '';
export function toggleLaneStrip(): void {
  stripOpen = !stripOpen;
}

/** Очередь открытой линии над её каталогом (`decisions/laneQueue.ts`): строка на заказ —
 *  когда будет готов, отмена; приостановленный — с «Продолжить», когда линия свободна.
 *  Длинная очередь сворачивается до идущего и «+N» со сроком всей линии. */
export function laneStripHtml(state: GameState, world: string, lane: ProductionLane): string {
  if (stripOf !== `${world}:${lane}`) {
    stripOf = `${world}:${lane}`;
    stripOpen = false;
  }
  const { jobs, paused } = laneJobs(state, world, lane);
  if (!jobs.length && !paused.length) return `<p class="pw-strip-idle">${t('production.lane.idle')}</p>`;
  const ready = laneReadyTimes(state.time, jobs);
  const timer = (at: number | undefined): string => (at === undefined ? '<span></span>' : liveTimerHtml(at, 'hms'));
  const rows = jobs.map(
    (j, i) =>
      `<div class="pw-job${j.at === undefined ? ' waiting' : j.duration ? ' run' : ''}"><span class="pw-job-art">${jobArt(j)}</span><b>${esc(j.label)}</b>` +
      timer(ready[i]) +
      (j.cancel ? `<button class="btn-x" ${j.cancel} aria-label="${t(j.cancelTitle ?? 'side.conveyor.cancel.title')}" title="${t(j.cancelTitle ?? 'side.conveyor.cancel.title')}">×</button>` : '<span></span>') +
      `${j.at !== undefined && j.duration ? `<progress max="100" value="${barPct(j.at, j.duration, state.time)}"></progress>` : ''}</div>`,
  );
  const canResume = laneCanResume(jobs);
  const resumeTitle = t(canResume ? 'side.conveyor.resume.title' : 'err.lane-busy');
  const resume = paused.map(
    (p) =>
      `<div class="pw-job paused"><span class="pw-job-art">${jobArt(p)}</span><b>${esc(orderLabel(p))}</b>` +
      `<span class="pw-job-pct">${t('side.conveyor.paused', { n: Math.round(p.progress * 100) })}</span>` +
      `<button class="pw-paused" data-pw-resume="${esc(String(p.id))}"${canResume ? '' : ' disabled'} aria-label="${resumeTitle}" title="${resumeTitle}">▶</button></div>`,
  );
  const all = [...rows, ...resume];
  const shown = laneVisibleRows(all.length, stripOpen);
  if (shown === all.length && all.length <= 2) return all.join('');
  const hide = (row: string): string => row.replace('<div class="pw-job', '<div hidden class="pw-job');
  const last = ready.length ? ready[ready.length - 1] : undefined;
  const toggle =
    `<button class="pw-strip-more" data-pw-strip-more aria-expanded="${stripOpen}">` +
    (stripOpen
      ? `${t('production.queue.less')} ▴`
      : `<b>${t('production.queue.more', { n: all.length - 1 })}</b>${last === undefined ? '' : liveTimerHtml(last, 'hms')} ▾`) +
    `</button>`;
  return all.map((row, i) => (i < shown ? row : hide(row))).join('') + toggle;
}
