import { describe, expect, it } from 'vitest';
import { cardFacts, modeRepeatsMap, type CardRow } from './matchCard';

const row = (over: Partial<CardRow> = {}): CardRow => ({
  players: { seated: 2, capacity: 2 },
  rules: {},
  ...over,
});

describe('имя карты уже называет формат (правило 1)', () => {
  it('стандарт, дуэль, команды N на N и столицы в тех же форматах повторяют карту', () => {
    for (const id of ['standard', 'duel', 'team_2v2', 'team_10v10', 'capital_duel', 'capital_2v2'])
      expect(modeRepeatsMap(id), id).toBe(true);
  });

  it('«2 на 2 · Разорванный предел» не пишет рядом «Двое на двое»', () => {
    expect(cardFacts(row({ modeId: 'team_2v2', kind: 'pvp' }), 'own').modeId).toBeUndefined();
  });

  it('PvE называет свой режим: «Волны Роя» в имени карты нет', () => {
    expect(cardFacts(row({ modeId: 'pve_waves', kind: 'pve' }), 'own')).toMatchObject({
      pve: true,
      modeId: 'pve_waves',
    });
  });

  it('захват столиц помечается по правилам партии, а имя режима с форматом молчит', () => {
    const facts = cardFacts(
      row({ modeId: 'capital_2v2', kind: 'pvp', rules: { victory: { capitalCapture: true } } }),
      'own',
    );
    expect(facts).toMatchObject({ capitals: true, pve: false });
    expect(facts.modeId).toBeUndefined();
  });
});

describe('PvP — обычное состояние (правило 2)', () => {
  it('значок только у PvE', () => {
    expect(cardFacts(row({ kind: 'pvp' }), 'available').pve).toBe(false);
    expect(cardFacts(row({ kind: 'pve' }), 'available').pve).toBe(true);
  });

  it('сервер не назвал вид — значка нет', () => {
    expect(cardFacts(row(), 'available').pve).toBe(false);
  });

  it('вид не посчитан, а режим назван — имя есть, значка нет: «раз не PvE, значит PvP» было бы ложью', () => {
    expect(cardFacts(row({ modeId: 'pve_waves' }), 'own')).toMatchObject({ pve: false, modeId: 'pve_waves' });
  });
});

describe('места — там, где они что-то решают (правило 3)', () => {
  it('на «Доступных» места видны всегда', () => {
    expect(cardFacts(row({ players: { seated: 2, capacity: 2 } }), 'available').seats).toBe(true);
  });

  it('у своей полной партии «2/2» повторяет «1 на 1» и не пишется', () => {
    expect(cardFacts(row({ players: { seated: 2, capacity: 2 } }), 'own').seats).toBe(false);
  });

  it('у своей партии со свободными креслами места видны: «8/20» в FFA на двадцать', () => {
    expect(cardFacts(row({ players: { seated: 8, capacity: 20 } }), 'own').seats).toBe(true);
  });
});

describe('правила — в «Описании» (правило 4)', () => {
  it('скорость — только на «Доступных», по ней выбирают партию', () => {
    expect(cardFacts(row(), 'available').speed).toBe(true);
    expect(cardFacts(row(), 'own').speed).toBe(false);
  });
});

describe('незнакомый режим называется (правило 5)', () => {
  it('режим вне списка форматов показывает имя', () => {
    expect(modeRepeatsMap('king_of_the_hill')).toBe(false);
    expect(cardFacts(row({ modeId: 'king_of_the_hill', kind: 'pvp' }), 'own').modeId).toBe('king_of_the_hill');
  });

  it('похожее, но не то имя — не формат: «team_2v2_ranked» называется', () => {
    expect(modeRepeatsMap('team_2v2_ranked')).toBe(false);
    expect(modeRepeatsMap('xduel')).toBe(false);
  });
});
