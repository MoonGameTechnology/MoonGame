// SND-1: «ненавязчивость» — не вкус, а инварианты патчей. Тесты держат именно их:
// короткие жесты, потолок громкости, мягкие атаки, рабочие настройки без WebAudio.
import { describe, it, expect } from 'vitest';
import {
  initSound,
  patchDuration,
  patchPeakBudget,
  SOUND_MIN_GAP,
  SOUND_PATCHES,
  type SoundId,
} from './sound';

const IDS = Object.keys(SOUND_PATCHES) as SoundId[];

describe('патчи — инварианты ненавязчивости', () => {
  it('каталог покрывает все шесть жестов, и у каждого есть анти-трель зазор', () => {
    expect(IDS.sort()).toEqual(['close', 'error', 'radar', 'send', 'start', 'tap']);
    for (const id of IDS) expect(SOUND_MIN_GAP[id]).toBeGreaterThan(0);
  });

  it('жесты короткие: тап/закрытие/пинг < 0.35с, отказ < 0.6с, флориш < 1.6с, фанфара < 2.2с', () => {
    expect(patchDuration(SOUND_PATCHES.tap)).toBeLessThan(0.35);
    expect(patchDuration(SOUND_PATCHES.close)).toBeLessThan(0.35);
    expect(patchDuration(SOUND_PATCHES.radar)).toBeLessThan(0.35);
    expect(patchDuration(SOUND_PATCHES.error)).toBeLessThan(0.6);
    expect(patchDuration(SOUND_PATCHES.send)).toBeLessThan(1.6);
    expect(patchDuration(SOUND_PATCHES.start)).toBeLessThan(2.2);
  });

  it('пинг развёртки — самый тихий в каталоге: игрок его не вызывал', () => {
    // Единственный звук, который звучит САМ, без жеста игрока. Поэтому его пик обязан
    // быть ниже любого звука-ответа, а зазор — длиннее: иначе рабочий радар с полудюжиной
    // контактов превращает фон приборной панели в трель.
    const radar = patchPeakBudget(SOUND_PATCHES.radar);
    for (const id of IDS) {
      if (id === 'radar') continue;
      expect(radar).toBeLessThan(patchPeakBudget(SOUND_PATCHES[id]));
    }
    // Зазор — не меньше, чем у любого звука-ОТВЕТА на жест (фанфару старта не берём:
    // она звучит раз за матч, её секунда ни с чем не конкурирует).
    for (const id of ['tap', 'close', 'error', 'send'] as const) {
      expect(SOUND_MIN_GAP.radar).toBeGreaterThanOrEqual(SOUND_MIN_GAP[id]);
    }
  });

  it('потолок громкости: сумма пиков голосов любого патча ≤ 0.6', () => {
    for (const id of IDS) expect(patchPeakBudget(SOUND_PATCHES[id])).toBeLessThanOrEqual(0.6);
  });

  it('атаки не короче 2 мс — синт не щёлкает', () => {
    for (const id of IDS)
      for (const v of SOUND_PATCHES[id].voices) expect(v.attack).toBeGreaterThanOrEqual(0.002);
  });

  it('эхо-посыл ограничен: даже фанфара не тонет в хвосте', () => {
    for (const id of IDS) {
      expect(SOUND_PATCHES[id].echo).toBeGreaterThanOrEqual(0);
      expect(SOUND_PATCHES[id].echo).toBeLessThanOrEqual(0.5);
    }
  });

  it('частоты осцилляторов положительны (exponentialRamp падает на нуле)', () => {
    for (const id of IDS)
      for (const v of SOUND_PATCHES[id].voices) {
        if (v.wave === 'noise') continue;
        expect(v.f0).toBeGreaterThan(0);
        if (v.f1 !== undefined) expect(v.f1).toBeGreaterThan(0);
      }
  });

  it('помпезность оперы буквально в данных: send и start несут чистую квинту (×1.5)', () => {
    for (const id of ['send', 'start'] as const) {
      const tones = SOUND_PATCHES[id].voices.filter((v) => v.wave !== 'noise').map((v) => v.f0);
      const hasFifth = tones.some((a) => tones.some((b) => Math.abs(b / a - 1.5) < 0.01));
      expect(hasFifth).toBe(true);
    }
  });
});

