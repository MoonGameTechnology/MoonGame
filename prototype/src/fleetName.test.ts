import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FLEET_CALLSIGNS, FLEET_KIND_KEY, fleetCallsign } from './fleetName';

describe('fleetCallsign — детерминированный позывной из id', () => {
  it('один id → один и тот же позывной (стабильно между вызовами/клиентами)', () => {
    expect(fleetCallsign('p1-1')).toBe(fleetCallsign('p1-1'));
    expect(fleetCallsign('t-a2')).toBe(fleetCallsign('t-a2'));
  });

  it('формат «{ИМЯ из пула} {N=1..9}»', () => {
    for (const id of ['p1-1', 'p2-3', 't-move', 'x', 'fleet-42']) {
      const cs = fleetCallsign(id);
      const m = /^([A-Z]+) ([1-9])$/.exec(cs);
      expect(m, `bad callsign ${cs}`).not.toBeNull();
      expect(FLEET_CALLSIGNS).toContain(m![1]);
    }
  });

  it('разные id дают разброс имён (не все одинаковые)', () => {
    const names = new Set(Array.from({ length: 40 }, (_, i) => fleetCallsign(`p${i}-${i}`)));
    expect(names.size).toBeGreaterThan(10);
  });
});

describe('имя соединения кораблей — всегда ФЛОТ (SHU-4.1)', () => {
  // Заказ владельца 2026-09-10 (§0.4 `shuttles-roadmap.md`): группа челноков зовётся
  // ЭСКАДРОЙ, группа кораблей — ФЛОТОМ. Лестница размеров (звено/эскадрилья/эскадра/
  // армада) была авиационной, то есть звала корабли словами челноков — два словаря на
  // одну вещь, ровно то, от чего ушёл SHU-0.1. Размер из имени не пропал для игрока:
  // корабли и десант стоят числами в подзаголовке карточки.
  it('ИМЯ НЕ ЗАВИСИТ ОТ РАЗМЕРА: у соединения кораблей один ключ, а не лестница', () => {
    expect(FLEET_KIND_KEY).toBe('fleet.kind.ships');
  });

  it('ЛЕСТНИЦА НЕ ВЕРНЁТСЯ МОЛЧА: в модуле имени не осталось ключей размера', () => {
    const src = readFileSync(fileURLToPath(new URL('./fleetName.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/fleet\.size\./);
  });
});
