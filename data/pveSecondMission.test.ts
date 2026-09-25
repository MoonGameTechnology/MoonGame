/**
 * ВТОРАЯ ГЛАВА СЕКТОРА ЗЕРО — карта «Кладбище экспедиции» и дверь к ней.
 *
 * Замысел владельца (2026-09-22) взамен прежнего концепта: карта почти целиком занята
 * Роем, игрок её ОТВОЁВЫВАЕТ. Прежняя редакция строилась на перехвате снабжения — в игре
 * снабжения нет ни у кого (разбор в `docs/sector-zero-map-concepts.md` §4).
 *
 * Отдельное указание про географию: «побольше провинций, перекрёстков и двойных путей,
 * чем большие провинции с длинными путями». Это здесь ПРОВЕРЯЕТСЯ числами, а не
 * подразумевается: соседство выводится из мозаики (`M4.3`), то есть форма карты —
 * следствие координат и местности, и она может молча поехать от любой правки данных.
 *
 * И дверь: до этой главы `pveState` статически открывала ровно `pve-1`. Карта без двери —
 * это контент, который не увидит никто; в этом проекте так уже выходило трижды.
 */
import { describe, expect, it } from 'vitest';
import {
  matchMapEdges,
  parseMatchMap,
  validateMatchMap,
  type MatchMap,
} from '../packages/shared-core/src/index';
import { pveState, pveModeId, pveObjectives, PVE_MISSION_COUNT } from '../packages/client/src/gameData';
import { DEFAULT_OBJECTIVE_SLOTS, objectiveNominal, objectiveProgress } from '../decisions/missionObjectives';
import { shippedGameData } from './bundle';
import mapJson from './maps/pve-2.json';

const data = shippedGameData();
const map: MatchMap = parseMatchMap(mapJson);

/** Сколько проходов у каждой провинции ПОСЛЕ того, как местность срезала лишнее. */
function degrees(): Map<string, number> {
  const deg = new Map<string, number>();
  for (const id of Object.keys(map.sectors)) deg.set(id, 0);
  for (const [a, b] of matchMapEdges(map, data).paths) {
    deg.set(a, (deg.get(a) ?? 0) + 1);
    deg.set(b, (deg.get(b) ?? 0) + 1);
  }
  return deg;
}

