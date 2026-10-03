import type {
  CorpInfrastructureView,
  CorpBuildingLevel,
} from '../../packages/protocol/src/corpInfrastructure';
import { corpConstructionProgress } from '../../decisions/corpInfrastructure';
import { t } from '../../localization/runtime';
import { esc, nfmt } from './format';

const errorKey = {
  E_FORBIDDEN: 'corp.buildings.lead-only',
  E_CORP_BUILDING: 'err.corp-building',
  E_CORP_BUILD_BUSY: 'err.corp-build-busy',
  E_CORP_BUILD_LEVEL: 'err.corp-build-level',
  E_CORP_BUILD_MAX: 'err.corp-build-max',
  E_CORP_BUILD_REQUIRES: 'err.corp-build-requires',
  E_INSUFFICIENT: 'err.insufficient',
};

function duration(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  return t('corp.buildings.duration', { h: Math.floor(minutes / 60), m: minutes % 60 });
}

function effects(
  level: Pick<CorpBuildingLevel, 'influencePerDay' | 'constructionReduction'>,
): string {
  return [
    level.influencePerDay > 0 ? t('corp.buildings.income', { n: level.influencePerDay }) : '',
    level.constructionReduction > 0
      ? t('corp.buildings.speed', { n: level.constructionReduction })
      : '',
  ]
    .filter(Boolean)
    .map((text) => `<span>${esc(text)}</span>`)
    .join('');
}

export function corpBuildingsHtml(
  view: CorpInfrastructureView | null,
  elapsedMs = 0,
  busy = false,
): string {
  const refresh = `<button class="cbtn2 btn-second" data-corpact="refresh"${busy ? ' disabled' : ''}>${t('corp.buildings.refresh')}</button>`;
  if (!view) return `<p class="chint">${t('corp.buildings.unavailable')}</p>${refresh}`;
  const progress = corpConstructionProgress(view, elapsedMs);
  const job = view.construction;
  const queue =
    job && progress
      ? `<section class="cbuild-queue" aria-live="polite"><b>${esc(
          t('corp.buildings.queue', {
            name: t(view.buildings.find((b) => b.id === job.buildingId)!.nameKey),
            n: job.level,
          }),
        )}</b><progress max="100" value="${progress.percent}" aria-label="${esc(t('corp.buildings.title'))}"></progress>` +
        `<span data-corp-countdown>${progress.remainingMs > 0 ? esc(t('corp.buildings.remaining', { time: duration(progress.remainingMs) })) : t('corp.buildings.settling')}</span></section>`
      : `<p class="chint">${t('corp.buildings.idle')}</p>`;
  const cards = view.buildings
    .map((b) => {
      const current = b.levels[b.level - 1];
      const next = b.next;
      const disabled = busy || !view.canBuild || b.blocked !== null || !next;
      const reason = b.blocked ? t(errorKey[b.blocked]) : '';
      return (
        `<article class="cbuild-card"><header><b>${esc(t(b.nameKey))}</b><span>${t('corp.buildings.level', { level: b.level, max: b.levels.length })}</span></header>` +
        `<p class="chint">${esc(t(b.descriptionKey))}</p>` +
        (current
          ? `<div class="cbuild-effects"><small>${t('corp.buildings.current')}</small>${effects(current)}</div>`
          : '') +
        (next
          ? `<div class="cbuild-effects"><small>${t('corp.buildings.next')}</small>${effects(next)}</div>` +
            `<p>${next.cost ? t('corp.buildings.cost', { n: nfmt(next.cost) }) : t('corp.buildings.free')} · ${duration(next.actualDurationMs)}</p>` +
            (next.headquarters
              ? `<p class="chint">${t('corp.buildings.requirement', { n: next.headquarters })}</p>`
              : '')
          : '') +
        `<button class="cbtn2 wide btn-main" data-corpact="build" data-corparg="${esc(b.id)}"${disabled ? ' disabled' : ''}>${!next ? t('corp.buildings.max') : b.level ? t('corp.buildings.upgrade') : t('corp.buildings.build')}</button>` +
        (reason && next ? `<p class="chint">${esc(reason)}</p>` : '') +
        `</article>`
      );
    })
    .join('');
  return (
    `<div class="cbuild-heading"><h4>${t('corp.buildings.title')}</h4>${refresh}</div>` +
    `<div class="cbuild-summary"><b>${nfmt(view.influence)} ⟡</b>${effects(view)}</div>` +
    `<p class="chint">${t('corp.buildings.rules')}</p>` +
    (!view.canBuild ? `<p class="chint">${t('corp.buildings.lead-only')}</p>` : '') +
    queue +
    `<div class="cbuild-grid">${cards}</div>`
  );
}

/** Update only the timer nodes: keyboard focus on a build button survives the tick. */
export function updateCorpConstructionCountdown(
  root: HTMLElement,
  view: CorpInfrastructureView,
  elapsedMs: number,
): void {
  const progress = corpConstructionProgress(view, elapsedMs);
  if (!progress) return;
  const bar = root.querySelector('progress');
  const label = root.querySelector('[data-corp-countdown]');
  if (bar) bar.value = progress.percent;
  if (label)
    label.textContent =
      progress.remainingMs > 0
        ? t('corp.buildings.remaining', { time: duration(progress.remainingMs) })
        : t('corp.buildings.settling');
}
