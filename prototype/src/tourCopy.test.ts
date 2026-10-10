/**
 * UIX-8.1 — строка шага обучения: одна мысль, одинаково верная на телефоне и на ПК.
 *
 * Сторож держит ФОРМУ шага во всех трёх обучениях (первый матч, обзор интерфейса, учебный
 * полигон), чтобы абзац на семь строк не вернулся следующим же правкой текста.
 *
 * 1. **Не длиннее `STEP_MAX` символов.** В пузыре шириной 320 px это две строки, редко
 *    три. Что не влезло — уже вторая мысль: её показывает анимация жеста, подсветка цели
 *    или следующий шаг.
 * 2. **Глагол не привязан к устройству.** Строка одна на телефон и ПК, поэтому «тапните»
 *    или «кликните» на другом устройстве — неправда. Пишем «нажмите», «выберите»; где жест
 *    зависит от устройства, его показывают плитки жестов (`decisions/mapGestures.ts`).
 */
import { describe, expect, it } from 'vitest';
import { ru } from '../../localization/ru';
import { en } from '../../localization/en';
import { trainingBaseline } from '../../decisions/trainingStages';
import { trainingState } from '../../packages/client/src/gameData';
import { buildFirstMatchTour } from './firstMatchTour';
import { HUD_ORIENTATION_TOUR } from './onboardingTour';
import { buildTrainingTour } from './trainingTour';
import { data } from './gameData';
import type { SpotlightStep } from './spotlight';

/** Потолок строки шага (правило 1). */
const STEP_MAX = 90;

const first = (mouse: boolean): SpotlightStep[] =>
  buildFirstMatchTour({
    mouse: () => mouse,
    homeOpened: () => false,
    cardLayout: () => !mouse,
    panelOpen: () => false,
    shipsTabOpen: () => false,
    hasFleet: () => false,
    capturedWorld: () => false,
    scoreRose: () => false,
  });

const world = trainingState(data);
const training = buildTrainingTour({
  world: () => world,
  me: 'p1',
  data,
  baseline: trainingBaseline(world, 'p1', data),
  fleetSelected: () => false,
});

const steps = [...first(true), ...first(false), ...HUD_ORIENTATION_TOUR, ...training];
const copies = [...new Set(steps.map((s) => s.copy))];
const LOCALES = { ru, en } as const;

describe('строка шага обучения', () => {
  it('три обучения вместе — больше тридцати шагов: сторож не смотрит в пустоту', () => {
    expect(copies.length).toBeGreaterThan(30);
  });

  it(`не длиннее ${STEP_MAX} символов на обоих языках (правило 1)`, () => {
    const long: string[] = [];
    for (const [lang, table] of Object.entries(LOCALES))
      for (const key of copies) {
        const text = table[key] ?? '';
        if (text.length > STEP_MAX) long.push(`${lang} ${key}: ${text.length}`);
      }
    expect(long).toEqual([]);
  });

  it('глагол не привязан к устройству (правило 2)', () => {
    // Слово целиком, а не подстрока: в «этап» тоже есть «тап».
    const bound = /(?<![а-яё])(тап|клик|навед)|\b(tap|click|hover)/i;
    const hits: string[] = [];
    for (const [lang, table] of Object.entries(LOCALES))
      for (const key of copies) if (bound.test(table[key] ?? '')) hits.push(`${lang} ${key}`);
    expect(hits).toEqual([]);
  });
});

describe('плитки жестов', () => {
  it('у каждого жеста есть имя и дело на обоих языках', () => {
    const keys = steps.flatMap((s) => s.gestures ?? []).flatMap((g) => [g.name, g.does]);
    expect(keys.length).toBeGreaterThan(0);
    for (const table of Object.values(LOCALES))
      expect(keys.filter((k) => !table[k])).toEqual([]);
  });
});
