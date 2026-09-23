/**
 * Темп перемещения забега (PVR-2.3): ×5 ко всем скоростям карты живёт ровно столько,
 * сколько живёт забег.
 *
 * Две половины, и у каждой свой сторож.
 *
 * 1. **Ядро прототипа честно исполняет множитель.** Поведенческая проверка через те же
 *    `ctx`/`order`, что гоняет кадр: флот на карте первой главы доходит впятеро быстрее,
 *    а оценка пути говорит то же самое.
 * 2. **Включает его только дверь забега.** `main.ts` не поднять в vitest (DOM, канвас,
 *    живое ядро), поэтому стык держит статическая проверка — той же формы, что сторож
 *    разметки геймплея (`platform/gameplayMarking.test.ts`): `setMatchTravelSpeed` зовут
 *    только внутри `setRunActive`. Иначе ×5 пережил бы выход из забега и утёк в песочницу.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { ctx, order, setMatchMode, setMatchTravelSpeed, moveFleet } from './game';
import { data } from './gameData';
import { pveState, pveModeId } from '../../packages/client/src/gameData';
import { estimateTravelHours } from '../../packages/shared-core/src/index';
import { RUN_TRAVEL_SPEED } from '../../decisions/runTempo';

const HOUR = 3_600_000;
const SRC = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

afterEach(() => {
  setMatchMode(undefined);
  setMatchTravelSpeed(1);
});

describe('ядро прототипа исполняет темп забега', () => {
  it('без забега конфиг множителя не несёт — песочница летает как раньше', () => {
    expect(ctx(0).config?.travelSpeedFactor).toBeUndefined();
  });

  it('в забеге перегон впятеро короче, и оценка пути это знает', () => {
    setMatchMode(pveModeId());
    const legOf = (): { leg: number; estimate: number | null } => {
      const s = pveState(data);
      const out = order(s, moveFleet('p1', 'p1_1', 'pirate_den'), s.time);
      expect(out.error).toBeUndefined();
      const mv = out.state.fleets.p1_1!.movement!;
      return {
        leg: mv.arrivesAt - s.time,
        estimate: estimateTravelHours(s, ctx(s.time), 'home_a', 'pirate_den', s.fleets.p1_1!),
      };
    };
    const plain = legOf();
    setMatchTravelSpeed(RUN_TRAVEL_SPEED);
    const run = legOf();
    expect(run.leg).toBeCloseTo(plain.leg / RUN_TRAVEL_SPEED, -1);
    // Оценка не гоняет хук `fleet.speed` (местность, бонусы — так по контракту
    // `estimateTravelHours`), поэтому с ногой ядра она сравнивается в отношении, а не в
    // абсолюте: ускорилась в те же пять раз.
    expect(run.estimate! * HOUR).toBeCloseTo((plain.estimate! * HOUR) / RUN_TRAVEL_SPEED, -1);
  });
});

describe('темп включает только дверь забега', () => {
  it('`setRunActive` включает ×5 вместе с забегом и снимает вместе с ним', () => {
    const body = /function setRunActive\(on: boolean\): void \{([\s\S]*?)\n\}/.exec(SRC)?.[1];
    expect(body, 'функция setRunActive не найдена — сторож проверял бы пустоту').toBeTruthy();
    expect(body).toContain('setMatchTravelSpeed(on ? RUN_TRAVEL_SPEED : 1)');
  });

  it('больше никто в `main.ts` темп не трогает', () => {
    const calls = SRC.match(/\bsetMatchTravelSpeed\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });
});
