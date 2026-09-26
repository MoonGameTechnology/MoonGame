/**
 * TRN-2 · Цепочка подсказок учебного полигона (`docs/sector-zero-map-concepts.md` §14.4):
 * двенадцать этапов, по одной подсказке за раз, в порядке прохождения.
 *
 * Правила (решения владельца 2026-09-26):
 *
 * 1. **Этап закрывает дело.** Последний шаг каждого этапа ждёт настоящего результата игры —
 *    приказа (`action`) или состояния мира (`state`, проверки `decisions/trainingStages.ts`),
 *    а не кнопки «Далее». Пролистать подсказку можно только кнопкой «Пропустить этап».
 * 2. **Можно пропустить этап** — движок (`spotlight.ts`) уводит к первому шагу следующего.
 *    Этапы не зависят друг от друга по флагам: если нужное уже сделано, `state`-шаг
 *    засчитывается сразу, как только до него дошли.
 * 3. **Подсказка не закрывает цель на телефоне.** Шаги без цели: пузырь поднимается к
 *    верху экрана (`spotlightDom.ts`, `topAnchored`), карта под ним остаётся видна.
 *
 * Идентификаторы миров и флотов — карты `training-1`. Текст — ключи `training.tour.*`.
 */
import {
  fleetGone,
  fortified,
  garrisoned,
  owns,
  productionGrew,
  shipBuilt,
  squadronHome,
  techDone,
  trainingWon,
  type TrainingBaseline,
  type TrainingStage,
} from '../../decisions/trainingStages';
import type { GameData, GameState, PlayerId } from '../../packages/shared-core/src/index';
import type { SpotlightStep, StepAdvance } from './spotlight';

export interface TrainingTourDeps {
  /** Текущее состояние мира. */
  world: () => GameState;
  me: PlayerId;
  data: GameData;
  /** Отметка на входе в полигон (`trainingBaseline`). */
  baseline: TrainingBaseline;
  /** Игрок выбрал свой флот — открыта его карточка. */
  fleetSelected: () => boolean;
}

/** Двенадцать этапов §14.4 цепочкой шагов. */
export function buildTrainingTour(deps: TrainingTourDeps): SpotlightStep[] {
  const { me, data, baseline: b } = deps;
  const when = (ok: (s: GameState) => boolean): StepAdvance => ({ on: 'state', when: () => ok(deps.world()) });
  const step = (stage: TrainingStage, id: string, advance: StepAdvance): SpotlightStep => ({
    id: `${stage}.${id}`,
    stage,
    target: null,
    copy: `training.tour.${stage}.${id}`,
    advance,
  });
  return [
    step('prep', 'fleet', { on: 'state', when: deps.fleetSelected }),
    step('economy', 'mine', when((s) => productionGrew(s, me, b, data))),
    step('economy', 'ship', when((s) => shipBuilt(s, me, b))),
    step('research', 'grid', when((s) => techDone(s, me, b))),
    step('expand', 'neutral', when((s) => owns(s, me, 'neutral'))),
    step('missions', 'beacon', when((s) => owns(s, me, 'station'))),
    step('fleet', 'split', { on: 'action', type: 'fleet.split' }),
    step('fleet', 'merge', { on: 'action', type: 'fleet.merge' }),
    step('battle', 'patrol', when((s) => fleetGone(s, 'p2_patrol'))),
    step('battle', 'hero', { on: 'action', type: 'hero.ability' }),
    step('retreat', 'retreat', { on: 'action', type: 'fleet.retreat' }),
    step('retreat', 'repair', { on: 'action', type: 'fleet.repair' }),
    step('carrier', 'strike', { on: 'action', type: 'shuttle.strike' }),
    step('carrier', 'home', when((s) => squadronHome(s, me))),
    step('assault', 'load', { on: 'action', type: 'army.load' }),
    step('assault', 'outpost', when((s) => owns(s, me, 'outpost'))),
    step('fortify', 'build', when((s) => fortified(s, me, b) && garrisoned(s, me, 'outpost'))),
    step('finale', 'target', when((s) => trainingWon(s, me) || owns(s, me, 'target'))),
  ];
}
