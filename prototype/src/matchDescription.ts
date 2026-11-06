import { t, tData } from '../../localization/runtime';
import { modeRepeatsMap } from '../../decisions/matchCard';
import type { MatchRow } from './matchBrowser';
import { esc, gameStamp } from './format';
import { fmtJoinWindow, joinWindow } from './matchRow';

/** Действие владельца строки в «Описании»: «В архив» или «Восстановить» (UIX-10.4). На
 *  карточке оно было третьей кнопкой, а нужно редко. */
export interface DescriptionAction {
  label: string;
  run(): void;
}

/** Read-only details from the same server row as the browser; opening never claims a seat.
 *  The title is the map name itself, and no row repeats it: a mode that only restates the
 *  map's format («Двое на двое» under «2 на 2») is left out (`decisions/matchCard.ts`, rule 1). */
export function matchDescriptionHtml(match: MatchRow, mapName: string, action?: DescriptionAction): string {
  const item = (label: string, value: string): string =>
    `<div><dt>${esc(t(label))}</dt><dd>${esc(value)}</dd></div>`;
  const unknown = t('browser.description.unknown');
  const mode = match.modeId !== undefined && !modeRepeatsMap(match.modeId) ? tData(match.modeId) : '';
  const window = joinWindow(match, 'available');
  // The label already says «entry», so the value names only its state.
  const entry =
    match.status === 'ended' || match.entryOpen === false
      ? t('browser.description.entry-closed')
      : window.kind === 'open'
        ? t('browser.description.entry-left', { dur: fmtJoinWindow(window.left) })
        : match.entryOpen === true
          ? t('browser.description.entry-open')
          : unknown;
  const goals: string[] = [];
  const endsAt = match.rules.victory?.endsAt;
  const capitalCapture = !!match.rules.victory?.capitalCapture;
  // The server's deadline is absolute GAME time, never a wall-clock timestamp or
  // a remaining duration. Use the same day numbering as the in-match clock/log.
  const deadline = capitalCapture ? t('browser.description.no-deadline') :
    endsAt !== undefined && Number.isFinite(endsAt) && endsAt >= 0
    ? t('browser.description.timeout', { at: gameStamp(endsAt) })
    : unknown;
  if (match.kind === 'pve') goals.push(t('browser.description.pve'));
  else if (capitalCapture) goals.push(t('browser.description.capitals'));
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
  // A running match is the normal state; only an ended one says so.
  const progress = t('browser.day', { n: match.days }) + (match.status === 'ended' ? ` · ${t('browser.finished')}` : '');
  return (
    `<h2 id="match-description-title">${esc(mapName)}</h2>` +
    `<dl>` +
    (mode ? item('browser.description.mode', mode) : '') +
    item('browser.description.players', t('browser.description.seats', { s: match.players.seated, c: match.players.capacity })) +
    item('browser.description.progress', progress) +
    item('browser.description.speed', `×${match.rules.timeScale ?? 1}`) +
    item('browser.description.goal', goals.join(' · ') || unknown) +
    item('browser.description.deadline', deadline) +
    item('browser.description.entry', entry) +
    item('browser.description.number', match.matchId) +
    `</dl><div class="mdesc-btns">` +
    (action ? `<button type="button" class="mbtn btn-quiet" data-description-action>${esc(action.label)}</button>` : '') +
    `<button type="button" class="mbtn btn-second" data-description-close>${esc(t('browser.description.close'))}</button></div>`
  );
}

export function isMatchDescriptionOpen(): boolean {
  return (document.getElementById('match-description') as HTMLDialogElement | null)?.open === true;
}

export function closeMatchDescription(): void {
  (document.getElementById('match-description') as HTMLDialogElement | null)?.close();
}

export function openMatchDescription(match: MatchRow, mapName: string, action?: DescriptionAction): void {
  if (isMatchDescriptionOpen()) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'match-description';
  dialog.setAttribute('aria-labelledby', 'match-description-title');
  dialog.innerHTML = matchDescriptionHtml(match, mapName, action);
  dialog.querySelector('[data-description-close]')!.addEventListener('click', () => dialog.close());
  // The window closes BEFORE the action runs: the browser does not redraw its list under an
  // open description, and archiving answers with exactly that redraw.
  dialog.querySelector('[data-description-action]')?.addEventListener('click', () => {
    dialog.close();
    action?.run();
  });
  // Escape closes only the native dialog; the app's global shortcuts stay underneath.
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('close', () => dialog.remove());
  document.body.appendChild(dialog);
  dialog.showModal();
}
