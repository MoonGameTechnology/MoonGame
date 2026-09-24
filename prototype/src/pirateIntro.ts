import type { PirateEncounter } from '../../decisions/pirateEncounter';
import { t } from '../../localization/runtime';

/** A dismissible hint beside the map. Buttons only focus a target or open the
 *  existing battle window; they never issue orders or alter the simulation. */
export function initPirateIntro(host: {
  root: HTMLElement;
  copy: HTMLElement;
  action: HTMLElement;
  close: HTMLElement;
  focus(sector: string): void;
  openBattle(id: string): void;
  /** Подсказка перешла на новый этап — шаг воронки обучения (`YAG-5.1`). */
  onStage?(stage: PirateEncounter['stage']): void;
}): { update(model: PirateEncounter | null): void; reset(): void } {
  let dismissed = false;
  let model: PirateEncounter | null = null;
  let openedBattle: string | undefined;
  const { copy, action } = host;
  host.close.addEventListener('click', () => {
    dismissed = true;
    host.root.hidden = true;
  });
  action.addEventListener('click', () => {
    if (!model) return;
    if (model.stage === 'won' || model.stage === 'cleared') {
      dismissed = true;
      host.root.hidden = true;
    } else if (model.battleId) host.openBattle(model.battleId);
    else host.focus(model.sector);
  });
  return {
    reset() { dismissed = false; model = null; openedBattle = undefined; host.root.hidden = true; },
    update(next) {
      host.root.hidden = dismissed || !next;
      if (!dismissed && next?.battleId && openedBattle !== next.battleId) {
        openedBattle = next.battleId;
        host.openBattle(next.battleId);
      }
      if (model?.stage !== next?.stage && next) {
        host.onStage?.(next.stage);
        const messages = {
          approach: t('pve.pirates.approach'),
          travel: t('pve.pirates.travel'),
          battle: t('pve.pirates.battle'),
          occupy: t('pve.pirates.occupy'),
          won: t('pve.pirates.won'),
          cleared: t('pve.pirates.cleared'),
          recover: t('pve.pirates.recover'),
        };
        copy.textContent = messages[next.stage];
        action.textContent = next.stage === 'battle' ? t('pve.pirates.open-battle')
          : next.stage === 'won' || next.stage === 'cleared' ? t('pve.pirates.continue')
          : t('pve.pirates.show');
      }
      model = next;
    },
  };
}