describe('карта второй главы — «Кладбище экспедиции»', () => {
  it('проходит валидатор на ШИПНУТОМ каталоге', () => {
    expect(validateMatchMap(map, data)).toEqual([]);
  });

  it('соседство ВЫВОДИТСЯ из мозаики, а не пишется руками', () => {
    // Рычаг автора — координаты, `size` и местность. Списка `paths` у карты нет: два
    // независимых источника правды — ровно то, из-за чего на шипнутых картах двадцать
    // границ обещали переход, которого нет (M4.3).
    expect(matchMapEdges(map, data).derived).toBe(true);
    expect((mapJson as { paths?: unknown }).paths).toBeUndefined();
  });

  it('ТУПИК ДОПУСТИМ, но обязан быть обоснован местностью', () => {
    // Поправка владельца: «тупики можно, если они обоснованы областью и местностью».
    // Правило поэтому не «тупиков нет», а «тупик — следствие бюджета местности, а не
    // случайность координат». Скопление астероидов богато и по своей природе несёт один
    // подход; узел с одним проходом на просторной местности — это уже недосмотр автора.
    const budgets = data.sectors;
    for (const [id, n] of degrees()) {
      if (n >= 2) continue;
      const terrain = map.sectors[id]!.terrain;
      const max = terrain ? (budgets[terrain]?.maxLinks ?? Infinity) : Infinity;
      expect([id, max], `${id}: тупик без объяснения в местности`).toEqual([id, n]);
    }
  });

  it('СЕТКА, А НЕ КОРИДОР: большинство провинций имеют три подхода и больше', () => {
    const deg = [...degrees().values()];
    const wide = deg.filter((n) => n >= 3).length;
    expect(wide).toBeGreaterThan(deg.length / 2);
    // И настоящие перекрёстки: узлы, где сходятся пять направлений.
    expect(deg.filter((n) => n >= 5).length).toBeGreaterThanOrEqual(4);
  });

  it('ПЕРЕЛЁТЫ КОРОТКИЕ: шаг решётки заметно меньше, чем у первой главы', () => {
    // «Большие провинции с длинными путями» — это то, чего просили избежать. Меряем
    // среднюю длину прохода, а не число рёбер: коридор длинный именно во времени.
    const pos = (id: string): { x: number; y: number } => map.sectors[id]!.position;
    const lengths = matchMapEdges(map, data).paths.map(([a, b]) =>
      Math.hypot(pos(a).x - pos(b).x, pos(a).y - pos(b).y),
    );
    const avg = lengths.reduce((s, n) => s + n, 0) / lengths.length;
    expect(avg).toBeLessThan(300);
  });

  it('ДВОЙНОЙ ПУТЬ: две трассы пересекаются и НЕ соединяются', () => {
    // Без `transit` всякая провинция — полная развязка, и «двойной путь» вырождается в
    // «сворачивай куда хочешь» (M2.5).
    const crossing = Object.entries(map.sectors).filter(([, s]) => (s.transit ?? []).length >= 2);
    expect(crossing.length).toBeGreaterThanOrEqual(1);
    const [id, sec] = crossing[0]!;
    const neighbours = new Set(
      matchMapEdges(map, data)
        .paths.filter(([a, b]) => a === id || b === id)
        .map(([a, b]) => (a === id ? b : a)),
    );
    for (const [x, y] of sec.transit ?? []) {
      expect(neighbours.has(x), `${id}: ${x} не сосед`).toBe(true);
      expect(neighbours.has(y), `${id}: ${y} не сосед`).toBe(true);
    }
  });

  it('РОЙ ДЕРЖИТ КАРТУ, игроку остаётся плацдарм', () => {
    const owners = Object.values(map.sectors)
      .map((s) => s.owner)
      .filter((o): o is string => typeof o === 'string');
    const mine = owners.filter((o) => o === 'p1').length;
    const swarm = owners.filter((o) => o === 'swarm').length;
    expect(swarm).toBeGreaterThan(mine * 2);
    // Плацдарм обязан быть настоящим: с верфью, иначе отвоёвывать нечем.
    const home = Object.values(map.sectors).find((s) => s.owner === 'p1' && s.kind === 'planet');
    expect(home?.buildings.some((b) => b.type === 'shipyard')).toBe(true);
  });

  it('РАЗНЫЕ ЦЕЛИ: есть и гарнизонные узлы, и пустые', () => {
    // Гарнизонный берётся десантом с орбиты, пустой — прилётом. Будь все одинаковыми,
    // «отвоевать» свелось бы к одному приёму, повторённому двадцать раз.
    const swarmSectors = Object.values(map.sectors).filter((s) => s.owner === 'swarm');
    expect(swarmSectors.some((s) => s.garrison.length > 0)).toBe(true);
    expect(swarmSectors.some((s) => s.garrison.length === 0)).toBe(true);
  });
});

