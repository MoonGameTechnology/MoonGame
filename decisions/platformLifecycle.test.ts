// YAG-1.2 — разметка жизненного цикла для площадки. Правила проверяются как ПОСЛЕДОВАТЕЛЬНОСТИ
// вызовов: модерация смотрит именно порядок и парность (требование 1.19), а не отдельный вызов.
import { describe, expect, it } from 'vitest';
import {
  initialLifecycle,
  lifecyclePlatformPause,
  lifecyclePlatformResume,
  lifecycleReady,
  lifecycleStart,
  lifecycleStop,
  type LifecycleCall,
  type LifecycleState,
} from './platformLifecycle';

type Step = (s: LifecycleState) => { state: LifecycleState; call: LifecycleCall };

/** Прогнать сценарий и собрать то, что реально ушло бы в SDK. */
function run(...steps: Step[]): { calls: LifecycleCall[]; state: LifecycleState } {
  let state = initialLifecycle;
  const calls: LifecycleCall[] = [];
  for (const step of steps) {
    const next = step(state);
    state = next.state;
    if (next.call) calls.push(next.call);
  }
  return { calls, state };
}

describe('готовность — ровно один раз (правило 1)', () => {
  it('первый вызов отправляет ready', () => {
    expect(run(lifecycleReady).calls).toEqual(['ready']);
  });

  it('ПОВТОРНЫЙ вызов молчит: событие уже случилось', () => {
    expect(run(lifecycleReady, lifecycleReady, lifecycleReady).calls).toEqual(['ready']);
  });
});

describe('геймплей парный (правила 3–4)', () => {
  it('обычный цикл: готов → играем → встали', () => {
    expect(run(lifecycleReady, lifecycleStart, lifecycleStop).calls).toEqual([
      'ready',
      'start',
      'stop',
    ]);
  });

  it('ПОВТОРНЫЙ start молчит — иначе разметка разойдётся с реальностью', () => {
    expect(run(lifecycleReady, lifecycleStart, lifecycleStart).calls).toEqual(['ready', 'start']);
  });

  it('stop без start молчит', () => {
    expect(run(lifecycleReady, lifecycleStop).calls).toEqual(['ready']);
    expect(run(lifecycleReady, lifecycleStart, lifecycleStop, lifecycleStop).calls).toEqual([
      'ready',
      'start',
      'stop',
    ]);
  });

  // Правило 4: до `ready` площадка считает игру грузящейся.
  it('СТАРТ ДО ГОТОВНОСТИ НЕ РАЗМЕЧАЕТСЯ — и не откладывается', () => {
    const { calls, state } = run(lifecycleStart);
    expect(calls).toEqual([]);
    expect(state.playing).toBe(false);
    // Намерение запомнено: если игра успела захотеть играть, `ready` её не «доиграет» —
    // разметку даёт следующий явный start, когда игрок правда в игре.
    expect(state.wantedPlaying).toBe(true);
  });

  it('меню посреди игры: stop → start возвращает разметку', () => {
    expect(
      run(lifecycleReady, lifecycleStart, lifecycleStop, lifecycleStart).calls,
    ).toEqual(['ready', 'start', 'stop', 'start']);
  });
});

describe('пауза площадки сильнее нашего желания (правило 5)', () => {
  it('пауза во время игры останавливает разметку, возобновление возвращает', () => {
    expect(
      run(lifecycleReady, lifecycleStart, lifecyclePlatformPause, lifecyclePlatformResume).calls,
    ).toEqual(['ready', 'start', 'stop', 'start']);
  });

  // Ровно тот случай, ради которого заведено `wantedPlaying`: игрок ушёл в меню, потом
  // площадка показала рекламу. После рекламы он по-прежнему в меню, а не в бою.
  it('ВОЗОБНОВЛЕНИЕ НЕ ОЖИВЛЯЕТ МЕНЮ: стояли в меню — стоим и после паузы', () => {
    expect(
      run(
        lifecycleReady,
        lifecycleStart,
        lifecycleStop,
        lifecyclePlatformPause,
        lifecyclePlatformResume,
      ).calls,
    ).toEqual(['ready', 'start', 'stop']);
  });

  it('пауза вне игры ничего не отправляет', () => {
    expect(run(lifecycleReady, lifecyclePlatformPause).calls).toEqual(['ready']);
  });

  it('под чужой паузой наш start молчит, но намерение запоминается', () => {
    const { calls, state } = run(lifecycleReady, lifecyclePlatformPause, lifecycleStart);
    expect(calls).toEqual(['ready']);
    expect(state.wantedPlaying).toBe(true);
    expect(lifecyclePlatformResume(state).call).toBe('start');
  });

  it('двойное возобновление не даёт второго start', () => {
    const { calls } = run(
      lifecycleReady,
      lifecycleStart,
      lifecyclePlatformPause,
      lifecyclePlatformResume,
      lifecyclePlatformResume,
    );
    expect(calls).toEqual(['ready', 'start', 'stop', 'start']);
  });
});

describe('состояние не мутируется — вход остаётся прежним', () => {
  it('шаг возвращает НОВЫЙ объект', () => {
    const before = initialLifecycle;
    const after = lifecycleReady(before).state;
    expect(before.ready).toBe(false);
    expect(after).not.toBe(before);
  });
});
