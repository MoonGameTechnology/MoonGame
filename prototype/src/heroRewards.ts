import type { HeroReward } from '../../decisions/heroRewards';
import type { GameData } from '../../packages/shared-core/src/index';
import { heroPortraitHtml } from '../../packages/client/src/heroPortraits';
import { t, tData } from '../../localization/runtime';
import { esc } from './format';
import type { BackLayer } from './backLayers';

const rewardBack = new Map<string, { dialog: HTMLDialogElement; clear(): void }>();
/** Закрывает всю очередь: системная кнопка Back равнозначна крестику, не очередной награде. */
export function heroRewardBackLayer(id: string): BackLayer {
  return {
    id,
    isOpen: () => rewardBack.get(id)?.dialog.open === true,
    close: () => rewardBack.get(id)?.clear(),
  };
}

const TITLES = {
  hero: 'hero-reward.received',
  star: 'hero-reward.upgraded',
  skill: 'hero-reward.skill',
};

export function heroRewardHtml(reward: HeroReward, remaining: number, data: GameData): string {
  const skill = reward.kind === 'skill';
  const improvement = skill && Object.values(data.heroAbilities).some((ability) => ability.tiers?.some((tier) => tier.skill === reward.id));
  const def = skill ? data.heroSkillTrees[reward.id] : data.heroes[reward.id];
  const stars = skill
    ? ''
    : Array.from(
        { length: reward.to },
        (_, i) =>
          `<span class="${i < reward.from ? 'mr-existing' : 'mr-new'}" style="--i:${i}" aria-hidden="true">★</span>`,
      ).join('');
  const art = skill ? '✦' : heroPortraitHtml(reward.hero) || '◈';
  return `<article class="module-reveal hero-reveal">
    <button type="button" class="mr-close btn-x" data-hero-reward="dismiss" aria-label="${esc(t('module-reward.close'))}">×</button>
    <p class="mr-eyebrow">${esc(t('arsenal.tab.heroes'))}</p>
    <h2 id="hero-reward-title">${esc(t(improvement ? 'hero-reward.skill-upgraded' : TITLES[reward.kind]!))}</h2>
    <div class="mr-stage" aria-hidden="true"><div class="mr-ring"></div><div class="mr-ring mr-ring-inner"></div>
      ${Array.from({ length: 12 }, (_, i) => `<i class="mr-spark" style="--i:${i}"></i>`).join('')}
      <div class="mr-module">${art}</div></div>
    <h3>${esc(tData(def?.name ?? reward.id))}</h3>
    <div class="mr-stars">${stars}</div>
    ${reward.kind === 'star' ? `<p class="mr-grade">${esc(t('module-reward.progress', { from: reward.from, to: reward.to }))}</p>` : ''}
    <p class="mr-receipt">${esc(skill ? t(data.heroSkillTrees[reward.id]?.description ?? '') : t(reward.kind === 'star' ? 'hero-reward.slots' : 'hero-reward.ready'))}</p>
    <button type="button" class="mr-continue" data-hero-reward="next">${esc(t('module-reward.continue'))}</button>
    ${remaining > 1 ? `<p class="mr-remaining">${esc(t('module-reward.remaining', { n: remaining - 1 }))}</p>` : ''}
  </article>`;
}

/** Очередь показа, не выдачи. Хозяин передаёт изменения только своего подтверждённого профиля. */
export function initHeroRewards(data: GameData, visible: () => boolean, id = 'hero-reward') {
  const dialog = document.createElement('dialog');
  dialog.id = id;
  dialog.classList.add('hero-reward-dialog');
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  document.body.append(dialog);
  let queue: HeroReward[] = [];
  let waiting: HTMLDialogElement | null = null;
  let opener: HTMLElement | null = null;
  const unwait = () => {
    waiting?.removeEventListener('close', resume);
    waiting = null;
  };
  function resume(): void {
    unwait();
    if (!visible() || dialog.open || !queue.length) return;
    const busy = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]')).find(
      (item) => item !== dialog,
    );
    if (busy) {
      waiting = busy;
      busy.addEventListener('close', resume, { once: true });
      return;
    }
    opener ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.innerHTML = heroRewardHtml(queue[0]!, queue.length, data).replace(
      'id="hero-reward-title"',
      `id="${id}-title"`,
    );
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[data-hero-reward="next"]')?.focus();
  }
  function clear(): void {
    queue = [];
    unwait();
    if (dialog.open) dialog.close();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }
  rewardBack.set(id, { dialog, clear });
  dialog.addEventListener('cancel', clear);
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('click', (event) => {
    const action = (event.target as Element).closest<HTMLElement>('[data-hero-reward]')?.dataset
      .heroReward;
    if (action === 'dismiss') clear();
    if (action === 'next') {
      queue.shift();
      if (!queue.length) clear();
      else {
        dialog.close();
        resume();
      }
    }
  });
  return {
    add(rewards: readonly HeroReward[]): void {
      queue.push(...rewards);
      resume();
    },
    resume,
    clear,
    hide(): void {
      unwait();
      if (dialog.open) dialog.close();
    },
  };
}

let matchReceipts: ReturnType<typeof initHeroRewards> | undefined;
let matchReceiptEpoch = 0;
export function resetMatchHeroRewards(): void {
  matchReceiptEpoch++;
  matchReceipts?.clear();
}
export function presentMatchHeroRewards(rewards: readonly HeroReward[], data: GameData): void {
  const epoch = matchReceiptEpoch;
  // Разметка штаба появится после завершения текущей перерисовки.
  queueMicrotask(() => {
    if (epoch !== matchReceiptEpoch) return;
    matchReceipts ??= initHeroRewards(
      data,
      () => document.getElementById('herobody')?.checkVisibility() === true,
      'match-hero-reward',
    );
    matchReceipts.add(rewards);
  });
}
