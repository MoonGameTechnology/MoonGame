import {
  fleetHoldFree,
  fleetShuttleBay,
  shuttleBayAt,
  squadronFerryRange,
  stacksSize,
  type GameData,
  type GameState,
  type Squadron,
  type StrikeBase,
} from '../packages/shared-core/src/index';

/**
 * ПЕРЕЛЁТ ГЛАЗАМИ ИГРОКА (SHU-6.5) — куда эскадру можно перебазировать прямо сейчас.
 *
 * Ядро принимает `shuttle.relocate` (SHU-6.4) не на любую базу, и прицел перелёта
 * показывает ровно те, что оно примет: подсвечивает их на карте, ловит тап только по
 * ним, а кнопки «Перебазировать» нет вовсе, пока список пуст. Предложи интерфейс базу,
 * которую ядро отобьёт, — игрок прицелится, тапнет и получит отказ там, где ему
 * обещали посадку. Условия ниже — зеркало проверок приказа, и сторож зеркала в тесте
 * гоняет каждую базу через настоящий кернел.
 *
 * 1. **Только свои базы и не та, где эскадра стоит.** Чужой порт и чужой корабль ядро
 *    отбивает (`E_FORBIDDEN`, `E_NO_FLEET`), своя же база — пустой расход вылета
 *    (`E_BAD_PAYLOAD`).
 * 2. **База — обе формы** (уточнение владельца: «учти наши базы, в виде трюмов»): мир с
 *    портом или ангаром крепости (`shuttleBayAt` > 0, снесённое здание не считается) и
 *    корабль с трюмом (`fleetShuttleBay` > 0), в том числе идущий. Порт держит сколько
 *    угодно (SHU-5.1).
 * 3. **В корабль — только если эскадра влезет целиком.** Свободное место трюма —
 *    `fleetHoldFree`, то есть за вычетом мест, которые держат эскадры, летящие к нему
 *    или улетевшие с него, — не меньше мест эскадры (`stacksSize`, тяжёлая машина
 *    занимает два). Иначе `E_NO_CAPACITY`.
 * 4. **В дальности перелёта** от базы, где эскадра стоит: `squadronFerryRange` ядра, два
 *    радиуса удара по самой короткой руке. Граница включена, как у ядра. Иначе
 *    `E_OUT_OF_RANGE`.
 * 5. **Позиции даёт рисующий** (`pos`): идущий корабль интерполирует он, и подсветка
 *    обязана стоять там же, где шеврон. Та же функция, что у трассы (`strikeTrail.ts`).
 * 6. **Порядок — ближе раньше, при равной дистанции мир раньше корабля, дальше по id**:
 *    то же правило, что у запасной посадки ядра (`nearestBase`), поэтому список у двух
 *    клиентов один и тот же.
 * 7. **Из воздуха** (SHU-6.14, приказ ядра SHU-6.13) дальность меряется от точки, где
 *    эскадра сейчас (`aloft.at`): лететь ей оттуда. Своя база (`from`) предлагается, пока
 *    эскадра летит от неё, и не предлагается, когда она уже возвращается туда сама
 *    (`E_BAD_PAYLOAD`). Место в трюме своего корабля эскадра держит с взлёта, поэтому
 *    своё же место ей не помеха.
 */

/** Точка на карте (мировые координаты). */
export interface XY {
  x: number;
  y: number;
}

/** Одна база, на которую эскадра может перелететь. */
export interface RelocateTarget {
  /** Адрес назначения — так его и примет `shuttle.relocate`. */
  base: StrikeBase;
  /** Где база сейчас (правило 5). */
  at: XY;
  /** Расстояние от базы, где эскадра стоит, — или от эскадры в воздухе (правило 7). */
  distance: number;
}

/** Базы, на которые эскадра `squadron` с базы `from` перелетит прямо сейчас (правила 1–6).
 *  С `aloft` эскадра в воздухе, а `from` — база её вылета (правило 7). */
export function relocateTargets(
  state: GameState,
  opts: {
    me: string;
    from: StrikeBase;
    squadron: Pick<Squadron, 'units'>;
    data: GameData;
    pos: (base: StrikeBase) => XY | null;
    aloft?: { at: XY; returning: boolean };
  },
): RelocateTarget[] {
  const { me, from, squadron, data, pos, aloft } = opts;
  const range = squadronFerryRange(squadron, data);
  const origin = aloft ? aloft.at : pos(from);
  if (!(range > 0) || !origin) return [];
  const need = stacksSize(squadron.units, data);
  // Своё место в трюме корабля вылета эскадра держит сама (правило 7).
  const own = (id: string): number => (aloft && from.kind === 'fleet' && from.id === id ? need : 0);
  const home = (b: StrikeBase): boolean => b.kind === from.kind && b.id === from.id;
  const bases: StrikeBase[] = [];
  for (const id of Object.keys(state.planets).sort()) {
    const p = state.planets[id]!;
    if (p.owner === me && shuttleBayAt(p, data) > 0) bases.push({ kind: 'planet', id });
  }
  for (const id of Object.keys(state.fleets).sort()) {
    const f = state.fleets[id]!;
    if (f.owner !== me || fleetShuttleBay(f, data) <= 0) continue;
    if (fleetHoldFree(state, f, data) + own(id) >= need) bases.push({ kind: 'fleet', id });
  }
  const out: RelocateTarget[] = [];
  for (const base of bases) {
    if (home(base) && (!aloft || aloft.returning)) continue; // правила 1 и 7
    const at = pos(base);
    if (!at) continue;
    const distance = Math.hypot(at.x - origin.x, at.y - origin.y);
    if (distance <= range) out.push({ base, at, distance }); // правило 4
  }
  // Сортировка устойчива: внутри одной дистанции миры уже стоят раньше кораблей, а те и
  // другие — по id (правило 6).
  return out.sort((a, b) => a.distance - b.distance);
}
