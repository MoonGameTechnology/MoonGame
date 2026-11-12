/**
 * Окно перебежчика и его значок над картой (решение владельца 2026-11-11). Контрразведка
 * перевербовала чужого агента — он просит перейти к нам: «Принять» делает его нашим шпионом,
 * «Отказать» — и он сбегает. Что показать, решает `decisions/spyDefector.ts`; правило — ядро.
 *
 * Значок живёт в стопке тостов, но тостом не является: его не вытесняют и он не гаснет сам —
 * он стоит, пока в мире есть перебежчик без ответа (правило 1 решения), и открывает окно.
 */
import type { Action, DomainEvent, GameState } from '../../packages/shared-core/src/index';
import { TURNED_HOURS } from '../../packages/shared-core/src/index';
import { answerDefector } from '../../decisions/actions';
import { defectorCards, defectorNews, type DefectorCard } from '../../decisions/spyDefector';
import { t } from '../../localization/runtime';
import { countdownHMS, esc } from './format';

export interface DefectorHost {
  state(): GameState;
  me(): string;
  names(): Record<string, string>;
  placeName(id: string): string;
  order(action: Action): boolean;
  /** Строка в ленту; `quiet` — без тоста. */
  note(line: string, quiet: boolean): void;
  /** Та же строка — в журнал шпионажа. */
  spyLog(line: string, type: string, payload: Record<string, unknown>): void;
}

const DIALOG_ID = 'defector-offer';
const CHIP_CLASS = 'defector-pending';

export function isDefectorDialogOpen(): boolean {
  return (document.getElementById(DIALOG_ID) as HTMLDialogElement | null)?.open === true;
}

export function closeDefectorDialog(): void {
  (document.getElementById(DIALOG_ID) as HTMLDialogElement | null)?.close();
}

function cardHtml(host: DefectorHost, c: DefectorCard): string {
  const who = host.names()[c.from] ?? c.from;
  return (
    `<div class="defector-card" data-offer="${c.offerId}">` +
    `<p>${esc(t('spy.defector.body', { who, at: host.placeName(c.planetId) }))}</p>` +
    (c.xp > 0 ? `<p>${esc(t('spy.defector.xp', { l: c.level, n: c.xp }))}</p>` : '') +
    `<p>${esc(t('spy.defector.left', { t: countdownHMS(c.leftMs) }))}</p>` +
    `<div class="fortress-dialog-actions">` +
    `<button type="button" class="btn-second" data-defector-refuse="${c.offerId}">${esc(t('spy.defector.refuse'))}</button>` +
    `<button type="button" class="btn-main" data-defector-accept="${c.offerId}">${esc(t('spy.defector.accept'))}</button>` +
    `</div></div>`
  );
}

/** Окно со всеми перебежчиками, ждущими ответа. Ответили всем — окно закрывается. */
export function openDefectorDialog(host: DefectorHost): void {
  if (document.getElementById(DIALOG_ID)) return;
  const dialog = document.createElement('dialog');
  dialog.id = DIALOG_ID;
  dialog.setAttribute('aria-labelledby', `${DIALOG_ID}-title`);
  const render = (): boolean => {
    const cards = defectorCards(host.state(), host.me(), host.state().time);
    if (cards.length === 0) return false;
    dialog.innerHTML =
      `<h2 id="${DIALOG_ID}-title">${esc(t('spy.defector.title'))}</h2>` +
      cards.map((c) => cardHtml(host, c)).join('') +
      `<div class="fortress-dialog-actions"><button type="button" class="btn-second" data-defector-close>${esc(t('browser.description.close'))}</button></div>`;
    return true;
  };
  dialog.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-defector-close]')) return dialog.close();
    const yes = target.closest<HTMLElement>('[data-defector-accept]')?.dataset.defectorAccept;
    const no = target.closest<HTMLElement>('[data-defector-refuse]')?.dataset.defectorRefuse;
    const id = Number(yes ?? no);
    if (!Number.isInteger(id)) return;
    host.order(answerDefector(host.me(), id, yes !== undefined));
    if (!render()) dialog.close();
    syncDefectorChip(host);
  });
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('close', () => dialog.remove());
  if (!render()) return;
  document.body.appendChild(dialog);
  dialog.showModal();
}

/** Значок «перебежчик ждёт ответа»: стоит, пока ждёт хоть один; нажатие открывает окно. */
export function syncDefectorChip(host: DefectorHost): void {
  const stack = document.getElementById('toasts');
  if (!stack) return;
  const n = defectorCards(host.state(), host.me(), host.state().time).length;
  let chip = stack.querySelector<HTMLElement>(`.${CHIP_CLASS}`);
  if (n === 0) {
    chip?.remove();
    if (isDefectorDialogOpen()) closeDefectorDialog();
    return;
  }
  if (!chip) {
    chip = document.createElement('div');
    chip.className = `toast jump ${CHIP_CLASS}`;
    chip.setAttribute('role', 'button');
    chip.addEventListener('click', () => openDefectorDialog(host));
    stack.prepend(chip);
  }
  chip.textContent = `${t('spy.defector.pending', { n })} ↪`;
}

/** Пакет событий: строки о перебежчиках в ленту, значок — по состоянию мира. */
export function defectorEvents(events: DomainEvent[], host: DefectorHost): void {
  for (const e of events) {
    const payload = e.payload as Record<string, unknown>;
    const news = defectorNews(e.type, payload, host.me());
    if (!news) continue;
    const who = host.names()[news.from] ?? news.from;
    const line = t(news.key, { who, n: TURNED_HOURS });
    host.note(line, news.quiet);
    host.spyLog(line, e.type, payload);
  }
  syncDefectorChip(host);
}
