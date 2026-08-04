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
  it('каталог покрывает все пять жестов, и у каждого есть анти-трель зазор', () => {
    expect(IDS.sort()).toEqual(['close', 'error', 'send', 'start', 'tap']);
    for (const id of IDS) expect(SOUND_MIN_GAP[id]).toBeGreaterThan(0);
  });

  it('жесты короткие: тап/закрытие < 0.35с, отказ < 0.6с, флориш < 1.6с, фанфара < 2.2с', () => {
    expect(patchDuration(SOUND_PATCHES.tap)).toBeLessThan(0.35);
    expect(patchDuration(SOUND_PATCHES.close)).toBeLessThan(0.35);
    expect(patchDuration(SOUND_PATCHES.error)).toBeLessThan(0.6);
    expect(patchDuration(SOUND_PATCHES.send)).toBeLessThan(1.6);
    expect(patchDuration(SOUND_PATCHES.start)).toBeLessThan(2.2);
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
