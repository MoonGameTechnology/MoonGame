/**
 * RANGE-UX — что за круги и линии рисуются вокруг выделенных флотов и миров: радиус
 * артиллерии, радиус эскадрильи, зубы ПВО и линия «по кому сейчас ведётся огонь».
 *
 * Чистая функция, а не рисование по месту, по трём причинам сразу:
 *  · РАДИУСЫ БЕРУТСЯ ИЗ ЯДРА. `artilleryRange` и `squadronStrikeRange` — те самые
 *    функции, по которым ядро СТРЕЛЯЕТ. Своя копия формулы в клиенте разъехалась бы на
 *    первой правке (у артиллерии дальность идёт через `effectiveStats`, то есть модули
 *    корабля её меняют), и игрок целился бы по одному кругу, а огонь шёл по другому.
 *  · ОДНО ОПИСАНИЕ НА ВСЕ ТРИ ВИДА. Раньше каждый радиус рисовался бы своим блоком в
 *    `main.ts`; здесь это один список `RangeRing`, и добавить четвёртый вид — строка.
 *  · ЭТО ТЕСТИРУЕМО. `main.ts` — DOM-вход без юнит-харнеса, а разметка кругов —
 *    обычная арифметика над состоянием; вынесенная, она накрывается гейтом.
 *
 * Про ПВО отдельно. У него НЕТ радиуса: `orbital.ts` бьёт по флотам, стоящим НА этом
 * узле (`f.location === planetId`). Рисовать ему круг было бы враньём, поэтому ПВО
 * обозначается кольцом на самом мире — «у этого мира есть зубы», — а не областью.
 */
import {
  artilleryRange,
  squadronStrikeRange,
  type Fleet,
  type GameData,
  type GameState,
} from '../../packages/shared-core/src/index';

/** Вид оружия — он же ключ цвета. Цвета живут в `main.ts` рядом с остальной палитрой;
 *  здесь только вид, чтобы модуль не знал про канву. */
export type RangeKind = 'artillery' | 'squadron' | 'aa';

/** Круг досягаемости вокруг точки. `radius` в МИРОВЫХ единицах (масштаб накладывает
 *  рисующий), `radius === 0` для `aa` — у ПВО нет области, только отметка на узле. */
export interface RangeRing {
  kind: RangeKind;
  /** Мировые координаты центра. */
  x: number;
  y: number;
  radius: number;
  /** Кто это — для подписи/отладки: id флота или id мира. */
  sourceId: string;
}

/** Линия «этот стреляет по этому» — активный фокус артиллерии. */
export interface FireLine {
  kind: 'artillery';
  from: { x: number; y: number };
  to: { x: number; y: number };
  shooterId: string;
  targetId: string;
}

export interface RangeOverlay {
  rings: RangeRing[];
  lines: FireLine[];
}

/** Где сейчас объект на карте — передаётся снаружи, потому что положение флота в пути
 *  интерполируется рисующим (`fleetPos`), и второй копии этой математики тут не нужно. */
export type Locate = (id: string) => { x: number; y: number } | null;

/**
 * Разметка оверлея для ВЫДЕЛЕННЫХ флотов плюс отметки ПВО на видимых мирах.
 *
 * `visible` — фог-гейт: чужие зубы ПВО показываются только там, где мир опознан, иначе
 * оверлей стал бы разведкой (та же ошибка, что чинил RECAP-FOG). Свои миры видны всегда.
 */
export function combatRanges(
  state: GameState,
  data: GameData,
  selectedFleetIds: readonly string[],
  me: string,
  locate: Locate,
  visible: (planetId: string) => boolean,
): RangeOverlay {
  const rings: RangeRing[] = [];
  const lines: FireLine[] = [];

  for (const id of selectedFleetIds) {
    const fleet: Fleet | undefined = state.fleets[id];
    if (!fleet) continue;
    const at = locate(id);
    if (!at) continue;

    const gun = artilleryRange(fleet, data);
    if (gun > 0) {
      rings.push({ kind: 'artillery', x: at.x, y: at.y, radius: gun, sourceId: id });
      // Фокус огня — линия к цели. Цель могла погибнуть или уйти из вида: тогда
      // круг остаётся, а линии нет (врать про несуществующую цель хуже, чем молчать).
      const target = fleet.barrageTarget ? state.fleets[fleet.barrageTarget] : undefined;
      const to = target ? locate(target.id) : null;
      if (target && to) {
        lines.push({ kind: 'artillery', from: at, to, shooterId: id, targetId: target.id });
      }
    }

    const wing = squadronStrikeRange(fleet, data);
    if (wing > 0) {
      rings.push({ kind: 'squadron', x: at.x, y: at.y, radius: wing, sourceId: id });
    }
  }

  // Зубы ПВО — на мирах, а не у флотов, и без радиуса (см. шапку файла).
  for (const planet of Object.values(state.planets)) {
    if (aaStrength(planet, data) <= 0) continue;
    if (planet.owner !== me && !visible(planet.id)) continue;
    rings.push({
      kind: 'aa',
      x: planet.position.x,
      y: planet.position.y,
      radius: 0,
      sourceId: planet.id,
    });
  }

  return { rings, lines };
}

/** Суммарная сила ПВО мира: стационарные установки зданий + точечная оборона гарнизона
 *  — обе шкалы, по которым бьёт `orbital.ts`. Ноль = зубов нет, отметки не будет. */
function aaStrength(planet: GameState['planets'][string], data: GameData): number {
  let total = 0;
  for (const b of planet.buildings) {
    const def = data.buildings[b.type];
    if (def) total += def.aaDamage ?? 0;
  }
  for (const st of planet.garrison) {
    const def = data.units[st.unit];
    if (def) total += (def.stats.aaDamage ?? 0) * st.count;
  }
  return total;
}
