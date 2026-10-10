// Доктрина бота: какую ветку место ведёт и какие узлы она ставит вперёд цены.
import { describe, expect, it } from 'vitest';
import { data } from './gameData';
import { doctrineRanks, seatDoctrine } from './botDoctrine';

const council = (...ids: string[]) => ids.map((id) => ({ id }));
const doctrine = (...ids: string[]) =>
  seatDoctrine(council(...ids), data.scientists, data.technologies);

describe('доктрина места — ветка его учёного', () => {
  it('ветка учёного совета', () => {
    expect(doctrine('polymath', 'wing_commodore')).toBe('shuttle');
    expect(doctrine('bastion_marshal', 'void_admiral')).toBe('ground');
  });

  it('боевая ветка идёт вперёд командования, даже если командир совета первый', () => {
    expect(doctrine('overseer', 'ordnance_savant')).toBe('missile');
  });

  it('боевой ветки в совете нет — командование; веток нет вовсе — доктрины нет', () => {
    expect(doctrine('overseer', 'polymath')).toBe('command');
    expect(doctrine('polymath')).toBeUndefined();
    expect(seatDoctrine(undefined, data.scientists, data.technologies)).toBeUndefined();
  });
});

describe('ранги узлов доктрины', () => {
  it('путь к боевым узлам ветки берёт предпосылки из чужой ветки', () => {
    const ranks = doctrineRanks(data.technologies, 'ground');
    for (const id of [
      'combined_arms',
      'planetary_bastions',
      'fortified_infrastructure',
      // Бастионы стоят на автоматизации промышленности, а она в космической ветке.
      'industrial_automation',
    ])
      expect(ranks.get(id)).toBe(0);
    expect(ranks.get('garrison_networks')).toBe(1);
    expect(ranks.get('flight_decks')).toBeUndefined();
  });

  it('у космоса путь ведёт к осадной доктрине и армадам, а не к постройкам пустоты', () => {
    const ranks = doctrineRanks(data.technologies, 'space');
    expect(
      ['orbital_logistics', 'siege_doctrine', 'void_armadas'].map((id) => ranks.get(id)),
    ).toEqual([0, 0, 0]);
    expect(ranks.get('void_shielding')).toBe(1);
  });

  it('у ветки без боевых узлов путь ведёт к её высшему тиру', () => {
    const ranks = doctrineRanks(data.technologies, 'command');
    expect(ranks.get('ai_stewardship')).toBe(0);
    expect(ranks.get('signal_corps')).toBe(1);
  });

  it('узел, убранный режимом из матча, в доктрину не попадает', () => {
    const ranks = doctrineRanks(data.technologies, 'shuttle', (id) => id !== 'ace_programs');
    expect(ranks.has('ace_programs')).toBe(false);
    expect(ranks.get('strike_vectors')).toBe(0);
  });
});
