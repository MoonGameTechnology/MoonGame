/**
 * «Ждёт решения» наверху окна «События» (UIX-4.2): какие пункты стоят над журналом и в
 * каком порядке. Журнал копит строки, а то, что требует ответа сейчас, тонуло в нём —
 * наружу выходил только значок на кнопке. Решение владельца 2026-10-19: наверх идут бои и
 * непрочитанные письма — те же поводы, что считают значки тревоги и почты.
 *
 * 1. **Бой, где я сторона, выше боя, который я лишь вижу.** В своём бою теряются свои
 *    корабли; чужой бой рядом — обстановка, а не приказ.
 * 2. **Внутри — по ближайшему раунду.** Раунд, который грянет раньше, решает раньше; бой
 *    без назначенного раунда — после всех с назначенным. Ровно — по id, чтобы строки не
 *    прыгали от кадра к кадру.
 * 3. **Письма — один пункт со счётом, после боёв.** Письмо подождёт раунда, бой — нет; а
 *    строка на каждое письмо вытеснила бы бои из окна.
 * 4. **Нечего решать — пунктов нет.** Пустой раздел с заголовком читается как «что-то
 *    ждёт», и игрок ищет то, чего нет.
 */

/** Бой, сведённый к тому, по чему строится пункт. */
export interface PendingBattle {
  id: string;
  location: string;
  /** Я сторона боя (а не только вижу его). */
  mine: boolean;
  /** Когда грянет следующий раунд (мс мира); не назначен — `undefined`. */
  nextRoundAt?: number;
}

export type PendingItem =
  | { kind: 'battle'; id: string; location: string; mine: boolean }
  | { kind: 'letters'; count: number };

/** Пункты «Ждёт решения», сверху вниз. */
export function pendingDecisions(battles: readonly PendingBattle[], unread: number): PendingItem[] {
  const round = (b: PendingBattle): number => b.nextRoundAt ?? Infinity;
  const sorted = [...battles].sort(
    (a, b) =>
      Number(b.mine) - Number(a.mine) || // правило 1
      round(a) - round(b) || // правило 2
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const items: PendingItem[] = sorted.map((b) => ({
    kind: 'battle',
    id: b.id,
    location: b.location,
    mine: b.mine,
  }));
  if (unread > 0) items.push({ kind: 'letters', count: unread }); // правило 3
  return items; // правило 4: пусто — пусто
}
