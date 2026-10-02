/**
 * Скорость на телефоне — одна кнопка (UIX-3.2): что на ней написано.
 *
 * Семь кнопок скорости (‖ ▶ ▶▶ ×1 ×10 ×50 ×100) стояли в два ряда в самой удобной зоне
 * экрана, над нижней панелью (`docs/ui-research.md`, правка 3). Теперь там одна кнопка с
 * текущей скоростью, а ряд раскрывается над ней по нажатию (`prototype/src/phoneSpeed.ts`).
 *
 * 1. **На кнопке — темп и множитель, как в ряду:** «▶ ×10», «▶▶ ×100». В забеге
 *    множителей нет (`matchExits.ts`, правило 6) — только темп: «▶», «▶▶», в дев-забеге
 *    «▶▶▶».
 * 2. **На паузе — «‖» и слово «Пауза»:** множитель на паузе ничего не значит, а одинокий
 *    «‖» легко принять за кнопку, а не за состояние.
 * 3. **Темп — по скорости мира, а не по подсветке ряда:** правда о паузе — скорость мира, а
 *    подсветку ряда игра двигает отдельно. Скорость, которой нет в ряду, читается как «▶»:
 *    мир идёт, и кнопка не врёт о паузе.
 */

/** Кнопка темпа в ряду: пауза, игра, ускорение и дев-ускорение забега. */
export type Tempo = 'pause' | 'play' | 'fast' | 'dev';

/** Знак темпа — тот же, что на его кнопке в ряду. */
const GLYPH: Record<Tempo, string> = { pause: '‖', play: '▶', fast: '▶▶', dev: '▶▶▶' };

export interface SpeedFace {
  /** Знак темпа. */
  readonly glyph: string;
  /** Множитель «×N»; пусто, когда его нет или идёт пауза. */
  readonly mult: string;
  /** Пауза: вместо множителя — слово «Пауза» (правило 2). */
  readonly paused: boolean;
}

/** Скорости кнопок темпа в ряду; `dev` — только у дев-забега. */
export interface TempoRates {
  readonly play: number;
  readonly fast: number;
  readonly dev?: number;
}

/** Правило 3: какой темп сейчас — по скорости мира; `null` — скорости нет в ряду. */
export function tempoOf(speed: number, rates: TempoRates): Tempo | null {
  if (!(speed > 0)) return 'pause';
  if (speed === rates.play) return 'play';
  if (speed === rates.fast) return 'fast';
  return speed === rates.dev ? 'dev' : null;
}

/**
 * Что написать на кнопке. `tempo` — из `tempoOf` (`null` — скорости нет в ряду, правило 3),
 * `mult` — множитель партии, `null` — множителей нет (забег).
 */
export function speedFace(tempo: Tempo | null, mult: number | null): SpeedFace {
  const paused = tempo === 'pause';
  const shownMult = !paused && mult !== null && Number.isFinite(mult) && mult > 0;
  return { glyph: GLYPH[tempo ?? 'play'], mult: shownMult ? `×${mult}` : '', paused };
}
