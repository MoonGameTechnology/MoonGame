import { describe, it, expect } from 'vitest';
import { mergeStep, type MergeFleet } from './mergeChase';

const стоит = (at: string): MergeFleet => ({ location: at });
const летит = (from: string | null, to: string): MergeFleet => ({
  location: from,
  movement: { to },
});

describe('слияние — исчезнувшие флоты', () => {
  it('ПРОПАВШИЙ ФЛОТ СНИМАЕТ ПРИКАЗ: сливать нечего', () => {
    expect(mergeStep(undefined, стоит('C1'))).toEqual({ do: 'drop' });
    expect(mergeStep(стоит('C1'), undefined)).toEqual({ do: 'drop' });
    expect(mergeStep(undefined, undefined)).toEqual({ do: 'drop' });
  });
});

describe('слияние — бой', () => {
  it('БОЙ ПРИОСТАНАВЛИВАЕТ, А НЕ ОТМЕНЯЕТ: после боя уцелевшие всё ещё рядом', () => {
    expect(mergeStep({ location: 'C1', battleId: 'b' }, стоит('C1'))).toEqual({ do: 'hold' });
    expect(mergeStep(стоит('C1'), { location: 'C1', battleId: 'b' })).toEqual({ do: 'hold' });
  });

  it('бой важнее готовности слиться — приказ ждёт', () => {
    expect(mergeStep({ location: 'C1', battleId: 'b' }, { location: 'C1' })).toEqual({
      do: 'hold',
    });
  });
});

describe('слияние — когда сливать', () => {
  it('оба стоят в одном узле — сливаем', () => {
    expect(mergeStep(стоит('C1'), стоит('C1'))).toEqual({ do: 'fuse' });
  });

  it('НА ХОДУ НЕ СЛИВАЮТ: у флота в транзите нет места стоянки', () => {
    expect(mergeStep(летит('C1', 'C2'), стоит('C1'))).not.toEqual({ do: 'fuse' });
    expect(mergeStep(стоит('C1'), летит('C1', 'C2'))).not.toEqual({ do: 'fuse' });
  });

  it('флот без места стоянки не сливается', () => {
    expect(mergeStep({ location: null }, { location: null })).toEqual({ do: 'hold' });
  });
});

describe('слияние — погоня', () => {
  it('стоящий догоняющий идёт к узлу цели', () => {
    expect(mergeStep(стоит('C1'), стоит('C2'))).toEqual({ do: 'chase', to: 'C2' });
  });

  it('ЗА ЛЕТЯЩЕЙ ЦЕЛЬЮ ИДУТ В ЕЁ НАЗНАЧЕНИЕ, а не в текущую точку', () => {
    expect(mergeStep(стоит('C1'), летит(null, 'C9'))).toEqual({ do: 'chase', to: 'C9' });
  });

  it('УЖЕ ИДУЩИЙ ВТОРОГО ХОДА НЕ ПОЛУЧАЕТ', () => {
    expect(mergeStep(летит('C1', 'C2'), стоит('C5'))).toEqual({ do: 'hold' });
  });

  it('цель без узла и без назначения гнаться не за чем', () => {
    expect(mergeStep(стоит('C1'), { location: null })).toEqual({ do: 'hold' });
  });

  it('ДОГОНЯЮЩИЙ УЖЕ В УЗЛЕ ЦЕЛИ — ждём её отправления, а не гоним на месте', () => {
    // цель ещё числится в C2, но уже уходит в C7: вести mover некуда, он и так там
    expect(mergeStep(стоит('C2'), летит('C2', 'C7'))).toEqual({ do: 'hold' });
  });
});
