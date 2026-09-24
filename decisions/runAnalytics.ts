/**
 * Аналитика забега (`YAG-5.1`) — чистые решения: какое событие словаря `PLATFORM_EVENTS`
 * уходит в `PlatformAnalytics` и с какими полями. Общие для обоих клиентов.
 *
 * ⚠️ Замер не имеет права влиять на симуляцию (`metrics-roadmap.md`): здесь только чтение
 * готового состояния и профиля — ни вызова ядра, ни записи, ни счётчика внутри
 * `applyAction`/`advanceTo`. Поэтому это решения, а не модуль ядра.
 */
import {
  RARITIES,
  type GameState,
  type PlayerId,
  type Rarity,
} from '../packages/shared-core/src/index';
import type { SectorZeroProgress } from './sectorZeroProgress';

/** Поля события — плоские, как их принимает `PlatformAnalytics.emit`. */
export type EventProps = Record<string, string | number | boolean>;

const HOUR = 3_600_000;

/**
 * Исход доигранного забега: `pve_completed` — игрок среди победителей, `pve_failed` —
 * нет. Не кончился или это не забег — событий нет (`null`), иначе воронка считала бы
 * исходом живой мир.
 */
export function pveOutcomeEvent(
  state: GameState,
  me: PlayerId,
  run: { chapter: string; attempt: number },
): { event: 'pve_completed' | 'pve_failed'; props: EventProps } | null {
  if (!state.pve || state.match.status !== 'ended') return null;
  const won = state.match.winner === me || (state.match.winners ?? []).includes(me);
  return {
    event: won ? 'pve_completed' : 'pve_failed',
    props: {
      chapter: run.chapter,
      attempt: run.attempt,
      waves: state.pve.waveNumber,
      totalWaves: state.pve.totalWaves,
      hours: Math.round(state.time / HOUR),
    },
  };
}

/** Ступень редкости по порядку `RARITIES`; нет записи — базовая из каталога (−1). */
const rarityRank = (r: string | undefined): number =>
  r === undefined ? -1 : RARITIES.indexOf(r as Rarity);

/**
 * Что профиль ОТКРЫЛ за одну запись — поле `kind` события `meta_unlock`: пройденная
 * глава, пришедший герой, новый модуль, взятая звезда, поднятая редкость (SZE-5.2).
 * Сравнивается «до» и «после» одной
 * записи, поэтому повторная запись того же профиля ничего не открывает, а откат (облако
 * взяло старую копию) не выдаётся за открытие.
 */
export function metaUnlocks(before: SectorZeroProgress, after: SectorZeroProgress): EventProps[] {
  const out: EventProps[] = [];
  const had = new Set(before.chaptersWon);
  for (const id of new Set(after.chaptersWon)) if (!had.has(id)) out.push({ kind: 'chapter', id });
  for (const id of Object.keys(after.heroes))
    if (!(id in before.heroes)) out.push({ kind: 'hero', id });
  const owned = new Set(before.modules);
  for (const id of new Set(after.modules)) if (!owned.has(id)) out.push({ kind: 'module', id });
  for (const [id, n] of Object.entries(after.stars))
    if (n > (before.stars[id] ?? 0)) out.push({ kind: 'star', id, stars: n });
  for (const [id, r] of Object.entries(after.moduleRarity))
    if (rarityRank(r) > rarityRank(before.moduleRarity[id]))
      out.push({ kind: 'rarity', id, rarity: r });
  return out;
}
