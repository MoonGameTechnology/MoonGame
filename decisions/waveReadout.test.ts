import { describe, it, expect } from 'vitest';
import { waveReadout } from './waveReadout';

const HOUR = 3_600_000;

describe('waveReadout — что показать игроку про волны Роя (PVR-1.2)', () => {
  it('не PvE-матч — показывать нечего', () => {
    expect(waveReadout(undefined, HOUR)).toEqual({ kind: 'none' });
  });

  it('волны идут: сколько пришло, сколько всего и сколько до следующей', () => {
    const pve = { waveNumber: 3, totalWaves: 10, npcPlayerId: 'p3', nextWaveAt: 5 * HOUR };
    expect(waveReadout(pve, 2 * HOUR)).toEqual({
      kind: 'waves',
      wave: 3,
      total: 10,
      nextInMs: 3 * HOUR,
    });
  });

  it('до первой волны счёт идёт с нуля — это ЧЕСТНО: пришло ноль из десяти', () => {
    const pve = { waveNumber: 0, totalWaves: 10, npcPlayerId: 'p3', nextWaveAt: 6 * HOUR };
    expect(waveReadout(pve, 0)).toEqual({ kind: 'waves', wave: 0, total: 10, nextInMs: 6 * HOUR });
  });

  it('волна уже наступила, но мир её ещё не отработал — отсчёт стоит на нуле, не уходит в минус', () => {
    const pve = { waveNumber: 1, totalWaves: 10, npcPlayerId: 'p3', nextWaveAt: 2 * HOUR };
    expect(waveReadout(pve, 3 * HOUR)).toEqual({ kind: 'waves', wave: 1, total: 10, nextInMs: 0 });
  });

  it('последняя волна пришла — отсчёта больше нет, и это отдельный ответ', () => {
    // `nextWaveAt` модуль СНИМАЕТ после последней волны: новых поводов не осталось.
    const pve = { waveNumber: 10, totalWaves: 10, npcPlayerId: 'p3' };
    expect(waveReadout(pve, 99 * HOUR)).toEqual({ kind: 'cleared', total: 10 });
  });

  it('штурма нет, а отсчёт пропал — считаем, что волн больше не будет, а не рисуем пустоту', () => {
    // Защита от состояния, которого модуль не создаёт, но которое может приехать из
    // сейва старой сборки: ответ обязан остаться осмысленным, а не «none».
    const pve = { waveNumber: 4, totalWaves: 10, npcPlayerId: 'p3' };
    expect(waveReadout(pve, HOUR)).toEqual({ kind: 'cleared', total: 10 });
  });

  it('волны кончились, но режим объявил удержание — отсчёт до победы (PVR-2.5)', () => {
    const pve = { waveNumber: 10, totalWaves: 10, npcPlayerId: 'p3', holdUntil: 72 * HOUR };
    expect(waveReadout(pve, 65 * HOUR)).toEqual({ kind: 'hold', total: 10, holdInMs: 7 * HOUR });
  });

  it('срок удержания наступил, а вердикт ещё не вынесен — ноль, а не минус', () => {
    const pve = { waveNumber: 10, totalWaves: 10, npcPlayerId: 'p3', holdUntil: 72 * HOUR };
    expect(waveReadout(pve, 73 * HOUR)).toEqual({ kind: 'hold', total: 10, holdInMs: 0 });
  });
});
