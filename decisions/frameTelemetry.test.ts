import { describe, expect, it } from 'vitest';

import { parseClientMessage } from '../packages/protocol/src/index';
import {
  FRAME_WINDOW_EMPTY,
  LOAF_BY_MAX,
  countFrame,
  framePerfFields,
  invokerName,
  noteBlock,
  type LongFrameEntry,
} from './frameTelemetry';

/** Запись Long Animation Frame: кадр с `startTime` 1000 и скриптами `[длительность, вызывающий]`. */
function entry(duration: number, scripts: Array<[number, string]>, layoutMs = 0): LongFrameEntry {
  return {
    startTime: 1000,
    duration,
    styleAndLayoutStart: layoutMs > 0 ? 1000 + duration - layoutMs : 0,
    scripts: scripts.map(([d, invoker]) => ({ duration: d, invoker })),
  };
}

describe('frameTelemetry — долгие кадры', () => {
  it('обычный кадр окно не меняет и нового объекта не создаёт', () => {
    let w = countFrame(FRAME_WINDOW_EMPTY, 16.7);
    expect(w).toEqual({ longFrames: 0, worstFrameMs: 16.7, block: null });
    const same = w;
    for (let i = 0; i < 100; i++) w = countFrame(w, 16.6);
    expect(w).toBe(same);
  });

  it('долгий — строго дольше 50 мс; худший интервал помнится', () => {
    let w = FRAME_WINDOW_EMPTY;
    for (const dt of [16.7, 50, 51, 16.7, 120, 33]) w = countFrame(w, dt);
    expect(w.longFrames).toBe(2);
    expect(w.worstFrameMs).toBe(120);
  });

  it('окно без кадров полей о кадрах не шлёт, а не шлёт нули', () => {
    expect(framePerfFields(FRAME_WINDOW_EMPTY)).toEqual({});
  });

  it('поля сэмпла — в целых миллисекундах, ноль долгих кадров тоже отправляется', () => {
    expect(framePerfFields(countFrame(FRAME_WINDOW_EMPTY, 16.7))).toEqual({
      longFrames: 0,
      worstFrameMs: 17,
    });
    let w = FRAME_WINDOW_EMPTY;
    for (const dt of [16.7, 233.4, 16.7]) w = countFrame(w, dt);
    expect(framePerfFields(w)).toEqual({ longFrames: 1, worstFrameMs: 233 });
  });
});

describe('frameTelemetry — самая долгая блокировка главного потока', () => {
  it('скрипты складываются, раскладка — от её начала до конца кадра, вызывающий — у самого долгого', () => {
    const w = noteBlock(
      FRAME_WINDOW_EMPTY,
      entry(
        248,
        [
          [12, 'MessagePort.onmessage'],
          [218, 'FrameRequestCallback'],
        ],
        6,
      ),
    );
    expect(w.block).toEqual({ ms: 248, scriptMs: 230, layoutMs: 6, by: 'FrameRequestCallback' });
    expect(framePerfFields(w)).toEqual({
      loafMs: 248,
      loafScriptMs: 230,
      loafLayoutMs: 6,
      loafBy: 'FrameRequestCallback',
    });
  });

  it('остаётся самая долгая; более короткая окно не меняет', () => {
    let w = noteBlock(FRAME_WINDOW_EMPTY, entry(70, [[70, 'TimerHandler:setTimeout']]));
    w = noteBlock(w, entry(180, [[20, 'FrameRequestCallback']]));
    const kept = w;
    w = noteBlock(w, entry(90, [[90, 'TimerHandler:setTimeout']]));
    expect(w).toBe(kept);
    expect(w.block).toMatchObject({ ms: 180, scriptMs: 20, by: 'FrameRequestCallback' });
  });

  it('кадр без скриптов длиннее 5 мс: вызывающего нет, и поле не отправляется', () => {
    const w = noteBlock(FRAME_WINDOW_EMPTY, entry(120, []));
    expect(w.block).toEqual({ ms: 120, scriptMs: 0, layoutMs: 0, by: '' });
    expect(framePerfFields(w)).toEqual({ loafMs: 120, loafScriptMs: 0, loafLayoutMs: 0 });
  });

  it('интервалы и блокировка копятся в одном окне независимо', () => {
    let w = countFrame(FRAME_WINDOW_EMPTY, 90);
    w = noteBlock(w, entry(85, [[80, 'FrameRequestCallback']]));
    w = countFrame(w, 16.7);
    expect(framePerfFields(w)).toEqual({
      longFrames: 1,
      worstFrameMs: 90,
      loafMs: 85,
      loafScriptMs: 80,
      loafLayoutMs: 0,
      loafBy: 'FrameRequestCallback',
    });
  });
});

describe('frameTelemetry — имя вызывающего', () => {
  it('адрес теряет запрос и якорь: в адресе страницы бывает ссылка входа', () => {
    expect(invokerName('https://game.example/game/proto?join=wss%3A%2F%2Fx&token=abc')).toBe(
      'https://game.example/game/proto',
    );
    expect(invokerName('https://game.example/app.js#frag')).toBe('https://game.example/app.js');
  });

  it('только печатный ASCII и не длиннее предела', () => {
    expect(invokerName('DOMWindow.onpointermove\n\u0001карта')).toBe('DOMWindow.onpointermove');
    expect(invokerName('x'.repeat(300))).toHaveLength(LOAF_BY_MAX);
  });

  it('обычные имена проходят как есть', () => {
    for (const name of [
      'FrameRequestCallback',
      'TimerHandler:setTimeout',
      'MessagePort.onmessage',
    ]) {
      expect(invokerName(name)).toBe(name);
    }
  });
});

describe('frameTelemetry — сэмпл проходит разбор сервера как есть', () => {
  it('полное окно, в том числе самое длинное допустимое имя, доезжает без потерь', () => {
    let w = countFrame(FRAME_WINDOW_EMPTY, 233.4);
    w = noteBlock(w, entry(1024.4, [[1017.2, `https://x.example/${'a'.repeat(200)}?t=1`]], 4));
    const fields = framePerfFields(w);
    expect(fields.loafBy).toHaveLength(LOAF_BY_MAX);
    const sample = { type: 'perf' as const, fps: 18, ...fields };
    expect(parseClientMessage(JSON.stringify(sample))).toEqual(sample);
  });
});
