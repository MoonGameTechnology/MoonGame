/**
 * Выбор совета учёных — двое научных руководителей, которых игрок посвящает ДО того,
 * как выберет точку старта (GDD §5.2, REFM-18).
 *
 * Это «посвящение на старте»: выбор снимается в матч снимком и внутри матча уже
 * неизменен. Поэтому окно показывает ВЛИЯНИЕ каждого кандидата заранее — какую ветку
 * дерева технологий он открывает и какие узлы расгейчивает, — чтобы первый постоянный
 * выбор новичка не был выбором вслепую.
 *
 * Сам список выбранных (`setupScientists`) принадлежит сетапу и живёт у хоста: его
 * читает старт матча. Модуль берёт его хуками `chosen()`/`setChosen()`.
 *
 * Форма REFM: разметка чистая и тестируемая (`sciInfluenceText`, `sciPickBodyHtml`),
 * DOM трогает только `initSciPick(host)`.
 */
import type { GameData } from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { esc } from './format';

/** Сколько руководителей входит в совет. Больше двух посвятить нельзя. */
export const COUNCIL_SIZE = 2;

/** Что этот кандидат открывает игроку — одной строкой. Генералист не привязан к ветке;
 *  у остальных перечисляем технологии их ветки, которые без учёного просто закрыты
 *  (`has_scientist`), — это и есть влияние, которое игрок просил показать заранее. */
export function sciInfluenceText(
  id: string,
  data: GameData,
  branchLabel: (branch: string) => string,
): string {
  const def = data.scientists[id];
  if (!def) return '';
  if (!def.branch) return t('scipick.generalist');
  const opens = Object.values(data.technologies)
    .filter(
      (td) =>
        td.branch === def.branch && (td.conditions ?? []).some((c) => c.type === 'has_scientist'),
    )
    .map((td) => tData(td.name));
  const br = branchLabel(def.branch);
  return opens.length
    ? t('scipick.opens', { br, list: opens.join(', ') })
    : t('scipick.focus', { br });
}

/** Тело окна: два слота совета (пустые зовут выбрать), предупреждение о
 *  необратимости, ростер кандидатов и кнопка подтверждения. Чистая функция от того,
 *  кто уже выбран. */
export function sciPickBodyHtml(
  chosen: readonly string[],
  data: GameData,
  branchLabel: (branch: string) => string,
): string {
  const influence = (id: string): string => sciInfluenceText(id, data, branchLabel);
  const slots = Array.from({ length: COUNCIL_SIZE }, (_, i) => {
    const id = chosen[i];
    if (!id) {
      return `<div class="sp-slot empty"><div class="sp-plus">＋</div><div class="sp-hint">${t('scipick.pick')}</div></div>`;
    }
    const def = data.scientists[id];
    return (
      `<div class="sp-slot filled"><button class="sp-rm" data-sprm="${i}" title="${t('ping.remove')}">✕</button>` +
      `<div class="sp-sn">${esc(t(def?.name ?? id))}</div>` +
      `<div class="sp-inf">${esc(influence(id))}</div></div>`
    );
  }).join('');
  const roster = Object.keys(data.scientists)
    .map((id) => {
      const def = data.scientists[id]!;
      const placed = chosen.includes(id);
      // Занятый совет гасит остальных: перебрать нельзя, сначала освободи слот.
      const dis = placed || chosen.length >= COUNCIL_SIZE;
      return (
        `<button class="sp-card${placed ? ' picked' : ''}" data-spadd="${id}"${dis ? ' disabled' : ''}>` +
        `<div class="sp-cn">${esc(t(def.name))}${placed ? '<span class="sp-tick">✓</span>' : ''}</div>` +
        `<div class="sp-inf">${esc(influence(id))}</div></button>`
      );
    })
    .join('');
  const ready = chosen.length >= COUNCIL_SIZE;
  return (
    `<div class="sp-slots">${slots}</div>` +
    `<div class="sp-warn">${t('scipick.note')}</div>` +
    `<div class="sp-h">${t('scipick.candidates')}</div>` +
    `<div class="sp-roster">${roster}</div>` +
    `<button class="sp-go" id="sp-go"${ready ? '' : ' disabled'}>${ready ? t('scipick.confirm') : t('scipick.need-two')}</button>`
  );
}

/** Строка совета НА экране настройки: кого посвятили и вход в окно (REFM-126.1).
 *  Окно открывается ровно раз за вход в настройку и закрывается в том числе Back'ом
 *  мимо запертого подтверждения, поэтому без этой строки выбор пропадал с глаз
 *  насовсем — а пустой совет было ничем не отличить от полного. */
export function sciCouncilRowHtml(chosen: readonly string[], data: GameData): string {
  const names = chosen.map((id) => esc(t(data.scientists[id]?.name ?? id)));
  const full = names.length >= COUNCIL_SIZE;
  return (
    `<button class="scouncil${full ? '' : ' partial'}" type="button" data-council="open">` +
    `<span class="sc-h">${t('setup.council.label')}</span>` +
    `<span class="sc-n">${names.length ? names.join(' · ') : t('setup.council.empty')}</span>` +
    `<span class="sc-go">${t('setup.council.change')}</span></button>`
  );
}

/** Что окно берёт у экрана настройки матча. */
export interface SciPickHost {
  /** Окно (`#scipick`) — показывается и слушает клики здесь. */
  root(): HTMLElement;
  /** Контейнер тела (`#scipickbody`) — в него кладётся разметка. */
  body(): HTMLElement;
  /** Игровые данные (учёные + дерево технологий). */
  data(): GameData;
  /** Подпись ветки — словарь дерева технологий, общий с его экраном. */
  branchLabel(branch: string): string;
  /** Выбранный совет — им владеет сетап, его читает старт матча. */
  chosen(): string[];
  setChosen(ids: string[]): void;
  /** Отмена: игрок выходит из настройки матча целиком. */
  onCancel(): void;
}

/** Собрать окно. `open()` зовёт настройка матча, когда посвящение пора сделать. */
export function initSciPick(host: SciPickHost): { open: () => void; render: () => void } {
  const render = (): void => {
    host.body().innerHTML = sciPickBodyHtml(host.chosen(), host.data(), host.branchLabel);
  };

  host.root().addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    if (tg.closest('.sp-cancel')) {
      host.root().classList.remove('show');
      host.onCancel(); // выйти из настройки целиком
      return;
    }
    const add = tg.closest('[data-spadd]') as HTMLElement | null;
    if (add && !add.hasAttribute('disabled')) {
      const id = add.dataset.spadd ?? '';
      const chosen = host.chosen();
      if (id && !chosen.includes(id) && chosen.length < COUNCIL_SIZE) {
        host.setChosen([...chosen, id]);
      }
      render();
      return;
    }
    const rm = tg.closest('[data-sprm]') as HTMLElement | null;
    if (rm) {
      const chosen = [...host.chosen()];
      chosen.splice(Number(rm.dataset.sprm), 1);
      host.setChosen(chosen);
      render();
      return;
    }
    if (tg.id === 'sp-go' && host.chosen().length >= COUNCIL_SIZE) {
      host.root().classList.remove('show');
    }
  });

  return {
    open: () => {
      host.root().classList.add('show');
      render();
    },
    render,
  };
}