describe('дополнительные задачи карты (PVR-5.2)', () => {
  const objectives = map.objectives;

  it('запас СЕМЬ, и все с разными глаголами (PVR-5.3: запас растёт с номером главы)', () => {
    // Задачи одного рода слились бы в одну: смысл «дополнительных миссий» в том, что они
    // требуют РАЗНОГО, а не одного и того же много раз. Эвакуация и спасение — задачи
    // владельца 2026-09-24.
    expect(objectives).toHaveLength(7);
    expect([...new Set(objectives.map((o) => o.kind))].sort()).toEqual([
      'build',
      'control',
      'evac',
      'raze',
      'rescue',
      'scout',
      'wave',
    ]);
  });

  it('цели задач СУЩЕСТВУЮТ — опечатка в id не должна означать «выполнено»', () => {
    for (const o of objectives.filter((x) => x.kind === 'control'))
      for (const id of o.targets)
        expect([o.id, id, id in map.sectors], `${o.id}: нет провинции ${id}`).toEqual([o.id, id, true]);
    for (const o of objectives.filter((x) => x.kind === 'raze'))
      for (const b of o.targets)
        expect([o.id, b, b in data.buildings], `${o.id}: нет здания ${b}`).toEqual([o.id, b, true]);
  });

  it('цель «держать» ЗАХВАТЫВАЕМА — иначе это задача, которую нельзя выполнить', () => {
    // Самая частая беда этого проекта: правило объявлено, а выполнить его нечем. На карте
    // полно провинций вида `empty` (перекрёстки решётки) — они не присваиваются вообще,
    // и задача «держи перекрёсток» висела бы вечно невыполненной.
    for (const o of objectives.filter((x) => x.kind === 'control'))
      for (const id of o.targets) {
        const kind = data.sectorKinds[map.sectors[id]!.kind];
        expect([o.id, id, kind?.capturable], `${o.id}: ${id} нельзя присвоить`).toEqual([
          o.id,
          id,
          true,
        ]);
      }
  });

  it('сбор материалов начинается НЕВЫПОЛНЕННЫМ и идёт по полям обломков', () => {
    const salvage = objectives.find((o) => o.kind === 'control')!;
    for (const id of salvage.targets) {
      const sec = map.sectors[id]!;
      expect([id, sec.terrain]).toEqual([id, 'derelict_graveyard']);
      expect([id, sec.owner], 'поле уже у игрока — задача выполнена на старте').not.toEqual([id, 'p1']);
    }
    expect(objectiveProgress(salvage, pveState(data, 1), 'p1').complete).toBe(false);
  });

  it('снос производства требует того, что на карте РЕАЛЬНО стоит', () => {
    const raze = objectives.find((o) => o.kind === 'raze')!;
    const standing = Object.values(map.sectors).filter((s) =>
      (s.buildings ?? []).some((b) => raze.targets.includes(b.type)),
    );
    expect(standing.length, 'снести нечего — задача выполнена на старте').toBeGreaterThan(0);
    expect(objectiveProgress(raze, pveState(data, 1), 'p1').complete).toBe(false);
  });

  it('разведка требует МЕНЬШЕ, чем вся карта, но больше половины', () => {
    // Требовать всю карту значило бы обязать игрока обойти каждый угол; требовать
    // треть — выдать награду за то, что случится само.
    const recon = objectives.find((o) => o.kind === 'scout')!;
    const total = Object.keys(map.sectors).length;
    expect(recon.count!).toBeGreaterThan(total / 2);
    expect(recon.count!).toBeLessThan(total);
  });

  it('у каждой задачи есть награда, и она не перевешивает сам забег', () => {
    // Выплата за забег — `1 + номер волны + 3 за победу`, то есть до 14 на десяти волнах.
    // Надбавки должны быть заметными, но не превращать задачи в основной источник.
    // Сравнивается МАКСИМУМ ОДНОГО забега, а не весь запас: запас больше, чем видно за
    // заход (не больше потолка задач), и номинал видимых урезается (`objectiveNominal`).
    for (const o of objectives) expect([o.id, o.reward > 0]).toEqual([o.id, true]);
    const cap = DEFAULT_OBJECTIVE_SLOTS.cap;
    const shown = Math.min(cap, objectives.length);
    const best = objectives
      .map((o) => objectiveNominal(o.reward, shown))
      .sort((a, b) => b - a)
      .slice(0, shown)
      .reduce((n, r) => n + r, 0);
    expect(best).toBeLessThan(14);
  });

  it('запас первой главы — семь, второй — семь (PVR-5.3, PVR-2.5)', () => {
    // Четвёртая задача первой главы — «уничтожить улей» (решение владельца 2026-09-24):
    // зачистка перестала быть условием победы и стала задачей с наградой. Крепость и маяк
    // в первой, эвакуация и спасение во второй — задачи владельца 2026-09-24; седьмая
    // задача первой — «уничтожить пиратское логово» (заказ владельца 2026-09-25). Запас
    // сравнялся со второй главой, и это резолюция владельца: правило PVR-5.3 с тех пор
    // «запас не убывает с номером главы» — 7 → 7.
    expect(pveObjectives(0)).toHaveLength(7);
    expect(pveObjectives(1)).toHaveLength(7);
  });
});

describe('дверь второй главы', () => {
  it('вторая глава есть, и она открывает ДРУГУЮ карту, чем первая', () => {
    expect(PVE_MISSION_COUNT).toBeGreaterThanOrEqual(2);
    const first = pveState(data, 0);
    const second = pveState(data, 1);
    expect(Object.keys(second.planets).length).toBeGreaterThan(
      Object.keys(first.planets).length,
    );
    expect(Object.keys(second.planets).sort()).not.toEqual(Object.keys(first.planets).sort());
  });

  it('по умолчанию открывается ПЕРВАЯ глава — старые вызовы не изменились', () => {
    expect(Object.keys(pveState(data).planets).sort()).toEqual(
      Object.keys(pveState(data, 0).planets).sort(),
    );
    expect(pveModeId()).toBe(pveModeId(0));
  });

  it('мусорный номер главы открывает первую, а не роняет вход', () => {
    // Испорченное хранилище и старая ссылка не должны стоить игроку входа в игру.
    for (const bad of [-5, 99, Number.NaN]) {
      expect(Object.keys(pveState(data, bad).planets).sort()).toEqual(
        Object.keys(pveState(data, 0).planets).sort(),
      );
    }
  });

  it('вторая глава объявляет тот же режим забега — волны идут и там', () => {
    expect(pveModeId(1)).toBe(pveModeId(0));
    expect(pveModeId(1)).toBeTruthy();
  });
});
