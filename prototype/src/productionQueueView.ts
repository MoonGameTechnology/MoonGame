import { holoIcon } from './holographicIcons';
import { heroDisplayName } from './heroStaff';
import { orderLane, type GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { data } from './gameData';
import { displayUnit, buildingName, esc } from './format';
import { liveTimerHtml } from './liveTimers';
import { buildDurationHours, constructionPayload, barPct } from './buildProgress';
import { HOUR } from './time';
import { catalogPortraitHtml } from './shipArt';
import { BUILD_ICON } from './icons';
import { heroFlagshipUnit } from '../../packages/shared-core/src/state/heroFlagship';
import { YARD_GROUND_HULLS, YARD_HULLS, YARD_SQUAD_HULLS } from './productionRoster';
import { PRODUCTION_LANES, type ProductionLane } from '../../decisions/productionSections';

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
  /** Идёт: когда закончится и сколько длится (для полосы). Ждёт: нет. */
  at?: number;
  duration?: number;
  /** Атрибут кнопки отмены; пусто — отменить нельзя. */
  cancel: string;
}

const orderLabel = (o: { unit?: string; count?: number; building?: string }): string =>
  o.unit ? `${displayUnit(o.unit)} ×${o.count ?? 1}` : buildingName(data.buildings[o.building ?? '']?.name, o.building ?? '');

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
    });
  }
  for (const q of planet.buildQueue ?? []) {
    if (orderLane(data, q) !== lane) continue;
    jobs.push({ seq: q.id, label: orderLabel(q), unit: q.unit, building: q.building, cancel: `data-pw-cancel="${esc(String(q.id))}"` });
  }
  if (lane === 'mobilization')
    for (const h of Object.values(state.heroes ?? {})) {
      const p = h.mobilization;
      if (!p || p.target !== world) continue;
      jobs.push({
        seq: p.queued ? (p.orderId ?? 0) : -1, label: heroDisplayName(h), unit: heroFlagshipUnit(h, data),
        // Идущую мобилизацию ядро не отменяет: крестик только у ждущего героя.
        ...(p.queued ? { cancel: `data-pw-hero-cancel="${esc(h.id)}"` } : { at: p.readyAt, cancel: '' }),
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

/** Очередь открытой линии над её каталогом: каждый заказ с отменой, пауза — с «Продолжить».
 *  Заказал — тут же видишь, что он встал в линию. */
export function laneStripHtml(state: GameState, world: string, lane: ProductionLane): string {
  const { jobs, paused } = laneJobs(state, world, lane);
  if (!jobs.length && !paused.length) return `<p class="pw-strip-idle">${t('production.lane.idle')}</p>`;
  const rows = jobs.map(
    (j) =>
      `<div class="pw-job${j.at === undefined ? ' waiting' : ''}"><span class="pw-job-art">${jobArt(j)}</span><b>${esc(j.label)}</b>` +
      `${j.at === undefined ? `<span class="pw-job-wait">${t('build.state.waiting')}</span>` : liveTimerHtml(j.at, 'hms')}` +
      `${j.cancel ? `<button class="btn-x" ${j.cancel} aria-label="${t('side.conveyor.cancel.title')}">×</button>` : ''}` +
      `${j.at !== undefined && j.duration ? `<progress max="100" value="${barPct(j.at, j.duration, state.time)}"></progress>` : ''}</div>`,
  );
  const resume = paused.map(
    (p) =>
      `<button class="pw-paused" data-pw-resume="${esc(String(p.id))}">${t('side.conveyor.resume.title')} · ${esc(p.unit ? displayUnit(p.unit) : buildingName(data.buildings[p.building ?? '']?.name, p.building ?? ''))} · ${Math.round(p.progress * 100)}%</button>`,
  );
  return rows.join('') + resume.join('');
}
