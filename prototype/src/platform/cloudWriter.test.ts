import { describe, expect, it, vi } from 'vitest';
import {
  CLOUD_MAX_FAILURES,
  CLOUD_MIN_INTERVAL_MS,
  CLOUD_SEND_TIMEOUT_MS,
  createCloudWriter,
} from './cloudWriter';

/** Ручные часы: таймеры срабатывают, только когда тест двигает время. */
function clock() {
  let t = 1_000_000;
  let timers: { at: number; run: () => void }[] = [];
  return {
    now: () => t,
    setTimer: (run: () => void, ms: number) => {
      const timer = { at: t + ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((x) => x !== timer);
      };
    },
    async advance(ms: number) {
      t += ms;
      for (const timer of timers.filter((x) => x.at <= t)) {
        timers = timers.filter((x) => x !== timer);
        timer.run();
      }
      await flush();
    },
  };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(fail: (n: number) => boolean = () => false) {
  const c = clock();
  const sent: { snapshot: string; flush: boolean }[] = [];
  const errors: unknown[] = [];
  const writer = createCloudWriter({
    now: c.now,
    setTimer: c.setTimer,
    onError: (e) => errors.push(e),
    send: async (snapshot, f) => {
      sent.push({ snapshot, flush: f });
      if (fail(sent.length)) throw new Error('offline');
    },
  });
  return { c, sent, errors, writer };
}

describe('YAG-2.2 — запись в облако бережёт квоту', () => {
  it('первая запись уходит сразу', async () => {
    const { sent, writer } = setup();
    await writer.save('a');
    expect(sent).toEqual([{ snapshot: 'a', flush: false }]);
  });

  it('частые события — одна запись последнего снимка в следующее окно', async () => {
    const { c, sent, writer } = setup();
    await writer.save('a');
    const late = [writer.save('b'), writer.save('c'), writer.save('d')];
    await flush();
    expect(sent).toHaveLength(1); // окно ещё не открылось
    await c.advance(CLOUD_MIN_INTERVAL_MS);
    await Promise.all(late); // промисы всех вытесненных снимков тоже закрываются
    expect(sent.map((s) => s.snapshot)).toEqual(['a', 'd']);
  });

  it('за 5 минут непрерывных событий — около половины квоты (51 из 100)', async () => {
    const { c, sent, writer } = setup();
    for (let ms = 0; ms < 5 * 60_000; ms += 500) {
      void writer.save(`s${ms}`);
      await c.advance(500);
    }
    // Раз в окно плюс первая запись: 300 с / 6 с + 1.
    expect(sent.length).toBeLessThanOrEqual(Math.floor(300_000 / CLOUD_MIN_INTERVAL_MS) + 1);
    expect(sent.length).toBeLessThan(100 / 1.9);
  });

  it('уход со страницы отправляет сразу, не дожидаясь окна', async () => {
    const { sent, writer } = setup();
    await writer.save('a');
    await writer.save('b', true);
    expect(sent).toEqual([
      { snapshot: 'a', flush: false },
      { snapshot: 'b', flush: true },
    ]);
  });
});

describe('YAG-2.2 — сбой облака', () => {
  it('сбой — повтор в следующее окно, промис не отклоняется', async () => {
    const { c, sent, errors, writer } = setup((n) => n === 1);
    const first = writer.save('a');
    await flush();
    expect(errors).toHaveLength(1);
    await c.advance(CLOUD_MIN_INTERVAL_MS);
    await first;
    expect(sent.map((s) => s.snapshot)).toEqual(['a', 'a']);
  });

  it('новый снимок вместо повтора старого — уходит новый', async () => {
    const { c, sent, writer } = setup((n) => n === 1);
    void writer.save('a');
    await flush();
    const next = writer.save('b');
    await c.advance(CLOUD_MIN_INTERVAL_MS);
    await next;
    expect(sent.map((s) => s.snapshot)).toEqual(['a', 'b']);
  });

  it(`после ${CLOUD_MAX_FAILURES} сбоев подряд повторы прекращаются до следующего события`, async () => {
    const { c, sent, writer } = setup(() => true);
    const doomed = writer.save('a');
    for (let i = 0; i < 10; i++) await c.advance(CLOUD_MIN_INTERVAL_MS);
    await doomed; // закрыт, а не висит вечно
    expect(sent).toHaveLength(CLOUD_MAX_FAILURES);
  });
});

describe('AUD-34 — облако не запирается чужим SDK и переводом часов', () => {
  it('запись, на которую SDK не ответил, — сбой по сроку, и следующая уходит', async () => {
    const c = clock();
    const sent: string[] = [];
    const errors: unknown[] = [];
    const writer = createCloudWriter({
      now: c.now,
      setTimer: c.setTimer,
      onError: (e) => errors.push(e),
      send: (snapshot) => {
        sent.push(snapshot);
        // Первая запись висит вечно — так выглядит SDK, который не ответил.
        return sent.length === 1 ? new Promise<void>(() => {}) : Promise.resolve();
      },
    });
    void writer.save('a');
    await flush();
    await c.advance(CLOUD_SEND_TIMEOUT_MS);
    expect(errors).toEqual([new Error('E_CLOUD_SEND_TIMEOUT')]);
    const next = writer.save('b');
    await c.advance(CLOUD_MIN_INTERVAL_MS);
    await next;
    // Несостоявшаяся запись повторяется, как при любом сбое, а новая идёт следом.
    expect(sent).toEqual(['a', 'a', 'b']);
  });

  it('ответ SDK после срока ничего не повторяет и не ломает счёт', async () => {
    const c = clock();
    let answer: () => void = () => {};
    const sent: string[] = [];
    const writer = createCloudWriter({
      now: c.now,
      setTimer: c.setTimer,
      send: (snapshot) => {
        sent.push(snapshot);
        return new Promise<void>((resolve) => (answer = resolve));
      },
    });
    void writer.save('a');
    await flush();
    await c.advance(CLOUD_SEND_TIMEOUT_MS); // сбой по сроку — повтор в следующее окно
    answer(); // опоздавший ответ первой записи
    await c.advance(CLOUD_MIN_INTERVAL_MS);
    answer();
    await flush();
    expect(sent).toEqual(['a', 'a']);
  });

  it('часы, переведённые назад, не откладывают запись на час: окно — по монотонным часам', async () => {
    const waits: number[] = [];
    const writer = createCloudWriter({
      setTimer: (_run, ms) => {
        waits.push(ms);
        return () => {};
      },
      send: async () => {},
    });
    await writer.save('a');
    const wall = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(wall - 3_600_000);
    try {
      void writer.save('b');
      await flush();
    } finally {
      spy.mockRestore();
    }
    const window = waits.filter((ms) => ms !== CLOUD_SEND_TIMEOUT_MS);
    expect(window).toHaveLength(1);
    expect(window[0]).toBeLessThanOrEqual(CLOUD_MIN_INTERVAL_MS);
  });
});
