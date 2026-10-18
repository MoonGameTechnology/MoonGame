import { describe, expect, it } from 'vitest';
import { freeMatchId, newMatchId } from './matchId';

describe('идентификатор партии (ADDR-1)', () => {
  it('номер из восьми цифр без ведущего нуля (правила 1–2)', () => {
    for (let i = 0; i < 200; i++) expect(newMatchId()).toMatch(/^[1-9][0-9]{7}$/);
  });

  it('ЭТО НЕ ПОРЯДКОВЫЙ НОМЕР — соседний номер не следует из прошлого', () => {
    // Ровно то, от чего уводит ADDR-1: `proto`, `proto-2`, … — это «комната №N ЭТОГО
    // процесса», а не адрес партии.
    const ids = Array.from({ length: 50 }, () => Number(newMatchId()));
    const steps = ids.slice(1).filter((id, i) => id === ids[i]! + 1);
    expect(steps).toHaveLength(0);
  });

  it('свободный номер обходит занятые (правило 3)', async () => {
    const seen = new Set<string>();
    let calls = 0;
    const id = await freeMatchId((candidate) => {
      calls++;
      seen.add(candidate);
      return calls < 3; // первые два номера заняты
    });
    expect(calls).toBe(3);
    expect(seen.has(id)).toBe(true);
  });

  it('асинхронная проверка (стор) — тоже', async () => {
    const taken = new Set<string>();
    for (let i = 0; i < 300; i++) taken.add(await freeMatchId(async (c) => taken.has(c)));
    expect(taken.size).toBe(300);
  });

  it('свободного нет — честный отказ, а не чужой номер', async () => {
    await expect(freeMatchId(() => true)).rejects.toThrow('no free match id');
  });
});
