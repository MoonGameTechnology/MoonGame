import { newMatchSummary, type Phrase } from '../../decisions/newMatchSettings';
import { t, tData } from '../../localization/runtime';
import { esc } from './format';
import { MAP_IDS, fixedSideMode, mapPreset, victoryFor, type MapId } from './mapCatalog';
import { drawOrder, lanes, mapViewBox } from './setupMap';

/** Окно «Настройки матча»: кнопка «Создать» на странице «Матчи» открывает его, а партию
 *  создаёт только подтверждение здесь. Право создавать проверяет сервер на самом запросе. */
let chosen: MapId = MAP_IDS[0];

const phrase = (p: Phrase): string => t(p.key, p.params);

/** Мини-карта выбранной карты: трассы, миры и стартовые места. Только просмотр. */
export function mapPreviewSvg(mapId: MapId): string {
  const preset = mapPreset(mapId);
  const order = drawOrder(preset.nodes, preset.starts);
  const span = mapViewBox(preset.nodes, 0);
  const r = Math.max(span.w, span.h) / 60;
  const box = mapViewBox(preset.nodes, r * 2);
  let svg = '';
  for (const l of lanes(preset.nodes))
    svg += `<line x1="${l.from.x}" y1="${l.from.y}" x2="${l.to.x}" y2="${l.to.y}" class="lane"/>`;
  for (const n of order.plain)
    svg += `<circle cx="${n.x}" cy="${n.y}" r="${n.sector === 'planet' ? r * 0.45 : r * 0.3}" class="node"/>`;
  for (const n of order.candidates) svg += `<circle cx="${n.x}" cy="${n.y}" r="${r}" class="start"/>`;
  return `<svg class="mcd-map" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${svg}</svg>`;
}

/** Сводка правил: те же режим и условия победы, с которыми хост поднимет партию. */
export function matchSettingsHtml(mapId: MapId): string {
  // Режим — как его запишет `newGame`: команды карты, иначе режим из файла карты.
  const modeId = fixedSideMode(mapId) ?? mapPreset(mapId).map?.mode;
  const summary = newMatchSummary({
    seats: mapPreset(mapId).starts.length,
    ...(modeId ? { modeId } : {}),
    victory: victoryFor({ mapId, ...(modeId ? { modeId } : {}) }),
  });
  const mode = 'dataName' in summary.mode ? tData(summary.mode.dataName) : phrase(summary.mode);
  const item = (label: string, value: string): string =>
    `<div><dt>${esc(t(label))}</dt><dd>${esc(value)}</dd></div>`;
  return (
    mapPreviewSvg(mapId) +
    `<p class="mcd-info">${esc(t(`setup.map.${mapId}-info`))}</p>` +
    `<dl>` +
    item('browser.description.players', phrase(summary.players)) +
    item('browser.description.mode', `${t('browser.mode.pvp')} · ${mode}`) +
    item('browser.description.goal', summary.goals.map(phrase).join(' · ')) +
    `</dl>`
  );
}

export function matchCreateDialogHtml(mapId: MapId): string {
  const chips = MAP_IDS.map(
    (id) =>
      `<button type="button" class="mcd-chip btn-second${id === mapId ? ' on' : ''}" data-map="${id}" ` +
      `aria-pressed="${id === mapId}">${esc(t(`setup.map.${id}`))}</button>`,
  ).join('');
  return (
    `<h2 id="match-create-title">${esc(t('browser.create.title'))}</h2>` +
    `<div class="mcd-maps" role="group" aria-label="${esc(t('browser.create.map'))}">${chips}</div>` +
    `<div class="mcd-rules">${matchSettingsHtml(mapId)}</div>` +
    `<div class="mcd-actions">` +
    `<button type="button" class="mbtn btn-quiet" data-mcd-cancel>${esc(t('browser.create.cancel'))}</button>` +
    `<button type="button" class="mbtn btn-main" data-mcd-go>${esc(t('browser.create.confirm'))}</button>` +
    `</div>`
  );
}

export function isMatchCreateDialogOpen(): boolean {
  return (document.getElementById('match-create-dialog') as HTMLDialogElement | null)?.open === true;
}

/** Открыть окно; `create` зовётся только по кнопке «Создать матч» с выбранной картой. */
export function openMatchCreateDialog(create: (mapId: MapId) => void): void {
  if (isMatchCreateDialogOpen()) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'match-create-dialog';
  dialog.setAttribute('aria-labelledby', 'match-create-title');
  dialog.innerHTML = matchCreateDialogHtml(chosen);
  const rules = dialog.querySelector('.mcd-rules')!;
  dialog.querySelector('.mcd-maps')!.addEventListener('click', (event) => {
    const chip = (event.target as Element).closest<HTMLElement>('[data-map]');
    if (!chip) return;
    chosen = chip.dataset.map as MapId;
    for (const b of Array.from(dialog.querySelectorAll<HTMLElement>('[data-map]'))) {
      const on = b === chip;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    rules.innerHTML = matchSettingsHtml(chosen);
  });
  dialog.querySelector('[data-mcd-cancel]')!.addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-mcd-go]')!.addEventListener('click', () => {
    dialog.close();
    create(chosen);
  });
  // Escape закрывает только окно; глобальные клавиши приложения остаются под ним.
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('close', () => dialog.remove());
  document.body.appendChild(dialog);
  dialog.showModal();
}
