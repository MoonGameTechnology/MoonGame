/**
 * RANGE-UX — что за круги и линии рисуются вокруг выделенных флотов и миров: радиус
 * артиллерии, радиус эскадрильи, зубы ПКО и линия «по кому сейчас ведётся огонь».
 *
 * Чистая функция, а не рисование по месту, по трём причинам сразу:
 *  · РАДИУСЫ БЕРУТСЯ ИЗ ЯДРА. `artilleryRange` и `shuttleStrikeRange` — те самые
 *    функции, по которым ядро СТРЕЛЯЕТ. Своя копия формулы в клиенте разъехалась бы на
 *    первой правке (у артиллерии дальность идёт через `effectiveStats`, то есть модули
 *    корабля её меняют), и игрок целился бы по одному кругу, а огонь шёл по другому.
 *  · ОДНО ОПИСАНИЕ НА ВСЕ ТРИ ВИДА. Раньше каждый радиус рисовался бы своим блоком в
 *    `main.ts`; здесь это один список `RangeRing`, и добавить четвёртый вид — строка.
 *  · ЭТО ТЕСТИРУЕМО. `main.ts` — DOM-вход без юнит-харнеса, а разметка кругов —
 *    обычная арифметика над состоянием; вынесенная, она накрывается гейтом.
 *
 * Про ПКО отдельно. У него НЕТ радиуса: `orbital.ts` бьёт по флотам, стоящим НА этом
 * узле (`f.location === planetId`). Рисовать ему круг было бы враньём, поэтому ПКО
 * обозначается кольцом на самом мире — «у этого мира есть зубы», — а не областью.
 *
 * ВИД КОЛЬЦА (REFM-123) — здесь же, и вот почему он сюда приехал.
 *
 * 1. **Дальность артиллерии рисовалась ДВАЖДЫ.** Кроме этого слоя её же рисовал маркер
 *    выбранного флота: тот же радиус из той же `artilleryRange`, но другим цветом
 *    (оранжевый `#ff7a3a` против янтарного `#ffb43a`), другим пунктиром и другой
 *    прозрачностью — два кольца одно поверх другого каждый кадр, и та же история с
 *    линией огня. Дом остался ОДИН — этот; прозрачность взята более заметная из двух,
 *    чтобы игрок ничего не потерял в читаемости.
 * 2. **Взведённый обстрел делает границу ЯРЧЕ.** Пока игрок целится, «дострелю или
 *    нет» — главный вопрос на экране, и граница обязана выйти на первый план; в покое
 *    она уходит в фон, иначе спорит с самой картой. Правило приехало из удалённого
 *    дубля — только там оно и жило, а в этом слое его не было вовсе.
 * 3. **ПКО заметнее радиусов.** У него нет области — это отметка на мире; утони она в
 *    фоне, «зубы» стали бы незаметны ровно там, где за них платят кораблями.
 */
import {
  artilleryRange,
  shuttleStrikeRange,
  type Fleet,
  type GameData,
  type GameState,
} from '../../packages/shared-core/src/index';

/** Вид оружия — он же ключ цвета. Цвета живут в `main.ts` рядом с остальной палитрой;
 *  здесь только вид, чтобы модуль не знал про канву. */
export type RangeKind = 'artillery' | 'shuttle' | 'aa';

/** Круг досягаемости вокруг точки. `radius` в МИРОВЫХ единицах (масштаб накладывает
 *  рисующий), `radius === 0` для `aa` — у ПКО нет области, только отметка на узле. */
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

/**
 * Может ли этот флот вести ДАЛЬНИЙ огонь — единственный вопрос, по которому интерфейс
 * решает, предлагать ли наводку, режим огня и шаг цепочки «обстрел».
 *
 * Признак — ДАЛЬНОСТЬ, а не трейт `artillery`. После ROS-2.1 трейт значит совсем другое:
 * «в ближнем бою по этому корпусу не проходит ответка». Кадр спрашивал именно про трейт,
 * и в живом каталоге это разошлось с ядром: у артиллерии `range` больше нет, ядро
 * отвечает на `fleet.barrage` / `fleet.barrageMode` отказом `E_NO_ARTILLERY`
 * (`artillery.ts`) — а кнопка всё равно предлагалась. Игрок целился флотом, которому
 * стрелять нечем, и получал отказ вместо приказа.
 *
 * Дом у правила один и тот же, что у кольца: круг рисуется по `artilleryRange > 0`, и
 * кнопка обязана спрашивать ТО ЖЕ САМОЕ. Разъедься эти два ответа — игрок целится по
 * кругу, которого нет (или наоборот, круг есть, а навести нечем).
 */
export function canBarrage(fleet: Fleet, data: GameData): boolean {
  return artilleryRange(fleet, data) > 0;
}

/** Где сейчас объект на карте — передаётся снаружи, потому что положение флота в пути
 *  интерполируется рисующим (`fleetPos`), и второй копии этой математики тут не нужно. */
export type Locate = (id: string) => { x: number; y: number } | null;

/**
 * Разметка оверлея для ВЫДЕЛЕННЫХ флотов плюс отметки ПКО на видимых мирах.
 *
 * `visible` — фог-гейт: чужие зубы ПКО показываются только там, где мир опознан, иначе
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

    const wing = shuttleStrikeRange(fleet, data);
    if (wing > 0) {
      rings.push({ kind: 'shuttle', x: at.x, y: at.y, radius: wing, sourceId: id });
    }
  }

  // Зубы ПКО — на мирах, а не у флотов, и без радиуса (см. шапку файла).
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

/** Как выглядит кольцо: цвет живёт в палитре `main.ts`, здесь — заметность (правила 1–3). */
export interface RangeLook {
  alpha: number;
  dash: readonly [number, number];
  width: number;
}

/**
 * Вид кольца по виду оружия и по тому, ВЗВЕДЁН ли сейчас обстрел (правила 1–3).
 * `aiming` относится только к артиллерии: целятся именно ею.
 */
export function ringLook(kind: RangeKind, aiming: boolean): RangeLook {
  if (kind === 'aa') return { alpha: 0.7, dash: [2, 3], width: 1.2 }; // правило 3
  if (kind === 'artillery') return { alpha: aiming ? 0.7 : 0.42, dash: [5, 7], width: 1.2 };
  return { alpha: 0.32, dash: [5, 7], width: 1.2 };
}

/** Суммарная сила ПКО мира: стационарные установки зданий + ближняя зенитка гарнизона
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
