/**
 * SND-1 — синтезированные звуки интерфейса: «тёмный космос + космическая опера».
 *
 * Ни одного аудиофайла: каждый звук — ПАТЧ, данные для крошечного WebAudio-синта
 * (осцилляторы + шум → ловпасс → огибающая → общее «космическое» эхо). Патчи —
 * чистые данные, и именно их держат тесты: «ненавязчивость» здесь не вкус, а
 * инварианты (короткие длительности, потолок громкости, мягкие атаки без щелчков).
 *
 * Эстетика в трёх решениях:
 * - «тёмный космос» — ловпасс-фильтры со срезом вниз (тембры без верха), суб-тени
 *   на октаву-две ниже основного тона, длинное тёмное эхо (две ленты задержки с
 *   обратной связью через ловпасс — космос без импульсных откликов);
 * - «космическая опера» — интервалы чистых квинт, расстроенные (±центы) двойные
 *   голоса как маленький хор, медленные атаки падов на больших моментах;
 * - «консоль» — сами жесты короткие: блип с глиссандо вниз на тап, обратный блип
 *   на закрытие, диссонирующая малая секунда на отказ.
 *
 * Звук — украшение: ЛЮБАЯ ошибка WebAudio глушится молча (это не игровое правило,
 * fail-secure тут не применим — падение синта не должно уронить интерфейс).
 * AudioContext создаётся лениво при первом play() — тот всегда происходит внутри
 * пользовательского жеста (клик), что удовлетворяет autoplay-политике браузеров.
 */

export type SoundId = 'tap' | 'close' | 'error' | 'send' | 'start';

export interface SoundVoice {
  /** Форма волны; 'noise' — белый шум (шорох/выдох консоли). */
  wave: 'sine' | 'triangle' | 'sawtooth' | 'noise';
  /** Начальная частота, Гц. Для noise поля частоты не используются. */
  f0: number;
  /** Конечная частота глиссандо (нет — тон ровный). */
  f1?: number;
  /** Расстройка «хора»: два осциллятора ±cents вместо одного. */
  detune?: number;
  /** Пиковая громкость голоса, 0..1 (до мастера и общего трима). */
  gain: number;
  /** Атака, сек — не короче 2 мс, иначе щелчок. */
  attack: number;
  /** Спад до тишины, сек. */
  decay: number;
  /** Задержка старта, сек — арпеджио и ступени фанфары. */
  at?: number;
  /** Срез ловпасса, Гц (тёмный тембр); lp1 — куда срез уезжает за время звука. */
  lp?: number;
  lp1?: number;
}

export interface SoundPatch {
  voices: SoundVoice[];
  /** Посыл в космическое эхо, 0..1. */
  echo: number;
}

/** Минимальный зазор между повторами одного звука, сек — очередь одинаковых
 *  тапов не должна сливаться в трель. */
export const SOUND_MIN_GAP: Record<SoundId, number> = {
  tap: 0.045,
  close: 0.12,
  error: 0.25,
  send: 0.4,
  start: 1.0,
};

