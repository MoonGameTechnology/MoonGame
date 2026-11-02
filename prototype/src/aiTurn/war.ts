/** ВОЙНА В ХОДЕ БОТА (SLIM-3): объявление войны лидеру гонки. */
import { getStance } from '../../../packages/shared-core/src/index';
import { declareWar } from '../../../decisions/actions';
import { decisionNoise } from './rules';
import type { AiTurn } from './turn';

// War when the race is being LOST (self-play M4 finding): a passive bot loses the
// score race to whoever expands faster — every bot-vs-bot match ended as a 2-day
// race with zero battles, and the military (and combat factions) never played. So
// a bot falling a planet's worth (≥ 50) behind the score leader — or merely behind
// once no capturable neutral is left — declares war on that leader; the expansion
// loop (`fleets.ts`) then targets war territory (traversable/capturable) and contested
// provinces swing back. A bot that IS ahead stays quiet — it wins by holding.
// Declared only from a clean 'peace' stance: pacts/alliances are never betrayed,
// and favour-driven war (botDiplomacyModule) keeps working on top unchanged.
export function declareWarOnLeader(bot: AiTurn): void {
  const { state, ai, out, skilled, capturable, provinceTotal, myProvinces } = bot;
  const scoreOf = provinceTotal;
  const mine = myProvinces;
  let leader: string | null = null;
  let leaderScore = -1;
  for (const pid of Object.keys(state.players)) {
    if (pid === ai || state.players[pid]?.status !== 'active') continue;
    const sc = scoreOf(pid);
    if (sc > leaderScore) {
      leaderScore = sc;
      leader = pid;
    }
  }
  const neutralLeft = Object.values(state.planets).some((p) => p.owner === null && capturable(p));
  // AI-BAL-5, точка разброса №2: порог войны у ТЕСТ-бота плавает в коридоре ±20%
  // (50 → 40..60 очков отставания). Фиксированные 50 означали, что война объявляется
  // в один и тот же игровой час при одинаковых стартах — а момент объявления решает,
  // кто успел развернуться. Коридор узкий: бот по-прежнему воюет, когда проигрывает
  // гонку, просто не секунда-в-секунду с самим собой из другого матча.
  const warGap = skilled ? 50 * (0.8 + 0.4 * decisionNoise(state, ai, 'war')) : 50;
  const losingRace = leaderScore - mine >= warGap || (!neutralLeft && leaderScore >= mine);
  if (leader && losingRace && getStance(state, ai, leader) === 'peace') {
    out.push(declareWar(ai, leader));
  }
}
