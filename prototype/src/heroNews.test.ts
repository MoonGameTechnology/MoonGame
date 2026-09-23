import { describe, expect, it } from 'vitest';
import { heroDiedNews, heroRespawnedNews, type HeroNewsHero } from './heroNews';

const HOUR = 3_600_000;
const onMap = (node: string): boolean => node === 'A' || node === 'B';
const mine = (over: Partial<HeroNewsHero> = {}): HeroNewsHero => ({
  owner: 'p1',
  location: 'A',
  cooldowns: { respawn: 30 * HOUR },
  ...over,
});

describe('лента о герое — гибель (AUD-16)', () => {
  it('свой герой: строка со сроком попытки и якорем на его последний узел', () => {
    const news = heroDiedNews({ owner: 'p1', heroId: 'h1' }, mine(), 'p1', 6 * HOUR, onMap);
    expect(news).toEqual({ key: 'log.hero.died', heroId: 'h1', at: 'A', leftMs: 24 * HOUR });
  });

  it('чужой герой — молчание: в сети геройские события строго владельцу (правило 1)', () => {
    expect(heroDiedNews({ owner: 'p2', heroId: 'h2' }, mine({ owner: 'p2' }), 'p1', 0, onMap)).toBeNull();
    // Нагрузка и состояние обязаны сходиться: «мой» в событии при чужом герое в состоянии
    // — это не мой герой, и строка о нём была бы враньём.
    expect(heroDiedNews({ owner: 'p1', heroId: 'h2' }, mine({ owner: 'p2' }), 'p1', 0, onMap)).toBeNull();
  });

  it('срок уже прошёл (перемотка отдала гибель и возвращение одной пачкой) — строка без срока', () => {
    const news = heroDiedNews({ owner: 'p1', heroId: 'h1' }, mine(), 'p1', 30 * HOUR, onMap);
    expect(news).toEqual({ key: 'log.hero.died.bare', heroId: 'h1', at: 'A' });
    // И без назначенной попытки вовсе — тоже без срока, а не «через NaN».
    const none = heroDiedNews({ owner: 'p1', heroId: 'h1' }, mine({ cooldowns: {} }), 'p1', 0, onMap);
    expect(none?.key).toBe('log.hero.died.bare');
  });

  it('узла нет на карте — строка без якоря, а не якорь в пустоту (правило 4)', () => {
    const news = heroDiedNews({ owner: 'p1', heroId: 'h1' }, mine({ location: 'Z' }), 'p1', 0, onMap);
    expect(news?.at).toBeUndefined();
  });

  it('неизвестный герой или битая нагрузка — молчание', () => {
    expect(heroDiedNews({ owner: 'p1', heroId: 'h1' }, undefined, 'p1', 0, onMap)).toBeNull();
    expect(heroDiedNews({ owner: 'p1', heroId: 7 }, mine(), 'p1', 0, onMap)).toBeNull();
  });
});

describe('лента о герое — возвращение (AUD-16)', () => {
  it('свой герой: якорь на мир, где поднялся корабль', () => {
    expect(heroRespawnedNews({ owner: 'p1', heroId: 'h1', at: 'B' }, 'p1', onMap)).toEqual({
      key: 'log.hero.respawned',
      heroId: 'h1',
      at: 'B',
    });
  });

  it('чужой — молчание; мир не на карте — без якоря', () => {
    expect(heroRespawnedNews({ owner: 'p2', heroId: 'h2', at: 'B' }, 'p1', onMap)).toBeNull();
    expect(heroRespawnedNews({ owner: 'p1', heroId: 'h1', at: 'Z' }, 'p1', onMap)?.at).toBeUndefined();
  });
});
