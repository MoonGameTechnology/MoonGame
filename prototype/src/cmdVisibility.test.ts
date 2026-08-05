// CMD-VIS — сторож правила «нет приказа — нет кнопки».
//
// Заказ владельца: недоступный приказ не серый и не тостит отказом — кнопки просто
// НЕТ. Источник правды у видимости один — та же проба ядра (`canOrder`), которой
// решается и сам приказ; рукописных предикатов у кнопки быть не должно, иначе они
// разъедутся с ядром при первом же новом правиле (как разъехались с коридором:
// «а движется ли флот» не знал, что в коридоре остановки не бывает).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { advance, canOrder, newGame, order, HOUR } from './game';
import { moveFleet, stopFleet } from './actions';

/** Живое состояние прототипа: свой флот стоит дома. */
const base = () => {
  const s = newGame();
  const f = Object.values(s.fleets).find((x) => x.owner === 'p1')!;
  return { s, f };
};

/** Флот в пути: настоящий приказ через ядро прототипа + мгновение времени. */
function underway(s: ReturnType<typeof newGame>, fleetId: string, to: string) {
  const sent = order(s, moveFleet('p1', fleetId, to), s.time);
  if (sent.error) throw new Error(`move failed: ${sent.error}`);
  const later = advance(sent.state, sent.state.time + 1);
  const mv = later.state.fleets[fleetId]?.movement;
  if (!mv) throw new Error('fleet did not depart');
  return later.state;
}

describe('CMD-VIS — проба, на которой стоит кнопка «Стоп»', () => {
  it('стоящему флоту стоп недоступен → кнопки нет', () => {
    const { s, f } = base();
    expect(canOrder(s, stopFleet('p1', f.id))).toBe('E_FLEET_BUSY');
  });

  it('флоту в пути по обычной лейне стоп доступен → кнопка есть', () => {
    const { s, f } = base();
    const st = underway(s, f.id, s.planets[f.location!]!.links![0]!);
    expect(canOrder(st, stopFleet('p1', f.id))).toBe(null);
  });

  it('флоту В КОРИДОРЕ стоп недоступен: вошёл в прыжок — доезжай', () => {
    const { s, f } = base();
    const home = f.location!;
    const to = s.planets[home]!.links![0]!;
    // Ребро дома→сосед объявляется КОРИДОРНЫМ (addedLink): у прыжка нет середины.
    s.tempLanes = [
      {
        id: 'lane:cv',
        owner: 'p1',
        from: home,
        to,
        speedBonus: 0,
        expiresAt: s.time + 99 * HOUR,
        addedLink: true,
      },
    ];
    const st = underway(s, f.id, to);
    expect(canOrder(st, stopFleet('p1', f.id))).toBe('E_NOT_A_LANE');
  });
});

describe('CMD-VIS — кнопка и обработчик подключены к пробе', () => {
  it('main.ts решает и видимость «Стопа», и рассылку в группе через canOrder', () => {
    // main.ts — DOM-вход без юнит-харнеса; правило держится, только если ОБА места
    // (сборка ряда команд и обработчик клика) спрашивают ядро, а не свой if.
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const probes = src.match(/canOrder\(s, stopFleet\(ME, /g) ?? [];
    expect(probes.length).toBeGreaterThanOrEqual(2);
    // Рукописного предиката «а движется ли флот» у стопа больше нет.
    expect(src).not.toContain('if (s.fleets[id]?.movement) playerOrder(stopFleet');
  });
});
