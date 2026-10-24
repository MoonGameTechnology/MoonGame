import { describe, expect, it } from 'vitest';
import { simWorkerScript } from './simWorker';

const URL_ = 'sim-worker-0a1b2c3d.js';
const SRC = 'self.onmessage=()=>{}';

describe('откуда поднять поток расчёта', () => {
  it('страница с сайта или сервера берёт файл потока, а не строку (правило 1)', () => {
    for (const protocol of ['https:', 'http:']) {
      expect(simWorkerScript({ protocol, query: null, url: URL_, source: SRC })).toEqual({
        url: URL_,
      });
    }
  });

  it('страница с диска берёт исходник строкой, если сборка его несёт (правило 2)', () => {
    expect(simWorkerScript({ protocol: 'file:', query: null, url: URL_, source: SRC })).toEqual({
      source: SRC,
    });
    expect(simWorkerScript({ protocol: 'file:', query: null, url: URL_, source: '' })).toBeNull();
  });

  it('`?sim=frame` оставляет мир в кадре (правило 3)', () => {
    expect(
      simWorkerScript({ protocol: 'https:', query: 'frame', url: URL_, source: SRC }),
    ).toBeNull();
    expect(
      simWorkerScript({ protocol: 'file:', query: 'frame', url: URL_, source: SRC }),
    ).toBeNull();
  });

  it('другой флаг потоку не мешает', () => {
    expect(simWorkerScript({ protocol: 'https:', query: 'worker', url: URL_, source: '' })).toEqual(
      {
        url: URL_,
      },
    );
  });

  it('сборка без потока — мир в кадре (правило 4)', () => {
    expect(simWorkerScript({ protocol: 'https:', query: null, url: '', source: '' })).toBeNull();
  });
});
