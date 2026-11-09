/**
 * Свёрнутые блоки окна «i» мира (UIX-10.12): постройки, их группы и эскадра. Блок помнит,
 * что игрок раскрыл, до конца вкладки: панель перерисовывается на каждом изменении мира, и
 * нативный `<details>` терял бы раскрытие на каждом кадре. Модуль отдельный и лёгкий:
 * его читают панель (тап по заголовку) и гид обучения (раскрыт ли блок).
 */
import { esc } from './format';

/** Раскрытые блоки: `buildings`, `wing`, `grp:<группа>`. */
const opened = new Set<string>();

/** Тап по заголовку свёрнутого блока (`data-act="dossier"`). */
export function toggleDossierBlock(key: string): void {
  if (!opened.delete(key)) opened.add(key);
}

/** Раскрыт ли блок — для шагов обучения. */
export function isDossierOpen(key: string): boolean {
  return opened.has(key);
}

/** Свёрнутый блок: заголовок со счётчиком, тело — только раскрытому. */
export function foldHtml(key: string, title: string, count: number, body: () => string): string {
  const on = opened.has(key);
  return (
    `<div class="dfold${on ? ' on' : ''}">` +
    `<button class="dfold-h" data-act="dossier" data-arg="${esc(key)}" aria-expanded="${on}">` +
    `<span>${esc(title)}</span><b>${count}</b><i aria-hidden="true">${on ? '▾' : '▸'}</i></button>` +
    (on ? `<div class="dfold-b">${body()}</div>` : '') +
    `</div>`
  );
}
