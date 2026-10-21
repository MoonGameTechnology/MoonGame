import { t, tData } from '../../localization/runtime';
import type { MatchRow } from './matchBrowser';
import { esc } from './format';
import { fmtJoinWindow, joinWindow } from './matchRow';

/** Read-only details from the same server row as the browser; opening never claims a seat. */
export function matchDescriptionHtml(match: MatchRow, mapName: string): string {
  const item = (label: string, value: string): string =>
    `<div><dt>${esc(t(label))}</dt><dd>${esc(value)}</dd></div>`;
  const unknown = t('browser.description.unknown');
  const kind = match.kind ? t(match.kind === 'pve' ? 'browser.mode.pve' : 'browser.mode.pvp') : '';
  const mode = [kind, match.modeId ? tData(match.modeId) : ''].filter(Boolean).join(' · ');
  const window = joinWindow(match, 'available');
  const entry =
    match.status === 'ended' || match.entryOpen === false
      ? t('acc.join-closed')
      : window.kind === 'open'
        ? t('browser.join-window', { dur: fmtJoinWindow(window.left) })
        : match.entryOpen === true
          ? t('browser.description.entry-open')
          : unknown;
  const goals: string[] = [];
  if (match.kind === 'pve') goals.push(t('browser.description.pve'));
  else {
    if (match.rules.victory?.scoreLimit)
      goals.push(t('browser.description.score', { n: match.rules.victory.scoreLimit }));
    if (match.rules.victory?.dominationPercent)
      goals.push(
        t('browser.description.domination', {
          p: Math.round(match.rules.victory.dominationPercent * 100),
        }),
      );
    if (match.rules.victory?.scoreLimit && match.rules.victory.coalitionFactor !== undefined)
      goals.push(
        t('browser.description.coalition', {
          p: Math.round(match.rules.victory.coalitionFactor * 100),
        }),
      );
  }
  return (
    `<h2 id="match-description-title">${esc(t('browser.description.title'))}</h2>` +
    `<h3>${esc(mapName)}</h3>` +
    (match.kind === 'pvp' ? `<p>${esc(t('browser.description.pvp'))}</p>` : '') +
    `<dl>` +
    item('browser.description.mode', mode || unknown) +
    item(
      'browser.description.players',
      t('browser.players', { s: match.players.seated, c: match.players.capacity }),
    ) +
    item(
      'browser.description.progress',
      `${t('browser.day', { n: match.days })} · ${t(match.status === 'ended' ? 'browser.finished' : 'browser.running')}`,
    ) +
    item('browser.description.speed', `×${match.rules.timeScale ?? 1}`) +
    item('browser.description.goal', goals.join(' · ') || unknown) +
    item('browser.description.entry', entry) +
    item('browser.description.number', match.matchId) +
    `</dl><button type="button" class="mbtn btn-second" data-description-close>${esc(t('browser.description.close'))}</button>`
  );
}

export function isMatchDescriptionOpen(): boolean {
  return (document.getElementById('match-description') as HTMLDialogElement | null)?.open === true;
}

export function closeMatchDescription(): void {
  (document.getElementById('match-description') as HTMLDialogElement | null)?.close();
}

export function openMatchDescription(match: MatchRow, mapName: string): void {
  if (isMatchDescriptionOpen()) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'match-description';
  dialog.setAttribute('aria-labelledby', 'match-description-title');
  dialog.innerHTML = matchDescriptionHtml(match, mapName);
  dialog.querySelector('[data-description-close]')!.addEventListener('click', () => dialog.close());
  // Escape closes only the native dialog; the app's global shortcuts stay underneath.
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('close', () => dialog.remove());
  document.body.appendChild(dialog);
  dialog.showModal();
}