export const SOUND_PATCHES: Record<SoundId, SoundPatch> = {
  // Консольный блип: короткое глиссандо вниз + суб-тень октавами ниже.
  tap: {
    echo: 0.16,
    voices: [
      { wave: 'sine', f0: 880, f1: 587, gain: 0.15, attack: 0.004, decay: 0.07, lp: 2400 },
      { wave: 'triangle', f0: 220, f1: 185, gain: 0.05, attack: 0.006, decay: 0.09, lp: 900 },
    ],
  },
  // Закрытие: обратный блип вниз + короткий шорох-выдох.
  close: {
    echo: 0.2,
    voices: [
      { wave: 'sine', f0: 523, f1: 330, gain: 0.12, attack: 0.005, decay: 0.09, lp: 1800 },
      { wave: 'noise', f0: 0, gain: 0.045, attack: 0.004, decay: 0.12, lp: 1200, lp1: 320 },
    ],
  },
  // Отказ: малая секунда (биения двух пил) в тёмном фильтре + суб-удар.
  error: {
    echo: 0.28,
    voices: [
      { wave: 'sawtooth', f0: 196, f1: 174, gain: 0.08, attack: 0.006, decay: 0.22, lp: 750 },
      { wave: 'sawtooth', f0: 208, gain: 0.06, attack: 0.006, decay: 0.2, lp: 750 },
      { wave: 'sine', f0: 55, f1: 41, gain: 0.11, attack: 0.003, decay: 0.18 },
    ],
  },
  // «Приказ ушёл»: восходящее арпеджио чистых квинт поверх тёмного пада — тихая
  // помпезность: план флота это событие, но не победа.
  send: {
    echo: 0.42,
    voices: [
      { wave: 'triangle', f0: 220, gain: 0.1, attack: 0.008, decay: 0.3, lp: 2000 },
      { wave: 'triangle', f0: 330, gain: 0.09, attack: 0.008, decay: 0.35, lp: 2000, at: 0.07 },
      { wave: 'triangle', f0: 440, gain: 0.08, attack: 0.01, decay: 0.5, lp: 2200, at: 0.14 },
      { wave: 'sawtooth', f0: 110, detune: 8, gain: 0.05, attack: 0.18, decay: 0.9, lp: 620 },
      { wave: 'sawtooth', f0: 165, detune: 8, gain: 0.04, attack: 0.22, decay: 0.85, lp: 620 },
    ],
  },
  // Старт матча: стек квинт со ступенчатыми атаками над суб-тоном — фанфара,
  // прижатая фильтрами до полушёпота.
  start: {
    echo: 0.5,
    voices: [
      { wave: 'sine', f0: 55, gain: 0.12, attack: 0.3, decay: 1.4 },
      { wave: 'sawtooth', f0: 110, detune: 6, gain: 0.05, attack: 0.25, decay: 1.3, lp: 500 },
      { wave: 'sawtooth', f0: 164.8, detune: 6, gain: 0.045, attack: 0.25, decay: 1.2, lp: 560, at: 0.15 },
      { wave: 'triangle', f0: 220, gain: 0.065, attack: 0.12, decay: 1.0, lp: 1200, at: 0.35 },
      { wave: 'triangle', f0: 329.6, gain: 0.055, attack: 0.1, decay: 0.9, lp: 1400, at: 0.55 },
      { wave: 'sine', f0: 440, f1: 444, gain: 0.03, attack: 0.3, decay: 0.8, at: 0.8 },
    ],
  },
};

/** Полная длительность патча, сек (для тестов «короткое — короткое»). */
export function patchDuration(p: SoundPatch): number {
  let end = 0;
  for (const v of p.voices) end = Math.max(end, (v.at ?? 0) + v.attack + v.decay);
  return end;
}

/** Сумма пиковых громкостей голосов — грубый потолок «ненавязчивости». */
export function patchPeakBudget(p: SoundPatch): number {
  return p.voices.reduce((a, v) => a + v.gain, 0);
}

// ---------------------------------------------------------------------------

export interface SoundApi {
  play(id: SoundId): void;
  enabled(): boolean;
  setEnabled(on: boolean): void;
  /** Громкость 0..1 (поверх встроенного трима −8 дБ). */
  volume(): number;
  setVolume(v: number): void;
}

// Префикс проекта для настроек — void.* (vd.* носит только dev-флаг).
const STORE_ON = 'void.snd';
const STORE_VOL = 'void.sndVol';
/** Общий трим: даже на полной громкости звуки сидят под интерфейсом, не поверх. */
const MASTER_TRIM = 0.4;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** Собрать синт. `store` инжектится ради тестов (в Node нет ни localStorage, ни
 *  AudioContext — сам синт при их отсутствии молча выключен, настройки работают). */
