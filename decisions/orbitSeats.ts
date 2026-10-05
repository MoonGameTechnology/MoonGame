/**
 * Места флотов у мира — кто стоит на орбитальном кольце и кто в строю боя — одним
 * проходом по флотам мира.
 *
 * Стоящий флот занимает слот веера на кольце своего мира (`orbitRing.ts`, правило 5): ему
 * нужны свой номер среди соседей по кольцу и их число. Флот в бою стоит в строю своей
 * стороны (`battleStance.ts`), а строй раскладывается по всем флотам этого боя у этого
 * мира. Раньше кадр выяснял и то и другое для КАЖДОГО флота заново, перебирая ВСЕ флоты
 * мира, — квадрат от числа флотов на каждый кадр и на любом зуме. На 1675 провинциях и 124
 * флотах начала партии это 1,5 мс кадра телефона, и каждый построенный флот добавляет
 * свою долю к каждому следующему.
 *
 * Правила — те же, что стояли в кадре: иначе флоты пересели бы.
 *
 * 1. **Кольцо мира** — флоты с этим `location`, без движения, не в бою и не крепости
 *    (крепость слота не занимает, `emplacement.ts`, правило 3), в порядке флотов мира.
 * 2. **Номер в веере** — место флота на кольце мира, о котором спросили. Флот, которого на
 *    этом кольце нет, садится на первое место: так кадр поступал и раньше.
 * 3. **Строй боя** — флоты с этим `battleId` у этого же мира, без движения и не крепости,
 *    в порядке флотов мира. Тот же бой у другого мира — другой строй.
 *
 * Раскладка зависит только от флотов мира, поэтому кадр считает её раз на мир и держит в
 * памяти мира, как доход и круги обзора. Сама функция не знает ни про кадр, ни про камеру.
 */

/** Что раскладке нужно знать о флоте. */
export interface SeatFleet {
  readonly id: string;
  readonly location?: string | null;
  readonly movement?: unknown;
  readonly battleId?: string | null;
}

/** Слот на кольце: номер в веере и сколько флотов на кольце. */
export interface RingSeat {
  readonly idx: number;
  readonly peers: number;
}

export interface OrbitSeats<F extends SeatFleet> {
  /** Слот флота `id` на кольце мира `location` (правила 1–2). */
  ring(id: string, location: string): RingSeat;
  /** Флоты боя `battleId` у мира `location` в порядке флотов мира (правило 3). */
  fight(battleId: string, location: string): readonly F[];
}

const NONE: readonly never[] = [];

/**
 * Разложить флоты мира по кольцам и строям. `fixed` отмечает флоты, которые места не
 * занимают нигде (крепость, правило 1). Порядок `fleets` — порядок мира.
 */
export function orbitSeats<F extends SeatFleet>(fleets: readonly F[], fixed: (f: F) => boolean): OrbitSeats<F> {
  const rings = new Map<string, number>();
  const seats = new Map<string, { location: string; idx: number }>();
  const fights = new Map<string, Map<string, F[]>>();
  for (const f of fleets) {
    const location = f.location;
    if (f.movement || !location || fixed(f)) continue;
    if (f.battleId) {
      let at = fights.get(f.battleId);
      if (!at) fights.set(f.battleId, (at = new Map()));
      const side = at.get(location);
      if (side) side.push(f);
      else at.set(location, [f]);
      continue;
    }
    const idx = rings.get(location) ?? 0;
    rings.set(location, idx + 1);
    seats.set(f.id, { location, idx });
  }
  return {
    ring(id, location) {
      const seat = seats.get(id);
      return { idx: seat && seat.location === location ? seat.idx : 0, peers: rings.get(location) ?? 0 };
    },
    fight: (battleId, location) => fights.get(battleId)?.get(location) ?? NONE,
  };
}
