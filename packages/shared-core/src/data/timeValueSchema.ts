import { z } from 'zod';

/**
 * Матрица времени (TEC-1, `docs/time-economy-roadmap.md`): эталонный игровой час (ЭЧ) —
 * единица, через которую выражаются цены в ресурсах, Суверенах ◆ и Варрантах ⌖. Пустой
 * `referenceHour` = матрицы в этих данных нет, правила о цене часа выключены.
 */
export const TimeValueDefSchema = z
  .object({
    /** Валовая добыча эталонной державы за игровой час, по ресурсу. */
    referenceHour: z.record(z.string(), z.number()).default({}),
    /** Вес ресурса внутри часа: единица ресурса стоит `weight / referenceHour` ЭЧ. Ключи —
     *  ровно ресурсы `referenceHour`, сумма — 1, поэтому весь набор часа стоит ровно 1 ЭЧ. */
    weights: z.record(z.string(), z.number().positive()).default({}),
    /** Цена одного ЭЧ в ◆ при прямой трате. */
    sovereignsPerHour: z.number().positive().default(10),
    /** Сколько ⌖ игрок зарабатывает за ЭЧ игры. */
    warrantsPerHour: z.number().positive().default(4),
    /** Потолок ускорения K: платящий идёт не больше чем в K раз быстрее бесплатного. */
    speedupCap: z.number().min(1).default(1.5),
    /** На сколько дорожает каждый следующий ускоренный час в те же игровые сутки партии
     *  (TEC-3): 0,1 — второй час на 10% дороже первого. 0 — цена ровная. */
    escalation: z.number().min(0).default(0),
    /** Сколько последних игровых минут очереди заканчиваются бесплатно (TEC-3). 0 — нет. */
    freeFinishMinutes: z.number().min(0).default(0),
  })
  .strict()
  .refine(
    (t) => {
      const keys = Object.keys(t.referenceHour);
      const weights = Object.keys(t.weights);
      if (keys.length === 0) return weights.length === 0;
      const sum = weights.reduce((a, k) => a + t.weights[k]!, 0);
      return (
        weights.length === keys.length &&
        keys.every((k) => t.weights[k] !== undefined && (t.referenceHour[k] ?? 0) > 0) &&
        Math.abs(sum - 1) < 1e-9
      );
    },
    { message: 'timeValue: weights must name exactly the referenceHour resources and sum to 1' },
  );

export type TimeValueDef = z.infer<typeof TimeValueDefSchema>;
