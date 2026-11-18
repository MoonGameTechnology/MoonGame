/**
 * Сторона боя глазами окна: ключ, цвет, имя, жива ли — одно место для схемы рядов
 * (`battleRows.ts`) и листа стороны (`battleScreen.ts`), чтобы эти два файла не тянули
 * друг друга по кругу. И то, что хост окна даёт ему для оформления, — {@link BattleView}.
 */
import { t } from '../../localization/runtime';
import { combatantKey } from '../../packages/shared-core/src/state/battle';
import type { ForecastSide, Hostility } from '../../decisions/battleForecast';
import type { EngageForecastCard } from '../../decisions/engageForecast';
import type { BattleModel } from '../../packages/client/src/matchHud';
import { safeHexColor, COLOR } from './sideColors';

export type Side = BattleModel['sides'][number];

/** Как хост называет и красит то, что окно показывает. Всё необязательно: без хоста окно
 *  честно рисуется нейтральным цветом, сырым id и без строк, которым нужен мир. */
export interface BattleView {
  /** The same unit tile renderer used by fleet and garrison cards. */
  tiles?: (side: Side, limit: number, color: string) => string;
  ownerName?: (owner: string | null) => string;
  /** Цвет владельца — тот же, что у его флотов и границ на карте. */
  color?: (owner: string | null) => string;
  /** Позывной флота вместо сырого id. */
  fleetName?: (fleetId: string) => string;
  /** Имя мира, за который бой. */
  placeName?: (planetId: string) => string;
  /** Порог авто-отхода флота (доля корпуса) или null — приказа нет. */
  autoRetreatAt?: (fleetId: string) => number | null;
  /** Остаток до отметки времени мира — текст отсчёта до следующего раунда. */
  timeLeft?: (at: number) => string;
  /** UIX-6.2: прогноз боя по текущему составу сторон (`decisions/battleForecast.ts`). */
  forecast?: (sides: readonly ForecastSide[]) => EngageForecastCard | null;
  /** Лик плитки стороны: портрет героя флота или главный род войск. */
  icon?: (side: Side, color: string) => string;
  /** Вражда владельцев — та же, что у ядра; без неё враждебны все разные владельцы. */
  hostile?: Hostility;
  /** Наземный ли род войск — от этого предел линии (10 кораблей или 20 наземных). */
  isGround?: (unit: string) => boolean;
  /** Осада «Поглощения» над МОИМ миром, где идёт бой (`decisions/devourSiege.ts`). */
  siege?: (planetId: string) => { archetype: string | undefined; until: number } | null;
  /** Владельцы плацдармов мира в порядке высадки — от этого, кому достанется мир. */
  landingOrder?: (planetId: string) => readonly string[];
  /** Заряд остатка залпа на своём флоте (MSB-10), пока он не сгорел. */
  charge?: (fleetId: string) => { damage: number; until: number } | null;
}

/** Нейтральный цвет: у стороны нет владельца или хост цвета не дал. */
export const NEUTRAL = '#8aa0ad';

export function sideKey(side: Side): string {
  return side.key ?? (side.ref ? combatantKey(side.ref) : `${side.kind}:${side.owner}`);
}

export function sideColor(side: Side, view: BattleView): string {
  if (side.mine) return safeHexColor(view.color?.(side.owner), COLOR.p1!);
  if (side.relation === 'ally') return COLOR.ally!;
  return safeHexColor(view.color?.(side.owner), side.relation === 'neutral' ? NEUTRAL : '#ff5a4d');
}

/** Имя владельца стороны словами игрока: модель несёт `player.name` из состояния — имя дома
 *  из данных, английское («Azure Compact»), — а перевод знает хост (UIX-5.3). */
export const ownerLabel = (side: Side, view: BattleView): string =>
  view.ownerName?.(side.owner) ?? side.ownerName;

/** Флот стороны, если сторона — флот или его десант. */
export function sideFleetId(side: Side): string | undefined {
  const ref = side.ref;
  return ref && (ref.kind === 'fleet' || ref.kind === 'landing') ? ref.fleetId : undefined;
}

/** Вид стороны своим словом: плацдарм — не «флот». */
export function sideKindLabel(side: Side): string {
  return side.kind === 'garrison'
    ? t('side.battle.side.garrison')
    : side.kind === 'landing'
      ? t('side.battle.side.landing')
      : side.kind === 'beachhead'
        ? t('battle.win.beachhead')
        : t('side.battle.side.fleet');
}

/** Имя стороны: позывной флота, иначе вид стороны. */
export function sideName(side: Side, view: BattleView): string {
  const fleetId = sideFleetId(side);
  return fleetId ? (view.fleetName?.(fleetId) ?? fleetId) : sideKindLabel(side);
}

/** Подпись плитки: у флота — позывной; у гарнизона и плацдарма чужой державы — её имя,
 *  иначе два плацдарма разных держав подписаны одним словом. */
export function sideTileName(side: Side, view: BattleView): string {
  return sideFleetId(side) || side.mine ? sideName(side, view) : ownerLabel(side, view);
}

/** Живые юниты стороны — по стекам, если они есть. */
export function sideStacks(side: Side): readonly { unit: string; count: number }[] {
  return (side.stacks ?? side.units).filter((u) => u.count > 0);
}

/** Жива ли сторона: корпус, если он известен, иначе хоть один юнит. */
export function sideAlive(side: Side): boolean {
  return side.hull ? side.hull.current > 0 : sideStacks(side).length > 0;
}
