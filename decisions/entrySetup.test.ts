import { describe, expect, it } from 'vitest';
import {
  entryOffer,
  reconcileSelection,
  startEnabled,
  type MatchSeat,
  type StartWorld,
} from './entrySetup';

const seat = (over: Partial<MatchSeat> & { playerId: string }): MatchSeat => ({
  faction: 'azure',
  start: `w-${over.playerId}`,
  taken: false,
  ...over,
});

const SEATS: MatchSeat[] = [
  seat({ playerId: 'p1', faction: 'azure' }),
  seat({ playerId: 'p2', faction: 'crimson', taken: true }),
  seat({ playerId: 'p3', faction: 'amber' }),
  seat({ playerId: 'p4', faction: 'azure' }),
];

describe('entryOffer (ENTRY-2)', () => {
  it('порядок миров — порядок сервера, не сортировка (правило 1)', () => {
    expect(entryOffer(SEATS).worlds.map((w) => w.slot)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('занятый мир остаётся в списке — карта показывает расклад целиком (правило 2)', () => {
    const worlds = entryOffer(SEATS).worlds;
    expect(worlds).toHaveLength(4);
    expect(worlds.find((w) => w.slot === 'p2')?.taken).toBe(true);
  });

  it('дома — по первому появлению, без повторов (правило 3)', () => {
    expect(entryOffer(SEATS).houses).toEqual(['azure', 'crimson', 'amber']);
  });

  it('считает свободные миры', () => {
    expect(entryOffer(SEATS).free).toBe(3);
    expect(entryOffer(SEATS.map((s) => ({ ...s, taken: true }))).free).toBe(0);
  });

  it('пустой расклад не роняет и не выдумывает', () => {
    expect(entryOffer([])).toEqual({ worlds: [], houses: [], free: 0 });
  });

  it('место без известного мира всё равно занимаемо — рисовать нечего, играть можно', () => {
    const [world] = entryOffer([seat({ playerId: 'p1', start: null })]).worlds;
    expect(world?.planetId).toBeNull();
    expect(world?.taken).toBe(false);
  });

  // Правило 3 отдельно: дом НЕ исчезает из карточек оттого, что все места этого дома
  // заняты. До BF-30 это было бы «дом полон»; после — дом и место независимы.
  it('дом остаётся на выбор, даже когда все его места заняты (правило 3)', () => {
    const offer = entryOffer([
      seat({ playerId: 'p1', faction: 'crimson', taken: true }),
      seat({ playerId: 'p2', faction: 'azure' }),
    ]);
    expect(offer.houses).toContain('crimson');
    expect(offer.free).toBe(1);
  });
});

describe('startEnabled (правило 4)', () => {
  const worlds = entryOffer(SEATS).worlds;

  it('без выбранного мира заперта', () => {
    expect(startEnabled(null, worlds)).toBe(false);
  });

  it('на свободном мире открыта', () => {
    expect(startEnabled('p1', worlds)).toBe(true);
  });

  it('на занятом мире заперта', () => {
    expect(startEnabled('p2', worlds)).toBe(false);
  });

  it('на мире, которого нет в раскладе, заперта', () => {
    expect(startEnabled('p9', worlds)).toBe(false);
  });

  // Дом намеренно не участвует: не выбрал — играешь домом своего места.
  it('дом на кнопку не влияет — он необязателен', () => {
    expect(startEnabled('p1', worlds)).toBe(true);
  });
});

describe('reconcileSelection (правило 5)', () => {
  const free: StartWorld[] = entryOffer(SEATS).worlds;

  it('ничего не выбирали — сообщать не о чем', () => {
    expect(reconcileSelection(null, free)).toEqual({ kind: 'none' });
  });

  it('мир свободен — выбор держим', () => {
    expect(reconcileSelection('p1', free)).toEqual({ kind: 'kept', slot: 'p1' });
  });

  it('мир заняли, пока думали — выбор сброшен, и это ОТЛИЧИМО от «не выбирал»', () => {
    const fate = reconcileSelection('p2', free);
    expect(fate).toEqual({ kind: 'lost' });
    expect(fate).not.toEqual(reconcileSelection(null, free));
  });

  it('мир исчез из расклада — тоже потеря, а не тихое «ничего»', () => {
    expect(reconcileSelection('p1', [])).toEqual({ kind: 'lost' });
  });

  // Правило 5 главное: выбор НЕ переезжает на соседний свободный мир.
  it('не подставляет соседний свободный мир вместо занятого', () => {
    const fate = reconcileSelection('p2', free);
    expect(fate.kind).toBe('lost');
    expect(fate).not.toHaveProperty('slot');
  });
});
