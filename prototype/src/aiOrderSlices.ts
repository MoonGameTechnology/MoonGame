import type { Action } from '../../packages/shared-core/src/index';

/** Разрезает план бота на порции, которые хост отдаёт по одной, не склеивая кадр.
 *
 * Правило одно и оно ЗАКРЫТОЕ: два подряд идущих приказа ОДНОГО игрока, которые
 * распоряжаются ОДНОЙ И ТОЙ ЖЕ сущностью (флотом или эскадрой) РАЗНЫМИ действиями,
 * едут вместе. Всё остальное — по одному.
 *
 * Почему так, а не списком известных пар: список — это разрешение по умолчанию. Первая
 * версия склеивала ровно `fleet.retreat`+`fleet.move`, и другие зависимые
 * последовательности планировщика молча разъезжались по разным порциям:
 *   · `fleet.split` → `fleet.move` того же флота (`ai.ts:723`);
 *   · когда-то ещё `shuttle.loadTroops` → `shuttle.strike` той же эскадры — с SHU-5.2
 *     погрузки нет (челнок строится с бойцом внутри), но эскадра как адрес осталась.
 * Между порциями проходит ≥16 мс с отпущенным `driversBusy`, за которые успевают и
 * стоячие драйверы, и `advanceTo`. Разъехавшаяся пара — это флот, отделённый и никуда
 * не ушедший: редьюсер отклонит второй приказ, и бот молча не сделает задуманное.
 * Общий актор ловит все такие случаи и любой будущий, не требуя правок здесь.
 *
 * РАЗНЫЕ типы — обязательная часть правила. Зависимая пара по своей природе это
 * «подготовь, потом сделай»; два одинаковых приказа одной сущности — это повтор
 * (второй перебивает первый), склеивать его незачем, а на длинном хвосте однотипных
 * приказов склейка съела бы саму цель разнесения.
 *
 * Порядок приказов и планировщик не меняются, авторитетный редьюсер — тем более. */
export function aiOrderSlices(actions: Action[]): Action[][] {
  const slices: Action[][] = [];
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!;
    const next = actions[i + 1];
    slices.push(next && dependent(action, next) ? [action, actions[++i]!] : [action]);
  }
  return slices;
}

/** Адрес сущности, которой распоряжается приказ: флот или эскадра. Мир (`planetId`)
 *  сюда НЕ входит намеренно — он у половины приказов значит место, а не исполнителя,
 *  и склеил бы независимые стройки на одной планете в одну порцию. */
function actorOf(action: Action): string | undefined {
  const payload = action.payload as { fleetId?: unknown; squadronId?: unknown };
  if (typeof payload?.squadronId === 'string') return `squadron:${payload.squadronId}`;
  if (typeof payload?.fleetId === 'string') return `fleet:${payload.fleetId}`;
  return undefined;
}

function dependent(a: Action, b: Action): boolean {
  if (a.playerId !== b.playerId || a.type === b.type) return false;
  const actor = actorOf(a);
  return actor !== undefined && actor === actorOf(b);
}
