import { describe, expect, it } from 'vitest';
import { CLOUD_MAX_FAILURES, CLOUD_MIN_INTERVAL_MS, createCloudWriter } from './cloudWriter';

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
