import type { BackLayer } from './backLayers';
import { closeMatchDescription, isMatchDescriptionOpen } from './matchDescription';
import { closeFortressDialog, isFortressDialogOpen } from './fortressDialog';
import { heroRewardBackLayer } from './heroRewards';
import { closeDefectorDialog, isDefectorDialogOpen } from './defectorDialog';

/** Нативный верхний слой закрывается раньше экранов под ним. Награды ждут других dialog. */
export const NATIVE_BACK_LAYERS: BackLayer[] = [
  heroRewardBackLayer('hero-reward'),
  heroRewardBackLayer('match-hero-reward'),
  { id: 'match-description', isOpen: isMatchDescriptionOpen, close: closeMatchDescription },
  { id: 'fortress-order', isOpen: isFortressDialogOpen, close: closeFortressDialog },
  { id: 'defector-offer', isOpen: isDefectorDialogOpen, close: closeDefectorDialog },
];
