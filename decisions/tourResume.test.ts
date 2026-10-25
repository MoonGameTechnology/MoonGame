import { describe, expect, it } from 'vitest';
import { resumeStep } from './tourResume';

describe('resumeStep', () => {
  const stages = ['prep', 'prep', 'economy', 'economy', 'economy', 'research'];

  it('возвращает к первому шагу того этапа, где подсказки закрыли', () => {
    expect(resumeStep(stages, 0)).toBe(0);
    expect(resumeStep(stages, 1)).toBe(0);
    expect(resumeStep(stages, 4)).toBe(2);
    expect(resumeStep(stages, 5)).toBe(5);
  });

  it('шаг без этапа возвращается сам', () => {
    expect(resumeStep(['a', undefined, 'b'], 1)).toBe(1);
  });

  it('пустая цепочка и не начатый тур начинают с нуля, лишний индекс прижимается к концу', () => {
    expect(resumeStep([], 3)).toBe(0);
    expect(resumeStep(stages, -1)).toBe(0);
    expect(resumeStep(stages, Number.NaN)).toBe(0);
    expect(resumeStep(stages, 99)).toBe(5);
  });
});