describe('initSound — настройки живут и без WebAudio (Node)', () => {
  const fakeStore = () => {
    const m = new Map<string, string>();
    return {
      m,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  };

  it('дефолты: включено, громкость 0.7; play() в среде без AudioContext молчит и не бросает', () => {
    const api = initSound(null);
    expect(api.enabled()).toBe(true);
    expect(api.volume()).toBe(0.7);
    expect(() => api.play('tap')).not.toThrow();
  });

  it('переключатель и громкость персистятся и читаются обратно', () => {
    const st = fakeStore();
    const api = initSound(st);
    api.setEnabled(false);
    api.setVolume(0.25);
    expect(st.m.get('void.snd')).toBe('0');
    expect(st.m.get('void.sndVol')).toBe('0.25');
    const again = initSound(st);
    expect(again.enabled()).toBe(false);
    expect(again.volume()).toBe(0.25);
  });

  it('ЧИСТЫЙ профиль (getItem → null): громкость 0.7, не 0 — Number(null) это 0', () => {
    // Регресс живой проверки: на свежем localStorage слайдер рождался на нуле.
    const api = initSound(fakeStore());
    expect(api.volume()).toBe(0.7);
    expect(api.enabled()).toBe(true);
  });

  it('громкость клампится в 0..1, мусор в сторе падает на дефолт', () => {
    const st = fakeStore();
    st.m.set('void.sndVol', 'garbage');
    const api = initSound(st);
    expect(api.volume()).toBe(0.7);
    api.setVolume(4);
    expect(api.volume()).toBe(1);
    api.setVolume(-1);
    expect(api.volume()).toBe(0);
  });
});

// Требование площадки 1.3: при потере фокуса звук обязан замолкнуть (допустимы две
// секунды). Пауза площадки — НЕ то же самое, что выключенный звук: настройка игрока
// обязана пережить рекламу и сворачивание вкладки.
describe('setPaused — пауза площадки не трогает настройку игрока (YAG-1.1b, требование 1.3)', () => {
  const fakeStore = () => {
    const m = new Map<string, string>();
    return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it('пауза не пишет в стор и не меняет `enabled()`', () => {
    const st = fakeStore();
    const api = initSound(st);
    const before = new Map(st.m);
    api.setPaused(true);
    // Игрок звук НЕ выключал — выключила площадка. Перепутать значит вернуть игрока
    // после рекламы в тишину, которую он не просил и которую надо чинить руками.
    expect(api.enabled()).toBe(true);
    expect([...st.m]).toEqual([...before]);
  });

  it('снятие паузы возвращает ровно то, что было: выключенный звук остаётся выключенным', () => {
    const api = initSound(fakeStore());
    api.setEnabled(false);
    api.setPaused(true);
    api.setPaused(false);
    expect(api.enabled()).toBe(false);
  });

  it('пауза и снятие идемпотентны и не бросают без AudioContext', () => {
    const api = initSound(null);
    expect(() => {
      api.setPaused(true);
      api.setPaused(true);
      api.setPaused(false);
      api.setPaused(false);
    }).not.toThrow();
    expect(api.enabled()).toBe(true);
  });
});

// Отдельно от настроек: здесь проверяется САМ ЗВУК на паузе, а не флаг. Поддельный
// AudioContext нужен ровно затем, что в Node его нет, а требование 1.3 — про звук.
describe('setPaused — на паузе площадки синт молчит и не оживает от play()', () => {
  class FakeParam {
    value = 0;
    setValueAtTime(): void {}
    linearRampToValueAtTime(): void {}
    exponentialRampToValueAtTime(): void {}
  }
  class FakeNode {
    gain = new FakeParam();
    frequency = new FakeParam();
    delayTime = new FakeParam();
    detune = new FakeParam();
    type = '';
    buffer: unknown = null;
    connect(): void {}
    start(): void {}
    stop(): void {}
  }
  const makeCtx = () => {
    const calls = { suspend: 0, resume: 0 };
    const node = (): FakeNode => new FakeNode();
    const ctx = {
      calls,
      state: 'running' as string,
      currentTime: 0,
      sampleRate: 48000,
      destination: node(),
      createGain: node,
      createDelay: node,
      createBiquadFilter: node,
      createOscillator: node,
      createBufferSource: node,
      createBuffer: () => ({ getChannelData: () => new Float32Array(8) }),
      suspend(): Promise<void> {
        calls.suspend++;
        ctx.state = 'suspended';
        return Promise.resolve();
      },
      resume(): Promise<void> {
        calls.resume++;
        ctx.state = 'running';
        return Promise.resolve();
      },
    };
    return ctx;
  };

  it('пауза приостанавливает контекст, а play() его НЕ возвращает к жизни', () => {
    const ctx = makeCtx();
    const g = globalThis as unknown as { AudioContext?: unknown };
    const had = 'AudioContext' in g;
    const prev = g.AudioContext;
    g.AudioContext = function () {
      return ctx;
    } as unknown;
    try {
      const api = initSound(null);
      api.play('tap'); // поднять синт
      expect(ctx.calls.resume).toBe(0);

      api.setPaused(true);
      expect(ctx.calls.suspend).toBe(1);

      // Вот ради чего тест: раньше `ensure()` видел suspended и звал resume(), то есть
      // любой тап во время рекламы включал звук обратно — прямое нарушение п. 1.3.
      api.play('tap');
      api.play('send');
      expect(ctx.calls.resume).toBe(0);
      expect(ctx.state).toBe('suspended');

      api.setPaused(false);
      expect(ctx.calls.resume).toBe(1);
    } finally {
      if (had) g.AudioContext = prev;
      else delete g.AudioContext;
    }
  });
});
