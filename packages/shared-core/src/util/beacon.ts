/**
 * Ответ Роя на маяк (заказ владельца 2026-09-24: «когда флот прибывает, там разведчик Роя —
 * что и заставляет Рой выделить силы туда»).
 *
 * Это ЭВРИСТИКА ИИ, а не правило мира: по ADR `docs/explanations/05` тактика NPC не живёт
 * в модулях ядра и не входит в контракт реплея. Здесь — только чистая функция «кого и
 * куда», которую зовут оба драйвера Роя: бот прототипа (`prototype/src/ai.ts`) и
 * серверный оркестратор (`packages/server/src/pveOrchestrator.ts`). Одна функция на два
 * хоста — чтобы Рой не отвечал на маяк по-разному в одиночном забеге и на сервере.
 *
 * Правило:
 * 1. **Маяк — провинция с признаком `beacon`** (данные карты). На нём дежурит разведчик
 *    Роя; пока маяк тихий, Рой туда ничего не шлёт.
 * 2. **Тревога — флот ИГРОКА на маяке или маяк в руках игрока.** Разведчик «видит»
 *    прибывший флот: ответ идёт с момента прибытия, а не после его гибели. Другие NPC
 *    (пираты, нейтралы) тревоги не поднимают: задача про игрока, и Рой, гоняющий волны
 *    за пиратами, ослаб бы вне задачи (прогон пассивного игрока это поймал).
 * 3. **Ответ — один отряд за раз**: ближайший свободный флот Роя (стоит, не в бою, не
 *    на самом маяке). Пока ответ в пути к маяку, второй не шлётся — маяк задачи, а не
 *    воронка, в которую Рой сливает всё, что у него есть.
 * 4. **Дозорный на маяке не уходит** (`beaconSentinels`). Флот Роя, стоящий на маяке,
 *    которого игрок не взял, — разведчик-дозорный: драйверы не отдают ему приказов и не
 *    штурмуют им провинцию. Иначе бот считал бы его свободным отрядом и пускал на
 *    расширение — и задача усиливала бы Рой вне себя (прогон главы против сильного Роя
 *    это поймал). Маяк в руках игрока — другое дело: пришедший отряд штурмует его как
 *    обычно, иначе удержание было бы нечем сорвать.
 */
import type { FleetId, GameState, PlanetId, PlayerId } from '../state/gameState';

/** Признак провинции-маяка (`Planet.traits`). */
export const BEACON_TRAIT = 'beacon';

export interface BeaconCallout {
  fleetId: FleetId;
  to: PlanetId;
}

/** Кого Рой (`npc`) шлёт к каким маякам прямо сейчас. Детерминированно: id сравниваются. */
export function beaconCallouts(state: GameState, npc: PlayerId): BeaconCallout[] {
  const out: BeaconCallout[] = [];
  const busy = new Set<FleetId>();
  const beacons = Object.values(state.planets)
    .filter((p) => p.traits.includes(BEACON_TRAIT))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const fleets = Object.values(state.fleets).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  /** Игрок, а не Рой и не другой NPC (правило 2). */
  const player = (owner: PlayerId): boolean => owner !== npc && !state.players?.[owner]?.npc;
  for (const beacon of beacons) {
    const intruder =
      (beacon.owner !== null && player(beacon.owner)) ||
      fleets.some(
        (f) => player(f.owner) && f.location === beacon.id && f.units.some((u) => u.count > 0),
      );
    if (!intruder) continue;
    const answering = fleets.some(
      (f) =>
        f.owner === npc &&
        f.movement !== null &&
        (f.movement.destination ?? f.movement.to) === beacon.id,
    );
    if (answering) continue;
    let best: { id: FleetId; d: number } | null = null;
    for (const f of fleets) {
      if (f.owner !== npc || busy.has(f.id)) continue;
      if (f.movement || f.battleId || f.location == null || f.location === beacon.id) continue;
      if (!f.units.some((u) => u.count > 0)) continue;
      const at = state.planets[f.location];
      if (!at) continue;
      const dx = at.position.x - beacon.position.x;
      const dy = at.position.y - beacon.position.y;
      const d = dx * dx + dy * dy;
      if (!best || d < best.d || (d === best.d && f.id < best.id)) best = { id: f.id, d };
    }
    if (best) {
      busy.add(best.id);
      out.push({ fleetId: best.id, to: beacon.id });
    }
  }
  return out;
}

/** Флоты Роя, дежурящие на маяках (правило 4): драйверы им приказов не отдают. */
export function beaconSentinels(state: GameState, npc: PlayerId): Set<FleetId> {
  const beacons = new Set(
    Object.values(state.planets)
      .filter(
        (p) =>
          p.traits.includes(BEACON_TRAIT) &&
          (p.owner === null || p.owner === npc || !!state.players?.[p.owner]?.npc),
      )
      .map((p) => p.id),
  );
  const out = new Set<FleetId>();
  for (const f of Object.values(state.fleets))
    if (f.owner === npc && f.location != null && !f.movement && beacons.has(f.location)) out.add(f.id);
  return out;
}
