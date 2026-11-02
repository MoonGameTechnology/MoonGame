/**
 * КРЕПОСТЬ НА КАРТУ НЕ КЛАДУТ — ЕЁ СТРОИТ ИГРОК (`docs/fortress-roadmap.md` §0.6–0.7).
 *
 * Концепция карт числила `void_station` универсальной провинцией «станция», и генераторы
 * расставили такие узлы со старта партии. Но для игрока этот вид — космическая крепость, и
 * на карте появилась «Крепость пустоты», которая крепостью не была (жалоба владельца
 * 2026-11-02: «как будто это ошибка трактования»). У неё не было:
 *   • ядра (`starfort`) и орудий — её брал простой прилёт пустого флота, хотя крепость
 *     обязана драться с прилетевшим флотом, как юнит (решение 9);
 *   • лимита слотов — ставились все постройки ростера, а у настоящей крепости по слоту на
 *     уровень (решение 10);
 *   • пути к настоящей крепости — `station.deploy` отвечал «здесь уже крепость»
 *     (`stationable: false`), а обстреливать её было нельзя (решение 16), хотя
 *     отстреливаться ей нечем.
 * Причина в том, что орудия выдаёт событие конверсии, а загрузка карты его не шлёт
 * (`sector-zero-roadmap.md`, «крепость, посеянная картой, стоит без орудий»). Поэтому
 * крепость появляется на карте ровно одним путём — по воле игрока.
 *
 * Карты кампании и обучения свои станции сохраняют: это сюжетные узлы (станция учёного,
 * архив, карантинные доки, вражеский пост обучения), и владелец решил кампанию не трогать
 * (2026-11-02): «в мультиплеере такой провинции не должно быть». Список ниже закрыт —
 * новая карта основной игры в него не попадает.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Виды, которые появляются только постройкой игрока. */
const PLAYER_BUILT = ['void_station', 'fork_station'];
/** Сюжетные станции кампании и обучения — оставлены решением владельца (2026-11-02). */
const CAMPAIGN_STATIONS = ['pve-1.json', 'pve-4.json', 'pve-5.json', 'pve-6.json', 'training-1.json'];

const dir = new URL('./maps/', import.meta.url);
const maps = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((file) => {
    const json = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as {
      sectors: Record<string, { kind?: string }>;
    };
    return { file, kinds: Object.entries(json.sectors).map(([id, s]) => ({ id, kind: s.kind })) };
  });

/** Большие карты-«фронтиры» (50 и 100 мест) хранят вид клетки отдельным массивом. */
const frontiers = ['frontier-50.json', 'frontier-100.json'].map((file) => {
  const json = JSON.parse(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')) as {
    terrain: string[];
  };
  return { file, kinds: json.terrain.map((kind, i) => ({ id: String(i), kind })) };
});

const seeded = (kinds: { id: string; kind?: string }[]): string[] =>
  kinds.filter((s) => s.kind !== undefined && PLAYER_BUILT.includes(s.kind)).map((s) => s.id);

describe('крепость на карту не кладут', () => {
  it('ни одна карта основной игры и ни один полигон не сеют крепость', () => {
    const offenders = [...maps, ...frontiers]
      .filter((m) => !CAMPAIGN_STATIONS.includes(m.file))
      .map((m) => ({ file: m.file, nodes: seeded(m.kinds) }))
      .filter((m) => m.nodes.length > 0);
    expect(offenders).toEqual([]);
  });

  it('перечень кампании честный: в каждой карте списка станции действительно есть', () => {
    // Карта, из которой станции ушли, обязана уйти и из списка — иначе он тихо разрешит
    // вернуть их туда снова.
    for (const file of CAMPAIGN_STATIONS) {
      const map = maps.find((m) => m.file === file);
      expect(map, file).toBeDefined();
      expect(seeded(map!.kinds).length, file).toBeGreaterThan(0);
    }
  });

  it('площадку крепости на развилке не сеет никто, включая кампанию', () => {
    for (const m of [...maps, ...frontiers]) {
      expect(m.kinds.filter((s) => s.kind === 'fork_station').map((s) => s.id), m.file).toEqual([]);
    }
  });
});
