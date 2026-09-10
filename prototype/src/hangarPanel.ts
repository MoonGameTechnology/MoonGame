/**
 * АНГАР ГЛАЗАМИ ИГРОКА (SHU-3.1) — что показывает и что предлагает панель про челноки.
 *
 * До этого модуля челноков в интерфейсе не было ВООБЩЕ. Вкладка «Крылья» панели мира
 * показывала `planet.garrison`, отфильтрованный по трейту `shuttle`, — а челнок с
 * SHU-1.1 в гарнизоне не бывает никогда, он лежит в `planet.hangar`. То есть вкладка
 * была гарантированно пустой, и построенные машины исчезали для игрока: он платил за
 * них, а увидеть и применить не мог.
 *
 * Правила, которые здесь закреплены:
 *
 * 1. **Ангар показывается, пока есть ВМЕСТИМОСТЬ, даже пустой.** «0 из 6» говорит «сюда
 *    можно строить»; отсутствие блока читалось бы как «здесь такого не бывает». А вот
 *    места БЕЗ вместимости (нет порта, корабль без ангара) блока не получают вовсе:
 *    «0 из 0» — это не факт о мире, а строка ни о чём.
 * 2. **Топливо принадлежит МЕСТУ, а не машине** (SHU-1.2): у порта один счётчик на все
 *    вылеты, поэтому и в панели он один — над составом, а не в каждой строке.
 * 3. **«Готов» — это И топливо, И конец перезарядки, И живые машины.** Три причины
 *    «нельзя лететь» показываются РАЗНЫМИ словами: пустой ангар, перезарядка, нет
 *    топлива. Одна общая заглушка заставляла бы игрока гадать, чего ждать.
 * 4. **Перегрузка порт ⇄ носитель предлагается только когда она ПРОЙДЁТ.** Носитель
 *    должен стоять у этого мира, быть свой и иметь свободное место; иначе кнопки нет —
 *    не серой, а нет. Серая кнопка обещала бы действие, которого в этом месте не
 *    бывает (то же правило, что у командного ряда, `cmdPresence.ts`).
 */
import type { GameData, Fleet, Planet, Squadron, UnitStack } from '../../packages/shared-core/src/index';
import {
  canSortie,
  fleetShuttleBay,
  hangarMachines,
  hangarUsed,
  shuttleBayAt,
  sortieSpec,
  type SortieState,
} from '../../packages/shared-core/src/index';

/** Почему вылет невозможен прямо сейчас — или `null`, если возможен (правило 3). */
export type HangarBlock = 'empty' | 'rearming' | 'no-fuel' | null;

/** Ангар одного места — порта мира или трюма носителя. Форма одна: у ангара везде
 *  один и тот же смысл, и вторая структура развела бы две панели по мелочам. */
export interface HangarView {
  /** ЭСКАДРЫ места (SHU-4.2) — то, чем адресуются приказы: вылет, перегрузка, делёж.
   *  Панель со списком соединений придёт в SHU-4.3; пока отсюда берётся id. */
  squadrons: Squadron[];
  /** Машины места одним списком — состав, без деления на соединения. */
  stacks: UnitStack[];
  used: number;
  bay: number;
  free: number;
  /** Топливо места (правило 2). `undefined` — счётчика нет (пустой носитель). */
  sortie?: { fuel: number; maxFuel: number; rearming: number };
  /** Почему нельзя поднять вылет; `null` — можно. */
  blocked: HangarBlock;
}

/** Есть ли у места ангар вообще (правило 1): вместимость больше нуля. */
export function hasHangar(view: HangarView | null): view is HangarView {
  return view !== null && view.bay > 0;
}

function view(
  host: { hangar?: Squadron[] },
  bay: number,
  sortie: SortieState | undefined,
  maxFuel: number,
): HangarView | null {
  if (bay <= 0) return null;
  const squadrons = (host.hangar ?? []).filter((sq) => sq.units.some((st) => st.count > 0));
  const stacks = hangarMachines(host).filter((st) => st.count > 0);
  const used = hangarUsed(host);
  const live: SortieState = sortie ?? { fuel: maxFuel, rearming: 0 };
  const blocked: HangarBlock =
    used <= 0 ? 'empty' : live.rearming > 0 ? 'rearming' : canSortie(live) ? null : 'no-fuel';
  return {
    squadrons,
    stacks,
    used,
    bay,
    free: Math.max(0, bay - used),
    ...(maxFuel > 0 ? { sortie: { fuel: live.fuel, maxFuel, rearming: live.rearming } } : {}),
    blocked,
  };
}

/** Ангар КОСМОПОРТА мира. `null` — порта нет, блока в панели быть не должно. */
export function planetHangar(planet: Planet, data: GameData): HangarView | null {
  const bay = shuttleBayAt(planet, data);
  // Ёмкость топлива задаёт САМА МАШИНА (`fuel` первой в ангаре) — та же величина, по
  // которой ядро заводит счётчик порта. Пустой порт показывает состав без топлива:
  // выводить «0 из 0 вылетов» там, где лететь некому, значит пугать числом ни о чём.
  const first = hangarMachines(planet).find((st) => st.count > 0);
  const maxFuel = first ? (data.units[first.unit]?.stats.fuel ?? 0) : 0;
  return view(planet, bay, planet.sortie, maxFuel);
}

/** Трюм НОСИТЕЛЯ («Шаттл», SHU-2.1). `null` — корабль ангара не несёт. */
export function fleetHangar(fleet: Fleet, data: GameData): HangarView | null {
  return view(fleet, fleetShuttleBay(fleet, data), fleet.sortie, sortieSpec(fleet, data).maxFuel);
}

/** Что можно перегрузить между портом мира и стоящим у него носителем (правило 4). */
export interface TransferOffer {
  /** Поднять машины с мира на носитель (`shuttle.load`). */
  load: boolean;
  /** Ссадить машины с носителя на мир (`shuttle.unload`). */
  unload: boolean;
}

export function transferOffer(
  port: HangarView | null,
  hold: HangarView | null,
  opts: { docked: boolean; mine: boolean },
): TransferOffer {
  if (!opts.docked || !opts.mine || !hasHangar(port) || !hasHangar(hold)) {
    return { load: false, unload: false };
  }
  return { load: port.used > 0 && hold.free > 0, unload: hold.used > 0 && port.free > 0 };
}

/**
 * КАКУЮ ЭСКАДРУ перегружать одной кнопкой (SHU-3.1, форма — SHU-4.2). Кнопка у игрока
 * одна, а соединений в ангаре может быть несколько — выбор обязан быть
 * ДЕТЕРМИНИРОВАННЫМ и объяснимым: берётся ПЕРВАЯ живая эскадра источника, и только если
 * она влезает в приёмник ЦЕЛИКОМ (ядро возит соединение целиком, половину оно отобьёт
 * кодом `E_NO_CAPACITY`). Первая, а не «лучшая»: какое звено нужнее — решение игрока, и
 * когда для него появится выбор, он появится списком, а не догадкой кнопки.
 *
 * `null` — перегружать нечего: кнопку в этом состоянии не показывают вовсе.
 */
export function transferPick(
  from: HangarView | null,
  to: HangarView | null,
): { squadronId: string; count: number } | null {
  if (!hasHangar(from) || !hasHangar(to)) return null;
  const sq = from.squadrons[0];
  if (!sq) return null;
  const count = sq.units.reduce((n, st) => n + st.count, 0);
  return count > 0 && count <= to.free ? { squadronId: sq.id, count } : null;
}
