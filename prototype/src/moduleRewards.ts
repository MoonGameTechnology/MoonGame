/** Presentation only: the server already owns/granted these items. Closing this
 * window never submits a purchase, craft, upgrade or reward claim. */
import type { ArsenalItem } from '../../packages/shared-core/src/index';
import { moduleRewards, type ModuleReward } from '../../decisions/moduleRewards';
import { t, tData } from '../../localization/runtime';
import { parseArsenalItems } from './arsenal';
import { data } from './gameData';
import { esc } from './format';
import { moduleIcon } from './moduleIcons';

const RARITY_KEYS = {
  simple: 'rarity.simple',
  unique: 'rarity.unique',
  mythic: 'rarity.mythic',
  legendary: 'rarity.legendary',
};

export function moduleRewardHtml(reward: ModuleReward, remaining: number): string {
  const { item, previousGrade, kind } = reward;
  const def = data.modules[item.defId];
  const rarity = def?.rarity ?? 'simple';
  const grade = item.grade ?? 0;
  const title = kind === 'upgraded' ? t('module-reward.upgraded') : t('module-reward.received');
  const stars = Array.from(
    { length: grade },
    (_, i) =>
      `<span class="${kind === 'upgraded' && i < previousGrade ? 'mr-existing' : 'mr-new'}" style="--i:${i}" aria-hidden="true">★</span>`,
  ).join('');
  const gradeText =
    kind === 'upgraded'
      ? t('module-reward.progress', { from: previousGrade, to: grade })
      : grade
        ? t('arsenal.copy.grade', { n: grade })
        : '';
  return `<article class="module-reveal rarity-${rarity}">
    <button type="button" class="mr-close btn-x" data-module-reward="dismiss" aria-label="${esc(t('module-reward.close'))}">×</button>
    <p class="mr-eyebrow">${esc(t('hub.nav.arsenal'))}</p>
    <h2 id="module-reward-title">${esc(title)}</h2>
    <div class="mr-stage" aria-hidden="true"><div class="mr-ring"></div><div class="mr-ring mr-ring-inner"></div>
      ${Array.from({ length: 12 }, (_, i) => `<i class="mr-spark" style="--i:${i}"></i>`).join('')}
      <div class="mr-module">${moduleIcon(item.defId)}</div>
    </div>
    <p class="mr-rarity">${esc(t(RARITY_KEYS[rarity]))}</p>
    <h3>${esc(tData(def?.name ?? item.defId))}</h3>
    <div class="mr-stars" aria-hidden="true">${stars}</div>
    ${gradeText ? `<p class="mr-grade">${esc(gradeText)}</p>` : ''}
    <p class="mr-receipt">${esc(t('module-reward.saved'))}</p>
    <button type="button" class="mr-continue" data-module-reward="next">${esc(t('module-reward.continue'))}</button>
    ${remaining > 1 ? `<p class="mr-remaining">${esc(t('module-reward.remaining', { n: remaining - 1 }))}</p>` : ''}
  </article>`;
}

interface Host {
  identity(): string;
  visible(): boolean;
  read(key: string): unknown;
  write(key: string, items: readonly ArsenalItem[]): void;
}

/** One queue per active account, deferred behind other dialogs and while playing.
 * Cached inventories establish comparison only; observe accepts server snapshots. */
export function initModuleRewards(host: Host) {
  const dialog = document.createElement('dialog');
  dialog.id = 'module-reward';
  dialog.setAttribute('aria-labelledby', 'module-reward-title');
  document.body.appendChild(dialog);
  let key = '';
  let previous: ArsenalItem[] | null = null;
  let queue: ModuleReward[] = [];
  let waiting: HTMLDialogElement | null = null;
  const unwait = () => {
    waiting?.removeEventListener('close', resume);
    waiting = null;
  };
  const resetIdentity = () => {
    if (key === host.identity()) return;
    unwait();
    if (dialog.open) dialog.close();
    queue = [];
    key = host.identity();
    let raw: unknown = null;
    try {
      raw = host.read(key);
    } catch {
      /* Storage is optional. */
    }
    const parsed = parseArsenalItems(raw);
    previous = Array.isArray(raw) && parsed.length === raw.length ? parsed : null;
  };
  function resume(): void {
    unwait();
    resetIdentity();
    if (!host.visible() || dialog.open || !queue.length) return;
    const busy = document.querySelector<HTMLDialogElement>('dialog[open]:not(#module-reward)');
    if (busy) {
      waiting = busy;
      busy.addEventListener('close', resume, { once: true });
      return;
    }
    dialog.innerHTML = moduleRewardHtml(queue[0]!, queue.length);
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[data-module-reward="next"]')?.focus();
  }
  const dismiss = () => {
    queue = [];
    unwait();
    dialog.close();
  };
  dialog.addEventListener('cancel', dismiss);
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-module-reward]')
      ?.dataset.moduleReward;
    if (action === 'dismiss') dismiss();
    if (action === 'next') {
      queue.shift();
      dialog.close();
      resume();
    }
  });
  return {
    observe(items: readonly ArsenalItem[]): void {
      resetIdentity();
      queue.push(...moduleRewards(previous, items).filter((r) => !!data.modules[r.item.defId]));
      previous = items.map((item) => ({ ...item }));
      try {
        host.write(key, previous);
      } catch {
        /* No reward depends on browser storage. */
      }
      resume();
    },
    resume,
    hide(): void {
      unwait();
      if (dialog.open) dialog.close();
    },
  };
}
