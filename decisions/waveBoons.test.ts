import { describe, it, expect } from 'vitest';

import { boonOffer, type BoonView } from './waveBoons';

const view = (over: Partial<BoonView> = {}): BoonView => ({
  owed: 1,
  pool: ['boon_gunnery', 'boon_engines', 'boon_foundry'],
  completed: [],
  ...over,
});

describe('предложение усилений между волнами (PVR-1.4)', () => {
  it('долга нет — экрана нет', () => {
    expect(boonOffer(view({ owed: 0 }))).toEqual({ kind: 'none' });
  });

  it('долг есть — показываются все ещё не взятые', () => {
    expect(boonOffer(view())).toEqual({
      kind: 'offer',
      owed: 1,
      choices: ['boon_gunnery', 'boon_engines', 'boon_foundry'],
    });
  });

  it('взятое больше не предлагается', () => {
    expect(boonOffer(view({ completed: ['boon_engines'] }))).toEqual({
      kind: 'offer',
      owed: 1,
      choices: ['boon_gunnery', 'boon_foundry'],
    });
  });

  it('пул исчерпан — предлагать нечего, и это НЕ пустой экран', () => {
    // Иначе игрок упирается в окно без карточек и без выхода: должок висит, а взять
    // нечего. Честный ответ здесь — «предложения нет», как и при нулевом долге.
    const all = view().pool;
    expect(boonOffer(view({ completed: [...all] }))).toEqual({ kind: 'none' });
  });

  it('чужие завершённые технологии пул не сокращают', () => {
    // В `completed` лежит вся наука места, а не только усиления забега: обычный
    // исследованный узел не должен вычёркивать карточку, которой он не является.
    expect(boonOffer(view({ completed: ['industrial_automation'] })).kind).toBe('offer');
  });

  it('долг больше одного — он назван, а не свёрнут к «есть выбор»', () => {
    // Две волны подряд без захода в окно — это ДВА выбора, и экран обязан это сказать,
    // иначе второй молча пропадает.
    const out = boonOffer(view({ owed: 2 }));
    expect(out).toMatchObject({ kind: 'offer', owed: 2 });
  });
});