export function initSound(store: Store | null): SoundApi {
  let on = store?.getItem(STORE_ON) !== '0'; // по умолчанию ВКЛ — но тихо
  let vol = (() => {
    // ЛОВУШКА: Number(null) === 0, не NaN — отсутствующий ключ без явной проверки
    // рождал бы громкость 0 на каждом чистом профиле (поймано живой проверкой).
    const raw = store?.getItem(STORE_VOL);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.7;
  })();

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let echoIn: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let dead = false; // среда без WebAudio — навсегда молчим, не пробуя снова
  const lastAt = new Map<SoundId, number>();

  function ensure(): boolean {
    if (dead || !on) return false;
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      return true;
    }
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = vol * MASTER_TRIM;
      master.connect(ctx.destination);
      // «Космос»: две ленты задержки с обратной связью, каждая через тёмный
      // ловпасс — длинный неровный хвост без импульсного отклика.
      echoIn = ctx.createGain();
      for (const [dt, fb] of [
        [0.17, 0.34],
        [0.29, 0.27],
      ] as const) {
        const delay = ctx.createDelay(1);
        delay.delayTime.value = dt;
        const back = ctx.createGain();
        back.gain.value = fb;
        const dark = ctx.createBiquadFilter();
        dark.type = 'lowpass';
        dark.frequency.value = 1100;
        echoIn.connect(delay);
        delay.connect(dark);
        dark.connect(back);
        back.connect(delay);
        dark.connect(master);
      }
      const len = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const ch = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      dead = true; // без WebAudio интерфейс живёт как жил — просто беззвучно
      ctx = null;
      return false;
    }
  }

  function voiceSource(v: SoundVoice, t0: number, cents: number): AudioScheduledSourceNode {
    if (v.wave === 'noise') {
      const src = ctx!.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      return src;
    }
    const osc = ctx!.createOscillator();
    osc.type = v.wave;
    osc.detune.value = cents;
    osc.frequency.setValueAtTime(Math.max(1, v.f0), t0);
    if (v.f1 !== undefined)
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, v.f1), t0 + v.attack + v.decay);
    return osc;
  }

  function spawn(v: SoundVoice, when: number, echo: number): void {
    const t0 = when + (v.at ?? 0);
    const tEnd = t0 + v.attack + v.decay;
    // Расстройка = маленький хор: два голоса ±cents, каждый вполсилы.
    const spread = v.detune ? [-v.detune, v.detune] : [0];
    for (const cents of spread) {
      const src = voiceSource(v, t0, cents);
      const flt = ctx!.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(v.lp ?? 8000, t0);
      if (v.lp1 !== undefined) flt.frequency.exponentialRampToValueAtTime(Math.max(40, v.lp1), tEnd);
      const env = ctx!.createGain();
      const peak = v.gain / spread.length;
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(peak, t0 + v.attack);
      env.gain.exponentialRampToValueAtTime(0.0001, tEnd);
      src.connect(flt);
      flt.connect(env);
      env.connect(master!);
      if (echo > 0) {
        const wet = ctx!.createGain();
        wet.gain.value = echo;
        env.connect(wet);
        wet.connect(echoIn!);
      }
      src.start(t0);
      src.stop(tEnd + 0.06);
    }
  }

  return {
    play(id) {
      try {
        if (!ensure()) return;
        const now = ctx!.currentTime;
        const prev = lastAt.get(id) ?? -1;
        if (now - prev < SOUND_MIN_GAP[id]) return;
        lastAt.set(id, now);
        const p = SOUND_PATCHES[id];
        for (const v of p.voices) spawn(v, now, p.echo);
      } catch {
        /* звук — украшение: любой сбой синта молча игнорируется */
      }
    },
    enabled: () => on,
    setEnabled(next) {
      on = next;
      try {
        store?.setItem(STORE_ON, next ? '1' : '0');
      } catch {
        /* приватный режим без localStorage — настройка живёт до перезагрузки */
      }
      if (!next && ctx) void ctx.suspend().catch(() => {});
    },
    volume: () => vol,
    setVolume(v) {
      vol = Math.max(0, Math.min(1, v));
      try {
        store?.setItem(STORE_VOL, String(vol));
      } catch {
        /* см. выше */
      }
      if (master) master.gain.value = vol * MASTER_TRIM;
    },
  };
}
