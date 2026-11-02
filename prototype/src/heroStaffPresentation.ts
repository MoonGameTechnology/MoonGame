import { initHeroStaff as initStaff, type HeroStaffHost } from './heroStaff';
import { presentMatchHeroRewards, resetMatchHeroRewards } from './heroRewards';
import { data } from './gameData';
import { serverMatchId } from './netSession';

/** Связывает подтверждённый состав партии с презентацией; ядро и отправка приказов прежние. */
export function initHeroStaff(host: HeroStaffHost) {
  return initStaff({
    ...host,
    identity: () => serverMatchId() ?? `${host.state().mapId ?? ''}:${host.state().startedAt ?? 0}`,
    received: (rewards) => presentMatchHeroRewards(rewards, data),
    resetRewards: resetMatchHeroRewards,
  });
}
