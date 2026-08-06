import { describe, it, expect } from 'vitest';
import type { DiplomaticStance, GameState } from '../../packages/shared-core/src/index';
import { STANCES, diffDiplomacy, otherInPair, stanceRank } from './diploEvents';

/** Снимок ровно в той части, которую читает сравнение. */
const snap = (
  diplomacy: Record<string, DiplomaticStance> = {},
  diplomacyOffers: Record<string, DiplomaticStance> = {},
): GameState => ({ diplomacy, diplomacyOffers }) as unknown as GameState;

describe('дипломатия — порядок дружелюбия', () => {
  it('война — дно, союз — вершина', () => {
    expect(stanceRank('war')).toBe(0);
    expect(stanceRank('alliance')).toBe(STANCES.length - 1);
  });

  it('мир теплее войны, пакт теплее мира', () => {
    expect(stanceRank('peace')).toBeGreaterThan(stanceRank('war'));
    expect(stanceRank('pact')).toBeGreaterThan(stanceRank('peace'));
  });

  it('незнакомая стойка не ломает порядок', () => {
    expect(stanceRank('чего-то новое' as DiplomaticStance)).toBe(0);
  });
});

describe('дипломатия — чья это пара', () => {
  it('я слева или справа — пара моя', () => {
    expect(otherInPair('p1|p2', 'p1')).toBe('p2');
    expect(otherInPair('p1|p2', 'p2')).toBe('p1');
  });

  it('меня в паре нет — она не моя', () => {
    expect(otherInPair('p2|p3', 'p1')).toBeNull();
  });
});

describe('дипломатия — сдвиги отношений', () => {
  it('объявленная мне война становится событием', () => {
    const evs = diffDiplomacy(snap({ 'p1|p2': 'peace' }), snap({ 'p1|p2': 'war' }), 'p1');
    expect(evs).toEqual([{ kind: 'stance', other: 'p2', stance: 'war' }]);
  });

  it('ЧУЖАЯ война между соперниками игроку не объявляется', () => {
    const evs = diffDiplomacy(snap({ 'p2|p3': 'peace' }), snap({ 'p2|p3': 'war' }), 'p1');
    expect(evs).toEqual([]);
  });

  it('ключа не было вовсе — это война по умолчанию, поэтому мир читается как ПОТЕПЛЕНИЕ', () => {
    const evs = diffDiplomacy(snap({}), snap({ 'p1|p2': 'peace' }), 'p1');
    expect(evs).toEqual([{ kind: 'stance', other: 'p2', stance: 'peace' }]);
  });

  it('ключ исчез — отношение вернулось к войне, и это событие', () => {
    const evs = diffDiplomacy(snap({ 'p1|p2': 'peace' }), snap({}), 'p1');
    expect(evs).toEqual([{ kind: 'stance', other: 'p2', stance: 'war' }]);
  });

  it('ничего не менялось — тишина', () => {
    const same = { 'p1|p2': 'pact' as DiplomaticStance };
    expect(diffDiplomacy(snap(same), snap(same), 'p1')).toEqual([]);
  });

  it('сдвиги по нескольким соперникам приходят все', () => {
    const evs = diffDiplomacy(
      snap({ 'p1|p2': 'peace', 'p1|p3': 'peace' }),
      snap({ 'p1|p2': 'war', 'p1|p3': 'alliance' }),
      'p1',
    );
    expect(evs).toHaveLength(2);
    expect(evs.map((e) => e.other).sort()).toEqual(['p2', 'p3']);
  });
});

describe('дипломатия — предложения', () => {
  it('входящее предложение — событие с именем предложившего', () => {
    const evs = diffDiplomacy(snap(), snap({}, { 'p2>p1': 'peace' }), 'p1');
    expect(evs).toEqual([{ kind: 'offer-in', other: 'p2', stance: 'peace' }]);
  });

  it('своё исходящее — ОТДЕЛЬНЫЙ вид: «отправлено», а не «вам предложили»', () => {
    const evs = diffDiplomacy(snap(), snap({}, { 'p1>p2': 'alliance' }), 'p1');
    expect(evs).toEqual([{ kind: 'offer-out', other: 'p2', stance: 'alliance' }]);
  });

  it('чужое предложение мимо меня не объявляется', () => {
    expect(diffDiplomacy(snap(), snap({}, { 'p2>p3': 'pact' }), 'p1')).toEqual([]);
  });

  it('ОТЗЫВ предложения отдельным событием не идёт — он едет со сдвигом стойки', () => {
    const evs = diffDiplomacy(snap({}, { 'p2>p1': 'peace' }), snap({}, {}), 'p1');
    expect(evs).toEqual([]);
  });

  it('то же предложение в двух снимках подряд не повторяется', () => {
    const offers = { 'p2>p1': 'peace' as DiplomaticStance };
    expect(diffDiplomacy(snap({}, offers), snap({}, offers), 'p1')).toEqual([]);
  });

  it('предложение сменило ранг — это новое событие', () => {
    const evs = diffDiplomacy(
      snap({}, { 'p2>p1': 'peace' }),
      snap({}, { 'p2>p1': 'alliance' }),
      'p1',
    );
    expect(evs).toEqual([{ kind: 'offer-in', other: 'p2', stance: 'alliance' }]);
  });

  it('сдвиг отношения объявляется РАНЬШЕ предложения — сперва «что стало»', () => {
    const evs = diffDiplomacy(
      snap({ 'p1|p2': 'war' }),
      snap({ 'p1|p2': 'peace' }, { 'p3>p1': 'pact' }),
      'p1',
    );
    expect(evs.map((e) => e.kind)).toEqual(['stance', 'offer-in']);
  });
});

describe('дипломатия — пустые снимки', () => {
  it('снимок без дипломатии вообще не роняет сравнение', () => {
    const bare = {} as GameState;
    expect(diffDiplomacy(bare, bare, 'p1')).toEqual([]);
  });

  it('битый ключ пары молча пропускается', () => {
    expect(diffDiplomacy(snap({}, { мусор: 'peace' }), snap({}, { мусор: 'pact' }), 'p1')).toEqual(
      [],
    );
  });
});
