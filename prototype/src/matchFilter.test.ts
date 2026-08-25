import { describe, it, expect } from 'vitest';
import {
  mapsOf,
  matchesFilter,
  playerBounds,
  type FilterRow,
  type FilterState,
} from './matchFilter';

const row = (over: Partial<FilterRow> = {}): FilterRow => ({
  mapId: 'nexus',
  players: { seated: 1, capacity: 4 },
  ...over,
});

const filter = (over: Partial<FilterState> = {}): FilterState => ({
  mode: 'all',
  maps: new Set<string>(),
  players: { min: 0, max: 99 },
  ...over,
});

describe('фильтр браузера — карты', () => {
  it('ПУСТОЙ НАБОР КАРТ — «все», а не «ни одной»', () => {
    // Свежий заход открывает панель с невыбранными галочками. Прочитать это как
    // «ни одна карта не подходит» значит показать игроку пустоту вместо ленты.
    expect(matchesFilter(row({ mapId: 'nexus' }), filter({ maps: new Set() }))).toBe(true);
  });

  it('выбранные карты сужают ленту', () => {
    const f = filter({ maps: new Set(['rift']) });
    expect(matchesFilter(row({ mapId: 'rift' }), f)).toBe(true);
    expect(matchesFilter(row({ mapId: 'nexus' }), f)).toBe(false);
  });

  it('список карт берётся ИЗ ЛЕНТЫ: без повторов и в стабильном порядке', () => {
    // Каталога карт в read-model нет, и заводить его ради фильтра не нужно.
    expect(mapsOf([row({ mapId: 'rift' }), row({ mapId: 'nexus' }), row({ mapId: 'rift' })])).toEqual(
      ['nexus', 'rift'],
    );
    expect(mapsOf([])).toEqual([]);
  });
});

describe('фильтр браузера — режим', () => {
  it('«Все» пропускает и известный режим, и неизвестный', () => {
    const f = filter({ mode: 'all' });
    expect(matchesFilter(row({ kind: 'pve' }), f)).toBe(true);
    expect(matchesFilter(row(), f)).toBe(true);
  });

  it('PVP и PVE различают строки с известным видом', () => {
    expect(matchesFilter(row({ kind: 'pve' }), filter({ mode: 'pve' }))).toBe(true);
    expect(matchesFilter(row({ kind: 'pvp' }), filter({ mode: 'pve' }))).toBe(false);
    expect(matchesFilter(row({ kind: 'pvp' }), filter({ mode: 'pvp' }))).toBe(true);
  });

  it('НЕИЗВЕСТНЫЙ РЕЖИМ НЕ ОТСЕИВАЕТСЯ НИКАКИМ ФИЛЬТРОМ — это «не знаю», а не «не подходит»', () => {
    // Правило сервера (BRW-1, `matchKind()`): пустой `kind` значит «режим неизвестен»,
    // и клиент обязан читать это fail-open, как и `entryOpen`. Отсеивать такие строки
    // значит прятать живые матчи — а сегодня ТАКИЕ ВСЕ, потому что прото-хост зовёт
    // `new MatchRegistry(accountStore)` без каталога, и фильтр по режиму отдавал бы пустоту.
    for (const mode of ['pvp', 'pve'] as const) {
      expect(matchesFilter(row(), filter({ mode })), mode).toBe(true);
    }
  });
});

describe('фильтр браузера — число игроков', () => {
  it('СЧИТАЕТ ВМЕСТИМОСТЬ, А НЕ ЗАНЯТЫЕ КРЕСЛА: «сколько игроков» — это размер стола', () => {
    const r = row({ players: { seated: 1, capacity: 8 } });
    expect(matchesFilter(r, filter({ players: { min: 6, max: 8 } }))).toBe(true);
    expect(matchesFilter(r, filter({ players: { min: 1, max: 2 } }))).toBe(false);
  });

  it('границы включительные', () => {
    const r = row({ players: { seated: 0, capacity: 4 } });
    expect(matchesFilter(r, filter({ players: { min: 4, max: 4 } }))).toBe(true);
  });

  it('ПЕРЕВЁРНУТЫЙ ПОЛЗУНОК (min > max) НЕ РОНЯЕТ И НЕ ОТДАЁТ ПУСТОТУ — концы меняются местами', () => {
    const r = row({ players: { seated: 0, capacity: 4 } });
    expect(matchesFilter(r, filter({ players: { min: 8, max: 2 } }))).toBe(true);
    expect(matchesFilter(r, filter({ players: { min: 2, max: 8 } }))).toBe(true);
  });

  it('границы ползунка берутся из вместимостей ленты', () => {
    const rows = [
      row({ players: { seated: 0, capacity: 2 } }),
      row({ players: { seated: 5, capacity: 8 } }),
      row({ players: { seated: 1, capacity: 4 } }),
    ];
    expect(playerBounds(rows)).toEqual({ min: 2, max: 8 });
  });

  it('ПУСТАЯ ЛЕНТА НЕ ДАЁТ БЕСКОНЕЧНОСТЕЙ: границы схлопнуты в ноль', () => {
    // `Math.min()` без аргументов вернул бы Infinity, и ползунок уехал бы в бесконечность.
    expect(playerBounds([])).toEqual({ min: 0, max: 0 });
  });
});
