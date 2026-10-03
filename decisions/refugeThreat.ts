/**
 * Доклад союзника об угрозе месту эвакуации (глава VI §8.7, кирпич PVR-8.4).
 *
 * «Основное соединение противника меняет курс. Идёт к докам». Доклад соответствует
 * доступным сведениям, а не раскрывает скрытый приказ врага: замысел контрудара туман
 * снимает (`operation.counterattack`), и решение его не читает. Оно смотрит на то, что
 * сторона видит сама, — курс флота, который зритель опознал своим зрением или зрением
 * союзника.
 *
 * Правила:
 *
 * 1. **Угроза — видимый флот неразгромленного главного соединения** (контракт операции,
 *    PVR-8.3), чей путь кончается в месте эпизода, о котором игрок уже знает
 *    (`missionFacts.found`). Разгромленное соединение — уже не «основное соединение», а
 *    флоты сбора и волны в доклад не входят: он о главных силах.
 * 2. **О неизвестном месте не докладывают**: пока доки не найдены, курс к ним ничего не
 *    говорит игроку и выдал бы место раньше эпизода (§8.4).
 * 3. **Каждый флот — один раз** (`reported` — уже доложенные id). Вызывающий запоминает
 *    доложенное сам: решение чистое и ничего не хранит.
 */
import type {
  Fleet,
  FleetId,
  GameState,
  PlanetId,
  PlayerId,
} from '../packages/shared-core/src/index';

/** Флот главных сил врага, идущий к известному месту эвакуации. */
export interface RefugeThreat {
  fleetId: FleetId;
  /** Место эпизода, куда ведёт его путь. */
  at: PlanetId;
}

/**
 * Новые угрозы известному месту эвакуации глазами игрока `player`. `sees` — виден ли
 * флот игроку (опознан его зрением или зрением союзника); в сетевой партии состояние уже
 * отфильтровано туманом. Порядок — по id соединений и флотов.
 */
export function refugeThreats(
  state: GameState,
  player: PlayerId,
  sees: (fleet: Fleet) => boolean,
  reported: ReadonlySet<FleetId>,
): RefugeThreat[] {
  const known = state.missionFacts?.found?.[player] ?? [];
  const op = state.operation;
  if (!op || known.length === 0) return [];
  const out: RefugeThreat[] = [];
  for (const id of Object.keys(op.forces).sort()) {
    const force = op.forces[id]!;
    if (force.brokenAt !== undefined) continue;
    for (const fleetId of [...force.fleets].sort()) {
      const fleet = state.fleets[fleetId];
      if (!fleet?.movement || reported.has(fleetId) || !sees(fleet)) continue;
      const end = fleet.movement.destination ?? fleet.movement.to;
      if (known.includes(end)) out.push({ fleetId, at: end });
    }
  }
  return out;
}
