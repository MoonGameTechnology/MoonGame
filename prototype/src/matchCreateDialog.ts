import type { MatchCreationSettings } from '../../decisions/matchCreation';
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

/** Выбор в окне: карта и, если сервер их предлагает, скорость и действия за золото. */
export interface MatchCreateChoice {
  mapId: MapId;
  timeScale?: number;
  goldActions?: boolean;
}

/** Ряд кнопок-сегментов с одним выбранным. */
function segments(group: string, label: string, items: ReadonlyArray<{ value: string; text: string }>, on: string): string {
  const buttons = items
    .map(
      (it) =>
        `<button type="button" class="mcd-chip btn-second${it.value === on ? ' on' : ''}" data-${group}="${esc(it.value)}" ` +
        `aria-pressed="${it.value === on}">${esc(it.text)}</button>`,
    )
    .join('');
  return (
    `<div class="mcd-field"><span class="mcd-label">${esc(t(label))}</span>` +
    `<div class="mcd-segs mcd-${group}" role="group" aria-label="${esc(t(label))}">${buttons}</div></div>`
  );
}

export function matchCreateDialogHtml(choice: MatchCreateChoice, options: MatchCreationSettings): string {
  const chips = MAP_IDS.map(
    (id) =>
      `<button type="button" class="mcd-chip btn-second${id === choice.mapId ? ' on' : ''}" data-map="${id}" ` +
      `aria-pressed="${id === choice.mapId}">${esc(t(`setup.map.${id}`))}</button>`,
  ).join('');
  const speed =
    options.speeds.length > 1 && choice.timeScale !== undefined
      ? segments(
          'speed',
          'browser.description.speed',
          options.speeds.map((v) => ({ value: String(v), text: `×${v}` })),
          String(choice.timeScale),
        ) + `<p class="mcd-hint">${esc(t('browser.create.speed-hint', { n: choice.timeScale }))}</p>`
      : '';
  const gold =
    options.goldActions && choice.goldActions !== undefined
      ? segments(
          'gold',
          'browser.create.gold',
          [
            { value: 'on', text: t('browser.create.gold.on') },
            { value: 'off', text: t('browser.create.gold.off') },
          ],
          choice.goldActions ? 'on' : 'off',
        )
      : '';
  return (
    `<h2 id="match-create-title">${esc(t('browser.create.title'))}</h2>` +
    `<div class="mcd-maps" role="group" aria-label="${esc(t('browser.create.map'))}">${chips}</div>` +
    `<div class="mcd-rules">${matchSettingsHtml(choice.mapId)}</div>` +
    speed +
    gold +
    `<div class="mcd-actions">` +
    `<button type="button" class="mbtn btn-quiet" data-mcd-cancel>${esc(t('browser.create.cancel'))}</button>` +
    `<button type="button" class="mbtn btn-main" data-mcd-go>${esc(t('browser.create.confirm'))}</button>` +
    `</div>`
  );
}

/** Начальный выбор: прошлая карта, скорость хоста по умолчанию, золото разрешено. */
export function initialChoice(options: MatchCreationSettings): MatchCreateChoice {
  const speed = options.defaultSpeed ?? options.speeds[options.speeds.length - 1];
  return {
    mapId: chosen,
    ...(options.speeds.length > 1 && speed !== undefined ? { timeScale: speed } : {}),
    ...(options.goldActions ? { goldActions: true } : {}),
  };
}

export function isMatchCreateDialogOpen(): boolean {
  return (document.getElementById('match-create-dialog') as HTMLDialogElement | null)?.open === true;
}

/** Открыть окно; `create` зовётся только по кнопке «Создать матч» с тем, что выбрано. */
export function openMatchCreateDialog(
  options: MatchCreationSettings,
  create: (mapId: MapId, settings: { timeScale?: number; goldActions?: boolean }) => void,
): void {
  if (isMatchCreateDialogOpen()) return;
  const choice = initialChoice(options);
  const dialog = document.createElement('dialog');
  dialog.id = 'match-create-dialog';
  dialog.setAttribute('aria-labelledby', 'match-create-title');
  const render = (): void => {
    dialog.innerHTML = matchCreateDialogHtml(choice, options);
  };
  render();
  dialog.addEventListener('click', (event) => {
    const target = (event.target as Element).closest<HTMLElement>('button');
    if (!target || !dialog.contains(target)) return;
    const d = target.dataset;
    if (d.map) chosen = choice.mapId = d.map as MapId;
    else if (d.speed) choice.timeScale = Number(d.speed);
    else if (d.gold) choice.goldActions = d.gold === 'on';
    else if (target.hasAttribute('data-mcd-cancel')) return dialog.close();
    else if (target.hasAttribute('data-mcd-go')) {
      dialog.close();
      const { mapId, ...settings } = choice;
      return create(mapId, settings);
    } else return;
    const scroll = dialog.scrollTop;
    render();
    dialog.scrollTop = scroll;
    dialog.querySelector<HTMLElement>(`[aria-pressed="true"][data-${Object.keys(d)[0]}]`)?.focus();
  });
  // Escape закрывает только окно; глобальные клавиши приложения остаются под ним.
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('close', () => dialog.remove());
  document.body.appendChild(dialog);
  dialog.showModal();
}
