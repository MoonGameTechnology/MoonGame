import { describe, expect, it } from 'vitest';
import { bootRoster, newMatchId, MAX_HOSTED_MATCHES } from './matchRoster';
import { MemoryMatchStore } from './store/memory';
import { createInitialState } from '@void/shared-core';

describe('bootRoster — какие партии хост поднимает на старте (ADDR-1)', () => {
  describe('правило 1 — источник истины это СТОР, а не переменная окружения', () => {
    it('найденные в сторе партии поднимаются как есть', () => {
      expect(bootRoster({ stored: ['m-a', 'm-b'], seedCount: 1 })).toEqual({
        raise: ['m-a', 'm-b'],
        seeded: [],
      });
    });

    it('порядок стора сохраняется — сортировать не наше дело', () => {
      expect(bootRoster({ stored: ['z', 'a', 'm'], seedCount: 1 }).raise).toEqual(['z', 'a', 'm']);
    });
  });

  describe('правило 2 — засев только в ПУСТОЙ стор', () => {
    it('пустой стор засевается запрошенным числом партий', () => {
      const r = bootRoster({ stored: [], seedCount: 3 });
      expect(r.raise).toHaveLength(3);
      expect(r.seeded).toEqual(r.raise); // засеянные и есть поднятые
    });

    it('первая партия сохраняет исторический id — старые снапшоты и билеты живы', () => {
      expect(bootRoster({ stored: [], seedCount: 1 }).raise).toEqual(['proto']);
    });

    it('непустой стор НЕ засевается: рестарт не плодит комнаты', () => {
      const r = bootRoster({ stored: ['m-a'], seedCount: 5 });
      expect(r.raise).toEqual(['m-a']);
      expect(r.seeded).toEqual([]);
    });
  });

  describe('правило 3 — количество ограничено', () => {
    it('засев зажат сверху', () => {
      expect(bootRoster({ stored: [], seedCount: 999 }).raise).toHaveLength(MAX_HOSTED_MATCHES);
    });

    it('засев не бывает меньше одной партии', () => {
      expect(bootRoster({ stored: [], seedCount: 0 }).raise).toEqual(['proto']);
      expect(bootRoster({ stored: [], seedCount: -3 }).raise).toEqual(['proto']);
    });

    it('но найденное в сторе НЕ обрезается — это живые партии, а не пожелание', () => {
      const many = Array.from({ length: MAX_HOSTED_MATCHES + 4 }, (_, i) => `m-${i}`);
      expect(bootRoster({ stored: many, seedCount: 1 }).raise).toEqual(many);
    });
  });
});

describe('newMatchId — идентификатор новой партии (ADDR-1)', () => {
  it('не выводится из порядкового номера в процессе', () => {
    const a = newMatchId();
    const b = newMatchId();
    expect(a).not.toBe(b);
    expect(a).not.toMatch(/^proto(-\d+)?$/);
  });

  it('той же формы, что у канонического сервера — хосты не расходятся в адресах', () => {
    expect(newMatchId()).toMatch(/^m-[0-9a-f-]{36}$/);
  });
});

describe('замыкание контракта: созданная партия переживает рестарт (ADDR-1)', () => {
  /** Снимок партии в том же виде, в каком его сохраняет хост. */
  const snap = (matchId: string, status: 'ongoing' | 'ended' = 'ongoing') => ({
    matchId,
    dataVersion: 'proto',
    seq: 0,
    status,
    state: createInitialState({ seed: matchId, version: { data: '0.1.0', manifest: '1' } }),
  });

  it('партия, созданная по требованию, поднимается следующим стартом', async () => {
    const store = new MemoryMatchStore();
    // Первый старт: стор пуст → засеваем историческую `proto`.
    const first = bootRoster({ stored: await store.ongoingMatchIds(), seedCount: 1 });
    expect(first.raise).toEqual(['proto']);
    for (const id of first.raise) await store.save(snap(id));

    // Игрок создаёт партию по требованию — хост сохраняет её сразу, не дожидаясь хода.
    const created = newMatchId();
    await store.save(snap(created));

    // Рестарт процесса: список приходит из СТОРА, а не из MATCHES=N.
    const second = bootRoster({ stored: await store.ongoingMatchIds(), seedCount: 1 });
    expect(second.raise).toEqual(expect.arrayContaining(['proto', created]));
    expect(second.seeded).toEqual([]); // и ничего не досеивается поверх
  });

  it('законченная партия не поднимается заново — стор её уже не считает живой', async () => {
    const store = new MemoryMatchStore();
    await store.save(snap('m-done', 'ended'));
    await store.save(snap('m-live'));
    expect(bootRoster({ stored: await store.ongoingMatchIds(), seedCount: 1 }).raise).toEqual([
      'm-live',
    ]);
  });
});
