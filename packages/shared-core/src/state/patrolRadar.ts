/**
 * РАДАР ВИСЯЩЕГО ПАТРУЛЯ (SHU-6.18, резолюция владельца 2026-11-17: «в радиусе патруля
 * авиация использует радар»). До этого кирпича круг патруля был глазами (SHU-6.7): всё,
 * что в него попадало, было опознано целиком, и выбирать, бить ли по метке, было не из чего.
 * Решения, которые легко потерять при правке:
 *
 * 1. **Круг патруля — радар, как любой другой в игре**: засечка на весь круг, опознание —
 *    на ближнюю его долю (`IDENTIFY_REACH_FRACTION`, та же, что у радара мира и флота). На
 *    карте круг рисуется теми же двумя кольцами, а дальнее кольцо даёт метку, а не цель
 *    для правила «только опознанные».
 * 2. **Уровень радара — высший** ({@link PATROL_RADAR_LEVEL}): эскадра в круге берёт любую
 *    сигнатуру, иначе правило «любая метка радара» молчало бы о мелкой цели, на которую
 *    патруль всё равно бросился бы. Маскировочное поле и мины сжимают его так же, как
 *    любой радар (`radarSignatures`).
 * 3. **Множители радара игрока и блэкаут круг не трогают.** Круг — это то, где патруль
 *    бросается на цель; радар шире круга обещал бы игроку броски, которых не будет.
 * 4. **Только нога `patrol`.** Эскадра на пути к точке, в броске и домой карту не открывает.
 * 5. **Союзный патруль в спроецированном мире** доходит строкой `seenPatrols` (SHU-6.12):
 *    чужие вылеты проекция снимает целиком. В авторитетном мире поля нет, и ветка молчит:
 *    там патруль союзника уже учтён по `strikes`.
 */
import type { GameState, PlayerId } from './gameState';
import type { RadarSource } from './radarSignals';
import type { SightCircle } from './sensorView';

/** Уровень радара патруля: высший, без порога сигнатуры (правило 2). */
export const PATROL_RADAR_LEVEL = 3;

/** Круги радара висящих патрулей владельца `owner` (правила 1, 3–5); опознание — доля
 *  `identifyFraction` круга, ровно как у радара мира и флота. */
export function patrolRadarCircles(state: GameState, owner: PlayerId, identifyFraction: number): SightCircle[] {
  const out: SightCircle[] = [];
  for (const strike of state.strikes ?? []) {
    if (strike.owner !== owner || strike.leg !== 'patrol' || !strike.patrol) continue;
    const r = strike.patrol.radius;
    if (r > 0) {
      out.push({
        owner, source: { kind: 'patrol', id: strike.id }, ...strike.to,
        identify: r * identifyFraction, signature: r,
      });
    }
  }
  (state.seenPatrols ?? []).forEach((p, i) => {
    if (p.owner !== owner || !(p.radius > 0)) return;
    out.push({
      owner, source: { kind: 'patrol', id: `seen:${p.owner}:${i}` }, x: p.at.x, y: p.at.y,
      identify: p.radius * identifyFraction, signature: p.radius,
    });
  });
  return out;
}

/** Радарные источники висящих патрулей владельца `owner` — для меток (правила 2–5). */
export function patrolRadarSources(state: GameState, owner: PlayerId): RadarSource[] {
  const out: RadarSource[] = [];
  for (const strike of state.strikes ?? []) {
    if (strike.owner !== owner || strike.leg !== 'patrol' || !strike.patrol) continue;
    const r = strike.patrol.radius;
    if (r > 0) out.push({ ...strike.to, range: r, level: PATROL_RADAR_LEVEL });
  }
  for (const p of state.seenPatrols ?? []) {
    if (p.owner === owner && p.radius > 0) out.push({ ...p.at, range: p.radius, level: PATROL_RADAR_LEVEL });
  }
  return out;
}
