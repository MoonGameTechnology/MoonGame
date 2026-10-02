/**
 * Отклик «+N» у плашки ресурса (UIX-4.1): какое изменение запаса всплывает числом и когда.
 *
 * Запас на плашке меняется медленно и без отклика (`docs/ui-research.md`, правка 4): игрок не
 * видит, что доход идёт, и не видит, что цена ушла. Теперь под плашкой всплывает короткое
 * «+N» или «-N» (`prototype/src/purseFloats.ts`); здесь решается, какое число и когда.
 *
 * 1. **Первое показание — точка отсчёта, а не изменение.** Вход в партию не всплывает
 *    «+12k».
 * 2. **Скачок всплывает сразу.** Трата, продажа, добыча, награда — то, что не объясняется
 *    скоростью на плашке за прошедшее время мира. Игрок только что нажал «Построить», и
 *    цена должна уйти с плашки у него на глазах.
 * 3. **Ожидаемое считается по времени мира, а не по кадрам.** На ▶▶ забега доход за один
 *    кадр перерастает единицу, и правило «больше единицы — значит скачок» приняло бы
 *    обычный доход за трату. Ниже нуля ожидаемое не опускается: пустой склад при долге
 *    ядро держит на нуле, и разница с формулой — не «+N».
 * 4. **Доход по капле копится и всплывает не чаще раза в 4 секунды,** когда набралась
 *    единица. Иначе плашка мигала бы на каждое «+0.02».
 * 5. **Всплывает целое, дробь копится дальше:** сумма всплывших чисел сходится с запасом.
 * 6. **Убыль по капле не всплывает.** Её показывает красная строка скорости, а красное
 *    число раз в несколько секунд было бы тревогой, которая не замолкает.
 * 7. **Одно число на плашку за раз.** Следующее всплывает, когда прежнее погасло
 *    ({@link PURSE_FLOAT_MS}); скачки за это время складываются в одно число. Скачок
 *    идёт раньше капли: о нажатом игрок узнаёт первым.
 */

/** Сколько живёт всплывшее число, мс экрана. Раньше следующее на той же плашке не всплывёт. */
export const PURSE_FLOAT_MS = 1000;

/** Как часто всплывает доход по капле, мс экрана (правило 4). */
export const PURSE_DRIP_MS = 4000;

const HOUR_MS = 3_600_000;

/** Память одной плашки между показаниями. */
export interface PurseTrack {
  /** Запас в прошлом показании. */
  readonly stock: number;
  /** Время мира прошлого показания, мс. */
  readonly time: number;
  /** Доход по капле, ещё не всплывший (правила 4–6). */
  readonly drip: number;
  /** Скачки, ждущие, пока погаснет прежнее число (правило 7). */
  readonly jump: number;
  /** Когда на этой плашке всплыло прежнее число, мс экрана. */
  readonly shownAt: number;
}

/** Показание плашки: запас и скорость, которую она печатает (за час мира). */
export interface PurseReading {
  readonly stock: number;
  readonly perHour: number;
}

/** Число, которое всплывает под плашкой `key`: целое и не ноль. */
export interface PurseFloat {
  readonly key: string;
  readonly delta: number;
}

/**
 * Одно показание всех плашек. `worldTime` — время мира, мс; `now` — время экрана, мс.
 * Плашка, которой нет в `readings`, сохраняет память: вернувшись, она всплывёт разницей.
 */
export function purseStep(
  memory: Readonly<Record<string, PurseTrack>>,
  readings: Readonly<Record<string, PurseReading>>,
  worldTime: number,
  now: number,
): { memory: Record<string, PurseTrack>; floats: PurseFloat[] } {
  const next: Record<string, PurseTrack> = { ...memory };
  const floats: PurseFloat[] = [];
  for (const [key, reading] of Object.entries(readings)) {
    const stock = reading.stock;
    if (!Number.isFinite(stock)) continue;
    const prev = memory[key];
    // Правило 1. Время мира назад — другая партия или загруженное сохранение: снова отсчёт.
    if (!prev || !(worldTime >= prev.time)) {
      next[key] = { stock, time: worldTime, drip: 0, jump: 0, shownAt: -Infinity };
      continue;
    }
    const perHour = Number.isFinite(reading.perHour) ? reading.perHour : 0;
    const change = stock - prev.stock;
    // Правило 3: доход за прошедшее время мира, но не ниже пустого склада.
    const expected = Math.max((perHour * (worldTime - prev.time)) / HOUR_MS, -prev.stock);
    const surprise = change - expected;
    const jumped = Math.abs(surprise) >= 1;
    let jump = prev.jump + (jumped ? surprise : 0);
    // Правило 6: убыль по капле не копится — копится только доход.
    let drip = Math.max(0, prev.drip + (jumped ? expected : change));
    let shownAt = prev.shownAt;
    const quiet = now - shownAt;
    if (quiet >= PURSE_FLOAT_MS && jump !== 0) {
      // Правила 2 и 7. Скачки, сложившиеся в ноль (трата и возврат), не всплывают.
      const n = Math.round(jump);
      if (n !== 0) {
        floats.push({ key, delta: n });
        shownAt = now;
      }
      jump = 0;
    } else if (quiet >= PURSE_DRIP_MS && drip >= 1) {
      // Правила 4 и 5.
      const n = Math.floor(drip);
      floats.push({ key, delta: n });
      drip -= n;
      shownAt = now;
    }
    next[key] = { stock, time: worldTime, drip, jump, shownAt };
  }
  return { memory: next, floats };
}
